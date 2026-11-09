# Contributing: the ledger

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. The `plan` field meanings live in
[prepare.md](prepare.md).

The Contribute app tracks every contribution so the partner sees status at a
glance. Find its id (slug `contribute`):

```bash
mapi /api/apps/ \
  | python3 -c 'import sys,json;[print(a["id"]) for a in json.load(sys.stdin) if a.get("slug")=="contribute"]'
```

**Pull-request records are staged, not hand-written.** Commit the reviewed
source on its review branch, then ask Contribute to stage it. Git, not the
agent, supplies the base, head, canonical diff, hash, stat and files, and the
same call writes the `.diff` beside the record:

```bash
mapi -X POST /api/github/contributions/<id>/<record-id>/stage \
  -H "Content-Type: application/json" -d '{
  "repo_path": "/data/contrib/<record-id>/worktree", "repo": "<owner>/<repo>",
  "title": "<title>", "body_draft": "<full PR body, word for word>",
  "summary": "<one plain-language sentence about what improves for people>",
  "labels": ["<type>", "<area>"], "prior_work": {...},
  "screenshots": [{"name": "before-desktop.png", "path": "/abs/path.png",
                   "alt": "<what it shows>"}]
}'
```

A new record needs `repo_path`, `repo`, `title`, `body_draft` and `summary`.
Restaging an existing record (after a fix, rebase, split, or upstream merge)
needs only `{}`, plus any text you are changing on a PR that is not public
yet (an open or draft PR's title and body are copied from GitHub and must not
be sent). Optional fields: `base_sha`
(the accepted base; default is the merge base with the target's freshly
fetched default branch, and a stack layer uses its parent's head),
`source_repo_path` (only for a checkout that is not a linked worktree of the
live source), `coauthor_trailer: false`, `chat_id` (the source chat, when a
helper stages for it), and `screenshots` (below). An open or draft PR
restages as a `pr_update` whose title and body are copied from GitHub.
Staging never pushes anything.

`screenshots` carries only images that meet the screenshot entry of the
privacy allowlist in [SKILL.md](SKILL.md). It lists up to 8 PNGs of at most
2 MB, each named in lowercase with hyphens and shown in `body_draft` as
`(screenshot:NAME)`. Every attached image must appear in the body, and every
reference must name an attached image. Each `path` must be a regular file under `/data` or the temp folder,
not a link. Staging copies the images, `[]` removes them, and leaving the
field out keeps the current ones. GitHub has no API for description images,
so Send hosts them on a `mobius-screenshots` branch of the owner's own
repository (their fork, or the target when they own it), links them, and
refuses an image that changed after approval. Send the field only when
`mapi /api/github/status` reports `"screenshot_upload": true`; an older
Möbius ignores it and would publish the references unresolved.

Screenshots are refused in four cases. Staging refuses them on a
`pr_update` and drops any attached earlier, because an open PR's description
is edited on GitHub. Send refuses them on a legacy `mobius-bot` record, when
the owner's fork of the target cannot be created, and when the hosting
repository is private, because GitHub does not serve its images publicly;
it stops before the code is pushed. In those cases leave them out: a new
PR's body says why screenshots are not included, and a `pr_update`
describes the visible change in words in the reply that accompanies the
update.

A 404 from either call means this Möbius predates them: tell the owner a
platform update is needed rather than writing the record by hand.

Record the private verdict for the exact staged head the same way:

```bash
mapi -X POST /api/github/contributions/<id>/<record-id>/review \
  -H "Content-Type: application/json" -d '{
  "head_sha": "<plan.head_sha you reviewed>",
  "diff_sha256": "<plan.diff_sha256 you reviewed>",
  "state": "reviewing | changes_needed | all_clear",
  "summary": "<what the complete head review found>"
}'
```

A staged change that moved after you read it is refused; `all_clear` is also
refused while the checkout would not pass Send's local checks. Staging drops
a verdict unless the canonical diff and public text are byte-identical (a
clean rebase or upstream merge), in which case the verdict follows the new
head with `carried_from_head_sha`.

The stage response's `source_sync.state` says how the live source relates to
the staged version: `in_source` (it contains it), `adopted` (the live source
held the previous staged version, so the review revision was just committed
onto it), or `diverged` (it does not; `detail` says why). Mention `adopted`
backend changes that need a restart, and tell the owner when a change stays
`diverged`.

**Other JSON writes use CAS** — issue and comment records, status changes, and
`chat_ids` unions — because a record has several writers (you, the publication
endpoints, the scheduled refresh job, the app's Dismiss button) and an
unconditional PUT silently erases one.

**Create** — `If-None-Match: *` so the PUT 412s if the id somehow exists (then
pick a new id):

```bash
mapi -X PUT /api/storage/apps/<id>/contributions/<record-id>.json \
  -H "Content-Type: application/json" \
  -H "If-None-Match: *" -d '{
  "id": "<record-id>", "type": "issue", "repo": "<owner>/<repo>",
  "status": "prepared", "title": "<title>",
  "chat_id": "'"$CHAT_ID"'", "chat_ids": ["'"$CHAT_ID"'"],
  "created_at": "<ISO>", "updated_at": "<ISO>",
  "summary": "<one plain-language sentence>",
  "plan": {"action": "issue", "repo": "<owner>/<repo>", "title": "<title>",
           "body_draft": "<full text, word for word>", "diff_stat": ""}
}'
```

`chat_id` is the immutable creation/provenance chat. `chat_ids` is private,
additive coverage metadata for the source conversations whose edits the same
record has reconciled. A newly created record may contain only the current
chat. When reusing a prepared or public record from another chat, restage it
from that chat (staging adds the chat) or CAS-union the existing values with
the current `$CHAT_ID`; never overwrite the primary id or create a duplicate
record for the new chat. A background worker child is
execution history, not source provenance: never add its chat id to `chat_ids`
(pass the source chat as `chat_id` when a helper stages). If that worker
performed the actual review, its id is recorded in `quality_review.chat_id` for
audit while the parent source chat still owns the final record. Neither
provenance field is published to GitHub.

**Update** — read with `x-mobius-version: 1`, note the `ETag`, PUT the edited
record with `If-Match`. A **412** means the record changed under you: re-read,
check the fresh status still allows your change, reconcile, then retry with the
new ETag:

```bash
mapi -si -H "x-mobius-version: 1" \
  /api/storage/apps/<id>/contributions/<record-id>.json
# note the ETag, edit the JSON, then PUT with -H 'If-Match: <etag>' -d '{ ...full record... }'
```

Refreshing a record keeps its id and public identity (PR URL/number). Do not
create a second record merely because upstream moved.

`type` ∈ `pr | issue | issue_comment | discussion_comment`; `status` ∈ `prepared
| submitting | draft | open | merged | closed | commented | abandoned`; `number`,
`url`, `branch` are optional until they exist. `submitting` = the approve endpoint
claimed the record and the action is in flight; `commented` = terminal for
comment actions. A record stuck in `submitting` is reconciled by the platform's
lost-response recovery, never by searching GitHub and inventing a new record.
Legacy `submission_mode: "mobius-bot"` records carry extra `relay_*` fields:
[legacy-bot.md](legacy-bot.md).

`quality_review.state` ∈ `reviewing | changes_needed | all_clear`, written
only through the review call above. Its `reviewed_head_sha` must exactly equal
the record's current `plan.head_sha`; publication endpoints enforce this.

The scheduled refresh job only tracks `pr | issue` records in `draft | open`.
