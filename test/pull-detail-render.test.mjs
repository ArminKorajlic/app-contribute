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
test('detail opens on the GitHub-style Comments tab with Files changed and Checks beside it', async t => {
  const html = await render(t, 'PullRequestDetail', { pr: { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/7' } })
  if (!html) return
  assert.match(html, /aria-pressed="true">Comments/)
  assert.match(html, />Files changed</)
  assert.match(html, />Checks<\/button>/)
  // Bitbucket-style flow: head branch → target, then the author.
  assert.match(html, /co-branch-flow/)
  assert.match(html, /<code>main<\/code>/)
  assert.match(html, /by <b>/)
  assert.match(html, /Loading the conversation/)
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
    if (items.length) {
      // A boxed row with the issue icon, the title leading, and the reference line under it.
      assert.match(html, /class="co-related-row"/)
      assert.match(html, /co-related-icon is-issue/)
      assert.match(html, /<strong>Usable issue<\/strong>/)
      assert.match(html, /Issue team\/repo#2 · May close/)
    }
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

const loadedConversation = (items = []) => ({ entries: {
  'description:1': { data: { body: 'Body' }, loading: false },
  'activity:1': { data: { items }, loading: false },
  'threads:': { data: { threads: [] }, loading: false },
  related: { data: { items: [] }, loading: false },
} })

test('the description starts folded and unanswered feedback stays visible under it with its review id', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const html = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(),
    record: { attention: { type: 'changes_requested', url: 'https://github.com/team/repo/pull/9#pullrequestreview-777' } } })
  if (!html) return
  assert.doesNotMatch(html, /<details class="co-gh-description" open/)
  assert.match(html, /class="co-pr-feedback-flag is-blocker"/)
  assert.match(html, /Changes requested/)
  assert.match(html, /not addressed yet/)
  assert.match(html, /Copy review id 777/)
})

test('an approving review or a recorded all-clear turns the flag green with the review id', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const approving = [{ kind: 'review', id: 555, state: 'APPROVED', user: { login: 'irfan' }, date: '2026-11-01T10:00:00Z', body: 'LGTM' }]
  const viaReview = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(approving),
    record: { attention: { type: 'github_activity', url: 'https://github.com/team/repo/pull/9#pullrequestreview-555' } } })
  if (!viaReview) return
  assert.match(viaReview, /class="co-pr-feedback-flag is-clear"/)
  assert.match(viaReview, /Review clear/)
  assert.match(viaReview, /Copy review id 555/)
  const viaRun = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(),
    record: { attention: { type: 'github_activity', url: 'https://github.com/team/repo/pull/9#pullrequestreview-888' } },
    status: { item: { state: 'all_clear', public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-888' } } } })
  assert.match(viaRun, /is-clear/)
  assert.match(viaRun, /Copy review id 888/)
})

test('a PR without your tracked record, or with answered feedback, carries no feedback flag', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const bare = await render(t, 'PullRequestDetail', { pr })
  if (!bare) return
  assert.doesNotMatch(bare, /co-pr-feedback-flag/)
  const answered = await render(t, 'PullRequestDetail', { pr, record: { attention: null } })
  assert.doesNotMatch(answered, /co-pr-feedback-flag/)
})

test('comments carry their verdict color, a clock time, a Show more clamp, and no View link', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const html = await render(t, 'PullRequestDetail', { pr, cacheStore: { entries: {
    'description:1': { data: { body: 'Body' }, loading: false },
    'activity:1': { data: { items: [
      { kind: 'review', id: 1, state: 'CHANGES_REQUESTED', user: { login: 'miljanm' }, date: '2026-10-30T21:40:00Z', body: 'Please fix', html_url: 'https://github.com/x' },
      { kind: 'review', id: 2, state: 'APPROVED', user: { login: 'irfan' }, date: '2026-10-30T22:05:00Z', body: 'LGTM', html_url: 'https://github.com/y' },
      { kind: 'comment', id: 3, user: { login: 'armin' }, date: '2026-10-31T08:15:00Z', body: 'Note', html_url: 'https://github.com/z' },
    ] }, loading: false },
    'threads:': { data: { threads: [] }, loading: false },
    related: { data: { items: [] }, loading: false },
  } } })
  if (!html) return
  assert.match(html, /co-gh-comment is-changes/)
  assert.match(html, /co-gh-comment is-approved/)
  assert.match(html, /class="co-gh-comment"[\s\S]*?armin/) // plain comment keeps the quiet border
  assert.match(html, / · \d{2}:\d{2}</) // time beside the date
  assert.doesNotMatch(html, />View<\/a>/)
  assert.match(html, /co-comment-body/)
  assert.match(html, /class="co-desc-body/)
  // Every comment header carries its copyable id after the time.
  assert.match(html, /Copy review id 1/)
  assert.match(html, /Copy comment id 3/)
})

test('a fresh read shows a skeleton, never a Loading sentence', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const html = await render(t, 'PullRequestDetail', { pr })
  if (!html) return
  // One skeleton stands in for the whole conversation: no separate
  // description/comments loaders, no partial reveal.
  assert.match(html, /class="co-skel" role="status" aria-label="Loading the conversation"/)
  assert.doesNotMatch(html, /Loading comments…|Loading description…/)
  assert.doesNotMatch(html, /co-gh-description/)
  assert.equal((html.match(/class="co-skel"/g) || []).length, 1)
})

test('more than three comments fold to the newest three with Show all at the end', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const items = [1, 2, 3, 4, 5].map(n => ({ kind: 'comment', id: n, user: { login: `user${n}` }, date: `2026-10-0${n}T10:00:00Z`, body: `Comment ${n}` }))
  const html = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(items) })
  if (!html) return
  assert.match(html, /Show all 5 comments/)
  assert.doesNotMatch(html, /user1\b|user2\b/) // the two oldest wait behind Show all
  assert.match(html, /user3/)
  assert.match(html, /user5/)
  const few = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(items.slice(0, 3)) })
  assert.doesNotMatch(few, /Show all|co-comments-toggle/)
})

test('tabs carry GitHub-style count pills: comments, files and a checks dot, no inline diff stats', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', headRefName: 'fix/thing', url: 'https://github.com/team/repo/pull/9', changedFiles: 11, additions: 637, deletions: 45, comments: { totalCount: 2 },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 42, checkRunCountsByState: [{ state: 'SUCCESS', count: 38 }, { state: 'FAILURE', count: 4 }], statusContextCountsByState: [] } } } }] } }
  const items = [1, 2, 3, 4].map(n => ({ kind: 'comment', id: n, user: { login: `u${n}` }, date: `2026-10-0${n}T10:00:00Z`, body: `C${n}` }))
  const html = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(items) })
  if (!html) return
  assert.match(html, /Comments<span class="co-tab-count">4<\/span>/)
  assert.match(html, /Files changed<span class="co-tab-count">11<\/span>/)
  assert.match(html, /co-tab-dot is-failure/)
  assert.match(html, /Checks<span[^>]*class="co-tab-dot is-failure"[^>]*><\/span><span class="co-tab-count">42<\/span>/)
  assert.doesNotMatch(html, /co-change-total|38\/42/)
})
