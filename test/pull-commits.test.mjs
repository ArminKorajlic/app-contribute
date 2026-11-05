import test from 'node:test'
import assert from 'node:assert/strict'
import { authorLine, authorNames, checkWords, commitGroups, madeWithAgent, reviewMarker } from '../pull-commits.js'
import { loadPullCommits } from '../pull-details.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const commit = (oid, extra = {}) => ({ oid: oid.repeat(40).slice(0, 40), abbreviatedOid: oid.repeat(7).slice(0, 7), url: `https://github.com/o/r/commit/${oid}`, messageHeadline: `Commit ${oid}`, messageBody: '', committedDate: '2026-11-05T13:32:53Z',
  authors: { nodes: [{ name: 'octocat', user: { login: 'octocat' } }] }, statusCheckRollup: { state: 'SUCCESS' }, ...extra })

test('authors read like GitHub: one name, "A and B", "A, B and C"; co-authors come from the commit', () => {
  const agent = { name: 'Möbius Agent', user: { login: 'mobius-agent' } }
  assert.deepEqual(authorNames(commit('a', { authors: { nodes: [{ name: 'Sam', user: null }, agent, null] } })), ['Sam', 'mobius-agent'])
  assert.equal(authorLine(['a']), 'a')
  assert.equal(authorLine(['a', 'b']), 'a and b')
  assert.equal(authorLine(['a', 'b', 'c']), 'a, b and c')
  assert.equal(authorLine([]), '')
})

test('a commit made with the agent is marked, by its account or display name, and no one else is', () => {
  assert.equal(madeWithAgent(commit('a', { authors: { nodes: [{ name: 'octocat', user: { login: 'octocat' } }, { name: 'Möbius Agent', user: { login: 'mobius-agent' } }] } })), true)
  assert.equal(madeWithAgent(commit('a', { authors: { nodes: [{ name: 'Mobius Agent', user: null }] } })), true)
  assert.equal(madeWithAgent(commit('a')), false)
  assert.equal(madeWithAgent(commit('a', { authors: null })), false)
})

test('the check result is in words, and a commit with no result says nothing instead of "fail"', () => {
  assert.deepEqual(checkWords(commit('a')), { text: 'checks pass', tone: 'ok' })
  assert.deepEqual(checkWords(commit('a', { statusCheckRollup: { state: 'FAILURE' } })), { text: 'checks fail', tone: 'bad' })
  assert.deepEqual(checkWords(commit('a', { statusCheckRollup: { state: 'PENDING' } })), { text: 'checks running', tone: 'warn' })
  assert.equal(checkWords(commit('a', { statusCheckRollup: null })), null)
  assert.equal(checkWords(null), null)
})

test('commits group by the day they were committed, in GitHub order', () => {
  const groups = commitGroups([commit('a', { committedDate: '2026-11-04T09:00:00Z' }), commit('b', { committedDate: '2026-11-04T10:00:00Z' }), commit('c', { committedDate: '2026-11-05T09:00:00Z' })])
  assert.deepEqual(groups.map(group => group.commits.map(item => item.oid[0])), [['a', 'b'], ['c']])
  assert.deepEqual(commitGroups([]), [])
})

test('the review marker sits after the commit the review covered; a rewritten branch has none', () => {
  const list = [commit('a'), commit('b'), commit('c')]
  assert.deepEqual(reviewMarker(list, list[0].oid), { at: 0, newCount: 2 })
  assert.deepEqual(reviewMarker(list, list[2].oid), { at: 2, newCount: 0 })
  // A force-push drops the reviewed commit: nothing is claimed about which are new.
  assert.deepEqual(reviewMarker(list, 'f'.repeat(40)), { at: -1, newCount: 0 })
  assert.deepEqual(reviewMarker(list, ''), { at: -1, newCount: 0 })
})

test('the commit read asks for one page with its cursor, checks the PR version, and keeps a missing list as an error', async () => {
  const previous = globalThis.fetch
  const sent = []
  const pr = { number: 7, repository: { nameWithOwner: 'o/r' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main' }
  const answer = commits => ({ ok: true, json: async () => ({ data: { repository: { pullRequest: { headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid, baseRefName: 'main', commits } } } }) })
  try {
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return answer({ totalCount: 60, pageInfo: { hasNextPage: true, endCursor: 'Mg' }, nodes: [{ commit: commit('a') }, null] }) }
    const page = await loadPullCommits('token', pr, 'cursor-1')
    assert.equal(sent[0].variables.after, 'cursor-1')
    assert.match(sent[0].query, /commits\(first:50, after:\$after\)/)
    assert.deepEqual([page.commits.length, page.total, page.hasMore, page.nextCursor], [1, 60, true, 'Mg'])
    globalThis.fetch = async () => answer(null)
    const none = await loadPullCommits('token', pr)
    assert.deepEqual(none.commits, [])
    assert.deepEqual(none.errors, ['The commit list is unavailable.'])
    await assert.rejects(loadPullCommits('token', pr, 'x'.repeat(2000)), /Invalid commit cursor/)
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { repository: { pullRequest: { headRefOid: 'c'.repeat(40), baseRefOid: pr.baseRefOid, baseRefName: 'main', commits: { nodes: [] } } } } }) })
    await assert.rejects(loadPullCommits('token', pr), error => error.code === 'stale')
  } finally { globalThis.fetch = previous }
})

let renderer
const screens = () => (renderer ||= renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { PullCommits } from './ui/PullCommits.jsx'
  import { PullRequestDetail } from './ui/PullRequestDetail.jsx'
  export const commits = props => renderToStaticMarkup(React.createElement(PullCommits, props))
  export const detail = props => renderToStaticMarkup(React.createElement(PullRequestDetail, props))
`))

test('the Commits tab shows title, authors, time, checks in words, short hash and a labelled Copy hash', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { commits } = await screens()
  const list = [commit('a', { messageBody: 'Because of the thing.', authors: { nodes: [{ name: 'octocat', user: { login: 'octocat' } }, { name: 'Möbius Agent', user: { login: 'mobius-agent' } }] } }), commit('b', { statusCheckRollup: null })]
  const html = commits({ data: { commits: list, hasMore: false } })
  assert.match(html, /Commits on /)
  assert.match(html, /<strong class="co-commit-title">Commit a<\/strong>/)
  assert.match(html, /octocat and mobius-agent committed <\/span><time/)
  assert.match(html, /checks pass/)
  assert.match(html, /aria-label="Copy hash aaaaaaa"[^>]*>.*?<span>Copy hash<\/span>/)
  assert.match(html, /aria-label="View on GitHub: commit aaaaaaa"/)
  assert.match(html, /<code>aaaaaaa<\/code>/)
  assert.match(html, /Because of the thing\./)
  assert.match(html, /co-commit-agent/)
  assert.equal((html.match(/co-commit-checks/g) || []).length, 1, 'a commit with no result shows no check text')
  assert.doesNotMatch(html, /Last review covered|new commit/)
})

test('after a review, a line shows where it stopped and a banner offers Review again for the new commits', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { commits } = await screens()
  const list = [commit('a'), commit('b'), commit('c')]
  const html = commits({ data: { commits: list, hasMore: false }, reviewedHead: list[0].oid, again: { id: 'review', title: 'Review again' } })
  assert.match(html, /2 new commits since your last review/)
  assert.match(html, /co-btn co-btn-primary">Review again</)
  assert.ok(html.indexOf('Commit a') < html.indexOf('Last review covered up to here') && html.indexOf('Last review covered up to here') < html.indexOf('Commit b'))
  const one = commits({ data: { commits: list.slice(0, 2), hasMore: false }, reviewedHead: list[0].oid, again: null })
  assert.match(one, /1 new commit since your last review/)
  assert.doesNotMatch(one, /Review again/, 'no button when the next review is not yours to start')
  const more = commits({ data: { commits: list.slice(0, 2), hasMore: true }, reviewedHead: list[0].oid })
  assert.match(more, /1\+ new commits/)
  assert.doesNotMatch(commits({ data: { commits: list, hasMore: false }, reviewedHead: list[2].oid }), /new commit/)
  assert.match(commits({ data: { commits: [], hasMore: false } }), /No commits yet\./)
})

test('the PR page puts Commits right after Comments, with GitHub\'s count, and loads the list only when opened', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { detail } = await screens()
  const pr = { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/7', commits: { totalCount: 27 } }
  const html = detail({ pr, cacheStore: { entries: {} } })
  const order = ['Comments', 'Commits', 'Files', 'Checks', 'Review'].map(name => html.indexOf(`>${name}`))
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), `tab order ${order}`)
  assert.match(html, />Commits<span class="co-tab-count">27<\/span>/)
  const opened = detail({ pr, initialTab: 'commits', cacheStore: { entries: { 'description:1': { data: { body: 'x' }, loading: false }, 'commits:': { data: { commits: [commit('a')], hasMore: true, nextCursor: 'Mg' }, loading: false } } } })
  assert.match(opened, /aria-pressed="true">Commits/)
  assert.match(opened, /Commit a/)
  assert.match(opened, /Show more commits/)
})
