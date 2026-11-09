import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../api.js', import.meta.url), 'utf8')
const connectionSource = readFileSync(new URL('../ui/ConnectionCard.jsx', import.meta.url), 'utf8')
const controlsSource = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
const sourceMapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')
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
  assert.match(feedSource, /your connected GitHub account/)
  assert.match(sourceMapSource, /\['local', 'Changes'\]/)
  assert.match(sourceMapSource, /\['updates', 'Updates'\]/)
})

test('incoming upstream work is surfaced at project level with the safe update action', () => {
  const controlsSource = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
  assert.match(controlsSource, /incoming \? `\$\{incoming\} incoming`/)
  assert.match(controlsSource, /<h3>Pull updates<\/h3>/)
  assert.match(controlsSource, />Start pull</)
  assert.match(controlsSource, /task\?\.open\('task:update'\)/)
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
  assert.match(feedSource, /outcome = await onSendStack\?\.\(runUnitRecords\(item\)\)/)
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
  assert.match(controlsSource, /Prepare changes/)
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
  assert.match(sourceMapSource, /initiallyOpenFirst/)
  assert.doesNotMatch(sourceMapSource, /Review file diffs|\+\{rows\.length - preview\.length\} more files/)
  assert.match(sourceMapSource, /sourceRevision=\{snapshot\?\.generated_at\}/)
  assert.match(sourceMapSource, /renderActivity\?\.\(project, navigation\)/)
  assert.match(appSource, /selectedId=\{navigation.selectedId\}/)
})

test('preparation runs as one cycle while every public send stays explicit', () => {
  assert.doesNotMatch(feedSource, /PrivateRunAction|<AgentHandoffButton/)
  assert.match(controlsSource, /start\(run.privateAction, prepareAgent\)/)
  assert.match(controlsSource, /Turn your local work into a clear proposal for private review/)
  assert.match(cardSource, /<span>\{sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)\}<\/span>/)
  assert.match(feedSource, /role="alertdialog"/)
  assert.match(feedSource, /Nothing merges\./)
  assert.match(appSource, /provider: chosenAgent\.provider/)
  assert.match(appSource, /\.\.\.\(chosenAgent\.effort \? \{ effort: chosenAgent\.effort \} : \{\}\)/)
  assert.match(feedSource, /New pull requests use your connected GitHub account and open ready for review/)
  assert.match(feedSource, /item\?\.unit\?\.type === 'stack'/)
  assert.match(feedSource, /outcome = await onSendStack\?\.\(runUnitRecords\(item\)\)/)
  assert.doesNotMatch(batchActionSource, /role="alertdialog"/)
  assert.doesNotMatch(batchActionSource, /Keep private/)
  assert.match(batchActionSource, /className="co-agent-handoff"/)
  assert.match(batchActionSource, /onClick=\{run\}/)
  assert.match(batchActionSource, /'Starting…'/)
  assert.match(batchActionSource, /aria-busy=\{busy\}/)
  assert.match(appSource, /resolveUncertainSubmission/)
})

test('project changed-file review loads the real diff and opens its first file immediately', () => {
  assert.match(sourceMapSource, /initiallyOpenFirst/)
  assert.doesNotMatch(fileDiffListSource, /initiallyOpenFirst/)
  assert.match(sourceMapSource, /Promise\.resolve\(loadProjectDiff\?\.\(project\)\)/)
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
  assert.match(controlsSource, /Turn your local work into a clear proposal for private review/)
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
  assert.match(connectionSource, /GitHub account settings/)
  assert.doesNotMatch(connectionSource, /hasFullPrAccess|unsupported|open-contribute-settings/)
})

test('one on-demand settings surface owns account setup in the toolbar', () => {
  assert.equal((appSource.match(/<ConnectionSettings/g) || []).length, 1)
  assert.match(connectionSource, /open \? <div className="co-settings-panel co-settings-workspace"/)
  assert.match(connectionSource, /Contribute settings/)
  assert.match(connectionSource, /className="co-autopilot-setting"/)
  assert.match(themeSource, /\.co-settings-panel \{[\s\S]*?position: absolute/)
})

test('Follow sent PRs help opens as an anchored dismissible popover', () => {
  assert.match(connectionSource, /className="co-setting-help" ref=\{autopilotHelpRef\}/)
  assert.match(connectionSource, /role="tooltip"/)
  assert.match(connectionSource, /aria-describedby=\{autopilotHelpOpen/)
  assert.match(connectionSource, /document\.addEventListener\('pointerdown', dismissOutside\)/)
  assert.match(connectionSource, /event\.key !== 'Escape'/)
  assert.match(connectionSource, /autopilotInfoRef\.current\?\.focus\(\)/)
  assert.match(themeSource, /\.co-setting-help \{ position: relative/)
  assert.match(themeSource, /\.co-setting-popover \{[\s\S]*?position: absolute/)
  assert.doesNotMatch(connectionSource, /className="co-autopilot-help"/)
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
  assert.match(sourceMapSource, /Updated just now/)
  assert.match(sourceMapSource, /className="co-source-loading" role="status"/)
  assert.match(sourceMapSource, /Checking projects…/)
  assert.match(sourceMapSource, /No local work to prepare/)
})

test('project status and essential controls remain visible with a readable type floor', () => {
  assert.doesNotMatch(controlsSource, /More actions|View reviews/)
  assert.match(controlsSource, /className="co-btn co-btn-primary co-task-primary"/)
  assert.match(sourceMapSource, /Refresh project status/)
  assert.match(sourceMapSource, /visibleWork \? <span>\{visibleWork\}<\/span>/)
  assert.match(sourceMapSource, /className="co-source-shared">\{facts.shared\}/)
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
  assert.match(sourceMapSource, /aria-label=\{loading \|\| manualRefresh === 'running' \? 'Refreshing projects'/)
  assert.match(sourceMapSource, /aria-label="Refresh project status"/)
  assert.doesNotMatch(sourceMapSource, /Files, branch and versions <Icon/)
  assert.match(controlsSource, /co-position-inspect[\s\S]*task\?\.open\('task:files'\)/)
  assert.match(controlsSource, /<span>Local<\/span>/)
})

test('private proposals have one actionable home without another merge workflow', () => {
  assert.doesNotMatch(controlsSource, /co-saved-summaries|Draft descriptions saved/)
  assert.match(feedSource, /Prepared work/)
  // The full cycle is an option of Prepare (gated by merge rights), not a second home.
  assert.match(controlsSource, /co-follow-merge/)
  assert.match(controlsSource, /Follow through to merge/)
  assert.doesNotMatch(controlsSource, /Options & process/)
})

test('the projects refresh control also renews the contribution feed and reports a partial one', () => {
  const retry = appSource.match(/onRetry=\{async \(\) => \{[\s\S]*?\n          \}\}/)?.[0] || ''
  assert.match(retry, /refreshCoordinatorRef\.current\(\)/)
  assert.match(retry, /return sourceOk && ledgerCurrentRef\.current/)
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
  assert.equal((controlsSource.match(/\{progress\}\{startHeld \? null : <>/g) || []).length, 2)
  assert.match(controlsSource, /function CycleNotice[\s\S]*cancelLabel\(cycle\.phase\)/)
  assert.doesNotMatch(controlsSource, /\{progress \|\| <>/)
})

test('feedback on a published pull request is news for the owner, not a private draft', () => {
  assert.match(feedSource, /const isPublicFeedback = item => item\.kind === 'private_review'/)
  assert.match(feedSource, /privateItems = decisions\.filter\(item => item\.kind === 'private_review' && !isPublicFeedback\(item\)\)/)
  assert.match(feedSource, /ownerDecisions = decisions\.filter\(item => isPublicFeedback\(item\) \|\|/)
  assert.match(feedSource, /'See feedback'/)
  assert.match(feedSource, /aria-label="Needs you" open>/)
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
