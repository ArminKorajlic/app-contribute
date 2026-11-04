import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_INTENTS, PUBLIC_REVIEW_ACTIONS, STATES, YOUR_RULES, intentBlocker, prFlow, statesByTurn, waitsForConfirmation, yourActionsFor } from '../pr-flow.js'

const pull = (extra = {}) => ({
  number: 7, state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', author: { login: 'someone-else' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'ADMIN' }, ...extra,
})
const checks = (failed = 0) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 2, checkRunCountsByState: [{ state: failed ? 'FAILURE' : 'SUCCESS', count: failed || 2 }], statusContextCountsByState: [] } } } }] } })
const review = (state, extra = {}, run = {}) => ({ run: { execution_state: 'completed', ...run }, item: { state, head_sha: 'a'.repeat(40), ...extra } })
const proposal = (state, event = 'APPROVE') => ({ verdict_proposal: { state, event } })

// Every situation the owner can be in, on a PR they wrote and on one they did not.
const AUTHOR = {
  'author.draft': { pr: pull({ isDraft: true }) },
  'author.checking': { pr: pull(), status: review('reviewing', {}, { execution_state: 'running' }) },
  'author.findings': { pr: pull(), status: review('needs_you', { summary: 'A bug' }) },
  'author.attention': { pr: pull(), status: review('needs_you', {}, { execution_state: 'failed' }) },
  'author.feedback': { pr: pull({ reviewDecision: 'CHANGES_REQUESTED' }) },
  'author.waiting': { pr: pull() },
  'author.approved': { pr: pull({ reviewDecision: 'APPROVED', ...checks() }) },
  merged: { pr: pull({ state: 'MERGED' }) },
  closed: { pr: pull({ state: 'CLOSED' }) },
}
const REVIEWER = {
  'reviewer.to_review': { pr: pull() },
  'reviewer.reviewing': { pr: pull(), status: review('reviewing', {}, { execution_state: 'running' }) },
  'reviewer.decide': { pr: pull(), status: review('needs_you', { summary: 'A bug' }) },
  'reviewer.confirm': { pr: pull(), status: review('verdict_pending', proposal('proposed')) },
  'reviewer.waiting_author': { pr: pull(), status: review('needs_you', proposal('posted', 'REQUEST_CHANGES')) },
  'reviewer.re_review': { pr: pull(), earlier: review('needs_you', proposal('posted', 'REQUEST_CHANGES')) },
  'reviewer.done': { pr: pull(), status: review('all_clear') },
  merged: { pr: pull({ state: 'MERGED' }) },
  closed: { pr: pull({ state: 'CLOSED' }) },
}
const walk = () => [
  ...Object.entries(AUTHOR).map(([state, facts]) => ({ state, own: true, flow: prFlow({ ...facts, own: true }) })),
  ...Object.entries(REVIEWER).map(([state, facts]) => ({ state, own: false, flow: prFlow({ ...facts, own: false }) })),
]

test('each situation lands in the state it is named for', () => {
  for (const { state, flow } of walk()) assert.equal(flow.state, state, `${state} came out as ${flow.state}`)
})

test('every state has words, a turn and a headline, and every turn is a known one', () => {
  for (const [key, state] of Object.entries(STATES)) {
    assert.ok(state.label && state.headline && ['you', 'agent', 'other', 'none'].includes(state.turn), key)
  }
})

test('rule 1: nothing that puts a review in public ever exists for the author of the PR', () => {
  for (const { state, own, flow } of walk().filter(item => item.own)) {
    const offered = yourActionsFor(flow)
    for (const action of PUBLIC_REVIEW_ACTIONS) assert.ok(!offered.includes(action), `${action} offered on your own PR in ${state}`)
    assert.ok(!waitsForConfirmation(flow), `${state} waits for a confirmation on your own PR`)
  }
  for (const action of PUBLIC_REVIEW_ACTIONS) assert.ok(!YOUR_RULES[action].roles.includes('author'))
})

test('rule 2: fixing the branch is the author’s job, and an agent cannot approve your own PR', () => {
  assert.equal(intentBlocker('author', 'address'), '')
  assert.match(intentBlocker('reviewer', 'address'), /someone else’s branch/)
  assert.match(intentBlocker('author', 'merge'), /cannot approve your own PR/)
  assert.equal(intentBlocker('reviewer', 'merge'), '')
  for (const intent of ['review', 'review_fix_merge']) for (const role of ['author', 'reviewer']) assert.equal(intentBlocker(role, intent), '')
  assert.deepEqual(Object.keys(AGENT_INTENTS).sort(), ['address', 'merge', 'review', 'review_fix_merge'])
})

test('rule 3: only a drafted verdict or review waits for your confirmation, and only on someone else’s PR', () => {
  const waiting = walk().filter(item => waitsForConfirmation(item.flow)).map(item => item.state)
  assert.deepEqual(waiting.sort(), ['reviewer.confirm', 'reviewer.decide'])
  assert.deepEqual(yourActionsFor(prFlow({ ...REVIEWER['reviewer.confirm'], own: false })).sort(), ['discard_verdict', 'submit_verdict'])
})

test('rule 5: whose move it is follows what already happened', () => {
  const turn = (table, state, own) => prFlow({ ...table[state], own }).turn
  assert.equal(turn(REVIEWER, 'reviewer.waiting_author', false), 'other')
  assert.equal(turn(REVIEWER, 'reviewer.re_review', false), 'you')
  assert.equal(turn(AUTHOR, 'author.waiting', true), 'other')
  assert.equal(turn(AUTHOR, 'author.feedback', true), 'you')
  assert.equal(turn(AUTHOR, 'author.checking', true), 'agent')
  assert.deepEqual(statesByTurn('none').sort(), ['closed', 'merged', 'reviewer.done'])
})

test('a finding you set aside is no longer yours to deal with', () => {
  const status = review('needs_you', { repo: 'o/r', number: 7, head_sha: 'a'.repeat(40), summary: 'A bug' })
  const ignored = { [`o/r#7@${'a'.repeat(40)}`]: { reason: 'Not a bug' } }
  assert.equal(prFlow({ pr: pull(), own: true, status, ignored }).state, 'author.waiting')
})

test('your own PR needs approval, green checks and merge rights before it reads as ready to merge', () => {
  const state = extra => prFlow({ pr: pull({ reviewDecision: 'APPROVED', ...extra }), own: true }).state
  assert.equal(state(checks()), 'author.approved')
  assert.equal(state(checks(1)), 'author.feedback')
  assert.equal(state({ ...checks(), repository: { viewerPermission: 'READ' } }), 'author.waiting')
  assert.equal(state({ ...checks(), mergeable: 'CONFLICTING' }), 'author.feedback')
})

test('the headline names the person you are waiting on', () => {
  assert.equal(prFlow({ ...REVIEWER['reviewer.waiting_author'], own: false }).headline, 'Their PR · you asked for changes. Waiting on someone-else')
  assert.equal(prFlow({ ...AUTHOR['author.waiting'], own: true }).waitingOn, 'reviewers')
})
