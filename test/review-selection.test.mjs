import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectReviewSelection, reviewSelectionIdFromIntent, selectedReviewRequest } from '../review-selection.js'
import { reviewRunRequest } from '../collaboration.js'
import { followedRepositories, followRepository } from '../repositories.js'
import { attachSourceProjects } from '../source-map.js'

const ID = 'selection-fixture'
const item = { repo:'owner/project', number:7, head_sha:'a'.repeat(40), base_ref:'main', base_sha:'b'.repeat(40) }
const proposal = { request_id:ID, mode:'review_merge', items:[item] }

test('review links name proposals, not an executable action or embedded grant', () => {
  assert.equal(reviewSelectionIdFromIntent('review-selection:' + ID), ID)
  for (const invalid of ['review-selection:../record', 'review-selection:a', 'review-selection:' + ID + '?merge=true']) assert.equal(reviewSelectionIdFromIntent(invalid), null)
  assert.deepEqual(selectedReviewRequest({ ...proposal, chat_approval:{context:'untrusted'}, items:[{ ...item, approval:{source:'chat'} }] }, ID), proposal)
  for (const value of [{ ...proposal, request_id:'another-id' }, { ...proposal, mode:'merge' }, { ...proposal, items:[] }, { ...proposal, items:[item,item] }, { ...proposal, items:[{...item, head_sha:'short'}] }]) assert.throws(() => selectedReviewRequest(value, ID))
})

test('exact proposal inspection never advances its selected versions or writes to GitHub', async t => {
  let changes = {}
  let permission = 'WRITE'
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/github/graphql')
    assert.doesNotMatch(options.body, /mutation/)
    return new Response(JSON.stringify({data:{p0:{ nameWithOwner:'owner/project', viewerPermission:permission, pullRequest:{number:7,title:'A change',url:'https://github.com/owner/project/pull/7',state:'OPEN',headRefOid:item.head_sha,baseRefOid:'d'.repeat(40),baseRef:{target:{oid:item.base_sha}},baseRefName:'main', ...changes} }}}))
  })
  assert.equal((await inspectReviewSelection('fixture', proposal)).canMerge, true)
  permission = 'READ'
  assert.equal((await inspectReviewSelection('fixture', proposal)).canMerge, false)
  for (const change of [{state:'CLOSED'},{headRefOid:'c'.repeat(40)},{baseRef:{target:{oid:'c'.repeat(40)}}},{baseRefName:'another'},{number:8}]) {
    changes = change
    await assert.rejects(inspectReviewSelection('fixture', proposal), /changed or closed/)
  }
})

test('saved prompt and model proposals survive loading without importing consent or runtime authority',()=>{
  const options={review_prompt:'Inspect every changed line',fix_prompt:'Fix scoped findings',merge_prompt:'Merge only ifsafe',max_rounds:2,autopilot:false}
  const agent={provider:'codex',model:'pinned-model',effort:'high'}
  const loaded=selectedReviewRequest({...proposal,mode:'review_fix_merge',options:{...options,approval:'untrusted'},agent,preview_sha256:'c'.repeat(64),resolved_snapshot:{untrusted:true},chat_approval:{context:'untrusted'}},ID)
  assert.deepEqual(loaded.options,{review_prompt:options.review_prompt,merge_prompt:options.merge_prompt,fix_prompt:options.fix_prompt,max_rounds:2},'a takeover link keeps its repair options; automatic continuation is never carried')
  const review=selectedReviewRequest({...proposal,mode:'review',options:{...options,post_review:true},agent,preview_sha256:'c'.repeat(64)},ID)
  assert.deepEqual(review.options,{review_prompt:options.review_prompt,merge_prompt:options.merge_prompt,post_review:true},'a review link carries no repair options')
  assert.deepEqual(loaded.agent,agent)
  assert.equal(loaded.preview_sha256,'c'.repeat(64))
  assert.equal(loaded.chat_approval,undefined)
  assert.equal(loaded.resolved_snapshot,undefined)
  assert.throws(()=>selectedReviewRequest({...proposal,preview_sha256:'invalid'},ID))
})

test('GitHub access does not import unrelated repos; saved work and explicit membership survive offline', () => {
  const repo = {nameWithOwner:'openai/baselines', viewerPermission:'ADMIN', openPullRequestCount:42}
  assert.deepEqual(attachSourceProjects(null, [], [], [repo]), [])
  assert.equal(attachSourceProjects(null, [], [], [], ['openai/baselines'])[0].canonical_repo, 'openai/baselines')
  const records = [{id:'saved',repo:'other/old-project',type:'pr',status:'merged'}]
  assert.equal(attachSourceProjects(null, records)[0].canonical_repo, 'other/old-project')
  const incoming = [{repository:{nameWithOwner:'team/work'}}]
  assert.equal(attachSourceProjects(null, [], incoming)[0].incomingReviews.length, 1)
})

test('following a repository preserves concurrent choices and never grants permissions', async t => {
  const original = globalThis.window
  t.after(() => { globalThis.window = original })
  let writes = 0
  globalThis.window = {mobius:{online:true,storage:{
    getWithVersion:async () => ({value: writes ? ['team/other'] : [], version:'v'+writes}),
    durableWrite:async (_key, value, condition) => {
      writes += 1
      if (writes === 1) throw Object.assign(new Error('concurrent choice'), {code:'conflict'})
      assert.deepEqual(value, ['team/other','team/new'])
      assert.deepEqual(condition, {ifMatch:'v1'})
    },
  }}}
  assert.deepEqual(await followRepository('https://github.com/TEAM/new'), ['team/other','team/new'])
  assert.deepEqual(followedRepositories(['team/new','TEAM/new','bad']), ['team/new'])
  globalThis.window.mobius.online = false
  await assert.rejects(followRepository('team/new'), /Reconnect/)
})

test('saved takeover scopes still load, and none of them grants draft readiness any more',()=>{
  const legacy=selectedReviewRequest({...proposal,mode:'review_fix_merge'},ID)
  assert.equal(legacy.confirmation_scope,undefined)
  for(const confirmation_scope of ['named_pr_repairs_and_reviewed_successors','named_pr_repairs_ready_and_reviewed_successors']) {
    assert.equal(selectedReviewRequest({...proposal,mode:'review_fix_merge',confirmation_scope},ID).confirmation_scope,confirmation_scope)
  }
  assert.throws(()=>selectedReviewRequest({...proposal,confirmation_scope:'named_pr_repairs_ready_and_reviewed_successors'},ID), /permission scope/)
  const older=selectedReviewRequest({...proposal,mode:'review_fix_merge',confirmation_scope:'named_pr_repairs_ready_and_reviewed_successors'},ID)
  assert.equal(reviewRunRequest({...older,pulls:[]}).confirmation_scope,'named_pr_repairs_and_reviewed_successors','an older draft-ready link starts with the repair scope only')
  assert.throws(()=>selectedReviewRequest({...proposal,mode:'review_fix_merge',confirmation_scope:'anything'},ID), /permission scope/)
})
