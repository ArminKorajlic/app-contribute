import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DESK_VIEWS,
  NEEDS_CHIPS,
  deskViewKey,
  authoredPullState,
  authoredPulls,
  chainPulls,
  deskCounts,
  projectNeedsCount,
  mergedRecently,
  needsCount,
  newSince,
  railBadge,
  settleReviewRequest,
  splitProjects,
} from '../desk.js'

const rollup = (passed, failed, pending = 0) => ({ nodes: [{ commit: { statusCheckRollup: { state: 'x', contexts: {
  totalCount: passed + failed + pending,
  checkRunCountsByState: [
    ...(passed ? [{ state: 'SUCCESS', count: passed }] : []),
    ...(failed ? [{ state: 'FAILURE', count: failed }] : []),
    ...(pending ? [{ state: 'PENDING', count: pending }] : []),
  ],
  statusContextCountsByState: [],
} } } }] })

const pr = (number, extra = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  author: { login: 'owner' },
  repository: { nameWithOwner: 'o/r' },
  headRefName: `head-${number}`,
  baseRefName: 'main',
  updatedAt: '2026-11-02T08:00:00Z',
  ...extra,
})

test('failing checks block before any review verdict is read', () => {
  const state = authoredPullState(pr(1, { reviewDecision: 'APPROVED', commits: rollup(10, 2) }))
  assert.deepEqual([state.key, state.tone, state.label], ['failing', 'blocker', '2 failing checks'])
})

test('a merge conflict and a change request are blockers in plain words', () => {
  assert.equal(authoredPullState(pr(1, { mergeable: 'CONFLICTING' })).label, 'Merge blocked')
  const changes = authoredPullState(pr(2, { reviewDecision: 'CHANGES_REQUESTED', commits: rollup(5, 0) }))
  assert.deepEqual([changes.key, changes.tone], ['changes', 'blocker'])
})

test('an approval reads ready to merge, but an approved draft still waits on Mark ready', () => {
  assert.equal(authoredPullState(pr(1, { reviewDecision: 'APPROVED' })).key, 'ready')
  const draft = authoredPullState(pr(2, { reviewDecision: 'APPROVED', isDraft: true }))
  assert.deepEqual([draft.key, draft.tone], ['approved_draft', 'ready'])
  assert.equal(authoredPullState(pr(3, {})).key, 'waiting')
})

test('authored pulls keep only the owner PRs that are not review requests', () => {
  const incoming = [
    pr(1, { reviewRequested: true }),
    pr(2, { author: { login: 'Owner' } }),
    pr(3, { author: { login: 'teammate' } }),
  ]
  assert.deepEqual(authoredPulls(incoming, 'owner').map(item => item.number), [2])
  assert.deepEqual(authoredPulls(incoming, ''), [])
})

test('chained PRs group into one stack in merge order, whatever order GitHub returned', () => {
  const second = pr(44, { baseRefName: 'head-43' })
  const third = pr(45, { baseRefName: 'head-44' })
  const first = pr(43, { baseRefName: 'main' })
  const lone = pr(9, { baseRefName: 'main' })
  const groups = chainPulls([third, lone, first, second])
  const chain = groups.find(group => group.length === 3)
  assert.deepEqual(chain.map(item => item.number), [43, 44, 45])
  assert.ok(groups.some(group => group.length === 1 && group[0].number === 9))
})

test('merged this week keeps only recent merged or superseded records', () => {
  const now = Date.parse('2026-11-02T09:00:00Z')
  const records = [
    { id: 'a', status: 'merged', updated_at: '2026-11-01T10:00:00Z' },
    { id: 'b', status: 'merged', updated_at: '2026-10-20T10:00:00Z' },
    { id: 'c', status: 'superseded', updated_at: '2026-10-30T10:00:00Z' },
    { id: 'd', status: 'open', updated_at: '2026-11-01T10:00:00Z' },
  ]
  assert.deepEqual(mergedRecently(records, now).map(record => record.id), ['a', 'c'])
})

test('new-since-you-looked needs a previous visit and a newer change', () => {
  assert.equal(newSince('2026-11-02T08:00:00Z', ''), false)
  assert.equal(newSince('2026-11-02T08:00:00Z', '2026-11-01T00:00:00Z'), true)
  assert.equal(newSince('2026-10-30T08:00:00Z', '2026-11-01T00:00:00Z'), false)
})

test('the counts name next steps and the rail badges follow them', () => {
  const incoming = [
    pr(1, { reviewRequested: true, author: { login: 'teammate' } }),
    pr(2, { reviewDecision: 'APPROVED' }),
    pr(3, { commits: rollup(3, 1) }),
    pr(4, { reviewDecision: 'APPROVED', isDraft: true }),
  ]
  const decisions = [
    { kind: 'public_attention', record: { number: 3 } },
    { kind: 'private_review', record: { number: 9 } },
  ]
  const counts = deskCounts({ decisions, incoming, records: [], login: 'owner' })
  assert.equal(counts.questions, 1)
  assert.equal(counts.requests, 1)
  assert.equal(counts.merge, 1)
  assert.equal(counts.fix, 1)
  assert.equal(counts.drafts, 1)
  assert.equal(counts.mine, 3)
  assert.equal(needsCount(counts), 4)
  assert.equal(railBadge('needs', counts), 4)
  assert.equal(railBadge('requests', counts), 1)
  assert.equal(railBadge('runs', counts), 0)
  assert.equal(railBadge('runs', { reviewsRunning: 2 }), 2)
})

test('projects with review requests never fold into the quiet group', () => {
  const quiet = { key: 'a', kind: 'app', available: true, state: 'clean', localFiles: 0, compatibleFiles: 0, conflictFiles: 0, workingFiles: 0 }
  const asked = { ...quiet, key: 'b', reviewRequests: [pr(1)] }
  const groups = splitProjects([quiet, asked], {})
  assert.deepEqual(groups.quiet.map(project => project.key), ['a'])
  assert.deepEqual(groups.active.map(project => project.key), ['b'])
})

test('feedback on a published PR opens the PR itself; publication decisions keep their card', async () => {
  const { feedbackPull } = await import('../desk.js')
  const record = { number: 1791, repo: 'mobius-os/mobius' }
  assert.deepEqual(feedbackPull({ kind: 'public_attention', record }),
    { number: 1791, repository: { nameWithOwner: 'mobius-os/mobius' } })
  assert.equal(feedbackPull({ kind: 'publish', record }), null)
  assert.equal(feedbackPull({ kind: 'public_attention', record: { repo: 'o/r' } }), null)
})

test('a PR with a feedback card and a fix step counts once in Needs you', () => {
  const owned = number => ({ number, repository: { nameWithOwner: 'o/r' }, author: { login: 'owner' }, reviewDecision: 'CHANGES_REQUESTED' })
  const decisions = [{ kind: 'public_attention', record: { repo: 'o/r', number: 1 } }]
  const counts = deskCounts({ decisions, incoming: [owned(1), owned(2)], records: [], login: 'owner' })
  // One feedback card + two PRs to fix, but #1 is the same work as its card: it counts once, as the card.
  assert.equal(counts.questions, 1)
  assert.equal(counts.fix, 1)
  assert.equal(needsCount(counts), 2)
  assert.equal(railBadge('needs', counts), 2)
})

test('a project number is what its Needs you card lists: requests, feedback cards, and own PRs not already covered', () => {
  const owned = (number, extra = {}) => ({ number, repository: { nameWithOwner: 'o/r' }, author: { login: 'owner' }, reviewDecision: 'CHANGES_REQUESTED', ...extra })
  const project = { reviewRequests: [{ number: 50 }], incomingReviews: [owned(1), owned(2), owned(3, { reviewDecision: 'REVIEW_REQUIRED' })] }
  const decisions = [{ kind: 'public_attention', record: { repo: 'o/r', number: 1 } }]
  // 1 request + 1 feedback card (#1) + #2 (needs a fix); #1 is covered and #3 is just waiting.
  assert.equal(projectNeedsCount(project, decisions, 'owner'), 3)
  assert.equal(projectNeedsCount({ incomingReviews: [] }, [], 'owner'), 0)
})

test('the rail has four views and every older view lands inside one of them', () => {
  assert.deepEqual(DESK_VIEWS.map(view => view.label), ['Needs you', 'Review requests', 'My PRs', 'Agent runs'])
  assert.deepEqual(DESK_VIEWS.map(view => view.key), ['needs', 'requests', 'mine', 'runs'])
  const landing = { confirm: 'needs', edits: 'needs', merged: 'mine', work: 'runs', reviews: 'runs', needs: 'needs', runs: 'runs' }
  for (const [old, now] of Object.entries(landing)) assert.equal(deskViewKey(old), now, old)
})

test('the Needs you badge is the sum of the chips next to it, whatever the page holds', () => {
  const incoming = [
    pr(1, { reviewRequested: true, author: { login: 'teammate' } }),
    pr(2, { reviewDecision: 'APPROVED' }),
    pr(3, { commits: rollup(3, 1) }),
    pr(4, { reviewDecision: 'APPROVED', isDraft: true }),
  ]
  const entries = [
    { id: 'o/r#7', bucket: 'waiting', item: { repo: 'o/r', number: 7 } },
    { id: 'o/r#8', bucket: 'running', item: { repo: 'o/r', number: 8 } },
    { id: 'o/r#9', bucket: 'done', item: { repo: 'o/r', number: 9 } },
  ]
  const counts = deskCounts({ decisions: [], incoming, records: [], login: 'owner', reviews: { running: 1 }, reviewEntries: entries })
  const chips = NEEDS_CHIPS.map(chip => chip.count(counts))
  assert.deepEqual(chips, [0, 1, 1, 1, 1])
  assert.equal(railBadge('needs', counts), chips.reduce((a, b) => a + b, 0))
  // A draft ready to open and local files are not urgent: they never enter the number.
  assert.equal(counts.drafts, 1)
})

test('an agent run on a PR that already has a row in Needs you is not counted twice', () => {
  const incoming = [pr(1, { reviewRequested: true, author: { login: 'teammate' } })]
  const entries = [{ id: 'o/r#1', bucket: 'waiting', item: { repo: 'o/r', number: 1 } }, { id: 'o/r#2', bucket: 'stalled', item: { repo: 'o/r', number: 2 } }]
  const counts = deskCounts({ incoming, login: 'owner', reviewEntries: entries })
  assert.equal(counts.agent, 1)
  assert.equal(counts.requests, 1)
})

test('a submitted review takes only its own PR out of the review requests', () => {
  const asks = number => pr(number, { reviewRequested: true })
  const other = { ...asks(9), repository: { nameWithOwner: 'o/other' } }
  const rows = [asks(7), asks(8), other]
  const settled = settleReviewRequest(rows, 'O/R', 7)
  assert.deepEqual(settled.map(row => row.reviewRequested), [false, true, true])
  assert.equal(settled[0].title, 'PR 7', 'the PR stays listed, as GitHub still counts it as involving the owner')
  assert.equal(settled[1], rows[1], 'other rows are untouched')
  assert.equal(rows[0].reviewRequested, true, 'the list it was given is not changed')
})
