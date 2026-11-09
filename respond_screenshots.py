"""Screenshots a Respond-to-feedback result adds to the PR description (respond-result.md, "Screenshots").

GitHub has no API for description attachments, so each image is hosted on a `mobius-screenshots`
branch of the PR's head repository and linked from the description by its commit-pinned address.
The owner reads the images in Contribute and approves them with the text: `save` stores the exact
bytes beside the result and lists `{name, sha256, size, alt}`, which the digest covers. `post`
uploads those bytes, proves GitHub serves them publicly, and only then rewrites each
`(screenshot:NAME)` in the description. The rules (name, size, one image per reference, the branch
holding nothing but screenshots) are the ones the platform applies to a new PR's screenshots
(`contribution_screenshots.py`), so an image accepted there is accepted here. They are repeated
because an app cannot import the platform.
"""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
import re
import stat
import time
import urllib.error
import urllib.request
from typing import Any, Callable
from urllib.parse import quote

NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,60}\.png")
MAX_SCREENSHOTS = 8
MAX_BYTES = 2 * 1024 * 1024
MAX_ALT = 200
ASSETS_BRANCH = "mobius-screenshots"
ASSETS_DIR = "screenshots"
RAW_HOST = "raw.githubusercontent.com"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
SHA256 = re.compile(r"[0-9a-f]{64}")
# A link or image target `](screenshot:NAME)` outside code, so a description that shows the syntax in
# backticks is neither checked nor rewritten.
REFERENCE = re.compile(r"\]\(screenshot:([^)\s]*)\)")
# CommonMark code: a fenced block (backticks or tildes) or an inline span.
CODE = re.compile(
  r"^[ ]{0,3}(?P<tick>`{3,})[^`\n]*(?=\n|\Z).*?(?:\n[ ]{0,3}(?P=tick)`*[ \t]*(?=\n|\Z)|\Z)"
  r"|^[ ]{0,3}(?P<tilde>~{3,})[^\n]*.*?(?:\n[ ]{0,3}(?P=tilde)~*[ \t]*(?=\n|\Z)|\Z)"
  r"|(?<!`)(?P<span>`+)(?!`)(?:(?!\n[ \t]*\n).)*?(?<!`)(?P=span)(?!`)",
  re.M | re.S,
)
PROOF_ATTEMPTS = 6  # raw.githubusercontent.com serves a new commit within seconds, not always at once
PROOF_BACKOFF = 1.0

GhApi = Callable[..., Any]
PublicReader = Callable[[str], "bytes | None"]


class ScreenshotError(Exception):
  """A screenshot rule was broken, or an upload could not be proved. The message is safe to print."""


def outside_code(body: str, rewrite: Callable[[str], str]) -> str:
  parts, start = [], 0
  for code in CODE.finditer(body):
    parts += [rewrite(body[start:code.start()]), code.group()]
    start = code.end()
  return "".join([*parts, rewrite(body[start:])])


def references(body: str) -> list[str]:
  found: list[str] = []

  def collect(text: str) -> str:
    found.extend(REFERENCE.findall(text))
    return text

  outside_code(body or "", collect)
  return found


def check_references(names: list[str], description: str | None) -> None:
  """Every image must be shown in the description, and every reference must name an image: the owner
  never approves an image that is not shown, or a link `post` cannot fill."""
  referenced = references(description or "")
  unknown = sorted(set(referenced) - set(names))
  if unknown:
    raise ScreenshotError("The description refers to screenshots that were not attached: " + ", ".join(unknown) + ".")
  unused = sorted(set(names) - set(referenced))
  if unused:
    raise ScreenshotError(
      "Each attached screenshot must appear in the description as ![what it shows](screenshot:NAME). "
      "Not shown: " + ", ".join(unused) + "."
    )


def read_png(path: Path, name: str) -> bytes:
  """The file's bytes: a regular file that is not a link (and not a pipe that would block), a PNG, within the cap."""
  try:
    handle = os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb")
  except OSError as error:
    raise ScreenshotError(f"Screenshot {name} could not be read: {error.strerror or error}.") from error
  with handle:
    if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
      raise ScreenshotError(f"Screenshot {name} must be a plain file.")
    data = handle.read(MAX_BYTES + 1)
  if len(data) > MAX_BYTES:
    raise ScreenshotError(f"Screenshot {name} is larger than {MAX_BYTES // (1024 * 1024)} MB. Crop it to the change.")
  if not data.startswith(PNG_MAGIC):
    raise ScreenshotError(f"Screenshot {name} is not a PNG image.")
  return data


def shot_entry(raw: Any, label: str, seen: set[str]) -> dict[str, str]:
  """One requested screenshot, `{name, path, alt}`, checked without reading the file."""
  if not isinstance(raw, dict) or set(raw) != {"name", "path", "alt"}:
    raise ScreenshotError(f"{label} must be a JSON object with name, path, alt.")
  name, path, alt = raw["name"], raw["path"], raw["alt"]
  if not (isinstance(name, str) and NAME.fullmatch(name)):
    raise ScreenshotError(f"{label}.name must be lowercase letters, digits and hyphens ending in .png, such as before-desktop.png.")
  if name in seen:
    raise ScreenshotError(f"{label}.name {name} is used twice.")
  if not (isinstance(path, str) and Path(path).is_absolute()):
    raise ScreenshotError(f"{label}.path must be the absolute path of the PNG file.")
  if not (isinstance(alt, str) and alt.strip() and len(alt.strip()) <= MAX_ALT and "\n" not in alt):
    raise ScreenshotError(f"{label}.alt must be one line saying what the image shows (at most {MAX_ALT} characters).")
  seen.add(name)
  return {"name": name, "path": path, "alt": alt.strip()}


def requested(raw: Any, description: str | None) -> list[dict[str, str]]:
  """The `screenshots` of the agent's input (a list, possibly empty), checked against the description."""
  if not isinstance(raw, list):
    raise ScreenshotError("screenshots must be a list.")
  if len(raw) > MAX_SCREENSHOTS:
    raise ScreenshotError(f"screenshots has {len(raw)} entries; a PR carries at most {MAX_SCREENSHOTS}.")
  seen: set[str] = set()
  entries = [shot_entry(item, f"screenshots[{number}]", seen) for number, item in enumerate(raw, 1)]
  check_references([entry["name"] for entry in entries], description)
  return entries


def read_all(entries: list[dict[str, str]]) -> tuple[list[dict[str, Any]], list[bytes]]:
  """The result's screenshot list and the bytes behind each entry."""
  payloads = [read_png(Path(entry["path"]), entry["name"]) for entry in entries]
  listed = [
    {"name": entry["name"], "sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "alt": entry["alt"]}
    for entry, data in zip(entries, payloads)
  ]
  return listed, payloads


def approved_bytes(folder: Path, shot: dict[str, Any]) -> bytes:
  """The stored image, only if it still has the approved digest (the folder is app-writable)."""
  try:
    data = read_png(folder / shot["name"], shot["name"])
  except ScreenshotError:
    data = b""
  if not data or hashlib.sha256(data).hexdigest() != shot["sha256"]:
    raise ScreenshotError(f"Screenshot {shot['name']} is missing or changed since the owner read it. Ask for another Respond pass.")
  return data


def asset_path(head_ref: str, result_id: str, name: str) -> str:
  return f"{ASSETS_DIR}/{head_ref}/{result_id}/{name}"


def raw_url(repo: str, commit: str, path: str) -> str:
  return f"https://{RAW_HOST}/{repo}/{commit}/{quote(path, safe='/')}"


def pin(description: str, shots: list[dict[str, Any]], repo: str, commit: str, head_ref: str, result_id: str) -> str:
  """The description with each reference replaced by its commit-pinned address."""
  names = {shot["name"] for shot in shots}

  def replace(match: re.Match) -> str:
    name = match.group(1)
    if name not in names:
      raise ScreenshotError(f"The description refers to an unattached screenshot {name}.")
    return f"]({raw_url(repo, commit, asset_path(head_ref, result_id, name))})"

  return outside_code(description, lambda text: REFERENCE.sub(replace, text))


def read_public(url: str) -> bytes | None:
  """The bytes anyone can fetch from `url`, with no credentials, or None."""
  try:
    with urllib.request.urlopen(url, timeout=15) as response:  # noqa: S310 (https, a fixed GitHub host)
      return response.read(MAX_BYTES + 1) if response.status == 200 else None
  except (urllib.error.URLError, OSError):
    return None


def serves(repo: str, commit: str, paths: list[tuple[str, bytes]], reader: PublicReader, attempts: int = PROOF_ATTEMPTS) -> bool:
  for path, data in paths:
    for attempt in range(attempts):
      if reader(raw_url(repo, commit, path)) == data:
        break
      if attempt + 1 < attempts:
        time.sleep(PROOF_BACKOFF * (attempt + 1))
    else:
      return False
  return True


def is_missing(error: Exception) -> bool:
  return "404" in str(error) or "Not Found" in str(error)


def branch_tip(gh_api: GhApi, repo: str) -> tuple[str | None, str | None]:
  """The screenshot branch's tip commit and its tree, or (None, None) when it does not exist yet.
  Refuses a branch that holds anything but screenshots: it is never a branch the owner uses."""
  try:
    ref = gh_api(f"repos/{repo}/git/ref/heads/{ASSETS_BRANCH}")
  except Exception as error:
    if is_missing(error):
      return None, None
    raise
  tip = ref["object"]["sha"]
  tree = gh_api(f"repos/{repo}/git/commits/{tip}")["tree"]["sha"]
  held = {entry["path"] for entry in gh_api(f"repos/{repo}/git/trees/{tree}")["tree"]}
  if held - {ASSETS_DIR}:
    raise ScreenshotError(f"The {ASSETS_BRANCH} branch of {repo} holds files that are not screenshots, so nothing was added to it.")
  return tip, tree


def add_commit(
  gh_api: GhApi, repo: str, files: list[tuple[str, bytes]], message: str,
) -> str:
  """Add `files` on top of the branch (one commit), and return the commit that holds them. A commit
  is made only when a file is new or different. Fast-forward only: a branch that moved is read again."""
  for _ in range(2):
    tip, tree = branch_tip(gh_api, repo)
    entries = [
      {"path": path, "mode": "100644", "type": "blob", "sha": gh_api(
        f"repos/{repo}/git/blobs", "POST", {"content": base64.b64encode(data).decode("ascii"), "encoding": "base64"})["sha"]}
      for path, data in files
    ]
    made = gh_api(f"repos/{repo}/git/trees", "POST", {"tree": entries, **({"base_tree": tree} if tree else {})})["sha"]
    if made == tree:
      return tip
    commit = gh_api(f"repos/{repo}/git/commits", "POST", {"message": message, "tree": made, "parents": [tip] if tip else []})["sha"]
    try:
      if tip:
        gh_api(f"repos/{repo}/git/refs/heads/{ASSETS_BRANCH}", "PATCH", {"sha": commit, "force": False})
      else:
        gh_api(f"repos/{repo}/git/refs", "POST", {"ref": f"refs/heads/{ASSETS_BRANCH}", "sha": commit})
    except Exception:
      continue  # another upload moved the branch between our read and write: build on its new tip
    return commit
  raise ScreenshotError(f"Could not add the screenshots to the {ASSETS_BRANCH} branch of {repo}; try Post again.")


def publish(
  gh_api: GhApi, repo: str, head_ref: str, result_id: str, payloads: list[tuple[dict[str, Any], bytes]],
  reader: PublicReader | None = None,
) -> str:
  """Upload the approved images and return the commit whose public addresses serve them. Nothing else
  is public yet when this runs, and a repository GitHub does not serve publicly stops Post here."""
  files = [(asset_path(head_ref, result_id, shot["name"]), data) for shot, data in payloads]
  commit = add_commit(gh_api, repo, files, f"Add screenshots for {head_ref}")
  if not serves(repo, commit, files, reader or read_public):
    raise ScreenshotError(
      f"The screenshots were uploaded to {repo}, but GitHub does not serve them publicly, which happens when "
      "the repository is private. Screenshots can only be linked from a public repository."
    )
  return commit
