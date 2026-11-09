import assert from 'node:assert/strict'
import test from 'node:test'
import { decide } from '../pr-machine.js'

// The app's own rule: a draft that deals with the open findings owns them (the platform never sees drafts, so the shared corpus has no such case).
const AGENT = ['check_my_pr', 'respond', 'finish_it', 'review', 'take_over']
const facts = (role, outbox) => ({ role, author: role === 'author' ? 'alex' : 'sam', head: 'h2', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'MAINTAIN',
  reviews: [], openThreads: 0, myReview: null, job: null, readComplete: true, result: { head: 'h2', outcome: 'findings', setAside: false }, outbox })
const enabled = decision => decision.actions.filter(action => action.enabled).map(action => action.id)

test('a draft that covers the findings turns off every agent job and Ignore, in every step of its way out', () => {
  for (const role of ['author', 'reviewer']) for (const state of ['drafted', 'sending', 'unconfirmed']) {
    const decision = decide(facts(role, { kind: 'repair', head: 'h2', state, covers: true }))
    assert.equal(decision.coveredBy, 'repair')
    assert.deepEqual(enabled(decision).filter(id => [...AGENT, 'set_aside'].includes(id)), [], `${role} ${state}`)
  }
  assert.match(decide(facts('author', { kind: 'answer', head: 'h2', state: 'drafted', covers: true })).actions.find(action => action.id === 'respond').reason, /Send it or throw it away/)
})

test('a draft that does not cover them leaves the rest as it was: a ready answer can still be replaced', () => {
  const decision = decide(facts('author', { kind: 'answer', head: 'h2', state: 'drafted', covers: false }))
  assert.equal(decision.coveredBy, '')
  assert.ok(enabled(decision).includes('respond') && enabled(decision).includes('set_aside'))
})
