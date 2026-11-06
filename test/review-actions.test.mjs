import assert from 'node:assert/strict'
import test from 'node:test'
import { IGNORE_REASONS, postableFindings, reviewActionPlan, reviewStoppable } from '../review-actions.js'
import { reviewItemProgress } from '../collaboration.js'

const keys = plan => plan.map(action => action.key)
const everything = { retry: true, fix: true, ignore: true, again: true }

test('a review that found problems on your own PR offers the fix first, then setting aside, a fresh look and the question', () => {
  const plan = reviewActionPlan({ tone: 'findings', own: true, chat: true, can: everything })
  assert.deepEqual(keys(plan), ['fix', 'ignore', 'again', 'ask'])
  assert.equal(plan[0].primary, true)
  assert.deepEqual(plan.at(-1), { key: 'ask', label: 'Ask the reviewer something' }, 'the conversation is a plain button, not a link')
})

test('on someone else\'s PR there is no fix to offer, and posting stays with the reviewer and its verdict card', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'findings', own: false, chat: true, can: everything })), ['ignore', 'again', 'ask'])
  assert.deepEqual(keys(reviewActionPlan({ tone: 'changes', own: false, chat: true, can: everything })), ['ignore', 'again', 'ask'], 'a discarded verdict leaves the same findings')
})

test('a closed PR or a surface without handlers offers only what it can do', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'findings', own: true, chat: true, can: {} })), ['ask'])
  assert.deepEqual(reviewActionPlan({ tone: 'findings', own: true, chat: false, can: {} }), [])
})

test('only a review that is working or waiting on an answer can be stopped', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'running', chat: true, stoppable: true })), ['ask', 'stop'])
  assert.equal(reviewActionPlan({ tone: 'running', chat: true, stoppable: true })[0].label, 'Open chat')
  assert.deepEqual(keys(reviewActionPlan({ tone: 'needs', chat: true, asked: true, stoppable: true })), ['ask', 'stop'])
  for (const tone of ['findings', 'clear', 'waiting', 'ignored', 'settled', 'verdict']) {
    assert.ok(!keys(reviewActionPlan({ tone, own: true, chat: true, stoppable: false, can: everything })).includes('stop'), tone)
  }
})

const stoppable = (item, run, tone) => reviewStoppable({ run, tone, progress: reviewItemProgress(run, item) })
const live = { state: 'running', can_stop: true, execution_state: 'running' }

test('a running review stays stoppable after its own turn ends, because a helper may be the one that hung', () => {
  const reviewing = { state: 'reviewing' }
  assert.equal(stoppable(reviewing, live, 'running'), true)
  assert.equal(stoppable(reviewing, { ...live, execution_state: 'completed' }, 'running'), true, 'the turn handed the work to a helper and ended')
})

test('a finished review has nothing to stop, and neither does one that already halted or cannot be stopped from here', () => {
  const done = { ...live, execution_state: 'completed' }
  assert.equal(stoppable({ state: 'needs_you' }, done, 'findings'), false, 'findings are an outcome, not work in progress')
  assert.equal(stoppable({ state: 'all_clear' }, { ...done, state: 'complete' }, 'clear'), false)
  assert.equal(stoppable({ state: 'reviewing' }, { ...live, execution_state: 'stopped' }, 'halted'), false)
  assert.equal(stoppable({ state: 'reviewing' }, { ...live, can_stop: false }, 'running'), false)
  assert.equal(stoppable({ state: 'needs_you' }, { ...live, execution_state: 'awaiting_owner' }, 'needs'), true, 'a question the conversation is waiting on can still be stopped')
})

test('"answer" is for a conversation that really asked something', () => {
  assert.equal(reviewActionPlan({ tone: 'needs', chat: true, asked: true })[0].label, 'Answer in chat')
  assert.equal(reviewActionPlan({ tone: 'needs', chat: true, asked: false })[0].label, 'Open chat')
})

test('a stopped run can start again; an ignored finding can be taken back; the rest only ask', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'halted', chat: true, can: { retry: true } })), ['retry', 'ask'])
  assert.deepEqual(keys(reviewActionPlan({ tone: 'ignored', chat: true, can: { undo: true } })), ['undo', 'ask'])
  for (const tone of ['clear', 'waiting', 'settled', 'verdict']) assert.deepEqual(keys(reviewActionPlan({ tone, chat: true, can: everything })), ['ask'], tone)
})

test('there are four reasons to set a finding aside, each short enough to tap', () => {
  assert.equal(IGNORE_REASONS.length, 4)
  for (const reason of IGNORE_REASONS) assert.ok(reason.length <= 20, reason)
})

test('the ignore sheet has one close control: its header tile is not another X', async t => {
  const { frontendModules, renderModule } = await import('./render-harness.mjs')
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { IgnoreReview } from './ui/IgnoreReview.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(IgnoreReview, props))
  `)
  const html = render({ pr: { number: 2005, title: 'Follow a lost update', repository: { nameWithOwner: 'o/r' } }, onPick() {}, onClose() {} })
  assert.equal((html.match(/aria-label="Close"/g) || []).length, 1)
  assert.doesNotMatch(html, /co-rw-icon"><svg[^>]*><path[^>]*d="M[^"]*18 6[^"]*"/, 'the tile must not draw a cross')
  for (const reason of IGNORE_REASONS) assert.match(html, new RegExp(`>${reason}<`))
  assert.doesNotMatch(html, />Cancel</)
})

test('findings can be posted on someone else\'s PR, never on your own: there you fix them or set them aside', () => {
  const can = { ...everything, post: true }
  const own = reviewActionPlan({ tone: 'findings', own: true, chat: true, can })
  assert.deepEqual(keys(own), ['fix', 'ignore', 'again', 'ask'], 'no review of your own PR is ever posted')
  assert.equal(own.find(action => action.key === 'fix').primary, true)
  const others = reviewActionPlan({ tone: 'findings', own: false, chat: true, can })
  assert.deepEqual(keys(others), ['post', 'ignore', 'again', 'ask'])
  assert.equal(others[0].primary, true)
  assert.deepEqual(keys(reviewActionPlan({ tone: 'changes', own: false, chat: true, can })), ['post', 'ignore', 'again', 'ask'], 'a discarded verdict leaves the same findings')
  for (const tone of ['running', 'needs', 'clear', 'waiting', 'ignored', 'settled', 'verdict']) {
    assert.ok(!keys(reviewActionPlan({ tone, own: false, chat: true, can, stoppable: true })).includes('post'), `${tone} offers no post`)
  }
})

test('only findings with nothing of theirs on GitHub can be posted', () => {
  assert.equal(postableFindings({ state: 'needs_you' }), true)
  assert.equal(postableFindings({ public_review: { state: 'not_dispatched' } }), true, 'an attempt that certainly did not go out can be made again')
  assert.equal(postableFindings({ public_review: { state: 'posted', url: 'https://github.com/o/r/pull/1#pullrequestreview-1' } }), false)
  assert.equal(postableFindings({ public_review: { state: 'unknown' } }), false, 'an attempt that may have gone out is never repeated')
  assert.equal(postableFindings(null), true)
})
