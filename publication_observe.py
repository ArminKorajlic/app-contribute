"""Scheduled, bounded observation of uncertain personal publications.

When a Send's response was lost or GitHub did not confirm its effect, the
record keeps its signed attempt receipt and stays locked (``submitting``, an
unsettled push stage, or an unconfirmed error code). With a Contribute pane
or chat card open, the app asks the platform to observe it. This pass does the
same when nothing is open: it asks the platform's read-only observe route
(mobius #2083/#2084) to read GitHub and save only an exact outcome.

It only reads. It never sends, retries a publication, clears an error, or
writes the ledger: settlement is the platform's, under its own locks. No
answer, a 404 or a timeout is never taken to mean that nothing was sent.

Bounds, so a stuck record cannot cost a request every pass:

- A record a card may still be checking (written less than
  ``CARD_WINDOW_SECONDS`` ago) is left to the card.
- At most ``MAX_PER_PASS`` observations per pass, oldest first.
- Each record version (its id and last write) is asked at most
  ``MAX_OBSERVATIONS`` times, with the wait doubling from ``FIRST_WAIT``.
- ``settled``, ``changed`` and ``not_eligible`` are final for that version.
- A Möbius without the route (404/405) is not asked again for
  ``UNSUPPORTED_WAIT`` seconds.

State lives in the runner's per-app ``APP_JOB_STATE_DIR``; losing it costs at
most a few extra reads, never correctness.
"""

from __future__ import annotations

import json
import os
import socket
import tempfile
import time
import urllib.error
import urllib.parse
from collections.abc import Callable
from datetime import datetime
from typing import Any


STATE_FILE = "publication-observe.json"
SCHEMA = 1
# inline-session.js RECHECK_WINDOW_MS: the card's own checks come first.
CARD_WINDOW_SECONDS = 10 * 60
MAX_PER_PASS = 3
MAX_OBSERVATIONS = 6
FIRST_WAIT = 15 * 60
MAX_WAIT = 24 * 60 * 60
UNSUPPORTED_WAIT = 6 * 60 * 60
REQUEST_TIMEOUT = 45
FINAL = frozenset(("settled", "changed", "not_eligible"))
OUTCOMES = FINAL | {"pending", "unavailable"}

# domain.js uncertainPublication; keep the two in step.
UNSETTLED_STAGES = frozenset(("push_pending", "push_ambiguous"))
UNCONFIRMED_CODES = frozenset((
    "publication_unconfirmed", "update_unconfirmed", "create_unconfirmed",
    "push_ambiguous",
))

Call = Callable[..., tuple[bytes, Any]]


def uncertain(record: dict[str, Any]) -> bool:
    """Whether GitHub has not confirmed this record's last send."""
    if record.get("type") != "pr" or record.get("submission_mode") == "mobius-bot":
        return False
    if record.get("status") == "submitting":
        return True
    return record.get("status") == "prepared" and (
        record.get("last_submit_stage") in UNSETTLED_STAGES
        or record.get("last_submit_error_code") in UNCONFIRMED_CODES
    )


def _route_missing(exc: urllib.error.HTTPError) -> bool:
    """An older Möbius without the route: the framework's own 404, or 405.

    A 404 about the record or the app ("Contribution not found.") is only no
    answer, never a sign that nothing was sent.
    """
    if exc.code == 405:
        return True
    if exc.code != 404:
        return False
    try:
        body = json.loads(exc.read() or b"null")
    except (OSError, ValueError):
        return False
    return isinstance(body, dict) and body.get("detail") == "Not Found"


def _written_at(record: dict[str, Any]) -> float | None:
    try:
        return datetime.fromisoformat(
            str(record.get("updated_at") or "").replace("Z", "+00:00"),
        ).timestamp()
    except ValueError:
        return None


def _version(record: dict[str, Any]) -> str:
    return "%s@%s" % (record.get("id"), record.get("updated_at") or "")


class Observer:
    def __init__(self, call: Call, app_id: str, state_dir: str | None,
                 now: Callable[[], float] = time.time):
        self._call = call
        self._app_id = app_id
        self._now = now
        self._path = os.path.join(state_dir, STATE_FILE) if state_dir else None
        self._state = self._load()
        self.asked: list[str] = []

    def _load(self) -> dict[str, Any]:
        empty = {"schema": SCHEMA, "unsupported_until": 0, "entries": {}}
        if not self._path:
            return empty
        try:
            with open(self._path, encoding="utf-8") as handle:
                state = json.load(handle)
        except (OSError, ValueError):
            return empty
        if (not isinstance(state, dict) or state.get("schema") != SCHEMA
                or not isinstance(state.get("entries"), dict)):
            return empty
        return state

    def _save(self) -> None:
        if not self._path:
            return
        directory = os.path.dirname(self._path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".publication-observe-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._state, handle)
            os.replace(tmp, self._path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def _observe(self, record_id: str) -> str:
        """One read-only observation: an outcome, 'transport' or 'unsupported'."""
        path = "/api/github/contributions/%s/%s/observe" % (
            urllib.parse.quote(str(self._app_id), safe=""),
            urllib.parse.quote(record_id, safe=""),
        )
        try:
            raw, _ = self._call("POST", path, {}, timeout=REQUEST_TIMEOUT)
            body = json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            return "unsupported" if _route_missing(exc) else "transport"
        except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError):
            return "transport"
        outcome = body.get("outcome") if isinstance(body, dict) else None
        return outcome if outcome in OUTCOMES else "transport"

    def run(self, records: list[dict[str, Any]]) -> None:
        now = self._now()
        entries = self._state["entries"]
        candidates = {}
        for record in records:
            record_id = str(record.get("id") or "")
            if not record_id or not uncertain(record):
                continue
            written = _written_at(record)
            # A card may still be checking a recent send; an unreadable time
            # is treated as recent.
            if written is None or now - written < CARD_WINDOW_SECONDS:
                continue
            candidates[record_id] = (written, record)
        # Forget records that are no longer uncertain.
        for record_id in [key for key in entries if key not in candidates]:
            del entries[record_id]
        if now < float(self._state.get("unsupported_until") or 0):
            self._save()
            return
        due = []
        for record_id, (written, record) in candidates.items():
            entry = entries.get(record_id)
            if not isinstance(entry, dict) or entry.get("version") != _version(record):
                entry = {"version": _version(record), "count": 0, "next_at": 0}
                entries[record_id] = entry
            if (entry.get("final") or entry["count"] >= MAX_OBSERVATIONS
                    or now < float(entry.get("next_at") or 0)):
                continue
            due.append((written, record_id))
        for _written, record_id in sorted(due)[:MAX_PER_PASS]:
            outcome = self._observe(record_id)
            self.asked.append(record_id)
            if outcome == "unsupported":
                # An older Möbius: nothing to observe with; ask again later.
                self._state["unsupported_until"] = now + UNSUPPORTED_WAIT
                break
            entry = entries[record_id]
            if outcome in FINAL:
                entry["final"] = outcome
                continue
            entry["count"] += 1
            entry["next_at"] = now + min(FIRST_WAIT * 2 ** (entry["count"] - 1), MAX_WAIT)
        self._save()
