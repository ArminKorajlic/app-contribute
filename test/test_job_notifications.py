import copy
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from contextlib import redirect_stderr
from unittest.mock import patch

JOB = os.path.join(os.path.dirname(__file__), "..", "job.sh")


def _job_python():
  with open(JOB, encoding="utf-8") as source:
    text = source.read()
  start = text.index("python3 - <<'PY'")
  body = text[text.index("\n", start) + 1:]
  return body[:body.index("\nPY\n")]


def _load_record_target(app_id="80"):
  source = _job_python()
  start = source.index("_RECORD_INTENT_ID = ")
  end = source.index("\ndef _notify_attention")
  scope = {"re": re, "APP_ID": app_id}
  exec(source[start:end], scope)
  return scope["_record_target"]


def _http_error(code):
  return urllib.error.HTTPError("https://fixture.invalid", code, "fixture", {}, None)


class FakeResponse:
  def __init__(self, body=None, headers=None):
    self.body = json.dumps(body).encode() if body is not None else b""
    self.headers = headers or {}

  def read(self):
    return self.body

  def __enter__(self):
    return self

  def __exit__(self, *args):
    pass


class JobEndpoints:
  """Run the entire heredoc, real ledger scan and loop, with no external I/O.

  The supervisor serializes scheduled runs; storage writers can still race
  either refresh or delivery confirmation. Hooks model those interleavings.
  Notification sends deliberately have NO idempotency, matching the endpoint.
  """
  def __init__(self):
    self.record = {
      "id": "fixture-record", "type": "pr", "status": "open",
      "title": "Fixture", "url": "https://github.com/example/project/pull/1",
      "created_at": "2026-01-01T00:00:00Z", "head_sha": "head-one",
    }
    self.node = {
      "__typename": "PullRequest", "state": "OPEN", "mergeable": "MERGEABLE",
      "comments": {"nodes": [{
        "url": "https://github.com/example/project/pull/1#comment",
        "createdAt": "2026-01-02T00:00:00Z", "author": {"login": "reviewer"},
        "authorAssociation": "MEMBER",
      }]},
    }
    self.version = 1
    self.version_available = True
    self.send_results = []
    self.respond_results = []
    self.sent = []
    self.send_attempts = []
    self.responded = []
    self.puts = []
    self.unexpected = []
    self.on_send = None
    self.on_put = None
    self.on_read = None
    self.record_reads = 0
    self.lookups = []
    self.lookup_failures = []
    self.errors = io.StringIO()

  def change(self, **fields):
    self.record.update(copy.deepcopy(fields))
    self.version += 1

  def urlopen(self, request, **kwargs):
    assert request.full_url.startswith("https://fixture.invalid/")
    method = request.get_method()
    path = urllib.parse.urlsplit(request.full_url).path
    body = json.loads(request.data) if request.data else None
    if method == "GET" and path == "/api/storage/apps-list/80/contributions/":
      return FakeResponse({"entries": [{
        "name": "fixture-record.json", "type": "file", "size": 100,
        "modified_at": "2026-01-01T00:00:00Z",
      }]})
    if path == "/api/storage/apps/80/contributions/fixture-record.json":
      if method == "GET":
        self.record_reads += 1
        self.assert_versioned_read(request)
        if self.on_read:
          self.on_read(self.record_reads)
        return FakeResponse(self.record, {"ETag": str(self.version)}
                            if self.version_available else {})
      if method == "PUT":
        self.puts.append(copy.deepcopy(body))
        if self.on_put:
          self.on_put(body)
        if request.get_header("If-match") != str(self.version):
          raise _http_error(412)
        self.change(**body)
        return FakeResponse(headers={"ETag": str(self.version)})
    if method == "POST" and path == "/api/notifications/send":
      self.send_attempts.append(body)
      result = self.send_results.pop(0) if self.send_results else None
      if isinstance(result, Exception):
        raise result
      self.sent.append(body)
      if self.on_send:
        self.on_send()
      return FakeResponse({"id": "notice-%d" % len(self.sent)})
    if method == "POST" and path.endswith("/respond"):
      self.responded.append(body)
      result = self.respond_results.pop(0) if self.respond_results else {"status": "not_granted"}
      if isinstance(result, Exception):
        raise result
      return FakeResponse(result)
    if method == "POST" and path.endswith("/cleanup-staging"):
      return FakeResponse({"status": "cleaned"})
    self.unexpected.append((method, path))
    raise AssertionError(self.unexpected[-1])

  @staticmethod
  def assert_versioned_read(request):
    assert request.get_header("X-mobius-version") == "1"

  def gh(self, args, **kwargs):
    if args[:3] == ["gh", "api", "graphql"]:
      return subprocess.CompletedProcess(args, 0, json.dumps({"data": {"r0": self.fetched_node(args[-1])}}), "")
    if len(args) == 3 and args[:2] == ["gh", "api"]:
      return self.rest_event(args)
    self.unexpected.append(args)
    raise AssertionError(args)

  def fetched_node(self, query):
    # GitHub returns only the requested tail of each connection, oldest first.
    node = copy.deepcopy(self.node)
    for field in ("comments", "reviews"):
      window = re.search(r"%s\(last: (\d+)\)" % field, query)
      if window and isinstance(node.get(field), dict):
        node[field]["nodes"] = node[field]["nodes"][-int(window.group(1)):]
    return node

  def rest_event(self, args):
    # The REST view of one exact comment or review, read from the whole thread.
    path = args[2]
    self.lookups.append(path)
    failure = self.lookup_failures.pop(0) if self.lookup_failures else None
    if failure:
      return subprocess.CompletedProcess(args, 1, "", "gh: %s\n" % failure)
    found = None
    comment = re.fullmatch(r"repos/example/project/issues/comments/(\d+)", path)
    review = re.fullmatch(r"repos/example/project/pulls/1/reviews/(\d+)", path)
    if comment:
      for item in (self.node.get("comments") or {}).get("nodes") or []:
        if item["url"].endswith("#issuecomment-" + comment.group(1)):
          found = {"html_url": item["url"], "created_at": item["createdAt"]}
          found["author_association"] = item.get("authorAssociation")
    elif review:
      for item in (self.node.get("reviews") or {}).get("nodes") or []:
        if item["url"].endswith("#pullrequestreview-" + review.group(1)):
          found = {"html_url": item["url"], "submitted_at": item["submittedAt"],
                   "state": item["state"]}
          found["author_association"] = item.get("authorAssociation")
    else:
      self.unexpected.append(args)
      raise AssertionError(args)
    if not found:
      return subprocess.CompletedProcess(
        args, 1, json.dumps({"message": "Not Found", "status": "404"}),
        "gh: Not Found (HTTP 404)\n",
      )
    return subprocess.CompletedProcess(args, 0, json.dumps(found), "")

  def run(self):
    # No shell, live token, gh process, or real urlopen is ever used. Each pass
    # loses process memory, so retries can succeed only from durable records.
    with tempfile.TemporaryDirectory() as state, patch.dict(os.environ, {
      "API_BASE_URL": "https://fixture.invalid", "APP_TOKEN": "fixture-token",
      "APP_ID": "80", "SCRIPT_DIR": os.path.abspath(os.path.dirname(JOB)),
      "APP_JOB_STATE_DIR": state,
    }), patch("urllib.request.urlopen", self.urlopen), patch("subprocess.run", self.gh), \
        patch.object(sys, "path", list(sys.path)), redirect_stderr(self.errors):
      try:
        exec(compile(_job_python(), JOB, "exec"), {"__name__": "__main__"})
      except SystemExit as exc:
        assert exc.code in (None, 0)
    assert not self.unexpected, self.unexpected


class ContributionPushTest(unittest.TestCase):
  def test_complete_intent_boundaries_and_app_fallback(self):
    target = _load_record_target()
    for value in ("a", "fixture-record_20260101.v2", "a" * 121):
      with self.subTest(value=value):
        self.assertEqual(target({"id": value}), "/shell/?app=80&intent=review:" + value)
    for value in ("", "../x y", "a\n", "a\r\n", "a\tb", "a/b", "a&x=y",
                  "a%0A", "é", ".a", "-a", "a:b", "a?b", "a#b", "a" * 122,
                  "a" * 127, "a" * 128, "a" * 129):
      with self.subTest(value=value):
        self.assertEqual(target({"id": value}), "/shell/?app=80")
    self.assertEqual(target({}), "/shell/?app=80")

  def test_failed_send_retries_standing_attention_then_stays_quiet(self):
    job = JobEndpoints()
    job.send_results = [_http_error(503)]
    job.run()
    self.assertEqual(len(job.send_attempts), 1)
    self.assertNotIn("announced_at", job.record["attention"])
    job.run()
    self.assertEqual(len(job.sent), 1)
    self.assertTrue(job.record["attention"]["announced_at"])
    job.run()
    job.node["mergeable"] = "UNKNOWN"  # unrelated refresh must also stay quiet
    job.run()
    self.assertEqual(len(job.sent), 1)
    self.assertEqual(job.sent[0]["target"], "/shell/?app=80&intent=review:fixture-record")

  def test_failed_send_retries_when_the_next_pass_also_changes_metadata(self):
    job = JobEndpoints()
    job.send_results = [TimeoutError("fixture")]
    job.run()
    job.node["mergeable"] = "UNKNOWN"
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_autopilot_transients_retain_fallback_until_it_is_announced(self):
    for failure in (_http_error(409), _http_error(429), _http_error(503), TimeoutError("fixture")):
      for fallback in ({"status": "not_granted"}, _http_error(404), _http_error(403)):
        with self.subTest(failure=failure, fallback=fallback):
          job = JobEndpoints()
          job.change(autopilot={"enabled": True})
          job.respond_results = [failure, fallback, fallback, fallback]
          job.send_results = [_http_error(503)]
          job.run()
          self.assertEqual(job.send_attempts, [])
          job.run()
          self.assertEqual(len(job.send_attempts), 1)
          job.run()
          job.run()
          self.assertEqual(len(job.sent), 1)
          self.assertTrue(job.record["attention"]["announced_at"])

  def test_autopilot_claimed_or_deduped_attention_is_not_classic_delivery(self):
    job = JobEndpoints()
    job.change(autopilot={"enabled": True})
    job.respond_results = [{"status": "claimed"}, {"status": "deduped"}]
    job.run()
    job.run()
    self.assertEqual(len(job.responded), 2)
    self.assertEqual(job.sent, [])
    self.assertNotIn("announced_at", job.record["attention"])

  def test_an_outside_comment_reaches_the_owner_but_never_starts_autopilot(self):
    job = JobEndpoints()
    job.node["comments"]["nodes"][0].update(
      authorAssociation="NONE", author={"login": "drive-by"},
    )
    job.change(autopilot={"enabled": True})
    job.run()
    job.run()
    self.assertEqual(job.responded, [])
    self.assertEqual(job.record["attention"]["type"], "outside_activity")
    self.assertEqual(len(job.sent), 1)
    self.assertIn("drive-by", job.sent[0]["body"])

  def _legacy_pending(self, job, association, attention_type):
    # A record written before authors were classified: its pending attention
    # names the newest comment, which the activity cursor already covers.
    comment = job.node["comments"]["nodes"][0]
    comment.update(authorAssociation=association, author={"login": "commenter"})
    job.change(
      autopilot={"enabled": True},
      last_github_activity_at=comment["createdAt"],
      needs_attention=True,
      attention={
        "type": attention_type,
        "key": "%s:%s" % (attention_type, comment["createdAt"]),
        "title": "New GitHub activity", "message": "New comment from commenter.",
        "url": comment["url"], "event_at": comment["createdAt"],
        "detected_at": "2026-01-02T00:05:00Z",
      },
    )
    job.respond_results = [{"status": "claimed"}] * 3

  def test_legacy_pending_activity_without_trusted_provenance_is_notification_only(self):
    for attention_type in ("github_activity", "changes_requested"):
      with self.subTest(attention_type=attention_type):
        job = JobEndpoints()
        self._legacy_pending(job, "NONE", attention_type)
        job.run()
        job.run()
        self.assertEqual(job.responded, [])
        self.assertEqual(job.record["attention"]["type"], "outside_activity")
        self.assertEqual(len(job.sent), 1)
        job.run()
        self.assertEqual(len(job.sent), 1)

  def test_downgrading_an_already_announced_legacy_attention_stays_quiet(self):
    job = JobEndpoints()
    self._legacy_pending(job, "NONE", "github_activity")
    job.change(
      autopilot={"enabled": False},
      attention=dict(job.record["attention"], announced_at="2026-01-02T00:06:00Z"),
    )
    job.run()
    job.run()
    self.assertEqual(job.record["attention"]["type"], "outside_activity")
    self.assertEqual(job.sent, [])
    self.assertEqual(job.responded, [])

  def test_legacy_pending_activity_from_a_maintainer_still_reaches_autopilot(self):
    job = JobEndpoints()
    self._legacy_pending(job, "MEMBER", "github_activity")
    key = job.record["attention"]["key"]
    job.run()
    self.assertEqual([r["attention"]["key"] for r in job.responded], [key])
    self.assertEqual(job.record["attention"]["type"], "github_activity")
    self.assertEqual(job.sent, [])

  def test_a_newer_outside_comment_keeps_an_undelivered_trusted_retry(self):
    job = JobEndpoints()  # one MEMBER comment
    job.change(autopilot={"enabled": True})
    job.respond_results = [TimeoutError("fixture")] + [{"status": "claimed"}] * 3
    job.run()
    trusted_key = job.record["attention"]["key"]
    job.node["comments"]["nodes"].append({
      "url": "https://github.com/example/project/pull/1#outside",
      "createdAt": "2026-01-03T00:00:00Z", "author": {"login": "drive-by"},
      "authorAssociation": "NONE",
    })
    job.run()
    self.assertEqual(
      [r["attention"]["key"] for r in job.responded], [trusted_key, trusted_key],
    )
    self.assertEqual(job.record["attention"]["key"], trusted_key)
    self.assertEqual(len(job.sent), 1)
    self.assertIn("drive-by", job.sent[0]["body"])
    job.run()
    self.assertEqual(len(job.sent), 1)

  def _trusted_comment_then_outside_flood(self, job, association="MEMBER"):
    # A maintainer comments, its round's /respond times out, then more outside
    # comments than the job's fetched window (last: 10) push it off the tail.
    trusted = job.node["comments"]["nodes"][0]
    trusted.update(url="https://github.com/example/project/pull/1#issuecomment-1")
    job.change(autopilot={"enabled": True})
    job.respond_results = [TimeoutError("fixture")] + [{"status": "claimed"}] * 4
    job.run()
    self.assertEqual(job.lookups, [])  # an event on the fetched page proves itself
    key = job.record["attention"]["key"]
    trusted["authorAssociation"] = association
    job.node["comments"]["nodes"] += [{
      "url": "https://github.com/example/project/pull/1#issuecomment-%d" % (100 + i),
      "createdAt": "2026-01-03T00:%02d:00Z" % i, "author": {"login": "drive-by-%d" % i},
      "authorAssociation": "NONE",
    } for i in range(11)]
    return key

  def test_more_outside_comments_than_the_fetched_window_keep_a_trusted_retry(self):
    job = JobEndpoints()
    trusted_key = self._trusted_comment_then_outside_flood(job)
    job.run()
    job.run()
    # Every pass retries the maintainer's event; no outsider ever starts a round.
    self.assertEqual(
      [r["attention"]["key"] for r in job.responded], [trusted_key] * 3,
    )
    self.assertEqual(job.record["attention"]["type"], "github_activity")
    self.assertEqual(job.record["attention"]["key"], trusted_key)
    self.assertEqual(job.record["last_github_activity_at"], "2026-01-03T00:10:00Z")
    # The trusted event was resolved by its own ID, once per pass, not by
    # scanning the thread.
    self.assertEqual(job.lookups, ["repos/example/project/issues/comments/1"] * 2)
    # The newest outside comment is reported once, beside the pending retry.
    self.assertEqual(len(job.sent), 1)
    self.assertIn("drive-by-10", job.sent[0]["body"])
    self.assertEqual(job.record["outside_activity"]["key"], "outside_activity:2026-01-03T00:10:00Z")

  def test_an_off_page_event_whose_author_lost_standing_is_notification_only(self):
    job = JobEndpoints()
    self._trusted_comment_then_outside_flood(job, association="NONE")
    job.run()
    job.run()
    # Revalidated by its own ID, then refused: only the first, failed attempt
    # ever reached /respond, and the owner hears about the newest comment.
    self.assertIn("repos/example/project/issues/comments/1", job.lookups)
    self.assertEqual(len(job.responded), 1)
    self.assertEqual(job.record["attention"]["type"], "outside_activity")
    self.assertEqual(len(job.sent), 1)

  def test_a_deleted_off_page_event_is_notification_only(self):
    job = JobEndpoints()
    self._trusted_comment_then_outside_flood(job)
    del job.node["comments"]["nodes"][0]
    job.run()
    job.run()
    self.assertIn("repos/example/project/issues/comments/1", job.lookups)
    self.assertEqual(len(job.responded), 1)
    self.assertEqual(job.record["attention"]["type"], "outside_activity")
    self.assertEqual(len(job.sent), 1)

  def test_an_unavailable_lookup_holds_the_trusted_retry_without_running_it(self):
    job = JobEndpoints()
    trusted_key = self._trusted_comment_then_outside_flood(job)
    job.lookup_failures = ["Bad Gateway (HTTP 502)"]
    job.run()
    # Unproven this pass: no round, no downgrade, no notice for the trusted
    # event; the outside comment is still reported on its own.
    self.assertEqual(len(job.responded), 1)
    self.assertEqual(job.record["attention"]["key"], trusted_key)
    self.assertEqual(job.record["attention"]["type"], "github_activity")
    self.assertEqual(len(job.sent), 1)
    self.assertIn("drive-by-10", job.sent[0]["body"])
    job.run()
    self.assertEqual([r["attention"]["key"] for r in job.responded], [trusted_key] * 2)
    self.assertEqual(len(job.sent), 1)

  def test_platform_human_required_remains_platform_owned(self):
    for autopilot in (False, True):
      with self.subTest(autopilot=autopilot):
        job = JobEndpoints()
        job.node["comments"] = {"nodes": []}
        attention = {"type": "human_required", "key": "human_required:fixture"}
        job.change(needs_attention=True, attention=attention, autopilot={"enabled": autopilot})
        job.run()  # writes mergeable metadata
        job.run()  # no refresh patch
        self.assertEqual(job.record["attention"], attention)
        self.assertEqual(job.sent, [])
        self.assertEqual(job.responded, [])

  def test_unconfirmed_legacy_attention_is_announced_once_not_assumed_delivered(self):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    job.change(needs_attention=True, attention={"type": "github_activity", "key": "legacy"})
    job.run()
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_refresh_cas_conflict_does_not_notify_or_overwrite_another_writer(self):
    job = JobEndpoints()
    def race(body):
      job.on_put = None
      job.change(title="Concurrent title", needs_attention=False)
    job.on_put = race
    job.run()
    self.assertEqual(job.sent, [])
    self.assertEqual(job.record["title"], "Concurrent title")
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_missing_storage_version_never_writes_or_sends(self):
    job = JobEndpoints()
    job.version_available = False
    job.run()
    self.assertEqual(job.sent, [])
    self.assertEqual(job.puts, [])

  def test_confirmation_cas_preserves_concurrent_fields_without_resending(self):
    job = JobEndpoints()
    job.on_send = lambda: job.change(title="Concurrent title", chat_ids=["fixture-chat"])
    job.run()
    self.assertEqual(job.record["title"], "Concurrent title")
    self.assertEqual(job.record["chat_ids"], ["fixture-chat"])
    self.assertTrue(job.record["attention"]["announced_at"])
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_confirmation_retries_a_second_cas_race_without_sending_again(self):
    job = JobEndpoints()
    conflicts = []
    def race(body):
      if (body.get("attention") or {}).get("announced_at") and len(conflicts) < 2:
        conflicts.append(True)
        job.change(summary="Concurrent edit %d" % len(conflicts))
    job.on_put = race
    job.run()
    self.assertEqual(len(conflicts), 2)
    self.assertEqual(job.record["summary"], "Concurrent edit 2")
    self.assertTrue(job.record["attention"]["announced_at"])
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_lost_confirmation_is_retryable_but_cannot_promise_exactly_once(self):
    job = JobEndpoints()
    def fail_confirmation(body):
      if (body.get("attention") or {}).get("announced_at"):
        raise _http_error(503)
    job.on_put = fail_confirmation
    job.run()
    self.assertEqual(len(job.sent), 1)
    self.assertNotIn("announced_at", job.record["attention"])
    self.assertIn("attention delivery", job.errors.getvalue())
    job.on_put = None
    job.run()
    # The send API accepts no idempotency key. A successful send followed by
    # lost confirmation may repeat, rather than permanently losing failures.
    self.assertEqual(len(job.sent), 2)
    self.assertTrue(job.record["attention"]["announced_at"])
    job.run()
    self.assertEqual(len(job.sent), 2)

  def test_no_version_on_pending_delivery_read_does_not_send(self):
    job = JobEndpoints()
    job.send_results = [_http_error(503)]
    job.run()
    job.version_available = False
    job.run()
    self.assertEqual(len(job.send_attempts), 1)
    self.assertNotIn("announced_at", job.record["attention"])

  def test_confirmation_cas_never_resurrects_dismissed_or_replaced_attention(self):
    for attention in (None, {"type": "human_required", "key": "human_required:fixture"},
                      {"type": "github_activity", "key": "new-event"}):
      with self.subTest(attention=attention):
        job = JobEndpoints()
        job.on_send = lambda: job.change(needs_attention=bool(attention), attention=attention)
        job.run()
        self.assertEqual(job.record["attention"], attention)
        self.assertEqual(job.record["needs_attention"], bool(attention))
        self.assertEqual(len(job.sent), 1)

  def test_fresh_routing_read_respects_concurrent_dismiss_escalation_and_close(self):
    for fields in ({"needs_attention": False, "attention": None},
                   {"attention": {"type": "human_required", "key": "human_required:fixture"}},
                   {"status": "closed"}):
      with self.subTest(fields=fields):
        job = JobEndpoints()
        def race(read_count):
          if read_count == 2:
            job.change(**fields)
        job.on_read = race
        job.run()
        self.assertEqual(job.sent, [])

  def test_new_attention_key_is_announced_after_an_earlier_success(self):
    job = JobEndpoints()
    job.run()
    job.node["comments"]["nodes"][0]["createdAt"] = "2026-01-03T00:00:00Z"
    job.run()
    job.run()
    self.assertEqual(len(job.sent), 2)

  def test_checks_recovery_then_failure_can_announce_the_same_head_again(self):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    rollup = {"state": "FAILURE"}
    job.node["commits"] = {"nodes": [{"commit": {"statusCheckRollup": rollup}}]}
    job.run()
    job.run()
    rollup["state"] = "SUCCESS"
    job.run()
    self.assertIsNone(job.record["attention"])
    rollup["state"] = "FAILURE"
    job.run()
    job.run()
    self.assertEqual(len(job.sent), 2)

  def test_terminal_notifications_target_the_record_without_stale_attention(self):
    for state in ("MERGED", "CLOSED"):
      for record_id in ("fixture-record", "a" * 121, "a" * 122, "bad\n"):
        with self.subTest(state=state, record_id=record_id):
          job = JobEndpoints()
          job.change(id=record_id)
          job.node["state"] = state
          job.run()
          job.run()
          self.assertEqual(len(job.sent), 1)
          self.assertEqual(job.sent[0]["target"], _load_record_target()({"id": record_id}))
          self.assertEqual(job.record["status"], state.lower())
          self.assertIsNone(job.record["attention"])


if __name__ == "__main__":
  unittest.main()
