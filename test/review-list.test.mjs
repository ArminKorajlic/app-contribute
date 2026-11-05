import assert from 'node:assert/strict'
import test from 'node:test'
import { DESK_VIEWS, deskCounts, railBadge } from '../desk.js'
import { classifyReview, loadReviewPulls, reviewCounts, reviewEntries, reviewKey } from '../review-list.js'

const HEAD = 'a'.repeat(40)
const run = (extra = {}) => ({ id: 'r', state: 'complete', execution_state: 'completed', chat_id: 'c', created_at: '2026-11-03T22:00:00Z', ...extra })
const item = (state, extra = {}) => ({ repo: 'mobius-os/mobius', number: 2019, head_sha: HEAD, base_ref: 'main', title: 'Update bundled agent runtimes', state, ...extra })
// The PR as GitHub returns it now (PR_FIELDS).
const live = (extra = {}) => ({ number: 2019, state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE', author: { login: 'someone-else' },
  repository: { nameWithOwner: 'mobius-os/mobius', viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null,
  reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...extra })
const read = (review, pr = live(), login = 'owner') => {
  const entry = { run: review.run || run({ items: [review.item || review] }), item: review.item || review }
  if (!entry.run.items) entry.run.items = [entry.item]
  return classifyReview(entry, { login, live: pr, runs: [entry.run] })
}
const labels = result => result.chips.map(chip => chip.label)

test('a live Respond conversation on a reviewed PR reads as an agent working on it', () => {
  const entry = { run: run({ items: [item('all_clear')] }), item: item('all_clear') }
  const chats = [{ repo: 'Mobius-OS/Mobius', number: 2019, state: 'running', chat_id: 'c2' }]
  assert.equal(classifyReview(entry, { login: 'owner', live: live(), runs: [entry.run], chats }).bucket, 'running')
  assert.notEqual(classifyReview(entry, { login: 'owner', live: live(), runs: [entry.run] }).bucket, 'running')
})

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

test("a request for changes is the author's move, until the PR is pushed again", () => {
  const requested = item('needs_you', { verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES', head_sha: HEAD } })
  const waiting = read(requested)
  assert.equal(waiting.bucket, 'done')
  assert.deepEqual(labels(waiting), ['Waiting on someone-else'])
  const pushed = read(requested, live({ headRefOid: 'b'.repeat(40), viewerLatestReview: { state: 'CHANGES_REQUESTED', commit: { oid: HEAD } } }))
  assert.deepEqual([pushed.bucket, labels(pushed)], ['waiting', ['New commits · review again']])
})

test('new commits after an approval bring it back too; a reply alone does not', () => {
  const approved = item('all_clear', { verdict_proposal: { state: 'posted', event: 'APPROVE', head_sha: HEAD } })
  assert.equal(read(approved, live({ headRefOid: 'b'.repeat(40), viewerLatestReview: { state: 'APPROVED', commit: { oid: HEAD } } })).bucket, 'waiting')
  const requested = item('needs_you', { verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES', head_sha: HEAD } })
  assert.equal(read(requested, live({ reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ author: { login: 'someone-else' } }] } }] } })).bucket, 'done')
})

test('what waits on you stays in progress: a draft to send, findings on your own PR, a question', () => {
  const drafted = read(item('verdict_pending', { verdict_proposal: { state: 'proposed', event: 'APPROVE', head_sha: HEAD } }))
  assert.deepEqual([drafted.bucket, drafted.confirm, labels(drafted)], ['waiting', true, ['Draft to send']])
  assert.deepEqual(labels(read(item('needs_you', { summary: 'P1' }), live({ author: { login: 'Owner' } }))), ['Findings'], 'your own PR: the fixing is yours')
  const question = read({ run: run({ state: 'running', execution_state: 'awaiting_owner' }), item: item('needs_you') })
  assert.equal(question.bucket, 'waiting')
})

test('an agent at work is running, even while its chat waits on its reviewer helper; one that was interrupted or failed has stalled; one you stopped is done', () => {
  const working = read({ run: run({ state: 'running', execution_state: 'running' }), item: item('reviewing') })
  assert.deepEqual([working.bucket, labels(working)], ['running', ['Agent working']])
  const waitingOnHelper = read({ run: run({ state: 'reviewing', execution_state: 'completed' }), item: item('reviewing') })
  assert.deepEqual([waitingOnHelper.bucket, labels(waitingOnHelper)], ['running', ['Agent working']])
  const stuck = read({ run: run({ state: 'reviewing', execution_state: 'interrupted' }), item: item('reviewing') })
  assert.deepEqual([stuck.bucket, labels(stuck)], ['stalled', ['Agent stopped']])
  assert.equal(read({ run: run({ state: 'running', execution_state: 'stopped' }), item: item('reviewing') }).bucket, 'done')
})

test('a PR that is no longer open is history, whatever its review said', () => {
  assert.deepEqual(labels(read(item('needs_you'), live({ state: 'MERGED' }))), ['Merged'])
  assert.deepEqual(labels(read(item('verdict_pending'), live({ state: 'CLOSED' }))), ['Closed'])
  assert.equal(read(item('verdict_pending'), live({ state: 'CLOSED' })).bucket, 'done')
})

test('a PR GitHub did not return is unknown, never classified from the saved review', () => {
  const entry = { run: run(), item: item('verdict_pending') }
  const unknown = classifyReview(entry, { login: 'owner', live: null, runs: [entry.run] })
  assert.deepEqual([unknown.bucket, unknown.confirm, labels(unknown)], ['unknown', false, ['Couldn’t read']])
  assert.deepEqual(reviewCounts([{ bucket: 'waiting' }, { bucket: 'waiting', confirm: true }, { bucket: 'running' }, { bucket: 'done' }, { bucket: 'unknown' }, { bucket: 'checking' }]),
    { waiting: 2, confirm: 1, running: 1, stalled: 0, unknown: 1, done: 1 })
})

test('every PR is read live in batches of 25, one batch after another, and only what GitHub returned is known', async () => {
  const sent = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const query = JSON.parse(options.body).query
    sent.push(query)
    const count = (query.match(/p\d+:repository/g) || []).length
    return { ok: true, json: async () => ({ data: Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, { pullRequest: index === 1 && sent.length === 1 ? null : live({ number: index }) }])) }) }
  }
  try {
    const refs = [...Array.from({ length: 30 }, (_, index) => ({ repo: 'o/r', number: index + 1 })), { repo: 'not a repo', number: 1 }, { repo: 'o/r', number: -3 }]
    const read = await loadReviewPulls('token', refs)
    assert.equal(sent.length, 2, 'two bounded batches for 30 PRs')
    assert.match(sent[0], /latestOpinionatedReviews/, 'the read carries what the PR machine needs')
    assert.doesNotMatch(sent.join(' '), /not a repo|number:-3/)
    assert.equal(read.size, 29, 'the PR GitHub did not return stays unknown')
    assert.equal(read.has('o/r#2'), false)
    assert.equal((await loadReviewPulls('token', [])).size, 0)
    globalThis.fetch = async () => ({ ok: false })
    assert.equal((await loadReviewPulls('token', [{ repo: 'o/r', number: 1 }])).size, 0, 'a failed read leaves every PR unknown')
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
