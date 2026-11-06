#!/usr/bin/env python3
"""Save, show and post one Respond-to-feedback result (the contract is respond-result.md).

An agent answering a PR's review feedback never publishes anything itself. `save`
records the finished work for the owner to read in Contribute; `post` is the only
command with public effects, and it re-checks the owner's approval and the PR first.
"""

from __future__ import annotations

import argparse
import contextlib
from dataclasses import dataclass
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import sys
import tempfile
from typing import Any, Iterator
from urllib.parse import quote

from agent_snapshot import find_ledger


EXIT_BAD_INPUT = 2  # nothing was written
EXIT_REFUSED = 3  # a check failed before any public step
EXIT_FAILED = 4  # `post` stopped part-way; its receipts keep what was done

RESULT_VERSION = 1
GH_TIMEOUT = 60
GIT_TIMEOUT = 300

# The caps of respond-result.md ("The result"), counted in characters.
MAX_POINTS = 30
MAX_TITLE = 160
MAX_ANSWER = 400
MAX_REVIEWER = 60
MAX_REPLIES = 12
MAX_REPLY = 20_000
MAX_DESCRIPTION = 60_000
MAX_LOGINS = 10
MAX_TESTS = 500
MAX_COMMITS = 60
MAX_FILES = 300
MAX_FILE_PATCH = 60_000
MAX_ALL_PATCHES = 400_000
# The app reads these numbers in JavaScript, where larger integers lose precision.
MAX_SAFE_INTEGER = 2**53 - 1

INPUT_KEYS = ("points", "replies", "description", "rerequest", "tests")
POINT_KEYS = ("reviewer", "title", "ending", "commit", "answer")
REPLY_KEYS = ("body", "reply_to")
ENDINGS = ("fixed", "not_valid", "out_of_scope")
STATES = ("ready", "posting", "posted", "failed")
RECEIPT_KEYS = ("push", "replies", "description", "rerequest")
STATUS_NAMES = {
  "A": "added", "C": "added", "D": "removed", "M": "modified", "R": "renamed", "T": "modified",
}

PULL_REFERENCE = re.compile(r"([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})#([1-9][0-9]{0,9})")
SLUG_NAME = re.compile(r"[a-z0-9][a-z0-9_.-]*")
RESULT_ID = re.compile(r"r-[0-9a-f]{12}")
FULL_SHA = re.compile(r"[0-9a-f]{40}")
COMMIT_PREFIX = re.compile(r"[0-9a-f]{7,40}")
LOGIN = re.compile(r"[A-Za-z0-9-]{1,39}")
CHAT_ID = re.compile(r"[A-Za-z0-9_-]{1,100}")


class Stop(Exception):
  """Ends the command with an exit status and one sentence for whoever ran it."""

  code = EXIT_BAD_INPUT


class BadInput(Stop):
  code = EXIT_BAD_INPUT


class Refused(Stop):
  code = EXIT_REFUSED


class PostFailed(Stop):
  code = EXIT_FAILED


class CommandError(Exception):
  """A `gh` or `git` call failed. The message is safe to print: no credentials, one line."""


# --- running programs -------------------------------------------------------------------


def scrub(raw: bytes | str, limit: int = 400) -> str:
  """One printable line from a program's output, with any credential inside a URL hidden."""
  text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
  text = re.sub(r"(://)[^/@\s]+@", r"\1***@", text)
  return " ".join(text.split())[:limit] or "no details"


def run(
  command: list[str], stdin: bytes | None = None, timeout: int = GH_TIMEOUT,
) -> subprocess.CompletedProcess[bytes]:
  """Run one program, never through a shell. A missing program or a timeout is a CommandError."""
  env = {
    **os.environ,
    "GIT_TERMINAL_PROMPT": "0",  # fail instead of waiting for a password nobody can type
    "GIT_LITERAL_PATHSPECS": "1",  # a changed file's name is a name, never a glob
    "GIT_OPTIONAL_LOCKS": "0",  # `git status` in the agent's copy must not touch its index
  }
  feed = {"input": stdin} if stdin is not None else {"stdin": subprocess.DEVNULL}
  try:
    return subprocess.run(command, capture_output=True, timeout=timeout, env=env, **feed)
  except subprocess.TimeoutExpired as error:
    raise CommandError(f"{command[0]} did not finish within {timeout} seconds") from error
  except OSError as error:
    raise CommandError(f"could not run {command[0]} ({error.strerror or error})") from error


def git(repo: Path, *args: str, timeout: int = GIT_TIMEOUT) -> str:
  done = run(["git", "-C", str(repo), *args], timeout=timeout)
  if done.returncode != 0:
    raise CommandError(f"git {args[0]} failed: {scrub(done.stderr)}")
  return done.stdout.decode("utf-8", "replace")


def gh_api(path: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
  """The one door to GitHub. A body travels on standard input, so any text reaches GitHub
  exactly as stored, whatever quotes, newlines or Unicode it holds."""
  command = ["gh", "api", path]
  if method != "GET":
    command = ["gh", "api", "-X", method, path, "--input", "-"]
  stdin = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
  done = run(command, stdin=stdin)
  if done.returncode != 0:
    raise CommandError(f"GitHub did not accept {method} {path}: {scrub(done.stderr or done.stdout)}")
  text = done.stdout.decode("utf-8", "replace").strip()
  if not text:
    return None
  try:
    return json.loads(text)
  except ValueError as error:
    raise CommandError(f"GitHub's answer to {method} {path} was not JSON") from error


def utc_now() -> str:
  return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def counted(number: int, noun: str, plural: str | None = None) -> str:
  return f"{number} {noun if number == 1 else plural or noun + 's'}"


# --- which PR, and where its files live -------------------------------------------------


@dataclass(frozen=True)
class PullRef:
  repo: str
  number: int

  @property
  def slug(self) -> str:
    owner, name = self.repo.lower().split("/")
    return f"{owner}__{name}__{self.number}"

  def __str__(self) -> str:
    return f"{self.repo}#{self.number}"


def parse_pull(reference: str) -> PullRef:
  match = PULL_REFERENCE.fullmatch(reference)
  names = match.groups()[:2] if match else ()
  if not names or any(".." in name or not SLUG_NAME.fullmatch(name.lower()) for name in names):
    raise BadInput("--pr must look like owner/repo#123 (letters, digits, '.', '_' and '-', no '..').")
  return PullRef(f"{match[1]}/{match[2]}", int(match[3]))


@dataclass(frozen=True)
class Store:
  """Where the app keeps results, bundles and decisions (respond-result.md, "Where things live")."""

  root: Path

  def result_file(self, pull: PullRef) -> Path:
    return self.root / "respond-results" / f"{pull.slug}.json"

  def lock_file(self, pull: PullRef) -> Path:
    return self.root / "respond-results" / f"{pull.slug}.lock"

  def bundle_file(self, result_id: str) -> Path:
    return self.root / "respond-results" / f"{result_id}.bundle"

  def decision_file(self, pull: PullRef) -> Path:
    return self.root / "respond-decisions" / f"{pull.slug}.json"


def open_store() -> Store:
  override = os.environ.get("RESPOND_APP_DIR")
  if override:
    return Store(Path(override).absolute())
  try:
    return Store(find_ledger().parent)
  except (OSError, RuntimeError, sqlite3.Error) as error:
    raise BadInput(f"Cannot find the Contribute app's storage ({scrub(str(error), 120)}).") from error


@contextlib.contextmanager
def locked(store: Store, pull: PullRef) -> Iterator[None]:
  """One respond_result command at a time per PR, so a second `post` can never repeat a step.
  The lock belongs to the process, so a crashed run leaves nothing behind to clear."""
  path = store.lock_file(pull)
  path.parent.mkdir(parents=True, exist_ok=True)
  with open(path, "a") as handle:
    try:
      fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
      raise Refused(f"Another respond_result command is working on {pull}; wait for it to finish.") from error
    yield


def read_json(path: Path) -> Any:
  """The parsed file, or None when it does not exist. Raises ValueError when it is not JSON."""
  try:
    return json.loads(path.read_text(encoding="utf-8"))
  except FileNotFoundError:
    return None


def write_json_atomic(path: Path, value: Any) -> None:
  """Temporary file, then rename: a reader never sees half a file, and a crash keeps the old one."""
  path.parent.mkdir(parents=True, exist_ok=True)
  data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
  temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
  try:
    with open(temporary, "xb") as handle:
      handle.write(data)
      handle.flush()
      os.fsync(handle.fileno())
    os.replace(temporary, path)
  except BaseException:
    temporary.unlink(missing_ok=True)
    raise


# --- the digest, shared with the app ----------------------------------------------------


def compute_digest(result: dict[str, Any]) -> str:
  """Binds what the owner read to what gets posted (respond-result.md, "digest"). The app never computes it:
  it passes the stored value into the owner's approval, and `post` recomputes it from the file before it acts."""
  content = {
    "v": RESULT_VERSION,
    "pr_head": result["pr"]["head_sha"],
    "tip": result["tip_sha"],
    "points": [{key: point[key] for key in POINT_KEYS} for point in result["points"]],
    "replies": [{key: reply[key] for key in REPLY_KEYS} for reply in result["replies"]],
    "description": result["description"],
    "rerequest": result["rerequest"],
    "commits": [commit["sha"] for commit in result["commits"]],
  }
  text = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
  return hashlib.sha256(text.encode("utf-8")).hexdigest()


def recomputed_digest(result: dict[str, Any]) -> str | None:
  """The digest of what the file holds now, or None when it is too damaged to compute."""
  try:
    return compute_digest(result)
  except (KeyError, TypeError, UnicodeEncodeError):
    return None


# --- checking what the agent hands in ---------------------------------------------------


def text_field(value: Any, label: str, limit: int, blank: bool = False) -> str:
  if not isinstance(value, str):
    raise BadInput(f"{label} must be text.")
  if len(value) > limit:
    raise BadInput(f"{label} has {len(value)} characters; the limit is {limit}.")
  try:
    value.encode("utf-8")
  except UnicodeEncodeError:
    raise BadInput(f"{label} contains a lone surrogate, which is not valid Unicode text.") from None
  if not blank and not value.strip():
    raise BadInput(f"{label} must not be empty.")
  return value


def object_field(value: Any, label: str, keys: tuple[str, ...]) -> dict[str, Any]:
  if not isinstance(value, dict):
    raise BadInput(f"{label} must be a JSON object with {', '.join(keys)}.")
  missing = [key for key in keys if key not in value]
  unknown = [key for key in value if key not in keys]
  if missing:
    raise BadInput(f"{label} is missing {', '.join(missing)}.")
  if unknown:
    raise BadInput(f"{label} has unknown keys: {', '.join(unknown)}.")
  return value


def list_field(value: Any, label: str, limit: int) -> list[Any]:
  if not isinstance(value, list):
    raise BadInput(f"{label} must be a list.")
  if len(value) > limit:
    raise BadInput(f"{label} has {len(value)} entries; the limit is {limit}.")
  return value


def point_entry(value: Any, label: str) -> dict[str, Any]:
  point = object_field(value, label, POINT_KEYS)
  if point["ending"] not in ENDINGS:
    raise BadInput(f"{label}.ending must be one of {', '.join(ENDINGS)}.")
  commit = point["commit"]
  if commit is not None and not (isinstance(commit, str) and COMMIT_PREFIX.fullmatch(commit.lower())):
    raise BadInput(f"{label}.commit must be null or at least 7 hex characters of one of your commits.")
  return {
    "reviewer": text_field(point["reviewer"], f"{label}.reviewer", MAX_REVIEWER),
    "title": text_field(point["title"], f"{label}.title", MAX_TITLE),
    "ending": point["ending"],
    "commit": commit.lower() if commit else None,
    "answer": text_field(point["answer"], f"{label}.answer", MAX_ANSWER),
  }


def reply_entry(value: Any, label: str) -> dict[str, Any]:
  reply = object_field(value, label, REPLY_KEYS)
  target = reply["reply_to"]
  # `type(...) is int` keeps True/False out: JSON booleans are not comment ids.
  if target is not None and not (type(target) is int and 1 <= target <= MAX_SAFE_INTEGER):
    raise BadInput(f"{label}.reply_to must be null or a review-comment id (a whole number, at least 1).")
  return {"body": text_field(reply["body"], f"{label}.body", MAX_REPLY), "reply_to": target}


def logins_field(value: Any) -> list[str]:
  logins: list[str] = []
  for number, login in enumerate(list_field(value, "rerequest", MAX_LOGINS), 1):
    if not (isinstance(login, str) and LOGIN.fullmatch(login)):
      raise BadInput(f"rerequest[{number}] must be a GitHub login (letters, digits and '-', up to 39).")
    # Reviewers repeat across points; GitHub logins ignore case, and the list is sent once.
    if login.lower() not in {seen.lower() for seen in logins}:
      logins.append(login)
  return logins


def parse_input(path: Path) -> dict[str, Any]:
  """The agent's own part of a result, checked against every rule and cap of the contract."""
  try:
    raw = json.loads(path.read_text(encoding="utf-8"))
  except FileNotFoundError as error:
    raise BadInput(f"The input file {path} does not exist.") from error
  except (ValueError, RecursionError) as error:
    raise BadInput(f"The input file {path} is not valid UTF-8 JSON ({scrub(str(error), 120)}).") from error
  top = object_field(raw, "The input", INPUT_KEYS)
  points = list_field(top["points"], "points", MAX_POINTS)
  replies = list_field(top["replies"], "replies", MAX_REPLIES)
  description = top["description"]
  return {
    "points": [point_entry(item, f"points[{n}]") for n, item in enumerate(points, 1)],
    "replies": [reply_entry(item, f"replies[{n}]") for n, item in enumerate(replies, 1)],
    "description": None if description is None else text_field(description, "description", MAX_DESCRIPTION),
    "rerequest": logins_field(top["rerequest"]),
    "tests": text_field(top["tests"], "tests", MAX_TESTS, blank=True),
  }


def require_chat_id(option: str | None) -> str:
  chat_id = (option or os.environ.get("CHAT_ID") or "").strip()
  if not CHAT_ID.fullmatch(chat_id):
    raise BadInput("Pass --chat-id (or set CHAT_ID): Post must know which chat to message.")
  return chat_id


def resolve_commit(prefix: str | None, commits: list[dict[str, str]], label: str) -> str | None:
  """A point's commit as a full SHA: the prefix must match exactly one commit of the range."""
  if prefix is None:
    return None
  matches = [commit["sha"] for commit in commits if commit["sha"].startswith(prefix)]
  if not matches:
    raise BadInput(f"{label}.commit {prefix} is not one of your commits on top of the PR head.")
  if len(matches) > 1:
    raise BadInput(f"{label}.commit {prefix} matches more than one of your commits; give more characters.")
  return matches[0]


# --- reading the PR and the agent's copy ------------------------------------------------


def read_pull(pull: PullRef) -> dict[str, Any]:
  """The PR's identity, state and head as GitHub shows them now."""
  data = gh_api(f"repos/{pull.repo}/pulls/{pull.number}")
  try:
    facts = {
      "repo": data["base"]["repo"]["full_name"],
      "number": data["number"],
      "state": data["state"],
      "head_sha": data["head"]["sha"],
      "head_ref": data["head"]["ref"],
      "head_repo": data["head"]["repo"]["full_name"],
      "base_ref": data["base"]["ref"],
      "author": (data.get("user") or {}).get("login") or "",
    }
  except (KeyError, TypeError, AttributeError) as error:
    raise CommandError("GitHub's answer for the PR lacks its repositories, branches or head") from error
  if str(facts["repo"]).lower() != pull.repo.lower() or facts["number"] != pull.number:
    raise CommandError(f"GitHub says this is {facts['repo']}#{facts['number']}, not {pull}")
  if not (isinstance(facts["head_sha"], str) and FULL_SHA.fullmatch(facts["head_sha"])):
    raise CommandError("GitHub's answer for the PR has no usable head commit")
  return facts


@dataclass(frozen=True)
class Work:
  """What Git says about the agent's copy, on top of the PR head."""

  tip: str
  commits: list[dict[str, str]]
  files: list[dict[str, Any]]


def require_clean(repo: Path) -> None:
  # Untracked files count: a new file the agent forgot to `git add` would pass its tests
  # locally and then be missing from the commits that get pushed.
  status = git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
  if status:
    raise BadInput(f"--repo-path has uncommitted changes (for example {status[0][3:]}); commit or remove them.")


def require_on_top(repo: Path, pr_head: str) -> None:
  done = run(["git", "-C", str(repo), "merge-base", "--is-ancestor", pr_head, "HEAD"], timeout=GIT_TIMEOUT)
  if done.returncode != 0:
    raise BadInput(f"The PR head {pr_head[:7]} is not an ancestor of HEAD: build on top of it and never rebase.")


def list_commits(repo: Path, pr_head: str) -> list[dict[str, str]]:
  """Oldest first. The title is the message's first line (git's %s would join a wrapped first paragraph)."""
  output = git(repo, "log", "-z", "--reverse", "--topo-order", "--format=%H%n%B", f"{pr_head}..HEAD")
  commits = []
  for record in filter(None, output.split("\0")):
    sha, _, message = record.lstrip("\n").partition("\n")
    commits.append({"sha": sha, "title": message.split("\n", 1)[0].strip()})
  if len(commits) > MAX_COMMITS:
    raise BadInput(f"There are {len(commits)} new commits; the limit is {MAX_COMMITS}. Split the work.")
  return commits


def parse_numstat(output: str) -> dict[str, tuple[int | None, int | None]]:
  """Lines added and removed per new path; (None, None) marks a binary file."""
  counts, entries = {}, iter(output.split("\0"))
  for entry in entries:
    if not entry:
      continue
    added, removed, path = entry.split("\t", 2)
    if not path:  # a rename: the next two entries are the old and the new path
      next(entries)
      path = next(entries)
    counts[path] = (None if added == "-" else int(added), None if removed == "-" else int(removed))
  return counts


def parse_name_status(output: str) -> list[tuple[str, str, str | None]]:
  """(status letter, path, previous path) for each changed file."""
  changes, entries = [], iter(output.split("\0"))
  for code in entries:
    if not code:
      continue
    if code[0] in "RC":
      previous = next(entries)
      changes.append((code[0], next(entries), previous))
    else:
      changes.append((code[0], next(entries), None))
  return changes


def file_patch(repo: Path, pr_head: str, paths: list[str]) -> str:
  """The hunks only, from the first `@@`: the format of GitHub's REST `patch`."""
  text = git(repo, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", pr_head, "HEAD", "--", *paths)
  start = text.find("\n@@")  # header lines never start with "@@", so this is the first hunk
  return text[start + 1:] if start >= 0 else ""


def add_patches(repo: Path, pr_head: str, files: list[dict[str, Any]]) -> None:
  """A patch over a cap is left out whole, never cut: the owner must not read half a change."""
  used = 0
  for entry in files:
    if entry.get("binary"):
      continue
    paths = [entry["path"], entry["previous_path"]] if "previous_path" in entry else [entry["path"]]
    patch = file_patch(repo, pr_head, paths)
    if len(patch) > MAX_FILE_PATCH or used + len(patch) > MAX_ALL_PATCHES:
      entry.update(patch=None, patch_omitted=True)
    else:
      entry["patch"] = patch
      used += len(patch)


def changed_files(repo: Path, pr_head: str) -> list[dict[str, Any]]:
  counts = parse_numstat(git(repo, "diff", "--numstat", "-z", "-M", pr_head, "HEAD"))
  files = []
  for letter, path, previous in parse_name_status(git(repo, "diff", "--name-status", "-z", "-M", pr_head, "HEAD")):
    added, removed = counts.get(path, (0, 0))
    entry: dict[str, Any] = {"path": path, "status": STATUS_NAMES.get(letter, "modified")}
    if letter == "R":
      entry["previous_path"] = previous
    entry.update(added=added or 0, removed=removed or 0)
    if added is None:
      entry.update(patch=None, patch_omitted=True, binary=True)
    files.append(entry)
  if len(files) > MAX_FILES:
    raise BadInput(f"{len(files)} files changed; the limit is {MAX_FILES}. Split the work.")
  add_patches(repo, pr_head, files)
  return files


def inspect_work(repo: Path, pr_head: str) -> Work:
  require_clean(repo)
  tip = git(repo, "rev-parse", "--verify", "HEAD^{commit}").strip()
  require_on_top(repo, pr_head)
  commits = list_commits(repo, pr_head)
  return Work(tip, commits, changed_files(repo, pr_head) if commits else [])


def create_bundle(repo: Path, bundle: Path, pr_head: str, tip: str) -> None:
  """The commits as a Git bundle: `post` pushes these very objects, so their SHAs never change."""
  try:
    git(repo, "bundle", "create", "-q", str(bundle), "HEAD", f"^{pr_head}")
    if f"{tip} HEAD" not in git(repo, "bundle", "list-heads", str(bundle)).splitlines():
      raise CommandError("the bundle does not end at HEAD")
  except CommandError:
    bundle.unlink(missing_ok=True)
    raise


# --- save --------------------------------------------------------------------------------


def build_result(
  pull: PullRef, chat_id: str, proposal: dict[str, Any], facts: dict[str, Any], work: Work,
) -> dict[str, Any]:
  result_id = f"r-{secrets.token_hex(6)}"
  result: dict[str, Any] = {
    "version": RESULT_VERSION,
    "id": result_id,
    "repo": facts["repo"],
    "number": pull.number,
    "chat_id": chat_id,
    "created_at": utc_now(),
    "state": "ready",
    "pr": {
      "head_sha": facts["head_sha"], "head_ref": facts["head_ref"],
      "base_ref": facts["base_ref"], "head_repo": facts["head_repo"],
    },
    "tip_sha": work.tip,
    "points": [
      {**point, "commit": resolve_commit(point["commit"], work.commits, f"points[{number}]")}
      for number, point in enumerate(proposal["points"], 1)
    ],
    "replies": proposal["replies"],
    "description": proposal["description"],
    "rerequest": proposal["rerequest"],
    "tests": proposal["tests"],
    "commits": work.commits,
    "files": work.files,
    "bundle": f"{result_id}.bundle" if work.commits else None,
    "digest": None,
    "receipts": {"push": None, "replies": [], "description": None, "rerequest": None},
    "error": None,
  }
  result["digest"] = compute_digest(result)
  return result


def store_result(store: Store, pull: PullRef, result: dict[str, Any], repo: Path) -> None:
  """Replace the PR's saved result. The new file is the commit point: the old bundle and the
  old decision go only after it, and a decision never approves a result it does not name."""
  with locked(store, pull):
    try:
      previous = read_json(store.result_file(pull))
    except ValueError:
      previous = None  # an unreadable file cannot be mid-post: no process holds the lock
    if isinstance(previous, dict) and previous.get("state") == "posting":
      raise Refused(f"The earlier result for {pull} is being posted; save again once it has finished.")
    bundle = store.bundle_file(result["id"])
    if result["bundle"]:
      create_bundle(repo, bundle, result["pr"]["head_sha"], result["tip_sha"])
    try:
      write_json_atomic(store.result_file(pull), result)
    except BaseException:
      bundle.unlink(missing_ok=True)
      raise
    previous_id = previous.get("id") if isinstance(previous, dict) else None
    if isinstance(previous_id, str) and RESULT_ID.fullmatch(previous_id):
      store.bundle_file(previous_id).unlink(missing_ok=True)
    store.decision_file(pull).unlink(missing_ok=True)


def save_summary(result: dict[str, Any]) -> str:
  omitted = sum(1 for entry in result["files"] if entry.get("patch_omitted"))
  counts = [
    counted(len(result["points"]), "point"), counted(len(result["replies"]), "reply", "replies"),
    counted(len(result["commits"]), "commit"), counted(len(result["files"]), "file"),
  ]
  extras = [
    "the description will be replaced" if result["description"] is not None else "",
    f"a new review will be asked of {', '.join(result['rerequest'])}" if result["rerequest"] else "",
    f"{counted(omitted, 'patch', 'patches')} left out (binary or over a cap)" if omitted else "",
  ]
  return "\n".join([
    f"Saved result {result['id']} for {result['repo']}#{result['number']}. Nothing was posted.",
    ", ".join(counts) + "".join(f"; {extra}" for extra in extras if extra) + ".",
    "Open the PR in Contribute and press Post.",
  ])


def save_command(args: argparse.Namespace) -> int:
  pull = parse_pull(args.pr)
  chat_id = require_chat_id(args.chat_id)
  proposal = parse_input(args.input)
  store = open_store()
  try:
    facts = read_pull(pull)
    if facts["state"] != "open":
      raise BadInput(f"{pull} is {facts['state']}, not open, so there is nothing to respond to.")
    if facts["author"].lower() in (login.lower() for login in proposal["rerequest"]):
      raise BadInput(f"rerequest includes {facts['author']}, the PR's author, whom GitHub cannot ask to review it.")
    work = inspect_work(args.repo_path, facts["head_sha"])
    if not work.commits and not proposal["replies"]:
      raise BadInput("There is nothing to show: no new commits and no replies.")
    result = build_result(pull, chat_id, proposal, facts, work)
    store_result(store, pull, result, args.repo_path)
  except CommandError as error:
    raise BadInput(str(error)) from error
  print(save_summary(result))
  return 0


# --- show ---------------------------------------------------------------------------------


def shape_problem(result: Any, pull: PullRef) -> str | None:
  """What makes a stored result unfit to act on. The digest separately guards its content."""
  if not isinstance(result, dict) or result.get("version") != RESULT_VERSION:
    return "it is not a version 1 result"
  pr, receipts = result.get("pr"), result.get("receipts")
  if not (isinstance(result.get("id"), str) and RESULT_ID.fullmatch(result["id"])):
    return "its id is malformed"
  if result.get("state") not in STATES or not isinstance(result.get("digest"), str):
    return "its state or digest is missing"
  if str(result.get("repo")).lower() != pull.repo.lower() or result.get("number") != pull.number:
    return "it belongs to another pull request"
  if not (isinstance(pr, dict) and isinstance(pr.get("head_ref"), str) and isinstance(pr.get("head_repo"), str)):
    return "its pull request details are missing"
  if not all(isinstance(sha, str) and FULL_SHA.fullmatch(sha) for sha in (pr.get("head_sha"), result.get("tip_sha"))):
    return "a commit id is malformed"
  if not (isinstance(receipts, dict) and all(key in receipts for key in RECEIPT_KEYS)
          and isinstance(receipts["replies"], list)):
    return "its receipts are missing"
  return None


def load_result(store: Store, pull: PullRef) -> dict[str, Any]:
  try:
    result = read_json(store.result_file(pull))
  except ValueError as error:
    raise Refused(f"The saved result for {pull} cannot be read ({scrub(str(error), 120)}).") from error
  if result is None:
    raise Refused(f"No result is saved for {pull}.")
  problem = shape_problem(result, pull)
  if problem:
    raise Refused(f"The saved result for {pull} is not usable: {problem}.")
  return result


def read_decision(store: Store, pull: PullRef) -> dict[str, Any] | None:
  try:
    decision = read_json(store.decision_file(pull))
  except ValueError:
    return None
  return decision if isinstance(decision, dict) else None


def approval_problem(result: dict[str, Any], decision: dict[str, Any] | None) -> str | None:
  """Why the owner's decision does not approve exactly this result, or None when it does."""
  if decision is None:
    return "The owner has not approved this result: no decision is saved for the PR."
  if decision.get("result_id") != result["id"]:
    return "The saved decision is about a different result, so this one is not approved."
  if decision.get("digest") != result["digest"]:
    return "The saved decision approved different content (its digest differs), so this result is not approved."
  if decision.get("decision") != "approved":
    return f"The owner's decision for this result is {scrub(str(decision.get('decision')), 30)}, not approved."
  return None


def show_command(args: argparse.Namespace) -> int:
  pull = parse_pull(args.pr)
  store = open_store()
  result = load_result(store, pull)
  decision = read_decision(store, pull)
  shown = {**result, "files": [{k: v for k, v in entry.items() if k != "patch"} for entry in result["files"]]}
  report = {"approved": approval_problem(result, decision) is None, "decision": decision, "result": shown}
  print(json.dumps(report, indent=2, ensure_ascii=False))
  return 0


# --- post ---------------------------------------------------------------------------------


def require_same_pull(result: dict[str, Any], facts: dict[str, Any]) -> None:
  pr = result["pr"]
  if facts["state"] != "open":
    raise Refused(f"The PR is {facts['state']}, not open, so nothing was posted.")
  # Once the push is receipted, GitHub's head is the tip; before that it is still the head the
  # work was built on, or the tip when a finished push lost its receipt (the push step then
  # finds nothing left to send and only records it).
  allowed = {result["tip_sha"]} if result["receipts"]["push"] else {pr["head_sha"], result["tip_sha"]}
  if facts["head_sha"] not in allowed:
    raise Refused(
      f"The PR moved: GitHub's head is {facts['head_sha'][:7]} but this result was built on "
      f"{pr['head_sha'][:7]}, so nothing was posted. Ask for another Respond pass."
    )
  if facts["head_ref"] != pr["head_ref"] or str(facts["head_repo"]).lower() != pr["head_repo"].lower():
    raise Refused("The PR's head branch is not the one this result was built on, so nothing was posted.")


def require_postable(store: Store, pull: PullRef, result: dict[str, Any]) -> None:
  """Steps 2 to 4 of the contract: the approval, the digest, then the PR on GitHub."""
  problem = approval_problem(result, read_decision(store, pull))
  if problem:
    raise Refused(problem)
  if recomputed_digest(result) != result["digest"]:
    raise Refused("The saved result no longer matches the digest the owner approved, so nothing was posted.")
  try:
    facts = read_pull(pull)
  except CommandError as error:
    raise Refused(f"Could not confirm the PR on GitHub ({error}), so nothing was posted.") from error
  require_same_pull(result, facts)
  needs_bundle = result["commits"] and not result["receipts"]["push"]
  if needs_bundle and not store.bundle_file(result["id"]).is_file():
    raise Refused("The saved commits (the bundle file) are missing, so nothing was posted.")


def git_remote(head_repo: str) -> str:
  return os.environ.get("RESPOND_GIT_REMOTE") or f"https://github.com/{head_repo}.git"


def push_bundle(bundle: Path, remote: str, pr: dict[str, Any], tip: str, commits: list[str]) -> None:
  """Fast-forward the PR branch to `tip` with the saved objects, so every commit keeps its SHA
  (the replies quote them). Never forced: a branch that has moved is rejected by Git."""
  with tempfile.TemporaryDirectory(prefix="respond-push-") as scratch:
    work = Path(scratch)
    git(work, "init", "-q")
    # By SHA, not by branch: if the branch has moved on, its old head is still fetchable and
    # the push below is what rejects it, with Git's own explanation. With its history, not
    # shallow: a result that merged in the base needs commits older than the PR head.
    git(work, "fetch", "-q", remote, pr["head_sha"])
    git(work, "fetch", "-q", str(bundle), "HEAD:refs/respond/tip")
    if git(work, "rev-parse", "--verify", "refs/respond/tip^{commit}").strip() != tip:
      raise CommandError("the saved bundle does not end at the approved tip, so nothing was pushed")
    pushed = git(work, "rev-list", "--reverse", "--topo-order", f"{pr['head_sha']}..{tip}").split()
    if pushed != commits:
      raise CommandError("the saved bundle does not hold exactly the approved commits, so nothing was pushed")
    git(work, "push", "-q", remote, f"refs/respond/tip:refs/heads/{pr['head_ref']}")


def confirm_branch_head(head_repo: str, head_ref: str, tip: str) -> None:
  ref = gh_api(f"repos/{head_repo}/git/ref/heads/{quote(head_ref, safe='/')}")
  try:
    actual = ref["object"]["sha"]
  except (KeyError, TypeError):
    actual = None
  if actual != tip:
    raise CommandError(f"after the push GitHub shows {head_ref} at {str(actual)[:7]}, not at {tip[:7]}")


def done_note(finished: Any) -> str:
  return " (already done)" if finished else ""


@dataclass
class Posting:
  """Step 6 of the contract: each step runs only when it has no receipt, and writes its receipt
  at once, so a second run carries on where the first stopped and repeats nothing."""

  store: Store
  pull: PullRef
  result: dict[str, Any]

  def persist(self) -> None:
    write_json_atomic(self.store.result_file(self.pull), self.result)

  def push(self) -> None:
    result = self.result
    pr, tip, commits = result["pr"], result["tip_sha"], [commit["sha"] for commit in result["commits"]]
    if not commits or result["receipts"]["push"]:
      return
    remote = git_remote(pr["head_repo"])
    push_bundle(self.store.bundle_file(result["id"]), remote, pr, tip, commits)
    confirm_branch_head(pr["head_repo"], pr["head_ref"], tip)
    result["receipts"]["push"] = {"sha": tip, "at": utc_now()}
    self.persist()
    print(f"Pushed {counted(len(commits), 'commit')} to {pr['head_repo']}:{pr['head_ref']} (tip {tip[:7]}).")

  def post_replies(self) -> None:
    repo, number, replies = self.result["repo"], self.result["number"], self.result["replies"]
    receipts = self.result["receipts"]["replies"]
    posted = {receipt["index"] for receipt in receipts}
    for index, reply in enumerate(replies):
      if index in posted:
        continue
      path = (f"repos/{repo}/issues/{number}/comments" if reply["reply_to"] is None
              else f"repos/{repo}/pulls/{number}/comments/{reply['reply_to']}/replies")
      try:
        response = gh_api(path, "POST", {"body": reply["body"]})
      except CommandError as error:
        raise CommandError(f"reply {index + 1} of {len(replies)}: {error}") from error
      url = response.get("html_url") if isinstance(response, dict) else None
      receipts.append({"index": index, "url": url if isinstance(url, str) else "", "at": utc_now()})
      self.persist()
      print(f"Posted reply {index + 1} of {len(replies)}: {url or 'no link returned'}")

  def update_description(self) -> None:
    result = self.result
    if result["description"] is None or result["receipts"]["description"]:
      return
    gh_api(f"repos/{result['repo']}/pulls/{result['number']}", "PATCH", {"body": result["description"]})
    result["receipts"]["description"] = {"at": utc_now()}
    self.persist()
    print("Updated the PR description.")

  def request_review(self) -> None:
    result = self.result
    if not result["rerequest"] or result["receipts"]["rerequest"]:
      return
    reviewers = list(result["rerequest"])
    gh_api(f"repos/{result['repo']}/pulls/{result['number']}/requested_reviewers", "POST", {"reviewers": reviewers})
    result["receipts"]["rerequest"] = {"at": utc_now(), "reviewers": reviewers}
    self.persist()
    print(f"Asked {', '.join(reviewers)} for a new review.")

  def fail(self, step: str, error: Exception) -> PostFailed:
    message = str(error) if isinstance(error, CommandError) else f"unexpected {type(error).__name__}: {error}"
    self.result["state"] = "failed"
    self.result["error"] = {"step": step, "message": message}
    self.persist()
    return PostFailed(
      f"Post stopped at the {step} step: {message.rstrip('. ')}. "
      "What was done is saved; run the same command again to continue."
    )

  def run(self) -> None:
    if any(self.result["receipts"][key] for key in RECEIPT_KEYS):
      print("Resuming an earlier post: the steps already done are skipped.")
    self.result["state"], self.result["error"] = "posting", None
    self.persist()
    steps = (("push", self.push), ("replies", self.post_replies),
             ("description", self.update_description), ("rerequest", self.request_review))
    for name, step in steps:
      try:
        step()
      except Exception as error:
        raise self.fail(name, error) from error
    self.result["state"] = "posted"
    self.persist()
    print(f"Done: result {self.result['id']} for {self.pull} is posted.")


def plan_lines(result: dict[str, Any]) -> list[str]:
  pr, receipts, replies = result["pr"], result["receipts"], result["replies"]
  lines = []
  if result["commits"]:
    lines.append(
      f"push {counted(len(result['commits']), 'commit')} (tip {result['tip_sha'][:7]}) "
      f"to {pr['head_repo']}:{pr['head_ref']}{done_note(receipts['push'])}"
    )
  done = {receipt["index"] for receipt in receipts["replies"]}
  for index, reply in enumerate(replies):
    where = "a PR comment" if reply["reply_to"] is None else f"a reply in review thread {reply['reply_to']}"
    lines.append(f"post reply {index + 1} of {len(replies)} as {where}{done_note(index in done)}")
  if result["description"] is not None:
    lines.append(f"replace the PR description{done_note(receipts['description'])}")
  if result["rerequest"]:
    lines.append(f"ask {', '.join(result['rerequest'])} for a new review{done_note(receipts['rerequest'])}")
  return lines


def print_plan(pull: PullRef, result: dict[str, Any]) -> None:
  print(f"Dry run: result {result['id']} for {pull} is approved and the PR is unchanged. Nothing was changed.")
  print("Post would, in this order:")
  for number, line in enumerate(plan_lines(result), 1):
    print(f"  {number}. {line}")


def post_command(args: argparse.Namespace) -> int:
  pull = parse_pull(args.pr)
  store = open_store()
  # A dry run, or a PR with nothing saved, must leave no trace: not even a lock file.
  needs_lock = not args.dry_run and store.result_file(pull).exists()
  with locked(store, pull) if needs_lock else contextlib.nullcontext():
    result = load_result(store, pull)
    if result["id"] != args.id:
      raise Refused(f"The result saved for {pull} is {result['id']}, not {args.id}; it was replaced or the id is wrong.")
    if result["state"] == "posted":
      print(f"Result {result['id']} for {pull} is already posted; nothing to do.")
      return 0
    require_postable(store, pull, result)
    if args.dry_run:
      print_plan(pull, result)
    else:
      Posting(store, pull, result).run()
  return 0


# --- command line -------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  commands = parser.add_subparsers(dest="command", required=True)
  save = commands.add_parser("save", help="record the finished work for the owner to approve")
  save.add_argument("--pr", required=True, help="owner/repo#123")
  save.add_argument("--repo-path", required=True, type=Path, help="your private copy, with the work committed")
  save.add_argument("--input", required=True, type=Path, help="JSON file: points, replies, description, rerequest, tests")
  save.add_argument("--chat-id", help="the chat Post messages (default: $CHAT_ID)")
  save.set_defaults(run=save_command)
  show = commands.add_parser("show", help="print the saved result without patches, and whether it is approved")
  show.add_argument("--pr", required=True, help="owner/repo#123")
  show.set_defaults(run=show_command)
  post = commands.add_parser("post", help="publish the approved result: the only command that does")
  post.add_argument("--pr", required=True, help="owner/repo#123")
  post.add_argument("--id", required=True, help="the result id Contribute named")
  post.add_argument("--dry-run", action="store_true", help="check everything and print the plan, change nothing")
  post.set_defaults(run=post_command)
  return parser


def main(argv: list[str] | None = None) -> int:
  args = build_parser().parse_args(argv)
  try:
    return args.run(args)
  except Stop as stop:
    print(f"respond_result: {stop}", file=sys.stderr)
    return stop.code
  except OSError as error:
    print(f"respond_result: a file operation failed ({scrub(str(error), 200)}).", file=sys.stderr)
    if args.command == "post":
      print("If a step was under way, check the PR on GitHub before running post again.", file=sys.stderr)
    return EXIT_FAILED if args.command == "post" else EXIT_BAD_INPUT


if __name__ == "__main__":
  for stream in (sys.stdout, sys.stderr):
    stream.reconfigure(errors="replace")  # a name the terminal cannot show must not crash a finished command
  raise SystemExit(main())
