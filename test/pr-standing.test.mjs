import assert from 'node:assert/strict'
import test from 'node:test'
import { chipOf, frameOf, standingFor } from '../pr-standing.js'

// How a PR row shows its machine decision: the comet frame and the chip.
const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
const pull = (extra = {}) => ({ number: 7, state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE', author: { login: 'someone-else' },
  repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...extra })
const run = (item, extra = {}) => ({ id: 'r', created_at: '2026-11-04T10:00:00Z', state: 'complete', execution_state: 'completed', chat_id: 'c',
  items: [{ repo: 'team/repo', number: 7, head_sha: HEAD, base_ref: 'main', ...item }], ...extra })
const row = (pr, runs = [], ignored = null) => { const decision = standingFor({ pr, login: 'me', runs, ignored }); return { frame: frameOf(decision), chip: chipOf(decision) } }

test('after you request changes the row goes quiet and names who holds the move', () => {
  const requested = run({ state: 'needs_you', verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES', head_sha: HEAD } })
  assert.deepEqual(row(pull(), [requested]), { frame: 'idle', chip: { label: 'Waiting on someone-else', tone: 'waiting' } })
})

test('a draft, a question or findings that are yours keep the amber frame and say which', () => {
  assert.deepEqual(row(pull(), [run({ state: 'verdict_pending', verdict_proposal: { state: 'proposed', event: 'APPROVE', head_sha: HEAD } })]), { frame: 'verdict', chip: { label: 'Draft to send', tone: 'owner' } })
  assert.deepEqual(row(pull(), [run({ state: 'needs_you', summary: 'P1' })]), { frame: 'verdict', chip: { label: 'Review ready', tone: 'owner' } })
  assert.equal(row(pull(), [run({ state: 'merge_unknown' })]).chip.label, 'Not confirmed')
  assert.equal(row(pull(), [run({ state: 'reviewing' }, { state: 'running', execution_state: 'failed' })]).chip.label, 'Agent stopped')
  assert.equal(row(pull(), [run({ state: 'reviewing' }, { state: 'reviewing', execution_state: 'completed' })]).chip.label, 'Agent stopped', 'its conversation ended while it still said reviewing')
  assert.deepEqual(row(pull(), [run({ state: 'reviewing' }, { state: 'running', execution_state: 'stopped' })]), { frame: 'idle', chip: null }, 'a review you stopped asks nothing of you')
  assert.deepEqual(row(pull(), [run({ state: 'reviewing' }, { state: 'running', execution_state: 'running' })]), { frame: 'reviewing', chip: null }, 'the travelling frame is the signal while it works')
  assert.deepEqual(row(pull({ author: { login: 'me' } }), [run({ state: 'needs_you', summary: 'P1' })]), { frame: 'verdict', chip: { label: 'Findings', tone: 'owner' } })
})

test('new commits after any review of yours bring their PR back; your own pushes ask nothing of you', () => {
  const requestedOld = pull({ viewerLatestReview: { state: 'CHANGES_REQUESTED', commit: { oid: OLD } } })
  assert.deepEqual(row(requestedOld), { frame: 'verdict', chip: { label: 'New commits · review again', tone: 'owner' } })
  const approvedOld = pull({ viewerLatestReview: { state: 'APPROVED', commit: { oid: OLD } } })
  assert.equal(row(approvedOld).chip.label, 'New commits · review again', 'an approval of an older version is not current (decision 03)')
  assert.deepEqual(row(pull({ author: { login: 'me' } }), [run({ state: 'needs_you', head_sha: OLD })]), { frame: 'idle', chip: null })
  assert.deepEqual(row(pull()), { frame: 'idle', chip: null }, 'a PR nobody reviewed yet is quiet')
})

test('an ignored finding leaves the row quiet', () => {
  const findings = [run({ state: 'needs_you', summary: 'P1' })]
  const ignored = { [`team/repo#7@${HEAD}`]: { reason: 'Out of scope', at: '2026-11-04T10:00:00Z' } }
  assert.equal(row(pull({ author: { login: 'me' } }), findings).frame, 'verdict')
  assert.deepEqual(row(pull({ author: { login: 'me' } }), findings, ignored), { frame: 'idle', chip: null })
})
