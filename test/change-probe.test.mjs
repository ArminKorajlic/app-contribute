import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { fetchChangeProbe, fetchLiveStates, githubRemainingPoints } from '../api.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

// GitHub's GraphQL endpoint, answering with `data` (or failing); `queries` collects what was asked.
function github(data, { ok = true } = {}) {
  const queries = []
  globalThis.fetch = async (_url, options) => {
    queries.push(JSON.parse(options.body).query)
    return { ok, json: async () => ({ data }) }
  }
  return queries
}
const ref = (number, repo = 'owner/project') => ({ key: `${repo}#${number}`, repo, number })

test('the probe is one request with a signature for the review requests and for each reviewed PR', async () => {
  const queries = github({
    rateLimit: { remaining: 4321 },
    requested: { nodes: [{ id: 'B', updatedAt: '2026-11-05T10:00:00Z' }, { id: 'A', updatedAt: '2026-11-05T09:00:00Z' }] },
    p0: { pullRequest: { updatedAt: '2026-11-05T11:00:00Z', state: 'OPEN' } },
    p1: { pullRequest: null },
  })
  const signatures = await fetchChangeProbe('token', [ref(7), ref(8)])
  assert.equal(queries.length, 1)
  assert.match(queries[0], /query ContributeChangeProbe/)
  assert.equal(signatures.get('requests'), 'A@2026-11-05T09:00:00Z,B@2026-11-05T10:00:00Z', 'the requests signature must not depend on GitHub\'s order')
  assert.equal(signatures.get('owner/project#7'), '2026-11-05T11:00:00Z|OPEN')
  assert.equal(signatures.get('owner/project#8'), 'gone')
  assert.equal(githubRemainingPoints(), 4321, 'the probe must report the account\'s points left')
})

test('a probe GitHub did not answer is null, never a change', async () => {
  github(null, { ok: false })
  assert.equal(await fetchChangeProbe('token', [ref(7)]), null)
  github({ requested: null })
  assert.equal(await fetchChangeProbe('token', [ref(7)]), null)
})

test('a malformed reviewed-PR reference never reaches the query', async () => {
  const queries = github({ requested: { nodes: [] } })
  await fetchChangeProbe('token', [ref(7), { key: 'bad', repo: 'owner/x") { id } evil: repository(owner:"o', number: 1 }, { key: 'zero', repo: 'owner/project', number: 0 }])
  assert.equal(queries.length, 1)
  assert.doesNotMatch(queries[0], /evil/)
  assert.match(queries[0], /pullRequest\(number:7\)/)
  assert.doesNotMatch(queries[0], /number:0/)
})

test('reviewed PRs beyond one probe batch cost one more request each hundred, with the requests read once', async () => {
  const queries = github({ requested: { nodes: [] } })
  await fetchChangeProbe('token', Array.from({ length: 150 }, (_, index) => ref(index + 1)))
  assert.equal(queries.length, 2)
  assert.equal(queries.filter(query => query.includes('requested:')).length, 1)
})

test('every GitHub read that carries a rateLimit updates the points the app knows are left', async () => {
  github({ rateLimit: { remaining: 999 } })
  await fetchLiveStates('token', 'query { rateLimit { remaining } }')
  assert.equal(githubRemainingPoints(), 999)
  github({ viewer: {} })
  await fetchLiveStates('token', 'query { viewer { login } }')
  assert.equal(githubRemainingPoints(), 999, 'an answer without a rateLimit must keep the last known points')
})
