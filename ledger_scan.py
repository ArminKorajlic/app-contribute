"""Incremental ledger scan for the scheduled job.

Every scheduled pass needs to know which contribution records still need
work, but nearly every record is settled history that never changes again.
Reading every body through the storage API cost thousands of requests per
run on a long-lived ledger (about 40 s of server work per pass for ~1,700
records, twice per run, every 15 minutes).

A listing is metadata only. A record's body is re-read only when its size or
modification time changed since the previous run, and each body is reduced to
the few fields that decide scheduled work. A file that is not a record (stray
list, malformed JSON) is remembered as needing no work until it changes. Those
summaries live in the runner's per-app ``APP_JOB_STATE_DIR``: derived,
job-private state whose loss costs one full read, never correctness. Records that need work are always
returned with a freshly read storage version, so compare-and-swap writes are
unchanged.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
from collections.abc import Callable
from datetime import datetime
from typing import Any


PREFIX = "contributions/"
STATE_FILE = "ledger-scan.json"
SCHEMA = 1

# Records the job polls, reconciles, or settles on every pass. A record still
# `submitting` may hold a send GitHub has not confirmed (publication_observe.py).
LIVE_STATUSES = frozenset(("draft", "open", "landing", "prepared", "submitting"))
# Terminal records still owe cleanup while their disposable checkout exists.
TERMINAL_STATUSES = frozenset((
    "merged", "closed", "superseded", "commented", "abandoned",
))

# File clocks are coarse, so two same-size writes can share one modified_at.
# Like git's "racily clean" rule, a body whose modified_at is this close to
# the scan is not trusted to match that metadata next pass; it is re-read.
RACY_SECONDS = 2

Call = Callable[..., tuple[bytes, Any]]


def awaiting_publication_connection(record: dict[str, Any]) -> bool:
    """A merged record whose app still has to be connected to its new repo."""
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    handoff = (
        plan.get("after_merge") if isinstance(plan.get("after_merge"), dict) else {}
    )
    connection = (
        record.get("publication_connection")
        if isinstance(record.get("publication_connection"), dict)
        else {}
    )
    return (
        record.get("status") == "merged"
        and handoff.get("action") == "connect_app"
        and connection.get("status") not in ("connected", "connected_conflict")
    )


def summarize(record: dict[str, Any]) -> dict[str, Any]:
    """Keep only the fields that decide whether a record needs scheduled work."""
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    repo_path = plan.get("repo_path")
    return {
        "status": record.get("status"),
        "repo_path": repo_path if isinstance(repo_path, str) else "",
        "awaiting_connection": awaiting_publication_connection(record),
    }


def _settled_before(modified_at: Any, moment: float) -> bool:
    try:
        stamp = datetime.fromisoformat(str(modified_at)).timestamp()
    except ValueError:
        return False
    return stamp < moment - RACY_SECONDS


def _checkout_mtime(path: str) -> int | None:
    try:
        return os.stat(path).st_mtime_ns if path and os.path.isdir(path) else None
    except OSError:
        return None


def needs_scheduled_work(summary: dict[str, Any]) -> bool:
    status = summary.get("status")
    if status in LIVE_STATUSES or summary.get("awaiting_connection"):
        return True
    if status not in TERMINAL_STATUSES:
        return False
    checkout = _checkout_mtime(summary.get("repo_path") or "")
    if checkout is None:
        return False
    # The server refuses cleanup when it cannot prove the checkout is
    # disposable. That verdict holds until the record or its checkout changes.
    return summary.get("cleanup_refused_checkout_mtime") != checkout


class LedgerScan:
    """One pass's view of the ledger, backed by the previous pass's summaries."""

    def __init__(self, call: Call, app_id: str, state_dir: str | None):
        self._call = call
        self._app_id = app_id
        self._state_path = (
            os.path.join(state_dir, STATE_FILE) if state_dir else None
        )
        self._entries: dict[str, dict[str, Any]] = {}
        self._changed = False

    def _record_path(self, name: str) -> str:
        return "/api/storage/apps/%s/%s%s" % (self._app_id, PREFIX, name)

    def _list(self) -> dict[str, tuple[int, str]] | None:
        listed: dict[str, tuple[int, str]] = {}
        cursor = None
        for _page in range(2000):
            path = "/api/storage/apps-list/%s/%s?limit=500" % (self._app_id, PREFIX)
            if cursor:
                path += "&cursor=" + urllib.parse.quote(cursor, safe="")
            try:
                raw, _ = self._call("GET", path)
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    return None
                raise
            page = json.loads(raw) if raw else {}
            for entry in page.get("entries") or []:
                name = str(entry.get("name", ""))
                if entry.get("type") != "dir" and name.endswith(".json"):
                    listed[name] = (entry.get("size"), entry.get("modified_at"))
            cursor = page.get("next_cursor")
            if not cursor:
                return listed
        return listed

    def _read(self, name: str) -> tuple[dict[str, Any] | None, str | None]:
        # Storage sends an ETag only when a read opts into versioning; that
        # tag is what makes the caller's later PUT compare-and-swap.
        raw, headers = self._call(
            "GET", self._record_path(name), headers={"x-mobius-version": "1"},
        )
        try:
            record = json.loads(raw) if raw else None
        except ValueError:
            record = None
        if not isinstance(record, dict) or not record.get("id"):
            record = None
        return record, headers.get("ETag")

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self._state_path:
            return {}
        try:
            with open(self._state_path, encoding="utf-8") as handle:
                state = json.load(handle)
        except (OSError, ValueError):
            return {}
        if not isinstance(state, dict) or state.get("schema") != SCHEMA:
            return {}
        entries = state.get("entries")
        return entries if isinstance(entries, dict) else {}

    def records_needing_work(self) -> list[tuple[str, dict[str, Any], str | None]]:
        """Return (name, record, version) for every record needing scheduled work."""
        started = time.time()
        listed = self._list()
        if listed is None:
            return []
        previous = self._load()
        fresh: dict[str, tuple[dict[str, Any], str | None]] = {}
        entries: dict[str, dict[str, Any]] = {}
        for name, (size, modified_at) in listed.items():
            known = previous.get(name)
            if (
                isinstance(known, dict)
                and known.get("size") == size
                and known.get("modified_at") == modified_at
                and isinstance(known.get("summary"), dict)
            ):
                entries[name] = known
                continue
            try:
                record, version = self._read(name)
            except urllib.error.HTTPError:
                continue
            if record:
                fresh[name] = (record, version)
            entries[name] = {
                "size": size,
                "modified_at": (
                    modified_at if _settled_before(modified_at, started) else None
                ),
                "summary": summarize(record or {}),
            }
        self._changed = entries != previous
        self._entries = entries
        work = []
        for name, entry in entries.items():
            if not needs_scheduled_work(entry["summary"]):
                continue
            if name in fresh:
                record, version = fresh[name]
            else:
                try:
                    record, version = self._read(name)
                except urllib.error.HTTPError:
                    continue
                if not record:
                    continue
            work.append((name, record, version))
        return work

    def note_cleanup_refused(self, name: str, checkout: str) -> bool:
        """Remember a refusal; True when it is new rather than a repeat."""
        entry = self._entries.get(name)
        mtime = _checkout_mtime(checkout)
        if not entry or mtime is None:
            return True
        summary = entry["summary"]
        if summary.get("cleanup_refused_checkout_mtime") == mtime:
            return False
        summary["cleanup_refused_checkout_mtime"] = mtime
        self._changed = True
        return True

    def save(self) -> None:
        """Persist summaries only when they changed; never rewrite an idle ledger."""
        if not self._state_path or not self._changed:
            return
        directory = os.path.dirname(self._state_path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".ledger-scan-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"schema": SCHEMA, "entries": self._entries}, handle)
            os.replace(tmp, self._state_path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        self._changed = False
