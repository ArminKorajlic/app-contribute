import test from 'node:test'
import assert from 'node:assert/strict'

import {
  proposalSourceCommits,
  actionableSourceProjects,
  attachSourceProjects,
  projectDetailSummary,
  projectCycleIdentity,
  projectForks,
  projectIconUrl,
  projectMatchesFilter,
  projectNeedsPreparation,
  projectNeedsSorting,
  projectOverview,
  projectPreparationState,
  projectReadyToPrepare,
  projectRowFacts,
  projectSourceState,
  projectStatus,
  projectWorkRevision,
  sourcePathRelationship,
  localChangeLabel,
  localChangeSummary,
  projectIsQuiet,
} from '../source-map.js'

test('project conversation identity follows durable project identity, not reusable app ids', () => {
  assert.equal(projectCycleIdentity({ kind: 'platform', key: 'platform' }), 'platform')
  assert.equal(projectCycleIdentity({
    kind: 'app', key: 'app:7', slug: 'Notes', canonical_repo: 'mobius-os/app-notes',
  }), 'repo:mobius-os/app-notes')
  assert.equal(projectCycleIdentity({
    kind: 'app', key: 'app:99', slug: 'Renamed-Notes', canonical_repo: 'MOBIUS-OS/APP-NOTES',
  }), 'repo:mobius-os/app-notes', 'reinstalling the same package keeps its project shortcut')
  assert.notEqual(
    projectCycleIdentity({ kind: 'app', key: 'app:7', slug: 'Notes', canonical_repo: 'owner/first' }),
    projectCycleIdentity({ kind: 'app', key: 'app:7', slug: 'Notes', canonical_repo: 'owner/second' }),
    'a reused numeric row cannot inherit another app shortcut',
  )
  assert.equal(
    projectCycleIdentity({ kind: 'app', key: 'app:8', slug: 'Scratchpad' }),
    'app:scratchpad',
  )
  assert.equal(projectCycleIdentity({
    kind: 'external', key: 'external:Owner/Repo', canonical_repo: 'Owner/Repo',
  }), 'repo:owner/repo')
})

test('project icons reuse canonical app and platform artwork', () => {
  assert.equal(projectIconUrl({ kind: 'platform', key: 'platform' }), '/moebius.png')
  assert.equal(projectIconUrl({ kind: 'app', key: 'app:77' }), '/api/apps/77/icon?size=64')
  assert.equal(projectIconUrl({ kind: 'external', key: 'external:owner/repo' }), '')
  assert.equal(projectIconUrl({ kind: 'app', key: 'app:not-an-id' }), '')
})

const snapshot = {
  platform: {
    key: 'platform', kind: 'platform', name: 'Möbius', available: true,
    canonical_repo: 'mobius-os/mobius', state: 'diverged', ahead: 23, behind: 2,
    head_sha: 'aaaaaaaa', base_sha: 'bbbbbbbb',
    tree: { available: true, files: 4, insertions: 12, deletions: 3 },
    working: { available: true, files: 0 },
  },
  apps: [{
    key: 'app:80', kind: 'app', name: 'Contribute', available: true,
    canonical_repo: 'mobius-os/app-contribute', state: 'aligned', ahead: 1, behind: 0,
    head_sha: 'cccccccc', base_sha: 'dddddddd',
    tree: { available: true, files: 0, insertions: 0, deletions: 0 },
    working: { available: true, files: 0 },
  }],
}

function platform() {
  return {
    key: 'platform',
    kind: 'platform',
    name: 'Möbius',
    canonical_repo: 'mobius-os/mobius',
    available: true,
    state: 'aligned',
    branch: 'main',
    working: { files: 0, paths: [] },
    tree: { available: true, files: 0, paths: [] },
    origin: { local_tree: { available: true, files: 0, paths: [] } },
  }
}

function installedApp(overrides = {}) {
  return {
    key: 'app:7',
    kind: 'app',
    name: 'Notes',
    canonical_repo: 'mobius-apps/notes',
    available: true,
    state: 'working',
    branch: 'main',
    working: { files: 1, paths: [{ path: 'index.jsx', group: 'untracked' }] },
    tree: { available: true, files: 0, paths: [] },
    reconciliation: { available: true },
    origin: {},
    ...overrides,
  }
}

test('working drafts stay visible without becoming changes or attention', () => {
  const [mobius, notes] = attachSourceProjects(
    { platform: platform(), apps: [installedApp()] },
    [],
  )

  assert.equal(mobius.key, 'platform')
  assert.equal(notes.key, 'app:7')
  assert.equal(notes.attention, false)
  assert.deepEqual(projectStatus(notes), { label: 'Editing', tone: 'quiet' })
  assert.equal(projectMatchesFilter(notes, 'editing'), true)
  assert.equal(projectMatchesFilter(notes, 'changed'), false)
  assert.deepEqual(actionableSourceProjects([notes]), [])
})

test('projects count active pull requests and issues without treating issues as source coverage', () => {
  const [mobius] = attachSourceProjects({ platform: platform(), apps: [] }, [
    {
      id: 'pr-1', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
      plan: { action: 'pr', repo: 'mobius-os/mobius' },
    },
    {
      id: 'issue-1', type: 'issue', repo: 'mobius-os/mobius', status: 'prepared',
      plan: { action: 'issue', repo: 'mobius-os/mobius' },
    },
  ])

  assert.deepEqual(mobius.contributionCounts, {
    pullRequests: 1,
    issues: 1,
    ready: 0,
    open: 1,
  })
  assert.deepEqual(mobius.contributions.map((record) => record.id), ['pr-1'])
  assert.deepEqual(mobius.issues.map((record) => record.id), ['issue-1'])
})

test('a locally built app with only new files is kept as real source work', () => {
  const projects = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({ canonical_repo: null })],
  }, [])
  const local = projects.find((project) => project.key === 'app:7')

  assert.ok(local)
  assert.equal(local.builtHere, true)
  assert.equal(projectMatchesFilter(local, 'editing'), true)
  assert.equal(projectMatchesFilter(local, 'changed'), false)
})

test('committed differences remain visible while another file is being edited', () => {
  const notes = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({
      tree: {
        available: true,
        files: 1,
        authored_files: 1,
        paths: [{ path: 'api.js', group: 'authored' }],
      },
      reconciliation: {
        available: true,
        local_only_count: 1,
        local_only_paths: ['api.js'],
      },
    })],
  }, []).find((project) => project.key === 'app:7')

  assert.deepEqual(projectStatus(notes), { label: 'Local changes', tone: 'accent' })
  assert.deepEqual(actionableSourceProjects([notes]), [notes])
  assert.equal(projectNeedsPreparation(notes), true)
  assert.equal(projectMatchesFilter(notes, 'editing'), true)
  assert.equal(projectMatchesFilter(notes, 'changed'), true)
})

test('shared changes remain decision-bearing in the inbox overview', () => {
  const incoming = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({
      state: 'incoming',
      working: { files: 0, paths: [] },
      reconciliation: {
        available: true,
        new_upstream_count: 2,
        new_upstream_paths: ['api.js', 'index.jsx'],
      },
    })],
  }, []).find((project) => project.key === 'app:7')

  assert.equal(incoming.attention, true)
  assert.equal(projectMatchesFilter(incoming, 'changed'), true)
  assert.deepEqual(actionableSourceProjects([incoming]), [incoming])
  assert.equal(projectNeedsPreparation(incoming), false)
})

test('joins only active contribution records to their source project', () => {
  const records = [
    { id: 'ready', type: 'pr', repo: 'MOBIUS-OS/MOBIUS', status: 'prepared', plan: {} },
    { id: 'landing', type: 'pr', repo: 'mobius-os/mobius', status: 'landing', plan: {} },
    { id: 'open', type: 'pr', repo: 'mobius-os/app-contribute', status: 'open', plan: {} },
    { id: 'done', type: 'pr', repo: 'mobius-os/mobius', status: 'merged', plan: {} },
    { id: 'issue', type: 'issue', repo: 'mobius-os/mobius', status: 'prepared', plan: {} },
  ]
  const projects = attachSourceProjects(snapshot, records)
  assert.equal(projects[0].name, 'Möbius')
  assert.deepEqual(projects[0].contributions.map((r) => r.id), ['ready', 'landing'])
  assert.deepEqual(projects[1].contributions.map((r) => r.id), ['open'])
  assert.equal(projects.reduce((total, project) => total + project.contributions.length, 0), 3)
})

test('tree equality wins over bookkeeping-only ahead history', () => {
  const projects = attachSourceProjects(snapshot, [])
  const contribute = projects.find((p) => p.name === 'Contribute')
  assert.equal(contribute.ahead, 1)
  assert.equal(contribute.different, false)
  assert.equal(projectStatus(contribute).label, 'Aligned')
  assert.equal(projectMatchesFilter(contribute, 'changed'), false)
})

test('semantic receipt separates landed, local, incoming, and residual paths', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'conflict',
      tree: {
        available: true, files: 4, authored_files: 4, managed_files: 0,
        paths: [
          { path: 'local.js', group: 'authored' },
          { path: 'incoming.js', group: 'authored' },
          { path: 'compatible.js', group: 'authored' },
          { path: 'choice.js', group: 'authored' },
        ],
      },
      reconciliation: {
        available: true,
        proven_present: ['one', 'two'],
        proven_present_count: 2,
        local_only_paths: ['local.js'],
        local_only_count: 1,
        new_upstream_paths: ['incoming.js'],
        new_upstream_count: 1,
        compatible_paths: ['compatible.js'],
        compatible_count: 1,
        unresolved_conflict_paths: ['choice.js'],
        unresolved_conflict_count: 1,
      },
    },
    apps: [],
  }, [])[0]

  assert.equal(project.provenShared, 2)
  assert.equal(project.localFiles, 1)
  assert.equal(project.incomingFiles, 1)
  assert.equal(project.compatibleFiles, 1)
  assert.equal(project.conflictFiles, 1)
  assert.equal(projectStatus(project).label, '1 file needs a choice')
  assert.equal(projectSourceState(project), 'conflict')
  assert.equal(projectOverview(project).tone, 'danger')
  assert.match(projectDetailSummary(project), /remaining overlapping files/)
  assert.ok(projectRowFacts(project).includes('1 needs a choice'))
  assert.equal(sourcePathRelationship(project, 'local.js'), 'local')
  assert.equal(sourcePathRelationship(project, 'incoming.js'), 'incoming')
  assert.equal(sourcePathRelationship(project, 'compatible.js'), 'compatible')
  assert.equal(sourcePathRelationship(project, 'choice.js'), 'conflict')
  assert.equal(sourcePathRelationship(project, 'outside-preview.js'), 'changed')
  assert.equal(projectNeedsSorting(project), true)
})

test('semantic conflict counts outrank a stale customized state everywhere', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'customized',
      tree: { available: true, files: 1, authored_files: 1 },
      reconciliation: {
        available: true,
        local_only_count: 0,
        new_upstream_count: 0,
        compatible_count: 0,
        unresolved_conflict_count: 1,
        unresolved_conflict_paths: ['choice.js'],
      },
      working: { available: true, files: 0 },
    },
    apps: [],
  }, [])[0]

  assert.equal(projectSourceState(project), 'conflict')
  assert.equal(projectStatus(project).tone, 'danger')
  assert.equal(projectOverview(project).tone, 'danger')
  assert.equal(projectNeedsSorting(project), true)
})

test('semantic counts normalize invalid receipt numbers at the boundary', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'aligned',
      reconciliation: {
        available: true,
        local_only_count: -2,
        new_upstream_count: '2',
        compatible_count: Infinity,
        unresolved_conflict_count: true,
        proven_present_count: 1.8,
      },
      working: { available: true, files: -5 },
    },
    apps: [],
  }, [])[0]

  assert.equal(project.localFiles, 0)
  assert.equal(project.incomingFiles, 0)
  assert.equal(project.compatibleFiles, 0)
  assert.equal(project.conflictFiles, 0)
  assert.equal(project.workingFiles, 0)
  assert.equal(project.provenShared, 1)
  assert.equal(projectSourceState(project), 'aligned')
})

test('incoming-only semantic paths are not offered as local contributions', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'incoming',
      tree: { available: true, files: 2, authored_files: 2, managed_files: 0 },
      reconciliation: {
        available: true,
        proven_present: ['already-landed'],
        proven_present_count: 1,
        local_only_paths: [],
        local_only_count: 0,
        new_upstream_paths: ['a.js', 'b.js'],
        new_upstream_count: 2,
        compatible_paths: [],
        compatible_count: 0,
        unresolved_conflict_paths: [],
        unresolved_conflict_count: 0,
      },
      working: { available: true, files: 0 },
    },
    apps: [],
  }, [])[0]

  assert.equal(project.different, false)
  assert.equal(projectStatus(project).label, 'Shared changes')
  assert.equal(projectNeedsPreparation(project), false)
})

test('installed apps ignore full-repository origin projections', () => {
  const projects = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:66', kind: 'app', name: 'Notes', available: true,
      canonical_repo: 'mobius-os/app-notes', state: 'aligned',
      branch: 'main', base_ref: 'upstream', version: '1.2.33',
      ahead: 1, behind: 0,
      tree: {
        available: true, files: 0, authored_files: 0, managed_files: 0,
        paths: [],
      },
      origin: {
        ref: 'origin/main', local_ahead: 59, local_behind: 88,
        local_tree: {
          available: true, files: 75, authored_files: 74, managed_files: 1,
          paths: [{ path: 'src/app.jsx', group: 'authored', deletions: 805 }],
        },
      },
      working: { available: true, files: 0, paths: [] },
    }],
  }, [])
  const notes = projects[0]

  assert.equal(notes.different, false)
  assert.equal(notes.authoredFiles, 0)
  assert.equal(notes.originBehind, 0)
  assert.equal(notes.attention, false)
  assert.equal(projectStatus(notes).label, 'Aligned')
  assert.equal(projectOverview(notes), null)
  assert.equal(projectNeedsPreparation(notes), false)
  assert.equal(projectMatchesFilter(notes, 'changed'), false)
})

test('exact canonical tree equality outranks a stale installer marker', () => {
  const project = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:equal', kind: 'app', name: 'Equal app', available: true,
      canonical_repo: 'mobius-os/app-equal', state: 'aligned',
      branch: 'main', base_ref: 'upstream', base_sha: 'old-base',
      comparison_ref: 'origin/main', comparison_sha: 'new-shared',
      tree: { available: true, files: 0, authored_files: 0, managed_files: 0 },
      reconciliation: {
        available: true,
        local_only_count: 0,
        new_upstream_count: 0,
        compatible_count: 0,
        unresolved_conflict_count: 0,
      },
      origin: {
        ref: 'origin/main', sha: 'new-shared', tree_matches_local: true,
      },
      working: { available: true, files: 0 },
    }],
  }, [])[0]

  assert.equal(project.sourceComparisonRequired, false)
  assert.equal(projectStatus(project).label, 'Aligned')
  assert.equal(projectOverview(project), null)
  assert.equal(projectNeedsPreparation(project), false)
})

test('a moved canonical source is compared before local work is prepared', () => {
  const project = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:stale', kind: 'app', name: 'Stale app', available: true,
      canonical_repo: 'mobius-os/app-stale', state: 'customized',
      branch: 'main', base_ref: 'upstream', base_sha: 'old-base',
      tree: { available: true, files: 2, authored_files: 2, managed_files: 0 },
      origin: {
        ref: 'origin/main', sha: 'new-shared', tree_matches_local: false,
      },
      working: { available: true, files: 0 },
    }],
  }, [])[0]

  assert.equal(project.sourceComparisonRequired, true)
  assert.equal(projectSourceState(project), 'comparison_needed')
  assert.equal(projectStatus(project).label, 'Needs comparison')
  assert.equal(projectOverview(project).label, 'Compare before contributing')
  assert.match(projectDetailSummary(project), /Compare both versions/)
  assert.ok(projectRowFacts(project).includes('Compare shared source'))
  assert.equal(projectNeedsSorting(project), true)
})

test('installed apps still surface genuine local work plus a release update', () => {
  const projects = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:7', kind: 'app', name: 'Demo', available: true,
      canonical_repo: 'mobius-os/app-demo', state: 'diverged',
      branch: 'main', base_ref: 'upstream', version: '2.0.0',
      ahead: 2, behind: 1,
      tree: {
        available: true, files: 1, authored_files: 1, managed_files: 0,
        paths: [{ path: 'index.jsx', group: 'authored', insertions: 2, deletions: 1 }],
      },
      origin: {
        ref: 'origin/main', local_ahead: 200, local_behind: 300,
        local_tree: {
          available: true, files: 40, authored_files: 40, managed_files: 0,
        },
      },
      working: { available: true, files: 0, paths: [] },
    }],
  }, [])
  const demo = projects[0]

  assert.equal(demo.authoredFiles, 1)
  assert.equal(demo.originBehind, 1)
  assert.equal(demo.attention, true)
  assert.equal(projectStatus(demo).label, 'Both sides changed')
  assert.equal(projectOverview(demo).label, 'Both versions changed')
  assert.equal(projectNeedsSorting(demo), true)
})

test('active records for an uninstalled repo stay visible', () => {
  const projects = attachSourceProjects(snapshot, [{
    id: 'other', type: 'pr', repo: 'mobius-os/app-gone', status: 'open', title: 'Still open',
  }])
  const external = projects.find((p) => p.kind === 'external')
  assert.equal(external.canonical_repo, 'mobius-os/app-gone')
  assert.equal(external.contributions.length, 1)
  assert.equal(projectStatus(external).label, 'Contribution only')
})

test('keeps locally built apps at the bottom as publishing candidates', () => {
  const projects = attachSourceProjects({
    ...snapshot,
    apps: [
      ...snapshot.apps,
      {
        key: 'app:local', kind: 'app', name: 'Local scratchpad',
        available: false, canonical_repo: null, state: 'local_only',
      },
    ],
  }, [])
  assert.equal(projects.at(-1).name, 'Local scratchpad')
  assert.equal(projectStatus(projects.at(-1)).label, 'Local only')
  assert.equal(projectMatchesFilter(projects.at(-1), 'changed'), false)
  assert.equal(projects.length, 3)
})

test('does not offer to publish an app that already has a GitHub repository', () => {
  const project = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:github', kind: 'app', name: 'Existing app', available: true,
      canonical_repo: 'owner/existing-app', state: 'local_only', branch: 'main',
      head_sha: 'abcdef12', working: { available: true, files: 0 },
    }],
  }, [])[0]
  assert.equal(project.builtHere, false)
  assert.equal(projectStatus(project).label, 'No upstream')
  assert.equal(projectNeedsPreparation(project), false)
})

test('attention and relationship labels preserve real PR head topology', () => {
  const project = attachSourceProjects(snapshot, [{
    id: 'pr', type: 'pr', repo: 'mobius-os/mobius', status: 'open', needs_attention: true,
    last_submit_push_sha: 'eeeeeeee',
    plan: { base_sha: 'bbbbbbbb', head_sha: 'ffffffff' },
  }])[0]
  assert.equal(projectStatus(project).label, 'Needs attention')
  assert.equal(project.contributions[0].last_submit_push_sha, 'eeeeeeee')
})

test('joins configured and contribution-discovered forks without duplication', () => {
  const forks = projectForks({
    canonical_repo: 'mobius-os/mobius',
    forks: [{ repo: 'owner/mobius', ref: 'fork/main', sha: 'aaaa' }],
  }, [{
    id: 'pr', head_repository: 'owner/mobius', last_submit_fork_sha: 'bbbb',
  }])
  assert.equal(forks.length, 1)
  assert.equal(forks[0].repo, 'owner/mobius')
  assert.equal(forks[0].sha, 'aaaa')
  assert.deepEqual(forks[0].contributions.map((rec) => rec.id), ['pr'])
})

test('install-managed deltas are visible without counting as customization', () => {
  const adapted = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'adapted',
      tree: {
        available: true, files: 3, authored_files: 0, managed_files: 3,
        insertions: 10, deletions: 2,
      },
      origin: {
        local_ahead: 1,
        local_behind: 0,
        local_tree: {
          available: true, files: 3, authored_files: 0, managed_files: 3,
          insertions: 10, deletions: 2,
        },
      },
    },
    apps: [],
  }, [])[0]
  assert.equal(adapted.different, false)
  assert.equal(adapted.adapted, true)
  assert.equal(projectStatus(adapted).label, 'Install-managed')
  assert.ok(projectRowFacts(adapted).includes('Installed normally'))
})

test('formats authoritative endpoint tree delta', () => {
  const projects = attachSourceProjects(snapshot, [])
  assert.equal(projects[0].authoredFiles, 4)
  assert.equal(projects[1].different, false)
})

test('project work identity is stable until the represented source changes', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      head_sha: 'first-head',
      base_sha: 'shared-base',
      working: { files: 1, paths: [{ path: 'index.jsx', group: 'authored' }] },
    })],
  }, [])
  const same = { ...notes }
  const changed = { ...notes, head_sha: 'second-head' }

  assert.equal(projectWorkRevision(notes), projectWorkRevision(same))
  assert.notEqual(projectWorkRevision(notes), projectWorkRevision(changed))
})

test('preparation certainty separates clear candidates from ambiguous local work', () => {
  const projects = attachSourceProjects({
    platform: platform(),
    apps: [
      installedApp({
        name: 'Clear',
        working: { files: 0, paths: [] },
        tree: { available: true, files: 1, authored_files: 1, paths: [] },
        reconciliation: { available: true, local_only_count: 1, local_only_paths: ['index.jsx'] },
        origin: { sha: 'same' },
        base_sha: 'same',
      }),
      installedApp({
        key: 'app:8',
        name: 'Ambiguous',
        working: { files: 0, paths: [] },
        tree: { available: true, files: 2, authored_files: 2, paths: [] },
        reconciliation: { available: true, local_only_count: 2, local_only_paths: ['api.js', 'index.jsx'] },
        origin: { sha: 'newer' },
        base_sha: 'recorded',
      }),
    ],
  }, [])

  const clear = projects.find((project) => project.name === 'Clear')
  const ambiguous = projects.find((project) => project.name === 'Ambiguous')
  assert.equal(projectPreparationState(clear), 'candidate')
  assert.equal(projectReadyToPrepare(clear), true)
  assert.equal(projectNeedsSorting(clear), false)
  assert.equal(projectPreparationState(ambiguous), 'sorting')
  assert.equal(projectReadyToPrepare(ambiguous), false)
  assert.equal(projectNeedsSorting(ambiguous), true)
})

test('incoming-only projects need alignment, not preparation or sorting', () => {
  const incoming = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({
      state: 'incoming',
      working: { files: 0, paths: [] },
      reconciliation: { available: true, new_upstream_count: 1, new_upstream_paths: ['api.js'] },
    })],
  }, []).find((project) => project.key === 'app:7')

  assert.equal(projectPreparationState(incoming), 'none')
  assert.equal(projectReadyToPrepare(incoming), false)
  assert.equal(projectNeedsSorting(incoming), false)
})

test('active reviews move remaining local work into sorting', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      working: { files: 0, paths: [] },
      tree: { available: true, files: 1, authored_files: 1, paths: [] },
      reconciliation: { available: true, local_only_count: 1, local_only_paths: ['index.jsx'] },
      origin: { sha: 'same' },
      base_sha: 'same',
    })],
  }, [{ type: 'pr', status: 'prepared', repo: 'mobius-apps/notes' }])

  assert.equal(notes.contributions.length, 1)
  assert.equal(projectPreparationState(notes), 'sorting')
})

test('opening overview includes only useful local or shared-source positions', () => {
  const projects = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'aligned', ahead: 0, behind: 0,
      tree: { available: true, files: 0 },
    },
    apps: [
      snapshot.apps[0],
      {
        key: 'app:changed', kind: 'app', name: 'Notes', available: true,
        canonical_repo: 'mobius-os/app-notes', state: 'working', branch: 'main',
        tree: { available: true, files: 0 }, working: { available: true, files: 2 },
      },
      {
        key: 'app:new', kind: 'app', name: 'My app', available: true,
        canonical_repo: null, state: 'local_only', branch: 'main',
        tree: null, working: { available: true, files: 0 },
      },
    ],
  }, [])
  const overview = actionableSourceProjects(projects)
  assert.deepEqual(overview, [])
  assert.deepEqual(projects.map((project) => project.name), ['Möbius', 'Contribute', 'Notes', 'My app'])
})

test('active reviews turn a broad source delta into an inventory, not a mega-PR prompt', () => {
  const changed = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'customized', ahead: 270, behind: 0,
      tree: { available: true, files: 264 },
      working: { available: true, files: 0 },
    },
    apps: [],
  }, [{
    id: 'open', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
  }])[0]

  assert.equal(projectOverview(changed).label, 'Committed version differs')
  assert.equal(projectOverview(changed).detail, '264 files remain local after shared work')
  assert.equal(projectNeedsSorting(changed), true)
  assert.equal(projectReadyToPrepare(changed), false)
})

test('working-only projects with active reviews describe the edits instead of zero local files', () => {
  const changed = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'working', ahead: 0, behind: 0,
      tree: { available: true, files: 0, authored_files: 0, managed_files: 0 },
      working: { available: true, files: 2 },
      reconciliation: {
        available: true,
        local_only_count: 0,
        new_upstream_count: 0,
        compatible_count: 0,
        unresolved_conflict_count: 0,
      },
    },
    apps: [],
  }, [{
    id: 'open', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
  }])[0]

  assert.equal(projectNeedsSorting(changed), true)
  assert.match(projectRowFacts(changed).join(' · '), /Being edited/)
})

test('preparation candidates exclude incoming-only projects', () => {
  const projects = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'customized', ahead: 1, behind: 0,
      tree: { available: true, files: 3 },
      working: { available: true, files: 0 },
    },
    apps: [
      {
        ...snapshot.apps[0],
        state: 'working',
        working: { available: true, files: 2 },
      },
      {
        key: 'app:incoming', kind: 'app', name: 'Incoming', available: true,
        canonical_repo: 'mobius-os/app-incoming', state: 'incoming',
        ahead: 0, behind: 2, working: { available: true, files: 0 },
      },
    ],
  }, [])

  const candidates = projects.filter(projectNeedsPreparation)
  assert.deepEqual(candidates.map((project) => project.name), ['Möbius', 'Contribute'])
})

test('an exact current contribution covers its prepared local paths', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      head_sha: 'current-head',
      working: { files: 0, paths: [] },
      tree: { available: true, files: 1, authored_files: 1, paths: [] },
      reconciliation: {
        available: true,
        local_only_count: 1,
        local_only_paths: ['index.jsx'],
      },
    })],
  }, [{
    type: 'pr', status: 'prepared', repo: 'mobius-apps/notes',
    plan: {
      source_sha: 'current-head',
      diff_stat: ' index.jsx | 4 +++-\n 1 file changed, 3 insertions(+), 1 deletion(-)',
    },
  }])

  assert.equal(notes.coveredLocalFiles, 1)
  assert.deepEqual(notes.coveredLocalPaths, ['index.jsx'])
  assert.deepEqual(notes.localOnlyPaths, [])
  assert.equal(notes.localFiles, 0)
  assert.equal(projectNeedsPreparation(notes), false)
})

test('an older contribution whose source was not compared never covers the current source', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      head_sha: 'current-head',
      working: { files: 0, paths: [] },
      tree: { available: true, files: 1, authored_files: 1, paths: [] },
      reconciliation: {
        available: true,
        local_only_count: 1,
        local_only_paths: ['index.jsx'],
      },
    })],
  }, [{
    type: 'pr', status: 'prepared', repo: 'mobius-apps/notes',
    plan: {
      source_sha: 'older-head',
      files: ['index.jsx'],
    },
  }])

  assert.equal(notes.coveredLocalFiles, 0)
  assert.deepEqual(notes.localOnlyPaths, ['index.jsx'])
  assert.equal(projectNeedsPreparation(notes), true)
})

test('an older contribution covers only paths unchanged since its source', () => {
  const older = 'a'.repeat(40)
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      head_sha: 'current-head',
      working: { files: 0, paths: [] },
      tree: { available: true, files: 3, authored_files: 3, paths: [] },
      reconciliation: {
        available: true,
        local_only_count: 3,
        local_only_paths: ['api.js', 'index.jsx', 'theme.js'],
        local_changed_since: { [older]: ['index.jsx'] },
      },
    })],
  }, [{
    type: 'pr', status: 'prepared', repo: 'mobius-apps/notes',
    plan: { source_sha: older, files: ['api.js', 'index.jsx'] },
  }])

  assert.deepEqual(notes.coveredLocalPaths, ['api.js'])
  assert.deepEqual(notes.localOnlyPaths, ['index.jsx', 'theme.js'])
  assert.equal(notes.localFiles, 2)
})

test('proposal source commits are the distinct full ids of active records', () => {
  const a = 'A'.repeat(40)
  const b = 'b'.repeat(40)
  assert.deepEqual(proposalSourceCommits([
    { status: 'open', plan: { source_sha: a } },
    { status: 'prepared', plan: { source_sha: a.toLowerCase() } },
    { status: 'draft', plan: { source_sha: b } },
    { status: 'merged', plan: { source_sha: 'c'.repeat(40) } },
    { status: 'abandoned', plan: { source_sha: 'd'.repeat(40) } },
    { status: 'prepared', plan: { source_sha: 'short' } },
  ]), [a.toLowerCase(), b])
})

test('coverage preserves local counts when source status omits path details', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      head_sha: 'current-head',
      working: { files: 0, paths: [] },
      tree: { available: true, files: 2, authored_files: 2, paths: [] },
      reconciliation: { available: true, local_only_count: 2 },
    })],
  }, [])

  assert.deepEqual(notes.localOnlyPaths, [])
  assert.equal(notes.localFiles, 2)
  assert.equal(projectNeedsPreparation(notes), true)
})

test('partial current coverage leaves only the unprepared paths actionable', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      head_sha: 'current-head',
      working: { files: 0, paths: [] },
      tree: { available: true, files: 2, authored_files: 2, paths: [] },
      reconciliation: {
        available: true,
        local_only_count: 2,
        local_only_paths: ['api.js', 'index.jsx'],
      },
    })],
  }, [{
    type: 'pr', status: 'open', repo: 'mobius-apps/notes',
    plan: {
      source_sha: 'current-head',
      files: [{ path: 'api.js' }],
    },
  }])

  assert.deepEqual(notes.coveredLocalPaths, ['api.js'])
  assert.deepEqual(notes.localOnlyPaths, ['index.jsx'])
  assert.equal(notes.localFiles, 1)
  assert.equal(projectPreparationState(notes), 'sorting')
})

test('tracked app work needs sorting when no current shared position is available', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      working: { files: 0, paths: [] },
      tree: { available: true, files: 1, authored_files: 1, paths: [] },
      reconciliation: { available: true, local_only_count: 1, local_only_paths: ['index.jsx'] },
      origin: {},
      base_sha: 'recorded',
    })],
  }, [])

  assert.equal(projectNeedsPreparation(notes), true)
  assert.equal(projectPreparationState(notes), 'sorting')
})


test('the local count adds committed differences and edits, counting a file once', () => {
  const distinct = { localFiles: 1, localOnlyPaths: ['skill/core.md'], workingFiles: 1, working: { paths: [{ path: 'frontend/a.jsx' }] } }
  assert.deepEqual(localChangeSummary(distinct), { changed: 2, editing: 1 })
  assert.equal(localChangeLabel(distinct), '2 changed files · 1 being edited')
  const same = { localFiles: 1, localOnlyPaths: ['api.js'], workingFiles: 1, working: { paths: [{ path: 'api.js' }] } }
  assert.deepEqual(localChangeSummary(same), { changed: 1, editing: 1 })
  // A shortened path list cannot prove overlap, so the counts are added.
  assert.equal(localChangeSummary({ localFiles: 3, localOnlyPaths: ['a'], workingFiles: 1 }).changed, 4)
  assert.equal(localChangeLabel({}), 'No changes')
})

test('quiet projects have nothing for the owner; requests, updates and work are never quiet', () => {
  const base = { available: true, contributions: [] }
  assert.equal(projectIsQuiet(base), true)
  assert.equal(projectIsQuiet({ ...base, localFiles: 1 }), false)
  assert.equal(projectIsQuiet({ ...base, reviewRequests: [{ number: 1 }] }), false)
  assert.equal(projectIsQuiet({ ...base, incomingFiles: 2, semanticAvailable: true }), false)
  assert.equal(projectIsQuiet({ ...base, conflictFiles: 1 }), false)
  assert.equal(projectIsQuiet({ ...base, contributions: [{ status: 'open' }] }), false)
})
