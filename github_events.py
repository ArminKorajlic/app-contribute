"""Classify GitHub review activity on a contribution for the scheduled job.

A comment or review can start an autopilot round: a background agent that runs
with the owner's authority, pushes commits, and replies on GitHub. Anyone with a
GitHub account can comment on a public pull request, so the author decides
whether an event may start that round. Only people GitHub reports as the
repository's owner, an organization member, or an invited collaborator are
trusted to start one. Everyone else's activity is still surfaced to the owner,
who decides what to do with it.

The round agent still reads the whole thread and treats all reviewer text as
untrusted data; this filter only controls who can start a round.
"""

from __future__ import annotations

import re
from typing import Any, Callable


# GitHub's CommentAuthorAssociation values for people with standing in the
# repository. CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, MANNEQUIN and
# NONE describe anyone else, including a stranger who once had a PR merged.
TRUSTED_AUTHOR_ASSOCIATIONS = frozenset(("OWNER", "MEMBER", "COLLABORATOR"))

# The GraphQL selection the job requests for each comment and review node.
COMMENT_FIELDS = "url createdAt authorAssociation author { login }"
REVIEW_FIELDS = "url submittedAt state authorAssociation author { login }"


def _nodes(conn: Any) -> list[dict[str, Any]]:
  nodes = conn.get("nodes") if isinstance(conn, dict) else None
  return [n for n in nodes if isinstance(n, dict)] if isinstance(nodes, list) else []


def _author_login(node: dict[str, Any]) -> str:
  author = node.get("author")
  login = author.get("login") if isinstance(author, dict) else ""
  return login if isinstance(login, str) else ""


def _event(node: dict[str, Any], kind: str, at: str) -> dict[str, Any]:
  event = {
    "kind": kind,
    "at": at,
    "url": node.get("url") or "",
    "author": _author_login(node) or "GitHub",
    "trusted": node.get("authorAssociation") in TRUSTED_AUTHOR_ASSOCIATIONS,
  }
  if kind == "review":
    event["state"] = node.get("state") or ""
  return event


def review_events(node: Any, ignore_urls: set[str] | None = None) -> list[dict[str, Any]]:
  """Every timestamped comment and review on a PR or issue node.

  ``ignore_urls`` holds the exact URLs of replies the platform posted itself,
  so the agent's own replies never re-trigger a round. Other comments written
  under the owner's GitHub identity still count.
  """
  if not isinstance(node, dict):
    return []
  ignored = ignore_urls or set()
  events = []
  for comment in _nodes(node.get("comments")):
    at = comment.get("createdAt")
    if at and comment.get("url") not in ignored:
      events.append(_event(comment, "comment", at))
  for review in _nodes(node.get("reviews")):
    at = review.get("submittedAt")
    if at and review.get("url") not in ignored:
      events.append(_event(review, "review", at))
  return events


def latest_events(
  node: Any, ignore_urls: set[str] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
  """Return ``(newest event, newest event by a trusted author)``.

  The newest event of any author advances the record's activity cursor and is
  what the owner hears about. Only the newest trusted event may start a round,
  so a stranger's comment can neither start one nor hide a maintainer's
  review posted just before it.
  """
  events = review_events(node, ignore_urls)
  if not events:
    return None, None
  latest = max(events, key=lambda e: e["at"])
  trusted = [e for e in events if e["trusted"]]
  return latest, (max(trusted, key=lambda e: e["at"]) if trusted else None)


def trusted_changes_request(
  node: Any, ignore_urls: set[str] | None = None,
) -> dict[str, Any] | None:
  """The newest CHANGES_REQUESTED review by a trusted author, if any.

  GitHub's ``reviewDecision`` summarizes the PR, not who asked. A round for
  requested changes starts only when a trusted reviewer is among the askers.
  """
  requests = [
    e for e in review_events(node, ignore_urls)
    if e["kind"] == "review" and e["trusted"] and e.get("state") == "CHANGES_REQUESTED"
  ]
  return max(requests, key=lambda e: e["at"]) if requests else None


# Attention types raised from a GitHub author's comment or review. A pending
# one may start a round only while it still names a trusted event on the thread.
AUTHOR_ATTENTION_TYPES = frozenset(("github_activity", "changes_requested"))

# What GitHub says now about the event a pending author attention names.
TRUSTED = "trusted"
UNTRUSTED = "untrusted"
# GitHub could not be asked this pass. Not evidence either way: the attention
# may neither start a round nor be downgraded until a later pass proves it.
UNVERIFIED = "unverified"

# The immutable URL GitHub gives one comment or review on a PR or issue. The
# fragment's numeric ID addresses the same object through the REST API.
_EVENT_URL = re.compile(
  r"(https://github\.com/([^/#]+)/([^/#]+)/(pull|issues)/(\d+))"
  r"#(issuecomment|pullrequestreview)-(\d+)"
)


def _event_api_path(url: str, thread_url: Any) -> tuple[str, str] | None:
  """``(REST path, kind)`` of the exact comment or review ``url`` names on
  this thread, or None when ``url`` is not one."""
  match = _EVENT_URL.fullmatch(url)
  if not match or not isinstance(thread_url, str):
    return None
  thread, owner, repo, thread_kind, number, fragment, event_id = match.groups()
  if thread.lower() != thread_url.rstrip("/").lower():
    return None
  if fragment == "issuecomment":
    return "repos/%s/%s/issues/comments/%s" % (owner, repo, event_id), "comment"
  if thread_kind == "pull":
    return "repos/%s/%s/pulls/%s/reviews/%s" % (owner, repo, number, event_id), "review"
  return None


def _rest_event(payload: dict[str, Any], kind: str) -> dict[str, Any]:
  user = payload.get("user")
  login = user.get("login") if isinstance(user, dict) else ""
  event = {
    "kind": kind,
    "at": payload.get("submitted_at" if kind == "review" else "created_at") or "",
    "url": payload.get("html_url") or "",
    "author": login if isinstance(login, str) and login else "GitHub",
    "trusted": payload.get("author_association") in TRUSTED_AUTHOR_ASSOCIATIONS,
  }
  if kind == "review":
    event["state"] = payload.get("state") or ""
  return event


def _names_trusted_event(kind: str, at: str, url: str, event: dict[str, Any]) -> bool:
  if not (event["trusted"] and event["at"] == at and event["url"] == url):
    return False
  return kind != "changes_requested" or (
    event["kind"] == "review" and event.get("state") == "CHANGES_REQUESTED"
  )


def attention_provenance(
  attention: Any, node: Any, thread_url: Any,
  fetch_event: Callable[[str], Any], ignore_urls: set[str] | None = None,
) -> str:
  """Whether a pending author attention names an event a trusted author wrote.

  The attention's key carries the event timestamp (``<type>:<at>``) and its
  URL names the event. Both must match a comment or review that GitHub
  currently reports as written by a trusted author; a ``changes_requested``
  attention must name such a review that requested changes. A stored
  attention's type is display data, not evidence: an attention written before
  authors were classified proves nothing by itself.

  The fetched thread is only its newest page, so an event missing from it has
  not been shown untrusted. That one event is then resolved by the ID in its
  URL: ``fetch_event(api_path)`` returns GitHub's REST object, ``None`` when
  GitHub reports it gone, and raises when GitHub cannot be asked. Returns
  ``TRUSTED``, ``UNTRUSTED`` (including deleted events), or ``UNVERIFIED``.
  """
  if not isinstance(attention, dict):
    return UNTRUSTED
  kind = attention.get("type")
  key = attention.get("key")
  url = attention.get("url")
  if kind not in AUTHOR_ATTENTION_TYPES or not isinstance(key, str):
    return UNTRUSTED
  if not isinstance(url, str) or not url or url in (ignore_urls or ()):
    return UNTRUSTED
  prefix = kind + ":"
  if not key.startswith(prefix):
    return UNTRUSTED
  at = key[len(prefix):]
  on_page = [e for e in review_events(node, ignore_urls) if e["url"] == url]
  if not on_page:
    lookup = _event_api_path(url, thread_url)
    if not lookup:
      return UNTRUSTED
    api_path, event_kind = lookup
    try:
      payload = fetch_event(api_path)
    except Exception:
      return UNVERIFIED
    if not isinstance(payload, dict):
      return UNTRUSTED
    on_page = [_rest_event(payload, event_kind)]
  if any(_names_trusted_event(kind, at, url, e) for e in on_page):
    return TRUSTED
  return UNTRUSTED
