import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_JOBS, OPENABLE_JOBS, YOUR_ACTIONS, actionsMenuModel, mergeBlocker, pullStanding } from '../actions-menu.js'

const pull = (extra = {}) => ({
  number: 120, baseRefName: 'main', repository: { nameWithOwner: 'o/r', viewerPermission: 'ADMIN' }, isDraft: false,
  reviewDecision: '', comments: { totalCount: 0 }, reviews: { totalCount: 0 }, mergeable: 'MERGEABLE', ...extra,
})
const checks = (state, failed = 0) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 2, checkRunCountsByState: [{ state: failed ? 'FAILURE' : state, count: failed || 2 }], statusContextCountsByState: [] } } } }] } })
const summary = model => model.agent.map(item => `${item.intent}:${item.rec ? 'rec' : item.off ? 'off' : 'ok'}`)

test('the menu names the jobs and offers only those this build can open', () => {
  assert.deepEqual(AGENT_JOBS.map(job => job.title), ['Review', 'Address feedback', 'Review and merge', 'Hand it over'])
  assert.deepEqual(actionsMenuModel([pull()]).agent.map(item => item.intent).sort(), [...OPENABLE_JOBS].sort())
  assert.equal(actionsMenuModel([pull()], { offered: AGENT_JOBS.map(job => job.intent) }).agent.length, 4)
})

test('changes requested puts Address feedback first and dims Review and merge with the reason', () => {
  const all = ['review', 'address', 'merge', 'review_fix_merge']
  const model = actionsMenuModel([pull({ reviewDecision: 'CHANGES_REQUESTED', comments: { totalCount: 1 }, reviews: { totalCount: 2 } })], { offered: all, own: true })
  assert.deepEqual(summary(model), ['address:rec', 'review:ok', 'merge:off', 'review_fix_merge:ok'])
  assert.match(model.agent.find(item => item.intent === 'merge').reason, /cannot approve your own PR/)
  const theirs = actionsMenuModel([pull({ reviewDecision: 'CHANGES_REQUESTED', comments: { totalCount: 1 }, reviews: { totalCount: 2 } })], { offered: all })
  assert.equal(theirs.agent.find(item => item.intent === 'merge').reason, 'Changes are requested.')
  assert.deepEqual(model.header, { label: '#120', text: 'changes requested' })
})

test('approved and green puts Review and merge first', () => {
  const model = actionsMenuModel([pull({ reviewDecision: 'APPROVED', reviews: { totalCount: 1 }, ...checks('SUCCESS') })])
  assert.equal(model.agent[0].intent, 'merge')
  assert.equal(model.agent[0].rec, true)
  assert.equal(model.header.text, 'approved · checks passing')
})

test('a draft with no reviews starts with Review and cannot be merged yet', () => {
  const all = ['review', 'address', 'merge', 'review_fix_merge']
  const model = actionsMenuModel([pull({ isDraft: true })], { offered: all, own: true })
  assert.deepEqual(summary(model), ['review:rec', 'address:off', 'merge:off', 'review_fix_merge:ok'])
  assert.equal(model.agent.find(item => item.intent === 'merge').reason, 'You cannot approve your own PR. Someone else approves it, then you merge it.')
  assert.equal(model.agent.find(item => item.intent === 'address').reason, 'No feedback yet.')
  assert.equal(model.header.text, 'draft · no reviews')
})

test('failing checks and conflicts count as feedback, and block a merge', () => {
  const failing = actionsMenuModel([pull({ ...checks('FAILURE', 1) })], { offered: ['review', 'address', 'merge'], own: true })
  assert.equal(failing.agent[0].intent, 'address')
  assert.match(failing.header.text, /1 failing check/)
  assert.equal(actionsMenuModel([pull({ ...checks('FAILURE', 1) })], { offered: ['merge'] }).agent[0].reason, 'Checks are failing.')
  const conflict = actionsMenuModel([pull({ mergeable: 'CONFLICTING' })], { offered: ['review', 'address', 'merge'] })
  assert.equal(conflict.agent.find(item => item.intent === 'merge').reason, 'It conflicts with main.')
  assert.match(conflict.header.text, /conflicts with main/)
})

test('without merge access the merge choices say so; a batch keeps one list for all', () => {
  const noMerge = pull({ repository: { nameWithOwner: 'o/r', viewerPermission: 'READ' } })
  const model = actionsMenuModel([noMerge])
  assert.equal(model.agent.find(item => item.intent === 'merge').reason, 'Needs merge access.')
  assert.ok(model.agent.find(item => item.intent === 'review_fix_merge').off)
  const batch = actionsMenuModel([pull(), pull({ number: 121 })], { offered: ['review', 'address', 'merge'] })
  assert.deepEqual(batch.header, { label: '2 PRs', text: 'selected' })
  assert.equal(batch.agent.find(item => item.intent === 'address').reason, 'Choose one PR at a time.')
})

test('a hand-over on a draft is left to the window, which knows what this Möbius supports', () => {
  const model = actionsMenuModel([pull({ isDraft: true })])
  assert.equal(model.agent.find(item => item.intent === 'review_fix_merge').off, false)
})

const draftRecord = { status: 'draft', submission_mode: 'github' }
const mergeable = { merge_now: true }
const youSummary = model => model.you.map(item => `${item.intent}:${item.rec ? 'rec' : item.off ? 'off' : 'ok'}`)

test('your own actions: Open for review only for a draft this app can open, nothing for a batch', () => {
  assert.deepEqual(YOUR_ACTIONS.map(action => action.title), ['Open for review', 'Merge'])
  const draft = pull({ isDraft: true })
  assert.deepEqual(youSummary(actionsMenuModel([draft], { record: draftRecord })), ['open_review:ok'])
  assert.deepEqual(actionsMenuModel([draft]).you, [], 'a draft nobody sent from here cannot be opened from here')
  assert.deepEqual(actionsMenuModel([draft], { record: { status: 'draft', submission_mode: 'mobius-bot' } }).you, [], 'a relay draft cannot request review from this connection')
  assert.deepEqual(actionsMenuModel([pull()], { record: draftRecord }).you, [], 'a PR that is already open has nothing to open')
  assert.deepEqual(actionsMenuModel([draft, pull({ number: 121, isDraft: true })], { record: draftRecord, capabilities: mergeable }).you, [], 'never a merge or open for a batch')
})

test('an approved draft recommends Open for review; Merge waits on it', () => {
  const approvedDraft = pull({ isDraft: true, reviewDecision: 'APPROVED', reviews: { totalCount: 1 } })
  const model = actionsMenuModel([approvedDraft], { record: draftRecord, capabilities: mergeable })
  assert.deepEqual(youSummary(model), ['open_review:rec', 'merge_now:off'])
  assert.equal(model.you[1].reason, 'Open it for review first.')
})

test('Merge appears only where this Möbius can merge for you, and says why when it cannot', () => {
  const ready = pull({ reviewDecision: 'APPROVED', reviews: { totalCount: 1 }, ...checks('SUCCESS') })
  assert.deepEqual(actionsMenuModel([ready]).you, [], 'no platform support, no Merge')
  assert.deepEqual(actionsMenuModel([ready], { capabilities: { merge_now: false } }).you, [])
  const model = actionsMenuModel([ready], { capabilities: mergeable })
  assert.deepEqual(youSummary(model), ['merge_now:rec'])
  assert.ok(model.agent.every(item => !item.rec), 'merging yourself outranks asking an agent to merge')
  const reasons = (extra) => actionsMenuModel([pull(extra)], { capabilities: mergeable }).you[0].reason
  assert.equal(reasons({ reviewDecision: 'CHANGES_REQUESTED' }), 'Changes are requested.')
  assert.equal(reasons({ reviewDecision: 'REVIEW_REQUIRED' }), 'GitHub still needs a review.')
  assert.equal(reasons({ ...checks('FAILURE', 2) }), 'Checks are failing.')
  assert.equal(reasons({ ...checks('PENDING') }), 'Checks are still running.')
  assert.equal(reasons({ mergeable: 'CONFLICTING' }), 'It conflicts with main.')
  assert.equal(reasons({ repository: { nameWithOwner: 'o/r', viewerPermission: 'READ' } }), 'Needs merge access.')
  assert.equal(mergeBlocker(pullStanding(ready)), '', 'an approved green PR has nothing in the way')
})

test('with nothing of your own to do the menu is the plain agent list', () => {
  const model = actionsMenuModel([pull()])
  assert.deepEqual(model.you, [])
  assert.equal(model.agent.length, 4)
})

test('a draft you wrote can be opened for review when this Möbius can mark it ready, whoever sent it', () => {
  const draft = pull({ isDraft: true })
  const ready = { mark_ready_now: true }
  assert.deepEqual(youSummary(actionsMenuModel([draft], { capabilities: ready, own: true })), ['open_review:ok'])
  assert.deepEqual(actionsMenuModel([draft], { capabilities: ready }).you, [], 'someone else\'s draft is not yours to open here')
  assert.deepEqual(actionsMenuModel([draft], { own: true }).you, [], 'until this Möbius can mark it ready there is nothing to offer')
  assert.deepEqual(actionsMenuModel([pull()], { capabilities: ready, own: true }).you, [], 'a PR that is already open has nothing to open')
  assert.deepEqual(actionsMenuModel([draft, pull({ number: 121, isDraft: true })], { capabilities: ready, own: true }).you, [], 'never for a batch')
  const approved = actionsMenuModel([pull({ isDraft: true, reviewDecision: 'APPROVED' })], { capabilities: ready, own: true })
  assert.equal(approved.you.find(item => item.intent === 'open_review').rec, true, 'an approved draft of yours has opening as its next step')
})

test('who you are on the PR decides what an agent may do: fixing is for the author, approving for the reviewer', () => {
  const all = ['review', 'address', 'merge', 'review_fix_merge']
  const feedback = pull({ reviewDecision: 'CHANGES_REQUESTED', comments: { totalCount: 1 }, reviews: { totalCount: 1 } })
  const theirs = actionsMenuModel([feedback], { offered: all })
  assert.equal(theirs.agent.find(item => item.intent === 'address').off, true)
  assert.match(theirs.agent.find(item => item.intent === 'address').reason, /someone else’s branch/)
  assert.equal(theirs.agent.find(item => item.intent === 'review').off, false)
  const mine = actionsMenuModel([pull({ reviewDecision: 'APPROVED', reviews: { totalCount: 1 }, ...checks('SUCCESS') })], { offered: all, own: true })
  assert.match(mine.agent.find(item => item.intent === 'merge').reason, /cannot approve your own PR/)
  assert.equal(mine.agent.find(item => item.intent === 'review').detail, 'Checks your PR privately. Nothing is posted.')
  assert.equal(theirs.agent.find(item => item.intent === 'review').detail, 'Private notes, or a review on GitHub.')
})
