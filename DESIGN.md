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
  title:
    fontFamily: "var(--font)"
    fontSize: "28px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  section:
    fontFamily: "var(--font)"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "var(--font)"
    fontSize: "16px"
    lineHeight: 1.6
  meta:
    fontFamily: "var(--font)"
    fontSize: "14px"
    fontWeight: 600
  mono:
    fontFamily: "var(--mono, var(--font))"
    fontSize: "14px"
    lineHeight: 1.6
rounded:
  pill: "6px"
  field: "8px"
  control: "10px"
  panel: "12px"
  round: "999px"
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
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.meta}"
    padding: "8px"
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
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
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

Contribute is one calm project workspace, not a separate agent dashboard or Reviews room. To look at comes first, blockers before news, then two status boxes say what is local and how the project compares with GitHub, then the open pull-request list becomes the principal working surface. Every control names its result in plain words ("Make PRs from local changes", "Sync with GitHub", "Open for review"); none is an unlabeled icon. Titles, authors, labels, check counts and assignment are scannable before detail is opened. To look at, prepared work and the Send and Mark ready rows sit above the status and three tabs, one per job: **All PRs** (the default), **Review requests** and **My work** (agent jobs, agent reviews, agent activity and finished work). Saved public work the live list cannot show stays on All PRs. Old work is never restarted merely by opening it.

Selection belongs to the list: native checkboxes change a stable, in-flow action toolbar. An agent handoff is a choice in the **Actions ▾** menu that opens the review window for exact confirmation; it is not a direct action on selection. Details open inside the row, with a reserved scrolling body below stable actions and tabs. Settings is flat: Review, Fix and Merge guidance share a tabbed editor, with account management first. Model and effort are chosen per launch. Version, consent and safety checks remain implementation contracts, not routine settings content. The Möbius shell owns theme colors, typography, and icons.

**Key Characteristics:**
- One continuous project workspace with three tabs (All PRs, Review requests, Agent runs); no persistent split pane or second review room.
- Two plain-language status lines and immediate PR inventory.
- Separate PR selection, detail, assignment, and agent action, each a labelled control.
- An Actions ▾ choice, then a review window (agent jobs) or a confirm sheet (your own Merge and Open for review) with exact confirmation before anything starts.
- Stable row detail actions and tabs above a bounded, scrolling context region.
- Named paused work and saved history remain reachable below current work.

## Colors

The palette is semantic and theme-responsive. Accent identifies actions, selection, links, and active controls. Neutral borders and surfaces separate rows and temporary in-flow tasks. Success, caution, and danger reinforce written outcomes; checks and agent state are never conveyed by hue alone.

**The Inherited Theme Rule.** Use shell semantic color and font variables in light and dark modes. Do not pin a purple hex, manufacture a tonal ramp, or introduce an app-owned theme.

**The Written State Rule.** Text such as “✓ 18/18”, “2 failing”, “Merge blocked” and “Prepared · not shared” carries meaning independently of color. Passing checks are not a review verdict.

**The GitHub Label Rule.** PR labels and the PR page's state pill (Open, Draft, Merged, Closed) are filled with their GitHub color, 30% less intense: 70% of the color mixed into the page surface, in both themes, with white, GitHub's dark ink or black text, whichever first reaches 4.5:1. A fill that would vanish into the page keeps a hairline. Rows use the same label pill as the PR page. PR state icons follow GitHub: open green, draft grey, merged purple, closed red.

## Typography

Use the inherited shell font and monospace stack. There are four sizes: 28px titles, 22px section headings, 16px body and row titles, and 14px for metadata and controls. Nothing is smaller, with one exception the owner chose on 2026-11-06: a PR's description on a phone is 13px text and 12px code (`--co-text-reading`, `--co-text-code`), and nothing else may use those two. Long titles, labels, versions, and paths wrap rather than forcing the viewport wider.

**The Readable Floor Rule.** Never shrink workflow copy to fit the phone. A PR's own description is the author's reading text, not workflow copy, and on a phone it is the one place that reads smaller (13px, code 12px). Keep practical control targets at least 44px; prompt tabs are 48px tall.

## Layout

- **Project directory:** Search and factual All / With local changes / Behind GitHub filters narrow actual local and shared project conditions. Each project carries a Platform or App tag and says what waits on the owner ("8 PRs wait for your review. 2 things need you."). Apps with nothing to do fold into one collapsed group that a search opens. A remembered GitHub repository is not treated as an installed local project.
- **Selected project:** A continuous workspace contains To look at and actionable prepared work, the two status boxes (local changes; updates from GitHub) with **Make PRs from local changes** when there are some, then the three tabs. When GitHub has updates the GitHub line links to the place that applies them (Settings → Updates for Möbius, the App Store for apps); Contribute starts no update of its own. Edited files and exact versions remain inspectable through **See the files**.
- **PR inventory:** Laid out like GitHub's PR list: search and a **Show** menu (all, unassigned, assigned, opened by me) above one bordered list box. The Review requests tab shows the same list narrowed to PRs that ask for the owner's review; the list stays one mounted component across tabs, so its pages, runs and selection survive a switch. The box header shows select-all and “N open”; Assign and Actions ▾ appear there only once PRs are selected. Each row has a native checkbox, the GitHub state icon, and four lines: the title; the facts “#123 · author opened 2 days ago · ✓ 18/18 · +a −d” (a check mark for passing, a yellow dot while checks run, an × for failing; additions green, deletions red); the labels, always their own line; then the pills (state, whose turn it is, agent state) on a line of their own. Comments, then the quiet text actions **Assign** (or the assignee avatars) and **Agent ▾** sit on the right; they brighten when the row is in use. Check counts treat skipped and neutral runs as passing, as GitHub does.
- **Selection and confirmation:** Selection only changes selection. Choosing a job in Actions ▾ opens the review window, a modal dialog with protected focus. Review only (with its **Allow posting the review on GitHub** and **Merge when safe** switches) and Review, fix and merge remain distinct; posting and merging block each other because the platform admits posting only in plain review. An assignment or run opened from one PR appears directly under that PR. The window names the job and each selected PR, lists numbered "What happens" steps, states what GitHub will see (green and private, or amber with the exact public effects), offers per-run model/effort, and labels its start button with exactly what is allowed. Private-review autopilot lives inside its choice; repair-and-merge continues automatically within its approved scope. Exact versions and frozen instructions remain checked underneath, without a second routine preview panel. Assigning a person is separate and does not start review.
- **Detail:** Follows GitHub's PR page: title with #number, colored labels, then actions (**Actions ▾** with its text, then Assign, View on GitHub and the chat links as 44px icon buttons that name themselves in a tooltip: after the pointer rests 2 seconds, at once on keyboard focus, and while a finger holds it), the state pill and “by author”, and Conversation / Files changed / Checks tabs. Conversation shows the description and comments as bordered comment boxes. The body below has a bounded scroll region so delayed data, long patches, empty states, and errors do not move those controls. Files, checks, and activity load on request; available patches may be incomplete.
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

The primary button marks the next step, an agent handoff or a confirmation; secondary and quiet actions carry assignment, cancel, navigation, and sync. Disabled actions stay visible. Focus uses a clear accent outline. Search fields keep 16px entry text and a semantic border. Model and effort are chosen at task launch, not in Settings, with an app-owned copy of the chat composer's picker: a compact Agent trigger that opens monochrome provider rows and the same effort track. The default row names the model the launch will actually use (background-agent setting for PR runs, chat default for prepare/pull/cycle). Contribute never restyles the shell's own picker.

### Compact project position

Two concise lines show local and upstream facts with adjacent prepare/pull paths. Inspection reveals branch, versions, repository, and comparison detail without occupying the PR-first viewport by default.

### PR list and action toolbar

The in-flow toolbar keeps select-all, count, Assign, and Take on with agent beside the rows. Individual checkboxes have a 44px target. A row title opens detail independently; author, labels, change totals, check count, meaningful work state, and assignment remain scannable. The purple agent action is icon-only on both device sizes and retains an accessible label. GitHub domain states use official Octicons; generic chrome keeps the shell icon vocabulary. A selected state is tonal, not the only indication of selection.

### Agent review window and progress

Every agent and confirm window opens with the same three lines (one shared head): the job (Review, Finish it for me or Take over), then “#123 PR name”, then the repository. Steps added by a switch are marked; the start button follows the same choice. What GitHub will see is one icon beside Close (amber when something reaches GitHub, green when nothing does) whose themed hover card, also opened by keyboard focus or a tap, says it in words. Who sees the result sits on one row, the question left and the three choices right. The agent picker starts on the agent saved in Settings → Default agent. Scroll areas around the picker (the list, the Settings panel, the dialog) never show a scrollbar. The window explains public effects and Stop when relevant; exact versions stay in a collapsed detail. On a saved review link the same content renders inline on its page. A takeover never marks a draft ready or merges: every push waits for the owner's Push, and the owner opens and merges it themselves. Take over asks for a reason, posted with the start. Exact head/base binding and prompt/model freeze are checked underneath, not repeated as routine disclosures. A run carries its own owning conversation and named remaining state; queued is not merged, and green checks do not imply independent approval.

### Actions menu, confirm sheets and review answers

**Actions ▾** opens a header line that says where the PR stands, then a **You** group (only when there is something of the owner's own to do) above an **Agent** group; with nothing of the owner's own, it is the plain agent list with no group names. The next step is first and tinted; an unavailable choice is dimmed in place with its reason. The confirm sheet reuses the review window's shell: icon tile, the action as the title, the PR under it, a short list of facts (a tick, a warning or a cross, each in words, never colour alone), an optional how-it-lands choice, one primary button that names the result, and one X. It never shows Cancel next to the X, and neither do the Review and Respond to feedback windows, whose shell it shares: every window closes with its X alone. On success the X goes and a single Done remains.

The Review tab picks its buttons by what happened: **Fix these findings** is the one tinted button on the owner's own PR, then **Ignore…**, **Review again** and **Ask the reviewer something**, all plain buttons. The row beside a PR in the list carries one chip for whose turn it is: amber only for the owner's own move, quiet grey for "Waiting on <author>" or "Ignored".

**Agent runs** is a desk view like Needs you: project cards in the desk's order, two tabs named for what they hold (Running, Finished), rows that open the PR on its Review tab. A run that waits on the owner counts in Needs you, not here; in the rail only a small spinner and “N running” show agents at work. Merged PRs are a filter on My PRs, and local changes are a banner on each project page.

### Contribution detail

Actions and Conversation / Files changed / Checks tabs remain in place above a bounded scrolling body. Conversation opens first. Delayed success or failure changes content in that body without shifting the title, actions, or tabs.

### Settings and prompt editor

A single flat prompt editor groups Review, Fix and Merge decision. Tabs have generous targets and a genuine textarea; Save and Restore are explicit. A prior run’s saved prompts are inspectable in its own detail, without duplicating a full prompt in Settings or launch. A preset edit does not mutate a previously admitted run.

## Names, tokens and counts

**The One Name Rule.** One name for one meaning, everywhere. Every button, menu row, hint, pill and test reads its words from `names.js`; to rename something, change it there. A pill says what is true, a hint is one sentence, a button says what you do. Three agent jobs stay separate on purpose (Fix these findings, Finish it for me, Respond to feedback); a stopped fix job starts again as Run it again, a stopped review as Review again. `test/names.test.mjs` keeps retired names out of screen text.

**The Token Sheet Rule.** Five corner radii (6, 8, 10, 12 and round) and four type sizes (14, 16, 22, 28; plus 13 and 12 for the phone PR description only), none under 14px except the two phone-description sizes above, named as custom properties in `theme.js`; no rule carries a raw value (`test/style-tokens.test.mjs`). Buttons come in three types: primary (filled), secondary (bordered) and quiet (text), plus a danger modifier and an icon-only shape, all 44px (`button-theme.js`). A class that only adds layout may sit beside them; none sets its own border, fill, colour, corner or height. Purple text on its tinted fill is mixed toward the text colour so it reads at 4.5:1 and above.

**The Four Views Rule.** The rail has four views: Needs you, Review requests, My PRs and Agent runs, then Repositories as a block of its own (a heading, a divider, More repositories folded, Add repository last). Older places live inside them (`deskViewKey`). “Projects” is the Möbius shell's own word, so the app's list is Repositories and its settings popover is Contribute settings.

**The One Count Rule.** A badge counts what waits on the owner and is the sum of the chips beside it. The Needs you chips (To look at, Review, Merge, Fix, Agent runs) filter the list below them; a PR with a feedback card counts once, as that card. Drafts ready to open are a quiet line and local files a project banner; neither enters a number.

**The One Icon Rule.** An icon means one thing: the eye is Needs you and Review, the sparkle marks agent work only (not the Actions menu, which also holds the owner's own steps), a draft icon marks a prepared PR, each of the four views has its own mark.

## The PR page's next step

Under the facts line sit a state line (Draft, In review, Approved, Merged, from the PR's own data; an approval counts only for this exact version) and one panel: a pill for what is true, the PR machine's own sentence, and one filled button for the next step it names. The button runs the same handler as the Actions menu (a stopped job starts again through the same window), opens the Review tab, or Syncs; it is absent when the step is not the owner's, is refused, or this Möbius cannot run it. On a phone the button pins to the foot of the page and leaves the panel, so one next step is on screen, never two. The Commits tab follows Comments: grouped by day, each commit with its title (when the commit has more to say, the whole title row opens the rest of the message at the card's full width, under a bordered chevron), authors (the agent's commits marked), time, the checks' result in words, short hash, a labelled Copy hash and a GitHub link; a line shows where the last review stopped and a Review again banner offers the machine's own review action for newer commits. Close pull request is red, apart and last in Actions, and the menu never starts its focus on it.

## On a phone

The four views are one segmented bar with every segment on screen, the word first and its count after it (two by two on the narrowest phones, never overlapping). The repository list is a button of its own under the bar, with a few project icons, a count and a chevron, so it reads as a place you go to and never as a search. Needs you and Repositories share one layout: a filter line (plain text, the count first in the accent colour, the chosen word underlined), then the same search field with its magnifier, then the list. The Actions button has the strong edge (`--co-edge`) on every width, with the same icon, and its menu has the same edge; on a phone that menu is a sheet from the bottom edge, with a grab handle, a dimmed page behind it, rows of at least 48px and a Cancel row, so it can never run off a side. Sync and Settings keep a word. The review window's footer stays on screen so Start is never below the fold. The opening screen names its five reads with a progress bar and real counts, from the same conditions the app waits on.

## Do's and Don'ts

### Do:
- **Do** preserve the plain local and GitHub status above PR work, and send updates to Settings or the App Store.
- **Do** lead with visible PR title, colored labels, author and GitHub-style check counts; omit empty agent state.
- **Do** keep selection independent from row detail and route agent action through the review window.
- **Do** name every control by its result, from `names.js`; an icon-only button always carries an accessible name and the same words in its tooltip.
- **Do** distinguish assignment, private review, legacy merge scope, and scoped takeover.
- **Do** use the one search field (`ui/SearchField.jsx`) for every search: filled surface, thin edge, magnifier, Clear while there is text, one purple edge and soft ring on focus, 44px tall, a 16px input so phones do not zoom. Never draw a screen's own search input.
- **Do** open a repository from the rounded button that holds its icon and name on a card header (`co-btn-chip`, button-theme.js): a faint fill so it reads as pressable, the accent while pressed, a long name ending in an ellipsis. There is no separate Open word.
- **Do** keep detail controls stable while context loads and scrolls below them.
- **Do** show paused work by name and preserve its remaining steps without automatic restart.
- **Do** keep editable prompts separate from frozen run snapshots and immutable safety instructions.
- **Do** identify selected PRs and explain actual public effects before approval; retain exact-version binding underneath.

### Don't:
- **Don't** restore a split-pane workspace, parallel Reviews room, or bottom tray as the primary PR action.
- **Don't** equate passing checks with a review verdict or queued work with merged work.
- **Don't** start agent work merely from selecting a PR or assigning a person.
- **Don't** hide changed-version removal, scope drift, or ambiguous outcomes.
- **Don't** shrink 14px metadata, 16px body copy, or 44px controls to fit the phone. The one exception is the PR description's reading text on a phone (13px, code 12px), by the owner's choice.
- **Don't** invent fixed colors, fonts, icons, approval states, or product permissions outside the shell and implemented contract.
