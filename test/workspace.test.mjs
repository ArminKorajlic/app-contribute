import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collaborationRequest, matchingPulls, prKey, reviewForPull, reviewRunRequest,
} from '../collaboration.js'
import { beginProjectCycle, loadCurrentCycle, loadCycleState, projectCycleScope, saveCycleState, updateCurrentCycle } from '../storage.js'
import { frontendModules, renderModule } from './render-harness.mjs'

// Real React SSR through the app's bundler. These tests do not claim browser
// click coverage, focus/scroll behavior, or component mount lifetime: the
// installed frontend supplies no jsdom or other DOM test environment.
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const project = {
  key: 'app:fixture', kind: 'app', name: 'Fixture project', available: true,
  canonical_repo: 'owner/project', viewerPermission: 'WRITE',
  head_sha: HEAD, base_sha: BASE, localFiles: 1, workingFiles: 0,
}
const pull = (number = 7, extra = {}) => ({
  number, title: `Contribution ${number}`, headRefOid: HEAD,
  baseRefName: 'main', baseRefOid: 'd'.repeat(40), baseRef: { target: { oid: BASE } }, isDraft: false,
  url: `https://github.com/owner/project/pull/${number}`,
  repository: { nameWithOwner: 'owner/project', viewerPermission: 'WRITE' },
  author: { login: 'owner' }, assignees: { nodes: [] }, ...extra,
})
const reviewItem = (extra = {}) => ({
  repo: 'owner/project', number: 7, head_sha: HEAD,
  base_ref: 'main', base_sha: BASE, state: 'all_clear', ...extra,
})
const work = (id, kind, status, record = {}) => ({
  id, kind, label: id, detail: 'owner/project',
  record: { id, type: 'pr', repo: 'owner/project', number: 7, title: id, status, ...record },
})
const run = (extra = {}) => ({ decisions: [], working: [], recent: [], archive: [], ...extra })

let renderer
async function rendered(t) {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
    return null
  }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { TaskContext, TaskPane } from './ui/TaskPane.jsx'
    import { SourceMap } from './ui/SourceMap.jsx'
    import { ProjectControls } from './ui/ProjectControls.jsx'
    import { PullRequests } from './ui/PullRequests.jsx'
    import { ReviewConfirmation } from './ui/ReviewConfirmation.jsx'
    import { ContributionRun } from './ui/Feed.jsx'

    const components = { SourceMap, ProjectControls, PullRequests, ReviewConfirmation, ContributionRun, TaskPane }
    export function render(name, props, task) {
      const content = React.createElement(components[name], props)
      return renderToStaticMarkup(task === undefined ? content :
        React.createElement(TaskContext.Provider, { value: task }, content))
    }
    export function renderPublicRun(props, pullProps, task) {
      return render('ContributionRun', {
        ...props, renderPublicWork: () => React.createElement(PullRequests, pullProps),
      }, task)
    }
  `)
  return renderer
}

test('a run belongs to the exact repository, PR, code and target branch, bound to the live branch tip', () => {
  const item = reviewItem({ repo: 'OWNER/PROJECT' })
  const reviewed = { id: 'exact-run', items: [item] }
  assert.deepEqual(reviewForPull([reviewed], pull()), { run: reviewed, item, exactBase: true })
  for (const [field, value] of [
    ['repo', 'owner/another-project'], ['number', 8], ['head_sha', 'c'.repeat(40)], ['base_ref', 'release'],
  ]) {
    assert.equal(reviewForPull([{ items: [reviewItem({ [field]: value })] }], pull()), null, field)
  }
  assert.equal(reviewForPull([], pull()), null)
})

test('a review on an older branch tip stays visible but is never presented as current', () => {
  const exact = { id: 'exact', items: [reviewItem()] }
  const older = { id: 'older-tip', items: [reviewItem({ base_sha: 'c'.repeat(40), state: 'merged' })] }
  assert.equal(reviewForPull([older, exact], pull()).run, exact, 'the run on the current tip wins')
  const moved = reviewForPull([exact], pull(7, { baseRef: { target: { oid: 'c'.repeat(40) } } }))
  assert.equal(moved.run, exact)
  assert.equal(moved.exactBase, false)
})

test('missing target identity never counts as an exact reviewed base', () => {
  for (const missing of [undefined, null, '']) {
    assert.equal(reviewForPull([{ items: [reviewItem({ base_ref: missing })] }], pull(7, { baseRefName: missing })), null)
    assert.equal(reviewForPull([{ items: [reviewItem({ base_sha: missing })] }], pull()).exactBase, false)
    assert.equal(reviewForPull([{ items: [reviewItem()] }], pull(7, { baseRef: missing })).exactBase, false)
  }
})

test('own and assigned PR selection constructs a review without assigning anyone or sending a request', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ run: { id: 'fixture-review' } }))
  })
  const pulls = [pull(), pull(8, { assignees: { nodes: [{ login: 'teammate' }] } })]
  const before = structuredClone(pulls)
  const selected = matchingPulls(pulls, 'authored', 'OWNER')
  assert.deepEqual(selected.map(prKey), ['owner/project#7', 'owner/project#8'])
  const request = reviewRunRequest({ request_id: 'explicit-confirmation', mode: 'review', pulls: selected })
  assert.deepEqual(calls, [], 'selection and request construction are not mutations')
  assert.deepEqual(pulls, before, 'selection must preserve existing assignment')
  assert.ok(request.items.every(item => item.head_sha === HEAD && item.base_sha === BASE && item.base_ref === 'main'))
  assert.ok(request.items.every(item => !('assignee' in item)))

  await collaborationRequest('fixture-only', 'fixture-app', 'review-runs', request)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/github/contributions/fixture-app/review-runs')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].options.body), request)
  assert.doesNotMatch(calls[0].url, /assign|merge/)
})

test('SSR review window starts takeover only when the entire selection is eligible', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const renderChoice = (pulls, mode = 'review', busy = false) => ui.render('ReviewConfirmation', {
    choice: { request_id: 'fixture-choice', mode, pulls }, busy, onModeChange: () => {}, capabilities: { review_fix_merge: true },
  })
  for (const permission of ['WRITE', 'MAINTAIN', 'ADMIN']) {
    const pulls = [pull(7, { repository: { nameWithOwner: project.canonical_repo, viewerPermission: permission } })]
    const takeover = renderChoice(pulls, 'review_fix_merge')
    assert.doesNotMatch(takeover, /disabled="">Allow fix and merge/, permission)
    const html = renderChoice(pulls)
    assert.match(html, /Start private review/)
    // No option starts switched on (aria-checked="false" is not a checked box).
    assert.doesNotMatch(html, /type="checkbox"[^>]*\schecked=""/)
  }
  for (const permission of ['READ', 'TRIAGE', null]) {
    const pulls = [pull(), pull(8, { repository: { nameWithOwner: project.canonical_repo, viewerPermission: permission } })]
    assert.match(renderChoice(pulls, 'review_fix_merge'), /disabled="">Allow fix and merge/, String(permission))
    assert.match(renderChoice(pulls), /Start private review/)
  }
  assert.match(renderChoice([pull(7, { isDraft: true })], 'review_fix_merge'), /disabled="">Allow fix and merge/)
  const merge = renderChoice([pull()], 'review_merge', true)
  assert.match(renderChoice([pull()], 'review_merge'), /Start review, merge when safe/)
  assert.match(merge, /Exact versions/)
  assert.match(merge, /all required checks pass, it merges the PR or adds it to the merge queue/)
  assert.match(merge, /the merge\. No comments and no code changes\./)
  assert.match(merge, /disabled=""/)
})

test('SSR local preparation remains inventory when another task owns the outlet', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const props = { project, run: { privateAction: { title: 'Prepare', draft: 'Private preparation' } }, cycle: { phase: 'idle' } }
  const html = ui.render('ProjectControls', props, { activeId: 'task:review', host: null })
  assert.match(html, /1 file<\/strong> changed on this Möbius\./)
  assert.match(html, /Your edits and GitHub/)
  assert.match(html, /See the files/)
  assert.doesNotMatch(html, /Check &amp; update safely/)
  assert.equal(ui.render('TaskPane', { id: 'task:prepare', children: 'Task body' }, { activeId: 'task:review', host: null }), '')
  assert.equal(ui.render('TaskPane', { id: 'task:prepare', children: 'Task body' }), 'Task body')
})

test('SSR preparation checks its own durable conversation before offering another start', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const privateAction = { title: 'Prepare', draft: 'Private preparation' }
  const html = ui.render('ProjectControls', { project, run: { privateAction }, mergeRun: { privateAction } })
  assert.match(html, /role="status"/)
  assert.match(html, /Make PRs from my edits/)
  assert.match(html, /Checking existing work/ )
  assert.match(html, /disabled=""/) // no agent action until the saved project conversation is checked
})

test('durable project conversation shortcuts stay isolated across projects and the legacy global cycle', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const values = new Map()
  const calls = []
  globalThis.window = { mobius: { storage: {
    get: async key => { calls.push(['get', key]); return values.get(key) },
    set: async (key, value) => { calls.push(['set', key]); values.set(key, structuredClone(value)) },
  } } }
  assert.equal(await saveCycleState({ chat_id: 'legacy-chat', title: 'Legacy global work' }), true)
  assert.equal(await loadCycleState(project.key), null, 'global work is not another project’s conversation')
  await Promise.all([
    saveCycleState({ chat_id: 'first-chat', title: 'Prepare first project' }, project.key),
    saveCycleState({ chat_id: 'second-chat', title: 'Update other project' }, 'external:owner/other'),
  ])
  assert.equal((await loadCycleState(project.key)).chat_id, 'first-chat')
  assert.equal((await loadCycleState('external:owner/other')).chat_id, 'second-chat')
  assert.equal((await loadCycleState()).chat_id, 'legacy-chat')
  assert.equal(await loadCycleState('app:never-started'), null)
  values.set('project-cycles/legacy-project.json', {
    schema: 1, chat_id: 'platform-chat', title: 'Existing platform work',
  })
  assert.equal((await loadCycleState('legacy-project')).chat_id, 'platform-chat')
  const platformDigestWrite = calls.find(([operation, key]) => (
    operation === 'set'
    && /^project-cycles\/[a-f0-9]{64}\.json$/.test(key)
    && values.get(key)?.chat_id === 'platform-chat'
  ))
  assert.ok(platformDigestWrite, 'safe legacy shortcut is migrated to the digest key')
  const writtenKeys = calls.filter(([operation]) => operation === 'set').map(([, key]) => key)
  assert.equal(new Set(writtenKeys).size, 4)
  assert.equal(writtenKeys[0], 'cycle-state.json')
  for (const key of writtenKeys.slice(1)) {
    assert.match(key, /^project-cycles\/[a-f0-9]{64}\.json$/)
    assert.doesNotMatch(key, /%|:|\/.*\//, 'project identity must not escape into the storage filename')
  }
})

test('a new project cycle keeps the previous conversation and refuses a pane that observed an older cycle', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  let value = { schema: 1, chat_id: 'old-chat', title: 'Old preparation', started_at: '2026-09-10T12:00:00Z' }
  let version = 1
  globalThis.window = { mobius: { storage: {
    get: async () => structuredClone(value),
    getWithVersion: async () => ({ value: structuredClone(value), version: String(version) }),
    durableWrite: async (_key, next, options) => {
      assert.equal(options.ifMatch, String(version))
      value = structuredClone(next); version += 1
      return { durability: 'synced' }
    },
  } } }
  const action = { title: 'New full merge cycle', draft: 'Exact work', event: 'contribution_cycle', merge: true, agent: { provider: 'codex', model: 'chosen' } }
  assert.equal((await beginProjectCycle('fixture-project', { title: 'No draft' }, 0)).ok, false, 'an incomplete start is never saved')
  const scope = await projectCycleScope('fixture-project')
  assert.match(scope, /^contribute-cycle:[0-9a-f]{32}$/, 'one scope per project, no cycle number in it')
  const first = await beginProjectCycle('fixture-project', action, 0)
  assert.deepEqual([first.ok, first.k, first.cid, first.scope], [true, 1, scope + ':1', scope])
  // The saved cycle carries the exact work and model it sends.
  assert.deepEqual(value.cycle.action, action)
  assert.deepEqual((await loadCycleState('fixture-project')).cycle.action, action)
  assert.equal((await beginProjectCycle('fixture-project', action, 0)).ok, false, 'a pane that saw cycle 0 cannot start cycle 1 again')
  assert.equal((await loadCycleState('fixture-project')).chat_id, 'old-chat')
  assert.equal((await loadCurrentCycle('fixture-project')).cycle.cid, scope + ':1')
  assert.equal(await updateCurrentCycle('fixture-project', 1, scope + ':1', { attempted: true, modelApplied: true }), true)
  assert.equal(await updateCurrentCycle('fixture-project', 1, scope + ':1', { chatId: 'new-chat', delivered: true }), true)
  assert.equal(await updateCurrentCycle('fixture-project', 7, scope + ':7', { chatId: 'other-chat', delivered: true }), false, 'a stale delivery never rewrites a newer record')
  assert.equal(await updateCurrentCycle('fixture-project', 1, 'other-scope:1', { delivered: true }), false, 'the cycle id must match too')
  assert.deepEqual([value.cycle.attempted, value.cycle.model_applied, value.cycle.chat_id], [true, true, 'new-chat'])
  const saved = await loadCycleState('fixture-project')
  assert.equal(saved.chat_id, 'new-chat')
  assert.equal(saved.cycle.delivered, true)
  assert.equal(saved.history[0].chat_id, 'old-chat')
  const second = await beginProjectCycle('fixture-project', action, 1)
  assert.equal(second.cid, scope + ':2')
})

test('a legacy project shortcut still opens when its migration write fails', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  globalThis.window = { mobius: { storage: {
    get: async key => key === 'project-cycles/platform.json'
      ? { schema: 1, chat_id: 'platform-chat', title: 'Existing platform work' }
      : undefined,
    set: async () => { throw new Error('temporarily read-only') },
  } } }

  assert.equal((await loadCycleState('platform')).chat_id, 'platform-chat')
})

test('a durable project never falls back to an ambiguous old app-row digest', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const digest = bytes => Array.from(new Uint8Array(bytes), byte => (
    byte.toString(16).padStart(2, '0')
  )).join('')
  const oldKey = `project-cycles/${digest(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode('app:7'),
  ))}.json`
  const reads = []
  globalThis.window = { mobius: { storage: {
    get: async key => {
      reads.push(key)
      return key === oldKey
        ? { schema: 1, chat_id: 'wrong-project-chat', title: 'Old row work' }
        : undefined
    },
  } } }

  assert.equal(await loadCycleState('repo:owner/current'), null)
  assert.equal(reads.some(key => key === oldKey), false)
})

test('legacy shortcut migration never overwrites a shortcut created concurrently', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  let digestReads = 0
  globalThis.window = { mobius: { storage: {
    get: async key => {
      if (key === 'project-cycles/legacy-project.json') {
        return { schema: 1, chat_id: 'legacy-chat', title: 'Old work' }
      }
      if (/^project-cycles\/[a-f0-9]{64}\.json$/.test(key)) {
        digestReads += 1
        return digestReads === 1 ? undefined : {
          schema: 1, chat_id: 'new-chat', title: 'New work',
        }
      }
      return undefined
    },
    getWithVersion: async () => ({ value: null, version: null }),
    durableWrite: async () => {
      const error = new Error('shortcut already exists')
      error.code = 'conflict'
      throw error
    },
  } } }

  assert.equal((await loadCycleState('legacy-project')).chat_id, 'new-chat')
  assert.equal(digestReads, 2, 'conflict reconciliation rereads the winning shortcut')
})

test('legacy shortcut remains usable when conflict reconciliation cannot reread', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  let digestReads = 0
  globalThis.window = { mobius: { storage: {
    get: async key => {
      if (key === 'project-cycles/legacy-project.json') {
        return { schema: 1, chat_id: 'legacy-chat', title: 'Old work' }
      }
      if (/^project-cycles\/[a-f0-9]{64}\.json$/.test(key)) {
        digestReads += 1
        if (digestReads > 1) throw new Error('temporarily unavailable')
      }
      return undefined
    },
    getWithVersion: async () => ({ value: null, version: null }),
    durableWrite: async () => {
      const error = new Error('shortcut already exists')
      error.code = 'conflict'
      throw error
    },
  } } }

  assert.equal((await loadCycleState('legacy-project')).chat_id, 'legacy-chat')
})

test('SSR selecting a focused contribution retains the project inventory and history', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const privateWork = work('Private work', 'private_review', 'prepared')
  const current = run({
    decisions: [privateWork], working: [work('Published work', 'public', 'open')],
    recent: [work('Accepted work', 'done', 'merged')], archive: [work('Historical work', 'archived', 'abandoned')],
  })
  for (const selectedId of ['', privateWork.id, 'task:pulls', 'task:review']) {
    // Selecting never hides inventory: All PRs keeps saved public work, My work keeps history.
    const tabs = { all: ['Private work', 'Published work'], mine: ['Private work', 'Accepted work', 'Historical work'] }
    for (const [defaultTab, labels] of Object.entries(tabs)) {
      const html = ui.render('ContributionRun', { run: current, selectedId, defaultTab }, { activeId: selectedId, host: null })
      for (const label of labels) assert.match(html, new RegExp(label), `${label} remains listed on ${defaultTab} for ${selectedId}`)
      assert.doesNotMatch(html, /This contribution moved|Archived proposals/)
    }
  }
})

test('SSR public review inventory replaces duplicate public rows but retains private and accepted work', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const current = run({
    decisions: [work('Private work', 'private_review', 'prepared')],
    working: [work('Duplicate open row', 'public', 'open'), work('Duplicate draft row', 'public', 'draft', { number: 8 }),
      work('Unfetched PR', 'public', 'open', { number: 9 }), work('Different repository', 'public', 'open', { repo: 'owner/other' }),
      work('Still preparing', 'preparing', 'prepared')],
    recent: [work('Accepted work', 'done', 'merged')],
  })
  const html = ui.renderPublicRun({ run: current, githubState: 'connected', selectedId: 'task:review' }, {
    appId: 'fixture-app', token: 'fixture-only', project, conn: { state: 'connected', login: 'owner' },
  }, { activeId: 'task:review', host: null, publicKeys: new Set(['owner/project#7', 'owner/project#8']) })
  assert.match(html, /aria-label="Pull requests"/)
  assert.match(html, /aria-label="Filter pull requests"/)
  assert.match(html, /Show: opened by me/)
  assert.match(html, /Show: assigned/)
  for (const label of ['Private work', 'Still preparing', 'Unfetched PR', 'Different repository']) assert.match(html, new RegExp(label))
  assert.doesNotMatch(html, /Duplicate open row|Duplicate draft row|This contribution moved/)
  const mine = ui.renderPublicRun({ run: current, githubState: 'connected', defaultTab: 'mine' }, {
    appId: 'fixture-app', token: 'fixture-only', project, conn: { state: 'connected', login: 'owner' },
  }, { host: null, publicKeys: new Set(['owner/project#7', 'owner/project#8']) })
  assert.match(mine, /Accepted work/)
})

test('SSR unavailable GitHub cannot hide saved public contributions behind an empty review inventory', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const current = run({ working: [work('Saved public contribution', 'public', 'open')] })
  for (const state of ['disconnected', 'unknown', 'unsupported']) {
    const html = ui.renderPublicRun({ run: current, githubState: state }, {
      appId: 'fixture-app', token: 'fixture-only', project, conn: { state },
    })
    assert.match(html, /Saved public contribution/, state)
  }
})

test('SSR a partially fetched public stack keeps its saved group until every member has a review row', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const first = work('First layer', 'public', 'open').record
  const second = work('Unfetched layer', 'public', 'open', { number: 8 }).record
  const stack = { id: 'stack:fixture', kind: 'public', label: 'Saved related contributions', record: first,
    unit: { type: 'stack', id: 'fixture', records: [first, second] } }
  const props = { run: run({ working: [stack] }), githubState: 'connected' }
  const pullProps = { appId: 'fixture-app', token: 'fixture-only', project, conn: { state: 'connected' } }
  const partial = ui.renderPublicRun(props, pullProps, { host: null, publicKeys: new Set(['owner/project#7']) })
  assert.match(partial, /Saved related contributions/)
  const complete = ui.renderPublicRun(props, pullProps, { host: null, publicKeys: new Set(['owner/project#7', 'owner/project#8']) })
  assert.doesNotMatch(complete, /Saved related contributions/)
  assert.match(complete, /aria-label="Pull requests"/)
})

test('SSR opening project and review surfaces never performs transport or invokes mutation callbacks', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const calls = []
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args)
    throw new Error('Network is forbidden in workspace SSR tests')
  })
  const mutate = () => assert.fail('Rendering is not approval to mutate')
  const choice = { request_id: 'fixture-choice', mode: 'review_merge', pulls: [pull()] }
  ui.render('ReviewConfirmation', { choice, onConfirm: mutate, onCancel: mutate, onModeChange: mutate })
  ui.render('ProjectControls', { project, run: { privateAction: { draft: 'Private work' } }, onStart: mutate })
  ui.render('PullRequests', { appId: 'fixture-app', token: 'fixture-only', project, conn: { state: 'connected' }, onChanged: mutate })
  const overview = ui.render('SourceMap', { projects: [project], conn: { state: 'connected' }, onRetry: mutate })
  assert.match(overview, /Open Fixture project/)
  assert.deepEqual(calls, [])
})
