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
  assert.match(html, />Files<span class="co-tab-more"> changed<\/span></)
  assert.match(html, />Checks<\/button>/)
  // The header keeps the state and the author; branch names live in the Description fold.
  assert.doesNotMatch(html, /co-branch-flow/)
  assert.match(html, /by <b>/)
  assert.match(html, /Loading the conversation/)
  assert.match(html, /aria-label="Choose an action for PR \d+"/)
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
    assert.match(html, /View on GitHub/)
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

test('the description starts folded and unanswered feedback stays visible under it, its review id copyable from the review itself', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const requested = [{ kind: 'review', id: 777, state: 'CHANGES_REQUESTED', user: { login: 'miljanm' }, date: '2026-11-01T10:00:00Z', body: 'Please fix' }]
  const html = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(requested),
    record: { attention: { type: 'changes_requested', url: 'https://github.com/team/repo/pull/9#pullrequestreview-777' } } })
  if (!html) return
  assert.doesNotMatch(html, /<details class="co-gh-description" open/)
  assert.match(html, /class="co-desc-content"><p class="co-branch-flow" aria-label="Branches"><code>main<\/code>/)
  assert.match(html, /class="co-pr-feedback-flag is-blocker"/)
  assert.match(html, /Changes requested/)
  assert.match(html, /Not addressed yet\. Read the review under Comments/)
  // The banner stays one calm sentence; the id lives on the review it names.
  assert.doesNotMatch(html.slice(html.indexOf('co-pr-feedback-flag'), html.indexOf('</p>', html.indexOf('co-pr-feedback-flag'))), /co-copy-id/)
  assert.match(html, /Copy review id 777/)
})

test('an approving review or a recorded all-clear turns the flag green', async t => {
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

test('more than four comments fold to the first four, Show all reveals the rest in order', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const items = [1, 2, 3, 4, 5, 6].map(n => ({ kind: 'comment', id: n, user: { login: `user${n}` }, date: `2026-10-0${n}T10:00:00Z`, body: `Comment ${n}` }))
  const html = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(items) })
  if (!html) return
  assert.match(html, /Show all 6 comments/)
  assert.match(html, /user1\b/)
  assert.match(html, /user4\b/)
  assert.doesNotMatch(html, /user5\b|user6\b/) // the later ones wait behind Show all
  const few = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(items.slice(0, 4)) })
  assert.doesNotMatch(few, /Show all|co-comments-toggle/)
})

test('tabs carry GitHub-style count pills: comments, files and a checks dot, no inline diff stats', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', headRefName: 'fix/thing', url: 'https://github.com/team/repo/pull/9', changedFiles: 11, additions: 637, deletions: 45, comments: { totalCount: 2 },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 42, checkRunCountsByState: [{ state: 'SUCCESS', count: 38 }, { state: 'FAILURE', count: 4 }], statusContextCountsByState: [] } } } }] } }
  const items = [1, 2, 3, 4].map(n => ({ kind: 'comment', id: n, user: { login: `u${n}` }, date: `2026-10-0${n}T10:00:00Z`, body: `C${n}` }))
  const html = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(items) })
  if (!html) return
  assert.match(html, /Comments<span class="co-tab-count">4<\/span>/)
  assert.match(html, /Files<span class="co-tab-more"> changed<\/span><span class="co-tab-count">11<\/span>/)
  assert.match(html, /co-tab-dot is-failure/)
  // Passed over total stays readable beside the dot.
  assert.match(html, /Checks<span[^>]*class="co-tab-dot is-failure"[^>]*><\/span><span class="co-tab-count">38\/42<\/span>/)
  assert.doesNotMatch(html, /co-change-total/) // the +adds −dels stay inside the Files tab
})

test('several chats of one kind fold into one Open chat dropdown, one stays a plain button', async t => {
  const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
  const two = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(), provenance: [
    { chat_id: 'c1', role: 'source', title: 'Build the thing' },
    { chat_id: 'c2', role: 'source', title: 'Fix the thing' },
    { chat_id: 'c3', role: 'review', title: 'Review it' },
  ] })
  if (!two) return
  assert.match(two, /aria-label="Open chat · 2 where it started" data-tip="Open chat · 2 where it started"/)
  assert.match(two, /co-chat-group/)
  assert.doesNotMatch(two, /Where it started #1/) // the list opens on demand, closed by default
  assert.match(two, /aria-label="Open chat · review" data-tip="Open chat · review · Review it"/) // a single review chat stays a plain icon button, its own title in the tooltip
  const one = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(), provenance: [{ chat_id: 'c1', role: 'source', title: 'Build the thing' }] })
  assert.match(one, /aria-label="Open chat" data-tip="Open chat · Build the thing"/, 'a PR with one chat says Open chat, then that chat\'s title')
  const plain = await render(t, 'PullRequestDetail', { pr, cacheStore: loadedConversation(), provenance: [{ chat_id: 'c1', role: 'source', title: 'Source conversation' }] })
  assert.match(plain, /aria-label="Open chat" data-tip="Open chat"/, 'a stand-in role title is not repeated in the tooltip')
  assert.doesNotMatch(one, /where it started|co-chat-group/)
})

test('files read as one line each, coloured by change, and filter once the list is long', async t => {
  const file = (name, extra = {}) => ({ filename: name, status: 'modified', additions: 4, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b', ...extra })
  const few = await render(t, 'PullFiles', { data: { totals: { files: 2, additions: 8, deletions: 2 }, files: [file('a.js'), file('b.js', { status: 'added' })] } })
  if (!few) return
  assert.match(few, /<span class="co-file-name">a\.js<\/span><span class="co-file-stat"><b class="co-file-add">\+4<\/b><b class="co-file-del">−1<\/b>/)
  // A plain modified file needs no status; an added one says so.
  assert.doesNotMatch(few, /co-file-status">modified/)
  assert.match(few, /co-file-status">added/)
  assert.doesNotMatch(few, /co-file-tools/)
  const many = await render(t, 'PullFiles', { data: { totals: { files: 12, additions: 48, deletions: 12 }, files: Array.from({ length: 12 }, (_, index) => file(`f${index}.js`)) } })
  assert.match(many, /aria-label="Filter files by name"/)
  assert.match(many, />Expand all</)
})

test('the secondary PR actions are icon buttons that keep a name for screen readers and show it in a tooltip', async t => {
  const html = await render(t, 'PullRequestDetail', { pr: { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/7' } })
  if (!html) return
  assert.match(html, /aria-label="View on GitHub: PR 7" data-tip="View on GitHub"/)
  const css = (await import('node:fs')).readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-pr-detail \.co-tab-more \{ display:none/)
  // The checks dot says pass or fail on a phone; the passed/total pill needs room the Review tab uses.
  assert.match(css, /\.co-pr-detail \.co-tab-dot \+ \.co-tab-count \{ display:none/)
})
