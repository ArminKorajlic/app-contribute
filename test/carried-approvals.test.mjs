import assert from 'node:assert/strict'
import test from 'node:test'
import { forgetSameWork, markCarriedApprovals } from '../carried-approvals.js'

// The shape of one PR in a GitHub answer: approved at `ab`, head `h2` (both only merge the base in).
const pull = (overrides = {}) => ({
  headRefOid: 'h2', baseRefOid: 'b1', state: 'OPEN', author: { login: 'alex' }, repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'sam', __typename: 'User' }, commit: { oid: 'h1' } }] }, ...overrides,
})
const patch = { filename: 'a.js', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+x' }

function fetchCompare(answers, calls, signals = []) {
  return async (url, options = {}) => {
    calls.push(String(url))
    signals.push(options.signal)
    const commit = String(url).split('...')[1]
    const answer = answers[commit]
    return { ok: !!answer, status: answer ? 200 : 404, json: async () => answer || null }
  }
}

test('an approval of an older commit is marked with whether the work is the same, once per version', async () => {
  forgetSameWork()
  const calls = []
  globalThis.fetch = fetchCompare({ h1: { files: [patch] }, h2: { files: [patch] } }, calls)
  const data = { p0: { pullRequest: pull() }, involved: { nodes: [pull({ headRefOid: 'h2' })] } }
  await markCarriedApprovals('t', data)
  assert.equal(data.p0.pullRequest.latestOpinionatedReviews.nodes[0].sameWork, true)
  assert.equal(data.involved.nodes[0].latestOpinionatedReviews.nodes[0].sameWork, true)
  assert.equal(calls.length, 2, 'the second PR of the same version is answered from what was already settled')
  assert.match(calls[0], /repos\/o\/r\/compare\/b1\.\.\.h/)
})

test('a changed line is marked false; a failed read is marked null, not repeated on every poll, and asked again after a while', async () => {
  forgetSameWork()
  globalThis.fetch = fetchCompare({ h1: { files: [patch] }, h2: { files: [{ ...patch, patch: '@@ -1 +1 @@\n+y' }] } }, [])
  const changed = { p0: { pullRequest: pull() } }
  await markCarriedApprovals('t', changed)
  assert.equal(changed.p0.pullRequest.latestOpinionatedReviews.nodes[0].sameWork, false)
  forgetSameWork()
  const calls = []
  globalThis.fetch = fetchCompare({}, calls)
  const realNow = Date.now
  try {
    const broken = { p0: { pullRequest: pull() } }
    await markCarriedApprovals('t', broken)
    await markCarriedApprovals('t', broken)
    assert.equal(broken.p0.pullRequest.latestOpinionatedReviews.nodes[0].sameWork, null)
    assert.equal(calls.length, 2, 'the second poll did not ask again')
    Date.now = () => realNow() + 5 * 60 * 1000
    await markCarriedApprovals('t', broken)
    assert.equal(calls.length, 4, 'after the retry window it asks again')
  } finally { Date.now = realNow }
})

test('nothing is looked up unless an open PR has only an approval of an older commit by someone else', async () => {
  forgetSameWork()
  const calls = []
  globalThis.fetch = fetchCompare({ h1: { files: [patch] }, h2: { files: [patch] } }, calls)
  const node = (state, login, oid, __typename = 'User') => ({ state, author: { login, __typename }, commit: { oid } })
  const quiet = [
    pull({ latestOpinionatedReviews: { nodes: [node('APPROVED', 'sam', 'h2')] } }),
    pull({ latestOpinionatedReviews: { nodes: [node('APPROVED', 'sam', 'h1'), node('APPROVED', 'kim', 'h2')] } }),
    pull({ latestOpinionatedReviews: { nodes: [node('APPROVED', 'alex', 'h1')] } }),
    pull({ latestOpinionatedReviews: { nodes: [node('APPROVED', 'qa-bot', 'h1', 'Bot')] } }),
    pull({ latestOpinionatedReviews: { nodes: [node('CHANGES_REQUESTED', 'sam', 'h1')] } }),
    pull({ state: 'MERGED' }),
    pull({ baseRefOid: undefined }),
  ]
  await markCarriedApprovals('t', { nodes: quiet })
  assert.deepEqual(calls, [])
})

test('the comparison is against the base’s current tip, not the base the PR was opened against', async () => {
  forgetSameWork()
  const calls = []
  globalThis.fetch = fetchCompare({ h1: { files: [patch] }, h2: { files: [patch] } }, calls)
  await markCarriedApprovals('t', { p0: { pullRequest: pull({ baseRef: { target: { oid: 'tip9' } } }) } })
  assert.match(calls[0], /compare\/tip9\.\.\./)
})

test('a binary file that was swapped is not carried, and one that is the same is', async () => {
  const logo = sha => ({ filename: 'logo.png', status: 'modified', additions: 0, deletions: 0, changes: 0, sha })
  for (const [head, expected] of [['bbb', false], ['aaa', true]]) {
    forgetSameWork()
    globalThis.fetch = fetchCompare({ h1: { files: [logo('aaa')] }, h2: { files: [logo(head)] } }, [])
    const data = { p0: { pullRequest: pull() } }
    await markCarriedApprovals('t', data)
    assert.equal(data.p0.pullRequest.latestOpinionatedReviews.nodes[0].sameWork, expected, head)
  }
})

test('every comparison can time out, and one read starts only so many new ones', async () => {
  forgetSameWork()
  const calls = [], signals = []
  globalThis.fetch = fetchCompare({ h1: { files: [patch] }, h2: { files: [patch] } }, calls, signals)
  const data = { nodes: Array.from({ length: 14 }, (_, index) => pull({ repository: { nameWithOwner: `o/r${index}`, viewerPermission: 'WRITE' } })) }
  await markCarriedApprovals('t', data)
  assert.ok(signals.every(signal => signal instanceof AbortSignal), 'a comparison without a timeout could hold up every PR list')
  assert.equal(data.nodes.filter(item => 'sameWork' in item.latestOpinionatedReviews.nodes[0]).length, 12, 'the first twelve PRs were asked')
  assert.equal(calls.length, 24)
  await markCarriedApprovals('t', data)
  assert.equal(data.nodes.filter(item => 'sameWork' in item.latestOpinionatedReviews.nodes[0]).length, 14, 'the next read asks the rest, answering the first twelve from memory')
  assert.equal(calls.length, 28)
})

test('a null entry in a GitHub list, or a PR in a repository you cannot write to, never fails the read', async () => {
  forgetSameWork()
  const calls = []
  globalThis.fetch = fetchCompare({ h1: { files: [patch] }, h2: { files: [patch] } }, calls)
  const data = { nodes: [pull({ latestOpinionatedReviews: { nodes: [null] } }), pull({ repository: { nameWithOwner: 'o/r', viewerPermission: 'READ' } }), pull()] }
  assert.equal(await markCarriedApprovals('t', data), data)
  assert.equal(data.nodes[2].latestOpinionatedReviews.nodes[0].sameWork, true, 'the PR that can be looked at still is')
  assert.equal('sameWork' in data.nodes[1].latestOpinionatedReviews.nodes[0], false, 'no lookup for a PR you cannot merge')
  assert.equal(calls.length, 2)
})

test('an approval by a bot or by the author at this version does not stop someone else’s older approval from being compared', async () => {
  forgetSameWork()
  const calls = []
  globalThis.fetch = fetchCompare({ h1: { files: [patch] }, h2: { files: [patch] } }, calls)
  const node = (state, login, oid, __typename = 'User') => ({ state, author: { login, __typename }, commit: { oid } })
  const data = { nodes: [
    pull({ latestOpinionatedReviews: { nodes: [node('APPROVED', 'sam', 'h1'), node('APPROVED', 'qa-bot', 'h2', 'Bot')] } }),
    pull({ latestOpinionatedReviews: { nodes: [node('APPROVED', 'sam', 'h1'), node('APPROVED', 'alex', 'h2')] } }),
  ] }
  await markCarriedApprovals('t', data)
  assert.deepEqual(data.nodes.map(item => item.latestOpinionatedReviews.nodes[0].sameWork), [true, true])
})
