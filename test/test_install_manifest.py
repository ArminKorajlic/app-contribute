"""The installed import closure of the app's Python entry points.

An install that fetches only the manifest writes ``source_files`` plus the
schedule job and service entry. A module the job imports but the manifest
omits works in a full clone and fails the installed job before it processes a
single record, so walk every local import from each Python entry point.
"""

import ast
import json
import os
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _read(relpath):
  with open(os.path.join(ROOT, relpath), encoding="utf-8") as source:
    return source.read()


def _job_python(text):
  start = text.index("python3 - <<'PY'")
  body = text[text.index("\n", start) + 1:]
  return body[:body.index("\nPY\n")]


def _local_imports(source, filename):
  """Sibling modules (``<name>.py`` in the app root) that ``source`` imports."""
  found = set()
  for node in ast.walk(ast.parse(source, filename)):
    if isinstance(node, ast.Import):
      names = [alias.name for alias in node.names]
    elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
      names = [node.module]
    else:
      continue
    for name in names:
      module = name.split(".")[0] + ".py"
      if os.path.isfile(os.path.join(ROOT, module)):
        found.add(module)
  return found


class InstalledImportClosureTest(unittest.TestCase):

  def test_every_python_module_an_installed_entry_point_imports_is_shipped(self):
    manifest = json.loads(_read("mobius.json"))
    shipped = set(manifest["source_files"])
    job = manifest["schedule"]["job"]
    roots = [(job, _job_python(_read(job)))]
    roots.append((manifest["service"]["entry"], _read(manifest["service"]["entry"])))
    roots += [(f, _read(f)) for f in sorted(shipped) if f.endswith(".py")]

    pending, seen = list(roots), set()
    while pending:
      filename, source = pending.pop()
      if filename in seen:
        continue
      seen.add(filename)
      for module in sorted(_local_imports(source, filename)):
        self.assertIn(
          module, shipped,
          "%s imports %s, which mobius.json source_files does not ship" % (
            filename, module),
        )
        pending.append((module, _read(module)))
    self.assertIn("github_events.py", seen)


if __name__ == "__main__":
  unittest.main()
