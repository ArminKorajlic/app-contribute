import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { stageWords } from '../publication-stage.js'

const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../api.js', import.meta.url), 'utf8')
const connectionSource = readFileSync(new URL('../ui/ConnectionCard.jsx', import.meta.url), 'utf8')
const controlsSource = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
const sourceMapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')
const projectEditsSource = readFileSync(new URL('../ui/ProjectEdits.jsx', import.meta.url), 'utf8')
const fileDiffListSource = readFileSync(new URL('../ui/FileDiffList.jsx', import.meta.url), 'utf8')
const batchActionSource = readFileSync(new URL('../ui/BatchAction.jsx', import.meta.url), 'utf8')
const feedSource = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
const themeSource = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
const cycleSource = readFileSync(new URL('../ui/useProjectCycle.js', import.meta.url), 'utf8')
const workspaceTheme = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
const runSource = readFileSync(new URL('../run.js', import.meta.url), 'utf8')

test('a frozen selection cannot change its scope through the unavailable merge fallback', () => {
  const selection = readFileSync(new URL('../ui/ReviewSelection.jsx', import.meta.url), 'utf8')
  assert.match(selection, /state\.request\?\.preview_sha256\s*\? 'Start a new private review selection/)
  assert.match(selection, /setResolved\(null\); setMode\('review'\)/)
})

test('new contributions use GitHub automatically without a route picker', () => {
  assert.doesNotMatch(appSource, /onChooseSubmissionMethod|submissionError|setSubmissionError/)
  assert.doesNotMatch(connectionSource, /co-method-setting|Send Möbius contributions as|onChooseSubmissionMethod/)
  assert.match(appSource, /publicationPreference="github"/)
  assert.equal((appSource.match(/<ConnectionSettings/g) || []).length, 1)
  assert.doesNotMatch(connectionSource, /onChooseChanges|onOpenSetup/)
})

test('disconnected projects offer a prominent GitHub connection action', () => {
  assert.match(sourceMapSource, /co-connect-banner/)
  assert.match(sourceMapSource, /Connect GitHub in Settings to contribute as yourself/)
  assert.match(sourceMapSource, /onClick=\{openGithubSettings\}/)
  assert.match(connectionSource, /openGithubSettings/)
  assert.doesNotMatch(connectionSource, /runDeviceConnection|disconnect\(/)
})

test('publication copy describes automatic GitHub identity without picker language', () => {
  assert.doesNotMatch(feedSource, /Choose Personal GitHub|Möbius relay supports standalone drafts/)
  assert.match(feedSource, /stageWords\(stage\)\.description/)
  assert.match(stageWords('draft').description + stageWords('ready').description, /your connected GitHub account/)
  assert.match(sourceMapSource, /\['local', 'With your edits'\]/)
  assert.match(sourceMapSource, /\['updates', 'Behind GitHub'\]/)
})

test('incoming upstream work is surfaced at project level and sent to the place that updates it', () => {
  const controlsSource = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
  const updatesSource = readFileSync(new URL('../updates.js', import.meta.url), 'utf8')
  assert.match(controlsSource, /projectUpstreamLine\(project, check\)/)
  assert.match(controlsSource, /line\.update \? projectUpdater\(project\) : null/)
  assert.doesNotMatch(controlsSource, /Pull updates|Start pull|task:update/)
  // Settings owns Möbius updates and the App Store owns app updates.
  assert.match(updatesSource, /type: 'moebius:open-settings'/)
  assert.match(updatesSource, /type: 'moebius:open-app', appId: 'store'/)
})

test('settings keep prompts and account management while model choice belongs to each launch', () => {
  assert.match(connectionSource, /<ReviewPromptSettings/)
  assert.match(connectionSource, /<ConnectionCard \{\.\.\.props\} \/>/)
  assert.doesNotMatch(connectionSource, /<AgentModelSettings/)
  assert.doesNotMatch(appSource, /setAgentChoice|onChooseAgent/)
})

test('send actions keep a visible label instead of relying on the icon alone', () => {
  assert.match(cardSource, /<span>\{sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)\}<\/span>/)
  assert.match(feedSource, /count === 1 \? 'Review and send' : `Review and send \$\{count\}`/)
  assert.match(feedSource, /count === 1 \? 'Send to GitHub' : `Send \$\{count\} to GitHub`/)
  assert.doesNotMatch(feedSource, /Send all|Prepare latest/)
})

test('focused review actions keep one strong primary and compact phone-safe secondary controls', () => {
  assert.match(cardSource, /className="co-icon-btn co-review-btn is-primary"/)
  assert.match(themeSource, /\.co-icon-btn\.co-review-btn\.is-primary \{[\s\S]*?background: var\(--accent\); color: var\(--accent-fg\)/)
  assert.match(themeSource, /\.co-focus-view \.co-review-actions \{[\s\S]*?grid-template-columns: minmax\(112px, 1fr\) auto auto/)
  assert.match(themeSource, /\.co-focus-view \.co-secondary-action \{[\s\S]*?width: auto;[\s\S]*?padding-inline: 11px/)
  assert.match(themeSource, /\.co-technical-summary \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/)
  assert.match(themeSource, /\.co-review-changes-head span \{[\s\S]*?white-space: nowrap;[\s\S]*?border-radius: 999px/)
  assert.match(themeSource, /\.co-pr-metadata \{[^}]*align-self: stretch;[^}]*width: 100%/)
})

test('prepared work has no parallel fork-check workflow', () => {
  for (const source of [cardSource, apiSource, appSource]) {
    assert.doesNotMatch(source, /pre[_-]pr[_-]checks|pre-pr-checks|Run GitHub checks/)
  }
})

test('single and grouped sends leave the active action from durable results', () => {
  assert.match(cardSource, /setAccepted\(true\)/)
  assert.match(cardSource, /if \(accepted\) return null/)
  assert.doesNotMatch(cardSource, /sendElapsed/)
  assert.match(feedSource, /outcome = await onSendStack\?\.\(runUnitRecords\(item\), \{ stage \}\)/)
  assert.match(appSource, /if \(updates\.length > 0\) \{\s*applyRecordUpdates\(updates\)/)
})

test('sending uses the shell-style label sweep instead of a rotating action spinner', () => {
  assert.doesNotMatch(cardSource, /co-action-spinner/)
  assert.match(cardSource, /co-action-label-sweep/)
  assert.match(themeSource, /@keyframes co-action-sweep/)
  assert.match(themeSource, /prefers-reduced-motion: no-preference/)
})

test('review details show the agent\'s prior-work search and decision', () => {
  assert.match(cardSource, /plan\.prior_work/)
  assert.match(cardSource, /Existing work checked/)
  assert.match(cardSource, /Search details/)
  assert.match(cardSource, /No overlapping work found/)
  assert.match(cardSource, /distinct pull request is justified after comparison/)
  assert.match(cardSource, /startsWith\('https:\/\/github\.com\/'\)/)
  assert.match(themeSource, /\.co-prior-work \{/)
})

test('review details show reviewed labels and truthful published outcomes', () => {
  assert.match(cardSource, /function PlanLabels/)
  assert.match(cardSource, /contributionLabelOutcome\(rec\)/)
  assert.match(cardSource, /aria-label="Published GitHub label outcome"/)
  assert.match(cardSource, /aria-label="Published GitHub labels"/)
  assert.match(cardSource, /label="Requested"/)
  assert.match(cardSource, /Not available/)
  assert.match(cardSource, /Not confirmed/)
  assert.match(cardSource, /do not send it again/)
  assert.match(cardSource, /Review labels on GitHub/)
  assert.match(cardSource, /<PlanLabels rec=\{rec\}/)
})

test('global app handoffs stay durable while source-linked work returns to its chat', () => {
  assert.match(appSource, /window\.mobius\?\.chat\?\.start/)
  assert.match(appSource, /scope: contributionActionScope\(action\)/)
  assert.match(batchActionSource, /function openAgentConversation\(chatId\)/)
  assert.match(batchActionSource, /type: 'moebius:open-chat',[\s\S]*chatId,[\s\S]*}, '\*'\)/)
  assert.match(batchActionSource, /openAgentConversation\(started\?\.chatId\)/)
  assert.match(cycleSource, /openAgentConversation\(chatId\)/)
  assert.doesNotMatch(batchActionSource, /postMessage\([\s\S]*window\.location\.origin/)
  assert.doesNotMatch(appSource, /type: 'moebius:new-chat'/)
  assert.doesNotMatch(appSource, /type: 'moebius:open-chat', draft: action\.draft/)
  assert.doesNotMatch(sourceMapSource, /<AgentHandoffButton/)
  assert.match(sourceMapSource, /renderActivity\?\.\(project, navigation\)/)
  assert.match(feedSource, /function SourceChatChoices/)
  assert.match(controlsSource, /Make PRs from my edits/)
  assert.match(controlsSource, /Open current conversation/)
  assert.match(appSource, /const onFeedback = useCallback/)
  assert.match(appSource, /type: 'moebius:open-chat', chatId: rec\.chat_id, draft \},[\s\S]{0,20}'\*'\)/)
  assert.doesNotMatch(appSource, /moebius:open-chat[\s\S]{0,200}window\.location\.origin/)
  assert.doesNotMatch(connectionSource, /onAskAgent/)
})

test('pull requests and requests share one decision-first Run', () => {
  assert.doesNotMatch(appSource, /id="co-tab-prs"/)
  assert.doesNotMatch(appSource, /id="co-tab-issues"/)
  assert.match(appSource, /<ContributionRun/)
  assert.match(runSource, /REQUEST_TYPES = new Set\(\['issue', 'issue_comment', 'discussion_comment'\]\)/)
  assert.match(runSource, /decisions\.push\(decision\('request'/)
  assert.match(cardSource, /!isPr && rec\.status === 'prepared'/)
  assert.match(feedSource, /STATE_LABELS/)
})

test('only project drill-down owns reversible navigation; inline actions preserve the workspace', () => {
  assert.match(sourceMapSource, /window\.mobius\.nav\.open\('contribute-project'/)
  assert.doesNotMatch(sourceMapSource, /nav\.open\('contribute-review'/)
  assert.match(appSource, /nav\.open\('contribute-approval'/)
  assert.match(sourceMapSource, /onForward:[\s\S]*?setSelected\(key\)/)
  assert.match(sourceMapSource, /function closeProject\(\) \{\s*closeWork\(\)/)
  assert.match(sourceMapSource, /outcome\?\.status !== 'owned'/)
  assert.doesNotMatch(sourceMapSource, /co-task-outlet|co-task-pane/)
  assert.match(sourceMapSource, /workTriggerRef\.current = document\.activeElement/)
})

test('an assigned incoming review stays recoverable until its conversation starts', () => {
  assert.match(
    appSource,
    /const started = await startAgentTask\([\s\S]*if \(!started\.ok\)[\s\S]*Assigned on GitHub[\s\S]*setIncomingReviews/,
  )
})

test('contribution details retain their project parent and refresh only source diffs', () => {
  assert.equal((appSource.match(/<SourceMap/g) || []).length, 1)
  assert.match(sourceMapSource, /\? projects\.find\(\(project\) => project\.key === selected\)/)
  assert.match(sourceMapSource, /<ProjectFileChanges key=\{sourceRevision\}/)
  assert.match(projectEditsSource, /initiallyOpenFirst/)
  assert.doesNotMatch(sourceMapSource, /Review file diffs|\+\{rows\.length - preview\.length\} more files/)
  assert.match(sourceMapSource, /sourceRevision=\{snapshot\?\.generated_at\}/)
  assert.match(sourceMapSource, /renderActivity\?\.\(project, navigation\)/)
  assert.match(appSource, /selectedId=\{navigation.selectedId\}/)
})

test('preparation runs as one cycle while every public send stays explicit', () => {
  assert.doesNotMatch(feedSource, /PrivateRunAction|<AgentHandoffButton/)
  assert.match(controlsSource, /start\(run.privateAction, prepareAgent\)/)
  assert.match(controlsSource, /An agent groups your edits into PRs and checks them\. The PRs stay private on your Möbius\./)
  assert.match(cardSource, /<span>\{sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)\}<\/span>/)
  assert.match(feedSource, /role="alertdialog"/)
  assert.match(feedSource, /Nothing merges\./)
  assert.match(appSource, /provider: chosenAgent\.provider/)
  assert.match(appSource, /\.\.\.\(chosenAgent\.effort \? \{ effort: chosenAgent\.effort \} : \{\}\)/)
  assert.match(stageWords('ready').description, /New pull requests use your connected GitHub account and open ready for review/)
  assert.match(feedSource, /item\?\.unit\?\.type === 'stack'/)
  assert.match(feedSource, /outcome = await onSendStack\?\.\(runUnitRecords\(item\), \{ stage \}\)/)
  assert.doesNotMatch(batchActionSource, /role="alertdialog"/)
  assert.doesNotMatch(batchActionSource, /Keep private/)
  assert.match(batchActionSource, /className="co-agent-handoff"/)
  assert.match(batchActionSource, /onClick=\{run\}/)
  assert.match(batchActionSource, /'Starting…'/)
  assert.match(batchActionSource, /aria-busy=\{busy\}/)
  assert.match(appSource, /resolveUncertainSubmission/)
})

test('project changed-file review loads the real diff and opens its first file immediately', () => {
  assert.match(projectEditsSource, /initiallyOpenFirst/)
  assert.doesNotMatch(fileDiffListSource, /initiallyOpenFirst/)
  assert.match(projectEditsSource, /Promise\.resolve\(loadProjectDiff\?\.\(project\)\)/)
  assert.doesNotMatch(sourceMapSource, /Review file diffs|projectFileRows/)
})

test('blocked contributions have one calm recovery action', () => {
  assert.doesNotMatch(cardSource, /function fixAndReview\(\)/)
  assert.match(cardSource, /<AgentHandoffButton/)
  assert.match(cardSource, /action=\{recoveryReviewAction\(rec\)\}/)
  assert.match(cardSource, /onStart=\{onReview\}/)
  assert.doesNotMatch(cardSource, /Draft follow-up/)
  assert.match(cardSource, /'Fresh review needed'/)
  assert.match(cardSource, /This review needs a quick check before it can continue\./)
  assert.match(cardSource, /The reviewed branch reached GitHub/)
  assert.match(cardSource, /co-alert' \+ \(blocked \? ' is-follow-up'/)
  assert.match(themeSource, /\.co-alert\.is-follow-up/)
  assert.doesNotMatch(cardSource, /Sending is paused until/)
})

test('published check follow-ups use the same calm refresh treatment', () => {
  assert.match(cardSource, /className="co-icon-btn co-refresh-btn is-primary"/)
  assert.match(themeSource, /\.co-attention \{[^}]*var\(--accent\)[^}]*var\(--accent\)/)
  assert.doesNotMatch(
    themeSource,
    /\.co-attention \{[^}]*var\(--danger\)/,
  )
})

test('Möbius-bot withdrawal keeps the destructive action behind confirmation', () => {
  assert.match(cardSource, /function WithdrawAction\(\{ rec, onWithdraw \}\)/)
  assert.match(
    cardSource,
    /submission_mode === 'mobius-bot'[\s\S]*?\['draft', 'open'\]\.includes\(rec\.status\)[\s\S]*?relay_contribution_id/,
  )
  assert.match(cardSource, /onClick=\{\(\) => \{ setNote\(''\); setConfirming\(true\) \}\}/)
  assert.match(cardSource, /role="alertdialog"[\s\S]*?Confirm contribution withdrawal/)
  assert.match(cardSource, /ref=\{keepRef\}[\s\S]*?>\s*Keep open\s*<\/button>/)
  assert.match(
    cardSource,
    /className="co-btn co-btn-sm co-btn-caution"[\s\S]*?onClick=\{withdraw\}/,
  )
})

test('lost single and stacked submit responses reconcile durable state', () => {
  assert.match(apiSource, /uncertain: true/g)
  assert.match(appSource, /resolveUncertainSubmission/)
  assert.match(apiSource, /markContributionReady/)
  assert.match(apiSource, /detail\.code === 'ready_unconfirmed'/)
  assert.match(appSource, /fresh\?\.readying/)
  assert.match(appSource, /Repeating this route is read-only reconciliation/)
  assert.match(appSource, /return \{ pending: true, record: next, viaMobius \}/)
  assert.match(appSource, /summary\.state === 'publishing'/)
  assert.match(cardSource, /if \(accepted\) return null/)
  assert.doesNotMatch(apiSource, /return \{ error: String\(\(err && err\.message\)/)
})

test('the retired raw-ref Land path has no reachable client action', () => {
  assert.equal(existsSync(new URL('../ui/ContributionStack.jsx', import.meta.url)), false)
  assert.equal(existsSync(new URL('../ui/SourceOverview.jsx', import.meta.url)), false)
  assert.doesNotMatch(
    appSource,
    /\blandContributionStack\b|\bonLandStack\b|ui\/ContributionStack|SourceOverview/,
  )
  assert.doesNotMatch(apiSource, /landContributionStack|\/land-stack/)
  assert.doesNotMatch(feedSource, /Land stack|>\s*Land\s*</)
})

test('wide collection and review views share centered guides on one continuous canvas', () => {
  assert.match(themeSource, /\.co-page \{[\s\S]*?width: min\(100%, 1040px\)/)
  assert.match(themeSource, /\.co-contributions-view \{\s*width: 100%; margin-inline: auto/)
  assert.match(themeSource, /\.co-header \{[^}]*width: min\(100%, 1040px\); margin-inline: auto/)
  assert.match(themeSource, /\.co-github-menu \{[^}]*max-width: 520px/)
  assert.doesNotMatch(themeSource, /radial-gradient|linear-gradient\(var\(--bg\), var\(--bg\)\)/)
  assert.doesNotMatch(themeSource, /\.co-root::before/)
  assert.match(themeSource, /@media \(min-width: 900px\) \{[\s\S]*?\.co-header-shell \{ width: min\(100%, 1040px\); margin-inline: auto/)
  assert.match(themeSource, /\.co-header-shell \{\s*flex: 0 0 auto; width: 100%; background: var\(--bg\);\s*\}/)
  assert.match(appSource, /<div className="co-header-shell">[\s\S]*?<\/div>\s*<main/)
  assert.doesNotMatch(themeSource, /\.co-page\.is-sources \{\s*width:/)
})

test('Projects owns vertical scrolling and makes every row visibly navigable', () => {
  assert.match(themeSource, /\.co-page\.is-sources \{[\s\S]*?overflow-y: auto/)
  assert.match(sourceMapSource, /aria-label=\{`Open \$\{project\.name\}: \$\{next\}`\}/)
  assert.match(sourceMapSource, /className="co-source-row-cue"/)
  assert.match(sourceMapSource, /<Icon name="right" size=\{15\}/)
  assert.match(themeSource, /\.co-source-row \{[\s\S]*?cursor: pointer/)
  assert.match(themeSource, /\.co-source-row-facts > small \{ display: block; \}/)
  assert.doesNotMatch(themeSource, /\.co-source-row-facts > span \{[^}]*-webkit-line-clamp/)
})

test('one scoped control surface starts private preparation without leaving the project', () => {
  assert.match(appSource, /<ProjectControls[\s\S]*projectProgress=\{progress\}/)
  assert.match(controlsSource, /start\(run.privateAction, prepareAgent\)/)
  assert.match(controlsSource, /<h3>Make PRs from your edits<\/h3>/)
  assert.match(appSource, /recordsForProject\(records, project\)/)
  assert.match(appSource, /onStart=\{startAgentTask\}/)
  assert.match(themeSource, /\.co-project-controls \{/)
})

test('published-app handoffs finish automatically without a second owner action', () => {
  assert.doesNotMatch(feedSource, /function PublishedAppLinks/)
  assert.match(feedSource, /Finishing publication/)
  assert.doesNotMatch(feedSource, /Connect app|ready to connect|Link \$\{items\.length\} apps/)
  assert.doesNotMatch(themeSource, /co-published-links/)
  assert.match(cardSource, /Attaching the published identity to this local app/)
  assert.doesNotMatch(cardSource, />Link app</)
  assert.match(runSource, /decision\('connecting'/)
})

test('cards use explicit links and detail buttons instead of a clickable container', () => {
  assert.doesNotMatch(cardSource, /handleCardClick|is-clickable/)
  assert.match(cardSource, /className="co-details-toggle"/)
  assert.match(cardSource, /className="co-card-title"/)
})

// Narration copy must not promise interactions the card no longer has: the
// whole-card tap was deliberately removed, so no status line may say "tap".
test('status narration never promises a tap', async () => {
  const { STATUS_NARRATION } = await import('../domain.js')
  for (const copy of Object.values(STATUS_NARRATION)) {
    assert.doesNotMatch(copy, /\btap\b/i)
  }
})

test('GitHub account changes live only in Möbius Settings', () => {
  assert.doesNotMatch(connectionSource, /personal access token|connectToken|runDeviceConnection|startDeviceFlow|migrateLimitedConnection/)
  assert.doesNotMatch(apiSource, /connectStart|connectPoll|connectCancel|export function disconnect/)
  assert.match(connectionSource, /settingsButton\('Go to Settings to connect', true\)/)
  assert.match(connectionSource, /Manage account/)
  assert.doesNotMatch(connectionSource, /hasFullPrAccess|unsupported|open-contribute-settings/)
})

test('one on-demand settings surface owns account setup in the toolbar', () => {
  assert.equal((appSource.match(/<ConnectionSettings/g) || []).length, 1)
  assert.match(connectionSource, /open \? <div className="co-settings-panel co-settings-workspace"/)
  assert.match(connectionSource, /Contribute settings/)
  assert.match(connectionSource, /className="co-set-card"/)
  assert.match(themeSource, /\.co-settings-panel \{[\s\S]*?position: absolute/)
})

test('Follow sent PRs says what it does in its own row, with no hidden help to open', () => {
  assert.match(connectionSource, /<small>Follows sent PRs through checks and review, addresses comments automatically, and asks when it needs you\.<\/small>/)
  assert.doesNotMatch(connectionSource, /autopilotHelp|role="tooltip"|co-setting-info/)
  assert.doesNotMatch(themeSource, /co-setting-popover|co-setting-info|co-autopilot-setting/)
})

test('background checks have one shared accessible toolbar indicator', () => {
  assert.match(appSource, /const checking = loading && records\.length === 0 && !sourceSnapshot/)
  assert.match(appSource, /useState\(\{ state: 'checking' \}\)/)
  assert.match(appSource, /className="co-toolbar-check" role="status" aria-live="polite"/)
  assert.match(appSource, /Updating contribution state/)
  assert.doesNotMatch(appSource, /activeChecks|whileChecking/)
})

test('GitHub status failures stay visible and the account refreshes on return', () => {
  assert.doesNotMatch(connectionSource, /if \(state === 'unknown'\) return null/)
  assert.match(connectionSource, /GitHub status unavailable/)
  assert.match(connectionSource, /Check GitHub again/)
  assert.match(appSource, /connectionRequestRef/)
  assert.match(appSource, /requestId !== connectionRequestRef\.current/)
  assert.match(appSource, /refreshConnectionRef\.current\?\.\(\)/)
  assert.doesNotMatch(connectionSource, /setInterval/)
})

test('the Projects summary reserves its row while source checks refresh', () => {
  assert.match(appSource, /loading=\{sourceLoading\}/)
  assert.match(appSource, /if \(!quiet\) setSourceLoading\(true\)/)
  assert.match(sourceMapSource, /function LoadingState\(\)/)
  assert.match(sourceMapSource, /className="co-source-loading" role="status"/)
  assert.match(sourceMapSource, /Checking projects…/)
  assert.match(sourceMapSource, /No projects with edits/)
})

test('project status and essential controls remain visible with a readable type floor', () => {
  assert.doesNotMatch(controlsSource, /More actions|View reviews/)
  assert.match(controlsSource, /className="co-btn co-btn-primary co-task-primary"/)
  assert.match(sourceMapSource, /<span>\{facts\.work\}<\/span>/)
  assert.match(sourceMapSource, /className="co-source-shared">\{shared\}/)
  const sizes = [...(themeSource + workspaceTheme).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]))
  assert.ok(sizes.every(size => size === 0 || size >= 14))
})

test('bottom work surfaces stay content-sized and avoid nested approval cards', () => {
  assert.match(workspaceTheme, /\.co-workspace \.co-task-dock \{[^}]*top:auto;/)
  assert.match(workspaceTheme, /> \.co-run-approval \{[^}]*border:0;/)
})

test('confirmed contribution summary uses the workspace row treatment', () => {
  assert.match(workspaceTheme, /\.co-workspace \.co-local-summary \{[^}]*display:grid;[^}]*background:none;[^}]*text-align:left;/)
  assert.match(workspaceTheme, /\.co-workspace \.co-local-summary small \{[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/)
})

test('project chrome consolidates navigation, refresh, files, and preparation choices', () => {
  assert.match(appSource, /className="co-header-back"/)
  assert.match(appSource, /onProjectOpenChange=\{setProjectOpen\}/)
  assert.doesNotMatch(sourceMapSource, /className="co-project-switcher"/)
  // One refresh control, the header's: no second button on the list or a project.
  assert.doesNotMatch(sourceMapSource, /CheckGithub|Check GitHub/)
  assert.doesNotMatch(sourceMapSource, /RefreshNote|refreshNote/)
  assert.doesNotMatch(sourceMapSource, /Refresh project status|Refresh projects/)
  assert.doesNotMatch(sourceMapSource, /Files, branch and versions <Icon/)
  assert.match(controlsSource, /className="co-btn is-icon" onClick=\{\(\) => task\?\.open\('task:files'\)\} aria-label="See the files" title="See the files"><Icon name="review" size=\{16\} \/>/)
})

test('private proposals have one actionable home without another merge workflow', () => {
  assert.doesNotMatch(controlsSource, /co-saved-summaries|Draft descriptions saved/)
  assert.match(feedSource, /Prepared work/)
  // The full cycle is an option of Prepare (gated by merge rights), not a second home.
  assert.match(controlsSource, /co-follow-merge/)
  assert.match(controlsSource, /Follow through to merge/)
  assert.doesNotMatch(controlsSource, /Options & process/)
})

test('every refresh control renews the contribution feed and reports a partial one', () => {
  // The header's Sync with GitHub is the one full pass, and it keeps when it last ran.
  const refresh = appSource.match(/async function refreshEverything\(\) \{[\s\S]*?\n  \}/)?.[0] || ''
  assert.match(refresh, /refreshCoordinatorRef\.current\(\)/)
  assert.match(refresh, /checkUpstream\(token, sourceProjects\)/)
  assert.match(refresh, /return \{ ok: sourceOk && ledgerCurrentRef\.current, upstream \}/)
  assert.match(appSource, /onRetry=\{refreshAll\} checks=\{upstreamChecks\}/)
  // The sync says when it last ran, beside its own button, and is named for what it does.
  assert.match(appSource, /<SyncNote note=\{refreshNote\} \/>\s*<button[^>]*co-toolbar-refresh[^>]*aria-label="Sync with GitHub"/)
  assert.match(appSource, /Sync with GitHub/)
  assert.match(appSource, /setRefreshNote\(\{ outcome, at: new Date\(\)\.toISOString\(\) \}\)/)
  assert.match(appSource, /onClick=\{refreshAll\}/)
})

test('GitHub is synced once per open: no hidden foreground re-sync, one explicit Sync with GitHub', () => {
  // The owner refreshes from the header; returning to the
  // app or a focus/visibility flip must not quietly reload everything.
  assert.doesNotMatch(appSource, /isVisibleFrameMessage/)
  assert.doesNotMatch(appSource, /addEventListener\('visibilitychange', requestRefresh\)/)
  assert.match(appSource, /className="co-btn co-toolbar-refresh"/)
})

test('the workspace opens only after its first sync and never falls back to the boot screen', () => {
  assert.match(appSource, /const bootReady = ledgerReady && !sourceLoading && conn\.state !== 'checking'/)
  assert.match(appSource, /if \(bootReady\) setBooted\(true\)/)
  assert.match(appSource, /className="co-boot" role="status"/)
})

test('a review chip opens the PR on its Review tab, and a started review no longer opens a pane in the list', () => {
  const pullsSource = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  assert.match(pullsSource, /onOpenPage \? onOpenPage\(pr, 'review'\)/)
  // The title opens Comments, or the Review tab while a review is running.
  assert.match(pullsSource, /onOpenPage\(pr, frameOf\(standingOf\(pr\)\) === 'reviewing' \? 'review' : 'conversation'\)/)
  assert.doesNotMatch(pullsSource, /setChoice\(null\); setSelected\(new Set\(\)\)\n\s*task\?\.open\(`task:run:\$\{result\.run\.id\}`\)/)
  // The row wears the comet frame while an agent works; the Review tab knows your own PRs.
  assert.match(pullsSource, /<ReviewFrame key=\{key\} state=\{review\.frame\}/)
  assert.match(pullsSource, /own: isOwnPull\(pr, conn\.login\), standing: standingOf\(pr\)/)
  assert.match(appSource, /setPullPage\(\{ key: project\?\.key \|\| '', repo, number: pr\.number, tab,/)
})

test('the desk reads review runs once, wraps its rows in the frame, and opens a reviewed PR on its Review tab', () => {
  const deskSource = readFileSync(new URL('../ui/DeskViews.jsx', import.meta.url), 'utf8')
  assert.match(deskSource, /<ReviewFrame state=\{framed\} inset=\{3\}/)
  assert.match(deskSource, /onOpenPull\(project, pr, framed === 'idle' \? 'conversation' : 'review'\)/)
  assert.match(deskSource, /frameState\(reviewForRecord\(runs, item\.record\), \{ own: true, ignored \}\)/)
  assert.match(appSource, /const reviewActive = hasActiveReview\(reviewRuns\)/)
  assert.match(appSource, /runs: reviewRuns,/)
  // Refresh renews the runs with everything else; nothing polls unless a review is working.
  assert.match(appSource, /checkUpstream\(token, sourceProjects\), refreshReviewRuns\(\)/)
  assert.match(appSource, /if \(!reviewActive\) return undefined/)
  assert.match(sourceMapSource, /runs=\{desk\.runs\}/)
})

test('a running review is shown by the frame and the Review tab only: no Reviewing tag, no Agent spinner or highlight', () => {
  const pullsSource = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  const deskSource = readFileSync(new URL('../ui/DeskViews.jsx', import.meta.url), 'utf8')
  const menuSource = readFileSync(new URL('../ui/ActionsMenu.jsx', import.meta.url), 'utf8')
  const detailSource = readFileSync(new URL('../ui/PullRequestDetail.jsx', import.meta.url), 'utf8')
  // Tags for finished or waiting reviews stay; the one for a running review goes.
  assert.match(pullsSource, /\{review\.chip \? <button className=\{'co-pr-agent-state'/)
  assert.match(deskSource, /const standingChip = framed === 'verdict' \? chipOf\(standing\) : null/)
  assert.match(deskSource, /\{standingChip \? <span className="co-desk-chip is-waiting">/)
  assert.doesNotMatch(deskSource, /is-review/)
  assert.doesNotMatch(menuSource, /co-arc|is-active|active =/)
  assert.doesNotMatch(pullsSource, /<AgentMenu active=/)
  assert.doesNotMatch(detailSource, /<AgentMenu[^>]* active=/)
  assert.doesNotMatch(workspaceTheme, /co-agent-menu-button\.is-active/)
})

test('the spinner turns: both ends of its animation are rotations, with no base transform to cancel it', () => {
  // A base translateZ(0) next to a keyframe rotate(360deg) interpolates to no movement at all.
  const arc = workspaceTheme.match(/\.co-arc \{[^}]*\}/)?.[0] || ''
  assert.doesNotMatch(arc, /transform\s*:/)
  assert.match(workspaceTheme, /@keyframes co-arc-spin \{ from \{ transform:rotate\(0deg\); \} to \{ transform:rotate\(360deg\); \} \}/)
})

test('the PR page is a task surface: the review window opens, panes close, the detail stays put', () => {
  const pullsSource = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  // Without a TaskContext every TaskPane renders bare, always, and cannot
  // close; the desk PR page provides one of its own.
  assert.match(sourceMapSource, /function PullPageTask/)
  assert.match(sourceMapSource, /<PullPageTask>\{desk\.renderPull\(\)\}<\/PullPageTask>/)
  // The detail is the page itself, never hidden behind a swappable pane.
  assert.doesNotMatch(pullsSource, /<TaskPane id="task:detail"[^>]*><PullRequestDetail[^]*?holdUntilLoaded/)
  // People load as a skeleton, not a sentence.
  assert.doesNotMatch(pullsSource, /Loading people…/)
})

test('an external image in GitHub markdown becomes a labelled link, never a broken icon', () => {
  const markdownSource = readFileSync(new URL('../ui/MarkdownView.jsx', import.meta.url), 'utf8')
  assert.match(markdownSource, /function linkExternalImages/)
  assert.match(markdownSource, /img\.replaceWith\(link\)/)
  assert.match(markdownSource, /linkExternalImages\(DOMPurify\.sanitize/)
})

test('To look at feedback on a published PR opens the PR page, not the saved card', () => {
  assert.match(feedSource, /function openAttentionItem\(item\) \{\s*\n\s*const target = feedbackPull\(item\)/)
  assert.match(feedSource, /onSelect=\{openAttentionItem\}/)
})

test('the stale-feed note says offline only when the device is offline', () => {
  assert.match(appSource, /window\.mobius\?\.online === false\s*\n\s*\? 'Offline — showing your last synced feed\.'/)
  assert.match(appSource, /'Not fully up to date — showing your last synced feed\.'/)
})

test('adjacent local controls and PR inventory have distinct stable component identities', () => {
  assert.match(appSource, /<PullRequests key=\{`pulls:/)
  assert.match(appSource, /key=\{`controls:\$\{project\.key\}`\}/)
  assert.doesNotMatch(appSource, /<PullRequests key=\{project\?\.key/)
})


test('paused or failed project work sits above Start instead of replacing it', () => {
  // Only work in progress (a running turn or a question) holds a new start back.
  assert.match(controlsSource, /const startHeld = Boolean\(progress\) && \(active \|\| waiting\)/)
  assert.equal((controlsSource.match(/\{progress\}\{startHeld \? null : <>/g) || []).length, 1)
  assert.match(controlsSource, /function CycleNotice[\s\S]*cancelLabel\(cycle\.phase\)/)
  assert.doesNotMatch(controlsSource, /\{progress \|\| <>/)
})

test('feedback on a published pull request is news for the owner, not a private draft', () => {
  const runSource = readFileSync(new URL('../run.js', import.meta.url), 'utf8')
  assert.match(runSource, /export const isPublicFeedback = item => item\.kind === 'private_review'/)
  assert.match(feedSource, /privateItems = decisions\.filter\(item => item\.kind === 'private_review' && !isPublicFeedback\(item\)\)/)
  assert.match(runSource, /attentionListItems = \(decisions = \[\]\) => decisions\.filter\(item => isPublicFeedback\(item\) \|\| !\[/)
  assert.match(feedSource, /ownerDecisions = attentionListItems\(decisions\)/)
  assert.match(feedSource, /<AttentionList items=\{ownerDecisions\}/)
})


test('opening a panel can never scroll the app frame itself, only its page', () => {
  const theme = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
  const root = theme.match(/\.co-root \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(root, /overflow: clip;/)
})

test('an opened panel scrolls into view after the project restores its scroll, and only as far as needed', () => {
  const pane = readFileSync(new URL('../ui/TaskPane.jsx', import.meta.url), 'utf8')
  const helper = pane.match(/export function focusActionRegion[\s\S]*?\n\}/)?.[0] || ''
  // A same-frame scroll is undone by ProjectDetail's scroll restore (a parent layout effect).
  assert.match(helper, /requestAnimationFrame\(/)
  assert.match(helper, /scrollIntoView\(\{ block: 'nearest'/)
  assert.doesNotMatch(helper, /block: 'start'/)
})

test('a desk row can open a PR straight into its fix window, once per visit, and only where agents can start', () => {
  const pullsSource = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  assert.match(pullsSource, /focusPull\?\.intent === 'fix' && onStartAgent \? <RunOnce ready=\{!!detailPr\} nonce=\{focusPull\.nonce\}/)
  assert.match(appSource, /function openPullPage\(project, pr, tab = 'conversation', intent = ''\)/)
  assert.match(appSource, /setPullPage\(\{ key: project\?\.key \|\| '', repo, number: pr\.number, tab, intent, nonce: crypto\.randomUUID\(\) \}\)/)
  const once = readFileSync(new URL('../ui/RunOnce.jsx', import.meta.url), 'utf8')
  assert.match(once, /done\.current === nonce/)
})
