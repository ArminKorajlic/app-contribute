# Contributing: maintainer work

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies.

Everything here needs rights an ordinary contributor does not have: pushing to
the upstream repository, merging, or publishing into an organization's
repository. The default path for ordinary contributions is independent fork
PRs ([publish.md](publish.md)). GitHub repository
permissions own push, assignment, and merge eligibility; organization
membership alone is not merge authority.

## PR stacks

**Confirm upstream push permission first.** GitHub cannot use a branch that
exists only in the contributor's fork as the base of a PR in the upstream
repository, so a stack publishes dedicated `stack/**` branches directly to
upstream, and the server refuses before pushing anything unless the connected
owner has `permissions.push` there:

```bash
gh api repos/<owner>/<repo> --jq .permissions.push
```

Without it, prepare independent fork PRs; never simulate a stack by publishing
a cumulative diff that differs from the reviewed `.diff`.

With push permission, decide explicitly before preparing two or more PRs for
one goal. Use a stack when every layer is independently coherent and later
layers genuinely depend on earlier ones, or when an ordered split makes review
substantially clearer; CI then runs on the foundation and on the cumulative
result at the same time. Do not manufacture layers from one indivisible fix,
and do not stack unrelated changes: independent work stays as independent PRs
to the default branch so one failure, review, or delay cannot block the others.
A stack's direction is parent-first: PR A targets the default branch; PR B
targets A's upstream branch, so B's check covers A+B; and so on. Mention the
stack choice in `prior_work.summary` or the record summary when it helps the
partner understand the review shape.

### Prepare a stack

Each layer is its own complete, reviewed commit and its `.diff` is
**incremental against the previous layer**, never the cumulative diff against
the default branch. Each layer must remain a sensible review unit; put the
tests needed to trust a layer in that layer.

1. Choose one privacy-safe stack id. Every branch starts `stack/<stack-id>/`,
   followed by an ordered descriptive suffix: `stack/<stack-id>/01-<layer>`,
   `.../02-<layer>`, `.../03-<layer>`.
2. Prepare layer 1 from the freshly fetched default-branch base SHA, layer 2
   from layer 1's exact `head_sha`, and so on, with one durable review
   checkout per record under `/data/contrib/<record-id>/worktree`
   ([branch.md](branch.md)).
3. Set the connected owner's repo-local author/committer identity **before every
   commit**. Standalone send can normalize one tip commit; stack send cannot
   rewrite a parent without invalidating every child's reviewed ancestry.
4. Stage each layer ([ledger.md](ledger.md)); a later layer passes
   `base_sha` set to the previous layer's exact `head_sha`, so its `.diff` is
   incremental.
5. CAS-add this object to every staged plan (positions are 1-based and
   complete). Once it is present, a restage uses the parent layer's head as
   its base automatically:

```json
"stack": {
  "id": "<stack-id>",
  "name": "<Stack name>",
  "position": 2,
  "total": 3,
  "parent_record_id": "<stack-id>-01",
  "base_branch": "stack/<stack-id>/01-<layer>"
}
```

Layer 1 has an empty `parent_record_id` and `base_branch` equal to upstream's
default branch. Every later `parent_record_id` names the immediately preceding
ledger record, `base_branch` equals that record's branch, and its `base_sha`
equals that record's `head_sha`. Re-read all records and diffs as one review
unit before saying the stack is ready.

### Send a stack

When 2–12 prepared PR records carry one complete `plan.stack` chain,
Contribute groups them into one visual review and shows the current **Update
stack** or **Send stack** action.
The second, explicit confirmation lists every title and `base → branch` pair
in the current public phase; that click approves exactly those enumerated
pushes and PR creations. An explicit, unambiguous chat instruction accepting
the same current list is equally valid; do not require both approval surfaces.
Any record carrying `plan.stack` is stack-only: malformed or incomplete chains
stay visible for feedback, but neither the app nor the platform may fall back
to sending one layer through the standalone PR path.

A reviewed chain may start with existing pull requests whose branches need an
update and end with new unpublished children. Keep that as one stack, but use
two exact public phases: first confirm and update the consecutive `pr_update`
prefix; after a fresh ledger read proves those updates settled, separately
confirm and open the `pr` suffix. The confirmation enumerates only the current
phase, while the full chain remains visible and is revalidated on both calls.
Never place an existing-PR update after a new private layer, and never let one
phase claim, hide, or inherit approval for the deferred phase.

Before the first public push, the platform rechecks every record, every stored
diff, every parent SHA, the full branch topology, commit attribution, and the
whole stack's ability to merge with current upstream. It then publishes the
branches and opens the PRs from parent to child. If a later layer fails after a
parent PR was already created, the successful record remains open and every
unsent record returns to `prepared` with the durable error — retry never hides
the partial public state. Draft and open parents remain valid reviewed links,
but their upstream branch must still point at the exact reviewed commit before
another layer can be sent. If a parent has merged, rebuild the remaining private
layers on current upstream and review them again; never silently retarget an old
child, because squash/rebase merges can change the diff GitHub would show.

### Let GitHub accept a public stack

Once the reviewed layers are public, GitHub owns their acceptance through the
repository's ordinary review, protection, and merge-queue rules. Contribute
observes those results and keeps the related records together; it does not
advance a repository ref directly or bypass the repository's merge policy.

Sending a stack never authorizes merging it. Any later queue or merge action is
a separate exact approval against the current public head, performed through a
repository-owned GitHub operation. For a dependent chain, advance parent-first
and re-read the remaining layers after each accepted parent because their base
or topology may have changed. Contribute then reconciles merged, closed, or
superseded outcomes from GitHub without manufacturing a second public action.

## Review, pinned merge, or scoped repair of selected PRs

Reviewing existing public PRs is the platform's core GitHub workflow. Its
canonical guide is the `github-workflows` skill (`"$SCRIPTS_DIR/github_review.py"`):
it owns modes and their authority, the frozen prompt/model preview, consent,
the bound review conversation's endpoints, independent reviewers, repairs,
merge/queue, readiness, Stop and read-only `/observe` recovery. Follow it for
execution; this file adds only Contribute's entry points.

Select named PRs independently of authorship or assignment; assignment is a
separate public action and never starts review. When a review is published,
default to **one review body with numbered points — no inline file threads
unless the owner asks for them**; that is the accepted house format, and
guessed inline threads have cost public cleanup under the owner's name. Modes
are `review` (private), `review_merge` (pinned conditional merge) and
`review_fix_merge` (scoped takeover). Contribute offers a mode only when this Möbius advertises it
(`review-presets` capabilities); `--allow-mark-ready` additionally needs draft
takeover support and is proposal input, never consent.

Prepare the exact selection and its Contribute approval link:

```bash
python3 /data/apps/contribute/review_prs.py --mode review_merge \
  'owner/repository#123' 'owner/repository#124'
```

`--options <JSON-file>` and `--agent <JSON-file>` are passed to the platform's
preview. The adapter calls the platform workflow with Contribute's app context
and saves `review-selections/<request_id>.json`; it starts nothing. Show the
resolved snapshot it returns when asking for a decision, not a promise to
resolve prompts later. Opening the link is not consent.

An explicit owner instruction in this chat that covers the selection is
consent; never demand a second click for it:

```bash
python3 /data/apps/contribute/review_prs.py \
  --selection '<saved-request-id>' --approved-in-chat \
  --approval-context '<truthful quote/reference of the owner instruction>'
```

Helpers cannot attest owner consent. A selection from another chat, or one a
review conversation already owns, returns that conversation instead. The result
includes a link-only `block` for the run; paste it to let the owner open the run
in Contribute. For an existing run use
`python3 /data/apps/contribute/review_prs.py --block '<run-id>'`. Opening a run
block shows its saved status, versions, instructions and owning conversation;
it never starts or resumes work.

## Link a PR in chat

To point the owner at one public PR, print its link block:

```bash
python3 /data/apps/contribute/pr_block.py 'owner/repository#123'
```

Paste the printed `mobius-app` fence unchanged. It is a static snapshot (state,
author, size, labels) whose intent `pull-request:owner/repository#123` opens
that exact PR in its Contribute project, including closed or later-page PRs.
Opening it never starts, approves or sends anything; continue any work in its
source or review conversation. Do not edit the facts or imply it reviewed code.

## Prepare & merge

**Prepare & merge** for local work remains a continuous workflow toward merge,
not approval for future unknown public changes. Prepare cohesive PRs per
repository and review them privately, then present the exact publication
approval. Once the public versions exist, use their exact merge approval.
Never stretch a local preparation request into an unenumerated public action.

## Publish an app into its own repository

When the contribution publishes a local Möbius app into its own canonical
`mobius-os/app-<id>` repository, add one reviewed `after_merge` handoff to the
plan:
`{"action":"connect_app","app_id":<live numeric app id>,
"manifest_url":"https://raw.githubusercontent.com/mobius-os/app-<id>/main/mobius.json"}`.
Use it only when `source_repo_path` is that exact live app source,
`source_sha` is its captured revision, and the reviewed manifest id matches the
target app repository (or declares the live id as `previous_id`). Never use it
for platform changes, an unrelated app, a non-`app-*` repository, or as a
workaround for an ordinary App Store update. Contribute shows this handoff
inside the private review. Approval to send the exact reviewed app publication
also approves this exact post-merge connection; it is one publication outcome,
not a later public or destructive action. Send binds it to the exact reviewed
source and capability digests and stores an immutable publication witness in
the live app repo (private local provenance; the PR is unchanged), but the
connection does not run until GitHub confirms the reviewed change has merged.

### After the app PR merges: connect the same local app

A merged record with a reviewed `after_merge.action: connect_app` finishes the
local connection automatically. This is the completion step of the exact app
publication the owner already approved; never present a second **Link app**
decision or count it among owner actions. The scheduled reconciler retries any
interrupted handoff until it either completes or has a concrete recovery error.

The platform then checks GitHub's actual merge commit, the stored reviewed diff,
the durable landed witness, the immutable merged source and permission digests,
and the intended live app row. Only an exact match installs that merged commit
under the stable App Store identity. The existing numeric app row and its saved
data remain in place, so later App Store updates target the same installation
instead of creating a second app. If the local source advanced after review,
the ordinary update merge may report conflicts; Contribute keeps the app
connected and sends those source conflicts back to its owning chat for
deliberate resolution.

Do not call the publication complete until the local connection is recorded.
When the intended catalog identity is already attached to the same numeric app
row, the guarded route may reconcile that already-true connection without
rewriting the app or its source. Any other proof failure stays visible in
Working and must not be relabelled as connected. If Contribute reports that the
connection route is unavailable, a platform update is needed; never fall back
to App Store **Install** of the public package.
