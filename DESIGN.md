---
name: Contribute
description: A continuous project workspace with a PR-first inventory, inline decisions, and exact review actions.
colors:
  accent: "var(--accent)"
  action: "var(--accent-hover, var(--accent))"
  accent-foreground: "var(--accent-fg)"
  accent-muted: "var(--accent-dim)"
  background: "var(--bg)"
  surface: "var(--surface)"
  surface-muted: "var(--surface-2, var(--surface))"
  text: "var(--text)"
  text-muted: "var(--muted)"
  border: "var(--border)"
  success: "var(--green)"
  caution: "#cf9526"
  danger: "var(--danger)"
typography:
  headline:
    fontFamily: "var(--font)"
    fontSize: "32px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline-phone:
    fontFamily: "var(--font)"
    fontSize: "28px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  task-title:
    fontFamily: "var(--font)"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  section:
    fontFamily: "var(--font)"
    fontSize: "20px"
    fontWeight: 700
  row-title:
    fontFamily: "var(--font)"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.45
  body:
    fontFamily: "var(--font)"
    fontSize: "16px"
    lineHeight: 1.6
  label:
    fontFamily: "var(--font)"
    fontSize: "14px"
    fontWeight: 650
  button:
    fontFamily: "var(--font)"
    fontSize: "14px"
    fontWeight: 500
  mono:
    fontFamily: "var(--mono, var(--font))"
    fontSize: "13px"
    lineHeight: 1.6
rounded:
  state: "5px"
  tab: "7px"
  field: "8px"
  control: "10px"
  panel: "12px"
  dock-phone: "16px"
  dock: "18px"
spacing:
  micro: "4px"
  compact: "8px"
  control: "10px"
  group: "12px"
  row: "18px"
  phone: "20px"
  panel: "24px"
  section: "32px"
  desktop-gutter: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.field}"
    padding: "10px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.field}"
    padding: "10px 16px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    padding: "8px 2px"
    height: "44px"
  directory-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "44px"
  compact-position:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "4px 0"
  work-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.state}"
    padding: "3px 8px"
  pr-action-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "6px 0"
  pr-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "12px 6px"
  prompt-editor:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "12px"
  inline-confirmation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "18px"
---

# Design System: Contribute

## Overview

**Creative North Star: "The Continuous Project Desk"**

Contribute is one calm project workspace, not a separate agent dashboard or Reviews room. To look at comes first, blockers before news, then two status boxes say what is local and how the project compares with GitHub, then the open pull-request list becomes the principal working surface. Every control names its result in plain words ("Make PRs from my edits", "Check GitHub", "Mark ready for review"); none is an unlabeled icon. Titles, authors, labels, check counts and assignment are scannable before detail is opened. To look at, prepared work and the Send and Mark ready rows sit above the status and three tabs, one per job: **All PRs** (the default), **Review requests** and **My work** (agent jobs, agent reviews, agent activity and finished work). Saved public work the live list cannot show stays on All PRs. Old work is never restarted merely by opening it.

Selection belongs to the list: native checkboxes change a stable, in-flow action toolbar. An agent handoff is a two-item **Agent ▾** menu (Review only; Review, fix and merge) that opens the review window for exact confirmation; it is not a direct action on selection. Details open inside the row, with a reserved scrolling body below stable actions and tabs. Settings is flat: Review, Fix and Merge guidance share a tabbed editor, with account management first. Model and effort are chosen per launch. Version, consent and safety checks remain implementation contracts, not routine settings content. The Möbius shell owns theme colors, typography, and icons.

**Key Characteristics:**
- One continuous project workspace with three tabs (All PRs, Review requests, My work); no persistent split pane or second review room.
- Two plain-language status lines and immediate PR inventory.
- Separate PR selection, detail, assignment, and agent action, each a labelled control.
- An Agent ▾ choice, then a review window with exact confirmation before a run starts.
- Stable row detail actions and tabs above a bounded, scrolling context region.
- Named paused work and saved history remain reachable below current work.

## Colors

The palette is semantic and theme-responsive. Accent identifies actions, selection, links, and active controls. Neutral borders and surfaces separate rows and temporary in-flow tasks. Success, caution, and danger reinforce written outcomes; checks and agent state are never conveyed by hue alone.

**The Inherited Theme Rule.** Use shell semantic color and font variables in light and dark modes. Do not pin a purple hex, manufacture a tonal ramp, or introduce an app-owned theme.

**The Written State Rule.** Text such as “✓ 18/18”, “2 failing”, “Merge blocked” and “Prepared · not shared” carries meaning independently of color. Passing checks are not a review verdict.

**The GitHub Label Rule.** PR labels keep their GitHub color using GitHub's own treatment (tinted fill and lifted text in dark mode, solid fill with black or white text in light mode). PR state icons follow GitHub: open green, draft grey, merged purple, closed red.

## Typography

Use the inherited shell font and monospace stack. The project/section headline uses the established 32px desktop and 28px phone hierarchy; PR titles are 16px/650 in the current list. Metadata and controls stay at least 14px, reading copy at 16px. Long titles, labels, versions, and paths wrap rather than forcing the viewport wider.

**The Readable Floor Rule.** Never shrink workflow copy to fit the phone. Keep practical control targets at least 44px; prompt tabs are 48px tall.

## Layout

- **Project directory:** Search and factual All / With your edits / Behind GitHub filters narrow actual local and shared project conditions. Each project carries a Platform or App tag and says what waits on the owner ("8 PRs wait for your review. 2 things need you."). Apps with nothing to do fold into one collapsed group that a search opens. A remembered GitHub repository is not treated as an installed local project.
- **Selected project:** A continuous workspace contains **Check GitHub**, To look at and actionable prepared work, the two status boxes (your edits; updates from GitHub) with **Make PRs from my edits** when there are edits, then the three tabs. When GitHub has updates the GitHub line links to the place that applies them (Settings → Updates for Möbius, the App Store for apps); Contribute starts no update of its own. Edited files and exact versions remain inspectable through **See the files**.
- **PR inventory:** Laid out like GitHub's PR list: search and a **Show** menu (all, unassigned, assigned, opened by me) above one bordered list box. The Review requests tab shows the same list narrowed to PRs that ask for the owner's review; the list stays one mounted component across tabs, so its pages, runs and selection survive a switch. The box header shows select-all and “N open”; Assign and Agent ▾ appear there only once PRs are selected. Each row has a native checkbox, the GitHub state icon, the title with colored labels beside it, and a meta line “#123 · author opened 2 days ago · ✓ 18/18 · +a −d” plus any agent state. Comments, then the quiet text actions **Assign** (or the assignee avatars) and **Agent ▾** sit on the right; they brighten when the row is in use. Check counts treat skipped and neutral runs as passing, as GitHub does.
- **Selection and confirmation:** Selection only changes selection. Choosing a job in Agent ▾ opens the review window, a modal dialog with protected focus. Review only (with its **Allow posting the review on GitHub** and **Merge when safe** switches) and Review, fix and merge remain distinct; posting and merging block each other because the platform admits posting only in plain review. An assignment or run opened from one PR appears directly under that PR. The window names the job and each selected PR, lists numbered "What happens" steps, states what GitHub will see (green and private, or amber with the exact public effects), offers per-run model/effort, and labels its start button with exactly what is allowed. Private-review autopilot lives inside its choice; repair-and-merge continues automatically within its approved scope. Exact versions and frozen instructions remain checked underneath, without a second routine preview panel. Assigning a person is separate and does not start review.
- **Detail:** Follows GitHub's PR page: title with #number, a state badge and “author wants to merge into base from head”, colored labels, then actions and Conversation / Files changed / Checks tabs. Conversation shows the description and comments as bordered comment boxes. The body below has a bounded scroll region so delayed data, long patches, empty states, and errors do not move those controls. Files, checks, and activity load on request; available patches may be incomplete.
- **Settings:** One on-demand workspace groups Review / Fix / Merge decision tabs above a single editor. GitHub account comes first; Agent prompts follows with the same section heading. No Model or Automation settings sections. Preset changes affect new runs only; admitted-run instructions remain inspectable in deliberate run details.
- **Responsive:** Current workspace content is capped near 1100px with 24px horizontal padding; at 640px padding becomes 16px. At 680px and below, local position remains compact, PR metadata wraps, side statuses move under the title, search becomes an explicit 44px control, and the action uses its short phone label. The settings workspace stacks at 650px. No horizontal viewport overflow or hidden primary action.

**The Stable Inventory Rule.** Checkbox selection neither navigates nor opens detail, changes a filter, steals focus, or scrolls the page.

**The Continuous Context Rule.** Inline decisions and detail may focus attention, but they do not replace the project or revive paused work.

## Elevation & Depth

Persistent project content is mostly flat and line-separated. Muted surfaces and borders distinguish selected rows, inline tasks, and the on-demand settings workspace; do not resurrect a bottom selection tray as the primary PR action. Small shadows are reserved for transient popovers or selected detail tabs. Brief state transitions and reduced-motion handling follow the incumbent shell/component rules.

**The Temporary Lift Rule.** Elevation clarifies transient controls, not every PR row or project section.

## Shapes

Rows remain line-separated rather than floating cards. Controls and selected rows use gentle corners; label chips are pill-shaped. Inline task/detail surfaces use modest rounding. Native checkboxes remain native, and avatar/identity marks retain the shell’s treatment.

**The Purposeful Radius Rule.** Grouping and interaction earn a radius; repeated project sections do not become decorative cards.

## Components

### Actions and fields

The inherited primary button marks agent handoff or confirmation; secondary and quiet actions carry assignment, cancel, navigation, and refresh. Disabled actions stay visible. Focus uses a clear accent outline. Search fields keep 16px entry text and a semantic border. Model and effort are chosen at task launch, not in Settings, with an app-owned copy of the chat composer's picker: a compact Agent trigger that opens monochrome provider rows and the same effort track. The default row names the model the launch will actually use (background-agent setting for PR runs, chat default for prepare/pull/cycle). Contribute never restyles the shell's own picker.

### Compact project position

Two concise lines show local and upstream facts with adjacent prepare/pull paths. Inspection reveals branch, versions, repository, and comparison detail without occupying the PR-first viewport by default.

### PR list and action toolbar

The in-flow toolbar keeps select-all, count, Assign, and Take on with agent beside the rows. Individual checkboxes have a 44px target. A row title opens detail independently; author, labels, change totals, check count, meaningful work state, and assignment remain scannable. The purple agent action is icon-only on both device sizes and retains an accessible label. GitHub domain states use official Octicons; generic chrome keeps the shell icon vocabulary. A selected state is tonal, not the only indication of selection.

### Agent review window and progress

The window's title is the job ("Review only" or "Review, fix and merge") above the PR. Steps added by a switch are marked; the "Seen on GitHub" summary and the start button follow the same choice. The window explains public effects and Stop when relevant; exact versions stay in a collapsed detail. On a saved review link the same content renders inline on its page. For a draft takeover it explicitly includes marking ready after independent review and required checks; permission is saved in a new scope, never inferred for old runs. Exact head/base binding and prompt/model freeze are checked underneath, not repeated as routine disclosures. A run carries its own owning conversation and named remaining state; queued is not merged, and green checks do not imply independent approval.

### Contribution detail

Actions and Conversation / Files changed / Checks tabs remain in place above a bounded scrolling body. Conversation opens first. Delayed success or failure changes content in that body without shifting the title, actions, or tabs.

### Settings and prompt editor

A single flat prompt editor groups Review, Fix and Merge decision. Tabs have generous targets and a genuine textarea; Save and Restore are explicit. A prior run’s saved prompts are inspectable in its own detail, without duplicating a full prompt in Settings or launch. A preset edit does not mutate a previously admitted run.

## Do's and Don'ts

### Do:
- **Do** preserve the plain local and GitHub status above PR work, and send updates to Settings or the App Store.
- **Do** lead with visible PR title, colored labels, author and GitHub-style check counts; omit empty agent state.
- **Do** keep selection independent from row detail and route agent action through the review window.
- **Do** name every control by its result; no unlabeled icon actions.
- **Do** distinguish assignment, private review, legacy merge scope, and scoped takeover.
- **Do** keep detail controls stable while context loads and scrolls below them.
- **Do** show paused work by name and preserve its remaining steps without automatic restart.
- **Do** keep editable prompts separate from frozen run snapshots and immutable safety instructions.
- **Do** identify selected PRs and explain actual public effects before approval; retain exact-version binding underneath.

### Don't:
- **Don't** restore a split-pane workspace, parallel Reviews room, or bottom tray as the primary PR action.
- **Don't** equate passing checks with a review verdict or queued work with merged work.
- **Don't** start agent work merely from selecting a PR or assigning a person.
- **Don't** hide changed-version removal, scope drift, or ambiguous outcomes.
- **Don't** shrink 14px metadata, 16px body copy, or 44px controls to fit the phone.
- **Don't** invent fixed colors, fonts, icons, approval states, or product permissions outside the shell and implemented contract.
