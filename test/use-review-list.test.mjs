import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { classifyReview, reviewCounts, reviewEntries } from '../review-list.js'

// Runs the real hook with minimal hook stand-ins (as focus-lease.test.mjs does): state and memo slots
// persist, a state change re-renders, and each effect runs after a render when its dependencies
// changed, after the previous run's cleanup. `loadReviewPulls` is the only fake: every call waits
// until the test answers it, so the order of the answers is the test's to choose.
const source = readFileSync(new URL('../ui/useReviewList.js', import.meta.url), 'utf8')
function harness() {
  const slots = [], effects = [], reads = []
  let cursor = 0, props = {}, view = null, rendering = false, queued = []
  const memo = (compute, deps) => {
    const slot = slots[cursor] ||= { deps: null, value: undefined }
    cursor += 1
    if (!slot.deps || deps.some((value, n) => !Object.is(value, slot.deps[n]))) { slot.deps = deps; slot.value = compute() }
    return slot.value
  }
  const context = vm.createContext({
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useState(initial) {
      const slot = slots[cursor] ||= { value: initial }
      cursor += 1
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; if (!rendering) render() }]
    },
    useEffect(run, deps) { queued.push({ index: cursor++, run, deps }) },
    classifyReview, reviewCounts, reviewEntries,
    loadReviewPulls(token, refs) { return new Promise((resolve, reject) => reads.push({ refs, resolve, reject })) },
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export function /g, 'function '), context)
  function render(next) {
    if (next) props = { ...props, ...next }
    rendering = true; cursor = 0; queued = []
    view = context.useReviewList(props)
    rendering = false
    for (const effect of queued) {
      const before = effects[effect.index]
      if (before && !effect.deps.some((value, n) => !Object.is(value, before.deps[n]))) continue
      before?.cleanup?.()
      effects[effect.index] = { deps: effect.deps, cleanup: effect.run() }
    }
    return view
  }
  const rows = () => view.entries.map(entry => `${entry.bucket}:${entry.chips.map(chip => chip.label).join('+')}`)
  const flush = () => new Promise(resolve => setImmediate(resolve))
  return { render, reads, rows, flush, counts: () => JSON.parse(JSON.stringify(view.counts)), retry: () => view.retry() }
}

const head = letter => letter.repeat(40)
const requested = { state: 'posted', event: 'REQUEST_CHANGES' }
const approved = { state: 'posted', event: 'APPROVE' }
const runsOf = (...items) => [{ id: 'r1', state: 'complete', execution_state: 'completed', chat_id: 'c', created_at: '2026-11-03T22:00:00Z', items }]
const review = (state, extra = {}) => ({ repo: 'o/r', number: 7, head_sha: head('a'), title: 'A PR', state, ...extra })
// The PR as GitHub returns it now (PR_FIELDS), keyed the way loadReviewPulls keys it.
const pull = (extra = {}) => ({ number: 7, state: 'OPEN', headRefOid: head('a'), baseRefName: 'main', mergeable: 'MERGEABLE', author: { login: 'someone-else' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null,
  reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...extra })
const live = extra => new Map([['o/r#7', pull(extra)]])
const pushed = (state, commit) => ({ headRefOid: head('b'), viewerLatestReview: { state, commit: { oid: commit } } })
const base = { token: 't', ignored: null, login: 'owner', refreshKey: 0 }

test('Sync with GitHub reads the same PRs again: an author push after "request changes" brings the row back', async () => {
  const h = harness()
  const saved = runsOf(review('needs_you', { verdict_proposal: requested }))
  h.render({ ...base, runs: saved })
  assert.deepEqual(h.rows(), ['checking:'], 'until the first read answers nothing is judged')
  h.reads[0].resolve(live()); await h.flush()
  assert.deepEqual(h.rows(), ['done:Waiting on someone-else'])
  // The poll while a review runs replaces the runs with an identical copy; that is not a Sync.
  h.render({ runs: JSON.parse(JSON.stringify(saved)) })
  assert.equal(h.reads.length, 1, 'the same set of PRs is not read again on every poll')
  // Sync: fresh runs, then the refresh key moves. The author pushed meanwhile.
  h.render({ runs: JSON.parse(JSON.stringify(saved)), refreshKey: 1 })
  assert.equal(h.reads.length, 2, 'a Sync reads the live PRs again')
  assert.deepEqual(h.rows(), ['done:Waiting on someone-else'], 'the old answer stands while the new read is out: no flash of "checking"')
  h.reads[1].resolve(live(pushed('CHANGES_REQUESTED', head('a')))); await h.flush()
  assert.deepEqual(h.rows(), ['waiting:New commits · review again'])
  assert.equal(h.counts().waiting, 1)
})

test('a PR closed since the last read leaves To confirm once a Sync sees it', async () => {
  const h = harness()
  const saved = runsOf(review('verdict_pending', { verdict_proposal: { state: 'proposed', event: 'APPROVE' } }))
  h.render({ ...base, runs: saved })
  h.reads[0].resolve(live()); await h.flush()
  assert.equal(h.counts().confirm, 1, 'drafted for you while the PR is open')
  h.render({ refreshKey: 1 })
  h.reads[1].resolve(live({ state: 'CLOSED' })); await h.flush()
  assert.deepEqual([h.rows(), h.counts().confirm], [['done:Closed'], 0])
})

test('only the newest read counts, whatever order the answers arrive in', async () => {
  const h = harness()
  const saved = runsOf(review('needs_you', { verdict_proposal: requested }))
  h.render({ ...base, runs: saved })
  h.reads[0].resolve(live()); await h.flush()
  h.render({ refreshKey: 1 })
  h.render({ refreshKey: 2 })
  assert.equal(h.reads.length, 3)
  h.reads[2].resolve(live(pushed('CHANGES_REQUESTED', head('a')))); await h.flush()
  assert.deepEqual(h.rows(), ['waiting:New commits · review again'])
  h.reads[1].resolve(live({ state: 'CLOSED' })); await h.flush()
  assert.deepEqual(h.rows(), ['waiting:New commits · review again'], 'a slower, older answer is dropped')
})

test('a Sync that cannot read GitHub keeps what the last read said, and does not leave the page checking', async () => {
  const h = harness()
  h.render({ ...base, runs: runsOf(review('needs_you', { verdict_proposal: requested })) })
  h.reads[0].resolve(live()); await h.flush()
  h.render({ refreshKey: 1 })
  h.reads[1].reject(new Error('offline')); await h.flush()
  assert.deepEqual(h.rows(), ['done:Waiting on someone-else'])
  const first = harness()
  first.render({ ...base, runs: runsOf(review('needs_you', { verdict_proposal: requested })) })
  first.reads[0].reject(new Error('offline')); await first.flush()
  assert.deepEqual(first.rows(), ['unknown:Couldn’t read'], 'with nothing read yet, a PR is unknown, never judged from the saved review')
})

test('Try again reads the PRs again, and the answer replaces Couldn’t read', async () => {
  const h = harness()
  h.render({ ...base, runs: runsOf(review('needs_you', { verdict_proposal: requested })) })
  h.reads[0].resolve(new Map()); await h.flush()
  assert.deepEqual([h.rows(), h.counts().unknown], [['unknown:Couldn’t read'], 1], 'a PR GitHub did not return is unknown')
  h.retry()
  assert.equal(h.reads.length, 2)
  h.reads[1].resolve(live()); await h.flush()
  assert.deepEqual(h.rows(), ['done:Waiting on someone-else'])
})

test('an approved review is read live too, so a push after it puts the PR back to review', async () => {
  const h = harness()
  h.render({ ...base, runs: runsOf(review('all_clear', { verdict_proposal: approved })) })
  assert.equal(h.reads.length, 1, 'a clear or approved review is not settled without a look at its PR')
  assert.deepEqual(h.rows(), ['checking:'])
  h.reads[0].resolve(live(pushed('APPROVED', head('a')))); await h.flush()
  assert.deepEqual(h.rows(), ['waiting:New commits · review again'])
})
