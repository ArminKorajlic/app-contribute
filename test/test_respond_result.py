"""Tests for respond_result.py: `save`, `show` and `post` of a Respond-to-feedback result.

Nothing here reaches GitHub or the real app storage. `gh` is a script that logs every call
and answers from a config file, the "remote" is a bare Git repository in a temporary folder
(RESPOND_GIT_REMOTE), and RESPOND_APP_DIR points the helper at a temporary storage folder.
"""

import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
from typing import NamedTuple
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))  # respond_result imports agent_snapshot from the app folder

import respond_result as respond  # noqa: E402

PULL = "owner/repo#7"
SLUG = "owner__repo__7"
HEAD_REF = "stack/example/02-feature"
FIXTURE = Path(__file__).parent / "fixtures" / "respond-result.example.json"
TOKEN = "TEST-TOKEN-that-must-never-be-printed"

FAKE_GH = (Path(__file__).parent / "fixtures" / "fake_gh.py").read_text(encoding="utf-8")  # shared with respond-contract.test.mjs

REPLY_WITH_AWKWARD_TEXT = (
  "@alex both findings were real \u2014 fixed \U0001F680 \u05e9\u05dc\u05d5\u05dd\r\n\r\n"
  "1. **Lost write** (`write.js`) said \"done\" and \\o/\n\tindented line   \n"
  "2. **Sync** (`sync.js`)\n\n"
)


class Outcome(NamedTuple):
  code: int
  out: str
  err: str


def modified_app(*changes: tuple[int, str]) -> str:
  """app.js as the PR head has it (20 numbered lines), with the given 1-based lines replaced."""
  lines = [f"line {number}\n" for number in range(1, 21)]
  for number, text in changes:
    lines[number - 1] = text + "\n"
  return "".join(lines)


def expected_digest(result: dict) -> str:
  """The digest as respond-result.md defines it, written out independently of the helper."""
  content = {
    "v": 1,
    "pr_head": result["pr"]["head_sha"],
    "tip": result["tip_sha"],
    "points": [{key: p[key] for key in ("reviewer", "title", "ending", "commit", "answer")} for p in result["points"]],
    "replies": [{key: r[key] for key in ("body", "reply_to")} for r in result["replies"]],
    "description": result["description"],
    "rerequest": result["rerequest"],
    "commits": [commit["sha"] for commit in result["commits"]],
  }
  text = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
  return hashlib.sha256(text.encode("utf-8")).hexdigest()


def edit_point(data: dict, **changes) -> dict:
  return {**data, "points": [{**data["points"][0], **changes}, *data["points"][1:]]}


def edit_reply(data: dict, **changes) -> dict:
  return {**data, "replies": [{**data["replies"][0], **changes}, *data["replies"][1:]]}


class RespondWorld(unittest.TestCase):
  """A PR on a fake GitHub, its branch on a local bare remote, and the agent's private copy."""

  def setUp(self) -> None:
    self.root = Path(tempfile.mkdtemp(prefix="respond-test-"))
    self.addCleanup(shutil.rmtree, self.root, True)
    self.app = self.root / "app"
    self.remote = self.root / "remote.git"
    self.work = self.root / "work"
    self.results = self.app / "respond-results"
    self.decisions = self.app / "respond-decisions"
    self.result_path = self.results / f"{SLUG}.json"
    self.decision_path = self.decisions / f"{SLUG}.json"
    self.lock_path = self.results / f"{SLUG}.lock"
    self.gh_log = self.root / "gh-calls.jsonl"
    self.fake_config = self.root / "gh-config.json"
    self.start_environment()
    self.build_repositories()
    self.fake_config.write_text(json.dumps({
      "log": str(self.gh_log), "watch": str(self.result_path), "remote": str(self.remote),
      "writes": 0, "fail_at": None, "ref_sha": None,
      "pr": {
        "repo": "owner/repo", "number": 7, "state": "open", "author": "contributor",
        "head_repo": "owner/repo", "head_ref": HEAD_REF, "base_ref": "stack/example/01-base",
        "head_sha": None,  # None: GitHub shows whatever the remote branch is now
      },
    }))

  def start_environment(self) -> None:
    gitconfig = self.root / "gitconfig"
    gitconfig.write_text("[user]\n\tname = Test Agent\n\temail = agent@example.test\n[init]\n\tdefaultBranch = main\n")
    bin_dir = self.root / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "gh"
    fake.write_text(FAKE_GH)
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    environment = {
      "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
      "GIT_CONFIG_GLOBAL": str(gitconfig),
      "GIT_CONFIG_NOSYSTEM": "1",
      "RESPOND_APP_DIR": str(self.app),
      "RESPOND_GIT_REMOTE": str(self.remote),
      "FAKE_GH_CONFIG": str(self.fake_config),
      "CHAT_ID": "chat-under-test",
      "GH_TOKEN": TOKEN,
    }
    patcher = mock.patch.dict(os.environ, environment)
    patcher.start()
    self.addCleanup(patcher.stop)

  def build_repositories(self) -> None:
    self.git(self.root, "init", "-q", "--bare", str(self.remote))
    self.git(self.remote, "config", "uploadpack.allowAnySHA1InWant", "true")  # GitHub serves a commit by SHA
    self.git(self.root, "init", "-q", str(self.work))
    self.commit("Root", {
      "app.js": modified_app(),
      "old_name.js": "".join(f"export const value{n} = {n}\n" for n in range(1, 11)),
      "logo.png": b"\x89PNG\r\n\x1a\n\x00\x00binary-one",
    })
    self.base = self.commit("The PR head", {"README.md": "docs\n"})
    self.git(self.work, "push", "-q", str(self.remote), f"HEAD:refs/heads/{HEAD_REF}")

  # --- Git and the fake GitHub ------------------------------------------------------

  def git(self, cwd: Path, *args: str) -> str:
    done = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if done.returncode:
      raise AssertionError(f"git {' '.join(args)} failed: {done.stderr}")
    return done.stdout.strip()

  def commit(self, message: str, files: dict | None = None) -> str:
    for name, content in (files or {}).items():
      target = self.work / name
      target.parent.mkdir(parents=True, exist_ok=True)
      target.write_bytes(content if isinstance(content, bytes) else content.encode())
    self.git(self.work, "add", "-A")
    self.git(self.work, "commit", "-q", "-m", message)
    return self.git(self.work, "rev-parse", "HEAD")

  def two_commits(self) -> list[str]:
    first = self.commit("Public writes: a lost answer is unresolved", {
      "app.js": modified_app((3, "line three, fixed")),
      "new.js": "export const sync = () => {}\nexport default sync\n",
    })
    second = self.commit("Sync reads the live state again", {
      "app.js": modified_app((3, "line three, fixed"), (15, "line fifteen, fixed")),
    })
    return [first, second]

  def advance_remote(self, rewrite: bool = False) -> str:
    """Somebody else changes the PR branch on the remote: a new commit, or a rewritten head."""
    other = self.root / "other"
    if not other.exists():
      self.git(self.root, "clone", "-q", str(self.remote), str(other))
    self.git(other, "checkout", "-q", HEAD_REF)
    if rewrite:
      self.git(other, "commit", "-q", "--amend", "-m", "Rewritten head")
      self.git(other, "push", "-q", "--force", "origin", HEAD_REF)
    else:
      (other / "other.txt").write_text("someone else's work\n")
      self.git(other, "add", "-A")
      self.git(other, "commit", "-q", "-m", "Someone else's commit")
      self.git(other, "push", "-q", "origin", HEAD_REF)
    return self.git(other, "rev-parse", "HEAD")

  def remote_branch(self) -> str:
    return self.git(self.remote, "rev-parse", f"refs/heads/{HEAD_REF}")

  def fake(self, **changes) -> None:
    config = json.loads(self.fake_config.read_text())
    config.update(changes)
    self.fake_config.write_text(json.dumps(config))

  def fake_pr(self, **changes) -> None:
    config = json.loads(self.fake_config.read_text())
    config["pr"].update(changes)
    self.fake_config.write_text(json.dumps(config))

  def gh_calls(self) -> list[dict]:
    if not self.gh_log.exists():
      return []
    return [json.loads(line) for line in self.gh_log.read_text().splitlines()]

  def gh_writes(self) -> list[dict]:
    return [call for call in self.gh_calls() if call["method"] != "GET"]

  # --- the helper, as the agent and the chat run it ------------------------------------

  def cli(self, *argv) -> Outcome:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
      try:
        code = respond.main([str(item) for item in argv])
      except SystemExit as stop:  # argparse exits with 2 on a usage error
        code = stop.code
    return Outcome(code, out.getvalue(), err.getvalue())

  def input_for(self, shas: list[str], **changes) -> dict:
    data = {
      "points": [
        {"reviewer": "alex", "title": "A lost write answer is treated as success", "ending": "fixed",
         "commit": shas[0][:7], "answer": "One shared path now treats an unreadable answer as unresolved."},
        {"reviewer": "alex", "title": "Sync shows a stale list", "ending": "fixed",
         "commit": shas[1], "answer": "Sync reads the live state again."},
        {"reviewer": "sam", "title": "Rename the helper", "ending": "not_valid",
         "commit": None, "answer": "The name matches its sibling files."},
      ],
      "replies": [
        {"body": REPLY_WITH_AWKWARD_TEXT, "reply_to": None},
        {"body": "@sam the helper keeps its name.", "reply_to": 4242},
      ],
      "description": "Adds one shared write path.\n\n## Changes\n- Unreadable answers are unresolved.",
      "rerequest": ["alex"],
      "tests": "803 pass, 0 fail (node)",
    }
    data.update(changes)
    return data

  def replies_only(self, **changes) -> dict:
    """An input for work that made no commits: no points to tie to a commit."""
    return self.input_for([self.base] * 2, points=[], **changes)

  def save(self, data=None, raw=None, extra=(), pr: str = PULL) -> Outcome:
    path = self.root / "input.json"
    if raw is not None:
      path.write_bytes(raw if isinstance(raw, bytes) else raw.encode("utf-8"))
    else:
      path.write_text(json.dumps(data))
    return self.cli("save", "--pr", pr, "--repo-path", self.work, "--input", path, *extra)

  def post(self, result_id: str, *extra: str, pr: str = PULL) -> Outcome:
    return self.cli("post", "--pr", pr, "--id", result_id, *extra)

  def saved_result(self) -> dict:
    return json.loads(self.result_path.read_text())

  def write_result(self, result: dict) -> None:
    self.result_path.write_text(json.dumps(result, indent=2))

  def decide(self, result: dict, decision: str = "approved", **override) -> None:
    record = {"version": 1, "result_id": result["id"], "digest": result["digest"],
              "decision": decision, "at": "2026-11-06T09:30:00Z", **override}
    self.decisions.mkdir(parents=True, exist_ok=True)
    self.decision_path.write_text(json.dumps(record))

  def approved_result(self, **changes) -> tuple[list[str], dict, dict]:
    """Two commits saved and approved: (their SHAs, the agent's input, the saved result)."""
    shas = self.two_commits()
    data = self.input_for(shas, **changes)
    outcome = self.save(data)
    self.assertEqual(outcome.code, 0, outcome.err)
    result = self.saved_result()
    self.decide(result)
    return shas, data, result

  def snapshot(self) -> dict:
    """Everything a refused or dry-run command must leave alone."""
    files = {
      str(path.relative_to(self.app)): hashlib.sha256(path.read_bytes()).hexdigest()
      for path in sorted(self.app.rglob("*")) if path.is_file()
    }
    return {"files": files, "branch": self.remote_branch(), "writes": len(self.gh_writes())}

  def assertRefused(self, outcome: Outcome, code: int, fragment: str) -> None:
    self.assertEqual(outcome.code, code, outcome.err or outcome.out)
    self.assertIn(fragment, outcome.err)
    self.assertNotIn("Traceback", outcome.err)


# --- save ------------------------------------------------------------------------------------


class SaveTests(RespondWorld):
  def test_save_records_what_git_and_github_say_and_a_digest_the_app_can_recompute(self):
    shas = self.two_commits()
    data = self.input_for(shas)
    outcome = self.save(data)
    self.assertEqual(outcome.code, 0, outcome.err)
    result = self.saved_result()
    self.assertRegex(result["id"], r"^r-[0-9a-f]{12}$")
    self.assertIn(result["id"], outcome.out)
    self.assertIn("Open the PR in Contribute and press Post.", outcome.out)
    self.assertIn("3 points, 2 replies, 2 commits, 2 files", outcome.out)
    self.assertEqual(
      {key: result[key] for key in ("version", "repo", "number", "chat_id", "state", "error", "description", "rerequest", "tests")},
      {"version": 1, "repo": "owner/repo", "number": 7, "chat_id": "chat-under-test", "state": "ready", "error": None,
       "description": data["description"], "rerequest": ["alex"], "tests": data["tests"]},
    )
    self.assertRegex(result["created_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
    self.assertEqual(result["pr"], {"head_sha": self.base, "head_ref": HEAD_REF,
                                    "base_ref": "stack/example/01-base", "head_repo": "owner/repo"})
    self.assertEqual(result["tip_sha"], shas[1])
    self.assertEqual(result["commits"], [
      {"sha": shas[0], "title": "Public writes: a lost answer is unresolved"},
      {"sha": shas[1], "title": "Sync reads the live state again"},
    ])
    self.assertEqual([point["commit"] for point in result["points"]], [shas[0], shas[1], None])
    self.assertEqual(result["replies"], data["replies"])
    self.assertEqual(result["receipts"], {"push": None, "replies": [], "description": None, "rerequest": None})
    self.assertEqual(result["digest"], expected_digest(result))
    self.assertEqual(self.gh_writes(), [])
    self.assertFalse(self.decision_path.exists())

  def test_a_saved_result_has_the_keys_of_the_shared_fixture(self):
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    self.commit("Binary change", {"logo.png": b"\x00changed"})
    shas = self.two_commits()
    self.assertEqual(self.save(self.input_for(shas)).code, 0)
    saved = self.saved_result()
    self.assertEqual(set(saved), set(fixture))
    for key in ("pr", "receipts"):
      self.assertEqual(set(saved[key]), set(fixture[key]), key)
    for key in ("points", "replies", "commits"):
      self.assertEqual(set(saved[key][0]), set(fixture[key][0]), key)
    by_path = {entry["path"]: entry for entry in saved["files"]}
    self.assertEqual(set(by_path["app.js"]), set(fixture["files"][0]))
    self.assertEqual(set(by_path["logo.png"]), set(fixture["files"][2]))

  def test_save_lists_files_with_hunks_only_patches(self):
    shas = self.two_commits()
    self.save(self.input_for(shas))
    files = {entry["path"]: entry for entry in self.saved_result()["files"]}
    self.assertEqual(set(files), {"app.js", "new.js"})
    self.assertEqual((files["app.js"]["status"], files["app.js"]["added"], files["app.js"]["removed"]), ("modified", 2, 2))
    self.assertEqual((files["new.js"]["status"], files["new.js"]["added"], files["new.js"]["removed"]), ("added", 2, 0))
    self.assertEqual(files["new.js"]["patch"], "@@ -0,0 +1,2 @@\n+export const sync = () => {}\n+export default sync\n")
    for entry in files.values():
      self.assertTrue(entry["patch"].startswith("@@ "))
      for header in ("diff --git", "\nindex ", "\n--- ", "\n+++ "):
        self.assertNotIn(header, entry["patch"])
      self.assertNotIn("patch_omitted", entry)
      self.assertNotIn("binary", entry)

  def test_save_makes_a_bundle_of_exactly_the_new_commits_that_verifies(self):
    shas = self.two_commits()
    self.assertEqual(self.save(self.input_for(shas)).code, 0)
    result = self.saved_result()
    bundle = self.results / result["bundle"]
    self.assertEqual(result["bundle"], f"{result['id']}.bundle")
    verified = subprocess.run(["git", "-C", str(self.work), "bundle", "verify", str(bundle)], capture_output=True, text=True)
    self.assertEqual(verified.returncode, 0, verified.stderr)
    # Fetched into a repository that only has the PR head, the bundle brings the original commits.
    fresh = self.root / "fresh"
    self.git(self.root, "init", "-q", str(fresh))
    self.git(fresh, "fetch", "-q", str(self.remote), self.base)
    self.git(fresh, "fetch", "-q", str(bundle), "HEAD:refs/tip")
    self.assertEqual(self.git(fresh, "rev-parse", "refs/tip"), shas[1])
    self.assertEqual(self.git(fresh, "rev-list", "--reverse", f"{self.base}..refs/tip").split(), shas)

  def test_save_works_from_a_detached_head(self):
    shas = self.two_commits()
    self.git(self.work, "checkout", "-q", "--detach")
    self.assertEqual(self.save(self.input_for(shas)).code, 0)
    self.assertEqual(self.saved_result()["tip_sha"], shas[1])

  def test_save_titles_a_commit_by_its_first_line_not_its_first_paragraph(self):
    self.commit("Wrapped title that\ncontinues on a second line\n\nBody text", {"x.txt": "x\n"})
    self.assertEqual(self.save(self.replies_only()).code, 0)
    self.assertEqual(self.saved_result()["commits"][0]["title"], "Wrapped title that")

  def test_save_with_replies_only_has_no_commits_and_no_bundle(self):
    outcome = self.save(self.replies_only(description=None, rerequest=[]))
    self.assertEqual(outcome.code, 0, outcome.err)
    result = self.saved_result()
    self.assertEqual((result["tip_sha"], result["commits"], result["files"], result["bundle"]), (self.base, [], [], None))
    self.assertEqual(result["digest"], expected_digest(result))
    self.assertEqual(list(self.results.glob("*.bundle")), [])

  def test_save_refuses_when_there_is_nothing_to_show(self):
    self.assertRefused(self.save(self.replies_only(replies=[])), 2, "nothing to show")
    self.assertFalse(self.app.exists())

  def test_save_marks_binary_files_and_keeps_the_rename_of_a_renamed_file(self):
    self.git(self.work, "mv", "old_name.js", "renamed.js")
    (self.work / "renamed.js").write_text("".join(f"export const value{n} = {n}\n" for n in range(1, 10)) + "export const value10 = 11\n")
    self.commit("Rename and replace the logo", {"logo.png": b"\x89PNG\x00\x00binary-two", "icon.bin": b"\x00\x01\x02"})
    self.assertEqual(self.save(self.replies_only()).code, 0)
    files = {entry["path"]: entry for entry in self.saved_result()["files"]}
    self.assertEqual(files["logo.png"], {"path": "logo.png", "status": "modified", "added": 0, "removed": 0,
                                         "patch": None, "patch_omitted": True, "binary": True})
    self.assertEqual((files["icon.bin"]["status"], files["icon.bin"]["binary"], files["icon.bin"]["patch"]), ("added", True, None))
    renamed = files["renamed.js"]
    self.assertEqual((renamed["status"], renamed["previous_path"]), ("renamed", "old_name.js"))
    self.assertEqual((renamed["added"], renamed["removed"]), (1, 1))
    self.assertTrue(renamed["patch"].startswith("@@ "))
    self.assertIn("-export const value10 = 10\n+export const value10 = 11\n", renamed["patch"])
    self.assertNotIn("old_name.js", {path for path, entry in files.items() if entry["status"] != "renamed"})

  def test_save_keeps_a_file_name_with_spaces_unicode_and_glob_characters_exactly(self):
    names = ["docs/with space \u00e9\u2713.md", "glob*[1]?.txt"]  # a file name is a name, never a pattern
    self.commit("Awkward names", {name: "hello\n" for name in names})
    self.assertEqual(self.save(self.replies_only()).code, 0)
    files = {entry["path"]: entry for entry in self.saved_result()["files"]}
    self.assertEqual(set(files), set(names))
    for entry in files.values():
      self.assertEqual((entry["status"], entry["patch"]), ("added", "@@ -0,0 +1 @@\n+hello\n"))

  def test_save_leaves_out_a_patch_over_the_per_file_cap_instead_of_cutting_it(self):
    self.commit("One huge file and one small", {"huge.txt": "x" * 65_000 + "\n", "small.txt": "small\n"})
    self.assertEqual(self.save(self.replies_only()).code, 0)
    files = {entry["path"]: entry for entry in self.saved_result()["files"]}
    self.assertEqual((files["huge.txt"]["patch"], files["huge.txt"]["patch_omitted"]), (None, True))
    self.assertEqual((files["huge.txt"]["added"], files["huge.txt"]["removed"]), (1, 0))
    self.assertEqual(files["small.txt"]["patch"], "@@ -0,0 +1 @@\n+small\n")

  def test_save_stops_adding_patches_once_all_of_them_together_reach_the_cap(self):
    # Seven files of about 59,000 characters each fit one by one (cap 60,000) but not together (cap 400,000).
    self.commit("Seven big files", {f"big{n}.txt": f"{n}" * 59_000 + "\n" for n in range(1, 8)})
    self.assertEqual(self.save(self.replies_only()).code, 0)
    files = self.saved_result()["files"]
    included = [entry for entry in files if entry.get("patch")]
    omitted = [entry for entry in files if entry.get("patch_omitted")]
    self.assertEqual((len(included), len(omitted)), (6, 1))
    self.assertEqual(omitted[0]["path"], "big7.txt")
    self.assertLessEqual(sum(len(entry["patch"]) for entry in included), 400_000)
    self.assertTrue(all(len(entry["patch"]) <= 60_000 for entry in included))

  def test_save_refuses_more_commits_or_files_than_the_owner_can_review(self):
    for number in range(61):
      self.git(self.work, "commit", "-q", "--allow-empty", "-m", f"commit {number}")
    self.assertRefused(self.save(self.replies_only()), 2, "61 new commits; the limit is 60")
    self.git(self.work, "reset", "-q", "--hard", self.base)
    self.commit("Many files", {f"many/{n}.txt": "x\n" for n in range(301)})
    self.assertRefused(self.save(self.replies_only()), 2, "301 files changed; the limit is 300")
    self.assertFalse(self.app.exists())

  def test_save_refuses_a_pr_that_is_not_open(self):
    shas = self.two_commits()
    self.fake_pr(state="closed")
    self.assertRefused(self.save(self.input_for(shas)), 2, "is closed, not open")
    self.assertFalse(self.app.exists())

  def test_save_refuses_a_pr_that_is_not_the_one_named(self):
    shas = self.two_commits()
    for name, change, fragment in (
      ("GitHub reports another repository", {"reported_repo": "moved/repo"}, "GitHub says this is moved/repo#7, not owner/repo#7"),
      ("GitHub reports another number", {"reported_number": 8}, "GitHub says this is owner/repo#8, not owner/repo#7"),
    ):
      with self.subTest(name):
        self.fake_pr(**{"reported_repo": None, "reported_number": None, **change})
        self.assertRefused(self.save(self.input_for(shas)), 2, fragment)
    self.assertFalse(self.app.exists())

  def test_save_refuses_when_github_cannot_be_read(self):
    shas = self.two_commits()
    self.assertRefused(self.save(self.input_for(shas), pr="owner/other#9"), 2, "GitHub did not accept GET")
    self.assertFalse(self.app.exists())

  def test_save_stores_the_repository_as_github_spells_it_and_a_lower_case_slug(self):
    shas = self.two_commits()
    self.assertEqual(self.save(self.input_for(shas), pr="OWNER/Repo#7").code, 0)
    self.assertEqual(self.saved_result()["repo"], "owner/repo")
    self.assertEqual([path.name for path in self.results.glob("*.json")], [f"{SLUG}.json"])

  def test_save_refuses_uncommitted_and_untracked_changes(self):
    shas = self.two_commits()
    (self.work / "app.js").write_text("edited after the last commit\n")
    self.assertRefused(self.save(self.input_for(shas)), 2, "uncommitted changes (for example app.js)")
    self.git(self.work, "checkout", "--", "app.js")
    (self.work / "forgotten.js").write_text("never added\n")
    self.assertRefused(self.save(self.input_for(shas)), 2, "uncommitted changes (for example forgotten.js)")
    self.assertFalse(self.app.exists())

  def test_save_refuses_a_pr_head_on_another_line_of_history(self):
    self.git(self.work, "checkout", "-q", "-b", "side", "HEAD~1")  # from the root commit, before the PR head
    side = self.commit("A commit on another line of history", {"side.txt": "side\n"})
    self.git(self.work, "checkout", "-q", "main")
    shas = self.two_commits()
    self.fake_pr(head_sha=side)
    self.assertRefused(self.save(self.input_for(shas)), 2, "is not an ancestor of HEAD")
    self.assertFalse(self.app.exists())

  def test_save_refuses_a_pr_head_this_copy_has_never_seen(self):
    shas = self.two_commits()
    self.fake_pr(head_sha="e" * 40)  # somebody pushed to the PR since this copy was made
    self.assertRefused(self.save(self.input_for(shas)), 2, "eeeeeee is not an ancestor of HEAD")
    self.assertFalse(self.app.exists())

  def test_save_refuses_work_that_was_rebased_off_the_pr_head(self):
    self.git(self.work, "checkout", "-q", "-b", "rebased", self.base)
    self.git(self.work, "commit", "-q", "--amend", "-m", "The PR head, rewritten")
    self.commit("Work on the rewritten head", {"after.txt": "after\n"})
    self.assertRefused(self.save(self.replies_only()), 2, f"The PR head {self.base[:7]} is not an ancestor of HEAD")
    self.assertFalse(self.app.exists())

  def test_save_refuses_a_point_whose_commit_is_not_in_the_range(self):
    shas = self.two_commits()
    for name, prefix in (("no such commit", "abcdef0"), ("the PR head is not one of your commits", self.base[:10])):
      with self.subTest(name):
        data = self.input_for(shas)
        data["points"][0]["commit"] = prefix
        self.assertRefused(self.save(data), 2, f"points[1].commit {prefix} is not one of your commits")
    self.assertFalse(self.app.exists())

  def test_a_commit_prefix_may_be_written_in_capitals(self):
    shas = self.two_commits()
    data = self.input_for(shas)
    data["points"][0]["commit"] = shas[0][:9].upper()
    self.assertEqual(self.save(data).code, 0)
    self.assertEqual(self.saved_result()["points"][0]["commit"], shas[0])

  def test_a_commit_prefix_that_fits_two_commits_is_refused_as_ambiguous(self):
    commits = [{"sha": "abc1234" + "0" * 33, "title": "one"}, {"sha": "abc1234" + "1" * 33, "title": "two"}]
    with self.assertRaises(respond.BadInput) as raised:
      respond.resolve_commit("abc1234", commits, "points[2]")
    self.assertIn("matches more than one of your commits", str(raised.exception))
    self.assertEqual(respond.resolve_commit("abc12341", commits, "points[2]"), commits[1]["sha"])
    self.assertEqual(respond.resolve_commit(commits[0]["sha"], commits, "points[2]"), commits[0]["sha"])
    self.assertIsNone(respond.resolve_commit(None, commits, "points[2]"))

  def test_save_asks_nobody_to_review_their_own_pr(self):
    shas = self.two_commits()
    self.assertRefused(self.save(self.input_for(shas, rerequest=["alex", "Contributor"])), 2, "the PR's author")
    self.assertFalse(self.app.exists())

  def test_save_needs_to_know_the_chat_that_post_will_message(self):
    shas = self.two_commits()
    with mock.patch.dict(os.environ):
      os.environ.pop("CHAT_ID")
      self.assertRefused(self.save(self.input_for(shas)), 2, "Pass --chat-id")
      self.assertEqual(self.save(self.input_for(shas), extra=["--chat-id", "chat-from-flag"]).code, 0)
    self.assertEqual(self.saved_result()["chat_id"], "chat-from-flag")

  def test_save_accepts_only_a_strict_pr_reference(self):
    shas = self.two_commits()
    for reference in ("owner/repo", "owner/repo#0", "owner/repo#01", "owner/repo#7 ", "../repo#7", "owner/..#7",
                      "owner/a..b#7", "owner/.hidden#7", "owner/re po#7", "owner/repo/extra#7",
                      "owner/repo#12345678901", "own er/repo#7", "https://github.com/owner/repo/pull/7"):
      with self.subTest(reference):
        self.assertRefused(self.save(self.input_for(shas), pr=reference), 2, "--pr must look like owner/repo#123")
    for reference in ("-owner/repo#7", "owner/-repo#7", "_owner/repo#7"):
      with self.subTest(reference), self.assertRaises(respond.BadInput):
        respond.parse_pull(reference)
    self.assertEqual(respond.parse_pull("Owner/Repo.js#7").slug, "owner__repo.js__7")
    self.assertFalse(self.app.exists())

  def test_save_replaces_the_earlier_result_with_its_bundle_and_its_decision(self):
    shas, _, first = self.approved_result()
    first_bundle = self.results / first["bundle"]
    self.assertTrue(first_bundle.exists() and self.decision_path.exists())
    third = self.commit("A third commit", {"third.txt": "3\n"})
    self.assertEqual(self.save(self.input_for([shas[0], third], replies=[])).code, 0)
    second = self.saved_result()
    self.assertNotEqual(second["id"], first["id"])
    self.assertEqual(second["tip_sha"], third)
    self.assertFalse(first_bundle.exists(), "the old bundle goes")
    self.assertFalse(self.decision_path.exists(), "the old decision goes")
    self.assertEqual([path.name for path in self.results.glob("*.bundle")], [second["bundle"]])

  def test_save_is_refused_while_the_earlier_result_is_being_posted(self):
    _, data, first = self.approved_result()
    self.write_result({**first, "state": "posting"})
    before = self.snapshot()
    self.assertRefused(self.save(data), 3, "is being posted")
    self.assertEqual(self.snapshot(), before)

  def test_save_replaces_a_failed_or_posted_result_but_not_a_posting_one(self):
    _, data, first = self.approved_result()
    for state in ("failed", "posted"):
      with self.subTest(state):
        self.write_result({**self.saved_result(), "state": state})
        self.assertEqual(self.save(data).code, 0)
        self.assertEqual(self.saved_result()["state"], "ready")

  def test_save_is_refused_while_another_command_holds_the_pr(self):
    shas = self.two_commits()
    self.results.mkdir(parents=True)
    with open(self.lock_path, "a") as held:
      fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
      self.assertRefused(self.save(self.input_for(shas)), 3, "Another respond_result command is working on")
    self.assertFalse(self.result_path.exists())

  def test_save_never_prints_or_stores_the_github_token(self):
    shas = self.two_commits()
    outcome = self.save(self.input_for(shas))
    self.assertEqual(outcome.code, 0)
    self.assertNotIn(TOKEN, outcome.out + outcome.err + self.result_path.read_text())


INVALID_INPUT = [
  ("the input is a list", lambda d: [], "must be a JSON object"),
  ("a key is missing", lambda d: {k: v for k, v in d.items() if k != "tests"}, "missing tests"),
  ("an unknown key", lambda d: {**d, "approved": True}, "unknown keys: approved"),
  ("points is not a list", lambda d: {**d, "points": {}}, "points must be a list"),
  ("31 points", lambda d: {**d, "points": [d["points"][0]] * 31}, "points has 31 entries; the limit is 30"),
  ("a point is not an object", lambda d: {**d, "points": ["x"]}, "points[1] must be a JSON object"),
  ("a point lacks its answer", lambda d: {**d, "points": [{k: v for k, v in d["points"][0].items() if k != "answer"}]}, "points[1] is missing answer"),
  ("a point has an extra key", lambda d: {**d, "points": [{**d["points"][0], "extra": 1}]}, "points[1] has unknown keys: extra"),
  ("a title of 161 characters", lambda d: edit_point(d, title="t" * 161), "points[1].title has 161 characters; the limit is 160"),
  ("an answer of 401 characters", lambda d: edit_point(d, answer="a" * 401), "answer has 401 characters; the limit is 400"),
  ("a reviewer of 61 characters", lambda d: edit_point(d, reviewer="r" * 61), "reviewer has 61 characters; the limit is 60"),
  ("a blank title", lambda d: edit_point(d, title="   "), "points[1].title must not be empty"),
  ("an unknown ending", lambda d: edit_point(d, ending="done"), "ending must be one of fixed, not_valid, out_of_scope"),
  ("a commit of 6 characters", lambda d: edit_point(d, commit="abc123"), "at least 7 hex characters"),
  ("a commit that is not hex", lambda d: edit_point(d, commit="zzzzzzzz"), "at least 7 hex characters"),
  ("a commit that is a number", lambda d: edit_point(d, commit=1234567), "at least 7 hex characters"),
  ("a commit of 41 characters", lambda d: edit_point(d, commit="a" * 41), "at least 7 hex characters"),
  ("13 replies", lambda d: {**d, "replies": [d["replies"][0]] * 13}, "replies has 13 entries; the limit is 12"),
  ("a reply of 20,001 characters", lambda d: edit_reply(d, body="b" * 20_001), "body has 20001 characters; the limit is 20000"),
  ("an empty reply", lambda d: edit_reply(d, body=" \n"), "replies[1].body must not be empty"),
  ("a reply_to that is text", lambda d: edit_reply(d, reply_to="4242"), "reply_to must be null or a review-comment id"),
  ("a reply_to that is a fraction", lambda d: edit_reply(d, reply_to=1.5), "reply_to must be null or a review-comment id"),
  ("a reply_to that is true", lambda d: edit_reply(d, reply_to=True), "reply_to must be null or a review-comment id"),
  ("a reply_to of zero", lambda d: edit_reply(d, reply_to=0), "reply_to must be null or a review-comment id"),
  ("a reply_to beyond JavaScript's exact integers", lambda d: edit_reply(d, reply_to=2**53), "reply_to must be null or a review-comment id"),
  ("an empty description", lambda d: {**d, "description": ""}, "description must not be empty"),
  ("a description of 60,001 characters", lambda d: {**d, "description": "d" * 60_001}, "description has 60001 characters; the limit is 60000"),
  ("a description that is a number", lambda d: {**d, "description": 7}, "description must be text"),
  ("11 logins", lambda d: {**d, "rerequest": [f"user{n}" for n in range(11)]}, "rerequest has 11 entries; the limit is 10"),
  ("a login with a space", lambda d: {**d, "rerequest": ["bad login"]}, "rerequest[1] must be a GitHub login"),
  ("a login of 40 characters", lambda d: {**d, "rerequest": ["a" * 40]}, "rerequest[1] must be a GitHub login"),
  ("a login that is a number", lambda d: {**d, "rerequest": [7]}, "rerequest[1] must be a GitHub login"),
  ("rerequest is not a list", lambda d: {**d, "rerequest": "alex"}, "rerequest must be a list"),
  ("tests of 501 characters", lambda d: {**d, "tests": "t" * 501}, "tests has 501 characters; the limit is 500"),
  ("tests that is not text", lambda d: {**d, "tests": 803}, "tests must be text"),
  ("a lone surrogate in a title", lambda d: edit_point(d, title="bad \ud800 title"), "title contains a lone surrogate"),
  ("a lone surrogate in an answer", lambda d: edit_point(d, answer="bad \udfff"), "answer contains a lone surrogate"),
  ("a lone surrogate in a reviewer", lambda d: edit_point(d, reviewer="\ud83d"), "reviewer contains a lone surrogate"),
  ("a lone surrogate in a reply", lambda d: edit_reply(d, body="half an emoji \ud83d"), "body contains a lone surrogate"),
  ("a lone surrogate in the description", lambda d: {**d, "description": "x\ud800"}, "description contains a lone surrogate"),
  ("a lone surrogate in the tests", lambda d: {**d, "tests": "\udc00"}, "tests contains a lone surrogate"),
]


class SaveInputTests(RespondWorld):
  def test_every_rule_break_in_the_input_is_refused_and_nothing_is_written(self):
    shas = self.two_commits()
    for name, mutate, fragment in INVALID_INPUT:
      with self.subTest(name):
        outcome = self.save(mutate(self.input_for(shas)))
        self.assertRefused(outcome, 2, fragment)
        self.assertEqual(outcome.out, "")
    self.assertFalse(self.app.exists(), "a refused save leaves the storage folder untouched")

  def test_input_that_is_not_json_or_not_utf8_or_missing_is_refused(self):
    self.two_commits()
    self.assertRefused(self.save(raw="{not json"), 2, "is not valid UTF-8 JSON")
    self.assertRefused(self.save(raw=b'{"points": "\xff\xfe"}'), 2, "is not valid UTF-8 JSON")
    outcome = self.cli("save", "--pr", PULL, "--repo-path", self.work, "--input", self.root / "absent.json")
    self.assertRefused(outcome, 2, "does not exist")
    self.assertFalse(self.app.exists())

  def test_a_login_repeated_across_points_is_asked_once(self):
    shas = self.two_commits()
    self.assertEqual(self.save(self.input_for(shas, rerequest=["alex", "Alex", "sam"])).code, 0)
    self.assertEqual(self.saved_result()["rerequest"], ["alex", "sam"])

  def test_the_limits_themselves_are_accepted(self):
    shas = self.two_commits()
    data = self.input_for(
      shas,
      points=[{"reviewer": "r" * 60, "title": "t" * 160, "ending": "out_of_scope", "commit": None, "answer": "a" * 400}] * 30,
      replies=[{"body": "b" * 20_000, "reply_to": 2**53 - 1}] * 12,
      description="d" * 60_000, rerequest=[f"user{n}" for n in range(10)], tests="t" * 500,
    )
    outcome = self.save(data)
    self.assertEqual(outcome.code, 0, outcome.err)
    self.assertEqual(len(self.saved_result()["points"]), 30)


# --- the digest ---------------------------------------------------------------------------------


class DigestTests(unittest.TestCase):
  def test_the_shared_example_has_the_digest_the_algorithm_gives(self):
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    self.assertEqual(respond.compute_digest(fixture), fixture["digest"])
    self.assertEqual(expected_digest(fixture), fixture["digest"])

  def test_the_digest_binds_what_is_posted_and_nothing_else(self):
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    original = respond.compute_digest(fixture)
    bound = {
      "the pr head": lambda r: r["pr"].update(head_sha="c" * 40),
      "the tip": lambda r: r.update(tip_sha="c" * 40),
      "a point's text": lambda r: r["points"][0].update(answer="Changed."),
      "a point's ending": lambda r: r["points"][2].update(ending="out_of_scope"),
      "a point's commit": lambda r: r["points"][0].update(commit=None),
      "a reply's body": lambda r: r["replies"][0].update(body="Changed."),
      "a reply's target": lambda r: r["replies"][1].update(reply_to=None),
      "the reply order": lambda r: r["replies"].reverse(),
      "the description": lambda r: r.update(description=None),
      "the reviewers": lambda r: r.update(rerequest=["sam"]),
      "the commits": lambda r: r["commits"].pop(),
    }
    unbound = {
      "the tests line": lambda r: r.update(tests="1 pass"),
      "the files": lambda r: r["files"].clear(),
      "the receipts": lambda r: r["receipts"].update(push={"sha": "x", "at": "now"}),
      "the state": lambda r: r.update(state="posted"),
    }
    for name, change in bound.items():
      with self.subTest(f"{name} is bound"):
        copy = json.loads(json.dumps(fixture))
        change(copy)
        self.assertNotEqual(respond.compute_digest(copy), original)
    for name, change in unbound.items():
      with self.subTest(f"{name} is not bound"):
        copy = json.loads(json.dumps(fixture))
        change(copy)
        self.assertEqual(respond.compute_digest(copy), original)


# --- show -----------------------------------------------------------------------------------------


class ShowTests(RespondWorld):
  def test_show_prints_the_result_without_patches_and_whether_it_is_approved(self):
    shas = self.two_commits()
    self.save(self.input_for(shas))
    result = self.saved_result()
    outcome = self.cli("show", "--pr", PULL)
    self.assertEqual(outcome.code, 0, outcome.err)
    shown = json.loads(outcome.out)
    self.assertFalse(shown["approved"])
    self.assertEqual(shown["result"]["id"], result["id"])
    self.assertEqual(len(shown["result"]["files"]), 2)
    self.assertTrue(all("patch" not in entry for entry in shown["result"]["files"]))
    self.assertEqual(shown["result"]["replies"], result["replies"])
    self.decide(result)
    self.assertTrue(json.loads(self.cli("show", "--pr", PULL).out)["approved"])
    self.decide(result, decision="discarded")
    self.assertFalse(json.loads(self.cli("show", "--pr", PULL).out)["approved"])
    self.decide(result, digest="0" * 64)
    self.assertFalse(json.loads(self.cli("show", "--pr", PULL).out)["approved"], "another digest is not this result's approval")
    self.assertTrue(all("patch" in entry for entry in self.saved_result()["files"]), "show never edits the stored result")

  def test_show_without_a_saved_result_is_refused(self):
    self.assertRefused(self.cli("show", "--pr", PULL), 3, "No result is saved for owner/repo#7")


# --- post -----------------------------------------------------------------------------------------


class PostTests(RespondWorld):
  def test_post_publishes_exactly_what_was_shown_in_the_fixed_order(self):
    shas, data, result = self.approved_result()
    self.assertEqual(self.remote_branch(), self.base)
    outcome = self.post(result["id"])
    self.assertEqual(outcome.code, 0, outcome.err)
    self.assertEqual(self.remote_branch(), shas[1], "the branch head is the tip")
    self.assertEqual(self.git(self.remote, "rev-list", "--reverse", f"{self.base}..refs/heads/{HEAD_REF}").split(), shas,
                     "the commits keep their SHAs, which the replies quote")
    calls = self.gh_calls()
    self.assertFalse([call for call in calls if call.get("unexpected")])
    writes = self.gh_writes()
    self.assertEqual([(call["method"], call["path"]) for call in writes], [
      ("POST", "repos/owner/repo/issues/7/comments"),
      ("POST", "repos/owner/repo/pulls/7/comments/4242/replies"),
      ("PATCH", "repos/owner/repo/pulls/7"),
      ("POST", "repos/owner/repo/pulls/7/requested_reviewers"),
    ])
    for call in writes:
      self.assertEqual(call["argv"], ["api", "-X", call["method"], call["path"], "--input", "-"], "bodies travel on stdin")
    self.assertEqual([json.loads(call["body"]) for call in writes], [
      {"body": REPLY_WITH_AWKWARD_TEXT},
      {"body": "@sam the helper keeps its name."},
      {"body": data["description"]},
      {"reviewers": ["alex"]},
    ])
    ref_check = next(index for index, call in enumerate(calls) if "/git/ref/heads/" in call["path"])
    self.assertLess(ref_check, calls.index(writes[0]), "the push is confirmed on GitHub before the first reply")
    stored = self.saved_result()
    self.assertEqual((stored["state"], stored["error"]), ("posted", None))
    receipts = stored["receipts"]
    self.assertEqual(receipts["push"]["sha"], shas[1])
    self.assertEqual([(r["index"], r["url"]) for r in receipts["replies"]],
                     [(0, f"https://example.test/c/{writes[0]['attempt']}"), (1, f"https://example.test/c/{writes[1]['attempt']}")])
    self.assertEqual(receipts["rerequest"]["reviewers"], ["alex"])
    self.assertTrue(receipts["description"]["at"].endswith("Z"))
    self.assertIn(f"Done: result {result['id']} for {PULL} is posted.", outcome.out)
    self.assertNotIn(TOKEN, outcome.out + outcome.err + self.result_path.read_text())

  def test_post_saves_each_receipt_before_it_starts_the_next_step(self):
    _, _, result = self.approved_result()
    self.assertEqual(self.post(result["id"]).code, 0)
    watched = [call["watch"] for call in self.gh_writes()]
    self.assertEqual([w["state"] for w in watched], ["posting"] * 4)
    self.assertEqual([w["push"] for w in watched], [True] * 4, "the push receipt is on disk before the first reply")
    self.assertEqual([w["replies"] for w in watched], [[], [0], [0, 1], [0, 1]], "each reply's receipt is on disk before the next call")
    self.assertEqual([w["description"] for w in watched], [False, False, False, True])

  def test_post_with_only_replies_posts_without_pushing(self):
    self.assertEqual(self.save(self.replies_only(description=None, rerequest=[])).code, 0)
    result = self.saved_result()
    self.decide(result)
    with mock.patch.object(respond, "push_bundle") as push:
      outcome = self.post(result["id"])
    self.assertEqual(outcome.code, 0, outcome.err)
    push.assert_not_called()
    self.assertEqual([call["path"] for call in self.gh_writes()],
                     ["repos/owner/repo/issues/7/comments", "repos/owner/repo/pulls/7/comments/4242/replies"])
    self.assertEqual(self.saved_result()["state"], "posted")
    self.assertEqual(self.remote_branch(), self.base)

  def test_post_to_a_fork_confirms_the_branch_in_the_fork(self):
    self.fake_pr(head_repo="fork/repo")
    _, _, result = self.approved_result()
    self.assertEqual(result["pr"]["head_repo"], "fork/repo")
    self.assertEqual(self.post(result["id"]).code, 0)
    self.assertTrue(any(call["path"] == f"repos/fork/repo/git/ref/heads/{HEAD_REF}" for call in self.gh_calls()))

  def test_post_refuses_before_any_public_step_and_changes_nothing(self):
    _, _, result = self.approved_result()
    tampered = json.loads(json.dumps(result))
    tampered["replies"][0]["body"] = "Something the owner never read."
    wrong_branch = json.loads(json.dumps(result))
    wrong_branch["pr"]["head_ref"] = "main"
    wrong_repo = json.loads(json.dumps(result))
    wrong_repo["pr"]["head_repo"] = "elsewhere/repo"
    cases = [
      ("no decision at all", lambda: self.decision_path.unlink(), result["id"], "no decision is saved"),
      ("a decision about another result", lambda: self.decide(result, result_id="r-000000000000"), result["id"], "about a different result"),
      ("a decision approving another digest", lambda: self.decide(result, digest="0" * 64), result["id"], "approved different content"),
      ("a decision that discards", lambda: self.decide(result, decision="discarded"), result["id"], "discarded, not approved"),
      ("a decision that is superseded", lambda: self.decide(result, decision="superseded"), result["id"], "superseded, not approved"),
      ("a decision file that is not JSON", lambda: self.decision_path.write_text("{oops"), result["id"], "no decision is saved"),
      ("content changed after approval", lambda: self.write_result(tampered), result["id"], "no longer matches the digest"),
      ("a head branch changed in the file", lambda: self.write_result(wrong_branch), result["id"], "head branch is not the one"),
      ("a head repository changed in the file", lambda: self.write_result(wrong_repo), result["id"], "head branch is not the one"),
      ("another result id", lambda: None, "r-ffffffffffff", f"is {result['id']}, not r-ffffffffffff"),
      ("a closed PR", lambda: self.fake_pr(state="closed"), result["id"], "The PR is closed, not open"),
      ("a PR that moved", lambda: self.fake_pr(head_sha="c" * 40), result["id"], "The PR moved"),
      ("GitHub reporting another repository", lambda: self.fake_pr(reported_repo="moved/repo"), result["id"], "GitHub says this is moved/repo#7"),
    ]
    for name, arrange, result_id, fragment in cases:
      with self.subTest(name):
        self.write_result(result)
        self.decide(result)
        self.fake_pr(state="open", head_sha=None, reported_repo=None)
        arrange()
        before = self.snapshot()
        self.assertRefused(self.post(result_id), 3, fragment)
        self.assertEqual(self.snapshot(), before, "a refusal changes nothing, on disk or on GitHub")
        self.assertEqual(self.remote_branch(), self.base, "and nothing was pushed")

  def test_post_refuses_a_result_that_is_missing_or_damaged(self):
    self.assertRefused(self.post("r-000000000000"), 3, "No result is saved")
    self.assertFalse(self.app.exists(), "a refusal leaves no trace, not even a lock file")
    _, _, result = self.approved_result()
    damage = {
      "not JSON": lambda: self.result_path.write_text("{oops"),
      "another version": lambda: self.write_result({**result, "version": 2}),
      "no receipts": lambda: self.write_result({k: v for k, v in result.items() if k != "receipts"}),
      "a malformed commit id": lambda: self.write_result({**result, "tip_sha": "--upload-pack=x"}),
      "another PR's result": lambda: self.write_result({**result, "number": 8}),
    }
    for name, break_it in damage.items():
      with self.subTest(name):
        break_it()
        self.assertRefused(self.post(result["id"]), 3, "The saved result")
    self.assertEqual(self.gh_writes(), [])

  def test_post_without_its_bundle_refuses_instead_of_failing_half_way(self):
    _, _, result = self.approved_result()
    (self.results / result["bundle"]).unlink()
    self.assertRefused(self.post(result["id"]), 3, "the bundle file) are missing")
    self.assertEqual((self.gh_writes(), self.remote_branch(), self.saved_result()["state"]), ([], self.base, "ready"))

  def test_post_pushes_nothing_when_the_bundle_does_not_end_at_the_approved_tip(self):
    _, _, result = self.approved_result()
    self.commit("A change the owner never saw", {"unseen.txt": "unseen\n"})
    bundle = self.results / result["bundle"]
    bundle.unlink()
    self.git(self.work, "bundle", "create", "-q", str(bundle), "HEAD", f"^{self.base}")
    outcome = self.post(result["id"])
    self.assertRefused(outcome, 4, "does not end at the approved tip")
    self.assertEqual((self.remote_branch(), self.gh_writes()), (self.base, []))
    self.assertEqual(self.saved_result()["state"], "failed")

  def test_post_pushes_nothing_when_the_approved_commit_list_is_not_what_the_bundle_holds(self):
    _, _, result = self.approved_result()
    forged = json.loads(json.dumps(result))
    forged["commits"] = forged["commits"][1:]  # an approval that matches the file, but not the bundle
    forged["digest"] = respond.compute_digest(forged)
    self.write_result(forged)
    self.decide(forged)
    outcome = self.post(forged["id"])
    self.assertRefused(outcome, 4, "does not hold exactly the approved commits")
    self.assertEqual((self.remote_branch(), self.gh_writes()), (self.base, []))

  def test_post_dry_run_prints_the_plan_and_changes_nothing(self):
    _, _, result = self.approved_result()
    before = self.snapshot()
    outcome = self.post(result["id"], "--dry-run")
    self.assertEqual(outcome.code, 0, outcome.err)
    for line in ("1. push 2 commits (tip", "2. post reply 1 of 2 as a PR comment", "3. post reply 2 of 2 as a reply in review thread 4242",
                 "4. replace the PR description", "5. ask alex for a new review", "Nothing was changed."):
      self.assertIn(line, outcome.out)
    self.assertEqual(self.snapshot(), before)
    self.assertEqual(self.saved_result()["state"], "ready")
    self.decision_path.unlink()
    self.assertRefused(self.post(result["id"], "--dry-run"), 3, "no decision is saved")

  def check_a_moved_branch_is_never_overwritten(self, rewrite: bool) -> None:
    _, _, result = self.approved_result()
    self.fake_pr(head_sha=self.base)  # GitHub still reported the old head when the checks ran
    moved = self.advance_remote(rewrite=rewrite)
    outcome = self.post(result["id"])
    self.assertRefused(outcome, 4, "Post stopped at the push step")
    stored = self.saved_result()
    self.assertEqual((stored["state"], stored["error"]["step"]), ("failed", "push"))
    self.assertRegex(stored["error"]["message"], "rejected|fetch first|non-fast-forward")
    self.assertEqual(stored["receipts"], {"push": None, "replies": [], "description": None, "rerequest": None})
    self.assertEqual(self.remote_branch(), moved, "the other person's work is untouched: nothing was forced")
    self.assertEqual(self.gh_writes(), [], "nothing was said on the PR about a push that did not happen")

  def test_post_never_forces_so_a_branch_that_gained_a_commit_is_left_as_it_is(self):
    self.check_a_moved_branch_is_never_overwritten(rewrite=False)

  def test_post_never_forces_so_a_branch_whose_head_was_rewritten_is_left_as_it_is(self):
    self.check_a_moved_branch_is_never_overwritten(rewrite=True)

  def test_post_resumes_after_a_failure_and_repeats_no_step(self):
    shas, _, result = self.approved_result()
    self.fake(fail_at=2)  # the second write, reply 2, fails once
    with mock.patch.object(respond, "push_bundle", wraps=respond.push_bundle) as push:
      first = self.post(result["id"])
      self.assertRefused(first, 4, "Post stopped at the replies step: reply 2 of 2")
      stopped = self.saved_result()
      self.assertEqual((stopped["state"], stopped["error"]["step"]), ("failed", "replies"))
      self.assertIn("reply 2 of 2", stopped["error"]["message"])
      self.assertIn("HTTP 500", stopped["error"]["message"])
      self.assertEqual(stopped["receipts"]["push"]["sha"], shas[1])
      self.assertEqual([r["index"] for r in stopped["receipts"]["replies"]], [0])
      second = self.post(result["id"])
    self.assertEqual(second.code, 0, second.err)
    self.assertIn("Resuming an earlier post", second.out)
    self.assertEqual(push.call_count, 1, "the push is never repeated")
    done = self.saved_result()
    self.assertEqual((done["state"], done["error"]), ("posted", None))
    self.assertEqual(done["receipts"]["push"], stopped["receipts"]["push"])
    self.assertEqual(done["receipts"]["replies"][0], stopped["receipts"]["replies"][0], "reply 1 keeps its first receipt")
    self.assertEqual([(call["path"], call["ok"]) for call in self.gh_writes()], [
      ("repos/owner/repo/issues/7/comments", True),
      ("repos/owner/repo/pulls/7/comments/4242/replies", False),
      ("repos/owner/repo/pulls/7/comments/4242/replies", True),
      ("repos/owner/repo/pulls/7", True),
      ("repos/owner/repo/pulls/7/requested_reviewers", True),
    ])

  def test_post_failing_at_the_description_keeps_the_replies_and_finishes_later(self):
    _, _, result = self.approved_result()
    self.fake(fail_at=3)
    self.assertRefused(self.post(result["id"]), 4, "Post stopped at the description step")
    stopped = self.saved_result()
    self.assertEqual(stopped["error"]["step"], "description")
    self.assertEqual([r["index"] for r in stopped["receipts"]["replies"]], [0, 1])
    self.assertEqual(self.post(result["id"]).code, 0)
    self.assertEqual([call["path"] for call in self.gh_writes() if call["ok"]], [
      "repos/owner/repo/issues/7/comments", "repos/owner/repo/pulls/7/comments/4242/replies",
      "repos/owner/repo/pulls/7", "repos/owner/repo/pulls/7/requested_reviewers",
    ])

  def test_post_finishes_after_a_push_whose_confirmation_was_lost(self):
    shas, _, result = self.approved_result()
    self.fake(ref_sha="d" * 40)  # GitHub's answer after the push disagrees (or never came)
    self.assertRefused(self.post(result["id"]), 4, "Post stopped at the push step")
    self.assertIsNone(self.saved_result()["receipts"]["push"], "an unconfirmed push has no receipt")
    self.assertEqual(self.remote_branch(), shas[1], "yet the branch did move")
    self.fake(ref_sha=None)
    outcome = self.post(result["id"])  # GitHub's head is now the tip: the push is found done and recorded
    self.assertEqual(outcome.code, 0, outcome.err)
    self.assertEqual(self.saved_result()["receipts"]["push"]["sha"], shas[1])
    self.assertEqual(len(self.gh_writes()), 4)
    self.assertEqual(self.saved_result()["state"], "posted")

  def test_after_the_push_is_receipted_the_pr_head_must_be_the_tip(self):
    shas, _, result = self.approved_result()
    self.fake(fail_at=1)
    self.assertRefused(self.post(result["id"]), 4, "reply 1 of 2")
    self.assertEqual(self.remote_branch(), shas[1])
    for name, head in (("the old head again", self.base), ("somebody else's commit", "c" * 40)):
      with self.subTest(name):
        self.fake_pr(head_sha=head)
        writes = len(self.gh_writes())
        self.assertRefused(self.post(result["id"]), 3, "The PR moved")
        self.assertEqual(len(self.gh_writes()), writes)

  def test_post_on_a_posted_result_says_so_and_calls_nothing(self):
    _, _, result = self.approved_result()
    self.assertEqual(self.post(result["id"]).code, 0)
    calls, before = len(self.gh_calls()), self.snapshot()
    for extra in ((), ("--dry-run",)):
      outcome = self.post(result["id"], *extra)
      self.assertEqual(outcome.code, 0, outcome.err)
      self.assertIn("is already posted; nothing to do", outcome.out)
    self.assertEqual(len(self.gh_calls()), calls, "not even a read from GitHub")
    self.assertEqual(self.snapshot(), before)

  def test_post_is_refused_while_another_command_holds_the_pr(self):
    _, _, result = self.approved_result()
    before = self.snapshot()
    with open(self.lock_path, "a") as held:
      fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
      self.assertRefused(self.post(result["id"]), 3, "Another respond_result command is working on")
    self.assertEqual(self.snapshot(), before)
    self.assertEqual(self.post(result["id"]).code, 0, "once the other command is done the lock is free")

  def test_post_reports_a_failure_without_credentials_in_it(self):
    _, _, result = self.approved_result()
    leaky = "fatal: unable to access 'https://x-access-token:SECRET123@github.com/owner/repo.git/': 403"
    with mock.patch.object(respond, "push_bundle", side_effect=respond.CommandError(respond.scrub(leaky))):
      outcome = self.post(result["id"])
    self.assertRefused(outcome, 4, "Post stopped at the push step")
    self.assertNotIn("SECRET123", outcome.err + self.result_path.read_text())

  def test_an_unexpected_error_in_a_step_is_recorded_as_a_failure_not_left_as_posting(self):
    _, _, result = self.approved_result()
    with mock.patch.object(respond, "confirm_branch_head", side_effect=RuntimeError("boom")):
      outcome = self.post(result["id"])
    self.assertRefused(outcome, 4, "unexpected RuntimeError: boom")
    self.assertEqual(self.saved_result()["state"], "failed")


class ProgramTests(RespondWorld):
  def run_script(self, *argv: str) -> subprocess.CompletedProcess:
    # From another folder, as the chat runs it: the script must find its sibling modules itself.
    return subprocess.run([sys.executable, str(ROOT / "respond_result.py"), *argv],
                          cwd=self.root, capture_output=True, text=True)

  def test_the_script_runs_as_a_program_and_exits_with_the_documented_codes(self):
    refused = self.run_script("show", "--pr", PULL)
    self.assertEqual((refused.returncode, refused.stdout), (3, ""))
    self.assertIn("respond_result: No result is saved for owner/repo#7.", refused.stderr)
    self.assertNotIn("Traceback", refused.stderr)
    usage = self.run_script("post", "--pr", PULL)
    self.assertEqual(usage.returncode, 2)
    invalid = self.run_script("show", "--pr", "not a pull request")
    self.assertEqual(invalid.returncode, 2)
    self.assertIn("--pr must look like owner/repo#123", invalid.stderr)
    shas = self.two_commits()
    (self.root / "input.json").write_text(json.dumps(self.input_for(shas)))
    saved = self.run_script("save", "--pr", PULL, "--repo-path", str(self.work), "--input", str(self.root / "input.json"))
    self.assertEqual(saved.returncode, 0, saved.stderr)
    self.assertIn("Open the PR in Contribute and press Post.", saved.stdout)
    shown = self.run_script("show", "--pr", PULL)
    self.assertEqual((shown.returncode, json.loads(shown.stdout)["approved"]), (0, False))
    self.assertIn("--dry-run", self.run_script("post", "--help").stdout)


class PlumbingTests(unittest.TestCase):
  def test_scrub_hides_credentials_in_urls_and_keeps_one_short_line(self):
    text = respond.scrub("fatal: could not read 'https://user:secret-abc@github.com/o/r.git'\nremote: denied\n" + "x" * 1000)
    self.assertNotIn("secret-abc", text)
    self.assertIn("https://***@github.com/o/r.git", text)
    self.assertNotIn("\n", text)
    self.assertLessEqual(len(text), 400)
    self.assertEqual(respond.scrub(b"   "), "no details")

  def test_the_git_url_is_the_head_repository_on_github_unless_a_test_replaces_it(self):
    with mock.patch.dict(os.environ):
      os.environ.pop("RESPOND_GIT_REMOTE", None)
      self.assertEqual(respond.git_remote("fork/repo"), "https://github.com/fork/repo.git")
      os.environ["RESPOND_GIT_REMOTE"] = "/tmp/some-remote.git"
      self.assertEqual(respond.git_remote("fork/repo"), "/tmp/some-remote.git")

  def test_the_app_directory_comes_from_the_environment_or_the_contribute_install(self):
    with mock.patch.dict(os.environ, {"RESPOND_APP_DIR": "/somewhere/else"}):
      self.assertEqual(respond.open_store().root, Path("/somewhere/else"))
    with mock.patch.dict(os.environ):
      os.environ.pop("RESPOND_APP_DIR", None)
      with mock.patch.object(respond, "find_ledger", return_value=Path("/data/apps/42/contributions")):
        self.assertEqual(respond.open_store().root, Path("/data/apps/42"))

  def test_files_are_written_through_a_temporary_file_then_renamed(self):
    with tempfile.TemporaryDirectory() as raw:
      target = Path(raw) / "nested" / "result.json"
      respond.write_json_atomic(target, {"name": "caf\u00e9"})
      self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"name": "caf\u00e9"})
      self.assertEqual([path.name for path in target.parent.iterdir()], ["result.json"], "no temporary file is left")
      with mock.patch.object(respond.os, "replace", side_effect=OSError("disk full")), self.assertRaises(OSError):
        respond.write_json_atomic(target, {"name": "new"})
      self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"name": "caf\u00e9"}, "the old file survives")
      self.assertEqual([path.name for path in target.parent.iterdir()], ["result.json"])

  def test_a_usage_error_exits_with_the_bad_input_code(self):
    with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
      respond.main(["post", "--pr", PULL])
    self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
  unittest.main()
