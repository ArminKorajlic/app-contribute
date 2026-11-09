# Contributing: prepare one contribution

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. Branch recipes live in
[branch.md](branch.md); ledger writes in
[ledger.md](ledger.md).

## Study existing work before every contribution

Run this read-only preflight early enough to avoid duplicating work, and ALWAYS
run it again no later than before staging any PR, issue, or comment in
Contribute. This applies even when the code is already written or the change
looks novel. A contribution is not ready for review until you have searched by
the problem, subsystem, and visible symptoms, then inspected promising diffs
and discussion. Searching and studying are read-only: no approval needed.

Search the target project, not a fixed organization: use `--repo` for one
repository or `--owner` when related work may live in sibling repositories.

```bash
gh search issues --repo <owner>/<repo> "<problem in a few words>" --limit 10
gh search prs --repo <owner>/<repo> "<same words>" --limit 10
```

The target's adapter may add a target-specific check (the Möbius adapter
checks the App Store catalog before a new app is built).

gh search covers open+closed by default — don't pass `--state` (its search form
rejects `all`, and you want both). Know the repo? List it directly and keep
`-s all` (valid there):

```bash
gh issue list -R <owner>/<repo> -s all --search "<terms>"
gh pr list    -R <owner>/<repo> -s all --search "<terms>"
```

Empty results can be normal for a young or small project; they are not a
broken search.

On a hit, study it (`gh issue view <url> --comments`, `gh pr view <url> --json
title,body,state,comments`, `gh pr diff <url>`), compare correctness, scope,
tests, review state, and activity, then choose exactly ONE:

- **Same sound fix:** do not prepare a duplicate PR. Stage a review/comment only
  when you add evidence, a concrete suggestion, or a useful test result.
- **Promising but incomplete:** prefer a review with specific suggestions. The
  author's branch remains theirs; even when maintainer edits are enabled, do
  not push to it without the partner's explicit approval for that public action.
- **Your ready fix is materially stronger:** prepare a distinct PR that links
  the earlier work, credits anything it uses, and explains the concrete delta.
  Do not claim to deprecate or close someone else's PR; maintainers decide which
  path supersedes another.
- **No relevant hit:** prepare a fresh PR or issue plan normally.

Record the search evidence in `plan.prior_work` (below) so the partner can see
the decision inside Contribute. Every outcome is STAGED for review, never posted.

## Review the code before every PR

Review the branch after the code is written and **before** you build the review
commit, so the partner sees the cleaned-up version. Right-size the pass to the
change: a one-line or docs-only PR needs a careful reread, not a ritual audit;
a behavioral or structural change earns proportionally deeper review. Reading
and editing local source needs no approval and publishes nothing.

Use two passes over the branch diff, in order.

**Pass 1 — strip the slop.** Read your own diff as a hostile reviewer of
machine-written code and delete what a careful human would not have written:
comments restating what the line already says or breaking the file's existing
comment style, defensive `try`/`except` and existence checks on paths that are
already trusted, casts and broad types that only silence a complaint, nesting an
early return would flatten, and near-duplicates of a helper the codebase already
has. Behavior stays identical unless you are fixing a clear bug, and the edits
stay minimal and local.

**Pass 2 — audit the structure the change itself motivates.** Ask whether the
new behavior sits at the layer that owns it and whether a simpler framing can
remove branches, flags, helpers, or layers. These are review signals, not
context-free blockers:

- hand-written source crosses roughly 1000 lines because of the diff (generated
  files, fixtures, data, and long-form prose do not count);
- new ad-hoc conditionals or special cases are bolted into a flow that did not
  care about them before;
- feature-specific logic leaks into a shared or general-purpose path;
- an abstraction, wrapper, or layer of indirection is added without buying
  clarity;
- optionality, `Any`, or loosely shaped dict payloads paper over an invariant
  that should be explicit at the boundary;
- logic lands somewhere other than the layer that already owns the concept, or
  duplicates a canonical helper;
- related updates can leave state half-applied, or independent work is
  serialized for no reason;
- a fix adds a guard, retry, timer, fallback, or early return where the
  symptom appears, and you cannot name the cause it answers. Find the cause
  and fix it in the layer that owns it.

Act on findings that are motivated by this change and make the agreed behavior
clearer or safer, then re-read the diff. Keep unrelated refactors out of the PR.
When an obvious signal is deliberately left alone, record one sentence in the
private `plan.prior_work.summary` review evidence — never in the public
`body_draft` merely to narrate internal process. A larger finding becomes a
follow-up for the partner rather than silent scope expansion.

If the instance has a richer code-quality or slop-removal skill installed,
apply it proportionally here too.

## Thoroughly review prepared work

Treat **review all**, **review this PR**, and **fix and review again** as complete
private review intents. The owner should not have to restate the usual rubric.

1. Refresh each named record and inspect its complete diff. Record
   `reviewing` (the review call in [ledger.md](ledger.md)) only when the
   review will outlast this turn or run in a helper, so others can see it is
   in progress; a review finished in one pass records only its verdict.
2. Review correctness, maintainability, simplicity, tests, security/privacy,
   and avoidable technical debt. Expand into owning callers and invariants when
   the changed surface warrants it; do not turn this into unrelated cleanup.
3. For owner-authored work, fix every sound finding privately, commit it on
   the review branch, restage the record, and repeat the complete review on
   the new head.
   For someone else's work, do not change their branch: prepare concrete,
   actionable suggestions and leave them private until approved.
4. Record `changes_needed` while a sound finding remains and `all_clear` only
   after the complete current head passes. Restaging drops the verdict unless
   the reviewed diff and text are byte-identical.
5. Stop with the durable verdict visible in Contribute. Review work does not
   authorize a push, PR, comment, review, merge, or other GitHub mutation.

## Prepare for review

Nothing goes public here. For a PR, create a durable branch under `/data`
(recipes in [branch.md](branch.md)), commit the exact source you want
reviewed, and **stage** it (the stage call in [ledger.md](ledger.md)).
Staging derives the record's `plan` from Git (`action`, `base_sha`,
`head_sha`, canonical `.diff`, `diff_sha256`, `diff_stat`, `files`, and the
live `source_repo_path`/`source_sha`) and keeps what Contribute needs to
submit it directly after approval. You supply the reviewed text and
classification:

```
title, body_draft, summary,              # required for a new record, with
                                         # repo_path and repo (ledger.md)
labels?: [type, area?], coauthor_trailer?: false,
prior_work?: {searched_at, query, decision, summary?, matches?}
```

`plan.stack` and `plan.after_merge` are maintainer-only fields:
[maintainer.md](maintainer.md).

- Write `summary` for a person who does not know Git or the codebase: one short
  sentence about what becomes clearer, safer, faster, or easier. Do not put file
  names, branch names, implementation terms, or test counts in it. The app uses
  this as the card headline and keeps the GitHub title and source details behind
  **Details**.
- Keep `title` concise and suitable for GitHub. It may use the technical term
  needed by maintainers because it is shown inside the expanded details rather
  than as the primary owner-facing explanation.
- `body_draft` is the FULL text you propose to publish — PR body, issue body, or
  comment, word for word. Review it for accuracy, privacy, and the owner's
  authorized public scope. If the owner approved specific wording, preserve
  those exact words; otherwise apply Hard stop #1 to the publication request.
- A bug fix's `body_draft` names the cause in one or two sentences, then says
  how the change removes it. If the change works around the cause instead
  (the cause is upstream, or its real fix is too large for this PR), say so,
  name the cause it leaves in place, and say when the workaround can be
  removed.
- A change people can see shows it with before/after screenshots in
  `body_draft`: the same state before and after, cropped to the change.
  Capture the before state before you edit; the adapter names the capture
  tool and sizes. Every image leaves the instance, so it must meet the
  screenshot entry of the privacy allowlist in [SKILL.md](SKILL.md). When a
  screenshot cannot show the change (it appears only on a real device, or
  only as timing), say why in the body instead.
- Attach screenshots when you stage, never by pushing them yourself: list
  each image in the stage call's `screenshots` and show it in `body_draft`
  as `![What it shows](screenshot:before-desktop.png)`. Send publishes the
  images and replaces each reference with its public link. The owner
  approves the images together with the text. [ledger.md](ledger.md) says
  when attaching is available and where it is refused; when it is not, leave
  the images out and say in the body that screenshots are not included and
  why.
- Attaching at staging is the normal path. Only for an image that is already
  hosted as a GitHub attachment (one uploaded through GitHub's own editor),
  link the image to its canonical
  `https://github.com/user-attachments/assets/...` URL:
  `[![Screenshot description](URL)](URL)`. GitHub may render a plain image's
  click target as a short-lived `private-user-images.githubusercontent.com`
  URL, even when its Markdown source uses the canonical URL. The explicit
  outer link keeps opening the full image tied to the durable attachment.
  Never put that signed URL or a private Möbius chat-media URL in a public PR
  body, and never publish a body whose image links do not load.
- `prior_work` is private review evidence, not text that is published. Set
  `searched_at` to the UTC scan time, `query` to the concise terms used, and
  `decision` to exactly one of `none`, `comment`, `collaborate`, or
  `distinct_pr`. `summary` is one plain sentence explaining why. `matches` is
  the small relevant subset (normally at most five), each shaped as
  `{url, title?, relation?, note?}` with a GitHub URL. When the decision is
  `distinct_pr`, the public `body_draft` must also reference the relevant prior
  work and explain the improvement; the private evidence does not replace that.
- `labels` is the small, reviewed GitHub classification proposed for a PR. List
  **one type** and optionally **one area**—never more than two total. Prefer the
  repository's existing taxonomy: inspect it with
  `gh label list -R <owner>/<repo> --limit 100` before staging; the adapter may
  fix the taxonomy (the Möbius adapter does). Do not use workflow/status labels
  such as `help wanted`, `duplicate`, or `wontfix` on an already-prepared PR.
  Contribute
  shows these labels in Details and only applies names that still exist in the
  target repository. Missing labels or insufficient permission leave the PR
  open and unlabelled rather than changing the reviewed body or failing send.
- For PRs, `repo_path` MUST be the durable review checkout at
  `/data/contrib/<record-id>/worktree`; a scratch clone under `$TMPDIR` does
  not survive restart and cannot be approved with one click.
- Commit the reviewed source before staging. If GitHub is connected, first set
  the checkout's repo-local `user.name`/`user.email` to the connected owner
  identity (`git config --global --get user.email` should already be the
  owner's no-reply address). The partner is the commit author; Möbius is only
  the co-author. By default the commit message includes
  `Co-authored-by: Möbius Agent <mobius-agent@users.noreply.github.com>`, and
  Send refuses a commit without it.
- `coauthor_trailer: false` is the only way to omit that trailer. Set it only
  when the target project's contribution or AI policy forbids the trailer, or
  the owner asks to omit it. Contribute's review shows the omission; give the
  reason in the message that tells the owner the contribution is ready. Any
  other value, or no field, keeps the trailer required.
- Publication reviews the exact committed candidate, not its installation.
  An ordinary PR may remain uninstalled, and unrelated live edits do not make
  that review stale. Never install private work or invent a source witness to
  make Send available.
- Staging records the adapter's working source and its current commit as
  provenance. After Send, the platform records a local equivalence witness when
  the live source provably contains the reviewed change, so a later update
  recognizes the merged change instead of replaying a local draft. Missing
  proof means no witness; later local updates keep their ordinary conservative
  reconciliation/resolver path. When a
  review revises a change the live source already held, staging commits the
  revision onto the live source (`source_sync.state: adopted`); installed apps
  and overlapping live edits stay `diverged` for the ordinary update
  reconciliation. Exact head, diff, approval, public target and retry checks
  remain mandatory regardless of installation.

Before you tell the partner it is ready, complete the exact-head review contract
from **Thoroughly review prepared work** above. Inspect the
complete stored diff and its owning invariants, fix every sound issue
privately, restage, and repeat on the new head. Confirm the body draft is
exactly what should be published and that no private data appears in the
branch, commit message, branch name, body, diff, or screenshots. A bug fix
that does not name its cause, or a visible change without screenshots or a
stated reason for their absence, is not ready. Only then record
`all_clear` for the exact staged head and diff. If that verdict cannot
honestly be recorded, leave the record visibly at **Review needed** or
**Changes needed**—never tell the partner it is sendable.

Status stays `prepared` until publication. After a prepare-only request, give
one short, text-only handoff summarizing the staged work. If publication is
already authorized, continue through [publish.md](publish.md) instead of asking
again. A prepared review is not an app build completion. Do not navigate the
workspace, place an app, or link a completion notification to an app as part of
this handoff.
