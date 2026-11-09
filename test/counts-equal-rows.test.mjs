import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'
import { attachSourceProjects } from '../source-map.js'
import { deskCounts, projectNeedsCount, needsCount, railBadge } from '../desk.js'

// A badge, a tab number and a label each equal the rows they open (finding M4).
let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { DeskView } from './ui/DeskViews.jsx'
    import { ProjectTabs } from './ui/ProjectTabs.jsx'
    export const view = props => renderToStaticMarkup(React.createElement(DeskView, props))
    export const tabs = props => renderToStaticMarkup(React.createElement(ProjectTabs, props))
  `)
  return renderer
}

const pull = (number, extra = {}) => ({ number, title: `Thing ${number}`, author: { login: 'maker' }, repository: { nameWithOwner: 'acme/widgets' }, labels: { nodes: [] }, comments: { totalCount: 0 }, headRefName: `h${number}`, baseRefName: 'main', updatedAt: '2026-11-02T08:00:00Z', isDraft: false, ...extra })
const entry = (number, repo, bucket) => ({ id: `${repo}#${number}`, bucket, at: number, run: { created_at: '2026-11-03T08:00:00Z' }, item: { repo, number, title: `Run ${number}` }, chips: [{ label: 'Needs you', tone: 'owner' }] })
const rowsIn = html => (html.match(/class="co-desk-row(?: is-[a-z_]+)*"/g) || []).length

// Review requests (1, 2), feedback card on #3, own PRs: #4 fails, #5 ready (a row each), #6 just waiting,
// and agent runs: on #1 (already a row), #7 waiting (a row), #8 stalled (a row), #9 running (not waiting).
function scene() {
  const incoming = [
    pull(1, { reviewRequested: true, author: { login: 'octocat' } }), pull(2, { reviewRequested: true, author: { login: 'octocat' } }),
    pull(3, { reviewDecision: 'CHANGES_REQUESTED' }), pull(4, { reviewDecision: 'CHANGES_REQUESTED' }), pull(5, { reviewDecision: 'APPROVED' }), pull(6),
  ]
  const feedback = { id: 'f3', kind: 'public_attention', label: 'Feedback on three', record: { repo: 'acme/widgets', number: 3 } }
  const entries = [entry(1, 'acme/widgets', 'waiting'), entry(7, 'acme/widgets', 'waiting'), entry(8, 'acme/widgets', 'stalled'), entry(9, 'acme/widgets', 'running')]
  const projects = attachSourceProjects({ apps: [{ key: 'widgets', name: 'Widgets', canonical_repo: 'acme/widgets', available: true }] }, [], incoming, [], [])
  return { incoming, feedback, entries, projects }
}

test('a repository\'s rail badge is exactly the rows its Needs you card shows, agent runs included', async t => {
  const api = await ui(t)
  if (!api) return
  const { incoming, feedback, entries, projects } = scene()
  const [project] = projects
  const badge = projectNeedsCount(project, [feedback], 'maker', entries)
  assert.equal(badge, 2 + 1 + 2 + 2, '2 requests, 1 feedback card, #4 and #5, runs #7 and #8')
  const html = api.view({ projects, records: [], login: 'maker', decisionsFor: () => [feedback], lastLooked: '', query: '', reviews: { entries }, counts: {}, view: 'needs', onOpenProject() {}, onOpenPull() {}, onOpenRecord() {} })
  assert.equal(rowsIn(html), badge)
  // The same rows the desk sums into its Needs you badge.
  const counts = deskCounts({ projects, decisions: [{ ...feedback }], incoming, records: [], login: 'maker', reviewEntries: entries })
  assert.equal(counts.agent, 2)
})

test('without agent runs the badge and the rows still agree', async t => {
  const api = await ui(t)
  if (!api) return
  const { feedback, projects } = scene()
  const html = api.view({ projects, records: [], login: 'maker', decisionsFor: () => [feedback], lastLooked: '', query: '', reviews: { entries: [] }, counts: {}, view: 'needs', onOpenProject() {}, onOpenPull() {}, onOpenRecord() {} })
  assert.equal(rowsIn(html), projectNeedsCount(projects[0], [feedback], 'maker', []))
})

test('a waiting run on a repository nothing else involves still gets a project, so its row has a card', async t => {
  const api = await ui(t)
  if (!api) return
  const entries = [entry(7, 'someone/else', 'waiting')]
  const none = attachSourceProjects({ apps: [] }, [], [], [], [])
  assert.deepEqual(none.map(project => project.canonical_repo), [])
  const projects = attachSourceProjects({ apps: [] }, [], [], [], [], ['someone/else'])
  assert.deepEqual(projects.map(project => project.canonical_repo), ['someone/else'])
  const badge = projectNeedsCount(projects[0], [], 'maker', entries)
  assert.equal(badge, 1)
  const html = api.view({ projects, records: [], login: 'maker', decisionsFor: () => [], lastLooked: '', query: '', reviews: { entries }, counts: {}, view: 'needs', onOpenProject() {}, onOpenPull() {}, onOpenRecord() {} })
  assert.equal(rowsIn(html), 1)
  assert.equal(needsCount(deskCounts({ projects, decisions: [], incoming: [], records: [], login: 'maker', reviewEntries: entries })), 1)
  assert.equal(railBadge('needs', deskCounts({ reviewEntries: entries })), 1)
})

test('the Local changes tab counts files, in words, not a bare number beside review counts', async t => {
  const api = await ui(t)
  if (!api) return
  const props = { reviewCount: 2, renderPullRequests: () => 'LIST', edits: 'FILES', editsCount: 53 }
  assert.match(api.tabs(props), /Local changes<span class="co-tab-count is-files">53 files<\/span>/)
  assert.match(api.tabs({ ...props, editsCount: 1 }), /<span class="co-tab-count is-files">1 file<\/span>/)
})

test('the Finished label counts every row the tab renders, saved agent work included', async t => {
  const api = await ui(t)
  if (!api) return
  const { feedback, entries, projects } = scene()
  const saved = [feedback, { id: 'f9', kind: 'private_review', label: 'Saved review', record: { repo: 'acme/widgets', number: 9 } }]
  const html = api.view({ projects, records: [], login: 'maker', decisionsFor: () => saved, lastLooked: '', query: '', reviews: { entries: entries.filter(item => item.bucket !== 'running'), counts: {} }, counts: {}, view: 'runs', onOpenProject() {}, onOpenPull() {}, onOpenRecord() {} })
  const label = Number(/aria-pressed="true">Finished<span class="co-pr-filter-count">(\d+)<\/span>/.exec(html)?.[1])
  assert.equal(label, 3 + 2, 'three finished runs and two saved-work rows')
  assert.equal(rowsIn(html), label)
  assert.equal((html.match(/aria-label="Widgets"/g) || []).length, 2, 'the runs card and the saved-work card are two sections')
  assert.match(html, /<section class="co-envelope" aria-label="Widgets"><header class="co-envelope-head">(?:(?!<\/header>).)*Prepared work/, 'the saved-work card says what it holds')
  const running = api.view({ projects, records: [], login: 'maker', decisionsFor: () => saved, lastLooked: '', query: '', reviews: { entries, counts: {} }, counts: {}, view: 'runs', onOpenProject() {}, onOpenPull() {}, onOpenRecord() {} })
  assert.match(running, /aria-pressed="true">Running<span class="co-pr-filter-count">1</)
  assert.match(running, /aria-pressed="false">Finished<span class="co-pr-filter-count">5</, 'the other tab already says what it holds')
})
