import assert from 'node:assert/strict'
import test from 'node:test'
import { DESK_VIEWS, deskCounts, railBadge } from '../desk.js'
import { classifyReview, loadReviewPulls, needsLiveRead, reviewCounts, reviewEntries, reviewKey } from '../review-list.js'

const run = (extra = {}) => ({ id: 'r', state: 'complete', execution_state: 'completed', chat_id: 'c', created_at: '2026-11-03T22:00:00Z', ...extra })
const item = (state, extra = {}) => ({ repo: 'mobius-os/mobius', number: 2019, head_sha: 'a'.repeat(40), title: 'Update bundled agent runtimes', state, ...extra })
const asked = { state: 'posted', event: 'REQUEST_CHANGES' }
const read = (review, options) => classifyReview({ run: review.run || run(), item: review.item || review }, options)
const labels = result => result.chips.map(chip => chip.label)
const open = (extra = {}) => ({ state: 'OPEN', head: 'a'.repeat(40), author: 'IrfanCodecta', ...extra })

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
  const waiting = read(requested, { login: 'ArminKorajlic', live: open() })
  assert.equal(waiting.bucket, 'done')
  assert.deepEqual(labels(waiting), ['Changes requested', 'Waiting on IrfanCodecta'])
  const pushed = read(requested, { login: 'ArminKorajlic', live: open({ head: 'b'.repeat(40) }) })
  assert.deepEqual([pushed.bucket, labels(pushed)], ['waiting', ['New commits · review again']])
})

test('what waits on you stays in progress: a verdict, a finding on your own PR, a question', () => {
  assert.deepEqual([read(item('verdict_pending')).bucket, labels(read(item('verdict_pending')))], ['waiting', ['Verdict waiting']])
  const posted = item('needs_you', { public_review: { state: 'posted' } })
  assert.deepEqual(labels(read(posted, { login: 'armin', live: open({ author: 'Armin' }) })), ['Needs you'], 'your own PR: the fixing is yours')
  assert.equal(read(posted, { login: 'armin', live: open({ author: 'Irfan' }) }).bucket, 'done', 'someone else\'s PR: your posted review is out')
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

test('only reviews that could still wait on someone need the PR read live; counts follow the buckets', () => {
  assert.equal(needsLiveRead({ item: item('all_clear') }), false)
  assert.equal(needsLiveRead({ item: item('merged') }), false)
  assert.equal(needsLiveRead({ item: item('needs_you') }), true)
  assert.deepEqual(reviewCounts([{ bucket: 'waiting' }, { bucket: 'waiting' }, { bucket: 'running' }, { bucket: 'done' }, { bucket: 'checking' }]), { waiting: 2, running: 1, stalled: 0, done: 1 })
})

test('the live read is one query for valid PRs only, and answers by PR', async () => {
  const sent = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => { sent.push(JSON.parse(options.body).query); return { ok: true, json: async () => ({ data: { p0: { pullRequest: { state: 'OPEN', headRefOid: 'a1', author: { login: 'IrfanCodecta' } } }, p1: { pullRequest: null } } }) } }
  try {
    const live = await loadReviewPulls('token', [{ repo: 'mobius-os/mobius', number: 2019 }, { repo: 'o/gone', number: 4 }, { repo: 'not a repo', number: 1 }, { repo: 'o/r', number: -3 }])
    assert.equal(sent.length, 1, 'one request for the whole set')
    assert.match(sent[0], /p0:repository\(owner:"mobius-os",name:"mobius"\)/)
    assert.doesNotMatch(sent[0], /not a repo|number:-3/)
    assert.deepEqual([...live], [['mobius-os/mobius#2019', { state: 'OPEN', head: 'a1', author: 'IrfanCodecta' }]])
    assert.equal((await loadReviewPulls('token', [])).size, 0)
    globalThis.fetch = async () => ({ ok: false })
    await assert.rejects(() => loadReviewPulls('token', [{ repo: 'o/r', number: 1 }]), /Could not read/)
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
const base = { view: 'reviews', projects, records: [], login: 'armin', decisionsFor: () => [], lastLooked: '', query: '', runs: [], onOpenProject() {}, onOpenPull() {} }

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
