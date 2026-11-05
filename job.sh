#!/bin/bash
# Contribute — scheduled ledger refresh (cron).
#
# One Python process scans the ledger once (ledger_scan.py) and exits early
# when no record needs scheduled work. It first reconciles prepared PR records
# whose reviewed work already reached the
# target repository's main by another path. Strong commit, reviewed-diff,
# merged-branch, or distinctive-identifier evidence settles an ordinary PR
# with a landing reference; partial identifier evidence only adds a dismissible
# hint. A PR update whose target settled first stays prepared but gains one
# recovery handoff so its remaining private work cannot be mistaken for
# sendable. That pass is independently CAS-safe and never sends a notification.
#
# Reconcile disposable staging checkouts and finish reviewed app-publication
# links for terminal records before the GitHub-dependent work. Both are
# deliberately retryable: the next scheduled pass resumes either outcome
# without asking the owner to repeat the publication decision.
#
# Then, for every pr/issue ledger record that is still draft/open, ask GitHub
# for its live state, latest activity, and check status in ONE batched GraphQL
# call (aliased resource() nodes, ~1 rate-limit point total), write back any
# change, and fire a celebratory push the first time something merges. The
# mini-app UI does the same state refresh on open; this keeps the feed and the
# merged-count fresh even when nobody opens the app. When GitHub activity or
# failing checks need follow-up, the job adds a
# `needs_attention` + `attention` payload so the app can offer a targeted agent
# follow-up. Writes use compare-and-swap
# (If-Match on the read's ETag), so the scheduled refresh cannot clobber a
# concurrent writer — the agent claiming/submitting a record, or the app's
# Dismiss button. If a version is unavailable, the record is skipped instead
# of weakening the update to a blind write. On a lost race (412), it is left
# for the app's live refresh and the next scheduled run to reconcile.
#
# The supervised app-job runner passes the numeric app id as $1 and mints a
# short-lived APP_TOKEN scoped to this installed app. The job keeps the runner's
# API base and pins gh's config/HOME/PATH — without those, gh can't find the
# credential store and would look "not logged in" even on a connected instance.
# gh resolves auth from /data/cli-auth/gh (the boot symlink target), which the
# backend populates only when the owner connects GitHub from Contribute.
#
# Exits 0 quietly when gh is missing, unauthenticated, or there is nothing to
# refresh — an un-connected instance is a normal state, not an error.
set -u

APP_ID="${1:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"
APP_TOKEN="${APP_TOKEN:-}"

# gh's auth store lives under its config dir; point straight at it so the lookup
# never depends on cron providing HOME or the ~/.config/gh symlink. Set both
# anyway for any tool that reads HOME, and make sure /usr/local/bin (where gh is
# installed) is on PATH before probing for it.
export HOME="${HOME:-/home/mobius}"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-/data/cli-auth/gh}"
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
export API_BASE_URL APP_TOKEN APP_ID

if [ -z "$APP_ID" ] || [ -z "$APP_TOKEN" ]; then
  # No app id or scoped credential means the supervisor contract is missing.
  exit 0
fi

mkdir -p /data/cron-logs

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export SCRIPT_DIR

# The refresh logic is pure I/O against the local storage API (urllib) plus gh
# for the GraphQL round-trip. A quoted heredoc keeps the shell out of it; all
# inputs arrive via the exported environment. Diagnostics (an unhandled error)
# land in the cron log; every expected failure exits 0 silently above/below.
python3 - <<'PY' 2>>/data/cron-logs/contribute.log
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ["API_BASE_URL"].rstrip("/")
TOKEN = os.environ["APP_TOKEN"]
APP_ID = os.environ["APP_ID"]
PREFIX = "contributions/"
DEFAULT_BRANCH_BY_REPO = {}
BASE_FAILURES_BY_REPO = {}


def _call(method, path, body=None, headers=None):
  url = API + path
  hdrs = {"Authorization": "Bearer " + TOKEN}
  if headers:
    hdrs.update(headers)
  data = None
  if body is not None:
    data = json.dumps(body).encode("utf-8")
    hdrs["Content-Type"] = "application/json"
  req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
  with urllib.request.urlopen(req, timeout=15) as resp:
    return resp.read(), resp.headers


def _get_json(path):
  raw, _ = _call("GET", path)
  return json.loads(raw) if raw else None


def _record_path(name):
  return "/api/storage/apps/%s/%s%s" % (APP_ID, PREFIX, name)


# Only records that still need scheduled work are read: live PRs/issues,
# prepared records, terminal records that still hold a staging checkout, and
# merged records awaiting their app connection. Settled history is recognized
# from listing metadata plus the previous pass's summaries (ledger_scan.py).
sys.path.insert(0, os.environ["SCRIPT_DIR"])
from ledger_scan import LedgerScan, awaiting_publication_connection
from github_events import (
  AUTHOR_ATTENTION_TYPES, COMMENT_FIELDS, REVIEW_FIELDS, TRUSTED, UNTRUSTED,
  UNVERIFIED, attention_provenance, latest_events, trusted_changes_request,
)

LEDGER = LedgerScan(_call, APP_ID, os.environ.get("APP_JOB_STATE_DIR") or None)
records = LEDGER.records_needing_work()
if not records:
  # Nothing live, prepared, awaiting connection, or holding a checkout.
  LEDGER.save()
  sys.exit(0)

# Prepared reconciliation (prepared_reconcile.py) shares this process and this
# one ledger scan, but stays a separate pass from the live-PR polling below:
# different target states, evidence, and failure modes should not turn one
# proven path into a conditional branch of the other, and its failure must not
# stop the passes after it. A record it rewrote carries a stale version here,
# so this pass leaves it to the next run's fresh scan.
import prepared_reconcile

PREPARED_STORAGE = prepared_reconcile.Storage(API, TOKEN, APP_ID)
try:
  prepared_reconcile.run(
    PREPARED_STORAGE, prepared_reconcile.GitHub(), records=records,
  )
except Exception as exc:
  print("contribute: prepared reconciliation error: %s" % exc, file=sys.stderr)
if PREPARED_STORAGE.written:
  records = [item for item in records if item[0] not in PREPARED_STORAGE.written]


TERMINAL_STAGING_STATUSES = frozenset((
  "merged", "closed", "superseded", "commented", "abandoned",
))
CONTRIBUTION_ROOTS = tuple(
  os.path.realpath(path) for path in ("/data/contrib", "/data/contributions")
)


def _terminal_staging_checkout(rec):
  if rec.get("status") not in TERMINAL_STAGING_STATUSES:
    return ""
  plan = rec.get("plan") if isinstance(rec.get("plan"), dict) else {}
  path = plan.get("repo_path")
  if not isinstance(path, str) or not path:
    return ""
  resolved = os.path.realpath(path)
  try:
    inside_staging = any(
      os.path.commonpath((resolved, root)) == root
      for root in CONTRIBUTION_ROOTS
    )
  except ValueError:
    return ""
  return resolved if inside_staging and os.path.isdir(resolved) else ""


def _reconcile_terminal_staging():
  for _name, rec, _etag in records:
    checkout = _terminal_staging_checkout(rec)
    if not checkout:
      continue
    record_id = urllib.parse.quote(str(rec.get("id") or ""), safe="")
    if not record_id:
      continue
    try:
      raw, _ = _call(
        "POST",
        "/api/github/contributions/%s/%s/cleanup-staging" % (
          APP_ID, record_id,
        ),
        {},
      )
      result = json.loads(raw) if raw else {}
      if (
        not result.get("cleaned")
        and os.path.isdir(checkout)
        and LEDGER.note_cleanup_refused(_name, checkout)
      ):
        print(
          "contribute: terminal staging remains %s" % rec.get("id"),
          file=sys.stderr,
        )
    except Exception as exc:
      print(
        "contribute: terminal staging cleanup %s error: %s" % (
          rec.get("id"), exc,
        ),
        file=sys.stderr,
      )


_reconcile_terminal_staging()
LEDGER.save()


def _finish_publication_connection(rec):
  if not awaiting_publication_connection(rec):
    return
  record_id = urllib.parse.quote(str(rec.get("id") or ""), safe="")
  if not record_id:
    return
  try:
    _call(
      "POST",
      "/api/github/contributions/%s/%s/connect-app" % (
        APP_ID, record_id,
      ),
      {},
    )
  except Exception as exc:
    # The route owns exact proof and leaves the app untouched on failure. Keep
    # the handoff pending so the next supervised pass retries it.
    print(
      "contribute: publication connection %s pending: %s" % (
        rec.get("id"), exc,
      ),
      file=sys.stderr,
    )


for _name, _record, _etag in records:
  _finish_publication_connection(_record)


def _is_target(rec):
  return (
    rec.get("type") in ("pr", "issue")
    and rec.get("status") in ("draft", "open", "landing")
    and isinstance(rec.get("url"), str)
    and rec["url"].startswith("https://github.com/")
  )


targets = [(name, rec, etag) for (name, rec, etag) in records if _is_target(rec)]
if not targets:
  sys.exit(0)

# One document, aliased resource() nodes. JSON string escaping is exactly the
# GraphQL string-literal escaping the url needs.
aliases = {}
parts = []
for i, (name, rec, etag) in enumerate(targets):
  alias = "r%d" % i
  aliases[alias] = (name, rec, etag)
  url_lit = json.dumps(rec["url"])
  parts.append(
    "%(alias)s: resource(url: %(url)s) { __typename "
    "... on PullRequest { "
    "state isDraft updatedAt reviewDecision mergeable "
    "comments(last: 10) { nodes { %(comment)s } } "
    "reviews(last: 10) { nodes { %(review)s } } "
    "commits(last: 1) { nodes { commit { statusCheckRollup { "
    "state "
    "contexts(first: 30) { nodes { __typename "
    "... on CheckRun { name conclusion detailsUrl } "
    "... on StatusContext { context state targetUrl } "
    "} } "
    "} } } } "
    "} "
    "... on Issue { "
    "state updatedAt "
    "comments(last: 10) { nodes { %(comment)s } } "
    "} }" % {
      "alias": alias, "url": url_lit,
      "comment": COMMENT_FIELDS, "review": REVIEW_FIELDS,
    }
  )
query = "query { " + " ".join(parts) + " }"

try:
  out = subprocess.run(
    ["gh", "api", "graphql", "-f", "query=" + query],
    capture_output=True, text=True, timeout=30,
  )
except Exception:
  sys.exit(0)
if out.returncode != 0:
  # gh error (rate limit, revoked token, org restriction) — leave state as-is.
  sys.exit(0)
try:
  data = (json.loads(out.stdout) or {}).get("data") or {}
except Exception:
  sys.exit(0)


def _live_status(node):
  # Mirrors domain.js liveStatusFor; keep the two in step. None = no verdict
  # (deleted, inaccessible, unexpected type) → the record is left unchanged.
  if not isinstance(node, dict):
    return None
  kind = node.get("__typename")
  if kind == "PullRequest":
    state = node.get("state")
    if state == "MERGED":
      return "merged"
    if state == "CLOSED":
      return "closed"
    if state == "OPEN":
      return "draft" if node.get("isDraft") else "open"
    return None
  if kind == "Issue":
    state = node.get("state")
    if state == "CLOSED":
      return "closed"
    if state == "OPEN":
      return "open"
  return None


def _first_node(conn):
  nodes = conn.get("nodes") if isinstance(conn, dict) else None
  if isinstance(nodes, list) and nodes and isinstance(nodes[0], dict):
    return nodes[0]
  return None


def _status_rollup(node):
  commits = node.get("commits") if isinstance(node, dict) else None
  latest = _first_node(commits)
  commit = latest.get("commit") if isinstance(latest, dict) else None
  return commit.get("statusCheckRollup") if isinstance(commit, dict) else None


def _check_state(node):
  rollup = _status_rollup(node)
  state = rollup.get("state") if isinstance(rollup, dict) else ""
  return state or ""


def _failing_checks(node):
  rollup = _status_rollup(node)
  contexts = rollup.get("contexts") if isinstance(rollup, dict) else None
  nodes = contexts.get("nodes") if isinstance(contexts, dict) else None
  if not isinstance(nodes, list):
    return []
  checks = []
  seen = set()
  for ctx in nodes:
    if not isinstance(ctx, dict):
      continue
    kind = ctx.get("__typename")
    if kind == "CheckRun":
      state = str(ctx.get("conclusion") or "").upper()
      name = str(ctx.get("name") or "").strip()
      url = str(ctx.get("detailsUrl") or "")
    elif kind == "StatusContext":
      state = str(ctx.get("state") or "").upper()
      name = str(ctx.get("context") or "").strip()
      url = str(ctx.get("targetUrl") or "")
    else:
      continue
    if state not in ("FAILURE", "ERROR") or not name:
      continue
    key = (name, url)
    if key in seen:
      continue
    seen.add(key)
    checks.append({"name": name, "url": url})
  return checks


def _record_head(rec):
  plan = rec.get("plan") if isinstance(rec.get("plan"), dict) else {}
  return str(plan.get("head_sha") or rec.get("head_sha") or rec.get("branch") or "")


def _gh_json(args, timeout=20):
  try:
    out = subprocess.run(
      ["gh", "api"] + args,
      capture_output=True, text=True, timeout=timeout,
    )
  except Exception:
    return None
  if out.returncode != 0:
    return None
  try:
    return json.loads(out.stdout) if out.stdout else None
  except Exception:
    return None


def _repo_slug(rec):
  repo = rec.get("repo")
  if isinstance(repo, str):
    repo = repo.strip()
    parts = repo.split("/")
    if len(parts) == 2 and parts[0] and parts[1]:
      return repo
  url = rec.get("url")
  if isinstance(url, str):
    parts = urllib.parse.urlparse(url).path.strip("/").split("/")
    if len(parts) >= 2 and parts[0] and parts[1]:
      return "%s/%s" % (parts[0], parts[1])
  return ""


def _default_branch(repo):
  if repo in DEFAULT_BRANCH_BY_REPO:
    return DEFAULT_BRANCH_BY_REPO[repo]
  branch = None
  info = _gh_json(["repos/%s" % repo], timeout=15)
  if isinstance(info, dict):
    value = info.get("default_branch")
    if isinstance(value, str) and value:
      branch = value
  DEFAULT_BRANCH_BY_REPO[repo] = branch
  return branch


def _base_failed_checks(repo):
  if repo in BASE_FAILURES_BY_REPO:
    return BASE_FAILURES_BY_REPO[repo]
  branch = _default_branch(repo)
  if not branch:
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  endpoint = (
    "repos/%s/actions/runs?per_page=1&status=completed&branch=%s" %
    (repo, urllib.parse.quote(branch, safe=""))
  )
  runs = _gh_json([endpoint], timeout=20)
  workflows = runs.get("workflow_runs") if isinstance(runs, dict) else None
  if not isinstance(workflows, list) or not workflows:
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  run_id = workflows[0].get("id") if isinstance(workflows[0], dict) else None
  if not run_id:
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  jobs = _gh_json(
    ["repos/%s/actions/runs/%s/jobs?per_page=50" % (repo, run_id)],
    timeout=30,
  )
  job_nodes = jobs.get("jobs") if isinstance(jobs, dict) else None
  if not isinstance(job_nodes, list):
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  failed = set()
  for job in job_nodes:
    if not isinstance(job, dict):
      continue
    conclusion = str(job.get("conclusion") or "").lower()
    if conclusion in ("failure", "error", "startup_failure", "timed_out", "action_required"):
      name = str(job.get("name") or "").strip()
      if name:
        failed.add(name)
  BASE_FAILURES_BY_REPO[repo] = {"branch": branch, "failed": failed}
  return BASE_FAILURES_BY_REPO[repo]


def _classified_failing_checks(rec, node):
  checks = _failing_checks(node)
  if not checks:
    return [], ""
  base = None
  if node.get("__typename") == "PullRequest":
    repo = _repo_slug(rec)
    if repo:
      base = _base_failed_checks(repo)
  failed = base.get("failed") if isinstance(base, dict) else None
  branch = base.get("branch") if isinstance(base, dict) else ""
  classified = []
  for check in checks:
    item = dict(check)
    classification = "unknown"
    if isinstance(failed, set):
      classification = "inherited" if item.get("name") in failed else "suspect-pr-caused"
    item["classification"] = classification
    classified.append(item)
  return classified, (branch or "")


def _checks_message(checks, branch):
  if not checks:
    return "The latest GitHub checks are failing."
  parts = []
  for check in checks:
    name = check.get("name") or "check"
    classification = check.get("classification")
    if classification == "inherited":
      parts.append("%s (also failing on %s - inherited)" % (name, branch or "base"))
    elif classification == "suspect-pr-caused":
      parts.append("%s (suspect)" % name)
    elif classification == "unknown":
      parts.append("%s (unknown)" % name)
    else:
      parts.append(name)
  return "Checks failing: %s." % ", ".join(parts)


def _is_autopilot(rec):
  block = rec.get("autopilot") if isinstance(rec.get("autopilot"), dict) else None
  return bool(block and block.get("enabled"))


def _ignored_event_urls(rec):
  block = rec.get("autopilot") if _is_autopilot(rec) else {}
  return set(
    str(url) for url in (block.get("ignored_event_urls") or [])
    if isinstance(url, str) and url
  )


GITHUB_EVENT_LOOKUPS = {}


def _fetch_github_event(api_path):
  # One exact comment or review, at most once per pass (refresh and delivery
  # both ask). None means GitHub reports it gone; any other failure raises,
  # so the event stays unverified rather than looking untrusted.
  if api_path not in GITHUB_EVENT_LOOKUPS:
    try:
      out = subprocess.run(
        ["gh", "api", api_path], capture_output=True, text=True, timeout=20,
      )
      if out.returncode == 0:
        GITHUB_EVENT_LOOKUPS[api_path] = json.loads(out.stdout)
      elif re.search(r"\(HTTP (404|410)\)", out.stderr or ""):
        GITHUB_EVENT_LOOKUPS[api_path] = None
      else:
        GITHUB_EVENT_LOOKUPS[api_path] = RuntimeError(
          (out.stderr or "gh api failed").strip()[:200]
        )
    except Exception as exc:
      GITHUB_EVENT_LOOKUPS[api_path] = exc
  result = GITHUB_EVENT_LOOKUPS[api_path]
  if isinstance(result, Exception):
    raise result
  return result


def _attention_provenance(rec, attention, node, ignore_urls):
  # Autopilot may act on a pending attention only when its provenance holds
  # now: failing checks come from GitHub's rollup, while an author attention
  # must name an event GitHub reports as a trusted author's
  # (github_events.attention_provenance). The stored type alone proves nothing
  # (records written before authors were classified carry github_activity for
  # anyone's comment).
  kind = attention.get("type") if isinstance(attention, dict) else None
  if kind not in ACTIONABLE_ATTENTION:
    return UNTRUSTED
  if kind not in AUTHOR_ATTENTION_TYPES:
    return TRUSTED
  return attention_provenance(
    attention, node, rec.get("url"), _fetch_github_event, ignore_urls,
  )


def _attention_update(rec, node):
  patch = {}
  if not isinstance(node, dict):
    return patch

  def set_if_changed(key, value):
    if (value or rec.get(key)) and rec.get(key) != value:
      patch[key] = value

  ignore_urls = _ignored_event_urls(rec)

  check_state = _check_state(node)
  failing_checks, base_branch = _classified_failing_checks(rec, node)
  set_if_changed("last_check_rollup_state", check_state)
  set_if_changed("failing_checks", failing_checks)

  review_decision = node.get("reviewDecision") or ""
  previous_review = rec.get("last_review_decision")
  set_if_changed("last_review_decision", review_decision)

  # Merge-conflict detection (autopilot event). GitHub reports MERGEABLE /
  # CONFLICTING / UNKNOWN; only a definite CONFLICTING is actionable.
  mergeable = node.get("mergeable") or ""
  previous_mergeable = rec.get("last_mergeable")
  set_if_changed("last_mergeable", mergeable)

  latest, latest_trusted = latest_events(node, ignore_urls=ignore_urls)
  changes_request = trusted_changes_request(node, ignore_urls=ignore_urls)
  baseline = (
    rec.get("last_github_activity_at") or
    rec.get("submitted_at") or
    rec.get("updated_at") or
    rec.get("created_at") or
    ""
  )
  if latest and latest["at"] > str(rec.get("last_github_activity_at") or ""):
    patch["last_github_activity_at"] = latest["at"]

  current_attention = (
    rec.get("attention") if isinstance(rec.get("attention"), dict) else {}
  )
  if (
    current_attention.get("type") == "checks_failed"
    and check_state == "SUCCESS"
  ):
    patch["needs_attention"] = False
    patch["attention"] = None
  # Actionable work still waiting for its round (or its owner) keeps the one
  # attention slot until it is handled or dismissed. Later outside activity
  # is reported beside it, never in place of it. Work GitHub could not be
  # asked about this pass keeps the slot too; only proof of an untrusted or
  # deleted event gives it up.
  pending_work = (
    bool(rec.get("needs_attention")) and "attention" not in patch
    and _attention_provenance(rec, current_attention, node, ignore_urls) != UNTRUSTED
  )
  if check_state == "SUCCESS" and rec.get("last_checks_attention_key"):
    patch["last_checks_attention_key"] = None

  attention = None
  checks_attention = None
  if check_state in ("FAILURE", "ERROR"):
    checks_attention = {
      "type": "checks_failed",
      "key": "checks_failed:%s:%s" % (check_state, _record_head(rec)),
      "title": "Checks failed",
      "message": _checks_message(failing_checks, base_branch),
      "url": rec.get("url") or "",
      "detected_at": now,
    }
  # Raise per checks KEY (state + head sha), not per raw state transition: an
  # autopilot follow-up push that fails again must fire for the NEW head even
  # though the stored rollup state never left FAILURE. The platform dedupes
  # response rounds by this same key (last_handled_attention_key), so
  # re-raising an already-handled key stays a quiet no-op.
  if checks_attention and rec.get("last_checks_attention_key") != checks_attention["key"]:
    attention = checks_attention
    patch["last_checks_attention_key"] = checks_attention["key"]
  elif (
    review_decision == "CHANGES_REQUESTED"
    and previous_review != "CHANGES_REQUESTED"
    and changes_request
  ):
    attention = {
      "type": "changes_requested",
      "key": "changes_requested:%s" % changes_request["at"],
      "title": "Changes requested",
      "message": "A GitHub review requested changes.",
      "url": changes_request.get("url") or rec.get("url") or "",
      "detected_at": now,
    }
  elif latest_trusted and latest_trusted["at"] > str(baseline):
    # Only a repository owner, member or collaborator can start an autopilot
    # round (github_events.py); this event is one of theirs.
    label = "review" if latest_trusted["kind"] == "review" else "comment"
    attention = {
      "type": "github_activity",
      "key": "github_activity:%s" % latest_trusted["at"],
      "title": "New GitHub activity",
      "message": "New %s from %s." % (label, latest_trusted["author"]),
      "url": latest_trusted.get("url") or rec.get("url") or "",
      "event_at": latest_trusted["at"],
      "detected_at": now,
    }
  elif latest and latest["at"] > str(baseline):
    # Someone without standing in the repository commented. Tell the owner;
    # never start a round from it (outside_activity is not actionable).
    label = "review" if latest["kind"] == "review" else "comment"
    outside = {
      "type": "outside_activity",
      "key": "outside_activity:%s" % latest["at"],
      "title": "New GitHub activity",
      "message": (
        "New %s from %s, who is not a maintainer of this repository. "
        "Autopilot will not act on it." % (label, latest["author"])
      ),
      "url": latest.get("url") or rec.get("url") or "",
      "event_at": latest["at"],
      "detected_at": now,
    }
    if pending_work:
      patch["outside_activity"] = outside
    else:
      attention = outside
  elif mergeable == "CONFLICTING" and previous_mergeable != "CONFLICTING":
    attention = {
      "type": "merge_conflict",
      "key": "merge_conflict:%s" % _record_head(rec),
      "title": "Needs a refresh to merge",
      "message": "New upstream changes conflict with this contribution.",
      "url": rec.get("url") or "",
      "detected_at": now,
    }

  if (
    not attention
    and checks_attention
    and current_attention.get("type") == "checks_failed"
    and current_attention.get("key") == checks_attention["key"]
  ):
    refreshed = dict(current_attention)
    refreshed.update({
      "type": checks_attention["type"],
      "key": checks_attention["key"],
      "title": checks_attention["title"],
      "message": checks_attention["message"],
      "url": checks_attention["url"],
    })
    if not refreshed.get("detected_at"):
      refreshed["detected_at"] = now
    if refreshed != current_attention:
      patch["attention"] = refreshed

  if (
    not attention
    and rec.get("needs_attention")
    and current_attention.get("type") in AUTHOR_ATTENTION_TYPES
    and not pending_work
  ):
    # Pending author attention without trusted provenance (written before
    # authors were classified, its author lost standing, or the event was
    # deleted) is kept for the owner as notification-only. A notice already
    # announced stays announced.
    downgraded = dict(current_attention)
    downgraded.update({
      "type": "outside_activity",
      "title": "New GitHub activity",
      "key": "outside_activity:%s" % str(
        current_attention.get("key") or ""
      ).split(":", 1)[-1],
      "message": (
        "GitHub activity that could not be confirmed as coming from a "
        "maintainer of this repository. Autopilot will not act on it."
      ),
      "downgraded_from": current_attention.get("type"),
    })
    patch["attention"] = downgraded

  if attention:
    patch["needs_attention"] = True
    patch["attention"] = attention
  return patch


# A push about one contribution opens that contribution, not the app's front
# page. `review:<id>` is the app-intent the shell delivers to index.jsx, which
# selects the record in whichever section it currently sits. The complete
# shell intent is at most 128 characters, including the seven in `review:`.
_RECORD_INTENT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,120}")


# A pull-request record that already has a public PR opens that PR's own page
# (`pr:<owner>:<repo>:<number>`, the notification-safe spelling of chat's
# `pull-request:owner/repo#N`; ":" cannot occur in a GitHub owner or repo name).
_REPO_PART = re.compile(r"[A-Za-z0-9_.-]{1,100}")


def _record_target(rec):
  owner, _, name = str(rec.get("repo") or "").partition("/")
  number = rec.get("number")
  intent = "pr:%s:%s:%s" % (owner, name, number)
  if (
    rec.get("type") == "pr"
    and _REPO_PART.fullmatch(owner) and _REPO_PART.fullmatch(name)
    and owner.strip(".") and name.strip(".")
    and isinstance(number, int) and not isinstance(number, bool) and number > 0
    and len(intent) <= 128
  ):
    return "/shell/?app=%s&intent=%s" % (APP_ID, intent)
  record_id = str(rec.get("id") or "")
  if _RECORD_INTENT_ID.fullmatch(record_id):
    return "/shell/?app=%s&intent=review:%s" % (APP_ID, record_id)
  return "/shell/?app=%s" % APP_ID


def _notify_attention(rec, attention):
  title = attention.get("title") or "Contribution needs attention"
  body = rec.get("title") or rec.get("repo") or "A contribution"
  message = attention.get("message")
  if message:
    body = "%s — %s" % (body, message)
  _call("POST", "/api/notifications/send", {
    "title": title,
    "body": body,
    "source_id": str(rec.get("id") or ""),
    "target": _record_target(rec),
  })


# Attention types the background loop handles autonomously. Mirrors
# autopilot.js ACTIONABLE_ATTENTION — keep the two in step.
ACTIONABLE_ATTENTION = frozenset((
  "changes_requested", "checks_failed", "github_activity",
))


def _respond_autopilot(rec, attention):
  # Ask the platform to run a background response round for this record's new
  # review event. Returns True when the event is handled by the loop (claimed,
  # deduped, escalated, or retrying) — meaning DON'T notify.
  # Returns False when the platform cannot or will not act autonomously (older
  # platform, missing grant, or permanent request failure), so the caller falls
  # back to the classic notification.
  path = "/api/github/contributions/%s/%s/respond" % (
    APP_ID, urllib.parse.quote(str(rec.get("id") or ""), safe=""),
  )
  try:
    raw, _ = _call("POST", path, {"attention": attention})
    try:
      result = json.loads(raw) if raw else {}
    except (TypeError, json.JSONDecodeError):
      result = {}
    # A stale/forged display mirror must not hide the review from the owner.
    # The platform's DB grant is authoritative, so fall back to the classic
    # notification when it says this record was never granted (or was paused).
    if isinstance(result, dict) and result.get("status") == "not_granted":
      return False
    return True
  except urllib.error.HTTPError as exc:
    if 400 <= exc.code < 500 and exc.code not in (409, 429):
      # Old backend (404), rejected authority (401/403), or invalid durable
      # attention: this pass cannot act autonomously, so preserve the classic
      # owner-visible path. Busy and rate-limited rounds remain quiet retries.
      return False
    # 409 (already handled / in flight), 429, and server failures are normal
    # retry states the next pass reconciles; never notify for them.
    return True
  except Exception:
    # Transient error — leave the attention on the record for the next pass.
    return True


def _read_record(path):
  raw, headers = _call("GET", path, headers={"x-mobius-version": "1"})
  return json.loads(raw), headers.get("ETag")


def _confirm_announced(path, rec, etag, slot, pending):
  # /notifications/send has no idempotency key (a tag only groups OS
  # pushes). Confirm only a successful response, never merely detection or
  # a transient /respond result. An ambiguous send or a crash before this
  # CAS can still repeat a notification; exactly-once needs endpoint support.
  # Returns the record and version this job last saw.
  for attempt in range(3):
    current = rec.get(slot)
    if (
      not _is_target(rec)
      or (slot == "attention" and not rec.get("needs_attention"))
      or not isinstance(current, dict)
      or (current.get("key"), current.get("detected_at"))
        != (pending.get("key"), pending.get("detected_at"))
      or current.get("announced_at")
    ):
      return rec, etag
    updated = dict(rec)
    updated[slot] = dict(current, announced_at=now)
    try:
      _, headers = _call("PUT", path, updated, headers={"If-Match": etag})
      return updated, headers.get("ETag")
    except urllib.error.HTTPError as exc:
      if exc.code != 412 or attempt == 2:
        raise
    # Merge only confirmation into a fresh record; never restore a stale
    # attention or overwrite unrelated changes from another writer.
    rec, etag = _read_record(path)
    if not etag:
      return rec, None
  return rec, etag


def _deliver_attention(name, node):
  # A prior pass may have durably written the attention but lost delivery.
  # Detection is not delivery. The scheduled runner owns single-flight for
  # this app; the record owns confirmation across runs. Re-read before routing
  # so a concurrent Dismiss, escalation or terminal transition stays in charge.
  path = _record_path(name)
  try:
    rec, etag = _read_record(path)
    if not etag or not _is_target(rec):
      return
    pending = rec.get("attention")
    if (
      rec.get("needs_attention")
      and isinstance(pending, dict) and pending.get("key")
      # /escalate owns human_required delivery, not this job.
      and pending.get("type") != "human_required"
    ):
      # Only work whose trusted provenance holds against this pass's GitHub
      # read reaches /respond; anything else is notification-only. Work
      # GitHub could not be asked about waits quietly for the next pass, like
      # a transient /respond failure: no round, and no fallback notice.
      provenance = (
        _attention_provenance(rec, pending, node, _ignored_event_urls(rec))
        if _is_autopilot(rec) else UNTRUSTED
      )
      held = provenance == UNVERIFIED
      routed = provenance == TRUSTED and _respond_autopilot(rec, pending)
      # Legacy attention has no delivery proof either; announce it once
      # rather than infer success from its presence on the record.
      if not (held or routed) and not pending.get("announced_at"):
        _notify_attention(rec, pending)
        rec, etag = _confirm_announced(path, rec, etag, "attention", pending)
    # Outside activity that arrived while actionable work held the attention
    # slot is reported on its own, once, without displacing that work.
    # Without a version (lost confirmation), the next pass delivers it.
    outside = rec.get("outside_activity")
    if (
      etag and _is_target(rec) and isinstance(outside, dict)
      and outside.get("key") and not outside.get("announced_at")
    ):
      _notify_attention(rec, outside)
      _confirm_announced(path, rec, etag, "outside_activity", outside)
  except Exception as exc:
    print("contribute: attention delivery %s pending: %s" % (name, exc),
          file=sys.stderr)


now = (
  datetime.datetime.now(datetime.timezone.utc)
  .replace(microsecond=0)
  .isoformat()
  .replace("+00:00", "Z")
)

for alias, (name, rec, etag) in aliases.items():
  node = data.get(alias)
  new_status = _live_status(node)
  patch = _attention_update(rec, node)
  was = rec.get("status")
  if was == "landing" and new_status in ("open", "draft"):
    new_status = None
  if new_status and new_status != was:
    patch["status"] = new_status
    if new_status in ("merged", "closed"):
      patch["needs_attention"] = False
      patch["attention"] = None
  if not patch:
    _deliver_attention(name, node)
    continue
  if not etag:
    print("contribute: skip %s — storage version unavailable" % name,
          file=sys.stderr)
    continue
  # One conditional write. If-Match pins the exact version this run read (and
  # computed the GraphQL verdict from), so a concurrent writer — the agent
  # claiming/submitting a record, the app's Dismiss — cannot be clobbered.
  # dict(rec) reapplies ONLY this job's own fields (status, attention,
  # observed GitHub state, updated_at) and preserves whatever fields other
  # writers added. On a 412 the record changed under us — skip it and let the
  # app's live refresh and the next scheduled run re-read and reapply if it still
  # needs it, rather than fight for the write.
  updated = dict(rec)
  updated.update(patch)
  updated["updated_at"] = now
  headers = {"If-Match": etag}
  try:
    _call("PUT", _record_path(name), updated, headers=headers)
  except urllib.error.HTTPError as exc:
    if exc.code == 412:
      print("contribute: skip %s — changed under refresh (412)" % name,
            file=sys.stderr)
    else:
      print("contribute: PUT %s failed (%s)" % (name, exc.code), file=sys.stderr)
    continue
  except Exception as exc:
    print("contribute: PUT %s error: %s" % (name, exc), file=sys.stderr)
    continue
  if new_status in ("merged", "closed"):
    try:
      _call(
        "POST",
        "/api/github/contributions/%s/%s/cleanup-staging" % (
          APP_ID, urllib.parse.quote(str(rec.get("id") or ""), safe=""),
        ),
        {},
      )
    except Exception as exc:
      print("contribute: staging cleanup %s failed: %s" % (name, exc),
            file=sys.stderr)
  if new_status == "merged":
    _finish_publication_connection(updated)
  _deliver_attention(name, node)
  if new_status == "merged" and was != "merged":
    title = rec.get("title") or "contribution"
    try:
      _call("POST", "/api/notifications/send", {
        "title": "Contribution merged 🎉",
        "body": "Your %s was merged — it ships to everyone 🎉" % title,
        "source_id": str(rec.get("id") or ""),
        "target": _record_target(rec),
      })
    except Exception:
      pass
  # PR rejected: a close without a merge is a terminal outcome the owner should
  # hear about once (parity with the merged 🎉 notification). Non-autopilot
  # records historically got no close notification; sending it for all closed
  # PRs is strictly more informative and never noisy (one per record, ever).
  if new_status == "closed" and was != "closed":
    title = rec.get("title") or "contribution"
    try:
      _call("POST", "/api/notifications/send", {
        "title": "Contribution closed",
        "body": "Your %s was closed on GitHub without merging." % title,
        "source_id": str(rec.get("id") or ""),
        "target": _record_target(rec),
      })
    except Exception:
      pass
PY

exit 0
