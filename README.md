# app-contribute — Contribute

See your project changes, prepare them privately, and follow shared reviews
through acceptance and local updates.

A [Möbius](https://github.com/mobius-os) catalog mini-app. Install it from
the in-app App Store.

## What it does

Möbius apps and the platform itself are open source. When your agent fixes
a bug or adds a feature, it can offer to share that change upstream so it
ships to every Möbius user — but only with your explicit go-ahead on each
contribution. This app is the dashboard for that loop:

- **One project workspace** — local changes, prepared work, incoming review
  requests, public progress, questions and history belong to their project.
  There is no separate Reviews destination. All, **With local changes** and
  **Behind GitHub** filter the same searchable overview, where each project
  carries a Platform or App tag and apps with nothing to do fold away.
- **To look at first** — a project opens on what needs you on its tracked
  contributions, blockers before news. Each row names the reason (Merge
  blocked, Checks failing, Changes requested, New feedback), the affected PR
  and its related group, and when it was detected; its button says what it
  opens. A blocker leaves the list once GitHub shows it resolved. A blocker
  pushed aside by a newer reason comes back, without a second push
  notification, while GitHub still shows it.
- **One tab per job** — under To look at and the project's status, **All PRs**
  (the default), **Review requests** and **Agent runs** (agent jobs, agent
  reviews, agent activity and finished work) split the project by what the
  owner came to do. Saved public work the live list cannot show stays on All
  PRs, so an unreachable GitHub never hides it behind another tab.
- **Task-first controls** — open a project to see its work list beside one
  contextual task, with a compact project switcher rather than another sidebar.
  The project's status says in plain words what is local ("2 files changed on
  this Möbius") and how it compares with GitHub; **Make
  PRs from local changes** is the main action and appears only when there are some.
  A permitted maintainer can choose **Follow through to merge** without granting
  unknown future public actions. Contribute does not update projects itself:
  when GitHub has updates it links to the place that applies them, Settings →
  Updates for Möbius and the App Store for apps. On phones, a task takes the
  screen and **Back to project** restores the same inventory.
- **Sync with GitHub** (in the header) — reloads this Möbius and asks GitHub, read-only, whether
  each project's repository has commits newer than the one this Möbius last
  compared with (`upstream-check.js`, one GraphQL query through the platform
  proxy). It reports commits, never files: what an update changes is still the
  reconciliation answer, and a quiet project reads "Up to date at the last
  check" until a fresh check says more.
- **Choose scope** — prepare all local work in a project, or find a source
  conversation, open it and ask it to prepare its changes. This metadata
  picker requires the companion platform source-chats route; older runtimes
  show an actionable error and leave project preparation available.
- **Exact batches** — ready work can be inspected and approved together within
  one project. Sending is not merging; stale heads and incomplete stacks
  keep the existing guarded boundaries. Questions appear before optional work
  inventories, with source and review conversation links available in detail.
- **Deliberate project membership** — GitHub access alone does not add a project.
  Local projects form the main list. Use **Add repository** to follow another
  GitHub project; existing external contributions and incoming requests remain
  discoverable under **Other repositories**, including when offline.
- **One approval, either surface** — agents normally give an exact approval link
  into Contribute. Explicit approval in the owning chat uses the same guarded
  review-run path without a duplicate click. Opening a link is never consent;
  stale versions, lost merge receipts, permissions and repository protections
  still gate public actions. Chat consent requires the companion backend update.
- **Honest shared status** — local work and shared-version status are visible,
  not hidden inside file details. Ordinary refresh reads recorded source facts;
  it does not fetch online or certify linear history. Missing source does not
  hide saved contributions. Community review requests and historical replies
  remain discoverable even for repositories not installed here.
- **Connected GitHub identity** — anyone can prepare and review changes
  privately without connecting GitHub. Sending new contributions requires a
  connected GitHub account and publishes as that account. Existing records
  marked `submission_mode: "mobius-bot"` retain their legacy Möbius service
  identity and recovery path. Account setup lives in one compact settings
  panel; settings never prepare or publish changes.
- **PR workflows** — each project shows all open PRs, with All, Unassigned,
  Assigned to me and My PRs filters. Select individual PRs or a batch for
  private **Review**, pinned **Review & merge**, or explicitly scoped
  **Review, fix & merge**. Takeover repairs only the named PR file scope via
  guarded fast-forward publication and freshly independent full-diff review
  of each successor. Public comments/reviews are not part of this grant.
  Independent reviewers use durable programmatic children with frozen prompts
  and model settings; questions stay in their review
  conversation. Assignment uses GitHub's shared, additive assignee list.
  Repo permissions control assignment/merge; admins manage access on GitHub.
  The companion platform review-runs backend must be activated before actions
  can start. No browser or agent-writable ledger can grant itself merge access.
  Changed versions stop, normal repository protections still apply, and queued
  work remains queued until GitHub confirms a merge.
- **GitHub account menu** — shows which GitHub account Contribute uses.
  The account itself is connected, upgraded (for example, adding private
  repositories), and disconnected in **Möbius Settings → Accounts → GitHub**;
  Contribute's buttons open that row, and Contribute re-reads the account
  whenever you come back to it. Full PR access is the default so reviewed
  workflow changes and stale forks cannot interrupt sends; older
  reduced-access connections can be reconnected in Settings. This version
  requires a Möbius shell with the GitHub Settings row.
  The account and Contribute's own settings live in the top toolbar, while the
  Projects row reserves its space and reports its own refresh instead of
  making counts pop into the layout.
- **Work list**, grouped:
  - **To look at** — actual blockers and feedback, linked to their owning work.
  - **Prepared proposals · not shared** — private drafts waiting on your go-ahead. Each card
    shows high-level review context first: repo, branch, diff stat, and
    summary. Open the card to review exactly what would go public: the action
    ("New PR to…", "Comment on…"), the full markdown-rendered body draft, a
    note when the commit omits the Möbius Agent co-author trailer, and a
    structured diff only when you ask for the excerpt or full patch.
    **Send PR for review** calls the platform submit
    endpoint directly; the server recomputes the reviewed branch diff and, when
    a reusable fork is stale, adapts the reviewed topic branch to its existing
    base without changing the fork's default branch. It then pushes the branch,
    opens the PR on GitHub, and records the URL. A diverged fork is left
    untouched and the send stops with an actionable error. Non-PR records are
    review-only for now; **Leave feedback** returns to the chat that prepared
    the record. **Dismiss** marks the record
    abandoned — a compare-and-swap write when the
    runtime returns a version (older runtimes fall back to a best-effort
    re-read), so it avoids racing a concurrent submit; either way it needs a
    live connection (offline, the app is read-only: the feed still renders from
    its cache, but dismissing waits until you're back online). Records
    staged by an older agent without a review plan still show the plain
    card with both buttons.
    Dependent PRs can be prepared as a **stack**: Contribute renders their
    `base → branch` topology as one linked review, keeps every incremental
    body and diff independently inspectable, and uses a second explicit
    confirmation to publish the enumerated chain parent-first. True stacks
    use dedicated upstream `stack/**` branches and therefore require upstream
    push permission; independent contributions continue through the safer
    reusable-fork path. Incomplete or mismatched chains stay reviewable but
    cannot be sent. A retry can keep an already-open or draft parent in view;
    if that parent has merged, Contribute asks the agent to refresh the
    remaining layers on `main` instead of silently changing the reviewed diff.
    Sending never grants merge. Any later acceptance uses a separate exact
    confirmation and GitHub's normal merge or merge-queue rules. Parent-first
    acceptance rechecks the remaining stack before progressing; it never
    blindly advances a repository ref because checks are green.
    A durable upstream conflict remains **Needs update** until the agent
    refreshes the reviewed contribution; retryable service errors do not mask
    a later fresh local check. If the browser loses a submit response,
    Contribute re-reads the durable ledger before reporting failure or offering
    another send, so a PR that GitHub already accepted is recovered instead of
    shown as a raw network error.
  - **Contributions** — live PRs with shared responsibility and review status.
    Saved public records remain visible if GitHub is unavailable; a row is
    consolidated only when the live inventory represents every PR in its unit.
    The scheduled job also checks for activity that needs follow-up.
  - **History** — merged, closed, commented, and abandoned, collapsed by
    default so active work remains the focus.

When a tracked PR becomes merged or closed, Contribute removes only its
disposable local staging checkout. The ledger record, reviewed diff, reusable
GitHub fork, and GitHub topic branch remain available.

The GitHub token stays server-side and never reaches this app. The app can read
GitHub state and can call the single prepared-contribution submit endpoint after
you approve a specific PR; it is not a general GitHub write proxy.

The repo also ships the `contributing/` folder skill, the agent-side guide for
the whole loop — studying existing upstream work, staging a reviewable plan
here, the approval gate, and the exact command sequences. The manifest
declares it under `skills`, and the platform installs the folder into the
shared skills directory on install and update, so the skill always matches
the app version. `contributing/SKILL.md` is deliberately a short core (hard
stops, privacy allowlist, approval gate, and a routing table); the per-mode
procedures live beside it (`cycle.md`, `prepare.md`, `branch.md`,
`ledger.md`, `publish.md`, `maintainer.md`, `ci.md`, `legacy-bot.md`), with
the facts that differ between targets in project adapters
(`adapter-mobius.md` for Möbius platform and app projects,
`adapter-github.md` for any other GitHub repository). They are linked
relatively, so an agent re-reading the skill after context compaction pays
only for the core and the one mode it is working in.

## The redesigned desk

- **Four views, one count.** The side menu is Needs you, Review requests, My PRs
  and Agent runs, then a **Repositories** block of its own (More repositories,
  All repositories, **Add repository** last). The Needs you chips (To look at,
  Review, Merge, Fix, Agent runs) filter the list under them, and the badge is
  their sum. Drafts ready to open are a quiet line; local changes are a banner
  on each project page. On a phone the four views are one segmented bar.
- **A next step on every PR.** A state line (Draft, In review, Approved, Merged)
  and one panel under the facts: a pill, the PR machine's own sentence and one
  filled button. On a phone the button pins to the foot of the page.
- **Commits tab** after Comments, from one GraphQL read (`commits(first:50)`,
  cursor paging): grouped by day, each commit with title, authors (agent commits
  marked), time, the checks' result in words, short hash, **Copy hash** and a
  GitHub link. A line shows where your last review stopped, and **Review again**
  is offered for newer commits.
- **One name per meaning** (`names.js`), **three button types** (`button-theme.js`)
  and **one token sheet** (five radii, four type sizes). Guard tests keep retired
  names, raw sizes and the old per-screen button classes out. See DESIGN.md.

## Requirements

- A Möbius platform version that provides the `/api/github/*` surface
  (`/api/github/status`, fetch-free `/api/github/source-status`, and the
  read-only `/api/github/graphql`). On an older
  platform the connection card says so and points you to update. If the status
  request 404s, ask your agent to update the platform.
- This app declares `permissions.github_access: true` in its manifest. That
  permission is what lets its app-scoped token reach the read-only GitHub
  status + GraphQL endpoints; the platform enforces it server-side.

## How it stores data

The ledger is one JSON file per contribution under the app's own storage
(`contributions/<id>.json`), written by your agent from chat and by a daily
cron job (`job.sh`). This app reads it via `window.mobius.storage`; the cron
job reads and updates it via the storage API with the service token. Record
shape:

```jsonc
{
  "id": "…",
  "type": "pr | issue | issue_comment | discussion_comment",
  "repo": "mobius-os/app-notes",
  "number": 42,
  "url": "https://github.com/mobius-os/app-notes/pull/42",
  "title": "Fix note reordering",
  "status": "prepared | submitting | draft | open | landing | merged | superseded | closed | commented | abandoned",
  "branch": "fix/notes-reorder",
  "chat_id": "…",
  "created_at": "2026-07-06T09:00:00Z",
  "updated_at": "2026-07-06T09:00:00Z",
  "summary": "One-line, partner-facing description.",
  "last_submit_error": "optional partner-actionable submit failure",
  "last_pushed_branch_url": "optional branch URL if push succeeded before PR creation failed",
  "needs_attention": true,
  "attention": {
    "type": "checks_failed | changes_requested | github_activity | merge_conflict | human_required",
    "title": "Checks failed",
    "message": "The latest GitHub checks are failing.",
    "url": "https://github.com/…"
  },
  // Blockers displaced from the one attention slot while GitHub still shows
  // them; the job puts the first one back when the slot frees.
  "waiting_attention": [{ "type": "merge_conflict", "key": "…" }],
  // Display-only MIRROR of the autopilot state (see below). The real grant +
  // claim live in a platform DB row; this block is written by the platform for
  // the app/cron to render and must never be treated as authorization.
  "autopilot": {
    "enabled": true,
    "granted_at": "2026-07-06T09:05:00Z",
    "state": "idle | responding",
    "rounds_used": 1,
    "last_round": { "outcome": "pushed | replied | stale | failed | escalated", "summary": "…" },
    "rounds": [ /* recent entries, capped */ ],
    "ignored_event_urls": [ /* exact recent replies posted by the platform */ ]
  },
  // On records staged for review (status=prepared), what the agent proposes
  // to publish; the full diff lives beside the record as
  // contributions/<id>.diff (raw text).
  "plan": {
    "action": "pr | issue | issue_comment | discussion_comment",
    "repo": "mobius-os/app-notes",
    "target_url": "…",          // for comments: the issue/discussion
    "title": "…",
    "body_draft": "…",          // the exact text that would go public
    "branch": "…", "repo_path": "…",
    "base_sha": "…", "head_sha": "…", "diff_sha256": "…",
    "diff_stat": "…",             // diff_excerpt is legacy — omit it
    "prior_work": {                   // private evidence shown in Details
      "searched_at": "2026-07-22T16:00:00Z",
      "query": "notes reorder stale save",
      "decision": "distinct_pr",    // none | comment | collaborate | distinct_pr
      "summary": "An older PR covers ordering but not stale-save recovery.",
      "matches": [{
        "url": "https://github.com/mobius-os/app-notes/pull/12",
        "title": "Keep note order stable",
        "relation": "partial"
      }]
    },
    "labels": ["bug", "area: ui"], // one type plus at most one area
    "stack": {                     // optional: one complete 2–12 PR chain
      "id": "notes-flow",
      "name": "Notes flow",
      "position": 2,
      "total": 3,
      "parent_record_id": "notes-flow-01",
      "base_branch": "stack/notes-flow/01-model"
    }
  }
}
```

PR labels stay deliberately small: one change type and, when useful, one area.
They are visible in the expanded review before Send. Contribute applies only
labels that already exist in the target repository; it never creates taxonomy
as a side effect of publishing a PR.

`submitting` means the platform submit endpoint has claimed the record and the
action is in flight; `commented` is the terminal status for comment actions.
The scheduled job (every 15 minutes) also reconciles prepared PR records whose
reviewed work reached the target repository's main through another path. Exact
reviewed commits or diffs become `merged`; an exact merged branch or a strong
match of distinctive added identifiers becomes `superseded`. Both keep the
landing PR or commit reference. Weaker identifier evidence leaves the record
prepared and adds a **Looks already landed** dismissal hint instead. Every
reconciliation write uses the record version originally read, so a concurrent
Send, Drop, or agent refresh wins.

The scheduled job also adds `needs_attention` + `attention`
when GitHub activity, changes requested, failing checks, or a merge conflict need
follow-up. It and the dismiss flow both write with `If-Match` (compare-and-swap)
when the runtime returns a version, so concurrent writers — the agent, the cron
refresh, the Dismiss button — avoid silently overwriting each other. On older
runtimes that don't return a version, Dismiss re-reads and re-checks the record
before writing, while the cron refresh falls back to a plain best-effort write.

## Actions, answers and PR reviews

**Actions ▾** (on a PR row and its page) has a **You** group and an **Agent**
group. **Open for review** (a draft this app sent) and **Merge** (where the
platform advertises `merge_now`) each end in a confirm sheet naming what happens
and what cannot be undone. New PRs open from one split button, **Open as draft**
or **Open for review**; Settings → *New pull requests start as* sets the default
(the shipped default is Ready, as the product states). A finished review that
found problems offers **Fix these findings**, **Ignore…** (one reason, for that
exact version, stored in the app settings as `ignored_reviews`, nothing posted),
**Review again** and **Ask the reviewer something**. **Agent runs** in the side
menu lists the reviews you started by project (Running, Finished); it reads the
live state of every PR (in batches of 25), again on each Sync with GitHub; a PR
GitHub does not return reads Couldn’t read, with Try again, and a run that waits
on you counts in Needs you instead. A write whose answer is lost or unreadable,
whatever its status, is unconfirmed: it is read back and never repeated from the sheet.

## Continuous Project Desk: private PR review runs

The existing project workspace keeps the local and GitHub position and **Make
PRs from local changes**. PR state, private proposal, exact-head review,
agent execution and settled history remain separate. Named paused work stays
visible as unfinished; this iteration does not resume old cycles automatically.

Review/Fix/Merge guidance shares one flat Settings editor. At launch choose
**Actions ▾ → Review** (who sees the result: **Only me**, **Draft for me** or,
where this Möbius supports it, **Agent posts**; with a draft, optionally **Merge
after I approve**; a switch only where it can be turned on), **Review** on your own
PR (a private check), or **Finish it for me** /
**Take over**, plus model and effort, in the review window. Settings →
*Default agent* saves one agent and effort (`review_agent` in the app settings)
that Review, Review again, Finish it for me, Take over and Respond to feedback start
from; each window still lets you pick another agent for that one run, and with
none saved the windows follow the Möbius background agent setting. There is
no automatic-continuation option: the platform does not support it. Each launch
sends only the options its mode accepts: review and merge prompts always, the
fix prompt only for Review, fix & merge (new takeovers have no repair-round
limit), and the post-review grant (with its verdict form) only for Review only,
with or without merge. The mode-aware
`review-preview` freezes the exact instructions and agent choice for that mode;
start passes its `preview_sha256` and rejects drift. Mandatory safety
instructions are platform-owned. With the post-review grant, the agent may post
one comment review per PR, and only for a verdict it explicitly marks public;
questions to the owner stay private. With merge as well, the review is posted
first and the PR merges only after GitHub confirms that review and the
required checks pass. **Allow approve or request changes** turns that public
verdict into a proposal: the run shows the exact approve or request-changes
text with **Approve on GitHub** / **Request changes on GitHub** and **Discard**,
and nothing is posted until you choose. Only your own tap can submit it; the
review agent cannot. A pending, discarded or changes-requested verdict never
merges; a submitted approval resumes the review conversation to run the usual
merge checks. GitHub does not allow verdicts on your own PRs, so those get a
comment instead. Re-reviewing after the author responds is a new review you
start yourself. These options need a Möbius that advertises
`post_review_merge` and `propose_verdict`; an older one keeps posting and
merging apart and hides the verdict switch.

A run publishes necessary takeover repairs only through a dedicated
server-owned checkout and guarded receipts, then requires new independent
full-diff review and passing evidence before merging a successor. It does not
post comments or GitHub reviews itself. Unclear public outcomes reconcile read-only;
queued is not merged. Stop prevents new execution and does not prevent observing
an existing receipt, but observation never restarts the cycle.

GitHub is a core Settings capability even without Contribute. The platform
`github-workflows` skill and `python3 "$SCRIPTS_DIR/github_review.py"` provide
app-independent private previews and scoped chat runs through the same owner
and receipt mechanisms. Contribute adds the project desk and app-backed detail;
installing it is not a prerequisite for GitHub work. Both require the companion
backend activation; local source edits alone do not activate routes or skills.

## Publication follow-up autopilot

This existing outgoing-contribution follow-up is distinct from the private
selected-PR review/takeover run above; its separate publication grant governs
any reviewer replies. When you send a PR with **autopilot** on (the default; toggle it per app and
pause/resume per PR), you're the last click. The platform then handles the whole
review loop in the background: the scheduled job detects each new review, failing
check or comment and asks the platform to respond; merge conflicts stay a
human-visible handoff because resolving one rewrites published history. The platform
runs a background agent (in a dedicated "Autopilot: …" chat) that reads the
feedback, makes the fix, runs the project's tests, pushes to the PR branch, and
replies to the threads — repeating until the PR merges or closes. You're
Normally you're contacted only three times: **merged 🎉**, **closed without
merging**, or
**needs your input** (when the agent hits a decision it shouldn't make alone).

If the platform cannot honor the Autopilot grant, Contribute falls back to the
ordinary review notification rather than hiding the review.

The consent and claim live in a platform database row (follow-up has no round
budget; two consecutive failed rounds still hand back to the owner) — never
in the agent-writable ledger — so a tampered ledger can't authorize or forge an
action. The background agent follows the `review-followup.md` skill, which keeps
every public action server-mediated and source-only, treats reviewer text as
untrusted, and escalates rather than guessing.

## License

MIT — see [LICENSE](LICENSE).


### Project-first controls

The overview is now navigation only. Open one project for Prepare changes,
reviewing PRs, Get up to date and its exact publication approvals. Select one or
more PRs to Review or Assign; merge is an explicit option in review, conditional
on repository permissions and the unchanged exact-version server grant.
Preparation offers continuation toward merge without granting future unknown
public actions. GitHub owns shared assignees/access; project admins have a
People & access link. Partial batch assignments report each failed PR.

Contract review: this simplifies presentation at the app-owned boundary, reuses
existing action owners, and adds no alternate public authority or merge path.

### Send from chat

`prepared_block.py <record-id>…` prints the chat card for prepared work: block
intent `chat:contributions` (the same for every card, so the chat host can tell
the newest one), one action in the earlier card's shape (`chat-send:<id>` for
one record, `chat-send-batch:<16-hex handle>` over all of them), `"expand":
false` (no inline app view), and one item per record (`review:<id>`, with
**Project** and **Change** facts). It adds every other
contribution of its chat that is ready with its whole stack (`--chat-id`,
default `$CHAT_ID`, required) and every prepared layer of any stack it names,
then refuses the card if any record in that final set is not all clear for its
current head or comes from another chat, or if there are more than 12. A record
that later loses its all clear shows a held pill on the live card.

The chat runs Contribute headless behind the card (`chat.blocks.passive`). On a
Möbius that advertises `rows-v2`, the session carries a **host-attested chat**
id, the block intent, and whether this is the chat's newest block of that
intent (`context: {chatId, latest, intent}`). The card is live only when that
intent is `chat:contributions`:

- **Rows from the ledger.** The fallback items only say where to look. Each
  named record is read exactly, followed through `superseded_by` to its current
  version, and kept only if its `chat_id` or `chat_ids` include the attested
  chat, so a card printed in one chat never shows or sends another chat's
  records, whatever its items name. The card reports these as the host's
  `rows`: title over `owner/repo · 2 screenshots · Layer 1 of 2 · +a −d`
  (on a host with `lines-v1` the change size is the row's `lines`, drawn with
  additions green and deletions red; otherwise it is text in the line), with
  its state in words (Sending, Checking GitHub, Draft, Merged, Closed, Not
  sent, Not confirmed, Dismissed, Replaced) and the PR link once published.
  An open PR needs no word beside its link, and a state every row shares and
  the header already says is not repeated on each row. The header says the
  state ("2 contributions", "Checking contributions", "2 ready to send",
  "Sending 2…", "Checking GitHub…", "2 pull requests opened", "Sending 1 ·
  checking 1…", "1 of 2 sent · 1 needs a fix", "2 of 3 sent · 1 not confirmed",
  "1 of 2 sent · couldn’t load 1", "2 need a fix"), with a
  check, spinner or exclamation mark. It is a neutral count until a tap's
  check finds the set ready, and loading is never shown as empty. Every held
  record shows its own reason and is counted; an unreadable record or a
  blocked GitHub account is named as such, never as a fix. While a
  check, a send or GitHub's answer is underway the header says so and no
  button is shown.
- **Newest card wins.** Only the newest card can start or confirm a send. A
  card that is not the newest drops an open confirmation; while it owns an
  unresolved send it keeps showing it, and otherwise folds to one line,
  "Continued below", and reads nothing.
- **Unresolved records hold.** A named record (or successor) that is gone
  shows **Not in Contribute**, and one whose fresh read failed shows
  **Couldn’t check** with **Try again**, even if an earlier copy is cached;
  either holds the card. A failed
  successor read is retried on the next trigger.
- **Cheap freshness.** It reads its records (exact storage reads; no GitHub or
  source check) when it mounts, on the host's `app-block-refresh` after a turn
  in its chat settles,
  and when the tab is shown again (if the last read is older than 30 s); a
  trigger during a read runs one more read after it. The source and review are
  checked only when the owner taps the action, for the records that tap's own
  read found, and a check younger than two minutes is reused only for the exact
  record versions (head, base, diff) it was asked for; a record that changes
  while it is checked ends the tap with **Try again**.
- **Confirm.** Tapping **Send** (or **Send N**) starts a
  send-only runtime that renders nothing and reads the complete ledger, the
  GitHub connection and the review status of exactly the records waiting to
  be sent plus every prepared layer of their stacks. It then turns the same
  button into **Not now** / **Confirm** and reports its own row for every
  change it will send, with the card row's values (project, screenshots,
  stack layer, change size; the block's `confirm_facts: "values"` keeps the
  labels for assistive technology only). The
  action covers every record waiting to be sent or none: if one is not in
  the exact phase Confirm would send (a stack layer due later included) or
  cannot be sent, its row gets a short pill (Needs review, Not sent, Needs a
  fresh check, Source changed, Conflicts, Upstream moved, Wrong author, Stack
  incomplete, Parent merged, Parent changed, Stack not valid, Sent after its stack, Send in
  Contribute) and the action becomes
  **Fix in chat** (below), or **Open Contribute** where it cannot be. Confirm calls the
  same guarded Send handlers as the workspace and passes the confirmed snapshot
  as `expected_record(s)`; without that platform binding the card never sends,
  including when the binding disappears between Confirm and the write: each
  write reads the platform's status again first, and a read that fails counts
  as no binding. A set that changes after the tap does not change what that
  Confirm sends.
  Independent units are sent in parallel; a stack's layers in order. Only
  attempts whose outcome is unknown survive a reload, as a bounded checkpoint
  of ids, and lock their unit until a read shows the result. An unknown outcome
  (a lost response, or a 503 `publication_unconfirmed`) is observed on a
  backoff for ten minutes after the send: the platform's read-only
  `/observe` route reads GitHub against the attempt's signed receipt, and the
  card re-reads its records. A settled answer shows the PR; a branch whose PR
  is not confirmed stays **Checking GitHub**; a changed target holds the row
  as **Changed on GitHub** and asks the agent with `publication_changed`; a
  record with Autopilot on that the platform leaves to Autopilot shows **With
  Autopilot**. Neither of the last two is ever proof that nothing was sent;
  both stay locked. Each answer belongs to one record version: a late answer
  for an older one is dropped, and a new version is observed afresh. After
  the window the row shows **Not confirmed** and asks the agent to check it;
  it is never resent. The workspace's refresh and the scheduled job observe
  uncertain records too (a bounded few per pass; the job only past the card's
  window, as a load heuristic, so an occasional duplicate read is possible);
  a Möbius without the route keeps the ledger-only recheck, and the earlier
  card keeps the attempt unknown and locked. A row whose send failed shows
  **Not sent**, with the reason as one line beside the action; the action is
  **Retry** when the guarded send path accepts those records again (sent rows
  are never resent), otherwise **Fix in chat**.
- **Fix in chat.** On a host that draws asks (`ask-v1`, which needs the
  owner's `chat.blocks.ask` grant), a held or failed row the agent can repair
  turns the action into **Fix in chat** (`card-asks.js`). The card reports
  only the record id, a code and `rev`, a digest of the code and exactly the
  fields that define that cause (the reviewed source for source causes, plus
  the title and body for text and review causes, the review verdict, the
  attention type and key, or the failed attempt's own stamp), never a
  record-wide timestamp; one tap
  sends the host's own visible owner message into this chat, a fixed sentence
  and a `contribute · <record id> · <code>` line. The host posts one ask per
  state once, so a repeated tap says "Requested in chat" until the agent
  restages. Its codes are `commit_identity_mismatch`, `invalid_pr_text`,
  `publication_destination_unavailable`, `needs_review`, `changes_needed`,
  `upstream_conflict`, `upstream_base_moved`, `source_changed`, `send_failed`,
  `needs_attention`, `not_in_contribute`, `couldnt_check`, `restage`,
  `stack_incomplete`, `stack_parent_merged`, `stack_parent_changed`, `result_unknown` and `publication_changed`; the contributing skill's "Card
  asks" says what the agent does for each, ending with a fresh card. No
  title, template or GitHub error text is in the message. The app gets no event from the tap and nothing is
  sent to GitHub; only Confirm sends. A GitHub connection problem is the
  owner's, so the action names the account (**Connect GitHub** or
  **Reconnect GitHub**) and opens it in Contribute instead. A relay record, a
  stack layer waiting for its turn, a retryable check (**Try again**) and an
  unrestorable result keep their earlier action. Without `ask-v1` the action
  opens Contribute, exactly as before.

On a host that attests its chat, a card printed before this design (a block
intent other than `chat:contributions`) never sends: it shows its records as
rows, filtered to the attested chat exactly like the live card, and no action
(**Try again** when a record could not be read, which only reads).

**Older hosts.** On a Möbius without `rows-v2`, or outside a chat, there is no
attested chat, so every card, this one included, runs exactly as the earlier
card did (`inline-session-v1.js`, unchanged): its record set is the host's
`items` and nothing else, its action must match them exactly (the one record,
or the handle over all of them), and Confirm sends exactly those, all of them
or none, with the same frozen, server-bound snapshot. Nothing an older host
can send is widened. Opening `chat:contributions` in the app shows the
contributions waiting for review.

### PR links from chat

`pr_block.py owner/repo#123` prints a static chat block for one PR. Opening it
sends the intent `pull-request:owner/repo#123`: Contribute opens that PR's
project, reads the exact PR (closed or beyond the first page included), opens
its detail and highlights its row. The PR stays pinned only while that detail
is open; leaving it or the project releases it. Closed PRs are read-only. The
detail's **From** line links the local preparation and the source, review and
fix conversations for that exact repository and number. The block declares no
executable capability and grants nothing.

### Respond to feedback: the saved answer

A Respond-to-feedback chat never reviews the PR again and never publishes. When it
finishes it runs `respond_result.py save`, which records what Git and GitHub say (the
commits as a bundle, the changed files, the PR head) beside the agent's own part (each
point and how it ended, the exact replies, the description, who to ask again, the tests)
in `respond-results/<owner>__<repo>__<number>.json`. The PR's Review tab shows it with
**Post**, **Reply in chat** and **Discard**. Post writes the owner's approval
(`respond-decisions/<slug>.json`) for that exact result and its digest, then tells the
same chat to run `respond_result.py post`, the only command that publishes. **Post is off
until the host can vouch for the owner's press**: an approval file is not proof, because the
agent can write it, so Post works only on a Möbius that advertises the `owner_grant`
capability (none does yet); until then the button is disabled with its reason and `post`
refuses. Past that gate, `post` refuses unless the approval names this result, its content
is unchanged and the PR is still where the work was built; then it uploads any screenshots
the answer attaches (to the repository's `mobius-screenshots` branch; the card lists each one
on its own and Post stays off until it is on screen, so the owner has read every byte; an
earlier upload is reused only once its public addresses serve those bytes), pushes the
commits (a fast-forward, never forced, so they keep their ids), posts the replies, updates the
description and asks for the re-review, recording each step so a second run repeats
nothing. The files, rules, exit codes and the app side are in `respond-result.md`.

## How the screens stay in sync

The app gets no push from Möbius or GitHub, so one sync hub (`refresh.js`, `createSyncHub`) decides when anything is read again; no screen keeps a timer or a focus handler of its own. The one exception is the legacy relay-submission check in `index.jsx`, which polls every 30 s only while a relay-submitted PR is still being confirmed. A pane tiled beside a chat is shown without ever being focused, so the hub follows the shell's visibility signal (`window.mobius.onVisibilityChange`, with the page's visibility on an older Möbius), not window focus.

- **Hidden: no reads.** Shown again: the platform lists are read at once.
- **Review runs and Respond conversations** (a platform read, shared by the Desk, the PR page and the Agent runs view): every 10 s while a review or conversation is at work, every 30 s otherwise.
- **Saved Respond answers** (the app's own storage, not GitHub): every 2.5 s while an answer is being posted and for five minutes after Post, every 30 s otherwise, so the card follows the posting script step by step.
- **GitHub** is watched by a probe once a minute (one point per 100 reviewed PRs): the open review requests and the PRs you reviewed. A moved review request reads the full list (55 points, seconds) at most once every 5 minutes on its own; moved reviewed PRs are read together, only those, in one read at most every 5 minutes on its own. A busy hour with one reviewed PR moving every minute costs about 730 points; with many different ones moving every minute it is capped near 1,400, and automatic reads stop below 1,000 points left. A review that changed state (not each turn of its conversation) reads its PR and the requests at once; a posted verdict answers its request locally, because GitHub's search lags.
- **Budget:** below 1,000 points left, automatic GitHub reads stop until you press **Sync with GitHub**; the platform reads go on. Sync and your own actions always read, including the PRs you reviewed.
- **Adding something to read again?** Register it as a fact (`hub.fact(name, { read, apply, every })`), mark it `github: true` if it costs points, and let `hub.refresh(name)` serve the actions that change it. The heavy contribution-history pass stays behind Sync, with no timer.

The `runSyncChecks` scenario of the browser fixture runs the whole app on a fake clock with a frame nobody focuses, and holds each outside change to its bound.

## Workspace checks

Run the local unit, rendering and Python contracts:

```bash
MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules npm test
```

Run the real Chromium interaction fixture:

```bash
MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules npm run test:browser
```

The browser fixture uses the real workspace components with disposable local
data and mocked requests, chat actions and publication. It checks desktop and
phone journeys without GitHub writes or agent starts. It requires an installed
Chromium (`CHROMIUM_PATH` can name it), blocks external network traffic, and
cleans up its temporary profile. Live permission, activation and source-chat
navigation checks are separate; passing this fixture is not a public merge.

**Sync with GitHub** renews source, contribution, PR and run status without pulling code, asks GitHub whether anything is new, and says when it last did beside the button. **Make PRs from local changes** opens its launch panel independently of old dormant work; older Pull cycles stay visible as agent jobs, but Contribute no longer starts them. Prepare's **Follow through to merge** (offered with merge rights) starts a full merge cycle. Once a project has work, its Project work row shows the current conversation, cancellation and retained history, also without merge rights; a fresh cycle start needs them. All of a project's agent work (Prepare, Pull and full merge cycles) runs in **one** app-owned conversation, scoped `contribute-cycle:<project digest>`; the platform keeps at most one active conversation per scope, so a project cannot have two owners. Cycle k is one message in it with the deterministic id `<scope>:k`: the first cycle uses the platform's scoped start, later ones send to that conversation. The platform de-duplicates that id per conversation, so every delivery (Start, **Send again**, after a reload) first re-reads the project record (online CAS) and acts only while k is its current, unconfirmed cycle; a stale or delivered cycle sends and changes nothing. The first attempt is recorded before it is made and is the only one that may create the conversation. A retry is bound to the conversation that cycle went to; if none holds it any more (deleted, or never created), it is not sent again and the owner starts new work instead. Model and effort are applied until one attempt has applied them. New starts wait while the platform reports work in progress: a running turn, an owner question, or an outstanding Wait, queued message, continuation, non-terminal run or background helper. If the owner deletes the conversation, a delivered cycle counts as finished and the next start creates a new conversation. The conversation's provider is fixed after its first turn, so later cycles may change the model only within that provider. Every launch (project work, review workflows and other agent handoffs) carries its own model choice; leaving it unset uses the chat default. The older single app-wide agent model setting is retired: Contribute removes its saved keys (`agent_provider`, `agent_model`, `agent_effort`) the next time it loads its settings.
