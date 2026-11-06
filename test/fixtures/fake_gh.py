#!/usr/bin/env python3
"""A fake `gh api`: logs every call and answers from FAKE_GH_CONFIG. Shared by test_respond_result.py and respond-contract.test.mjs."""
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote

CONFIG = os.environ["FAKE_GH_CONFIG"]
with open(CONFIG, encoding="utf-8") as handle:
  config = json.load(handle)

argv = sys.argv[1:]
method, path, wants_input = "GET", None, False
position = 1
while position < len(argv):
  if argv[position] == "-X":
    method = argv[position + 1]
    position += 2
  elif argv[position] == "--input":
    wants_input = argv[position + 1] == "-"
    position += 2
  else:
    path = argv[position]
    position += 1
body = sys.stdin.buffer.read().decode("utf-8") if wants_input else None


def save_config():
  with open(CONFIG, "w", encoding="utf-8") as handle:
    json.dump(config, handle)


def watch():
  """What the saved result says right now, so tests can see state and receipts at each write."""
  try:
    with open(config["watch"], encoding="utf-8") as handle:
      saved = json.load(handle)
  except (OSError, ValueError):
    return None
  receipts = saved["receipts"]
  return {
    "state": saved["state"],
    "push": bool(receipts["push"]),
    "replies": [item["index"] for item in receipts["replies"]],
    "description": bool(receipts["description"]),
  }


def finish(entry, payload=None, error=None):
  entry.update(argv=argv, method=method, path=path, body=body)
  with open(config["log"], "a", encoding="utf-8") as log:
    log.write(json.dumps(entry) + "\n")
  if error:
    sys.stderr.write(error + "\n")
    sys.exit(1)
  sys.stdout.write(json.dumps(payload))
  sys.exit(0)


def remote_branch(name):
  done = subprocess.run(
    ["git", "--git-dir", config["remote"], "rev-parse", "--verify", "-q", "refs/heads/" + name],
    capture_output=True, text=True,
  )
  return done.stdout.strip() or None


pr = config["pr"]
# GitHub answers a repository path in any letter case, and may report the PR under another name.
pull_path = f"repos/{pr['repo']}/pulls/{pr['number']}".lower()
ref_prefix = f"repos/{pr['head_repo']}/git/ref/heads/"
lowered = (path or "").lower()

if method == "GET" and lowered == pull_path:
  head = pr["head_sha"] or remote_branch(pr["head_ref"])
  finish({"ok": True}, {
    "number": pr.get("reported_number") or pr["number"],
    "state": pr["state"],
    "user": {"login": pr["author"]},
    "head": {"sha": head, "ref": pr["head_ref"], "repo": {"full_name": pr["head_repo"]}},
    "base": {"ref": pr["base_ref"], "repo": {"full_name": pr.get("reported_repo") or pr["repo"]}},
  })

if method == "GET" and path is not None and path.startswith(ref_prefix):
  name = unquote(path[len(ref_prefix):])
  sha = config["ref_sha"] or remote_branch(name)
  if sha is None:
    finish({"ok": False}, error="gh: Not Found (HTTP 404)")
  finish({"ok": True}, {"ref": "refs/heads/" + name, "object": {"type": "commit", "sha": sha}})

WRITES = [
  ("POST", re.compile(re.escape(pull_path.replace("/pulls/", "/issues/")) + "/comments")),
  ("POST", re.compile(re.escape(pull_path) + "/comments/[0-9]+/replies")),
  ("PATCH", re.compile(re.escape(pull_path))),
  ("POST", re.compile(re.escape(pull_path) + "/requested_reviewers")),
]
if any(m == method and route.fullmatch(lowered) for m, route in WRITES):
  config["writes"] += 1
  entry = {"ok": True, "attempt": config["writes"], "watch": watch()}
  if config["fail_at"] == config["writes"]:
    config["fail_at"] = None  # a failure injected once: the next attempt succeeds
    save_config()
    entry["ok"] = False
    finish(entry, error="gh: Server Error (HTTP 500)")
  save_config()
  finish(entry, {"html_url": f"https://example.test/c/{config['writes']}"})

finish({"ok": False, "unexpected": True}, error="gh: Not Found (HTTP 404)")
