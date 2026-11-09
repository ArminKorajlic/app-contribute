import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPullVersion, loadAllPullActivity, loadAllPullThreads, loadPullDescription, loadPullFiles, loadPullActivity, pullPath } from '../pull-details.js'
import { addressItems } from '../address-feedback.js'
const pr = { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main' }
const detail = () => ({ head: {sha:pr.headRefOid}, base: {sha:pr.baseRefOid,ref:pr.baseRefName}, body: 'Description' })
const response = data => new Response(JSON.stringify(data))
test('read paths cannot escape the selected repository', () => {
  assert.equal(pullPath(pr),'repos/team/repo/pulls/7')
  for (const name of ['../repo','x/y/z','https://evil.test/repo']) assert.throws(()=>pullPath({...pr,repository:{nameWithOwner:name}}))
  assert.throws(()=>pullPath({...pr,number:0}))
})
test('each component of the selected head and base is required', () => {
  assert.deepEqual(assertPullVersion(pr,detail()),detail())
  for (const field of ['head','base']) { const changed=detail();changed[field].sha='c'.repeat(40);assert.throws(()=>assertPullVersion(pr,changed),{code:'stale'}) }
  const changed=detail();changed.base.ref='release';assert.throws(()=>assertPullVersion(pr,changed),{code:'stale'})
})
test('descriptions are GET-only and do not fetch file patches', async t => {
  const calls=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return response(detail())})
  assert.equal((await loadPullDescription('fixture',pr)).body,'Description')
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);assert.ok(!calls[0].url.includes('/files'))
})
test('file page rejects a changed branch rather than showing stale diff evidence', async t => {
  t.mock.method(globalThis,'fetch',async url => response(url.includes('/files?') ? [{filename:'file.js',patch:'+changed'}] : {...detail(),head:{sha:'c'.repeat(40)}}))
  await assert.rejects(loadPullFiles('fixture',pr),{code:'stale'})
})
test('file pages retain absent binary patches and disclose the provider cap', async t => {
  t.mock.method(globalThis,'fetch',async url=>response(url.includes('/files?')?Array.from({length:100},(_,i)=>({filename:'file'+i})):detail()))
  const first=await loadPullFiles('fixture',pr);assert.equal(first.hasMore,true);assert.equal(first.files[0].patch,undefined)
  const last=await loadPullFiles('fixture',pr,30);assert.equal(last.hasMore,false);assert.equal(last.capped,true)
  await assert.rejects(loadPullFiles('fixture',pr,31))
})
test('activity retains successful comments when reviews fail and reports the failure', async t => {
  t.mock.method(globalThis,'fetch',async url=>url.includes('/reviews?')?new Response('',{status:503}):response([{id:1,body:'Question',created_at:'2026-09-07T12:00:00Z'}]))
  const result=await loadPullActivity('fixture',pr)
  assert.equal(result.items.length,1);assert.equal(result.items[0].kind,'comment');assert.equal(result.errors.length,1)
})

test('file boundaries and LOC come from full PR totals, not current-page sums', async t => {
  const files = Array.from({ length: 100 }, (_, i) => ({ filename: `file${i}`, additions: 1, deletions: 0 }))
  t.mock.method(globalThis, 'fetch', async url => response(url.includes('/files?') ? files : { ...detail(), changed_files: 100, additions: 400, deletions: 220 }))
  const result = await loadPullFiles('fixture', pr)
  assert.deepEqual(result.totals, { files: 100, additions: 400, deletions: 220 })
  assert.equal(result.hasMore, false)
  assert.equal(result.paginationUnknown, false)
})

test('one quiet retry covers a dropped connection or a GitHub 5xx, nothing else', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return calls === 1 ? new Response('{}', { status: 502 }) : response(detail()) })
  assert.equal((await loadPullDescription('fixture', pr)).body, 'Description')
  assert.equal(calls, 2)
  calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; throw new TypeError('network') })
  await assert.rejects(loadPullDescription('fixture', pr), /no connection/)
  assert.equal(calls, 2)
  calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return new Response('{}', { status: 404 }) })
  await assert.rejects(loadPullDescription('fixture', pr), /HTTP 404/)
  assert.equal(calls, 1)
})

// What the Address feedback checklist reads: every page, not the first.
const threadsPage = (nodes, next) => response({ data: { repository: { pullRequest: {
  headRefOid: pr.headRefOid, baseRefOid: pr.baseRefOid, baseRefName: pr.baseRefName,
  reviewThreads: { pageInfo: { hasNextPage: !!next, endCursor: next }, nodes },
} } } })
const thread = (id, isResolved) => ({ id: `t${id}`, path: `file${id}.js`, line: id, isResolved, comments: { nodes: [] } })

test('a thread on a later page still reaches the checklist, and the list is not marked partial', async t => {
  const resolved = Array.from({ length: 50 }, (_, index) => thread(index, true))
  const cursors = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const after = JSON.parse(options.body).variables.after
    cursors.push(after)
    return after === 'page-2' ? threadsPage([thread(99, false)], null) : threadsPage(resolved, 'page-2')
  })
  const result = await loadAllPullThreads('fixture', pr)
  assert.deepEqual(cursors, [null, 'page-2'])
  assert.equal(result.threads.length, 51)
  assert.equal(result.partial, false)
  const items = addressItems(pr, { threads: result.threads })
  assert.equal(items[0].label, '1 open discussion thread')
})

test('a verdict on a later activity page supersedes an earlier request for changes', async t => {
  const pages = []
  t.mock.method(globalThis, 'fetch', async url => {
    const page = Number(/[?&]page=(\d+)/.exec(url)[1])
    if (url.includes('/issues/')) return response(page === 1 ? Array.from({ length: 50 }, (_, index) => ({ id: 100 + index, body: 'note', user: { login: 'owner' }, created_at: `2026-11-01T10:${String(index).padStart(2, '0')}:00Z` })) : [])
    pages.push(page)
    const review = (id, state, at) => ({ id, state, user: { login: 'irfan' }, body: '', html_url: `https://github.com/team/repo/pull/7#pullrequestreview-${id}`, submitted_at: at })
    return response(page === 1 ? [review(1, 'CHANGES_REQUESTED', '2026-11-01T09:00:00Z')] : [review(2, 'APPROVED', '2026-11-03T09:00:00Z')])
  })
  const result = await loadAllPullActivity('fixture', pr)
  assert.deepEqual(pages, [1, 2])
  assert.equal(result.partial, false)
  // The merged conversation is in time order, so the approval counts as the latest verdict.
  assert.equal(result.items.at(-1).state, 'APPROVED')
  assert.deepEqual(addressItems({ ...pr, author: { login: 'owner' } }, { activity: result.items }).map(item => item.key), [])
})

test('reading stops at a page limit or a failed page and says the list is partial; a first-page failure still fails', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return threadsPage([thread(calls, true)], `page-${calls + 1}`) })
  const capped = await loadAllPullThreads('fixture', pr)
  assert.equal(calls, 20)
  assert.equal(capped.threads.length, 20)
  assert.equal(capped.partial, true)
  calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return calls === 1 ? threadsPage([thread(1, false)], 'page-2') : new Response('{}', { status: 404 }) })
  const failedLater = await loadAllPullThreads('fixture', pr)
  assert.equal(failedLater.threads.length, 1)
  assert.equal(failedLater.partial, true)
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }))
  await assert.rejects(loadAllPullThreads('fixture', pr))
})
