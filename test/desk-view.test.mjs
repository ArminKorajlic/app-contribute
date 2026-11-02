import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { DeskRail, DeskCounts, projectRailCount } from './ui/Desk.jsx'
    import { DeskView } from './ui/DeskViews.jsx'
    export { projectRailCount }
    export const rail = props => renderToStaticMarkup(React.createElement(DeskRail, props))
    export const counts = props => renderToStaticMarkup(React.createElement(DeskCounts, props))
    export const view = props => renderToStaticMarkup(React.createElement(DeskView, props))
  `)
  return renderer
}

const pullFixture = (number, extra = {}) => ({
  number,
  title: `Improve thing ${number}`,
  author: { login: 'teammate' },
  repository: { nameWithOwner: 'o/r' },
  labels: { nodes: [{ name: 'enhancement', color: 'a2eeef' }] },
  comments: { totalCount: 2 },
  headRefName: `head-${number}`,
  baseRefName: 'main',
  updatedAt: '2026-11-02T08:00:00Z',
  isDraft: false,
  additions: 10,
  deletions: 3,
  ...extra,
})

const projectFixture = (key, extra = {}) => ({
  key,
  name: key === 'mobius' ? 'Möbius' : key,
  kind: 'app',
  available: true,
  localFiles: 0,
  compatibleFiles: 0,
  conflictFiles: 0,
  workingFiles: 0,
  incomingReviews: [],
  reviewRequests: [],
  ...extra,
})

const countsFixture = { questions: 1, requests: 2, merge: 3, fix: 1, drafts: 0, editedFiles: 28, editProjects: 1, mine: 4, work: 5, merged: 0 }

test('the rail shows every view with its count and marks the open project', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { reviewRequests: [pullFixture(1)] })
  const html = api.rail({ view: 'needs', counts: countsFixture, projects: [project], attention: { mobius: 2 }, selectedKey: 'mobius', onView: () => {}, onOpenProject: () => {} })
  assert.match(html, /Needs you/)
  assert.match(html, /Merged this week/)
  assert.match(html, /Möbius/)
  // 2 saved-work decisions + 1 review request on the project row.
  assert.equal(api.projectRailCount(project, { mobius: 2 }), 3)
  assert.match(html, /aria-current="page"[^>]*>[\s\S]*?Möbius|Möbius[\s\S]*?aria-current/)
})

test('counts chips name next steps and skip empty edits', async t => {
  const api = await ui(t)
  if (!api) return
  const html = api.counts({ counts: countsFixture, onView: () => {} })
  assert.match(html, />Review</)
  assert.match(html, />Merge</)
  assert.match(html, /28 files/)
  const none = api.counts({ counts: { ...countsFixture, questions: 0, editedFiles: 0, requests: 0, merge: 0, fix: 0, drafts: 0 }, onView: () => {} })
  assert.equal(none, '')
})

test('a side view keeps each app inside one card with its own name and Open', async t => {
  const api = await ui(t)
  if (!api) return
  const asked = pullFixture(1915, { updatedAt: '2026-11-02T08:00:00Z' })
  const project = projectFixture('mobius', { reviewRequests: [asked], incomingReviews: [asked] })
  const html = api.view({
    view: 'requests', projects: [project, projectFixture('quietapp')], records: [], login: 'armin',
    decisionsFor: () => [], lastLooked: '2026-11-01T00:00:00Z', query: '',
    onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {},
  })
  assert.match(html, /co-envelope/)
  assert.match(html, /Möbius/)
  assert.match(html, /Improve thing 1915/)
  assert.match(html, /Asks for your review/)
  assert.match(html, /enhancement/)
  // Changed after the last visit, so the quiet dot is on.
  assert.match(html, /co-newdot/)
  // The quiet app has nothing to show, so it gets no card at all.
  assert.doesNotMatch(html, /quietapp/)
})

test('my PRs read as a stack in merge order when they chain', async t => {
  const api = await ui(t)
  if (!api) return
  const mine = [
    pullFixture(44, { author: { login: 'armin' }, baseRefName: 'head-43' }),
    pullFixture(43, { author: { login: 'armin' } }),
  ]
  const project = projectFixture('kanban', { incomingReviews: mine })
  const html = api.view({
    view: 'mine', projects: [project], records: [], login: 'armin',
    decisionsFor: () => [], lastLooked: '', query: '',
    onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {},
  })
  assert.match(html, /1 of 2/)
  assert.match(html, /2 of 2/)
  assert.match(html, /Waiting on reviewers/)
})

test('the search filters rows and an empty view explains itself', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { reviewRequests: [pullFixture(7)] })
  const base = { view: 'requests', projects: [project], records: [], login: 'armin', decisionsFor: () => [], lastLooked: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  assert.match(api.view({ ...base, query: 'thing 7' }), /Improve thing 7/)
  assert.doesNotMatch(api.view({ ...base, query: 'zzz' }), /co-envelope/)
  assert.match(api.view({ ...base, query: 'zzz' }), /Nothing matches your search/)
})
