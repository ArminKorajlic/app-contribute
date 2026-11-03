import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_JOBS, agentMenuModel, OPENABLE_JOBS } from '../agent-menu.js'

const pull = (extra = {}) => ({
  number: 120, baseRefName: 'main', repository: { nameWithOwner: 'o/r', viewerPermission: 'ADMIN' }, isDraft: false,
  reviewDecision: '', comments: { totalCount: 0 }, reviews: { totalCount: 0 }, mergeable: 'MERGEABLE', ...extra,
})
const checks = (state, failed = 0) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 2, checkRunCountsByState: [{ state: failed ? 'FAILURE' : state, count: failed || 2 }], statusContextCountsByState: [] } } } }] } })
const summary = model => model.items.map(item => `${item.intent}:${item.rec ? 'rec' : item.off ? 'off' : 'ok'}`)

test('the menu names the jobs and offers only those this build can open', () => {
  assert.deepEqual(AGENT_JOBS.map(job => job.title), ['Review', 'Address feedback', 'Review and merge', 'Hand it over'])
  assert.deepEqual(agentMenuModel([pull()]).items.map(item => item.intent).sort(), [...OPENABLE_JOBS].sort())
  assert.equal(agentMenuModel([pull()], { offered: AGENT_JOBS.map(job => job.intent) }).items.length, 4)
})

test('changes requested puts Address feedback first and dims Review and merge with the reason', () => {
  const all = ['review', 'address', 'merge', 'review_fix_merge']
  const model = agentMenuModel([pull({ reviewDecision: 'CHANGES_REQUESTED', comments: { totalCount: 1 }, reviews: { totalCount: 2 } })], { offered: all })
  assert.deepEqual(summary(model), ['address:rec', 'review:ok', 'merge:off', 'review_fix_merge:ok'])
  assert.equal(model.items.find(item => item.intent === 'merge').reason, 'Changes are requested.')
  assert.deepEqual(model.header, { label: '#120', text: 'changes requested' })
})

test('approved and green puts Review and merge first', () => {
  const model = agentMenuModel([pull({ reviewDecision: 'APPROVED', reviews: { totalCount: 1 }, ...checks('SUCCESS') })])
  assert.equal(model.items[0].intent, 'merge')
  assert.equal(model.items[0].rec, true)
  assert.equal(model.header.text, 'approved · checks passing')
})

test('a draft with no reviews starts with Review and cannot be merged yet', () => {
  const all = ['review', 'address', 'merge', 'review_fix_merge']
  const model = agentMenuModel([pull({ isDraft: true })], { offered: all })
  assert.deepEqual(summary(model), ['review:rec', 'address:off', 'merge:off', 'review_fix_merge:ok'])
  assert.equal(model.items.find(item => item.intent === 'address').reason, 'No feedback yet.')
  assert.equal(model.items.find(item => item.intent === 'merge').reason, 'Mark it ready for review first.')
  assert.equal(model.header.text, 'draft · no reviews')
})

test('failing checks and conflicts count as feedback, and block a merge', () => {
  const failing = agentMenuModel([pull({ ...checks('FAILURE', 1) })], { offered: ['review', 'address', 'merge'] })
  assert.equal(failing.items[0].intent, 'address')
  assert.equal(failing.items.find(item => item.intent === 'merge').reason, 'Checks are failing.')
  assert.match(failing.header.text, /1 failing check/)
  const conflict = agentMenuModel([pull({ mergeable: 'CONFLICTING' })], { offered: ['review', 'address', 'merge'] })
  assert.equal(conflict.items.find(item => item.intent === 'merge').reason, 'It conflicts with main.')
  assert.match(conflict.header.text, /conflicts with main/)
})

test('without merge access the merge choices say so; a batch keeps one list for all', () => {
  const noMerge = pull({ repository: { nameWithOwner: 'o/r', viewerPermission: 'READ' } })
  const model = agentMenuModel([noMerge])
  assert.equal(model.items.find(item => item.intent === 'merge').reason, 'Needs merge access.')
  assert.ok(model.items.find(item => item.intent === 'review_fix_merge').off)
  const batch = agentMenuModel([pull(), pull({ number: 121 })], { offered: ['review', 'address', 'merge'] })
  assert.deepEqual(batch.header, { label: '2 PRs', text: 'selected' })
  assert.equal(batch.items.find(item => item.intent === 'address').reason, 'Choose one PR at a time.')
})

test('a hand-over on a draft is left to the window, which knows what this Möbius supports', () => {
  const model = agentMenuModel([pull({ isDraft: true })])
  assert.equal(model.items.find(item => item.intent === 'review_fix_merge').off, false)
})
