"""A fake Möbius core (SCRIPTS_DIR/github_review.py) for the gate on `post`: it advertises the review-presets capabilities that
FAKE_HOST_CAPABILITIES holds as JSON ('{}' is a Möbius without the owner grant). Shared by test_respond_result.py and respond-contract.test.mjs."""
import json
import os


def api(path, *, method="GET", data=None, headers=None):
  if path == "/api/apps/":
    return [{"id": 7, "slug": "contribute"}]
  if path.endswith("/review-presets"):
    return {"presets": {}, "capabilities": json.loads(os.environ.get("FAKE_HOST_CAPABILITIES", "{}"))}
  raise AssertionError(f"the gate asked for something it should not: {path}")


def review_path(app_id, suffix):
  return f"/api/github/contributions/{app_id}{suffix}"


def prepare_selection(*args, **kwargs):
  raise NotImplementedError


freeze_preview = verify_selection = start_body = prepare_selection
