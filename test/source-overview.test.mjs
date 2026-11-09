import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const runRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import {
    ContributionRun,
    FocusedItem,
    batchFingerprint,
    publicationRouteProblem,
  } from './ui/Feed.jsx'

  import { TaskContext } from './ui/TaskPane.jsx'
  const noop = () => ({ ok: true })
  export { batchFingerprint, publicationRouteProblem }
  export function renderRun(run, options = {}) {
    return renderToStaticMarkup(React.createElement(TaskContext.Provider, { value: options.cycle ? { cycle: options.cycle } : null }, React.createElement(ContributionRun, {
      run,
      loading: false,
      presentation: options.presentation || 'project',
      selectedId: options.selectedId || '',
      projectName: options.projectName || 'Project',
      reviewStatus: { byId: {} },
      cycle: options.cycle || { phase: 'idle' },
      publicationPreference: options.publicationPreference || 'github',
      githubState: options.githubState || 'connected',
      onStartCycle: noop,
      onStopCycle: noop,
      onOpenCycle: noop,
      onSend: noop,
      onSendStack: noop,
      onMarkReady: noop,
      onFeedback: noop,
      onDismiss: noop,
      onRestore: noop,
      onSetAutopilot: noop,
      onWithdraw: noop,
      onConnectApp: noop,
      onAssignIncomingReview: noop,
      onViewProject: noop,
      loadDiff: noop,
    })))
  }
  export function renderFocus(item, options = {}) {
    return renderToStaticMarkup(React.createElement(FocusedItem, {
      item,
      reviewStatus: options.reviewStatus || { byId: {} },
      onReview: options.onReview,
      onFeedback: noop,
      onDismiss: noop,
      onRestore: noop,
      onSetAutopilot: noop,
      onWithdraw: noop,
      onConnectApp: noop,
      onMarkReady: noop,
      onAssignIncomingReview: noop,
      loadDiff: noop,
    }))
  }
`)

function record(id, extra = {}) {
  const plan = {
    action: 'pr', repo: 'mobius-os/mobius', title: id,
    branch: 'fix/' + id, head_sha: 'a'.repeat(40),
    ...(extra.plan || {}),
  }
  return {
    id, type: 'pr', repo: plan.repo, status: 'prepared', title: id,
    quality_review: { state: 'all_clear', reviewed_head_sha: plan.head_sha },
    ...extra, plan,
  }
}

test('the Run renders one batch action without a duplicate publish row', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const rec = record('One reviewed change')
  const item = {
    id: 'publish:one', kind: 'publish', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    label: rec.title, detail: rec.repo,
  }
  const html = renderRun({
    decisions: [item], working: [], recent: [], archive: [], projects: [],
    privateAction: null,
  })

  assert.equal((html.match(/co-run-primary is-send/g) || []).length, 1)
  assert.doesNotMatch(html, /co-run-row is-publish/)
  assert.match(html, /Review and send/)
  assert.doesNotMatch(html, /Needs you|No decisions waiting/)
})

test('a mixed-route publication batch stays behind one exact preflight', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const relay = record('Möbius change')
  const external = record('External change', { plan: { repo: 'owner/project' }, repo: 'owner/project' })
  const update = record('Existing PR update', { plan: { action: 'pr_update' } })
  const items = [relay, external, update].map((rec, index) => ({
    id: `publish:${index}`, kind: 'publish', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    label: rec.title, detail: rec.repo,
  }))
  const html = renderRun({
    decisions: items, working: [], recent: [], archive: [], projects: [],
    privateAction: null,
  }, { publicationPreference: 'mobius', githubState: 'connected' })

  assert.match(html, /3 prepared PRs/)
  assert.match(html, /Privately reviewed. Nothing shared yet/)
  assert.match(html, /Review and send 3/)
})

test('known route failures leave the public batch before approval', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { publicationRouteProblem } = await runRenderer()
  const external = record('External', { plan: { repo: 'owner/project' }, repo: 'owner/project' })
  const standalone = {
    id: 'publish:external', kind: 'publish', record: external,
    unit: { type: 'record', id: external.id, record: external, records: [external] },
  }
  const update = record('Update', { plan: { action: 'pr_update' } })
  const updateItem = {
    id: 'publish:update', kind: 'publish', record: update,
    unit: { type: 'record', id: update.id, record: update, records: [update] },
  }
  const draft = { ...record('Draft'), status: 'draft' }
  const readyItem = {
    id: 'mark_ready:draft', kind: 'mark_ready', record: draft,
    unit: { type: 'record', id: draft.id, record: draft, records: [draft] },
  }

  assert.match(publicationRouteProblem(standalone, 'mobius', 'disconnected'), /contribute as your account/)
  assert.match(publicationRouteProblem(updateItem, 'mobius', 'disconnected'), /Connect GitHub/)
  assert.match(publicationRouteProblem(readyItem, 'github', 'disconnected'), /Reconnect GitHub/)

  const common = { id: 'stack', name: 'Stack', total: 2 }
  const layers = [1, 2].map(position => record(`Layer ${position}`, { plan: {
    branch: `stack/stack/${position}`,
    stack: {
      ...common, position, base_branch: position === 1 ? 'main' : 'stack/stack/1',
      parent_record_id: position === 1 ? '' : 'Layer 1',
    },
  } }))
  const stack = {
    id: 'publish:stack', kind: 'publish',
    unit: { type: 'stack', id: 'stack', records: layers }, record: layers[0],
  }
  assert.equal(publicationRouteProblem(stack, 'mobius', 'connected'), '')
})

test('an exact approval fingerprint changes with head, route, and review stage', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { batchFingerprint } = await runRenderer()
  const rec = record('Approved head')
  const item = {
    id: 'publish:head', kind: 'publish', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
  }
  const approved = batchFingerprint([item], 'send', 'github', 'connected')
  const changedHead = {
    ...item,
    record: { ...rec, plan: { ...rec.plan, head_sha: 'b'.repeat(40) } },
    unit: {
      ...item.unit,
      record: { ...rec, plan: { ...rec.plan, head_sha: 'b'.repeat(40) } },
      records: [{ ...rec, plan: { ...rec.plan, head_sha: 'b'.repeat(40) } }],
    },
  }

  assert.notEqual(batchFingerprint([changedHead], 'send', 'github', 'connected'), approved)
  assert.notEqual(batchFingerprint([item], 'send', 'mobius', 'connected'), approved)
  assert.notEqual(batchFingerprint([item], 'ready', 'github', 'connected'), approved)
})

test('the Run keeps project identity without duplicating Projects navigation', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const projects = [
    { key: 'one', name: 'One', canonical_repo: 'owner/one' },
    { key: 'two', name: 'Two', canonical_repo: 'owner/two' },
  ]
  const records = projects.map((project) => record(project.name, {
    repo: project.canonical_repo,
    plan: { repo: project.canonical_repo },
  }))
  const decisions = records.map((rec, index) => ({
    id: `private_review:${rec.id}`,
    kind: 'private_review',
    record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    project: projects[index],
    label: rec.title,
    detail: `Private review needed · ${rec.repo}`,
  }))
  const run = {
    decisions, working: [], recent: [], archive: [],
    projects: projects.map(project => ({
      id: `project:${project.key}`, project, label: project.name, detail: 'Local work',
    })),
    privateAction: { label: 'Prepare all', count: 2, draft: 'Prepare both projects' },
  }
  const html = renderRun(run)

  assert.match(html, /Prepared work/)
  assert.doesNotMatch(html, /Prepare &amp; review|Run full cycle|Inspect changes/)
  assert.match(html, /owner\/one/)
  assert.match(html, /owner\/two/)
  assert.doesNotMatch(html, /Needs you|No decisions waiting/)
  assert.match(html, /co-run-row is-private_review/)
  assert.doesNotMatch(html, /projects represented in this snapshot/)
  assert.doesNotMatch(html, /Browse projects/)
  assert.doesNotMatch(html, /<select|Filter by project|All projects/)
  assert.doesNotMatch(html, /You’re caught up/)
})

test('pending private review proposals do not become agent tasks merely because a project cycle runs', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const rec = record('Private fix')
  const item = {
    id: `private_review:${rec.id}`, kind: 'private_review', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    label: rec.title, detail: `Private fixes needed · ${rec.repo}`,
  }
  const html = renderRun({
    decisions: [item], working: [], recent: [], archive: [], projects: [],
    privateAction: { label: 'Fix', count: 1, draft: 'Fix private work' },
  }, { cycle: { phase: 'running', runtime: { running: true } } })

  assert.match(html, /Prepared work/)
  assert.doesNotMatch(html, /Agent activity|is-review_in_progress|Private run in progress/)
  assert.doesNotMatch(html, /Needs you|No decisions waiting/)
  assert.doesNotMatch(html, /co-run-private-items/)
  assert.match(html, /co-run-row is-private_review/)
})

test('focused batch and private items are inspectable but cannot bypass their one owner', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const rec = record('Reviewed detail', { chat_id: 'source-a' })
  for (const kind of ['publish', 'private_review']) {
    const html = renderFocus({
      id: `${kind}:detail`, kind, record: rec,
      unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
      label: rec.title, detail: rec.repo,
    })
    assert.doesNotMatch(html, />Send PR</)
    assert.match(html, /Open source chat/)
  }
})

test('focused stacks preserve every source chat and never expose an unreviewed send', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const first = record('First', { chat_id: 'chat-a' })
  const second = record('Second', { chat_id: 'chat-b' })
  const html = renderFocus({
    id: 'private_review:stack', kind: 'private_review',
    unit: { type: 'stack', id: 'stack', records: [first, second] },
    record: first, label: 'Related changes', detail: 'Private review needed',
  })

  assert.equal((html.match(/>Open source chat</g) || []).length, 2)
  assert.equal((html.match(/class="co-group-member"/g) || []).length, 2)
  assert.match(html, /Address group in conversation/)
  assert.doesNotMatch(html, />Send PRs?</)
})

test('a focused stack offers its group review only while a member still needs one', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const stack = records => ({
    id: 'private_review:stack', kind: 'private_review',
    unit: { type: 'stack', id: 'stack', records }, record: records[0],
    label: 'Related changes', detail: 'Private review needed',
  })
  const unreviewed = record('Unreviewed', { quality_review: null })
  assert.match(renderFocus(stack([record('Reviewed'), unreviewed]), { onReview: () => ({ ok: true }) }), />Review group</)
  const ready = { byId: { Reviewed: { state: 'ready' }, 'Also reviewed': { state: 'ready' } } }
  assert.doesNotMatch(renderFocus(stack([record('Reviewed'), record('Also reviewed')]), { onReview: () => ({ ok: true }), reviewStatus: ready }), />Review group</)
})

test('focused public-attention stacks expose every affected record and its next action', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const first = record('Review comment', {
    status: 'open', chat_id: 'chat-a', needs_attention: true,
    attention: {
      type: 'human_required', message: 'Choose the response to the reviewer.',
      url: 'https://github.com/mobius-os/mobius/pull/1#issuecomment-1',
    },
  })
  const second = record('Failed checks', {
    status: 'open', chat_id: 'chat-b', needs_attention: true,
    url: 'https://github.com/mobius-os/mobius/pull/2',
    attention: {
      type: 'checks_failed', message: 'The browser test is failing.',
    },
  })
  const html = renderFocus({
    id: 'public_attention:stack', kind: 'public_attention', record: first,
    unit: { type: 'stack', id: 'stack', records: [first, second] },
    label: 'Public follow-up', detail: 'Two records need attention',
  })

  assert.equal((html.match(/class="co-decision-surface"/g) || []).length, 2)
  assert.equal((html.match(/class="co-attention"/g) || []).length, 2)
  assert.equal((html.match(/View activity on GitHub/g) || []).length, 2)
  assert.match(html, /Choose the response to the reviewer/)
  assert.match(html, /The browser test is failing/)
  assert.match(html, /Fix in chat/)
})

test('a stack-owned merged app handoff shows one automatic working state', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const merged = record('Publish app', {
    status: 'merged',
    plan: { after_merge: { action: 'connect_app' } },
  })
  const open = { ...record('Open sibling'), status: 'open' }
  const html = renderFocus({
    id: 'connecting:stack', kind: 'connecting', record: merged,
    unit: { type: 'stack', id: 'stack', records: [merged, open] },
    label: merged.title, detail: 'Published app needs a one-time local link',
  })

  assert.equal((html.match(/Finishing publication/g) || []).length, 1)
  assert.doesNotMatch(html, />Link app<\/button>/)
  assert.doesNotMatch(html, />Send PRs?</)
})

test('durable Ready errors stay visible with only deliberate safe recovery', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const draft = {
    ...record('Ready recovery'), status: 'draft',
    last_ready_error: 'Auto-merge is enabled on this pull request.',
    last_ready_error_code: 'ready_auto_merge_enabled',
    url: 'https://github.com/mobius-os/mobius/pull/1',
  }
  const html = renderFocus({
    id: 'ready_attention:draft', kind: 'ready_attention', record: draft,
    unit: { type: 'record', id: draft.id, record: draft, records: [draft] },
    label: draft.title, detail: draft.last_ready_error,
  })

  assert.match(html, /Auto-merge is enabled/)
  assert.match(html, /I turned off auto-merge\. Mark ready again/)
  assert.match(html, /Open pull request/)
})

test('dismissed work is discoverable in History and retains exact restore links', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun, renderFocus } = await runRenderer()
  const archived = { ...record('Restore me'), status: 'abandoned' }
  const item = {
    id: 'archived:restore', kind: 'archived', record: archived,
    unit: { type: 'record', id: archived.id, record: archived, records: [archived] },
    label: archived.title, detail: 'Dismissed',
  }
  const runHtml = renderRun({
    decisions: [], working: [], recent: [], archive: [item], projects: [],
    privateAction: null,
  })
  const focusHtml = renderFocus(item)

  assert.doesNotMatch(runHtml, /Archived proposals/)
  assert.match(runHtml, /Finished and closed work<\/span><b>1<\/b>/)
  assert.match(runHtml, /Restore me/)
  assert.match(focusHtml, />Restore</)
})

test('the global workspace keeps exact ready batches without duplicating project inventories', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const rec = record('Ready change')
  const publish = { id: 'publish:ready', kind: 'publish', record: rec, unit: { type: 'record', record: rec, records: [rec] }, label: rec.title, detail: rec.repo }
  const run = { decisions: [publish], working: [], recent: [], archive: [] }
  assert.match(renderRun(run, { presentation: 'overview' }), /Review and send/)
  assert.doesNotMatch(renderRun(run, { presentation: 'overview' }), /Needs you|Private proposals · not shared|In progress/)
  assert.equal(renderRun({ decisions: [], working: [], recent: [], archive: [] }, { presentation: 'overview' }), '')
  const focused = renderRun(run, { selectedId: publish.id, projectName: 'Example' })
  assert.match(focused, /co-run-focus-detail/)
  assert.match(focused, /Review and send/) // inventory remains beside the selected task
  assert.match(focused, /Ready change/)
})


test('non-actionable batch records leave no empty overview spacing', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const sent = { ...record('Already sent'), status: 'open' }
  const managedDraft = { ...record('Managed draft'), status: 'draft', submission_mode: 'mobius-bot' }
  const item = (kind, rec) => ({ id: `${kind}:${rec.id}`, kind, record: rec,
    unit: { type: 'record', record: rec, records: [rec] } })
  const html = renderRun({ decisions: [item('publish', sent), item('mark_ready', managedDraft)],
    working: [], recent: [], archive: [] }, { presentation: 'overview' })
  assert.equal(html, '')
})

test('seven open issues are shared inventory, never seven agent tasks', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const issues = Array.from({ length: 7 }, (_, index) => {
    const rec = record(`Open issue ${index + 1}`, { type: 'issue', status: 'open', number: index + 1 })
    return { id: rec.id, kind: 'public', record: rec, label: rec.title, detail: `Public · ${rec.repo}` }
  })
  const html = renderRun({ working: issues }, { cycle: { phase: 'paused' } })
  assert.match(html, /aria-label="Issues"/)
  assert.doesNotMatch(html, /Agent activity|In progress|co-working-icon/)
  for (let index = 1; index <= 7; index++) assert.match(html, new RegExp(`Open issue ${index}`))
})

test('private proposals and PR revisions share an actionable prepared-work home', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const records = [record('New private proposal'), record('Private revision', { plan: { action: 'pr_update' } }),
    record('Public PR follow-up', { status: 'open' })]
  const html = renderRun({ decisions: records.map(rec => ({ id: rec.id, kind: 'private_review', record: rec, label: rec.title, detail: rec.repo })) })
  assert.match(html, /Prepared work/)
  assert.equal((html.match(/co-run-row-action/g) || []).length, 3)
  assert.equal((html.match(/<strong>Private revision<\/strong>/g) || []).length, 1)
  assert.equal((html.match(/<strong>Public PR follow-up<\/strong>/g) || []).length, 1)
})

test('history names outcomes honestly without an archive or success-only implication', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const outcome = status => ({ id: status, kind: 'recent', record: record(status, { status }), label: status, detail: status })
  const html = renderRun({ recent: ['merged', 'closed', 'local', 'superseded'].map(outcome), archive: [outcome('abandoned')] })
  assert.match(html, /Finished and closed work<\/span><b>5<\/b>/)
  assert.doesNotMatch(html, /Archived proposals/)
  assert.match(html, /abandoned/)
  assert.match(html, /Not all were merged/)
  assert.doesNotMatch(html, /Done recently|Recent outcomes/)
})

test('only recorded work activity moves; queued agent follow-up stays still', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const rec = record('Queued public repair', { status: 'open', autopilot: { enabled: true, state: 'idle' } })
  const item = { id: rec.id, kind: 'autopilot', record: rec, label: rec.title, detail: 'Agent handling public follow-up' }
  const queued = renderRun({ working: [item] })
  assert.match(queued, /Agent follow-up queued/)
  assert.doesNotMatch(queued, /co-working-icon|Agent handling public follow-up/)
  const responding = renderRun({ working: [{ ...item, record: { ...rec, autopilot: { enabled: true, state: 'responding' } } }] })
  assert.match(responding, /co-working-icon/)
})
