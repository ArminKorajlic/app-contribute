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
  review. Draft is an intentional exception, not a mandatory extra stage.
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
"Make PRs from my edits" rather than "Prepare changes", "Check GitHub" with a
visible result rather than a silent refresh icon, "Mark ready for review" for
an own draft, and labelled **Assign** and **Agent ▾** actions on PR rows. An
action shows feedback when used. Check GitHub asks GitHub read-only whether a
repository moved past the compared commit; a quiet project reads "Up to date at
the last check" until a fresh check says more. The agent review window states
its steps, what GitHub will see and which model runs it before anything starts.
