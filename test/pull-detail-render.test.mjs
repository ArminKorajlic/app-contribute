import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'
let renderer
async function render(t, name, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { PullRequestDetail, PullFiles, PullChecks, PullThreads, PullRelated, PullFileTotals } from './ui/PullRequestDetail.jsx'
    const components = { PullRequestDetail, PullFiles, PullChecks, PullThreads, PullRelated, PullFileTotals }
    export function render(name, props) { return renderToStaticMarkup(React.createElement(components[name], props)) }
  `)
  return (await renderer).render(name, props)
}
test('detail opens on the GitHub-style Conversation tab with Files changed and Checks beside it', async t => {
  const html = await render(t, 'PullRequestDetail', { pr: { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/7' } })
  if (!html) return
  assert.match(html, /aria-pressed="true">Conversation/)
  assert.match(html, />Files changed</)
  assert.match(html, />Checks<\/button>/)
  assert.match(html, /wants to merge into <code>main<\/code>/)
  assert.match(html, /Loading description/)
  assert.match(html, /aria-label="Choose what an agent does with PR \d+"/)
})
for (const items of [[], [{ __typename: 'Issue', number: 2, title: 'Usable issue', url: 'https://github.com/team/repo/issues/2', repository: { nameWithOwner: 'team/repo' }, relationships: ['May close'] }]]) {
  test(`partial related context warns and retries with ${items.length} usable items`, async t => {
    const html = await render(t, 'PullRequestDetail', {
      pr: { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/7' },
      cacheStore: { entries: {
        'description:1': { data: { body: 'Description' }, loading: false },
        'activity:1': { data: { items: [] }, loading: false },
        'threads:': { data: { threads: [] }, loading: false },
        related: { data: { items, errors: ['Cross-references are unavailable.'] }, loading: false },
      } },
    })
    if (!html) return
    assert.match(html, /Cross-references are unavailable\./)
    assert.match(html, /role="alert"/)
    assert.match(html, />Retry<\/button>/)
    assert.match(html, /Open on GitHub/)
    if (items.length) assert.match(html, /Issue team\/repo#2 · Usable issue/)
    else assert.doesNotMatch(html, /Related issues &amp; PRs/)
  })
}
test('check outcomes stay written and partial source absence never claims success', async t => {
  const html = await render(t, 'PullChecks', { data: { head: 'a'.repeat(40), page: 2, groups: [{ name: 'Check runs', total: 102, hasMore: false, items: [{ id: 1, name: 'Unit tests', status: 'completed', conclusion: 'failure', details_url: 'javascript:alert(1)' }, { id: 2, name: 'Build', status: 'queued' }] }] } })
  if (!html) return
  assert.match(html, /Unit tests/)
  assert.match(html, /failure/)
  assert.match(html, /queued/)
  assert.match(html, /page 2/)
  assert.match(html, /not an all-clear review/)
  assert.doesNotMatch(html, /href="javascript:/)
})

test('inline review UI distinguishes resolution, old lines, outdated location and truncated replies', async t => {
  const html = await render(t, 'PullThreads', { data: { threads: [
    { id: 't1', path: 'src/file.js', line: 17, startLine: 15, diffSide: 'LEFT', isResolved: true, isOutdated: true, comments: { nodes: [{ id: 'c1', body: 'Please test this', author: { login: 'reviewer' }, url: 'https://github.com/team/repo/pull/7#discussion_r1' }], totalCount: 60, pageInfo: { hasNextPage: true } } },
    { id: 't2', path: 'other.js', originalLine: 9, comments: null },
    { id: 't3', path: 'mixed.js', startLine: 4, startDiffSide: 'LEFT', line: 6, diffSide: 'RIGHT', isResolved: false, comments: { nodes: [] } },
    { id: 't4', path: 'whole-file.js', subjectType: 'FILE', isResolved: false, comments: { nodes: [] } },
  ] } })
  if (!html) return
  assert.match(html, /old line 15–17/)
  assert.match(html, /Resolved/)
  assert.match(html, /Outdated location/)
  assert.match(html, /original line 9/)
  assert.match(html, /Resolution unknown/)
  assert.match(html, /Unresolved/)
  assert.match(html, /old line 4 → new line 6/)
  assert.match(html, /file discussion/)
  assert.match(html, /First 50 of 60 comments/)
  assert.match(html, /Thread comments are unavailable/)
  assert.match(html, /Please test this/)
})
test('related links distinguish issue/PR and disclose bounded reference scope', async t => {
  const html = await render(t, 'PullRelated', { data: { truncated: true, items: [
    { __typename: 'Issue', number: 2, title: 'Issue title', url: 'https://github.com/team/repo/issues/2', repository: { nameWithOwner: 'team/repo' }, relationships: ['May close'] },
    { __typename: 'PullRequest', number: 3, title: 'PR title', url: 'https://github.com/team/repo/pull/3', repository: { nameWithOwner: 'team/repo' }, relationships: ['Mentions this PR'] },
  ] } })
  if (!html) return
  assert.match(html, /Issue team\/repo#2/)
  assert.match(html, /PR team\/repo#3/)
  assert.match(html, /first 50 cross-reference events/)
})
test('PR files use canonical rendered diff, preserve LOC totals and missing patch limitations', async t => {
  const html = await render(t, 'PullFiles', { data: { page: 3, totals: { files: 204, additions: 600, deletions: 220 }, files: [
    { filename: 'file.js', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' },
    { filename: 'binary.png', status: 'added', additions: 0, deletions: 0 },
  ] } })
  if (!html) return
  assert.match(html, /Showing 204 changed files with 600 additions and 220 deletions · page 3/)
  assert.match(html, /diff-view__line--add/)
  assert.match(html, /Diff for file.js/)
  assert.match(html, /binary or too large/)
  assert.match(html, /may omit or shorten large patches/)
})

for (const [additions, deletions, expected] of [
  [2, null, 'Showing 1 changed file with 2 additions.'],
  [null, 3, 'Showing 1 changed file with 3 deletions.'],
  [null, null, 'Showing 1 changed file.'],
  [0, 0, 'Showing 1 changed file with 0 additions and 0 deletions.'],
]) {
  test(`file summary preserves unknown counts (${additions}, ${deletions})`, async t => {
    const html = await render(t, 'PullFiles', { data: { totals: { files: 1, additions, deletions }, files: [] } })
    if (!html) return
    assert.ok(html.includes(expected), html)
    if (additions === null) assert.doesNotMatch(html, /[0-9]+ additions/)
    if (deletions === null) assert.doesNotMatch(html, /[0-9]+ deletions/)
  })
}
