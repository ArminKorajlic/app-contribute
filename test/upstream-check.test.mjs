import assert from 'node:assert/strict'
import test from 'node:test'
import { readUpstreamCheck, upstreamCheckQuery, upstreamCheckSummary, upstreamCheckTargets } from '../upstream-check.js'

const sha = 'a'.repeat(40)
const projects = [
  { key: 'platform', name: 'Möbius', kind: 'platform', available: true, canonical_repo: 'mobius-os/mobius', base_sha: sha },
  { key: 'app:1', name: 'Kanban', kind: 'app', available: true, canonical_repo: 'mobius-os/app-kanban', base_sha: 'b'.repeat(40) },
  { key: 'local', name: 'Mine', kind: 'app', available: true, builtHere: true, canonical_repo: null, base_sha: sha },
  { key: 'external:x', name: 'Other', kind: 'external', available: true, canonical_repo: 'x/y', base_sha: sha },
  { key: 'app:2', name: 'No base', kind: 'app', available: true, canonical_repo: 'mobius-os/app-x', base_sha: 'accepted' },
]

test('Check GitHub asks only about installed GitHub projects with a known compared commit', () => {
  assert.deepEqual(upstreamCheckTargets(projects).map(target => target.key), ['platform', 'app:1'])
})

test('one read-only query compares each project with its compared commit, safely quoted', () => {
  const query = upstreamCheckQuery(upstreamCheckTargets(projects))
  assert.match(query, /^query \{ p0: repository\(owner: "mobius-os", name: "mobius"\)/)
  assert.match(query, new RegExp(`compare\\(headRef: "${sha}"\\) \\{ behindBy status \\}`))
  assert.doesNotMatch(query, /mutation/)
  assert.equal(upstreamCheckQuery([]), null)
})

test('an unanswered repository is left out rather than reported up to date', () => {
  const targets = upstreamCheckTargets(projects)
  const results = readUpstreamCheck(targets, { p0: { defaultBranchRef: { compare: { behindBy: 4, status: 'BEHIND' } } }, p1: null }, 'when')
  assert.deepEqual(results, { platform: { newCommits: 4, checkedAt: 'when' } })
})

test('the check result is one plain sentence for every outcome', () => {
  assert.equal(upstreamCheckSummary(null, projects), 'Could not reload this Möbius. Try again.')
  assert.match(upstreamCheckSummary({ ok: true, upstream: null }, projects), /Connect GitHub/)
  assert.match(upstreamCheckSummary({ ok: true, upstream: { ok: false, results: {} } }, projects), /could not be reached/)
  const quiet = { platform: { newCommits: 0 }, 'app:1': { newCommits: 0 } }
  assert.equal(upstreamCheckSummary({ ok: true, upstream: { ok: true, results: quiet } }, projects), 'Nothing new on GitHub.')
  const moved = { platform: { newCommits: 2 }, 'app:1': { newCommits: 1 } }
  assert.equal(upstreamCheckSummary({ ok: true, upstream: { ok: true, results: moved } }, projects), 'New on GitHub: Möbius and Kanban.')
})

test('a project GitHub did not answer for is never summarised as nothing new', () => {
  assert.equal(upstreamCheckSummary({ ok: true, upstream: { ok: true, results: {} } }, projects), 'Couldn’t check Möbius and Kanban.')
  const partial = { platform: { newCommits: 3 } }
  assert.equal(upstreamCheckSummary({ ok: true, upstream: { ok: true, results: partial } }, projects), 'New on GitHub: Möbius. Couldn’t check Kanban.')
  const local = projects.filter(project => project.builtHere)
  assert.match(upstreamCheckSummary({ ok: true, upstream: { ok: true, results: {} } }, local), /Nothing here can be compared/)
})
