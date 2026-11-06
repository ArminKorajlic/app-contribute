import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { chipOf, frameOf, standingFor } from '../pr-standing.js'
import { normalizeDecision, normalizeResult } from '../respond-result.js'
import { NAMES } from '../names.js'

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
  assert.equal(row(pull(), [run({ state: 'reviewing' }, { state: 'reviewing', execution_state: 'interrupted' })]).chip.label, 'Agent stopped', 'the platform says nothing will wake the review any more')
  assert.deepEqual(row(pull(), [run({ state: 'reviewing' }, { state: 'reviewing', execution_state: 'completed' })]), { frame: 'reviewing', chip: null }, 'its own turn ended but its reviewer helper is still working')
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

// ---- a Respond-to-feedback result saved for the PR: the machine reads it as the draft, sending and unconfirmed facts it already has
const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const saved = (state = 'ready', patch = {}, approved = false) => ({ slug: 'team__repo__7', result: normalizeResult({ ...example(), repo: 'team/repo', state, ...patch }),
  decision: approved ? normalizeDecision({ version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: '2026-11-06T09:30:00Z' }) : null })
const changesRequested = { latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'sam', __typename: 'User' }, commit: { oid: HEAD } }] }, reviewDecision: 'CHANGES_REQUESTED', reviewThreads: { nodes: [] } }
const mineWithFeedback = (extra = {}) => pull({ author: { login: 'me' }, ...changesRequested, ...extra })
const standing = (responses, extra = {}) => standingFor({ pr: mineWithFeedback(extra), login: 'me', responses })

test('feedback with no saved answer reads "Feedback to answer", and its button says Respond to feedback', () => {
  const decision = standing([])
  assert.equal(decision.state, 'author.feedback')
  assert.equal(decision.actions.find(action => action.id === 'respond').title, 'Respond to feedback')
})

test('a saved answer that is ready reads as a draft to send, with the amber frame and its chip', () => {
  const decision = standing([saved()])
  assert.equal(decision.state, 'to_confirm')
  assert.deepEqual({ frame: frameOf(decision), chip: chipOf(decision) }, { frame: 'verdict', chip: { label: 'Draft to send', tone: 'owner' } })
})

test('posting reads as sending, and an answer that stopped part-way reads as not confirmed', () => {
  assert.equal(standing([saved('posting', {}, true)]).state, 'sending')
  assert.equal(standing([saved('ready', {}, true)]).state, 'sending', 'approved, the chat has not started yet')
  assert.equal(standing([saved('failed', { error: { step: 'replies', message: 'x' } }, true)], { headRefOid: '2'.repeat(40) }).state, 'unconfirmed')
})

test('a stale, discarded, posted or other PR’s answer says nothing, so the PR reads as before', () => {
  const moved = { headRefOid: 'c'.repeat(40) }
  assert.equal(standing([saved()], moved).state, standing([], moved).state, 'the PR moved after the answer: it reads as it would without one')
  assert.equal(standing([{ ...saved(), decision: normalizeDecision({ version: 1, result_id: example().id, digest: example().digest, decision: 'discarded', at: '2026-11-06T09:30:00Z' }) }]).state, 'author.feedback')
  assert.equal(standing([saved('posted')]).state, 'author.feedback')
  assert.equal(standing([{ slug: 'x', result: normalizeResult({ ...example(), repo: 'team/other' }) }]).state, 'author.feedback')
})

test('a review run’s own draft outranks a saved answer', () => {
  const verdict = run({ state: 'verdict_pending', verdict_proposal: { state: 'proposed', event: 'COMMENT', head_sha: HEAD } })
  const decision = standingFor({ pr: mineWithFeedback(), login: 'me', runs: [verdict], responses: [saved()] })
  assert.equal(decision.state, 'to_confirm')
  assert.equal(decision.actions.find(action => action.id === 'send_draft').enabled, true)
})

test('while an answer waits, starting again is called Respond again; while it posts, it is off', () => {
  const again = standing([saved()]).actions.find(action => action.id === 'respond')
  assert.equal(again.title, NAMES.respondAgain)
  assert.match(again.detail, /Replaces the waiting answer\./)
  assert.equal(again.enabled, true)
  const stale = standing([saved()], { headRefOid: 'c'.repeat(40) }).actions.find(action => action.id === 'respond')
  assert.equal(stale.title, NAMES.respondAgain, 'the old answer is still on the PR page, so this is a second pass')
  const posting = standing([saved('posting', {}, true)]).actions.find(action => action.id === 'respond')
  assert.equal(posting.enabled, false, 'the PR logic already keeps a second job off while something is being sent')
  assert.equal(standing([saved('posted')]).actions.find(action => action.id === 'respond').title, 'Respond to feedback', 'a finished answer is history')
})

test('the PR logic itself is not changed: the same facts without responses give the same decision as before', () => {
  assert.deepEqual(standingFor({ pr: mineWithFeedback(), login: 'me' }), standingFor({ pr: mineWithFeedback(), login: 'me', responses: [] }))
})
