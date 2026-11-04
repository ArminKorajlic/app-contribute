import assert from 'node:assert/strict'
import test from 'node:test'
import { IGNORE_REASONS, reviewActionPlan } from '../review-actions.js'

const keys = plan => plan.map(action => action.key)
const everything = { retry: true, fix: true, post: true, ignore: true, again: true }

test('a review that found problems on your own PR offers the fix first, then setting aside, a fresh look and the question', () => {
  const plan = reviewActionPlan({ tone: 'findings', own: true, chat: true, can: { ...everything, post: false } })
  assert.deepEqual(keys(plan), ['fix', 'ignore', 'again', 'ask'])
  assert.equal(plan[0].primary, true)
  assert.deepEqual(plan.at(-1), { key: 'ask', label: 'Ask the reviewer something' }, 'the conversation is a plain button, not a link')
})

test('on someone else\'s PR the next step is posting the review, which needs the platform; without it there is no fix to offer', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'findings', own: false, chat: true, can: everything })), ['post', 'ignore', 'again', 'ask'])
  assert.deepEqual(keys(reviewActionPlan({ tone: 'findings', own: false, chat: true, can: { ...everything, post: false } })), ['ignore', 'again', 'ask'])
  assert.deepEqual(keys(reviewActionPlan({ tone: 'changes', own: false, chat: true, can: { ...everything, post: false } })), ['ignore', 'again', 'ask'], 'a discarded verdict leaves the same findings')
})

test('a closed PR or a surface without handlers offers only what it can do', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'findings', own: true, chat: true, can: {} })), ['ask'])
  assert.deepEqual(reviewActionPlan({ tone: 'findings', own: true, chat: false, can: {} }), [])
})

test('only a review that is working or waiting on an answer can be stopped', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'running', chat: true, stoppable: true })), ['ask', 'stop'])
  assert.equal(reviewActionPlan({ tone: 'running', chat: true, stoppable: true })[0].label, 'Open review conversation')
  assert.deepEqual(keys(reviewActionPlan({ tone: 'needs', chat: true, asked: true, stoppable: true })), ['ask', 'stop'])
  for (const tone of ['findings', 'clear', 'waiting', 'ignored', 'settled', 'verdict']) {
    assert.ok(!keys(reviewActionPlan({ tone, own: true, chat: true, stoppable: false, can: everything })).includes('stop'), tone)
  }
})

test('"answer" is for a conversation that really asked something', () => {
  assert.equal(reviewActionPlan({ tone: 'needs', chat: true, asked: true })[0].label, 'Answer in review conversation')
  assert.equal(reviewActionPlan({ tone: 'needs', chat: true, asked: false })[0].label, 'Open review conversation')
})

test('a stopped run can start again; an ignored finding can be taken back; the rest only ask', () => {
  assert.deepEqual(keys(reviewActionPlan({ tone: 'halted', chat: true, can: { retry: true } })), ['retry', 'ask'])
  assert.deepEqual(keys(reviewActionPlan({ tone: 'ignored', chat: true, can: { ignore: true } })), ['undo', 'ask'])
  for (const tone of ['clear', 'waiting', 'settled', 'verdict']) assert.deepEqual(keys(reviewActionPlan({ tone, chat: true, can: everything })), ['ask'], tone)
})

test('there are four reasons to set a finding aside, each short enough to tap', () => {
  assert.equal(IGNORE_REASONS.length, 4)
  for (const reason of IGNORE_REASONS) assert.ok(reason.length <= 20, reason)
})
