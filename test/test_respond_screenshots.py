"""Tests for the screenshots a Respond result adds to the PR description (respond_screenshots.py and
the `screenshots` part of `save` and `post` in respond_result.py).

The harness of test_respond_result.py supplies the fake `gh`, the remote and the agent's copy. GitHub's
Git data calls (the `mobius-screenshots` branch) are answered by an in-memory stand-in, and the public
address check by a function the tests control, so nothing reaches the network.
"""

import hashlib
import json
import os
from pathlib import Path
import sys
from unittest import mock
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import respond_result as respond  # noqa: E402
import respond_screenshots as shots  # noqa: E402
from test_respond_result import HEAD_REF, PULL, RespondWorld, expected_digest  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
BEFORE = PNG + b"before"
AFTER = PNG + b"after"
DESCRIPTION = (
  "Adds one shared write path.\n\n"
  "Before: ![the list before, desktop](screenshot:before-desktop.png)\n"
  "After: ![the list after, desktop](screenshot:after-desktop.png)\n"
)


class FakeAssets:
  """Just enough of GitHub's Git data API to hold one branch of screenshots."""

  def __init__(self, held: dict[str, str] | None = None) -> None:
    self.tip: str | None = None
    self.blobs: dict[str, bytes] = {}
    self.trees: dict[str, dict[str, str]] = {}
    self.commits: dict[str, str] = {}
    self.calls: list[tuple[str, str]] = []
    self.racing = 0  # how many branch updates are refused as "not a fast-forward"
    if held:
      tree = self.add_tree(held)
      self.tip = self.add_commit(tree)

  @staticmethod
  def sha(*parts: str) -> str:
    return hashlib.sha1("\0".join(parts).encode()).hexdigest()

  def add_tree(self, files: dict[str, str]) -> str:
    sha = self.sha("tree", json.dumps(files, sort_keys=True))
    self.trees[sha] = files
    return sha

  def add_commit(self, tree: str) -> str:
    sha = self.sha("commit", tree, str(len(self.commits)))
    self.commits[sha] = tree
    return sha

  def __call__(self, path: str, method: str = "GET", body: dict | None = None):
    self.calls.append((method, path))
    prefix = "repos/owner/repo/git/"
    name = path[len(prefix):]
    if name == "ref/heads/mobius-screenshots":
      if self.tip is None:
        raise respond.CommandError("GitHub did not accept GET: Not Found (HTTP 404)")
      return {"object": {"sha": self.tip}}
    if name.startswith("commits/") and method == "GET":
      return {"tree": {"sha": self.commits[name.split("/")[1]]}}
    if name.startswith("trees/") and method == "GET":
      files = self.trees[name.split("/")[1]]
      return {"tree": [{"path": top} for top in sorted({file.split("/")[0] for file in files})]}
    if name == "blobs":
      import base64
      data = base64.b64decode(body["content"])
      sha = self.sha("blob", data.hex())
      self.blobs[sha] = data
      return {"sha": sha}
    if name == "trees":
      files = dict(self.trees[self.commits[self.tip]] if body.get("base_tree") else {})
      files.update({entry["path"]: entry["sha"] for entry in body["tree"]})
      return {"sha": self.add_tree(files)}
    if name == "commits":
      return {"sha": self.add_commit(body["tree"])}
    if name in ("refs", "refs/heads/mobius-screenshots"):
      if self.racing:
        self.racing -= 1
        raise respond.CommandError("GitHub did not accept PATCH: Update is not a fast forward (HTTP 422)")
      self.tip = body["sha"]
      return {}
    raise AssertionError(f"unexpected Git data call {method} {path}")

  def served(self, url: str) -> bytes | None:
    """What anyone could fetch from a raw.githubusercontent.com address of this branch."""
    host, owner, repo, commit, *path = url.removeprefix("https://").split("/")
    files = self.trees.get(self.commits.get(commit, ""), {})
    sha = files.get("/".join(path).replace("%20", " "))
    return self.blobs.get(sha) if sha else None


class ScreenshotWorld(RespondWorld):
  def setUp(self) -> None:
    super().setUp()
    self.before, self.after = self.root / "before.png", self.root / "after.png"
    self.before.write_bytes(BEFORE)
    self.after.write_bytes(AFTER)
    self.assets = FakeAssets()
    self.public = self.assets.served
    # The fake `gh` answers the PR and the comments; the screenshot branch lives in `self.assets`.
    real = respond.gh_api

    def route(path, method="GET", body=None):
      if "/git/" in path and not path.endswith(f"git/ref/heads/{HEAD_REF}"):
        return self.assets(path, method, body)
      return real(path, method, body)

    patches = [mock.patch.object(respond, "gh_api", route),
               mock.patch.object(shots, "read_public", lambda url: self.public(url)),
               mock.patch.object(shots, "PROOF_BACKOFF", 0)]
    for patch in patches:
      patch.start()
      self.addCleanup(patch.stop)

  def pictures(self, **changes) -> list[dict]:
    return [{"name": "before-desktop.png", "path": str(self.before), "alt": "the list before, desktop"},
            {"name": "after-desktop.png", "path": str(self.after), "alt": "the list after, desktop"}][:changes.get("count", 2)]

  def saved_with_pictures(self, **changes) -> tuple[list[str], dict]:
    shas = self.two_commits()
    outcome = self.save(self.input_for(shas, description=DESCRIPTION, screenshots=self.pictures(), **changes))
    self.assertEqual(outcome.code, 0, outcome.err)
    result = self.saved_result()
    self.decide(result)
    return shas, result


class SaveScreenshotTests(ScreenshotWorld):
  def test_save_keeps_the_exact_bytes_and_covers_them_in_the_digest(self):
    _, result = self.saved_with_pictures()
    self.assertEqual(result["screenshots"], [
      {"name": "before-desktop.png", "sha256": hashlib.sha256(BEFORE).hexdigest(), "size": len(BEFORE), "alt": "the list before, desktop"},
      {"name": "after-desktop.png", "sha256": hashlib.sha256(AFTER).hexdigest(), "size": len(AFTER), "alt": "the list after, desktop"},
    ])
    folder = self.app / "respond-screenshots" / result["id"]
    self.assertEqual((folder / "before-desktop.png").read_bytes(), BEFORE)
    without = {key: value for key, value in result.items() if key != "screenshots"}
    self.assertNotEqual(result["digest"], expected_digest(without), "the images are part of what the owner approves")
    self.assertEqual(result["digest"], respond.compute_digest(result))

  def test_a_result_without_screenshots_is_saved_as_before(self):
    shas = self.two_commits()
    self.assertEqual(self.save(self.input_for(shas)).code, 0)
    result = self.saved_result()
    self.assertNotIn("screenshots", result)
    self.assertEqual(result["digest"], expected_digest(result), "an old result keeps its digest")
    self.assertFalse((self.app / "respond-screenshots").exists())

  def test_saving_again_removes_the_images_of_the_result_it_replaces(self):
    _, first = self.saved_with_pictures()
    self.assertEqual(self.save(self.replies_only()).code, 0)
    self.assertFalse((self.app / "respond-screenshots" / first["id"]).exists())

  def test_every_screenshot_rule_break_is_refused_and_nothing_is_written(self):
    before = self.pictures()[0]
    big = self.root / "big.png"
    big.write_bytes(PNG + b"x" * shots.MAX_BYTES)
    notpng = self.root / "notpng.png"
    notpng.write_bytes(b"GIF89a")
    link = self.root / "link.png"
    os.symlink(self.before, link)
    cases = {
      "a name with capitals": ([{**before, "name": "Before.png"}], DESCRIPTION, "must be lowercase"),
      "a name used twice": ([before, before], DESCRIPTION, "used twice"),
      "a relative path": ([{**before, "path": "before.png"}], DESCRIPTION, "absolute path"),
      "an alt that is empty": ([{**before, "alt": " "}], DESCRIPTION, "one line"),
      "a picture the description never shows": (self.pictures(), "No images here.", "Not shown"),
      "a reference to a missing picture": ([before], DESCRIPTION, "were not attached: after-desktop.png"),
      "pictures but no description": (self.pictures(), None, "Not shown"),
      "nine pictures": ([{**before, "name": f"p{n}.png"} for n in range(9)], DESCRIPTION, "at most 8"),
      "an unknown key": ([{**before, "extra": 1}], DESCRIPTION, "name, path, alt"),
      "a file over the cap": ([{**before, "path": str(big)}], DESCRIPTION.replace("after", "before"), "larger than 2 MB"),
      "a file that is not a PNG": ([{**before, "path": str(notpng)}], DESCRIPTION.replace("after", "before"), "not a PNG"),
      "a link": ([{**before, "path": str(link)}], DESCRIPTION.replace("after", "before"), "could not be read"),
    }
    for label, (pictures, description, fragment) in cases.items():
      with self.subTest(label):
        before_state = self.snapshot()
        outcome = self.save(self.replies_only(description=description, screenshots=pictures))
        self.assertRefused(outcome, 2, fragment)
        self.assertEqual(self.snapshot(), before_state)

  def test_a_description_that_only_shows_the_syntax_in_code_is_not_checked(self):
    description = "Write `![alt](screenshot:name.png)` to attach one.\n\n```\n![x](screenshot:other.png)\n```\n"
    self.assertEqual(shots.references(description), [])
    self.assertEqual(self.save(self.replies_only(description=description, screenshots=[])).code, 0)


class PostScreenshotTests(ScreenshotWorld):
  def test_post_uploads_proves_then_links_the_images_before_anything_else_goes_out(self):
    shas, result = self.saved_with_pictures()
    outcome = self.post(result["id"])
    self.assertEqual(outcome.code, 0, outcome.err)
    stored = self.saved_result()
    commit = stored["receipts"]["screenshots"]["commit"]
    self.assertEqual(self.assets.tip, commit)
    body = next(json.loads(call["body"])["body"] for call in self.gh_writes() if call["method"] == "PATCH")
    for name in ("before-desktop.png", "after-desktop.png"):
      url = f"https://raw.githubusercontent.com/owner/repo/{commit}/screenshots/{HEAD_REF}/{result['id']}/{name}"
      self.assertIn(f"]({url})", body)
      self.assertEqual(self.assets.served(url), BEFORE if name.startswith("before") else AFTER, "the public address serves the approved bytes")
    self.assertNotIn("screenshot:", body)
    self.assertEqual(stored["description"], DESCRIPTION, "the approved text keeps its references")
    self.assertEqual([call[0] for call in self.assets.calls if call[0] != "GET"].count("PATCH"), 0, "a new branch is created, not updated")
    self.assertIn("Uploaded 2 screenshots", outcome.out)
    pushed_before_replies = [call["path"] for call in self.gh_writes()]
    self.assertTrue(all("/git/" not in path for path in pushed_before_replies), "the fake gh sees no screenshot calls")

  def test_the_upload_comes_first_and_a_failure_stops_before_anything_else_is_public(self):
    shas, result = self.saved_with_pictures()
    self.public = lambda url: None  # the repository is private: GitHub does not serve the images
    outcome = self.post(result["id"])
    self.assertEqual(outcome.code, 4, outcome.out)
    self.assertIn("does not serve them publicly", outcome.err)
    stored = self.saved_result()
    self.assertEqual((stored["state"], stored["error"]["step"]), ("failed", "screenshots"))
    self.assertEqual(self.gh_writes(), [], "no comment, description or review request went out")
    self.assertEqual(self.remote_branch(), self.base, "and the branch was not pushed")

  def test_a_second_post_after_a_fixed_problem_reuses_the_uploaded_commit(self):
    _, result = self.saved_with_pictures()
    self.public = lambda url: None
    self.assertEqual(self.post(result["id"]).code, 4)
    tip = self.assets.tip
    self.public = self.assets.served
    self.assertEqual(self.post(result["id"]).code, 0)
    self.assertEqual(self.assets.tip, tip, "the same images are not committed twice")
    self.assertEqual(self.saved_result()["receipts"]["screenshots"]["commit"], tip)

  def test_a_branch_that_holds_other_files_is_never_added_to(self):
    self.assets = FakeAssets({"README.md": "abc"})
    self.public = self.assets.served
    _, result = self.saved_with_pictures()
    outcome = self.post(result["id"])
    self.assertEqual(outcome.code, 4)
    self.assertIn("holds files that are not screenshots", outcome.err)
    self.assertEqual(self.gh_writes(), [])

  def test_a_moved_branch_is_read_again_and_the_upload_builds_on_it(self):
    self.assets = FakeAssets({"screenshots/other/r-000000000000/old.png": "abc"})
    self.assets.racing = 1
    self.public = self.assets.served
    _, result = self.saved_with_pictures()
    self.assertEqual(self.post(result["id"]).code, 0)
    files = self.assets.trees[self.assets.commits[self.assets.tip]]
    self.assertIn("screenshots/other/r-000000000000/old.png", files, "another upload's image is kept")
    self.assertEqual(len(files), 3)

  def test_post_refuses_when_a_stored_image_changed_after_the_owner_read_it(self):
    _, result = self.saved_with_pictures()
    (self.app / "respond-screenshots" / result["id"] / "after-desktop.png").write_bytes(PNG + b"swapped")
    before_state = self.snapshot()
    outcome = self.post(result["id"])
    self.assertRefused(outcome, 3, "missing or changed since the owner read it")
    self.assertEqual(self.snapshot(), before_state)
    self.assertEqual(self.assets.calls, [])

  def test_the_description_is_never_sent_with_unresolved_references(self):
    _, result = self.saved_with_pictures()
    posting = respond.Posting(respond.open_store(), respond.parse_pull(PULL), self.saved_result())
    with self.assertRaises(respond.CommandError):
      posting.update_description()
    self.assertEqual(self.gh_writes(), [])

  def test_the_dry_run_names_the_upload_first_and_changes_nothing(self):
    _, result = self.saved_with_pictures()
    before_state = self.snapshot()
    outcome = self.post(result["id"], "--dry-run")
    self.assertEqual(outcome.code, 0, outcome.err)
    steps = [line.strip() for line in outcome.out.splitlines() if line.strip()[:2] in ("1.", "2.")]
    self.assertIn("upload 2 screenshots to the mobius-screenshots branch of owner/repo", steps[0])
    self.assertEqual(self.snapshot(), before_state)
    self.assertEqual(self.assets.calls, [])


if __name__ == "__main__":
  unittest.main()
