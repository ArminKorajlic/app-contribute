# Contribute product context

<!-- impeccable:product-schema 1 -->

## Platform

Web app inside the Möbius workspace, responsive from phone to wide desktop.

## Users

The owner of a local Möbius instance today, and people collaborating on their own projects through the same workflow in future.

## Product Purpose

Move changes from local work into private review, public collaboration, and safe local reconciliation without making people restate the process every time.

## Positioning

A Continuous Project Desk, not a Git client. See what remains local, what is
shared for review, and whether shared updates have been checked. Choose one project, then prepare or review its work; approve exact public actions when ready.

## Operating Context

Changes still begin in their source chats, and a chat's Changes view only lists
its edits. To prepare them, ask the conversation that owns them, or prepare the
whole project in Contribute, the cross-chat project overview. Current code
establishes what needs preparation; chat diffs are provenance, not a second
source tree.

The landing view is a searchable project index, without global mutation controls. Each project shows
local/private/public work and its last-known shared-version relationship.
Selecting a project keeps those facts and scoped controls visible, with its
questions, ready batch, incoming requests, progress and history underneath.
A contribution opens within that project; Back and Forward preserve the same
project and contribution. No separate Reviews room or second ledger exists.

Main controls must not disappear into catch-all overflow menus. Simplicity
means fewer steps and clearer information, not smaller type or hidden project
position. Agent work progresses in place; only actual questions need the owner.

## Capabilities and Constraints

- Public GitHub actions always retain an exact owner approval checkpoint.
- One approval may cover a mixed set of standalone and stacked pull requests,
  but it must enumerate every exact public action and preserve stack order.
- An all-clear review belongs to the exact reviewed version and becomes stale when that version changes.
- Existing local and private work must be preserved during reconciliation.
- Project status can establish source relationships, but it cannot always infer whether local differences are reusable, personal, or already covered. The UI must distinguish clear preparation candidates from work that needs sorting.
- The same workflow should extend beyond Möbius-owned projects as project adapters grow.
- Chat keeps only decisions and attention above the composer; healthy public and settled work belongs in Contribute.
- Deterministic status refresh, accepted-work recognition, duplicate detection, and lost-response reconciliation run automatically; they never summon an agent merely to repeat the ledger.
- One changed-work conversation owns the remaining private judgment. Repeated actions reuse it until the represented source or contribution head changes.
- The normal personal-GitHub publication opens reviewed pull requests ready for
  review. Draft is an intentional exception, not a mandatory extra stage: the
  owner who works draft-first sets it once in Settings (New pull requests start
  as) or picks it for a single send from the arrow on the button.
- Publication never implies merge. Queueing or merging is a later, separate,
  exact approval against the current public head.
- Source chats remain the durable home of their work. Background workers may
  contribute evidence or independent edits, but they never become the owner-facing source.

### Selected-PR run contract

Keep the local and GitHub overview and the prepare loop; extend that project
workspace rather than introducing a replacement Reviews room. Updates belong
to Möbius Settings (platform) and the App Store (apps); Contribute reports
them and links there instead of running a second updater. PR body, checks,
labels, reviewers/comments and source conversation are deliberate detail.

Review-only, legacy pinned conditional merge and explicit named-PR
review/fix/merge are distinct scopes. Takeover is bounded to server-frozen PR
files and independently reviewed successor heads, never arbitrary changed
versions, comments or force-push. Editable prompts, private
autopilot and model/effort resolve into a frozen pre-consent snapshot; execution
rejects drift and cannot rewrite mandatory safety instructions. Old grants do
not inherit autopilot or broader scope.

New review/fix/merge runs have no repair-round budget. Previously frozen finite
selections retain their limit rather than silently expanding an accepted run.
Stop, clarification, exact scope, independent review and required checks still
control continuation.

One owning chat, durable programmatic independent reviewers, dedicated repair
checkout and public receipts carry the actual review—not a preview proposal or
an all-clear inferred from green checks. Paused work has a name and remaining
steps; queued is not merged. Read-only receipt observation never revives Stop.
Core Settings GitHub workflows work without this optional app, through the same
platform owner and grant mechanisms, not a second queue.

## Brand Commitments

Quiet, inviting, high-level, concise, and icon-led. Show the next meaningful action before technical detail.

## Evidence on Hand

Live local project status, private contribution records and stored diffs, and connected GitHub review state.

## Product Principles

1. Lead with the next action.
2. Never overstate certainty.
3. Lead with project position; group the same review run by decision within the selected scope.
4. Make detail and diffs immediate once an item is selected.
5. Keep one deliberate owner checkpoint for public actions.
6. Let the source chat start and complete its work, and Contribute project the
   project-scoped run without inventing a second workflow.
7. Automate facts; reserve agent work for intent, grouping, review, and repair.
8. Completed intent disappears; failures continue automatically unless a real
   owner or account decision is required.

## Accessibility & Inclusion

Keyboard-accessible controls, state labels that do not depend on color, readable contrast, practical touch targets, and an adaptive list-to-detail flow on small screens.

## Minimal daily workflow (owner direction, 2026-10-02)

Use a linked project repository, real status refresh, a prepare launch panel, actionable prepared work above PRs, compact PR authors/labels/check counts and person assignment. Agent launch offers private review with optional review-only autopilot, or scoped review/fix/merge with automatic continuation; model and effort belong to that launch. Settings contains one grouped prompt editor, not a second automation or model console. Project work and History retain meaningful current/past work (a new full merge cycle is a Prepare option offered with merge rights); hiding archived proposals never deletes their records. Version/scope/prompt freezing stays mandatory underneath but does not require routine disclosures or duplicate decisions. Read-only guards remain intentional. New explicitly approved draft takeover reviews and fixes while draft, then marks ready only after fresh independent review and checks. Old grants retain their draft boundary.

## GitHub alignment and live versions (2026-10-03)

The PR list and detail follow GitHub's own presentation
(state icons, colored labels, "#123 · author opened …", ✓ n/m checks). A run is
bound to each PR's exact head and to the target branch's live tip at the moment
of consent; GitHub's PR comparison base is not used for that binding. At Start
the selected PRs are re-read: unchanged code follows a moved target branch,
while changed code or draft state requires the owner to look again. The
upstream position states incoming files (or commits behind), the same units as
local work. Default review, fix and merge prompts are short, readable guidance
that widens review scope and fixes causes; mechanics and authority stay in the
fixed run brief and mandatory instructions.

## Plain words (owner direction, 2026-10-26)

Every control says what it does for someone who has never used Contribute:
"Make PRs from my edits" rather than "Prepare changes", **Sync with GitHub** with
its last time written beside it rather than a silent refresh icon, "Mark ready for review" for
an own draft, and labelled **Assign** and **Actions ▾** buttons on PR rows. An
action shows feedback when used. Sync with GitHub asks GitHub read-only whether a
repository moved past the compared commit; a quiet project reads "Up to date at
the last check" until a fresh check says more. The agent review window states
its steps, what GitHub will see and which model runs it before anything starts.
A project opens on To look at (blockers before news, each with its reason, PR
and detection time), then its status, then All PRs, Review requests and My work; the projects list tags Platform and App projects, says what waits on
the owner, and folds apps with nothing to do.

## Act where you are looking (owner direction, 2026-11-04)

- **Actions ▾** (it was Agent ▾) holds what the owner can do and what an agent
  can do for a PR. A **You** group comes first: **Open for review** on a draft
  this app sent, and **Merge** where the platform can merge for the owner (the
  menu offers it only when the platform advertises it). The **Agent** group keeps
  the four agent jobs. The best next step is first and highlighted; a choice that
  cannot run stays in place, dimmed, with its reason. A batch selection offers
  only agent jobs.
- Each of the owner's own actions ends in a **confirm sheet**: it states what
  happens, what GitHub shows right now (approval, checks, conflicts, what the
  owner's own agent review said about this exact version) and what Contribute
  cannot undo. The X is its only way out, so there is no Cancel (the Review and
  Address feedback windows work the same way); a finished action swaps it for
  Done. Merge asks how it lands only when the repository
  allows more than one way, merges exactly the version shown, and is never
  repeated after an unconfirmed answer. **Only a decoded receipt for the action
  is a success and only a decoded refusal (a 4xx whose body can be read) is a plain
  failure.** A lost connection, a server error, an answer that cannot be read
  (whatever its status) or the wrong receipt may have reached GitHub, so the sheet reads that as unconfirmed: it has the view read
  GitHub again first, and its button stays off, so another attempt can only
  start from that fresh read. This holds for Merge, Open for review and Post to
  GitHub alike.
- **Open as draft / Open for review** is one split button on the prepared-PR
  card; the arrow offers the other stage for that send. The stage is part of the
  exact approval, the confirmation text and the chat Send card (which freezes it
  at Confirm), so what is confirmed is what opens.
- **Whose turn it is** is derived from what the owner already did, not from the
  review's saved word alone (needs_you says what the review *found*). After
  Request changes the PR waits on its author and the row reads **Waiting on
  <author>**; if the author pushes again it reads **New commits · review again**.
  A finding on the owner's own PR stays theirs until they fix it or set it aside.
- **The Review tab answers instead of asking for a conversation.** A finished
  review that found problems offers **Fix these findings** (Address feedback with
  the saved findings ticked), **Ignore…** (one reason, for this exact version,
  kept in Contribute, nothing posted, with Undo), **Review again** and **Ask the
  reviewer something** as a plain button. "Answer in review conversation" is
  only for a conversation that really asked something, and "Stop review" only
  while work is in progress.
- **PR reviews** (side menu) lists the reviews the owner started, by project, in
  two tabs: **In progress** (waiting on the owner first, then agents at work, then
  anything stuck) and **Done**. Every PR whose review is not merged is read live
  (all of them, in batches of 40), when the list changes and again on every Sync with GitHub, so a closed PR is
  history, a pushed PR comes back as new commits (after a clear or approved
  review too: it belongs to the version it read, though on the owner's own PR it
  is only an older version), and a stale finding is never counted as waiting on
  the owner.

## The PR flow: roles, turns and hard rules (owner direction, 2026-11-04)

`pr-flow.js` is the single source for who you are on a PR, where it stands, whose
move it is and what you may do. Screens ask it; they do not work it out again.
`test/pr-flow.test.mjs` walks every role and state and fails if a rule breaks.

**Two roles.** *Author*: you wrote the PR (or an agent of yours opened it). *Reviewer*:
someone else wrote it.

**Hard rules.**

1. You never review your own PR in public. No approve, no request changes, no
   suggestions addressed to yourself. An agent's check of your PR is private. The
   server enforces this too: a run on your own PR keeps its result private whatever
   the grant says (`routes/contribution_reviews.py`, `own_pull`).
2. On your own PR you check it, fix it, update the PR and its description, explain why
   you did something, answer every reviewer (fixed, not valid with the reason and an
   @mention, or out of scope) and merge it once someone else approved at the current
   version with green checks.
3. On someone else's PR you review it, request changes or approve, and review again
   after they respond. You do not change their branch unless you deliberately take it over.
4. An agent never posts, approves, requests changes or merges by itself. It drafts;
   only your tap sends it. Everything drafted waits under **To confirm** in the side
   menu (its page reads **Waiting for your confirmation**), with the exact words it
   would post.
5. A verdict belongs to one exact version. A new push makes it old, and the PR is back
   on your list as "Changed since your review".
6. Whose move it is comes from what already happened, never from a guess.

**States (turn in brackets).** Your PR: Draft (you) · Checking (agent) · Findings to deal
with (you) · Check did not finish (you) · Feedback to answer (you) · Waiting on reviewers
(others) · Approved (you: merge). Their PR: To review (you) · Reviewing (agent) · Review
ready (you: send or set aside) · Waiting for your confirmation (you: confirm or discard)
· Waiting on the author (author) · Changed since your review (you) · Reviewed (nobody).
Merged and Closed end every flow.

**What an agent can be asked.** Review: both roles (private on your own PR). Address
feedback: your own PR only. Review and merge: someone else's PR only. Hand it over (fix
and merge): both, and on someone else's PR it is a deliberate takeover.

Not wired to `pr-flow.js` yet, by design of the staging: the PR row chips, the Review tab
words and the menu's visibility of the owner's own actions still use their older
derivations; they move onto it when the menus are sorted.
