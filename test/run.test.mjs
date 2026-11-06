import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildContributionRun,
  contributionTitle,
  findRunItemByRecord,
  runUnitRecords,
} from '../run.js'

const HEAD = 'a'.repeat(40)

test('pull request numbers lead every contribution identity exactly once', () => {
  assert.equal(contributionTitle({ type: 'pr', number: 1124, title: 'Keep pinned drawer' }), '#1124 Keep pinned drawer')
  assert.equal(contributionTitle({ type: 'pr', number: 1124, title: '#1124 Keep pinned drawer' }), '#1124 Keep pinned drawer')
  assert.equal(contributionTitle({ type: 'issue', number: 1124, title: 'Keep pinned drawer' }), 'Keep pinned drawer')
  assert.equal(contributionTitle({ plan: { action: 'pr_update', pr_number: 1124, title: 'Keep pinned drawer' } }), '#1124 Keep pinned drawer')
})

function prepared(id, extra = {}) {
  const { plan: planExtra = {}, quality_review: reviewExtra = {}, ...rest } = extra
  return {
    id,
    type: 'pr',
    repo: 'mobius-os/mobius',
    status: 'prepared',
    title: id,
    updated_at: `2026-08-29T00:00:0${id.length % 9}Z`,
    plan: {
      action: 'pr',
      repo: 'mobius-os/mobius',
      title: id,
      branch: `fix/${id}`,
      head_sha: HEAD,
      ...planExtra,
    },
    quality_review: {
      state: 'all_clear',
      reviewed_head_sha: HEAD,
      ...reviewExtra,
    },
    ...rest,
  }
}

function readyStatus(...ids) {
  return { byId: Object.fromEntries(ids.map(id => [id, { state: 'ready' }])) }
}

test('one mixed snapshot produces one nonduplicating decision and working stream', () => {
  const records = [
    prepared('publish'),
    prepared('review', { quality_review: { state: 'needed' } }),
    { id: 'public', type: 'pr', repo: 'mobius-os/mobius', status: 'open', title: 'public' },
    { id: 'request', type: 'issue', repo: 'mobius-os/mobius', status: 'prepared', title: 'request' },
    { id: 'done', type: 'pr', repo: 'mobius-os/mobius', status: 'merged', title: 'done' },
  ]
  const run = buildContributionRun({ records, reviewStatus: readyStatus('publish', 'review') })

  assert.deepEqual(run.decisions.map(item => item.kind), [
    'publish', 'private_review', 'request',
  ])
  assert.deepEqual(run.working.map(item => item.kind), ['public'])
  assert.equal(run.recent.length, 1)
  const represented = [
    ...run.decisions, ...run.working, ...run.recent,
  ].flatMap(runUnitRecords).map(record => record.id)
  assert.equal(new Set(represented).size, represented.length)
})

test('a complete reviewed stack remains one publish decision in technical order', () => {
  const common = { id: 'stack-one', name: 'Stack one', total: 2 }
  const first = prepared('layer-1', {
    plan: {
      branch: 'stack/stack-one/1-first',
      stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' },
    },
  })
  const second = prepared('layer-2', {
    plan: {
      branch: 'stack/stack-one/2-second',
      base_sha: HEAD,
      stack: {
        ...common, position: 2, base_branch: 'stack/stack-one/1-first',
        parent_record_id: 'layer-1',
      },
    },
  })
  const run = buildContributionRun({
    records: [second, first],
    reviewStatus: readyStatus('layer-1', 'layer-2'),
  })

  assert.equal(run.decisions.length, 1)
  assert.equal(run.decisions[0].kind, 'publish')
  assert.equal(run.decisions[0].unit.type, 'stack')
  assert.deepEqual(runUnitRecords(run.decisions[0]).map(record => record.id), [
    'layer-1', 'layer-2',
  ])
})

test('an incomplete or malformed reviewed stack never enters a public batch', () => {
  const incomplete = prepared('layer-only', {
    plan: {
      stack: {
        id: 'incomplete', name: 'Incomplete', position: 1, total: 2,
        base_branch: 'main', parent_record_id: '',
      },
    },
  })
  const malformed = prepared('malformed', {
    plan: {
      stack: {
        id: 'malformed', name: 'Malformed', position: 3, total: 2,
        base_branch: 'main', parent_record_id: '',
      },
    },
  })
  const run = buildContributionRun({
    records: [incomplete, malformed],
    reviewStatus: readyStatus('layer-only', 'malformed'),
  })

  assert.equal(run.decisions.some(item => item.kind === 'publish'), false)
  assert.deepEqual(run.decisions.map(item => item.kind), [
    'private_review', 'private_review',
  ])
  assert.match(run.decisions[0].detail, /incomplete/i)
  assert.ok(run.privateAction)
  assert.match(run.privateAction.draft, /incomplete/i)
})

test('a partial-public stack has one owning publish unit and no duplicate parent', () => {
  const common = { id: 'partial', name: 'Partial stack', total: 2 }
  const parent = {
    ...prepared('parent'), status: 'open',
    plan: {
      ...prepared('parent').plan,
      branch: 'stack/partial/1-parent',
      stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' },
    },
  }
  const child = prepared('child', {
    plan: {
      branch: 'stack/partial/2-child',
      base_sha: HEAD,
      stack: {
        ...common, position: 2, base_branch: 'stack/partial/1-parent',
        parent_record_id: 'parent',
      },
    },
  })
  const run = buildContributionRun({
    records: [parent, child],
    reviewStatus: readyStatus('child'),
  })

  assert.deepEqual(run.decisions.map(item => item.kind), ['publish'])
  assert.equal(run.working.length, 0)
  const represented = [...run.decisions, ...run.working]
    .flatMap(runUnitRecords).map(record => record.id)
  assert.deepEqual(represented, ['parent', 'child'])
})

test('one stack produces one owner decision when public and private checks flag it', () => {
  const common = { id: 'attention-stack', name: 'Attention stack', total: 2 }
  const parent = {
    ...prepared('attention-parent'), status: 'open', needs_attention: true,
    attention: { type: 'human_required', message: 'Choose the public response.' },
    plan: {
      ...prepared('attention-parent').plan,
      branch: 'stack/attention-stack/1-parent',
      stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' },
    },
  }
  const child = prepared('attention-child', {
    quality_review: { state: 'changes_needed' },
    plan: {
      branch: 'stack/attention-stack/2-child',
      base_sha: HEAD,
      stack: {
        ...common, position: 2, base_branch: 'stack/attention-stack/1-parent',
        parent_record_id: parent.id,
      },
    },
  })

  const run = buildContributionRun({ records: [parent, child] })

  assert.deepEqual(run.decisions.map(item => item.kind), ['public_attention'])
  assert.deepEqual(runUnitRecords(run.decisions[0]).map(record => record.id), [
    parent.id, child.id,
  ])
})

test('an active prepared stack owns every known terminal or dismissed sibling', () => {
  for (const terminalStatus of ['closed', 'superseded', 'abandoned']) {
    const common = { id: `repair-${terminalStatus}`, name: 'Repair stack', total: 2 }
    const parent = prepared(`parent-${terminalStatus}`, {
      plan: {
        branch: `stack/repair-${terminalStatus}/1-parent`,
        stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' },
      },
    })
    const child = {
      id: `child-${terminalStatus}`, type: 'pr', repo: 'mobius-os/mobius',
      status: terminalStatus, title: 'Terminal child',
      plan: {
        action: 'pr', repo: 'mobius-os/mobius', head_sha: HEAD,
        branch: `stack/repair-${terminalStatus}/2-child`, base_sha: HEAD,
        stack: {
          ...common, position: 2,
          base_branch: `stack/repair-${terminalStatus}/1-parent`,
          parent_record_id: parent.id,
        },
      },
    }
    const run = buildContributionRun({
      records: [parent, child], reviewStatus: readyStatus(parent.id),
    })
    assert.deepEqual(run.decisions.map(item => item.kind), ['private_review'])
    assert.deepEqual(runUnitRecords(run.decisions[0]).map(record => record.id), [
      parent.id, child.id,
    ])
    assert.equal(run.recent.length, 0)
    assert.equal(run.archive.length, 0)
  }
})

test('a live public stack owns every known terminal or dismissed sibling', () => {
  for (const terminalStatus of ['closed', 'superseded', 'abandoned']) {
    const common = { id: `live-${terminalStatus}`, name: 'Live stack', total: 2 }
    const parent = {
      ...prepared(`live-parent-${terminalStatus}`), status: 'open',
      plan: {
        ...prepared(`live-parent-${terminalStatus}`).plan,
        branch: `stack/live-${terminalStatus}/1-parent`,
        stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' },
      },
    }
    const child = {
      id: `live-child-${terminalStatus}`, type: 'pr', repo: 'mobius-os/mobius',
      status: terminalStatus, title: 'Terminal child',
      plan: {
        action: 'pr', repo: 'mobius-os/mobius', head_sha: HEAD,
        branch: `stack/live-${terminalStatus}/2-child`, base_sha: HEAD,
        stack: {
          ...common, position: 2,
          base_branch: `stack/live-${terminalStatus}/1-parent`,
          parent_record_id: parent.id,
        },
      },
    }
    const run = buildContributionRun({ records: [parent, child] })
    assert.deepEqual(run.working.map(item => item.kind), ['public'])
    assert.deepEqual(runUnitRecords(run.working[0]).map(record => record.id), [
      parent.id, child.id,
    ])
    assert.equal(run.recent.length, 0)
    assert.equal(run.archive.length, 0)
  }
})

test('malformed additive stack metadata never makes a public PR disappear', () => {
  const malformed = {
    id: 'malformed-public', type: 'pr', repo: 'mobius-os/mobius',
    status: 'open', title: 'Malformed public record',
    plan: {
      action: 'pr', repo: 'mobius-os/mobius',
      stack: {
        id: 'broken', position: 3, total: 2,
        base_branch: 'main', parent_record_id: '',
      },
    },
  }
  const run = buildContributionRun({ records: [malformed] })

  assert.deepEqual(run.working.map(item => item.kind), ['public'])
  assert.deepEqual(runUnitRecords(run.working[0]).map(record => record.id), [malformed.id])
})

test('healthy autopilot work stays quiet while human escalation becomes a decision', () => {
  const automated = {
    id: 'auto', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
    title: 'auto', needs_attention: true,
    attention: { type: 'checks_failed' },
    autopilot: { enabled: true, state: 'responding' },
  }
  const human = {
    id: 'human', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
    title: 'human', needs_attention: true,
    attention: { type: 'human_required', message: 'Choose the public response.' },
    autopilot: { enabled: true, state: 'idle' },
  }
  const run = buildContributionRun({ records: [automated, human] })

  assert.equal(run.working.find(item => item.record?.id === 'auto')?.kind, 'autopilot')
  assert.equal(run.decisions.find(item => item.record?.id === 'human')?.kind, 'public_attention')
  assert.equal(run.privateAction, null)
})

test('agent-owned public follow-up never starts a duplicate private run', () => {
  const record = {
    id: 'auto', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
    title: 'auto', needs_attention: true,
    attention: { type: 'checks_failed' },
    autopilot: { enabled: true, state: 'responding' },
  }
  const run = buildContributionRun({ records: [record] })

  assert.equal(run.working[0].kind, 'autopilot')
  assert.equal(run.privateAction, null)
})

test('agent-handleable attention without autopilot belongs to the one private run', () => {
  const open = {
    id: 'ungranted-open', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
    title: 'Open follow-up', needs_attention: true,
    attention: { type: 'github_activity', message: 'A reviewer left a new comment.' },
  }
  const draft = {
    id: 'ungranted-draft', type: 'pr', repo: 'owner/project', status: 'draft',
    title: 'Draft follow-up', needs_attention: true,
    attention: { type: 'checks_failed', message: 'A required check failed.' },
  }
  const run = buildContributionRun({ records: [open, draft] })

  assert.deepEqual(run.decisions.map(item => item.kind), [
    'private_review', 'private_review',
  ])
  assert.equal(run.decisions.some(item => item.kind === 'public_attention'), false)
  assert.equal(run.decisions.some(item => item.kind === 'mark_ready'), false)
  assert.ok(run.privateAction)
  assert.match(run.privateAction.draft, /reviewer left a new comment/i)
  assert.match(run.privateAction.draft, /required check failed/i)
})

test('human-required prepared attention stays in Needs you and outside private work', () => {
  const record = prepared('owner-choice', {
    needs_attention: true,
    attention: {
      type: 'human_required',
      message: 'Choose whether this public behavior is acceptable.',
    },
  })
  const run = buildContributionRun({
    records: [record], reviewStatus: readyStatus(record.id),
  })

  assert.deepEqual(run.decisions.map(item => item.kind), ['public_attention'])
  assert.equal(run.decisions[0].record.id, record.id)
  assert.equal(run.privateAction, null)
})

test('reviewed work whose source check could not run asks the owner instead of a review', () => {
  const run = buildContributionRun({
    records: [prepared('reconnect'), prepared('transient'), prepared('unchecked')],
    reviewStatus: { byId: {
      reconnect: { state: 'unavailable', code: 'github_reconnect' },
      transient: { state: 'unavailable', code: 'review_unavailable' },
    } },
  })

  const byId = Object.fromEntries(run.decisions.map(item => [item.record.id, item]))
  assert.equal(byId.reconnect.kind, 'check_attention')
  assert.equal(byId.reconnect.reconnect, true)
  assert.match(byId.reconnect.message, /^Reconnect GitHub in Möbius Settings → Accounts/)
  assert.match(byId.reconnect.detail, /^Reconnect GitHub to send · /)
  assert.equal(byId.transient.kind, 'check_attention')
  assert.equal(byId.transient.reconnect, false)
  assert.match(byId.transient.message, /could not be checked just now/)
  // A record with no row in a successful check is still unknown work.
  assert.equal(byId.unchecked.kind, 'private_review')
  assert.equal(run.privateAction.count, 1, 'only the unchecked record is private work')
})

test('a failed status request never turns reviewed work into review work', () => {
  const run = buildContributionRun({
    records: [prepared('reviewed')],
    reviewStatus: { state: 'unavailable', byId: {} },
  })

  assert.deepEqual(run.decisions.map(item => item.kind), ['check_attention'])
  assert.match(run.decisions[0].message, /could not be checked just now/)
  assert.equal(run.privateAction, null)
})

test('incoming-only project is alignment work, never preparation', () => {
  const run = buildContributionRun({ projects: [{
    key: 'demo', name: 'Demo', canonical_repo: 'owner/demo',
    incomingFiles: 4, outgoingFiles: 0, contributions: [],
  }] })

  assert.equal(run.projects[0].kind, 'align')
  assert.notEqual(run.projects[0].kind, 'prepare')
})

test('project kinds preserve candidate, ambiguous, conflict, and active-review work', () => {
  const base = {
    kind: 'platform', available: true, semanticAvailable: true,
    workingFiles: 0, localFiles: 1, compatibleFiles: 0, conflictFiles: 0,
    incomingFiles: 0, outgoingFiles: 1, contributions: [], origin: { sha: 'shared' },
  }
  const run = buildContributionRun({ projects: [
    { ...base, key: 'candidate', name: 'Candidate' },
    { ...base, key: 'both', name: 'Both', incomingFiles: 1 },
    { ...base, key: 'conflict', name: 'Conflict', conflictFiles: 1 },
    { ...base, key: 'review', name: 'Review', contributions: [{ id: 'pr' }] },
  ] })

  assert.deepEqual(Object.fromEntries(run.projects.map(row => [row.project.key, row.kind])), {
    candidate: 'prepare',
    both: 'sort',
    conflict: 'sort',
    review: 'sort',
  })
})

test('global run rows retain their owning project identity', () => {
  const project = {
    key: 'demo', kind: 'external', name: 'Demo', canonical_repo: 'owner/demo',
    available: false, state: 'unavailable', contributions: [],
    incomingFiles: 0, outgoingFiles: 0,
  }
  const record = prepared('mapped', {
    repo: 'owner/demo',
    plan: { repo: 'owner/demo' },
  })
  const run = buildContributionRun({
    records: [record],
    reviewStatus: readyStatus(record.id),
    projects: [project],
  })

  assert.equal(run.decisions[0].project, project)
  assert.equal(run.projects[0].project, project)
})

test('merged app handoff finishes automatically in Working', () => {
  const record = {
    id: 'app', type: 'pr', repo: 'mobius-os/app-demo', status: 'merged',
    title: 'Demo app',
    plan: { after_merge: { action: 'connect_app' } },
  }
  const run = buildContributionRun({ records: [record] })

  assert.equal(run.decisions.length, 0)
  assert.equal(run.working[0].kind, 'connecting')
  assert.equal(run.recent.length, 0)
})

test('an active stack owns its merged app connection handoff exactly once', () => {
  const common = { id: 'connect-stack', name: 'Connect stack', total: 2 }
  const merged = {
    id: 'connect-parent', type: 'pr', repo: 'mobius-os/app-demo',
    status: 'merged', title: 'Connect app',
    plan: {
      action: 'pr', repo: 'mobius-os/app-demo', branch: 'stack/connect-stack/1-parent',
      after_merge: { action: 'connect_app' },
      stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' },
    },
  }
  const open = {
    id: 'connect-child', type: 'pr', repo: 'mobius-os/app-demo',
    status: 'open', title: 'Open child',
    plan: {
      action: 'pr', repo: 'mobius-os/app-demo', branch: 'stack/connect-stack/2-child',
      stack: {
        ...common, position: 2, base_branch: 'stack/connect-stack/1-parent',
        parent_record_id: merged.id,
      },
    },
  }
  const run = buildContributionRun({ records: [merged, open] })

  assert.equal(run.decisions.length, 0)
  assert.deepEqual(run.working.map(item => item.kind), ['connecting'])
  assert.equal(run.recent.length, 0)
  assert.deepEqual(runUnitRecords(run.working[0]).map(record => record.id), [
    merged.id, open.id,
  ])
})

test('personal drafts are decisions while relay drafts remain honest work in motion', () => {
  const personal = { id: 'personal', type: 'pr', repo: 'owner/repo', status: 'draft', title: 'Personal' }
  const relay = {
    id: 'relay', type: 'pr', repo: 'owner/repo', status: 'draft', title: 'Relay',
    submission_mode: 'mobius-bot',
  }
  const run = buildContributionRun({ records: [personal, relay] })

  assert.equal(run.decisions.find(item => item.record?.id === 'personal')?.kind, 'mark_ready')
  assert.equal(run.working.find(item => item.record?.id === 'relay')?.kind, 'public')
})

test('ready reconciliation outranks attention and durable failure is not a clean retry', () => {
  const inFlight = {
    id: 'in-flight', type: 'pr', repo: 'owner/repo', status: 'draft',
    title: 'In flight', needs_attention: true, attention: { type: 'human_required' },
    readying: { expected_head_sha: HEAD },
  }
  const failed = {
    id: 'failed', type: 'pr', repo: 'owner/repo', status: 'draft',
    title: 'Failed', last_ready_error: 'Disable auto-merge first.',
    last_ready_error_code: 'ready_auto_merge_enabled',
  }
  const run = buildContributionRun({ records: [inFlight, failed] })

  assert.equal(run.working.find(item => item.record?.id === 'in-flight')?.kind, 'publishing')
  assert.equal(run.decisions.find(item => item.record?.id === 'failed')?.kind, 'ready_attention')
  assert.equal(run.decisions.some(item => item.kind === 'mark_ready'), false)
})

test('a durable submit failure returns to the one private run before any retry', () => {
  const failed = prepared('failed-send', { last_submit_error: 'The pushed head was not confirmed.' })
  const run = buildContributionRun({
    records: [failed], reviewStatus: readyStatus('failed-send'),
  })

  assert.deepEqual(run.decisions.map(item => item.kind), ['private_review'])
  assert.equal(run.decisions.some(item => item.kind === 'publish'), false)
  assert.ok(run.privateAction)
  assert.match(run.privateAction.draft, /pushed head was not confirmed/i)
})

test('durable private repair outranks a stale responding-autopilot mirror', () => {
  const broken = prepared('autopilot-repair', {
    last_submit_error: 'Merge conflict',
    needs_attention: true,
    attention: { type: 'changes_requested' },
    autopilot: { enabled: true, state: 'responding' },
  })
  const run = buildContributionRun({
    records: [broken], reviewStatus: readyStatus(broken.id),
  })

  assert.deepEqual(run.decisions.map(item => item.kind), ['private_review'])
  assert.ok(run.privateAction)
  assert.match(run.privateAction.draft, /Merge conflict/)
})

test('record intent finds the complete current stack wherever it lives', () => {
  const common = { id: 'draft-stack', name: 'Draft stack', total: 2 }
  const first = {
    id: 'draft-1', type: 'pr', repo: 'owner/repo', status: 'draft', title: 'First',
    plan: { stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' } },
  }
  const second = {
    id: 'draft-2', type: 'pr', repo: 'owner/repo', status: 'draft', title: 'Second',
    plan: { stack: { ...common, position: 2, base_branch: 'stack/one', parent_record_id: 'draft-1' } },
  }
  const run = buildContributionRun({ records: [first, second] })
  const found = findRunItemByRecord(run, 'draft-2')

  assert.equal(found.section, 'decisions')
  assert.equal(found.item.kind, 'mark_ready')
  assert.deepEqual(runUnitRecords(found.item).map(record => record.id), ['draft-1', 'draft-2'])
})

test('run revision is stable for ordering and changes with represented work', () => {
  const first = prepared('first')
  const second = prepared('second')
  const options = { reviewStatus: readyStatus('first', 'second') }
  const one = buildContributionRun({ ...options, records: [first, second] })
  const reordered = buildContributionRun({ ...options, records: [second, first] })
  const changed = buildContributionRun({
    ...options,
    records: [{ ...first, status: 'open' }, second],
  })

  assert.equal(one.revision, reordered.revision)
  assert.notEqual(one.revision, changed.revision)

  const needsRefresh = buildContributionRun({
    records: [first], reviewStatus: { byId: { first: { state: 'needs_refresh' } } },
  })
  const ready = buildContributionRun({
    records: [first], reviewStatus: readyStatus('first'),
  })
  const withIncoming = buildContributionRun({
    records: [], incomingReviews: [{
      title: 'Review me', number: 7, url: 'https://github.com/owner/repo/pull/7',
      repository: { nameWithOwner: 'owner/repo' },
    }],
  })
  const empty = buildContributionRun()
  assert.notEqual(needsRefresh.revision, ready.revision)
  assert.notEqual(withIncoming.revision, empty.revision)
})

test('run revision changes when a represented stack sibling becomes restorable', () => {
  const common = { id: 'revision-stack', name: 'Revision stack', total: 2 }
  const parent = prepared('revision-parent', {
    plan: {
      branch: 'stack/revision-stack/1-parent',
      stack: { ...common, position: 1, base_branch: 'main', parent_record_id: '' },
    },
  })
  const sibling = {
    id: 'revision-child', type: 'pr', repo: 'mobius-os/mobius',
    status: 'closed', title: 'Revision child',
    plan: {
      action: 'pr', repo: 'mobius-os/mobius', head_sha: HEAD,
      branch: 'stack/revision-stack/2-child', base_sha: HEAD,
      stack: {
        ...common, position: 2,
        base_branch: 'stack/revision-stack/1-parent',
        parent_record_id: parent.id,
      },
    },
  }
  const closed = buildContributionRun({
    records: [parent, sibling], reviewStatus: readyStatus(parent.id),
  })
  const abandoned = buildContributionRun({
    records: [parent, { ...sibling, status: 'abandoned' }],
    reviewStatus: readyStatus(parent.id),
  })

  assert.notEqual(closed.revision, abandoned.revision)
})

test('recent outcomes are bounded newest first', () => {
  const records = Array.from({ length: 5 }, (_, index) => ({
    id: `done-${index}`, type: 'pr', repo: 'owner/repo', status: 'merged',
    title: `Done ${index}`, updated_at: `2026-08-29T00:00:0${index}Z`,
  }))
  const run = buildContributionRun({ records, recentLimit: 2 })

  assert.deepEqual(run.recent.map(item => item.record.id), ['done-4', 'done-3'])
})

test('settled stacks stay atomic in Recent and the limit counts units', () => {
  const common = { id: 'settled-stack', name: 'Settled stack', total: 2 }
  const records = [1, 2].map(position => ({
    id: `done-${position}`, type: 'pr', repo: 'owner/repo', status: 'merged',
    title: `Done ${position}`, updated_at: `2026-08-29T00:00:0${position}Z`,
    plan: { stack: {
      ...common, position, base_branch: position === 1 ? 'main' : 'stack/one',
      parent_record_id: position === 1 ? '' : 'done-1',
    } },
  }))
  const run = buildContributionRun({ records, recentLimit: 1 })

  assert.equal(run.recent.length, 1)
  assert.deepEqual(runUnitRecords(run.recent[0]).map(record => record.id), ['done-1', 'done-2'])
  assert.match(run.recent[0].detail, /Accepted/)
})

test('mixed settled stacks never inherit a misleading merged outcome from the newest layer', () => {
  const common = { id: 'mixed-stack', name: 'Mixed stack', total: 2 }
  const records = [
    { id: 'closed-parent', status: 'closed', updated_at: '2026-08-29T00:00:01Z' },
    { id: 'merged-child', status: 'merged', updated_at: '2026-08-29T00:00:02Z' },
  ].map((record, index) => ({
    ...record,
    type: 'pr', repo: 'owner/repo', title: `Layer ${index + 1}`,
    plan: { stack: {
      ...common,
      position: index + 1,
      base_branch: index === 0 ? 'main' : 'stack/mixed/parent',
      parent_record_id: index === 0 ? '' : 'closed-parent',
    } },
  }))

  const run = buildContributionRun({ records })
  assert.equal(run.recent.length, 1)
  assert.match(run.recent[0].detail, /^Closed\b/)
  assert.doesNotMatch(run.recent[0].detail, /merged/i)
})

test('a terminal sibling owned by a live public stack never repeats in Recent', () => {
  const common = { id: 'live-stack', name: 'Live stack', total: 2 }
  const parent = {
    id: 'merged-parent', type: 'pr', repo: 'owner/repo', status: 'merged',
    title: 'Merged parent', updated_at: '2026-08-29T00:00:01Z',
    plan: { action: 'pr', repo: 'owner/repo', branch: 'stack/live-stack/1-parent', stack: {
      ...common, position: 1, base_branch: 'main', parent_record_id: '',
    } },
  }
  const child = {
    id: 'open-child', type: 'pr', repo: 'owner/repo', status: 'open',
    title: 'Open child', updated_at: '2026-08-29T00:00:02Z',
    plan: { action: 'pr', repo: 'owner/repo', branch: 'stack/live-stack/2-child', stack: {
      ...common, position: 2, base_branch: 'stack/live-stack/1-parent',
      parent_record_id: 'merged-parent',
    } },
  }
  const run = buildContributionRun({ records: [parent, child] })

  assert.equal(run.working.length, 1)
  assert.deepEqual(runUnitRecords(run.working[0]).map(record => record.id), [
    'merged-parent', 'open-child',
  ])
  assert.equal(run.recent.length, 0)
})

test('dismissed work remains reachable outside the cosmetic Recent bound', () => {
  const merged = Array.from({ length: 13 }, (_, index) => ({
    id: `merged-${index}`, type: 'pr', repo: 'owner/repo', status: 'merged',
    title: `Merged ${index}`, updated_at: `2026-08-29T00:00:${String(index).padStart(2, '0')}Z`,
  }))
  const abandoned = {
    id: 'restore-me', type: 'pr', repo: 'owner/repo', status: 'abandoned',
    title: 'Restore me', updated_at: '2026-08-01T00:00:00Z',
  }
  const run = buildContributionRun({ records: [...merged, abandoned], recentLimit: 12 })

  assert.equal(run.recent.length, 12)
  assert.equal(run.archive.length, 1)
  assert.equal(findRunItemByRecord(run, 'restore-me')?.section, 'archive')
})
