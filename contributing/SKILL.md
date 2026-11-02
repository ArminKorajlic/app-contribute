---
name: contributing
description: "Contribute app's project-collaboration skill. Read before ANY public GitHub action, and for prepare my changes / prepare all, address existing contributions, finish the contribution cycle / submit and sync / align with upstream, and review or merge selected PRs."
---
# Contributing upstream

It moves local project changes into private review, public collaboration, and
safe local reconciliation. Read it when the partner asks to prepare, publish,
or work on a contribution, not merely because a local change could be shared.
The cycle is project-shaped: a project adapter
supplies the facts that differ between targets (where source lives, what is
shared, how publication and local updates work), and this core applies to every
target.

This file is the core every contribution task needs. Procedures live in mode
files next to this one in the skill folder: open only the one the current step
needs, from the table below (links are relative to this file). After context
compaction, re-read this core plus the mode file you were working in — not
every file.

---

## Hard stops

Three rules never bend. Every mode file assumes them and points back here.

1. **No public action without explicit scoped approval.** An explicit,
   unambiguous instruction in chat is a valid yes for the named work. For
   example, "create a PR for this fix" authorizes its private preparation,
   necessary fork and push, and PR creation with a truthful source-only title
   and description. "Update this PR" authorizes the reviewed in-scope update.
   The partner does not need to repeat that same approval in Contribute or
   approve each mechanical step. Neither instruction authorizes merging;
   merging needs its own explicit instruction or approval. A changed commit
   requires fresh review, not automatically a new owner decision. Ask again
   for a different target, materially changed scope, risk, or public message,
   or when the owner limited approval to a pinned version. Never infer
   approval from silence, standing preferences, or another agent's request.
2. **Only source code and screenshots of the change leave the instance, and
   only after you re-read the FULL diff and look at every image.** The
   allowlist below is exhaustive — never memory, storage, db, logs, creds,
   chat, or personal data. Re-read every changed line before proposing; the
   `body_draft`, the `.diff`, and the attached screenshots are exactly what
   goes public.
3. **Never submit stale work.** If the staged plan's `base_sha`/`head_sha` or
   canonical branch diff has drifted, do NOT submit — re-stage and re-review
   the current version. Use the same guarded publication path; review and
   freshness checks remain mandatory regardless of the approval surface.

## The common path

Most requests are one PR, new or an update to an open one. After the adapter:
check related work ([prepare.md](prepare.md); prefer updating the owner's own
open PR over a duplicate), build the locked review worktree on the fresh base
or the PR head ([branch.md](branch.md)), run the focused tests, review and
stage with one verdict ([ledger.md](ledger.md)), then publish once approved:
**Send PR** or `update-existing` ([publish.md](publish.md)).

## Which file to read

| When you are about to… | Read |
|---|---|
| Run an owner intent across the queue: **prepare my changes / prepare all**, **finish the contribution cycle / submit and sync / align with upstream**; start any multi-contribution task (queue snapshot); reconcile local projects after merges; choose the project adapter | [cycle.md](cycle.md) |
| Work on a Möbius target — the platform, shell, or an installed app: source roots, branch recipes, checkout-local test wrappers (`wt-pytest.sh`/`wt-npm.sh`), the Möbius CI suite, labels, catalog check | [adapter-mobius.md](adapter-mobius.md) |
| Work on any other GitHub repository — the owner's own project or third-party open source: clone, default branch, fork or branch PR, the target's contribution policy | [adapter-github.md](adapter-github.md) |
| Prepare one contribution: prior-work search, two-pass code review, **review all / review this PR / fix and review again** on prepared records, the `plan` fields, the `all_clear` verdict and handoff | [prepare.md](prepare.md) |
| Build the review branch: refresh upstream, scratch vs `/data/contrib` checkouts, the locked review worktree, updating an existing open PR; **cleanup ownership** of any clone, worktree, install, or build output you create | [branch.md](branch.md) |
| Read or write ledger records: **stage** a PR, record a verdict, CAS updates, `chat_ids`, `type`/`status` values | [ledger.md](ledger.md) |
| Publish after approval: the green light, **Send/Open PR**, issue/discussion comments, editing a PR's title or description, autopilot grants, the failure table | [publish.md](publish.md) |
| Work that needs upstream push or merge rights: PR stacks, **Review**, pinned **Review & merge**, and scoped **Review, fix & merge** of selected public PRs (`review_prs.py`), **Prepare & merge**, publishing an app into its own `mobius-os/app-<id>` repository and the post-merge `connect_app` | [maintainer.md](maintainer.md) |
| Link a public PR in chat so the owner can open it in Contribute (`pr_block.py`, read-only; no rights needed) | [maintainer.md](maintainer.md) “Link a PR in chat” |
| Check results: required checks, local checks before staging, inspecting failed CI (prefer `/data/platform/scripts/ci-failures.sh <owner/repo> <pr-number\|run-id>` over full `gh run view --log` dumps) | [ci.md](ci.md) |
| Any record with `submission_mode: "mobius-bot"` (legacy relay records only) | [legacy-bot.md](legacy-bot.md) |
| Answer review activity in an "Autopilot: …" chat | the `review-followup` skill, not this one |

## Tools and GitHub status

Use `mapi` for every chat-context command in these files — it fills in
`$API_BASE_URL` + `$AGENT_TOKEN`; never hardcode localhost. A successful write
often returns **204 No Content**, so `mapi` prints nothing — that silence is
success, not failure: verify with a follow-up GET, or show the status with
`mapi -o /dev/null -w '%{http_code}' -X PUT /api/... -d '...'`. Use the exact
documented path including its trailing slash (`/api/apps/`): slash-less
variants are a plain 404, not a redirect curl could follow.

```bash
mapi /api/github/status | python3 -m json.tool
```

New contributions require the connected owner's GitHub account. Never add the
legacy `submission_mode: "mobius-bot"` marker to a record.

- `connected: true` with a `login` — `gh` is authenticated as the owner. You
  never see the token (`gh` resolves it from the platform store — don't dig for
  it, never print it). It's wired GLOBALLY: once connected, ANY `git push` to a
  github.com remote authenticates as the owner and nothing at the git layer gates
  that — Hard stop #1 is the whole safety net. NEVER run a bare `git push` to a
  github remote outside the guarded Send path.
- `connected: false` — contributions can still be prepared and reviewed
  privately, but sending requires a connected GitHub account. Nothing goes
  public without the partner's scoped approval (Hard stop #1).
- `gh_version: null` — `gh` is unavailable. Tell the partner a platform update
  is needed; don't improvise around it.

## What may leave — the privacy allowlist

Hard stop #2 in full.

**Contributable — these two, and that is the whole list:**

1. **Source code** — source files of the target repository,
   under a project root its adapter registers. The Möbius adapter lists its
   roots; a generic GitHub target's root is its own checkout.
2. **UI screenshots of the change** — images you captured of the changed
   interface from neutral or synthetic state, checked for everything listed
   below, attached to the prepared record, and published only with the
   owner's approval of that exact record. A screenshot that shows any of it
   must not be attached; recapture with neutral data or leave it out.

**Never, no exceptions:** anything under `/data/shared/memory/`, app storage
(`/data/apps/<int-id>/` — numeric-id dirs are runtime data, not source), the
database, logs, `/data/cli-auth/`, chat content, and anything personal — names,
schedules, health data, locations, habits, the partner's writing. Commit
messages, branch names, and PR bodies leak too: keep them generic ("fix
empty-state crash", not "fix crash when <name>'s workout log is empty").

**Re-read the FULL diff — every changed line, not the file list** — the
canonical `base_sha..head_sha` diff against the accepted base the adapter
names. Local commits routinely carry partner data into source (a seeded
example, a hardcoded name, a test fixture with real entries) — strip anything
personal or don't propose.

## The approval gate

Private preparation begins only from an explicit partner request, including a
project-level or **Prepare to submit** handoff from Contribute. A chat's
**Changes** view only lists its edits; it is never a request or approval.

**One decision, no duplicate approval.** Proceed without requiring the matching
Contribute press when the owner's instruction already covers the action. Run
the same exact-head, full-diff, identity, and freshness checks; chat approval
changes the approval surface, not the safety preflight. An open Goal does not
create a new permission requirement. If permission is genuinely missing, use
one decision surface: a saved approval card when this chat needs to resume, or
the existing Contribute control when its workflow owns the continuation. Do not
ask for the same decision on both surfaces. A saved approval card claims its
work key itself; do not claim it separately first.

If the owner presses the block, let that action own its complete batch until
every item settles; in-flight siblings stay visibly in flight. A chat-scoped
review, repair, or failed-publication recovery continues as a hidden turn in its
source chat. Contribute may start an app-owned scoped conversation only for
genuinely global work that has no source chat. Background Delegation children return evidence or independent edits to
their parent; they do not become owner-facing contribution homes.

Interpret the request in context, using Hard stop #1:

- **Prepare privately** means prepare and review, then stop before publication.
  Preparing is still private: a local branch/commit and Contribute record, not
  a fork, push, PR, issue, or comment.
- **Create/send a PR for this work** means prepare, review, publish, and verify
  that PR, not just prepare it for another approval. Ordinary read-only checks
  and bounded CI monitoring are verification, not another permission request;
  use a durable Wait if this chat owes a result after the turn. Do not invent
  indefinite monitoring after the requested outcome is complete.
- **Should this be contributed?** is a question, not publication authority.
  If "share" or another request leaves the target or public scope genuinely
  ambiguous, finish safe private preparation and ask only for that decision.
- **Refine first** authorizes the requested private refinement, not publication.
  Ask for missing feedback through a saved question only if it is needed.
- **Not now** declines the proposed action. Do not re-offer the same version.
  An unanswered, preselected, or empty card is not approval.

## GitHub without Contribute

GitHub is connected in **Möbius Settings → Accounts → GitHub**, independently of
this app. The core `github-workflows` skill and
`python3 "$SCRIPTS_DIR/github_review.py"` support privately previewed review,
pinned conditional merge and explicitly scoped repair-and-merge in the owning
chat without installing Contribute. They use the same platform grants and
receipts, not an app ledger or a second queue. Contribute adds project overview,
private proposal staging, app approval links and rich app-backed detail; it is
not a prerequisite for core GitHub work. All hard stops still apply.
