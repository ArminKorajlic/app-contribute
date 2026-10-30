import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  addressAllAction,
  contributionActionScope,
  contributionApprovalFingerprint,
  contributionApprovalIsCurrent,
  contributionFailureOwner,
  contributionOutcomeAction,
  contributionPhaseApprovalIsCurrent,
  contributionReviewTargetFromIntent,
  contributionReviewScope,
  focusedContributionNavigationReady,
  focusedContributionReady,
  contributionCycleProgress,
  isAllClear,
  locateContributionReview,
  organizePrivateWorkAction,
  partitionReviewUnits,
  progressReviewAction,
  qualityReviewFor,
  recoveryReviewAction,
  reviewAllAction,
} from '../review.js'
import { upsertRecord } from '../domain.js'
import { stackPublicationRecords } from '../stack.js'
import { contributionPathDecision, contributionStackDecision } from '../contribution-policy.js'
import { contributionRecordPaths } from '../storage.js'
import { writeBindingRefusal } from '../send-readiness.js'

const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const feedSource = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const batchSource = readFileSync(new URL('../ui/BatchAction.jsx', import.meta.url), 'utf8')
const sourceMapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')
const runSource = readFileSync(new URL('../run.js', import.meta.url), 'utf8')

test('public approval fingerprints bind reviewed code, target, text, labels, and revision', () => {
  const approved = {
    id: 'exact', type: 'pr', status: 'prepared', repo: 'owner/project',
    title: 'Reviewed title', updated_at: '2026-08-29T00:00:00Z', revision: 7,
    quality_review: { state: 'all_clear', reviewed_head_sha: 'b'.repeat(40) },
    plan: {
      action: 'pr', repo: 'owner/project', branch: 'fix/exact',
      base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40),
      diff_sha256: 'c'.repeat(64), title: 'Reviewed title',
      body_draft: 'Reviewed body', labels: ['bug', 'area: ui'],
    },
  }
  const reordered = {
    ...approved,
    plan: Object.fromEntries(Object.entries(approved.plan).reverse()),
  }
  assert.equal(
    contributionApprovalFingerprint(reordered),
    contributionApprovalFingerprint(approved),
  )
  assert.equal(contributionApprovalIsCurrent(approved, reordered), true)

  const changes = [
    { ...approved, revision: 8 },
    { ...approved, plan: { ...approved.plan, base_sha: 'd'.repeat(40) } },
    { ...approved, plan: { ...approved.plan, head_sha: 'd'.repeat(40) } },
    { ...approved, plan: { ...approved.plan, diff_sha256: 'd'.repeat(64) } },
    { ...approved, plan: { ...approved.plan, title: 'Changed title' } },
    { ...approved, plan: { ...approved.plan, body_draft: 'Changed body' } },
    { ...approved, plan: { ...approved.plan, labels: ['bug'] } },
    { ...approved, quality_review: { ...approved.quality_review, state: 'changes_needed' } },
  ]
  for (const changed of changes) {
    assert.equal(contributionApprovalIsCurrent(approved, changed), false)
  }

  assert.equal(contributionPhaseApprovalIsCurrent([approved], [reordered]), true)
  assert.equal(contributionPhaseApprovalIsCurrent([approved], []), false)
  assert.equal(contributionPhaseApprovalIsCurrent(
    [approved],
    [{ ...reordered, id: 'different' }],
  ), false)
  assert.equal(contributionPhaseApprovalIsCurrent([approved], [changes[2]]), false)
})

test('shell review intents name one ledger record without encoding presentation state', () => {
  assert.deepEqual(contributionReviewTargetFromIntent('review:record.1-ready'), {
    recordId: 'record.1-ready',
  })
  assert.deepEqual(contributionReviewTargetFromIntent('  review:record_2  '), {
    recordId: 'record_2',
  })
  assert.equal(contributionReviewTargetFromIntent('review:../escape'), null)
  assert.equal(contributionReviewTargetFromIntent('reviews:record'), null)
  assert.equal(contributionReviewTargetFromIntent(null), null)
  assert.deepEqual(contributionReviewTargetFromIntent('reviews:queue'), {
    queue: true,
  })
})

test('a record intent resolves its current phase and enclosing stack', () => {
  const stack = {
    id: 'stack:demo',
    records: [{ id: 'layer-1' }, { id: 'layer-2' }],
  }
  const single = { id: 'single-unit', record: { id: 'single' } }
  const phases = { action: [single], clear: [stack], history: [] }

  assert.deepEqual(locateContributionReview(phases, 'layer-2'), {
    phase: 'clear',
    unit: stack,
  })
  assert.deepEqual(locateContributionReview(phases, 'single'), {
    phase: 'action',
    unit: single,
  })
  assert.equal(locateContributionReview(phases, 'missing'), null)
})

test('the app resolves trusted focused intents without waiting for the full ledger', () => {
  assert.match(appSource, /event\.origin !== window\.location\.origin/)
  assert.match(appSource, /event\.source !== window\.parent/)
  assert.match(appSource, /contributionReviewTargetFromIntent\(event\.data\.intent\)/)
  assert.match(appSource, /setProjectFocus\(\{ key: focusedProjectKey, nonce: reviewFocus.nonce \}\)/)
  assert.match(appSource, /loadContributionRecord\(recordId\)/)
  assert.match(appSource, /upsertRecord\(recordsRef\.current, record\)/)
  assert.match(appSource, /focusedContributionReady\(next, recordId\)/)
  assert.match(appSource, /focusTarget=\{\(project\?\.key \|\| ''\) === focusedProjectKey \? reviewFocus : null\}/)
  assert.match(appSource, /focusReady=\{focusedReviewReady && !sourceLoading\}/)
  assert.doesNotMatch(appSource, /focusedReviewReady && ledgerReady/)
  assert.match(feedSource, /if \(!focusTarget \|\| !focusReady\) return/)
  assert.match(feedSource, /if \(focusTarget\.queue\)/)
  assert.match(feedSource, /findRunItemByRecord\(run, focusTarget\.recordId\)/)
  assert.match(feedSource, /if \(focusTarget\.queue\) onBack\?\.\(\)/)
  assert.match(feedSource, /onSelect\?\.\(found\.item\.id\)/)
  assert.match(feedSource, /This contribution moved/)
})

test('a focused review waits for its exact refresh instead of trusting a stale ledger', () => {
  const focus = { recordId: 'layer-1', nonce: 'new-intent' }
  const pending = { recordId: 'layer-1', nonce: 'new-intent', ready: false }
  const staleLookup = { recordId: 'layer-1', nonce: 'old-intent', ready: true }
  const stack = {
    id: 'review-stack', name: 'Review stack', position: 1, total: 2,
  }
  const first = { id: 'layer-1', plan: { repo: 'mobius-os/mobius', stack } }
  const second = {
    id: 'layer-2',
    plan: {
      repo: 'mobius-os/mobius',
      stack: { ...stack, position: 2 },
    },
  }

  assert.equal(focusedContributionNavigationReady(null, pending, []), true)
  assert.equal(focusedContributionNavigationReady(
    { queue: true, nonce: 'queue-intent' },
    { queue: true, nonce: 'old-intent', ready: true },
    [],
  ), false)
  assert.equal(focusedContributionNavigationReady(
    { queue: true, nonce: 'queue-intent' },
    { queue: true, nonce: 'queue-intent', ready: true },
    [],
  ), true)
  assert.equal(focusedContributionNavigationReady(focus, staleLookup, [first, second]), false)
  assert.equal(focusedContributionNavigationReady(focus, pending, [first]), false)
  assert.equal(focusedContributionNavigationReady(focus, pending, [first, second]), true)
  assert.equal(focusedContributionNavigationReady(
    focus,
    { ...pending, ready: true },
    [],
  ), true)
})

test('review-facing refreshes reject stale async settlements', () => {
  assert.match(appSource, /const reviewStatusRequestRef = useRef\(0\)/)
  assert.match(appSource, /requestId !== reviewStatusRequestRef\.current/)
  assert.match(appSource, /const incomingReviewsRequestRef = useRef\(0\)/)
  assert.match(appSource, /requestId !== incomingReviewsRequestRef\.current/)
  assert.match(appSource, /connRef\.current\.state !== 'connected'/)
  assert.match(appSource, /incomingReviewsRequestRef\.current \+= 1/)
  assert.match(appSource, /refreshMountedLedger: ledgerReadyRef\.current/)
  assert.match(appSource, /await refreshCoordinatorRef\.current\(\)/)
  assert.match(appSource, /document\.addEventListener\('visibilitychange', resolveIncompleteStack\)/)
  assert.match(appSource, /window\.mobius\?\.online === false/)
})

test('mount-time live state reconciles with newer focused and action results', () => {
  assert.match(appSource, /replaceFeed\(reconcileLedgerSnapshot\(recordsRef\.current, next, recs\)\)/)
  assert.match(appSource, /slower startup work cannot overwrite it/)
})

test('the Run owns one exact grouped action across standalone and stacked work', () => {
  assert.match(feedSource, /function ExactBatchAction/)
  assert.match(feedSource, /<ExactActionList[\s\S]*?items=\{activeItems\}/)
  assert.match(feedSource, /sortStackRecords\(runUnitRecords\(item\)\)/)
  assert.match(feedSource, /item\?\.unit\?\.type === 'stack'/)
  assert.match(feedSource, /Review and send \$\{count\}/)
  assert.match(feedSource, /Send \$\{count\} to GitHub/)
  assert.doesNotMatch(feedSource, /Send all|Prepare latest/)
  assert.match(feedSource, /New pull requests use your connected GitHub account and open ready for review/)
  assert.match(feedSource, /Nothing merges\./)
  assert.doesNotMatch(feedSource, /unit\.type !== 'stack'/)
  assert.match(runSource, /decisions\.push\(decision\('publish'/)
})

test('the Run keeps one private owner while focused work remains inspectable', () => {
  assert.match(cardSource, /\{hasPreparedAction \? \([\s\S]*?<ReviewActions/)
  assert.doesNotMatch(cardSource, /hasPreparedAction\s*&&\s*!hasSubmitAlert/)
  assert.match(feedSource, /function BatchOwnedFocus/)
  assert.match(feedSource, /\['publish', 'mark_ready', 'private_review'\]\.includes\(item\.kind\)/)
  assert.doesNotMatch(feedSource, /<PrivateRunAction/)
  assert.match(appSource, /<ProjectControls/)
  assert.match(appSource, /onStart=\{startAgentTask\}/)
  assert.doesNotMatch(feedSource, /<AgentHandoffButton/)
})

test('Merge is an end-state intent without widening the public grant', () => {
  const prepare = {
    event: 'organize_private_contributions',
    revision: 'current-source',
    draft: 'Prepare this exact work privately.',
  }
  assert.equal(contributionOutcomeAction(prepare, 'prepare'), prepare)
  const merge = contributionOutcomeAction(prepare, 'merge')
  assert.equal(merge.label, 'Merge')
  assert.equal(merge.scopeLabel, 'Prepare the full merge cycle')
  assert.match(merge.scope, /^contribute-merge:/)
  assert.match(merge.draft, /owner chose Merge as the desired outcome/)
  assert.match(merge.draft, /final merge still requires its own current explicit approval/)
  assert.notEqual(contributionActionScope(merge), contributionActionScope(prepare))
})

test('a confirmed batch stays on screen with per-item results until the owner closes it', () => {
  assert.doesNotMatch(feedSource, /fixAndReviewAction\(agentRecords\)/)
  assert.doesNotMatch(feedSource, /onStartAgent/)
  assert.match(feedSource, /approval\.locked \|\| approval\.fingerprint === fingerprint/)
  assert.match(feedSource, /setBusy\(false\)[\s\S]*?setFinished\(true\)/)
  assert.match(feedSource, /function closeResults\(\) \{\s*if \(checking \|\| busy\) return[\s\S]*?setApproval\(null\)/)
  assert.match(feedSource, /const value = outcomeFor\(record, outcome\)[\s\S]*?\[record\.id\]: value/)
  assert.match(feedSource, /approval\.fingerprint !== fingerprint/)
  assert.match(feedSource, /The reviewed set changed\. The current actions are listed now/)
  assert.match(feedSource, /key="send"/); assert.match(feedSource, /key="ready"/)
  assert.doesNotMatch(feedSource, /key=\{`(?:send|ready):\$\{run\?\.revision/)
  assert.match(feedSource, /if \(admitted\.current\) return/)
})

test('paused work exposes its existing conversation without starting another', () => {
  const controls = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
  assert.match(controls, /paused: 'Paused', failed: 'Failed'/)
  assert.match(controls, /onClick=\{\(\) => workflow.open\(\)\}/)
  assert.match(controls, /Open current conversation/)
})

test('projects contain their contribution flow without a separate Reviews destination', () => {
  assert.match(appSource, /<ContributionRun/)
  assert.match(appSource, /recordsForProject\(records, project\)/)
  assert.doesNotMatch(appSource, /showProjects|<ProjectControl[ >]|contribute-reviews/)
  assert.doesNotMatch(appSource, /co-tab-prs|co-tab-issues/)
  assert.match(sourceMapSource, /renderActivity\?\.\(project, navigation\)/)
  assert.match(feedSource, /<AttentionList items=\{ownerDecisions\}/)
  assert.match(feedSource, /agentActivity, 'Agent activity'/)
  assert.match(feedSource, />Finished and closed work</)
  assert.match(feedSource, /DECISION_ACTION_LABELS/)
  assert.match(sourceMapSource, /placeholder="Find a project"/)
  assert.match(sourceMapSource, /\['local', 'With your edits'\]/)
  assert.equal((sourceMapSource.match(/\['all', 'All'\]/g) || []).length, 1)
})

test('focused attention is separate from the contribution information card', () => {
  assert.match(feedSource, /<ContributionDecision[\s\S]*<ContributionCard/)
  assert.match(feedSource, /showDecision=\{false\}/)
  assert.match(cardSource, /export function ContributionDecision/)
  assert.match(cardSource, /className="co-decision-surface"/)
})

test('a complete active stack can open from the fast snapshot', () => {
  const stack = (id, position, total = 3) => ({
    id,
    repo: 'mobius-os/mobius',
    plan: { repo: 'mobius-os/mobius', stack: { id: 'drawer', position, total } },
  })
  const records = [stack('one', 1), stack('two', 2), stack('three', 3)]
  assert.equal(focusedContributionReady(records, 'one'), true)
  assert.equal(focusedContributionReady(records.slice(0, 2), 'one'), false)
  assert.equal(focusedContributionReady([{ id: 'single' }], 'single'), true)
  assert.equal(focusedContributionReady(records, 'missing'), false)
})

test('only mount and foreground freshness enumerate the complete history', () => {
  assert.equal(appSource.match(/loadLedger\(\)/g)?.length, 2)
  assert.match(appSource, /if \(!ledgerReadyRef\.current\) return/)
  assert.match(appSource, /loadContributionRecord\(recordId\)/)
  assert.match(appSource, /loadFreshContributionRecord\(rec\.id\)/)
  assert.match(appSource, /loadFreshContributionRecords\(/)
})

test('focused record paths are bounded and reject unsafe ids', () => {
  assert.deepEqual(contributionRecordPaths('record.1-ready'), [
    'contributions/record.1-ready.json',
    'contributions/record.1-ready.record.json',
  ])
  assert.deepEqual(contributionRecordPaths('../escape'), [])
  assert.deepEqual(contributionRecordPaths(''), [])
})

test('a focused record is inserted or refreshed without losing its storage path', () => {
  assert.deepEqual(upsertRecord([{ id: 'other', path: 'contributions/other.json' }], {
    id: 'focus', path: 'contributions/focus.json', status: 'prepared',
  }).map((record) => record.id), ['focus', 'other'])
  assert.deepEqual(upsertRecord([{
    id: 'focus', path: 'contributions/focus.json', status: 'prepared',
  }], {
    id: 'focus', status: 'open',
  }), [{
    id: 'focus', path: 'contributions/focus.json', status: 'open',
  }])
})

test('prepared card actions use one small, plain-language vocabulary', () => {
  assert.doesNotMatch(cardSource, /Run the full GitHub checks on your fork/)
  assert.doesNotMatch(cardSource, /Check on fork/)
  assert.match(cardSource, /<span>Chat<\/span>/)
  assert.match(cardSource, /<span>Dismiss<\/span>/)
  assert.match(cardSource, /can be restored from Dismissed/)
  assert.doesNotMatch(cardSource, /Move to History/)
})

test('all clear belongs to the exact prepared head', () => {
  const record = {
    id: 'reviewed', type: 'pr', status: 'prepared',
    plan: { head_sha: 'a'.repeat(40) },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) },
  }
  const source = { byId: { reviewed: { state: 'ready' } } }
  assert.equal(isAllClear(record, source), true)
  assert.equal(qualityReviewFor({
    ...record, plan: { head_sha: 'b'.repeat(40) },
  }).state, 'needed')
})

test('prepared work stays out of send until a thorough review is all clear', () => {
  const needed = { id: 'needed', type: 'pr', status: 'prepared', plan: { head_sha: 'a'.repeat(40) } }
  const clear = {
    id: 'clear', type: 'pr', status: 'prepared', plan: { head_sha: 'b'.repeat(40) },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'b'.repeat(40) },
  }
  const source = { byId: { needed: { state: 'ready' }, clear: { state: 'ready' } } }
  const parts = partitionReviewUnits([
    { id: 'needed', record: needed }, { id: 'clear', record: clear },
  ], source)
  assert.deepEqual(parts.needsReview.map((unit) => unit.id), ['needed'])
  assert.deepEqual(parts.readyToSend.map((unit) => unit.id), ['clear'])
  assert.match(reviewAllAction([needed]).draft, /correctness, maintainability, simplicity/)
  assert.match(reviewAllAction([needed]).draft, /Do not push, publish, comment, merge/)
})

test('one exact prepared head has one stable review conversation scope', () => {
  const first = { id: 'first', plan: { head_sha: 'a'.repeat(40) } }
  const second = { id: 'second', plan: { head_sha: 'b'.repeat(40) } }
  const scope = contributionReviewScope([first, second])

  assert.match(scope, /^contribute-review:[0-9a-f]{16}$/)
  assert.equal(contributionReviewScope([second, first]), scope)
  assert.notEqual(
    contributionReviewScope([first, { ...second, plan: { head_sha: 'c'.repeat(40) } }]),
    scope,
  )
  assert.notEqual(contributionReviewScope([first, second], 'fix'), scope)
})

test('legacy cards can report launch progress but the Run does not start a second review', () => {
  assert.match(cardSource, /<AgentHandoffButton/)
  assert.match(cardSource, /action=\{reviewAction \|\| reviewAllAction\(\[rec\]\)\}/)
  assert.match(cardSource, /onStart=\{onReview\}/)
  assert.doesNotMatch(cardSource, /onClick=\{\(\) => onReview\(rec\)\}/)
  assert.doesNotMatch(feedSource, /onReview=\{onStartAgent\}/)
  assert.match(feedSource, /function BatchOwnedFocus/)
  assert.match(feedSource, /showDecision=\{false\}/)
})

test('a scoped review delegates exactly-once admission to chat.start', () => {
  assert.doesNotMatch(appSource, /chat\.list\(\{ scope: action\.scope \}\)/)
  assert.match(appSource, /window\.mobius\.chat\.start\(\{[\s\S]*scope: contributionActionScope\(action\)/)
  assert.match(appSource, /reused: started\.reused === true/)
  assert.match(appSource, /outcome: started\.outcome/)
})

test('all private handoffs use changed-work scopes instead of permanent one-shot chats', () => {
  const action = { event: 'prepare', title: 'Prepare work', draft: 'Current source A' }
  const scope = contributionActionScope(action)
  assert.match(scope, /^contribute-task:[0-9a-f]{16}$/)
  assert.equal(contributionActionScope({ ...action }), scope)
  assert.notEqual(contributionActionScope({ ...action, draft: 'Current source B' }), scope)
  assert.equal(contributionActionScope({ ...action, scope: 'exact-head' }), 'exact-head')
  assert.doesNotMatch(appSource, /scope: 'contribute-cycle'/)
})

test('a reviewed existing-PR update stays distinct from opening a new PR', () => {
  assert.match(appSource, /refreshed\.plan\?\.action === 'pr_update'/)
  assert.match(appSource, /updateContribution\(\{ appId, token, rec: refreshed, expectedRecord: connRef\.current\.frozenBinding \? rec : null \}\)/)
  assert.match(appSource, /Connect GitHub in Möbius Settings → Accounts before updating this pull request/)
  assert.match(cardSource, /pr_update: 'Update PR'/)
  assert.match(cardSource, /isUpdate \? 'Send update' : 'Send PR'/)
  assert.match(appSource, /\? updateContributionStack\s*: submitContributionStack/)
})

test('existing pull-request stack prefixes use one exact update phase', () => {
  assert.match(appSource, /const publicationRecords = stackPublicationRecords/)
  assert.match(appSource, /const updating = publicationRecords\.length > 0/)
  assert.match(appSource, /rec\?\.plan\?\.action === 'pr_update'/)
  assert.match(appSource, /updating\s*\? updateContributionStack\s*: submitContributionStack/)
  assert.match(appSource, /resolutions = publicationRecords\.map/)
  assert.match(appSource, /loadFreshContributionRecords\(\s*publicationRecords\.map/)
})

test('sending a pull request stays concise instead of repeating publication narration', () => {
  assert.match(cardSource, /sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)/)
  assert.doesNotMatch(cardSource, /Opening pull request/)
  assert.doesNotMatch(cardSource, /Pull request opened on GitHub for review/)
  assert.doesNotMatch(cardSource, /sendElapsed/)
  assert.match(cardSource, /setAccepted\(true\)[\s\S]*await onSend\(rec\)/)
  assert.match(cardSource, /if \(accepted\) return null/)
  assert.match(cardSource, /await onReview\?\.\(recoveryReviewAction\(rec\)\)/)
  assert.match(feedSource, /await onSend\?\.\(runPrimaryRecord\(item\)\)/)
  assert.match(feedSource, /outcome\?\.pending/)
  assert.match(batchSource, /collapseOnStart = true/)
  assert.match(batchSource, /if \(collapseOnStart\) return null/)
  assert.doesNotMatch(feedSource, /fixAndReviewAction/)
})

test('submit failures lead back to private agent recovery without overstating a stale push', () => {
  const record = {
    id: 'existing-pr', title: 'Refine the existing contribution',
    plan: { head_sha: 'a'.repeat(40) },
  }
  const action = recoveryReviewAction(record)
  assert.equal(action.scope, 'contribute-review:b0661670f342e064')
  assert.equal(action.reusedLabel, 'Review already running')
  assert.match(action.draft, /reconcile the contribution record/)
  assert.match(action.draft, /existing approval button/)
  assert.match(cardSource, /rec\.last_submit_stage === 'pushed'/)
  assert.match(cardSource, /rec\.last_submit_push_sha/)
  assert.match(cardSource, /rec\.plan\?\.head_sha/)
  assert.match(cardSource, /action=\{recoveryReviewAction\(rec\)\}/)
  assert.match(cardSource, /onStart=\{onReview\}/)
  assert.match(cardSource, /Review needs refreshing/)
  assert.match(cardSource, /<summary>Technical details<\/summary>/)
  assert.match(cardSource, /const submitFailed = sendNeedsAttention\(rec\)/)
  assert.match(cardSource, /!reviewIncomplete && !submitFailed/)
})

test('one queue handoff owns every visible private review job', () => {
  const records = [
    { id: 'fresh', type: 'pr', status: 'prepared', title: 'Fresh review' },
    {
      id: 'fix', type: 'pr', status: 'prepared', title: 'Needs a fix',
      quality_review: { state: 'changes_needed' },
    },
    { id: 'stale', type: 'pr', status: 'prepared', title: 'Stale head' },
    {
      id: 'clear', type: 'pr', status: 'prepared', title: 'Already clear',
      plan: { head_sha: 'c'.repeat(40) },
      quality_review: { state: 'all_clear', reviewed_head_sha: 'c'.repeat(40) },
    },
  ]
  const source = { byId: {
    stale: { state: 'needs_refresh' },
    clear: { state: 'ready' },
  } }
  const action = progressReviewAction(records, source)
  assert.equal(action.count, 3)
  assert.equal(action.label, 'Review all')
  assert.match(action.draft, /Fresh review/)
  assert.match(action.draft, /Needs a fix/)
  assert.match(action.draft, /Stale head/)
  assert.doesNotMatch(action.draft, /Already clear/)
  assert.match(action.draft, /Do not push, publish, comment, merge/)
})

test('one private Run owns mixed private review and public attention', () => {
  const records = [
    { id: 'review', type: 'pr', status: 'prepared', title: 'Review me' },
    { id: 'attention', type: 'pr', status: 'open', title: 'Fix checks', needs_attention: true },
  ]
  const action = organizePrivateWorkAction(records, { byId: {} }, [])
  assert.equal(action.label, 'Organize all')
  assert.equal(action.count, 2)
  assert.match(action.draft, /Do not push, publish, update a pull request, comment, merge/)
  assert.match(runSource, /organizePrivateWorkAction\(\s*privateRecords/)
  assert.doesNotMatch(feedSource, /privateAction\.count === 1 \? 'Review'/)
  assert.doesNotMatch(feedSource, /<AgentHandoffButton/)
  assert.equal(organizePrivateWorkAction([records[0]], { byId: {} }, []).label, 'Review')
  assert.equal(organizePrivateWorkAction([records[1]], { byId: {} }, []).label, 'Fix')
  assert.equal(organizePrivateWorkAction([{
    ...records[0], needs_attention: true,
  }], { byId: {} }, []).label, 'Fix and review')
})

test('a focused active review reuses the queue scope instead of starting a second review', () => {
  const record = {
    id: 'active', type: 'pr', status: 'prepared',
    plan: { head_sha: 'd'.repeat(40) },
    quality_review: { state: 'reviewing', reviewed_head_sha: 'd'.repeat(40) },
  }
  const action = progressReviewAction([record], { byId: { active: { state: 'ready' } } })

  assert.equal(action.label, 'Open chat')
  assert.equal(action.scope, contributionReviewScope([record], 'progress'))
  assert.match(cardSource, /reviewInProgress[\s\S]*'Review in progress'/)
})

test('address all handoff stays private and names every active blocker', () => {
  const records = [
    {
      id: 'prepared', type: 'pr', status: 'prepared', repo: 'mobius-os/mobius',
      title: 'Refresh prepared branch',
    },
    {
      id: 'open', type: 'pr', status: 'open', repo: 'mobius-os/app-demo',
      title: 'Handle review feedback', needs_attention: true,
      attention: { message: 'A reviewer requested a focused test.' },
      url: 'https://github.com/mobius-os/app-demo/pull/7',
    },
    {
      id: 'merged', type: 'pr', status: 'merged', needs_attention: true,
      title: 'Settled work',
    },
  ]
  const reviewStatus = {
    byId: {
      prepared: {
        state: 'needs_refresh',
        message: 'The reviewed branch moved.',
      },
    },
  }

  const action = addressAllAction(records, reviewStatus)
  assert.equal(action.count, 2)
  assert.equal(action.label, 'Address all 2')
  assert.match(action.draft, /Refresh prepared branch/)
  assert.match(action.draft, /Handle review feedback/)
  assert.doesNotMatch(action.draft, /Settled work/)
  assert.match(action.draft, /Do not push, reply, publish, merge/)
})

test('private work excludes healthy public PRs and delegates only judgment', () => {
  const action = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared' },
    { id: 'two', type: 'pr', status: 'open', needs_attention: true },
    { id: 'healthy', type: 'pr', status: 'open' },
    { id: 'old', type: 'pr', status: 'merged' },
  ], { byId: {} }, [{ name: 'Notes' }, { name: 'Voice' }])

  assert.equal(action.label, 'Organize all')
  assert.equal(action.count, 4)
  assert.match(action.draft, /^Organize the current private contribution work/)
  assert.match(action.draft, /Notes/)
  assert.match(action.draft, /Voice/)
  assert.match(action.draft, /deterministic reconciliation helpers/)
  assert.match(action.draft, /Use agent judgment only where it is actually required/)
  assert.doesNotMatch(action.draft, /healthy/)
  assert.doesNotMatch(action.draft, /durable waits/)
  assert.match(action.startedMessage, /approval buttons update/)
})

test('private work starts a fresh scoped task only when represented work changes', () => {
  const first = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared', plan: { head_sha: 'first' } },
  ], { byId: {} }, [])
  const same = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared', plan: { head_sha: 'first' } },
  ], { byId: {} }, [])
  const changed = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared', plan: { head_sha: 'second' } },
  ], { byId: {} }, [])

  assert.equal(contributionActionScope(first), contributionActionScope(same))
  assert.notEqual(contributionActionScope(first), contributionActionScope(changed))
})

test('healthy public work stays automatic instead of creating an agent task', () => {
  assert.equal(organizePrivateWorkAction([
    { id: 'open', type: 'pr', status: 'open' },
    { id: 'old', type: 'pr', status: 'merged' },
  ], { byId: {} }, []), null)
})

test('public action failures have one truthful owner', () => {
  assert.equal(contributionFailureOwner({ failure: { owner: 'automatic' } }), 'automatic')
  assert.equal(contributionFailureOwner({ failure: { status: 403 } }), 'owner')
  assert.equal(contributionFailureOwner({ failure: { code: 'github_not_connected' } }), 'owner')
  assert.equal(contributionFailureOwner({ failure: { code: 'review_refresh_needed' } }), 'agent')
  assert.match(cardSource, /contributionFailureOwner\(outcome\) === 'agent'/)
  assert.match(feedSource, /contributionFailureOwner\(outcome\) === 'agent'/)
  assert.doesNotMatch(feedSource, /await onStartAgent/)
  assert.match(appSource, /Connect GitHub in Möbius Settings → Accounts to send this related group as your account\.[\s\S]*?failure: \{ owner: 'owner', code: 'github_not_connected' \}/)
})

test('cycle progress uses the durable plan and current task', () => {
  assert.deepEqual(contributionCycleProgress({
    running: true,
    goal_plan: {
      tasks: [
        { id: 'prepare', title: 'Prepare local work', status: 'completed' },
        { id: 'review', title: 'Review prepared changes', status: 'running' },
      ],
      summary: { completed: 1, total: 2 },
    },
  }), {
    completed: 1,
    total: 2,
    percent: 50,
    label: 'Review prepared changes',
  })
})


// Execute the app-owned callback bodies with only their I/O boundary replaced.
// This catches early-return classifications without copying their preflight logic.
function publicCallback(name, dependencies) {
  const marker=`const ${name} = useCallback(`
  const start=appSource.indexOf(marker)+marker.length
  const end=appSource.indexOf('\n  }, [',start)
  assert.ok(start>=marker.length && end>start,'Owning callback must be present')
  const helper=appSource.match(/^function stalePublicApproval\(\) \{[\s\S]*?^\}/m)?.[0] || ''
  return new Function(...Object.keys(dependencies),`${helper}; return (${appSource.slice(start,end)}\n  })`)(...Object.values(dependencies))
}
function preflightFixture(name, read, conn = {state:'connected'}) {
  const head='a'.repeat(40)
  const approved={id:'preflight',type:'pr',status:name==='onMarkReady'?'draft':'prepared',repo:'team/repo',
    ...(name==='onMarkReady'?{number:1,url:'https://github.com/team/repo/pull/1'}:{}),
    plan:{action:'pr',repo:'team/repo',branch:'fix/preflight',head_sha:head},quality_review:{state:'all_clear',reviewed_head_sha:head}}
  const writes=[]
  const write=async()=>{writes.push(name);return {error:'Unconfirmed server response',failure:{owner:'automatic'}}}
  const dependencies={appId:'fixture',token:'fixture',autopilotDefault:false,submissionMethod:'github',connRef:{current:conn},writeBindingRefusal,
    applyRecordUpdates:()=>{},refreshReviewStatus:()=>{},contributionApprovalIsCurrent,contributionPhaseApprovalIsCurrent,qualityReviewFor,stackPublicationRecords,
    contributionPathDecision,contributionStackDecision,
    loadFreshContributionRecord:async()=>read(approved),loadFreshContributionRecords:async()=>{const value=await read(approved);return value?[value]:[]},
    updateContribution:write,submitContribution:write,submitContributionViaMobius:write,markContributionReady:write,updateContributionStack:write,submitContributionStack:write}
  return {writes,run:(options)=>publicCallback(name,dependencies)(name==='onSendStack'?[approved]:approved,options)}
}
test('app publication callbacks report failed fresh-ledger preflight as not attempted without invoking a write',async()=>{
  for(const name of ['onSend','onMarkReady','onSendStack']) for(const read of [()=>null,()=>{throw Error('offline')}]) {
    const fixture=preflightFixture(name,read)
    const outcome=await fixture.run()
    assert.equal(outcome.notAttempted,true,name)
    assert.match(outcome.error,/could not refresh/)
    assert.equal(outcome.failure.owner,'automatic')
    assert.deepEqual(fixture.writes,[])
  }
})
test('a changed saved approval fails explicitly before a write instead of throwing into uncertain settlement',async()=>{
  for(const name of ['onSend','onMarkReady','onSendStack']) {
    const fixture=preflightFixture(name,record=>({...record,plan:{...record.plan,head_sha:'b'.repeat(40)}}))
    const outcome=await fixture.run()
    assert.equal(outcome.notAttempted,true,name)
    assert.match(outcome.error,/changed/)
    assert.deepEqual(fixture.writes,[])
  }
})
test('automatic errors after entering the publication transport are never labeled not attempted',async()=>{
  for(const name of ['onSend','onMarkReady','onSendStack']) {
    const fixture=preflightFixture(name,record=>record)
    const outcome=await fixture.run()
    assert.equal(outcome.notAttempted,undefined,name)
    assert.deepEqual(fixture.writes,[name])
  }
})

// The real onSend / onSendStack callbacks from index.jsx, run with fixture dependencies.
test('a chat send whose binding disappeared before the write is refused as not attempted, with no write', async () => {
  for (const name of ['onSend', 'onSendStack']) {
    for (const conn of [{ state: 'connected', frozenBinding: false }, { state: 'connected' }]) {
      const fixture = preflightFixture(name, record => record, conn)
      const outcome = await fixture.run({ requireBinding: true })
      assert.equal(outcome.notAttempted, true, name)
      assert.equal(outcome.failure.code, 'binding_unavailable', name)
      assert.deepEqual(fixture.writes, [], name + ' made no request')
    }
    const bound = preflightFixture(name, record => record, { state: 'connected', frozenBinding: true })
    await bound.run({ requireBinding: true })
    assert.deepEqual(bound.writes, [name], name + ' writes while the binding holds')
    const fullApp = preflightFixture(name, record => record, { state: 'connected' })
    await fullApp.run()
    assert.deepEqual(fullApp.writes, [name], name + ': the full-app Send does not require the binding')
  }
})
