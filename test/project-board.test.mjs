import assert from 'node:assert/strict'
import test from 'node:test'
import { attachSourceProjects, projectBoardFacts, projectHasSharedUpdates, recordsForProject } from '../source-map.js'
import { contributionCycleAction, organizePrivateWorkAction } from '../review.js'
import { normalizeCycleState, normalizeAppSettings } from '../storage.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const project = {
  key: 'app:80', kind: 'app', name: 'Contribute', available: true,
  viewerPermission: 'MAINTAIN', canonical_repo: 'mobius-os/app-contribute', head_sha: 'local', base_sha: 'accepted',
  origin: { sha: 'accepted' }, localFiles: 2, workingFiles: 0,
}

test('new contribution settings always use the connected GitHub identity', () => {
  assert.equal(normalizeAppSettings(null).submission_method, 'github')
  assert.equal(normalizeAppSettings({ autopilot_default: false }).submission_method, 'github')
  assert.equal(normalizeAppSettings({ submission_method: 'github' }).submission_method, 'github')
  assert.equal(normalizeAppSettings({ submission_method: 'mobius' }).submission_method, 'github')
})

test('project facts never equate published review work with accepted or only-local work', () => {
  const facts = projectBoardFacts({ ...project, contributions: [
    { status: 'prepared' }, { status: 'open' }, { status: 'draft' }, { status: 'merged' },
  ] })
  assert.equal(facts.work, '2 edited files are not on GitHub yet. 1 prepared PR waits for you to send. 2 of your PRs are open on GitHub.')
  // Last-fetched evidence is never an online all-clear: it always names the last check.
  assert.equal(facts.shared, 'Up to date at the last check.')
  assert.doesNotMatch(facts.shared, /with GitHub|latest|linear/)
})

test('unknown comparison and installed baseline are not an online all-clear', () => {
  assert.equal(projectBoardFacts({ ...project, origin: null }).shared, 'Same as the installed version.')
  assert.equal(projectBoardFacts({ ...project, origin: null, base_sha: null }).shared, 'Not compared with GitHub yet.')
  assert.equal(projectBoardFacts({ ...project, sourceComparisonRequired: true }).shared, 'Not compared with GitHub yet.')
  assert.equal(projectBoardFacts({ ...project, incomingFiles: 2 }).shared, 'GitHub has updates for this project.')
  assert.equal(projectBoardFacts({ ...project, conflictFiles: 1 }).shared, 'An update from GitHub needs your attention.')
})

test('prepared PR revisions are not counted as unpublished new proposals',()=>{
  const facts=projectBoardFacts({...project,contributions:[{status:'prepared',plan:{action:'pr_update'}},{status:'prepared',plan:{action:'pr'}},{status:'prepared',number:7,url:'https://github.com/owner/repo/pull/7'}]})
  assert.match(facts.work,/1 prepared PR waits for you to send\. 2 PR updates are ready to send\./)
  assert.doesNotMatch(facts.work,/not shared|in review/)
})

test('semantic comparison outranks a behind commit count when reporting shared updates', () => {
  const reconciled = { ...project, semanticAvailable: true, incomingFiles: 0, originBehind: 5 }
  assert.equal(projectHasSharedUpdates(reconciled), false)
  assert.equal(projectBoardFacts(reconciled).shared, 'Up to date at the last check.')
  assert.equal(projectHasSharedUpdates({ ...reconciled, incomingFiles: 1 }), true)
  assert.equal(projectHasSharedUpdates({ ...reconciled, semanticAvailable: false }), true)
})

test('local-only apps and missing source remain explicit, not false sync success', () => {
  assert.equal(projectBoardFacts({ ...project, builtHere: true, canonical_repo: null }).shared, 'Not on GitHub.')
  assert.equal(projectBoardFacts({ ...project, available: false }).shared, 'The local files could not be read.')
  assert.match(projectBoardFacts({ kind: 'external' }).work, /not checked/)
})

test('project scope includes its complete records and never another repository', () => {
  const records = [
    { id: 'a', repo: project.canonical_repo, plan: { stack: { id: 'stack', position: 1 } } },
    { id: 'b', plan: { repo: project.canonical_repo.toUpperCase(), stack: { id: 'stack', position: 2 } } },
    { id: 'other', repo: 'owner/other' },
  ]
  assert.deepEqual(recordsForProject(records, project).map(rec => rec.id), ['a', 'b'])
  assert.deepEqual(recordsForProject(records, { key: 'private' }), [])
  assert.equal(recordsForProject(records, null), records)
})

test('preparation names exact project scope and groups by coherent code rather than chat', () => {
  const action = organizePrivateWorkAction([], { byId: {} }, [project])
  assert.match(action.draft, /\[app:80; mobius-os\/app-contribute\]/)
  assert.match(action.draft, /not one pull request per chat/)
  assert.match(action.draft, /blocked group must not hold up unrelated ready work/)
  assert.match(action.draft, /Do not push, publish/)
})

test('the saved work title survives reopening without changing the legacy cycle shape', () => {
  assert.equal(normalizeCycleState({ chat_id: 'work', title: 'Get Contribute up to date' }).title, 'Get Contribute up to date')
  assert.equal(normalizeCycleState({ chat_id: 'work' }).title, undefined)
})

test('project controls state edits and GitHub status in plain words, with no Pull updates or competing merge button', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ProjectControls } from './ui/ProjectControls.jsx'
    export function render(props) { return renderToStaticMarkup(React.createElement(ProjectControls, props)) }
  `)
  const props = {
    projects: [project], project,
    run: { decisions: [{ kind: 'publish' }], working: [], privateAction: { title: 'Prepare', draft: 'Prepare privately' } },
    cycle: { phase: 'idle' }, onStart: () => {}, onReviews: () => {},
  }
  props.mergeRun = props.run
  const html = render(props)
  assert.match(html, /Actions for Contribute/)
  assert.match(html, /2 files<\/strong> changed on this Möbius are not on GitHub yet\./)
  assert.match(html, /Make PRs from my edits/)
  assert.match(html, /Up to date<\/strong> at the last check\./)
  // Settings and the App Store own updates; Contribute no longer starts its own pull.
  assert.doesNotMatch(html, /Pull updates|Start pull/)
  assert.doesNotMatch(html, /Bring accepted changes here/)
  assert.doesNotMatch(html, /Prepare &amp; merge|Prepare all|Update all/)
  assert.doesNotMatch(html, /More actions|View reviews/)
  // Starting a full cycle is an option of Prepare, offered only with merge rights.
  assert.match(html, /Follow through to merge/)
  assert.doesNotMatch(render({ ...props, project: { ...project, viewerPermission: 'READ' } }), /Follow through to merge/)
  // An idle project has no permanent second workflow panel.
  assert.doesNotMatch(html, /Project work|Full merge cycles/)
  assert.doesNotMatch(html, /Options &amp; process/)
  assert.doesNotMatch(html, /<details[^>]* open/)
  const loading = render({ ...props, loading: true })
  assert.match(loading, /disabled=""/)
})

test('incoming community reviews and historical replies remain within a discoverable project', () => {
  const incoming = { number: 7, url: 'https://github.com/community/work/pull/7', repository: { nameWithOwner: 'Community/Work' }, reviewRequested: true }
  const projects = attachSourceProjects(null, [{ id: 'reply', type: 'issue_comment', status: 'commented', repo: 'other/project' }], [incoming])
  assert.equal(projects.find(p => p.canonical_repo === 'community/work').incomingReviews[0], incoming)
  assert.deepEqual(projects.find(p => p.canonical_repo === 'community/work').reviewRequests, [incoming])
  assert.ok(projects.find(p => p.canonical_repo === 'other/project'))
  assert.equal(projects.find(p => p.canonical_repo === 'community/work').attention, true)
})

test('a pull request that only involves the owner places its repository but asks nothing of them', () => {
  const involved = { number: 8, url: 'https://github.com/community/work/pull/8', repository: { nameWithOwner: 'Community/Work' } }
  const project = attachSourceProjects(null, [], [involved]).find(p => p.canonical_repo === 'community/work')
  assert.ok(project)
  assert.deepEqual(project.reviewRequests, [])
  assert.notEqual(project.attention, true)
})

test('full cycle remains available for public-only work without inventing publication approval', () => {
  const run = { revision: 'reviewed', privateAction: null, decisions: [], working: [{ id: 'public:1' }] }
  const action = contributionCycleAction(run, [project])
  assert.match(action.draft, /only these projects/)
  assert.match(action.draft, /repository mobius-os\/app-contribute/)
  assert.match(action.draft, /group coherent changes within each repository/)
  assert.match(action.draft, /does not pre-authorize any public action/)
  assert.equal(contributionCycleAction({ decisions: [], working: [] }, [project]), null)
})
