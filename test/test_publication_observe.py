import io
import json
import os
import re
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone

import ledger_scan
import publication_observe
from publication_observe import (
    CARD_WINDOW_SECONDS, FIRST_WAIT, MAX_OBSERVATIONS, MAX_PER_PASS,
    UNSUPPORTED_WAIT, Observer, uncertain,
)

ROOT = os.path.join(os.path.dirname(__file__), "..")
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc).timestamp()


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def stamp(seconds_ago):
    return datetime.fromtimestamp(NOW - seconds_ago, timezone.utc).isoformat().replace("+00:00", "Z")


def record(record_id, ago=3600, **fields):
    return {
        "id": record_id, "type": "pr", "status": "prepared",
        "last_submit_stage": "push_ambiguous", "updated_at": stamp(ago), **fields,
    }


class FakePlatform:
    """The observe route: answers by record id, and records every request."""

    def __init__(self, answers=None, error=None):
        self.answers = answers or {}
        self.error = error
        self.requests = []

    def call(self, method, path, body=None, headers=None, timeout=15):
        self.requests.append((method, path, body))
        if self.error is not None:
            raise self.error
        record_id = path.rsplit("/", 2)[-2]
        return json.dumps({"outcome": self.answers.get(record_id, "unavailable"),
                           "records": [{"id": record_id}]}).encode(), {}


class PublicationObserveTest(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.mkdtemp()
        self.now = NOW

    def observer(self, platform):
        return Observer(platform.call, "80", self.state, now=lambda: self.now)

    def test_uncertain_matches_the_app_predicate(self):
        self.assertTrue(uncertain(record("a", status="submitting", last_submit_stage=None)))
        self.assertTrue(uncertain(record("a")))
        self.assertTrue(uncertain(record("a", last_submit_stage="pushed", last_submit_error_code="publication_unconfirmed")))
        self.assertFalse(uncertain(record("a", last_submit_stage="pushed", last_submit_error_code="upstream_conflict")))
        self.assertFalse(uncertain(record("a", status="open")))
        self.assertFalse(uncertain(record("a", submission_mode="mobius-bot")))
        self.assertFalse(uncertain(record("a", type="issue", status="submitting")))
        domain = read(os.path.join(ROOT, "domain.js"))
        codes = re.search(r"UNCONFIRMED_SUBMIT_CODES = new Set\(\[([^\]]*)\]\)", domain).group(1)
        stages = re.search(r"UNSETTLED_SUBMIT_STAGES = new Set\(\[([^\]]*)\]\)", domain).group(1)
        self.assertEqual(set(re.findall(r"'([a-z_]+)'", codes)), set(publication_observe.UNCONFIRMED_CODES))
        self.assertEqual(set(re.findall(r"'([a-z_]+)'", stages)), set(publication_observe.UNSETTLED_STAGES))

    def test_only_posts_the_observe_route(self):
        platform = FakePlatform()
        self.observer(platform).run([record("a"), record("b", status="submitting")])
        self.assertEqual({(m, p.rsplit("/", 1)[-1]) for m, p, _ in platform.requests}, {("POST", "observe")})
        self.assertTrue(all(body == {} for _m, _p, body in platform.requests))
        self.assertEqual([p for _m, p, _b in platform.requests][0], "/api/github/contributions/80/a/observe")

    def test_a_record_a_card_may_still_be_checking_is_left_to_the_card(self):
        inline = read(os.path.join(ROOT, "inline-session.js"))
        window = re.search(r"RECHECK_WINDOW_MS = (\d+) \* (\d+) \* (\d+)", inline).groups()
        self.assertEqual(CARD_WINDOW_SECONDS * 1000, int(window[0]) * int(window[1]) * int(window[2]))
        platform = FakePlatform()
        self.observer(platform).run([record("recent", ago=CARD_WINDOW_SECONDS - 5), record("undated", updated_at="")])
        self.assertEqual(platform.requests, [])

    def test_a_pass_observes_a_bounded_few_oldest_first(self):
        platform = FakePlatform()
        records = [record("r%d" % n, ago=3600 + n) for n in range(MAX_PER_PASS + 3)]
        self.observer(platform).run(records)
        asked = [p.rsplit("/", 2)[-2] for _m, p, _b in platform.requests]
        self.assertEqual(len(asked), MAX_PER_PASS)
        self.assertEqual(asked, ["r%d" % n for n in range(MAX_PER_PASS + 2, 2, -1)])

    def test_unanswered_records_back_off_and_stop_at_the_cap(self):
        platform = FakePlatform(error=urllib.error.URLError("down"))
        for _ in range(3):
            self.observer(platform).run([record("a")])
        self.assertEqual(len(platform.requests), 1, "the next pass waits for the backoff")
        asked = 1
        for count in range(1, MAX_OBSERVATIONS + 3):
            self.now += FIRST_WAIT * 2 ** (count - 1)
            self.observer(platform).run([record("a")])
            asked = len(platform.requests)
        self.assertEqual(asked, MAX_OBSERVATIONS, "a stuck record is capped")

    def test_pending_and_unavailable_retry_but_final_answers_stop(self):
        platform = FakePlatform({"p": "pending", "c": "changed", "n": "not_eligible", "s": "settled"})
        records = [record(i) for i in ("p", "c", "n")]
        self.observer(platform).run(records)
        self.now += FIRST_WAIT
        self.observer(platform).run(records)
        asked = [p.rsplit("/", 2)[-2] for _m, p, _b in platform.requests]
        self.assertEqual(sorted(asked), ["c", "n", "p", "p"])
        # A new write is a new question.
        self.now += FIRST_WAIT * 4
        self.observer(platform).run([record("c", ago=CARD_WINDOW_SECONDS + 1)])
        self.assertEqual(platform.requests[-1][1], "/api/github/contributions/80/c/observe")

    def test_an_older_host_without_the_route_is_not_asked_again_for_a_while(self):
        platform = FakePlatform(error=urllib.error.HTTPError(
            "u", 404, "Not Found", {}, io.BytesIO(b'{"detail": "Not Found"}')))
        self.observer(platform).run([record("a"), record("b")])
        self.assertEqual(len(platform.requests), 1)
        self.now += UNSUPPORTED_WAIT - 1
        self.observer(platform).run([record("a"), record("b")])
        self.assertEqual(len(platform.requests), 1)
        self.now += 2
        self.observer(platform).run([record("a")])
        self.assertEqual(len(platform.requests), 2)

    def test_a_server_error_or_malformed_answer_is_not_an_outcome(self):
        for error in (urllib.error.HTTPError("u", 503, "x", {}, None), ValueError("bad json"),
                      urllib.error.HTTPError("u", 404, "x", {}, io.BytesIO(b'{"detail": "Contribution not found."}'))):
            platform = FakePlatform(error=error)
            self.observer(platform).run([record("a")])
            state = json.loads(read(os.path.join(self.state, publication_observe.STATE_FILE)))
            self.assertNotIn("final", state["entries"]["a"])
            self.assertEqual(state["entries"]["a"]["count"], 1)
            os.unlink(os.path.join(self.state, publication_observe.STATE_FILE))

    def test_records_no_longer_uncertain_are_forgotten(self):
        platform = FakePlatform()
        self.observer(platform).run([record("a")])
        self.observer(platform).run([record("a", status="open")])
        state = json.loads(read(os.path.join(self.state, publication_observe.STATE_FILE)))
        self.assertEqual(state["entries"], {})

    def test_the_job_runs_it_before_the_live_refresh_and_the_scan_reads_submitting(self):
        job = read(os.path.join(ROOT, "job.sh"))
        self.assertIn("import publication_observe", job)
        self.assertLess(job.index("publication_observe.Observer("), job.index("if not targets:"))
        self.assertTrue(ledger_scan.needs_scheduled_work({"status": "submitting"}))
        manifest = json.loads(read(os.path.join(ROOT, "mobius.json")))
        self.assertIn("publication_observe.py", manifest["source_files"])
        self.assertIn("publication-observer.js", manifest["source_files"])


if __name__ == "__main__":
    unittest.main()
