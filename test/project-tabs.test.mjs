import assert from 'node:assert/strict'
import test from 'node:test'
import { ownerAttentionCount } from '../run.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const open = { status: 'open', type: 'pr' }
const unit = records => ({ type: 'record', records })

test('the owner attention count covers Needs you, Mark ready and Send, not private review work', () => {
  const decisions = [
    { kind: 'public_attention', unit: unit([open]) },
    { kind: 'mark_ready', unit: unit([{ status: 'draft' }]) },
    { kind: 'publish', unit: unit([{ status: 'prepared' }]) },
    { kind: 'private_review', unit: unit([{ status: 'prepared' }]) },
    { kind: 'request', unit: unit([{ status: 'prepared' }]) },
    // Feedback on a published PR is news for the owner.
    { kind: 'private_review', unit: unit([open]) },
  ]
  assert.equal(ownerAttentionCount(decisions), 4)
  assert.equal(ownerAttentionCount([]), 0)
})

let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ProjectTabs } from './ui/ProjectTabs.jsx'
    import { EmptyPulls, PullRequests } from './ui/PullRequests.jsx'
    import { SourceMap } from './ui/SourceMap.jsx'
    export const render = (Component, props) => renderToStaticMarkup(React.createElement({ EmptyPulls, ProjectTabs, PullRequests, SourceMap }[Component], props))
  `)
  return renderer
}

test('project tabs put All PRs first, count review requests and keep one PR list slot', async t => {
  const { render } = await ui(t) || {}
  if (!render) return
  const views = []
  const props = { reviewCount: 3, renderPullRequests: view => { views.push(view.scope); return 'PR-LIST' }, inventory: 'SAVED-WORK', myJobs: 'JOBS', myWork: 'FINISHED' }
  const all = render('ProjectTabs', props)
  assert.match(all, /role="tablist"/)
  assert.match(all, />All PRs</)
  assert.match(all, /aria-selected="true"[^>]*>All PRs/)
  assert.match(all, /Review requests<span class="co-tab-count is-you">3<\/span>/)
  assert.match(all, />My work</)
  assert.match(all, /PR-LIST/)
  assert.match(all, /SAVED-WORK/)
  assert.doesNotMatch(all, /JOBS|FINISHED/)
  const mine = render('ProjectTabs', { ...props, defaultTab: 'mine' })
  assert.match(mine, /JOBS[\s\S]*PR-LIST[\s\S]*FINISHED/)
  assert.doesNotMatch(mine, /SAVED-WORK/)
  assert.deepEqual(views, ['all', 'mine'])
})

const project = { key: 'app:1', kind: 'app', name: 'Fixture', available: true, canonical_repo: 'owner/repo', base_sha: 'b'.repeat(40), reviewRequests: [] }

test('the PR list follows its tab: requests explain themselves and My work shows agent reviews only', async t => {
  const { render } = await ui(t) || {}
  if (!render) return
  const base = { appId: 'app', token: 'token', project, conn: { state: 'connected', login: 'owner' } }
  const all = render('PullRequests', base)
  assert.match(all, /aria-label="Filter pull requests"/)
  assert.match(all, /Show: opened by me/)
  const requests = render('PullRequests', { ...base, scope: 'requests' })
  assert.match(requests, /PRs where someone asked for your review/)
  assert.doesNotMatch(requests, /aria-label="Filter pull requests"/)
  const mine = render('PullRequests', { ...base, scope: 'mine' })
  assert.match(mine, /No agent reviews in this project yet/)
  assert.doesNotMatch(mine, /Search pull requests|co-pr-box/)
})

test('the projects list tags each project and folds apps with nothing to do', async t => {
  const { render } = await ui(t) || {}
  if (!render) return
  const platform = { key: 'platform', kind: 'platform', name: 'Möbius', available: true, canonical_repo: 'mobius-os/mobius', localFiles: 2, contributions: [] }
  const quiet = { key: 'app:2', kind: 'app', name: 'Quiet app', available: true, canonical_repo: 'owner/quiet', contributions: [] }
  const busy = { ...project, key: 'app:3', name: 'Busy app', contributions: [], reviewRequests: [{ number: 1, repository: { nameWithOwner: 'owner/repo' } }] }
  const html = render('SourceMap', { projects: [platform, quiet, busy], conn: { state: 'connected' }, attention: { 'app:3': 2 } })
  assert.match(html, /Möbius<\/strong><span class="co-source-tag">Platform<\/span>/)
  assert.match(html, /Busy app<\/strong><span class="co-source-tag">App<\/span>/)
  assert.match(html, /1 PR waits for your review\. 2 things need you\./)
  assert.match(html, /<details class="co-quiet-projects"><summary><span>Apps with nothing to do<\/span><b>1<\/b>/)
  assert.doesNotMatch(html, /Everything else/)
})

test('the Review requests tab never calls the inbox empty while more PRs can load', async t => {
  const { render } = await ui(t) || {}
  if (!render) return
  const unloaded = render('EmptyPulls', { scope: 'requests', filter: 'all', query: '', hasNextPage: true, waiting: 3 })
  assert.doesNotMatch(unloaded, /right now/)
  assert.match(unloaded, /No review requests in the PRs loaded so far/)
  assert.match(unloaded, /You have 3 review requests in this project\. Load more PRs to check the rest\./)
  const searched = render('EmptyPulls', { scope: 'requests', filter: 'all', query: 'menu', hasNextPage: true, waiting: 3 })
  assert.match(searched, /No review requests match in the PRs loaded so far/)
  assert.doesNotMatch(searched, /You have/, 'a search may exclude the waiting requests, so their count is not claimed')
  const done = render('EmptyPulls', { scope: 'requests', filter: 'all', query: '', hasNextPage: false, waiting: 0 })
  assert.match(done, /No review requests right now/)
})
