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
  There is no separate Reviews destination. All, **With your edits** and
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
  (the default), **Review requests** and **My work** (agent jobs, agent
  reviews, agent activity and finished work) split the project by what the
  owner came to do. Saved public work the live list cannot show stays on All
  PRs, so an unreachable GitHub never hides it behind another tab.
- **Task-first controls** — open a project to see its work list beside one
  contextual task, with a compact project switcher rather than another sidebar.
  The project's status says in plain words what is local ("2 files changed on
  this Möbius") and how it compares with GitHub; **Make
  PRs from my edits** is the main action and appears only when there are edits.
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
**Review again** and **Ask the reviewer something**. **PR reviews** in the side
menu lists the reviews you started by project (In progress, Done); it reads the
live state of every PR whose review is not merged (in batches of 40), again on
each Sync with GitHub. A write whose answer is lost or unreadable, whatever its
status, is unconfirmed: it is read back and never repeated from the sheet.

## Continuous Project Desk: private PR review runs

The existing project workspace keeps the local and GitHub position and **Make
PRs from my edits**. PR state, private proposal, exact-head review,
agent execution and settled history remain separate. Named paused work stays
visible as unfinished; this iteration does not resume old cycles automatically.

Review/Fix/Merge guidance shares one flat Settings editor. At launch choose
**Actions ▾ → Review** (optionally **Allow posting the review on GitHub**,
**Allow approve or request changes**, and **Merge when safe**, in any
combination) or **Review, fix and merge**, plus model and effort, in the
review window. There is
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

`prepared_block.py <record-id>…` prints a chat card for prepared work. The chat
runs Contribute headless behind the card (`chat.blocks.passive`): reading the
card performs only exact record reads; tapping **Contribute** (or **Contribute
all**) starts a send-only runtime that renders nothing and reads only the
complete ledger, the GitHub connection and the current review status of the
card's records plus every prepared layer of their stacks. It then turns the same
button into **Confirm** with the app-supplied identity and size of every change.
Confirm calls the same guarded Send handlers as the workspace and passes the
confirmed snapshot as `expected_record(s)`; without that platform binding the
card never sends, including when the binding disappears between Confirm and the
write.
Independent units are sent in parallel; a stack's layers in order. Only
attempts whose outcome is unknown survive a reload, as a bounded checkpoint of
ids, and lock their unit until a read shows the result.

The card (`"expand": false`, so no inline app view) has one item per
contribution: its title opens that entry (`review:<id>`) and its facts are
**Project** and **Change** (`N files · +a −d`, from the staged shortstat,
plus `· N screenshots` when the PR publishes staged screenshots, as Confirm
shows it). The
card itself opens the single entry, the stack all items belong to, or the
review queue. There are no item actions; the one card action is
`chat-send:<id>` for one item or `chat-send-batch:<16-hex handle>` over all
items. The record set comes from the host's session `items` (the card's item
intents), never from block text: the action must match those items exactly,
each item must be a ledger entry, and Confirm is built from Contribute's own
records. A stack phase that includes a layer the card does not list is never
confirmed ("doesn’t list every layer"); `prepared_block.py` lists every
prepared layer of any stack it names. A host that sends no `items` gets no Confirm ("needs a newer
Möbius"). At most 12 items are listed; beyond that the card names how many
more are in Contribute and has no action.

### PR links from chat

`pr_block.py owner/repo#123` prints a static chat block for one PR. Opening it
sends the intent `pull-request:owner/repo#123`: Contribute opens that PR's
project, reads the exact PR (closed or beyond the first page included), opens
its detail and highlights its row. The PR stays pinned only while that detail
is open; leaving it or the project releases it. Closed PRs are read-only. The
detail's **From** line links the local preparation and the source, review and
fix conversations for that exact repository and number. The block declares no
executable capability and grants nothing.

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

**Sync with GitHub** renews source, contribution, PR and run status without pulling code, asks GitHub whether anything is new, and says when it last did beside the button. **Make PRs from my edits** opens its launch panel independently of old dormant work; older Pull cycles stay visible as agent jobs, but Contribute no longer starts them. Prepare's **Follow through to merge** (offered with merge rights) starts a full merge cycle. Once a project has work, its Project work row shows the current conversation, cancellation and retained history, also without merge rights; a fresh cycle start needs them. All of a project's agent work (Prepare, Pull and full merge cycles) runs in **one** app-owned conversation, scoped `contribute-cycle:<project digest>`; the platform keeps at most one active conversation per scope, so a project cannot have two owners. Cycle k is one message in it with the deterministic id `<scope>:k`: the first cycle uses the platform's scoped start, later ones send to that conversation. The platform de-duplicates that id per conversation, so every delivery (Start, **Send again**, after a reload) first re-reads the project record (online CAS) and acts only while k is its current, unconfirmed cycle; a stale or delivered cycle sends and changes nothing. The first attempt is recorded before it is made and is the only one that may create the conversation. A retry is bound to the conversation that cycle went to; if none holds it any more (deleted, or never created), it is not sent again and the owner starts new work instead. Model and effort are applied until one attempt has applied them. New starts wait while the platform reports work in progress: a running turn, an owner question, or an outstanding Wait, queued message, continuation, non-terminal run or background helper. If the owner deletes the conversation, a delivered cycle counts as finished and the next start creates a new conversation. The conversation's provider is fixed after its first turn, so later cycles may change the model only within that provider. Every launch (project work, review workflows and other agent handoffs) carries its own model choice; leaving it unset uses the chat default. The older single app-wide agent model setting is retired: Contribute removes its saved keys (`agent_provider`, `agent_model`, `agent_effort`) the next time it loads its settings.
