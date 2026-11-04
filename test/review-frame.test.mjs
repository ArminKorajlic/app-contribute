import assert from 'node:assert/strict'
import test from 'node:test'
import { COMET_LAYERS, COMET_SPEED, cometLayers, cometSeconds, frameState, roundedRectPerimeter, rowReview } from '../review-frame.js'

const status = (state, run = {}) => ({ run: { state: 'running', execution_state: 'running', ...run }, item: { state } })

test('a rounded outline is its four sides plus four quarter circles', () => {
  assert.equal(roundedRectPerimeter(100, 50, 0), 300)
  assert.ok(Math.abs(roundedRectPerimeter(100, 50, 10) - (300 - 80 + 20 * Math.PI)) < 1e-9)
  // A radius larger than the box can hold is clamped, never negative.
  assert.ok(roundedRectPerimeter(20, 20, 50) > 0)
})

test('one comet fades linearly from a bright head to a clear tail', () => {
  const layers = cometLayers(2400)
  assert.equal(layers.length, COMET_LAYERS)
  const combined = depth => 1 - layers.filter(layer => layer.length >= depth).reduce((clear, layer) => clear * (1 - layer.opacity), 1)
  const tail = layers[0].length
  // Where m of N layers overlap the opacity is exactly m / N.
  assert.ok(Math.abs(combined(0.0001) - 1) < 1e-9)
  assert.ok(Math.abs(combined(tail * 0.5 + 0.001) - 0.5) < 1 / COMET_LAYERS)
  assert.ok(combined(tail - 0.001) <= 1 / COMET_LAYERS + 1e-9)
  // Every layer repeats once around the card: one comet, one lap.
  layers.forEach(layer => assert.ok(Math.abs(layer.length + layer.gap - 2400) < 1e-9))
})

test('the comet keeps a slow steady pace whatever the card size', () => {
  assert.equal(COMET_SPEED, 160)
  assert.ok(Math.abs(cometSeconds(2400) - 15) < 1e-9)
  assert.ok(Math.abs(cometSeconds(800) - 5) < 1e-9)
  assert.ok(cometLayers(300)[0].length >= 40) // a small card still gets a visible tail
})

test('the frame travels while an agent works and holds amber while the review waits on the owner', () => {
  assert.equal(frameState(null), 'idle')
  assert.equal(frameState(status('reviewing')), 'reviewing')
  assert.equal(frameState(status('repairing')), 'reviewing')
  assert.equal(frameState(status('verdict_pending')), 'verdict')
  assert.equal(frameState(status('needs_you')), 'verdict')
  // Finished work, failures and halted runs carry no frame; the chip says it.
  for (const done of ['all_clear', 'merged', 'queued', 'complete', 'failed']) assert.equal(frameState(status(done)), 'idle', done)
  assert.equal(frameState(status('reviewing', { execution_state: 'stopped' })), 'idle')
})

test('the desk polls only while a review is working, and finds a saved record\'s review by repository and number', async () => {
  const { hasActiveReview, reviewForRecord } = await import('../review-frame.js')
  const working = { id: 'a', state: 'running', execution_state: 'running', created_at: '2026-11-03T09:00:00Z', items: [{ repo: 'team/repo', number: 9, state: 'reviewing' }] }
  const done = { id: 'b', state: 'complete', execution_state: 'completed', created_at: '2026-11-03T08:00:00Z', items: [{ repo: 'team/repo', number: 9, state: 'all_clear' }] }
  const stopped = { id: 'c', state: 'running', execution_state: 'stopped', items: [{ repo: 'team/repo', number: 3, state: 'reviewing' }] }
  assert.equal(hasActiveReview([done]), false)
  assert.equal(hasActiveReview([done, working]), true)
  assert.equal(hasActiveReview([stopped]), false, 'a stopped run is not working')
  assert.equal(hasActiveReview([]), false)
  assert.equal(reviewForRecord([done, working], { repo: 'Team/Repo', number: 9 }).run.id, 'a')
  assert.equal(reviewForRecord([done, working], { plan: { repo: 'team/repo' }, number: 9 }).run.id, 'a')
  assert.equal(reviewForRecord([done, working], { repo: 'team/repo', number: 4 }), null)
  assert.equal(reviewForRecord([working], {}), null)
})

const pull = { number: 7, author: { login: 'someone-else' }, baseRefName: 'main' }
const requestedChanges = { run: { state: 'complete', execution_state: 'completed', chat_id: 'c' }, item: { state: 'needs_you', head_sha: 'a', verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES' } }, exactBase: true }

test('after you request changes the row goes quiet and names who holds the move', () => {
  assert.equal(frameState(requestedChanges), 'idle', 'no amber frame once your verdict is out')
  assert.deepEqual(rowReview({ status: requestedChanges, pr: pull, own: false }), { frame: 'idle', chip: { label: 'Waiting on someone-else', tone: 'waiting' } })
  assert.equal(rowReview({ status: requestedChanges, pr: { ...pull, author: null }, own: false }).chip.label, 'Waiting on the author')
})

test('findings, verdicts and questions that are yours keep the amber frame and say which', () => {
  const owner = (state, item = {}, run = {}) => rowReview({ status: { run: { state: 'running', execution_state: 'running', chat_id: 'c', ...run }, item: { state, ...item } }, pr: pull, own: false })
  assert.deepEqual(owner('verdict_pending', { verdict_proposal: { state: 'proposed', event: 'APPROVE' } }), { frame: 'verdict', chip: { label: 'Verdict waiting', tone: 'owner' } })
  assert.deepEqual(owner('needs_you'), { frame: 'verdict', chip: { label: 'Needs you', tone: 'owner' } })
  assert.equal(owner('merge_unknown').chip.label, 'Check outcome')
  assert.equal(owner('reviewing', {}, { execution_state: 'stopped' }).chip.label, 'Run stopped')
  assert.deepEqual(owner('reviewing'), { frame: 'reviewing', chip: null }, 'the travelling frame is the signal while it works')
  // Your own PR with the review comment posted: the fixing is yours.
  const ownPosted = { run: { state: 'complete', execution_state: 'completed', chat_id: 'c' }, item: { state: 'needs_you', public_review: { state: 'posted' } } }
  assert.deepEqual(rowReview({ status: ownPosted, pr: pull, own: true }), { frame: 'verdict', chip: { label: 'Needs you', tone: 'owner' } })
})

test('a PR pushed again after you requested changes is yours again, with no review of its current version', () => {
  const earlier = { run: requestedChanges.run, item: { ...requestedChanges.item, head_sha: 'old' } }
  assert.deepEqual(rowReview({ status: null, earlier, pr: pull, own: false }), { frame: 'verdict', chip: { label: 'New commits · review again', tone: 'owner' } })
  assert.deepEqual(rowReview({ status: null, earlier, pr: pull, own: true }), { frame: 'idle', chip: null }, 'you pushing your own PR is no request of you')
  const approved = { run: requestedChanges.run, item: { state: 'all_clear', head_sha: 'old', verdict_proposal: { state: 'posted', event: 'APPROVE' } } }
  assert.deepEqual(rowReview({ status: null, earlier: approved, pr: pull, own: false }), { frame: 'idle', chip: null })
  assert.deepEqual(rowReview({ status: null, earlier: null, pr: pull, own: false }), { frame: 'idle', chip: null })
})

test('an ignored finding leaves the row quiet and says so', () => {
  const status = { run: { state: 'complete', execution_state: 'completed', chat_id: 'c' }, item: { repo: 'team/repo', number: 7, head_sha: 'a', state: 'needs_you', summary: 'P1' }, exactBase: true }
  const ignored = { 'team/repo#7@a': { reason: 'Out of scope', at: '2026-11-04T10:00:00Z' } }
  assert.deepEqual(rowReview({ status, pr: pull, own: true }), { frame: 'verdict', chip: { label: 'Needs you', tone: 'owner' } })
  assert.deepEqual(rowReview({ status, pr: pull, own: true, ignored }), { frame: 'idle', chip: { label: 'Ignored', tone: 'waiting' } })
  assert.equal(frameState(status, { own: true, ignored }), 'idle')
})
