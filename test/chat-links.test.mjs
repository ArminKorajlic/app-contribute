import test from 'node:test'
import assert from 'node:assert/strict'
import { chatBlockTarget } from '../chat-blocks.js'
import { pullConversations, recordsForPull } from '../provenance.js'
import { acknowledgeAssignment, emptyPullView, invalidatedSelection, isOpenPull, observePulls, pullsInView } from '../pull-view.js'

const pr = (number, extra = {}) => ({ number, title: `PR ${number}`, headRefOid: 'a', baseRefOid: 'b', baseRefName: 'main',
  repository: { nameWithOwner: 'owner/repo' }, assignees: { nodes: [] }, ...extra })

test('a review-run link names one run and starts nothing', () => {
  assert.deepEqual(chatBlockTarget('review-run:run-12345678'), { kind: 'run', id: 'run-12345678' })
  for (const intent of ['review-run:short', 'review-run:../run-12345678', 'chat-review-run:run-12345678', `review-run:${'r'.repeat(65)}`]) {
    assert.equal(chatBlockTarget(intent), null, intent)
  }
})

test('chat PR links resolve only exact, bounded PR identities', () => {
  assert.deepEqual(chatBlockTarget('pull-request:owner/repo#7'), { kind: 'pull', repo: 'owner/repo', number: 7 })
  for (const intent of ['pull-request:../repo#7', 'pull-request:owner/..#7', 'pull-request:owner/repo#0',
    'pull-request:owner/repo#07', 'pull-request:owner/repo/x#7', 'pull-request:owner/repo#7 ', `pull-request:${'o'.repeat(101)}/repo#7`,
    'pull-request:owner/repo#12345678901', 'chat-pull:owner/repo#7', 'chat-review-run:run-1', 'review_fix_merge:owner/repo#7', null]) {
    assert.equal(chatBlockTarget(intent), null, String(intent))
  }
})

test('a notification-safe PR link opens the same exact PR identity', () => {
  assert.deepEqual(chatBlockTarget('pr:mobius-os:mobius:2041'), { kind: 'pull', repo: 'mobius-os/mobius', number: 2041 })
  for (const intent of ['pr:..:repo:7', 'pr:owner:..:7', 'pr:owner:repo:0', 'pr:owner:repo:07', 'pr:owner:repo',
    'pr:owner:repo:7:x', 'pr:owner/repo:7', `pr:${'o'.repeat(101)}:repo:7`, 'pr:owner:repo:12345678901']) {
    assert.equal(chatBlockTarget(intent), null, intent)
  }
})

test('provenance names one link per conversation for the exact repository and PR', () => {
  const records = [
    { repo: 'owner/repo', number: 7, chat_id: 'source-1', chat_title: 'Fix login', chat_ids: ['source-1', 'source-2'],
      quality_review: { chat_id: 'review-1' }, autopilot: { chat_id: 'fix-1', rounds: [{ chat_id: 'fix-1' }] } },
    { repo: 'other/repo', number: 7, chat_id: 'wrong-repo' },
    { plan: { repo: 'OWNER/REPO' }, number: 8, chat_id: 'wrong-number' },
  ]
  assert.equal(recordsForPull(records, pr(7)).length, 1)
  const runs = [{ chat_id: 'run-1', items: [{ repo: 'Owner/Repo', number: 7 }] }, { chat_id: 'source-1', items: [{ repo: 'owner/repo', number: 7 }] },
    { chat_id: 'run-other', items: [{ repo: 'other/repo', number: 7 }] }]
  const links = pullConversations(records, runs, pr(7))
  assert.deepEqual(links.map(link => [link.chat_id, link.role]), [['source-1', 'source'], ['source-2', 'source'], ['review-1', 'review'], ['fix-1', 'fix'], ['run-1', 'review']])
  assert.equal(links[0].title, 'Fix login')
  assert.equal(links[1].title, 'Source conversation')
  assert.deepEqual(pullConversations([{ repo: 'owner/repo', number: 7, chat_id: 'bad id!' }], [], pr(7)), [])
})

test('newest-issued read owns a PR regardless of reader or completion order', () => {
  let view = emptyPullView()
  // A list read issued first completes after a newer exact read.
  view = observePulls(view, [pr(7, { title: 'exact, newer' })], 2, { inventory: [], pinned: 'owner/repo#7' })
  view = observePulls(view, [pr(7, { title: 'list, older' }), pr(8)], 1, { inventory: ['owner/repo#7', 'owner/repo#8'], pinned: 'owner/repo#7' })
  assert.deepEqual(pullsInView(view).map(item => item.title), ['exact, newer', 'PR 8'])
  // A late exact read for an older navigation never replaces a newer list row.
  view = observePulls(view, [pr(7, { title: 'list, newest' })], 4, { inventory: ['owner/repo#7', 'owner/repo#8'] })
  view = observePulls(view, [pr(7, { title: 'late exact' })], 3)
  assert.equal(pullsInView(view)[0].title, 'list, newest')
})

test('a pinned destination stays visible only while pinned and keeps list order', () => {
  let view = observePulls(emptyPullView(), [pr(7), pr(8)], 1, { inventory: ['owner/repo#7', 'owner/repo#8'] })
  view = observePulls(view, [pr(11, { state: 'CLOSED' })], 2, { pinned: 'owner/repo#11' })
  assert.deepEqual(pullsInView(view, 'owner/repo#11').map(item => item.number), [7, 8, 11])
  assert.deepEqual(pullsInView(view).map(item => item.number), [7, 8])
  // Once released, the next observation drops it entirely.
  view = observePulls(view, [pr(7), pr(8)], 3, { inventory: ['owner/repo#7', 'owner/repo#8'] })
  assert.equal(view.rows.has('owner/repo#11'), false)
  assert.equal(isOpenPull(pr(11, { state: 'CLOSED' })), false)
  assert.equal(isOpenPull(pr(11, { state: 'MERGED' })), false)
  assert.equal(isOpenPull(pr(7)), true)
})

test('assignment acknowledgement survives older reads and yields to newer reads', () => {
  const inventory = ['owner/repo#7']
  let view = observePulls(emptyPullView(), [pr(7)], 1, { inventory })
  // Read issued before the acknowledgement, completing after it.
  const staleIssued = 2
  view = acknowledgeAssignment(view, ['owner/repo#7', 'owner/repo#99'], 'teammate', 3)
  assert.equal(view.assigned.has('owner/repo#99'), false)
  view = observePulls(view, [pr(7, { title: 'older read' })], staleIssued, { inventory })
  assert.deepEqual(pullsInView(view)[0].assignees.nodes.map(user => user.login), ['teammate'])
  assert.equal(pullsInView(view)[0].title, 'older read')
  // A read issued after the acknowledgement is authoritative, even if empty.
  view = observePulls(view, [pr(7)], 4, { inventory })
  assert.deepEqual(pullsInView(view)[0].assignees.nodes, [])
})

test('selection drops only PRs whose exact version changed, closed or left', () => {
  const before = [pr(7), pr(8), pr(9)]
  const after = [pr(7), pr(8, { headRefOid: 'new' }), pr(10)]
  assert.deepEqual(invalidatedSelection(new Set(['owner/repo#7', 'owner/repo#8', 'owner/repo#9']), before, after), ['owner/repo#8', 'owner/repo#9'])
  assert.deepEqual(invalidatedSelection(new Set(['owner/repo#7']), before, [pr(7, { state: 'CLOSED' })]), ['owner/repo#7'])
  assert.deepEqual(invalidatedSelection(new Set(['owner/repo#7']), before, [pr(7, { title: 'renamed' })]), [])
})
