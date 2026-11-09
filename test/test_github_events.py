import os
import unittest

from github_events import (
  TRUSTED, UNTRUSTED, UNVERIFIED, attention_provenance, latest_events, review_events,
  trusted_changes_request,
)

THREAD = "https://github.com/o/r/pull/1"


def comment(at, association, login="someone", url=None):
  return {
    "url": url or "https://github.com/o/r/pull/1#issuecomment-%s" % at,
    "createdAt": at,
    "authorAssociation": association,
    "author": {"login": login},
  }


def review(at, association, state="COMMENTED", login="someone"):
  return {
    "url": "https://github.com/o/r/pull/1#pullrequestreview-%s" % at,
    "submittedAt": at,
    "state": state,
    "authorAssociation": association,
    "author": {"login": login},
  }


def pr(comments=(), reviews=()):
  return {
    "__typename": "PullRequest",
    "comments": {"nodes": list(comments)},
    "reviews": {"nodes": list(reviews)},
  }


class LatestEventsTest(unittest.TestCase):

  def test_a_strangers_comment_cannot_start_a_round(self):
    latest, trusted = latest_events(pr([comment("2026-10-26T09:00:00Z", "NONE", "drive-by")]))
    self.assertEqual(latest["author"], "drive-by")
    self.assertFalse(latest["trusted"])
    self.assertIsNone(trusted)

  def test_past_contributors_are_not_trusted(self):
    for association in ("CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN"):
      _, trusted = latest_events(pr([comment("2026-10-26T09:00:00Z", association)]))
      self.assertIsNone(trusted, association)

  def test_owner_member_and_collaborator_are_trusted(self):
    for association in ("OWNER", "MEMBER", "COLLABORATOR"):
      _, trusted = latest_events(pr([comment("2026-10-26T09:00:00Z", association)]))
      self.assertTrue(trusted and trusted["trusted"], association)

  def test_a_later_stranger_comment_does_not_hide_a_maintainer_review(self):
    node = pr(
      comments=[comment("2026-10-26T09:05:00Z", "NONE", "drive-by")],
      reviews=[review("2026-10-26T09:00:00Z", "MEMBER", login="maintainer")],
    )
    latest, trusted = latest_events(node)
    self.assertEqual(latest["author"], "drive-by")
    self.assertEqual(trusted["author"], "maintainer")
    self.assertEqual(trusted["kind"], "review")

  def test_the_platforms_own_replies_are_ignored(self):
    own = comment("2026-10-26T09:00:00Z", "OWNER", url="https://github.com/o/r/pull/1#own")
    self.assertEqual(latest_events(pr([own]), {own["url"]}), (None, None))

  def test_missing_association_is_untrusted(self):
    node = pr([{"url": "u", "createdAt": "2026-10-26T09:00:00Z", "author": None}])
    (event,) = review_events(node)
    self.assertFalse(event["trusted"])
    self.assertEqual(event["author"], "GitHub")


class TrustedChangesRequestTest(unittest.TestCase):

  def test_only_a_trusted_reviewer_requesting_changes_counts(self):
    stranger = review("2026-10-26T09:00:00Z", "NONE", "CHANGES_REQUESTED")
    self.assertIsNone(trusted_changes_request(pr(reviews=[stranger])))
    member = review("2026-10-26T08:00:00Z", "MEMBER", "CHANGES_REQUESTED", "maintainer")
    found = trusted_changes_request(pr(reviews=[stranger, member]))
    self.assertEqual(found["author"], "maintainer")

  def test_a_trusted_comment_review_is_not_a_change_request(self):
    self.assertIsNone(trusted_changes_request(pr(reviews=[review("2026-10-26T09:00:00Z", "OWNER")])))


def no_lookup(api_path):
  raise AssertionError("an event on the fetched page needs no lookup: %s" % api_path)


def provenance(attention, node, fetch_event=no_lookup, ignore_urls=None):
  return attention_provenance(attention, node, THREAD, fetch_event, ignore_urls)


class AttentionProvenanceTest(unittest.TestCase):

  def attention(self, kind, event):
    at = event.get("createdAt") or event.get("submittedAt")
    return {"type": kind, "key": "%s:%s" % (kind, at), "url": event["url"]}

  def test_pending_activity_must_name_a_trusted_event_on_the_thread(self):
    member = comment("2026-10-26T09:00:00Z", "MEMBER")
    stranger = comment("2026-10-26T09:05:00Z", "NONE")
    node = pr([member, stranger])
    self.assertEqual(provenance(self.attention("github_activity", member), node), TRUSTED)
    self.assertEqual(provenance(self.attention("github_activity", stranger), node), UNTRUSTED)
    # The key and URL disagree.
    mixed = dict(self.attention("github_activity", member), url=stranger["url"])
    self.assertEqual(provenance(mixed, node), UNTRUSTED)
    # The platform's own replies never prove anything.
    self.assertEqual(provenance(
      self.attention("github_activity", member), node, ignore_urls={member["url"]}), UNTRUSTED)

  def test_requested_changes_must_name_a_trusted_change_request(self):
    request = review("2026-10-26T09:00:00Z", "MEMBER", "CHANGES_REQUESTED")
    remark = review("2026-10-26T09:01:00Z", "MEMBER")
    node = pr(reviews=[request, remark])
    self.assertEqual(provenance(self.attention("changes_requested", request), node), TRUSTED)
    self.assertEqual(provenance(self.attention("changes_requested", remark), node), UNTRUSTED)

  def test_only_author_attention_types_with_a_key_and_url_qualify(self):
    member = comment("2026-10-26T09:00:00Z", "MEMBER")
    node = pr([member])
    for attention in (
      None, {}, dict(self.attention("github_activity", member), url=""),
      dict(self.attention("github_activity", member), type="outside_activity"),
      dict(self.attention("github_activity", member), type="checks_failed"),
    ):
      self.assertEqual(provenance(attention, node), UNTRUSTED, attention)


class OffPageAttentionProvenanceTest(unittest.TestCase):
  """An event missing from the fetched page is resolved by its own ID."""

  AT = "2026-10-26T09:00:00Z"
  COMMENT_URL = THREAD + "#issuecomment-41"
  REVIEW_URL = THREAD + "#pullrequestreview-42"

  def lookup(self, payloads):
    calls = []

    def fetch_event(api_path):
      calls.append(api_path)
      result = payloads[api_path]
      if isinstance(result, Exception):
        raise result
      return result
    return fetch_event, calls

  def rest_comment(self, association, **fields):
    return dict({
      "html_url": self.COMMENT_URL, "created_at": self.AT,
      "author_association": association, "user": {"login": "someone"},
    }, **fields)

  def activity(self, url=None):
    return {"type": "github_activity", "key": "github_activity:" + self.AT,
            "url": url or self.COMMENT_URL}

  def outside_page(self):
    return pr([comment("2026-10-26T10:%02d:00Z" % i, "NONE") for i in range(10)])

  def test_absence_from_the_page_is_resolved_against_the_current_author(self):
    path = "repos/o/r/issues/comments/41"
    for association, expected in (("MEMBER", TRUSTED), ("NONE", UNTRUSTED),
                                  ("CONTRIBUTOR", UNTRUSTED)):
      fetch_event, calls = self.lookup({path: self.rest_comment(association)})
      self.assertEqual(provenance(self.activity(), self.outside_page(), fetch_event), expected)
      self.assertEqual(calls, [path])

  def test_the_fetched_event_must_be_the_one_the_attention_names(self):
    path = "repos/o/r/issues/comments/41"
    for fields in ({"created_at": "2026-10-26T09:00:01Z"},
                   {"html_url": "https://github.com/o/r/pull/2#issuecomment-41"}):
      fetch_event, _ = self.lookup({path: self.rest_comment("OWNER", **fields)})
      self.assertEqual(provenance(self.activity(), pr(), fetch_event), UNTRUSTED, fields)

  def test_an_off_page_change_request_is_resolved_as_a_review(self):
    attention = {"type": "changes_requested", "key": "changes_requested:" + self.AT,
                 "url": self.REVIEW_URL}
    path = "repos/o/r/pulls/1/reviews/42"
    for state, expected in (("CHANGES_REQUESTED", TRUSTED), ("DISMISSED", UNTRUSTED)):
      fetch_event, _ = self.lookup({path: {
        "html_url": self.REVIEW_URL, "submitted_at": self.AT, "state": state,
        "author_association": "COLLABORATOR",
      }})
      self.assertEqual(provenance(attention, pr(), fetch_event), expected)

  def test_a_deleted_event_is_untrusted_and_an_unreachable_one_unverified(self):
    path = "repos/o/r/issues/comments/41"
    fetch_event, _ = self.lookup({path: None})
    self.assertEqual(provenance(self.activity(), pr(), fetch_event), UNTRUSTED)
    fetch_event, _ = self.lookup({path: RuntimeError("HTTP 502")})
    self.assertEqual(provenance(self.activity(), pr(), fetch_event), UNVERIFIED)

  def test_only_an_event_url_on_this_thread_is_looked_up(self):
    for url in ("https://github.com/o/r/pull/2#issuecomment-41",
                "https://github.com/x/r/pull/1#issuecomment-41",
                THREAD + "#discussion_r41", THREAD + "#issuecomment-41/../../x",
                THREAD):
      self.assertEqual(provenance(self.activity(url), pr()), UNTRUSTED, url)
    # A repository named like an API segment still resolves the right kind.
    fetch_event = lambda path: {
      "html_url": "https://github.com/o/reviews/pull/1#issuecomment-41",
      "created_at": self.AT, "author_association": "MEMBER",
    } if path == "repos/o/reviews/issues/comments/41" else no_lookup(path)
    self.assertEqual(attention_provenance(
      self.activity("https://github.com/o/reviews/pull/1#issuecomment-41"), pr(),
      "https://github.com/o/reviews/pull/1", fetch_event), TRUSTED)
    issue = {"type": "github_activity", "key": "github_activity:" + self.AT,
             "url": "https://github.com/o/r/issues/1#pullrequestreview-42"}
    self.assertEqual(attention_provenance(
      issue, pr(), "https://github.com/o/r/issues/1", no_lookup), UNTRUSTED)


class JobWiringTest(unittest.TestCase):

  def setUp(self):
    path = os.path.join(os.path.dirname(__file__), "..", "job.sh")
    with open(path) as handle:
      self.job = handle.read()

  def test_the_job_requests_author_association_and_uses_the_shared_classifier(self):
    self.assertIn("latest_events(node, ignore_urls=ignore_urls)", self.job)
    self.assertIn("comments(last: 10) { nodes { %(comment)s } }", self.job)
    self.assertIn("reviews(last: 10) { nodes { %(review)s } }", self.job)
    self.assertNotIn("def _latest_event", self.job)

  def test_outside_activity_is_never_routed_to_autopilot(self):
    actionable = self.job[self.job.index("ACTIONABLE_ATTENTION = frozenset(("):]
    actionable = actionable[:actionable.index("))")]
    self.assertNotIn("outside_activity", actionable)
    self.assertIn('"type": "outside_activity"', self.job)


if __name__ == "__main__":
  unittest.main()
