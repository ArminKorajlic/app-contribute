import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const pr = { number: 42, title: 'Keep PR actions stable', repository: { nameWithOwner:'team/repo', viewerPermission:'WRITE' }, headRefOid:'a'.repeat(40), baseRefOid:'b'.repeat(40), baseRefName:'main', url:'https://github.com/team/repo/pull/42', author:{ login:'maker' } }
let renderer
async function render(t, name, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { PullRequests } from './ui/PullRequests.jsx'
    import { ReviewConfirmation } from './ui/ReviewConfirmation.jsx'
    import { PullRequestDetail } from './ui/PullRequestDetail.jsx'
    import { RunDetail } from './ui/RunDetail.jsx'
    export { draftCapabilityBlocker, publicChoice } from './ui/ReviewConfirmation.jsx'
    export function render(name, props) { return renderToStaticMarkup(React.createElement({ ReviewConfirmation, PullRequestDetail, PullRequests, RunDetail }[name], props)) }
  `)
  return (await renderer).render(name, props)
}
async function renderModuleExports(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return {} }
  await render(t, 'ReviewConfirmation', { choice:null })
  return await renderer
}

test('the review window names the job and the exact PR, and waits for the workflow check before starting', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review', request_id:'fixed' }, busy:false, disabled:true, onModeChange:() => {} })
  if (!html) return
  assert.match(html, /<h3[^>]*>Review only<\/h3>/)
  assert.match(html, /#42 Keep PR actions stable/)
  assert.match(html, /What happens/)
  assert.match(html, /Seen on GitHub:<\/strong> nothing\. Only you see the review\./)
  assert.match(html, /Exact versions/)
  assert.match(html, /disabled="">Start private review/)
  const takeover = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review_fix_merge' }, onModeChange:() => {} })
  assert.match(takeover, /<h3[^>]*>Review, fix and merge<\/h3>/)
  assert.match(takeover, /Allow fix and merge/)
})

test('no automatic-continuation option is offered, because the platform does not support it', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review' }, onModeChange:()=>{}, onOptionsChange:()=>{} })
  if (!html) return
  assert.match(html, /Review only/)
  assert.doesNotMatch(html, /Continue private review automatically|autopilot/i)
})

test('drafts explain unavailable choices instead of hiding them', async t => {
  const review = await render(t, 'ReviewConfirmation', { choice:{ pulls:[{...pr,isDraft:true}], mode:'review' }, busy:false, onModeChange:() => {} })
  if (!review) return
  assert.match(review, /Merge when safe/)
  assert.match(review, /Not available for drafts\./)
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[{...pr,isDraft:true}], mode:'review_fix_merge' }, busy:false, onModeChange:() => {} })
  // Initial render is the loading state: it must say so, not claim a missing update.
  assert.match(html, /Checking what this Möbius supports…/)
  assert.doesNotMatch(html, /needs the Möbius update/)
  assert.match(html, /disabled="">Allow fix and merge/)
})

test('draft capability copy separates loading, unsupported and supported', async t => {
  const { draftCapabilityBlocker } = await renderModuleExports(t)
  if (!draftCapabilityBlocker) return
  assert.equal(draftCapabilityBlocker({ drafts:true, capabilities:null, saved:false, allowDraft:false }), 'Checking draft support…')
  assert.match(draftCapabilityBlocker({ drafts:true, capabilities:{}, saved:false, allowDraft:false }), /needs the Möbius update/)
  assert.equal(draftCapabilityBlocker({ drafts:true, capabilities:{ draft_takeover:true }, saved:false, allowDraft:true }), '')
  assert.equal(draftCapabilityBlocker({ drafts:false, capabilities:null, saved:false, allowDraft:false }), '')
  assert.equal(draftCapabilityBlocker({ drafts:true, capabilities:null, saved:true, allowDraft:false }), '')
})

test('compact takeover preserves every public-scope and Stop condition', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review_fix_merge' }, busy:false, disabled:true, onModeChange:() => {} })
  if (!html) return
  // Pushes, independent review, required checks, no comments or unrelated edits, and Stop.
  for (const phrase of ['pushes fixes for what it finds', 'A second agent reviews every fix', 'required checks', 'No comments, and nothing outside this PR', 'You can stop it at any time. An action already underway may finish.']) assert.ok(html.includes(phrase), phrase)
})

test('phone search has a named expandable action while the field stays available', async t => {
  const html = await render(t, 'PullRequests', { conn:{state:'connected',login:'owner'}, project:{canonical_repo:'team/repo'}, records:[] })
  if (html === null) return
  assert.ok(html.length > 0, 'The actual component must render before checking its controls')
  assert.match(html, /aria-label="Search pull requests" aria-expanded="false"/)
  assert.match(html, /aria-label="Find a pull request"/)
})

test('detail keeps actions and tabs outside reserved independently loaded context', async t => {
  const html = await render(t, 'PullRequestDetail', { pr, canAssign:true, canMerge:true })
  if (html === null) return
  assert.ok(html.length > 0, 'The actual component must render before checking its controls')
  const actions = html.indexOf('co-pr-detail-actions')
  const tabs = html.indexOf('co-detail-tabs')
  const body = html.indexOf('co-pr-detail-body')
  assert.ok(actions > 0 && tabs > actions && body > tabs)
  assert.match(html, /aria-label="Choose an action for PR 42"/)
 assert.match(html, /<span class="co-btn-label">Assign<\/span><\/button>/)
  assert.match(html, /Loading the conversation/)
  assert.doesNotMatch(html, /Take over review &amp; merge/)
})


test('live-list approval discloses current same-target binding while saved selections stay base-pinned', async t => {
  const choice={mode:'review_merge',pulls:[{...pr,baseRef:{target:{oid:pr.baseRefOid}}}]}
  const live=await render(t,'ReviewConfirmation',{choice,bindCurrentTarget:true})
  if(live===null)return
  assert.match(live,/merges into the newest version of the target branch/)
  assert.match(live,/If its code changes before the start, you confirm again/)
  assert.match(live,/last seen bbbbbbb/)
  assert.doesNotMatch(live,/Exact versions/)
  const pinned=await render(t,'ReviewConfirmation',{choice})
  assert.match(pinned,/Exact versions/)
  assert.match(pinned,/aaaaaaa → main \(bbbbbbb\)/)
  assert.doesNotMatch(pinned,/newest version of the target branch|last seen/)
})

test('unwritable source forks explain why repair-and-merge is unavailable', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[{...pr, headRepository:{ nameWithOwner:'fork/repo', viewerPermission:'READ' }}], mode:'review_fix_merge' }, onModeChange:()=>{} })
  if (!html) return
  assert.match(html, /Requires push access/)
  assert.match(html, /disabled="">Allow fix and merge/)
})


test('draft-ready launch explicitly names marking ready without adding routine scope clutter', async t => {
  const html=await render(t,'ReviewConfirmation',{choice:{pulls:[{...pr,isDraft:true}],mode:'review_fix_merge',confirmation_scope:'named_pr_repairs_ready_and_reviewed_successors'},onModeChange:()=>{}})
  if(!html)return
  assert.match(html,/It marks the draft ready for review\./)
  assert.match(html,/the draft marked ready \(this may notify reviewers\)/)
})

test('drafting a review for GitHub is an opt-in inside Review only, shown only when the server supports it', async t => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../ui/ReviewConfirmation.jsx', import.meta.url), 'utf8'))
  const canDraft = /const canDraft = !!onOptionsChange && capabilities\?\.post_review === true && capabilities\?\.propose_verdict === true/
  assert.match(source, canDraft)
  // Agents never post a comment on their own: the old switches that allowed one are gone.
  assert.doesNotMatch(source, /Allow posting the review on GitHub|Allow approve or request changes/)
  const unresolved = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review', request_id:'fixed' }, onModeChange:()=>{}, onOptionsChange:()=>{} })
  if (!unresolved) return
  assert.doesNotMatch(unresolved, /Draft for GitHub/, 'hidden until the served capability is known')
})

test('posting, verdict and merge combine only as far as the served Möbius supports', async t => {
  const { publicChoice } = await renderModuleExports(t)
  if (!publicChoice) return
  const all = { post_review: true, propose_verdict: true, post_review_merge: true }
  const choice = mode => ({ mode, pulls: [pr], options: { post_review: true, propose_verdict: true } })
  assert.deepEqual(publicChoice(choice('review_merge'), null, all), { merge: true, posting: true, verdict: true })
  // An older Möbius posts only in plain review and never proposes verdicts. A saved grant keeps saying so.
  assert.deepEqual(publicChoice(choice('review_merge'), null, { post_review: true }), { merge: true, posting: false, verdict: false })
  assert.deepEqual(publicChoice(choice('review'), null, { post_review: true }), { merge: false, posting: true, verdict: false })
  // A verdict without posting is not a choice, and neither is posting without a verdict.
  assert.equal(publicChoice({ mode: 'review', pulls: [pr], options: { propose_verdict: true } }, null, all).verdict, false)
})

test('the Review and merge window drafts the verdict by itself and asks only whether to merge', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review_merge', intent:'merge', request_id:'fixed', options:{ post_review:true, propose_verdict:true } },
    capabilities:{ post_review:true, post_review_merge:true, propose_verdict:true }, onModeChange:()=>{}, onOptionsChange:()=>{} })
  if (!html) return
  assert.doesNotMatch(html, /Approve or request changes<|Allow approve or request changes/)
  assert.match(html, />Merge when safe</)
  assert.match(html, /Start review, merge after your approval/)
})

const verdictRun = (state, extra = {}) => ({ id:'run-1', mode:'review_merge', state:'needs_you', chat_id:'chat-1', can_stop:true, items:[{
  repo:'team/repo', number:42, head_sha:'a'.repeat(40), base_ref:'main', base_sha:'b'.repeat(40), state:'verdict_pending', summary:'Looks right.',
  verdict_proposal:{ id:'f'.repeat(32), state, event:'APPROVE', body:'**Möbius review: Approved**\n\nLooks right.', ...extra } }] })

test('a proposed verdict shows its exact words with your own Submit and Discard', async t => {
  const html = await render(t, 'RunDetail', { run: verdictRun('proposed'), pulls:[pr], listState:{}, onVerdict:()=>{} })
  if (!html) return
  assert.match(html, /Proposed verdict: Approve\. Nothing is on GitHub yet\./)
  assert.match(html, /Möbius review: Approved/)
  assert.match(html, />Approve on GitHub</)
  assert.match(html, />Discard</)
  assert.match(html, /merges the PR only if all required checks pass/)
})

test('a settled or foreign verdict offers no decision', async t => {
  const posted = await render(t, 'RunDetail', { run: verdictRun('posted', { url:'https://github.com/team/repo/pull/42#r' }), pulls:[pr], listState:{}, onVerdict:()=>{} })
  if (!posted) return
  assert.match(posted, /Approve submitted on GitHub\./)
  assert.match(posted, /View it on GitHub/)
  assert.doesNotMatch(posted, />Discard</)
  const noHandler = await render(t, 'RunDetail', { run: verdictRun('proposed'), pulls:[pr], listState:{} })
  assert.doesNotMatch(noHandler, />Approve on GitHub</)
})

test('Review starts private and offers who sees it; Review and merge asks only whether to merge', async t => {
  const caps = { post_review:true, post_review_merge:true, propose_verdict:true }
  const privateHtml = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review', intent:'review', options:{ post_review:false, propose_verdict:false } }, capabilities:caps, onModeChange:()=>{}, onOptionsChange:()=>{} })
  if (!privateHtml) return
  assert.match(privateHtml, /<h3[^>]*>Review<\/h3>/)
  assert.match(privateHtml, /role="radiogroup" aria-label="Who sees the result"/)
  assert.match(privateHtml, /aria-checked="true" class="is-on"[^>]*>Only me</)
  assert.doesNotMatch(privateHtml, /co-rw-options|Merge when safe/)
  assert.match(privateHtml, /Seen on GitHub:<\/strong> nothing/)
  assert.match(privateHtml, /Start private review/)
  const drafting = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review', intent:'review', options:{ post_review:true, propose_verdict:true } }, capabilities:caps, onModeChange:()=>{}, onOptionsChange:()=>{} })
  assert.match(drafting, /aria-checked="true" class="is-on"[^>]*>Draft for GitHub</)
  assert.match(drafting, /Nothing is posted until you confirm it\. It waits under To confirm/)
  assert.doesNotMatch(drafting, /Merge when safe|Approve or request changes</)
  assert.match(drafting, /Start review, propose a verdict/)
  const merge = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review_merge', intent:'merge', options:{ post_review:true, propose_verdict:true } }, capabilities:caps, onModeChange:()=>{}, onOptionsChange:()=>{} })
  assert.match(merge, /<h3[^>]*>Review and merge<\/h3>/)
  assert.doesNotMatch(merge, /Allow posting the review on GitHub|Approve or request changes</)
  assert.match(merge, />Merge when safe</)
})

test('on your own PR the window only checks it for you: nothing to choose, nothing posted or merged', async t => {
  const caps = { post_review:true, post_review_merge:true, propose_verdict:true }
  const own = { ...pr, author:{ login:'me' } }
  const html = await render(t, 'ReviewConfirmation', { ownLogin:'me', choice:{ pulls:[own], mode:'review_merge', intent:'merge', options:{ post_review:true, propose_verdict:true } }, capabilities:caps, onModeChange:()=>{}, onOptionsChange:()=>{} })
  if (!html) return
  assert.match(html, /This is your own PR, so the agent only checks it for you\. Nothing is posted, proposed or merged\./)
  assert.doesNotMatch(html, /Merge when safe|Who sees the result|Draft for GitHub/)
  assert.match(html, /Start private review/)
  assert.match(html, /Seen on GitHub:<\/strong> nothing/)
})
