import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addressAllAction,
  contributionsNeedingAttention,
  indexReviewStatus,
  isContributionCycleChat,
  partitionReviewUnits,
  progressReviewAction,
  reviewStateFor,
} from '../review.js'

function clear(id) {
  return {
    id,
    status: 'prepared',
    plan: { head_sha: `${id}-head` },
    quality_review: { state: 'all_clear', reviewed_head_sha: `${id}-head` },
  }
}

test('review status indexes only recognized verdicts', () => {
  const indexed = indexReviewStatus({
    generated_at: '2026-07-15T02:00:00Z',
    records: [
      { id: 'ready', state: 'ready' },
      { id: 'stale', state: 'needs_refresh' },
      { id: 'unchecked', state: 'unavailable', code: 'github_reconnect' },
      { id: 'future', state: 'maybe' },
      null,
    ],
  })
  assert.deepEqual(Object.keys(indexed.byId), ['ready', 'stale', 'unchecked'])
  assert.equal(indexed.byId.unchecked.code, 'github_reconnect')
  assert.equal(indexed.checkedAt, '2026-07-15T02:00:00Z')
})

test('current review verdicts outrank old retryable send messages', () => {
  const ready = { state: 'ready', code: 'ready', message: 'Local checkout matches.' }
  for (const last_submit_error of [
    'Branch changed.',
    'Could not inspect fork state. Try Send again.',
    'Could not submit this PR (500). Try Send again.',
  ]) {
    assert.deepEqual(reviewStateFor({
      id: 'retryable', status: 'prepared', last_submit_error,
    }, { state: 'ready', byId: { retryable: ready } }), ready)
  }
  assert.equal(reviewStateFor({
    id: 'unchecked', status: 'prepared', last_submit_error: 'Branch changed.',
  }, { state: 'unavailable', byId: {} }), null)
})

test('feed and batch actions share one review partition', () => {
  const units = [
    { type: 'record', id: 'ready', record: clear('ready'), records: [clear('ready')] },
    {
      type: 'record', id: 'blocked',
      record: { id: 'blocked', status: 'prepared' },
      records: [{ id: 'blocked', status: 'prepared' }],
    },
    {
      type: 'record', id: 'attention',
      record: { ...clear('attention'), needs_attention: true },
      records: [{ ...clear('attention'), needs_attention: true }],
    },
    {
      type: 'stack', id: 'stack',
      records: [{ id: 'stack-1', status: 'open' }, clear('stack-2')],
    },
    { type: 'record', id: 'unchecked', record: clear('unchecked'), records: [clear('unchecked')] },
    {
      type: 'stack', id: 'unchecked-stack',
      records: [clear('unchecked-1'), { ...clear('unchecked-2'), quality_review: {} }],
    },
  ]
  const partition = partitionReviewUnits(units, { byId: {
    ready: { state: 'ready' },
    blocked: { state: 'needs_refresh' },
    attention: { state: 'ready' },
    'stack-2': { state: 'ready' },
    unchecked: { state: 'unavailable', code: 'github_reconnect' },
    'unchecked-1': { state: 'unavailable', code: 'review_unavailable' },
    'unchecked-2': { state: 'ready' },
  } })
  assert.deepEqual(partition.needsAttention.map((unit) => unit.id), ['blocked', 'attention'])
  assert.deepEqual(partition.readyToSend.map((unit) => unit.id), ['ready', 'stack'])
  // Only reviewed work waits on the check; a layer still needing review is review work.
  assert.deepEqual(partition.awaitingCheck.map(({ unit }) => unit.id), ['unchecked'])
  assert.match(partition.awaitingCheck[0].message, /^Reconnect GitHub/)
  assert.deepEqual(partition.needsReview.map((unit) => unit.id), ['unchecked-stack'])
})

test('a check that could not run never starts a review agent', () => {
  const pr = (id, review) => ({ ...clear(id), type: 'pr', ...(review ? { quality_review: review } : {}) })
  const status = { byId: {
    unchecked: { state: 'unavailable', code: 'github_reconnect' },
    unreviewed: { state: 'unavailable', code: 'review_unavailable' },
  } }
  assert.equal(progressReviewAction([pr('unchecked')], status), null)
  const action = progressReviewAction([pr('unchecked'), pr('unreviewed', {})], status)
  assert.equal(action.count, 1)
  assert.match(action.draft, /complete the quality review \(unreviewed\)/)
  assert.doesNotMatch(action.draft, /\(unchecked\)/)
})

test('address all includes active blockers, not history or healthy public work', () => {
  const records = [
    { id: 'local', type: 'pr', status: 'prepared', repo: 'mobius-os/app-local', plan: { title: 'Refresh local change' } },
    {
      id: 'live', type: 'pr', status: 'open', title: 'Fix live checks',
      repo: 'mobius-os/app-live', needs_attention: true,
      attention: { title: 'Checks failed', message: 'One test is red.' },
    },
    { id: 'history', type: 'pr', status: 'merged', needs_attention: true },
    { id: 'issue', type: 'issue', status: 'open', needs_attention: true },
    { id: 'clean', type: 'pr', status: 'open' },
  ]
  const review = { byId: { local: {
    state: 'needs_refresh', message: 'The source branch moved.',
  } } }
  assert.deepEqual(
    contributionsNeedingAttention(records, review).map((record) => record.id),
    ['local', 'live'],
  )
  const action = addressAllAction(records, review)
  assert.equal(action.count, 2)
  assert.match(action.draft, /Refresh local change/)
  assert.match(action.draft, /Checks failed — One test is red\./)
  assert.doesNotMatch(action.draft, /history|issue|clean/)
})

test('contribution cycle recovery uses its durable scope only', () => {
  assert.equal(isContributionCycleChat({ scope: 'contribute-cycle', title: 'Anything' }), true)
  assert.equal(isContributionCycleChat({ scope: 'contribute-task:abc123' }), true)
  assert.equal(isContributionCycleChat({ title: 'Finishing the contribution cycle' }), false)
  assert.equal(isContributionCycleChat({ scope_label: 'Contribution cycle' }), false)
})
