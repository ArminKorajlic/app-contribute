import assert from 'node:assert/strict'
import test from 'node:test'
import { DESK_VIEWS, deskCounts, railBadge } from '../desk.js'
import { classifyReview, loadReviewPulls, needsLiveRead, reviewCounts, reviewEntries, reviewKey } from '../review-list.js'

const run = (extra = {}) => ({ id: 'r', state: 'complete', execution_state: 'completed', chat_id: 'c', created_at: '2026-11-03T22:00:00Z', ...extra })
const item = (state, extra = {}) => ({ repo: 'mobius-os/mobius', number: 2019, head_sha: 'a'.repeat(40), title: 'Update bundled agent runtimes', state, ...extra })
const asked = { state: 'posted', event: 'REQUEST_CHANGES' }
const read = (review, options) => classifyReview({ run: review.run || run(), item: review.item || review }, options)
const labels = result => result.chips.map(chip => chip.label)
const open = (extra = {}) => ({ state: 'OPEN', head: 'a'.repeat(40), author: 'someone-else', ...extra })

test('each PR appears once, with its newest review, newest first', () => {
  const runs = [
    run({ id: 'old', created_at: '2026-11-01T10:00:00Z', items: [item('all_clear'), item('all_clear', { number: 7 })] }),
    run({ id: 'new', created_at: '2026-11-03T10:00:00Z', items: [item('needs_you')] }),
  ]
  const entries = reviewEntries(runs)
  assert.deepEqual(entries.map(entry => [entry.id, entry.run.id]), [['mobius-os/mobius#2019', 'new'], ['mobius-os/mobius#7', 'old']])
  assert.equal(reviewKey('Mobius-OS/Mobius', 5), 'mobius-os/mobius#5')
  assert.deepEqual(reviewEntries(null), [])
})

test('a request for changes is the author\'s move, until the PR is pushed again', () => {
  const requested = item('needs_you', { verdict_proposal: asked })
  const waiting = read(requested, { login: 'owner-login', live: open() })
  assert.equal(waiting.bucket, 'done')
  assert.deepEqual(labels(waiting), ['Changes requested', 'Waiting on someone-else'])
  const pushed = read(requested, { login: 'owner-login', live: open({ head: 'b'.repeat(40) }) })
  assert.deepEqual([pushed.bucket, labels(pushed)], ['waiting', ['New commits · review again']])
})

test('what waits on you stays in progress: a verdict, a finding on your own PR, a question', () => {
  assert.deepEqual([read(item('verdict_pending')).bucket, labels(read(item('verdict_pending')))], ['waiting', ['Verdict waiting']])
  const posted = item('needs_you', { public_review: { state: 'posted' } })
  assert.deepEqual(labels(read(posted, { login: 'owner', live: open({ author: 'Owner' }) })), ['Needs you'], 'your own PR: the fixing is yours')
  assert.equal(read(posted, { login: 'owner', live: open({ author: 'Someone-else' }) }).bucket, 'done', 'someone else\'s PR: your posted review is out')
  const question = read({ run: run({ state: 'running', execution_state: 'awaiting_owner' }), item: item('needs_you') })
  assert.equal(question.bucket, 'waiting')
})

test('an agent at work is running; a review stuck on "reviewing" after its conversation ended is not', () => {
  const working = read({ run: run({ state: 'running', execution_state: 'running' }), item: item('reviewing') })
  assert.deepEqual([working.bucket, labels(working)], ['running', ['Reviewing']])
  const stuck = read({ run: run({ state: 'reviewing', execution_state: 'completed' }), item: item('reviewing') })
  assert.deepEqual([stuck.bucket, labels(stuck)], ['stalled', ['Not finished']])
  const stopped = read({ run: run({ state: 'running', execution_state: 'stopped' }), item: item('reviewing') })
  assert.deepEqual([stopped.bucket, labels(stopped)], ['done', ['Stopped']])
})

test('a PR that is no longer open is history, whatever its review said', () => {
  assert.deepEqual(labels(read(item('needs_you'), { live: open({ state: 'MERGED' }) })), ['Merged'])
  assert.deepEqual(labels(read(item('verdict_pending'), { live: open({ state: 'CLOSED' }) })), ['Closed'])
  assert.equal(read(item('verdict_pending'), { live: open({ state: 'CLOSED' }) }).bucket, 'done')
})

test('finished reviews read as what they ended in', () => {
  assert.deepEqual(labels(read(item('all_clear', { verdict_proposal: { state: 'posted', event: 'APPROVE' } }))), ['Approved'])
  assert.deepEqual(labels(read(item('all_clear'))), ['Review clear'])
  assert.deepEqual(labels(read(item('merged'))), ['Merged'])
  assert.deepEqual(labels(read(item('needs_you', { verdict_proposal: { state: 'discarded', event: 'APPROVE' } }))), ['Verdict discarded'])
  const ignored = { [`mobius-os/mobius#2019@${'a'.repeat(40)}`]: { reason: 'Not a problem' } }
  assert.deepEqual([read(item('needs_you'), { ignored }).bucket, labels(read(item('needs_you'), { ignored }))], ['done', ['Ignored']])
  assert.deepEqual(labels(read(item('needs_you', { head_sha: 'c'.repeat(40) }), { live: open() })), ['Older version'], 'findings on a version the PR left behind are old news')
})

test('only a merged review is settled without a look at its PR; counts follow the buckets', () => {
  assert.equal(needsLiveRead({ item: item('all_clear') }), true, 'a clear review is of one version, and the PR may have been pushed since')
  assert.equal(needsLiveRead({ item: item('merged') }), false)
  assert.equal(needsLiveRead({ item: item('needs_you') }), true)
  assert.deepEqual(reviewCounts([{ bucket: 'waiting' }, { bucket: 'waiting' }, { bucket: 'running' }, { bucket: 'done' }, { bucket: 'checking' }]), { waiting: 2, confirm: 0, running: 1, stalled: 0, done: 1 })
})

test('a clear or approved review is of the version it read: a push puts the PR back to review, history stays history', () => {
  const pushed = open({ head: 'b'.repeat(40) })
  for (const clear of [item('all_clear'), item('all_clear', { verdict_proposal: { state: 'posted', event: 'APPROVE' } })]) {
    assert.deepEqual([read(clear, { live: open() }).bucket, labels(read(clear, { live: open() }))], ['done', [clear.verdict_proposal ? 'Approved' : 'Review clear']], 'the version it read is still the PR\'s')
    assert.deepEqual([read(clear, { login: 'owner', live: pushed }).bucket, labels(read(clear, { login: 'owner', live: pushed }))], ['waiting', ['New commits · review again']])
    assert.deepEqual(labels(read(clear)), [clear.verdict_proposal ? 'Approved' : 'Review clear'], 'before the PR is read only the saved review speaks')
    assert.deepEqual(labels(read(clear, { live: { ...pushed, state: 'MERGED' } })), ['Merged'], 'a merged PR is history however it moved')
    assert.deepEqual(labels(read(clear, { live: { ...pushed, state: 'CLOSED' } })), ['Closed'])
  }
  assert.deepEqual(labels(read(item('all_clear'), { login: 'someone-else', live: open({ head: 'b'.repeat(40), author: 'Someone-Else' }) })), ['Older version'], 'your own PR: a clear check of an older version is not a reason to be asked again')
  assert.equal(read(item('all_clear'), { login: 'someone-else', live: open({ head: 'b'.repeat(40), author: 'Someone-Else' }) }).bucket, 'done')
})

test('the live read is one query for valid PRs only, and answers by PR', async () => {
  const sent = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => { sent.push(JSON.parse(options.body).query); return { ok: true, json: async () => ({ data: { p0: { pullRequest: { state: 'OPEN', headRefOid: 'a1', author: { login: 'someone-else' } } }, p1: { pullRequest: null } } }) } }
  try {
    const live = await loadReviewPulls('token', [{ repo: 'mobius-os/mobius', number: 2019 }, { repo: 'o/gone', number: 4 }, { repo: 'not a repo', number: 1 }, { repo: 'o/r', number: -3 }])
    assert.equal(sent.length, 1, 'one request for the whole set')
    assert.match(sent[0], /p0:repository\(owner:"mobius-os",name:"mobius"\)/)
    assert.doesNotMatch(sent[0], /not a repo|number:-3/)
    assert.deepEqual([...live], [['mobius-os/mobius#2019', { state: 'OPEN', head: 'a1', author: 'someone-else' }]])
    assert.equal((await loadReviewPulls('token', [])).size, 0)
    globalThis.fetch = async () => ({ ok: false })
    await assert.rejects(() => loadReviewPulls('token', [{ repo: 'o/r', number: 1 }]), /Could not read/)
  } finally { globalThis.fetch = previous }
})

test('a long review history is read in bounded batches and combined, never cut off after the first 40', async () => {
  const queries = []
  const previous = globalThis.fetch
  // Every alias in a query is answered with its own PR: number n is OPEN at head h<n>.
  const answer = query => Object.fromEntries([...query.matchAll(/(p\d+):repository\(owner:"o",name:"r"\) \{ pullRequest\(number:(\d+)\)/g)]
    .map(([, alias, number]) => [alias, { pullRequest: { state: 'OPEN', headRefOid: `h${number}`, author: { login: 'someone-else' } } }]))
  globalThis.fetch = async (url, options) => { const { query } = JSON.parse(options.body); queries.push(query); return { ok: true, json: async () => ({ data: answer(query) }) } }
  try {
    const refs = Array.from({ length: 85 }, (_, index) => ({ repo: 'o/r', number: index + 1 }))
    const live = await loadReviewPulls('token', refs)
    assert.deepEqual(queries.map(query => (query.match(/p\d+:repository/g) || []).length), [40, 40, 5], 'bounded batches, no PR dropped')
    assert.equal(live.size, 85, 'every valid reference has its live state')
    assert.deepEqual(live.get('o/r#85'), { state: 'OPEN', head: 'h85', author: 'someone-else' }, 'including the ones past the first 40')
    // One batch GitHub cannot answer fails the whole read: a half-read history is never taken for a complete one.
    let calls = 0
    globalThis.fetch = async (url, options) => { calls += 1; return calls === 2 ? { ok: false } : { ok: true, json: async () => ({ data: answer(JSON.parse(options.body).query) }) } }
    await assert.rejects(() => loadReviewPulls('token', refs), /Could not read/)
  } finally { globalThis.fetch = previous }
})

test('PR reviews is a view of its own: its badge counts what waits on you, a spinner marks agents at work', () => {
  assert.ok(DESK_VIEWS.some(view => view.key === 'reviews' && view.label === 'PR reviews'))
  assert.equal(railBadge('reviews', { reviewsWaiting: 2 }), 2)
  assert.equal(railBadge('reviews', {}), 0)
  const counts = deskCounts({ reviews: { waiting: 1, running: 3, stalled: 0, done: 9 } })
  assert.deepEqual([counts.reviewsWaiting, counts.reviewsRunning], [1, 3])
  assert.deepEqual([deskCounts().reviewsWaiting, deskCounts().reviewsRunning], [0, 0])
})

import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
const screens = () => (renderer ||= renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { DeskRail } from './ui/Desk.jsx'
  import { DeskView } from './ui/DeskViews.jsx'
  export const rail = props => renderToStaticMarkup(React.createElement(DeskRail, props))
  export const view = props => renderToStaticMarkup(React.createElement(DeskView, props))
`))

const projects = [
  { key: 'mobius', name: 'Möbius', kind: 'platform', canonical_repo: 'mobius-os/mobius', reviewRequests: [] },
  { key: 'you', name: 'mobius.you', kind: 'platform', canonical_repo: 'mobius-os/mobius.you', reviewRequests: [] },
]
const row = (number, repo, bucket, chips, extra = {}) => ({ id: reviewKey(repo, number), at: 1, bucket, chips, run: { created_at: '2026-11-03T22:00:00Z' }, item: { repo, number, title: `Review of ${number}`, ...extra } })
const reviews = (entries, checking = false) => ({ entries, checking, counts: reviewCounts(entries) })
const base = { view: 'reviews', projects, records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', runs: [], onOpenProject() {}, onOpenPull() {} }

test('PR reviews groups what is still going by project, with what waits on you first, and keeps Done on its own tab', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { view } = await screens()
  const entries = [
    row(2021, 'mobius-os/mobius', 'running', [{ label: 'Reviewing', tone: 'running' }]),
    row(2005, 'mobius-os/mobius', 'waiting', [{ label: 'Needs you', tone: 'owner' }]),
    row(239, 'mobius-os/mobius.you', 'done', [{ label: 'Approved', tone: 'good' }]),
  ]
  const html = view({ ...base, reviews: reviews(entries) })
  assert.match(html, /aria-pressed="true">In progress<span class="co-pr-filter-count">2<\/span>/)
  assert.match(html, /aria-pressed="false">Done<span class="co-pr-filter-count">1<\/span>/)
  assert.ok(html.indexOf('Review of 2005') < html.indexOf('Review of 2021'), 'waiting on you leads, then agents at work')
  assert.match(html, /co-desk-chip is-waiting">Needs you/)
  assert.match(html, /co-desk-chip is-you">Reviewing/)
  assert.doesNotMatch(html, /Review of 239/, 'finished reviews are on the Done tab')
  assert.match(html, /aria-label="Möbius"/)
  assert.doesNotMatch(html, /aria-label="mobius\.you"/, 'a project with nothing in progress has no card')
})

test('with nothing in progress the page opens on Done, and a repository the desk does not know still gets its card', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { view } = await screens()
  const html = view({ ...base, reviews: reviews([row(239, 'mobius-os/mobius.you', 'done', [{ label: 'Approved', tone: 'good' }]), row(5, 'someone/else', 'done', [{ label: 'Review clear', tone: 'good' }])]) })
  assert.match(html, /aria-pressed="true">Done<span class="co-pr-filter-count">2<\/span>/)
  assert.match(html, /aria-label="mobius\.you"/)
  assert.match(html, /aria-label="someone\/else"/)
  assert.match(html, /co-desk-chip is-ready">Approved/)
  assert.match(view({ ...base, reviews: reviews([]) }), /No finished reviews yet/)
  assert.match(view({ ...base, query: 'zzz', reviews: reviews([row(239, 'mobius-os/mobius.you', 'done', [])]) }), /Nothing matches your search/)
  assert.match(view({ ...base, reviews: reviews([row(1, 'o/r', 'checking', [])], true) }), /Checking which of these pull requests are still open/)
})

test('a long history folds behind Show earlier, and the rail names the view with its waiting count and a spinner while agents work', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { view, rail } = await screens()
  const many = Array.from({ length: 11 }, (_, index) => row(100 + index, 'mobius-os/mobius', 'done', [{ label: 'Approved', tone: 'good' }]))
  const html = view({ ...base, reviews: reviews(many) })
  assert.match(html, /Show 3 earlier/)
  assert.equal((html.match(/co-desk-row"/g) || []).length, 8)
  const sidebar = rail({ view: 'reviews', counts: { reviewsWaiting: 2, reviewsRunning: 1 }, projects: [], attention: {}, selectedKey: '', onView() {}, onOpenProject() {} })
  assert.match(sidebar, /PR reviews/)
  assert.match(sidebar, /co-arc[^>]*aria-label="1 review running"/)
  assert.match(sidebar, /co-rail-count is-you">2</)
  const idle = rail({ view: 'needs', counts: {}, projects: [], attention: {}, selectedKey: '', onView() {}, onOpenProject() {} })
  assert.doesNotMatch(idle, /co-arc|aria-label="\d+ reviews? running"/)
})

test('a Needs you row offers the fix when your own review of your own PR found problems at its current version', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { view } = await screens()
  const head = 'a'.repeat(40)
  const pr = { number: 2005, title: 'Follow a lost update', headRefOid: head, baseRefName: 'main', author: { login: 'owner' }, repository: { nameWithOwner: 'mobius-os/mobius' }, comments: { totalCount: 1 }, isDraft: false, labels: { nodes: [] } }
  const project = { ...projects[0], incomingReviews: [pr] }
  const feedback = { id: 'f', kind: 'public_attention', label: 'Feedback on 2005', record: { repo: 'mobius-os/mobius', number: 2005 } }
  const found = { id: 'r', created_at: '2026-11-04T07:00:00Z', state: 'needs_you', execution_state: 'completed', items: [{ repo: 'mobius-os/mobius', number: 2005, base_ref: 'main', head_sha: head, state: 'needs_you', summary: 'Three problems.' }] }
  const base = { view: 'needs', projects: [project], records: [], login: 'owner', decisionsFor: () => [feedback], lastLooked: '', query: '', runs: [found], onOpenProject() {}, onOpenPull() {}, onOpenRecord() {} }
  const html = view(base)
  assert.match(html, /co-desk-row-split/)
  assert.match(html, /co-btn co-btn-primary co-desk-row-action">Fix these findings</)
  // Not on a version the review did not see, not when set aside, not when it found nothing, not on a PR that is not yours.
  assert.doesNotMatch(view({ ...base, projects: [{ ...project, incomingReviews: [{ ...pr, headRefOid: 'b'.repeat(40) }] }] }), /Fix these findings/)
  assert.doesNotMatch(view({ ...base, ignored: { [`mobius-os/mobius#2005@${head}`]: { reason: 'Not a problem' } } }), /Fix these findings/)
  assert.doesNotMatch(view({ ...base, runs: [{ ...found, items: [{ ...found.items[0], state: 'all_clear' }] }] }), /Fix these findings/)
  assert.doesNotMatch(view({ ...base, login: 'someone-else' }), /Fix these findings/)
  assert.doesNotMatch(view({ ...base, runs: [] }), /Fix these findings|co-desk-row-split/)
})
