import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchIncomingReviews } from '../api.js'

const pr = (number, repo = 'mobius-os/mobius') => ({
  number, url: `https://github.com/${repo}/pull/${number}`, repository: { nameWithOwner: repo },
})

test('only pull requests that ask for the viewer\'s review are flagged as review requests', async () => {
  const original = globalThis.fetch
  let query = ''
  globalThis.fetch = async (url, options) => {
    query = JSON.parse(options.body).query
    return { ok: true, json: async () => ({ data: {
      involved: { nodes: [pr(1912), pr(1925), pr(3, 'mobius-os/app-mobius-you')] },
      requested: { nodes: [pr(1912)] },
    } }) }
  }
  try {
    const rows = await fetchIncomingReviews('token')
    assert.match(query, /review-requested:@me/)
    assert.match(query, /involves:@me/)
    assert.deepEqual(rows.map(row => [row.number, row.reviewRequested === true]), [[1912, true], [1925, false], [3, false]])
  } finally {
    globalThis.fetch = original
  }
})
