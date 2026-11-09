import assert from 'node:assert/strict'
import test from 'node:test'
import { decide } from '../pr-machine.js'

const facts = (reviews, extra = {}) => ({ role: 'author', author: 'alex', head: 'h2', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'WRITE', reviews, openThreads: 0, myReview: null, job: null, result: null, outbox: null, readComplete: true, ...extra })
const action = (decision, id) => decision.actions.find(item => item.id === id)
const changes = { by: 'sam', state: 'CHANGES_REQUESTED', commit: 'h1', bot: false }
const comment = (commit, extra = {}) => ({ by: 'sam', state: 'COMMENTED', commit, bot: false, ...extra })
const approval = (extra = {}) => ({ by: 'sam', state: 'APPROVED', commit: 'h1', bot: false, ...extra })

test('a reviewer who looked again and only commented is asked to approve, and merge stays off', () => {
  const decision = decide(facts([changes, comment('h2')]))
  assert.equal(decision.state, 'author.looked_again')
  assert.deepEqual(decision.lookedAgain, ['sam'])
  assert.match(decision.headline, /sam looked again and left a comment, but GitHub still holds their change request/)
  assert.equal(decision.actions.find(item => item.highlighted).id, 'ask_approval')
  assert.equal(action(decision, 'ask_approval').title, 'Ask sam to approve')
  assert.equal(action(decision, 'merge').enabled, false)
})

test('asking someone to look again is for people who have not looked past their old review', () => {
  const looked = decide(facts([changes, comment('h2')]))
  assert.deepEqual(looked.rereviewFrom, [])
  assert.equal(action(looked, 'ask_rereview').reason, 'They already looked at this version. Ask them to approve.')
  const notYet = decide(facts([changes]))
  assert.deepEqual(notYet.rereviewFrom, ['sam'])
  assert.equal(action(notYet, 'ask_approval').reason, 'Nobody has looked again without approving.')
  assert.equal(action(notYet, 'ask_approval').title, 'Ask for approval')
  const mixed = decide(facts([changes, comment('h2'), { ...approval(), by: 'kim', sameWork: false }]))
  assert.deepEqual([mixed.lookedAgain, mixed.rereviewFrom], [['sam'], ['kim']])
})

test('a comment never approves, whatever the version, and a comment from a bot or from nobody holding a request changes nothing', () => {
  assert.equal(action(decide(facts([comment('h2')])), 'merge').enabled, false)
  assert.equal(decide(facts([comment('h2')])).state, 'author.waiting_review')
  assert.equal(decide(facts([changes, comment('h2', { by: 'kim' })])).state, 'author.waiting_rereview')
  assert.equal(decide(facts([changes, comment('h2', { bot: true })])).state, 'author.waiting_rereview')
  assert.equal(decide(facts([changes, comment('h1')])).state, 'author.waiting_rereview')
})

test('a bot’s plain comment is conversation, not a finding to answer', () => {
  const decision = decide(facts([comment('h2', { by: 'qa-bot', bot: true })]))
  assert.equal(action(decision, 'respond').reason, 'Nothing to respond to.')
  assert.equal(action(decide(facts([{ by: 'qa-bot', state: 'CHANGES_REQUESTED', commit: 'h2', bot: true }])), 'respond').enabled, true)
})

test('an approval of an older commit carries over only when its work was proved the same', () => {
  const carried = decide(facts([approval({ sameWork: true })]))
  assert.equal(carried.state, 'author.approved')
  assert.deepEqual([carried.approvedBy, carried.carriedFrom, carried.rereviewFrom], [['sam'], [{ by: 'sam', commit: 'h1' }], []])
  assert.match(carried.headline, /approved by sam, checks green\. The lines you added and removed are the same as when they approved\. Merge it/)
  assert.equal(action(carried, 'ask_rereview').reason, 'Nobody reviewed an older version.')
  for (const sameWork of [false, null, undefined]) {
    const old = decide(facts([approval({ sameWork })]))
    assert.equal(old.state, 'author.approval_stale', String(sameWork))
    assert.deepEqual(old.carriedFrom, [])
  }
})

test('an approval of this very commit keeps its plain wording even when another approval carried over', () => {
  const decision = decide(facts([approval({ sameWork: true }), { ...approval({ commit: 'h2' }), by: 'kim' }]))
  assert.deepEqual(decision.approvedBy, ['sam', 'kim'])
  assert.match(decision.headline, /approved by sam, kim at this version/)
})

test('a carried approval still waits for checks, conflicts and any standing change request', () => {
  assert.equal(decide(facts([approval({ sameWork: true })], { checks: 'fail' })).state, 'author.blocked')
  assert.equal(decide(facts([approval({ sameWork: true })], { checks: 'pending' })).state, 'author.approved_checks')
  const standing = decide(facts([approval({ sameWork: true }), { ...changes, by: 'kim' }]))
  assert.equal(action(standing, 'merge').reason, 'kim asked for changes and hasn’t approved since.')
})
