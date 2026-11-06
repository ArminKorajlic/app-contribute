# Respond to feedback: the saved result, and Post

The contract between `respond_result.py` (run by agents) and the Contribute app.
Lines that say "you" are for the agent doing a Respond job.

## What this is

A Respond-to-feedback job answers the points reviewers raised on one PR. It never
posts anything itself. When the work is done it **saves a result**. Contribute shows
that result in the PR's Review tab (each point and how it ended, the exact replies,
the commits and changed files, the tests) and the owner presses **Post**, **Reply in
chat** or **Discard**. Post sends the same chat one message that tells it to run
`respond_result.py post`; that command checks the owner's approval and posts exactly
what was shown, in a fixed order: push the commits, post the replies, update the
description, ask for the re-review.

## Where things live

Storage of the Contribute app, `/data/apps/<id>/` (`<id>` is the numeric id of the app
whose slug is `contribute`; the helper finds it in the database, like
`agent_snapshot.py`). `<slug>` is `<owner>__<repo>__<number>`, lower case
(`mobius-os__app-contribute__123`); `owner` and `repo` match `[a-z0-9][a-z0-9_.-]*`.

| File | Written by | Holds |
|---|---|---|
| `respond-results/<slug>.json` | the helper only | the result (below) |
| `respond-results/<result id>.bundle` | the helper only | the commits as a Git bundle (absent when there are no commits) |
| `respond-decisions/<slug>.json` | the app only | the owner's decision about one result |

One result per PR: saving again replaces it. Two writers never share a file, so nothing
needs compare-and-swap. Every write is atomic (temporary file, then rename).

## The result (`version: 1`)

```json
{
  "version": 1,
  "id": "r-3f9a1c2b04d5",
  "repo": "mobius-os/app-contribute",
  "number": 123,
  "chat_id": "00000000-0000-4000-8000-000000000000",
  "created_at": "2026-11-06T08:41:00Z",
  "state": "ready",
  "pr": { "head_sha": "<40 hex>", "head_ref": "stack/x/06-y", "base_ref": "stack/x/05-z", "head_repo": "mobius-os/app-contribute" },
  "tip_sha": "<40 hex>",
  "points": [
    { "reviewer": "alex", "title": "A lost write answer is unresolved", "ending": "fixed", "commit": "<40 hex>", "answer": "One sentence." }
  ],
  "replies": [ { "body": "Markdown posted as one PR comment.", "reply_to": null } ],
  "description": null,
  "rerequest": ["alex"],
  "tests": "803 pass, 0 fail (node)",
  "commits": [ { "sha": "<40 hex>", "title": "First line of the commit message" } ],
  "files": [ { "path": "ui/x.jsx", "status": "modified", "added": 12, "removed": 3, "patch": "@@ -1,3 +1,4 @@\n..." } ],
  "bundle": "r-3f9a1c2b04d5.bundle",
  "digest": "<64 hex>",
  "receipts": { "push": null, "replies": [], "description": null, "rerequest": null },
  "error": null
}
```

* `state`: `ready` (saved, nothing public done) → `posting` (the `post` command is running)
  → `posted`, or `failed` (it stopped part-way; see `error` and `receipts`).
* `pr.*` is read from GitHub at save time. `pr.head_sha` is the PR head the work was built
  on; `tip_sha` is the last commit of the work (`tip_sha == pr.head_sha` when there are no
  commits). `commits` are `pr.head_sha..tip_sha`, oldest first.
* `points[].ending` is exactly one of `fixed`, `not_valid`, `out_of_scope`. `commit`
  (full SHA, or `null`) must be one of `commits`.
* `replies[].reply_to` is a review-comment id (integer) to answer in that thread, or `null`
  for a plain PR comment. `description` is the complete new PR description or `null`.
  `rerequest` lists logins to ask for a new review (`[A-Za-z0-9-]{1,39}`).
* `files[].status` is `added`, `modified`, `removed` or `renamed` (a renamed file also has
  `previous_path`). `patch` holds the hunks only (from the first `@@`, the format of
  GitHub's REST `patch`), or `null` for a binary file or one over the caps, in which case
  `patch_omitted` is `true` (binary files also have `binary: true`).
* Caps: 30 points; point title 160, answer 400, reviewer 60 characters; 12 replies of at
  most 20 000 characters; description at most 60 000; 10 logins; tests 500; 60 commits;
  300 files; a file's patch 60 000 and all patches together 400 000 characters.
  Text must be valid Unicode (no lone surrogates).
* `digest` is the SHA-256 (lower-case hex) of the UTF-8 bytes of this object written with
  `json.dumps(..., sort_keys=True, separators=(",", ":"), ensure_ascii=False)`:
  `{"v": 1, "pr_head": pr.head_sha, "tip": tip_sha, "points": [{reviewer, title, ending, commit, answer}…],
  "replies": [{body, reply_to}…], "description": …, "rerequest": […], "commits": [sha…]}`.
  It binds what the owner read to what gets posted.
* `receipts`: `push` is `{"sha", "at"}` once done; `replies` is a list of
  `{"index", "url", "at"}`; `description` is `{"at"}`; `rerequest` is `{"at", "reviewers"}`.
  `error` is `{"step", "message"}` when `state` is `failed`.

## The decision (`respond-decisions/<slug>.json`, written by the app)

```json
{ "version": 1, "result_id": "r-3f9a1c2b04d5", "digest": "<64 hex>", "decision": "approved", "at": "2026-11-06T09:30:00Z" }
```

`decision` is `approved` (Post pressed) or `discarded` (Discard pressed). A decision counts only
for the `result_id` and `digest` it names; any other result ignores it. Asking for another pass
needs no decision: the new result replaces the old one when it is saved.

## The helper: `python3 /data/apps/contribute/respond_result.py`

Standard library only; `gh` and `git` are used the way the other helpers use them.

### `save --pr owner/repo#N --repo-path DIR --input FILE [--chat-id ID]`

You run this when the work is finished, from your private copy (`--repo-path`), then stop.
`--chat-id` defaults to `$CHAT_ID`. `FILE` is the part only you can write:

```json
{
  "points": [ { "reviewer": "…", "title": "…", "ending": "fixed", "commit": "8bc1054", "answer": "…" } ],
  "replies": [ { "body": "…", "reply_to": null } ],
  "description": null,
  "rerequest": ["…"],
  "tests": "…"
}
```

`commit` may be a prefix of at least 7 hex characters of one of your commits. Git supplies
everything else (commits, files, patches, the bundle), the PR's head comes from GitHub.

It refuses (exit 2, nothing written) when: the input breaks a rule above; the PR is not open
or does not match `--pr`; `--repo-path` has uncommitted changes; the PR head is not an
ancestor of `HEAD` (your commits must sit on top of it, never rebased); a point names a
commit that is not in the range; there is nothing to show (no commits and no replies).
It refuses with exit 3 when this PR's saved result is `posting`. Otherwise it replaces any
earlier result for the PR (removing its bundle and its decision file).

### `show --pr owner/repo#N`

Prints the saved result without patches, and whether the owner has approved it.

### `post --pr owner/repo#N --id RESULT_ID [--dry-run]`

The only command that does public things. Contribute tells the chat to run it after the
owner presses Post. In this order, it:

1. loads the result (its `id` must match; `posted` means nothing to do, exit 0);
2. requires the decision file to say `approved` for this `result_id` and the stored `digest`;
3. recomputes the digest from the result's content and requires it to equal the stored one;
4. reads the PR from GitHub: open, and its head is `pr.head_sha` (or `tip_sha` when the
   push already happened, see below);
5. with `--dry-run`, prints the plan and stops here;
6. sets `state` to `posting`, then does each step that has no receipt yet:
   * **push**: `tip_sha` to `refs/heads/<pr.head_ref>` of `pr.head_repo`, fast-forward only
     (never forced), from the bundle (fetch the PR head, fetch the bundle, push); then check
     GitHub shows `tip_sha` as that branch's head. Skipped when there are no commits;
   * **replies**: one `POST` each (`issues/<n>/comments`, or
     `pulls/<n>/comments/<reply_to>/replies` when `reply_to` is set), in order;
   * **description**: `PATCH pulls/<n>` with the new body, when `description` is not `null`;
   * **re-request**: `POST pulls/<n>/requested_reviewers`, when `rerequest` is not empty;
   each success is written to `receipts` at once, so a second run continues where the first
   stopped and never repeats a step;
7. sets `state` to `posted`.

Refusals before step 6 change nothing and exit 3 with the reason (not approved, digest or id
mismatch, PR closed, PR moved). A failure inside step 6 sets `state` to `failed` with
`error`, keeps the receipts and exits 4. Every GitHub write goes through `gh api` with the
JSON body on standard input. Test hooks: `RESPOND_APP_DIR` replaces the storage directory;
`RESPOND_GIT_REMOTE` replaces the Git URL used to fetch and push.

Exit codes: 0 done, 2 bad input, 3 refused, 4 failed part-way.

## What the app does with it

* **Reads** both folders with the sync hub (every 2.5 s while an answer is being posted, for five
  minutes after Post; every 30 s otherwise) and pairs each result with its decision.
* **Status** of a result on its PR: `ready` (fresh: the PR head still equals `pr.head_sha`),
  `stale` (the head moved), `approved` (approved, not yet `posting`), `posting`, `posted`,
  `failed`, or none (discarded). For the first 30 s after the decision's `at`, `approved` is "the
  chat is starting": the card says **Sent to the chat** with a spinner and offers no Send again
  (both real posts had the message at the chat in 2 s and the first step done by 8.6 s). After
  that it says **Not started yet** and offers Send again; if the message to the chat failed it
  offers Send again at once.
* **PR logic** (unchanged): `ready` and `approved` supply the existing "draft" fact, `posting` the
  "sending" fact, `failed` the "unconfirmed" fact. `stale` and none supply nothing, so the PR
  reads "Feedback to answer" again.
* **Review tab card**: points with their ending, the replies word for word, the description,
  commits and changed files, the tests, what Post will do in order, and Post, Reply in chat and
  Discard. Post is off while the PR moved, while the chat is working, and while the chat waits on
  one of its own cards (a chat with an open card refuses new messages).
* **Post** re-reads the result, checks its digest is the one on screen and the PR head is still
  `pr.head_sha`, writes the decision (`approved`), then sends the chat (`chat_id`) this message
  with the stable id `respond-post-<result id>`; if the platform definitely refuses it, the
  decision is removed again:

  ```
  Approved in Contribute: post result <id> for <repo>#<number>, built on <head sha, 7 characters>.

  Run exactly this and report what it printed:

      python3 /data/apps/contribute/respond_result.py post --pr <repo>#<number> --id <id>

  It posts only what was shown and approved, and checks the approval and the PR head itself.
  Do not push, comment, reply or edit anything on GitHub by hand. If it refuses, say why and stop.
  ```
* **Discard** writes the decision `discarded`. **Respond again** sends the new brief into the same
  chat (the platform returns an existing chat for the PR's scope without sending a new job, so the
  app delivers it as a message, like project work); the old result stays until the new one replaces it.
  The window names that chat's agent, read from the app's own chat list for the scope. The started
  chat holds the PR in the app at once (the platform lists it only once its turn is live), until a
  read of the runs names it or for one minute at most, and the runs are read again right away.
* The brief given to the Respond agent ends with the `save` command, not with an approval card,
  and tells it that it never pushes, posts, replies, resolves or changes anything on GitHub.
