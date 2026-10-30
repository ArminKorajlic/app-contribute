import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverPull, discoverPulls, discoverRepositories, matchingPulls, mayAssign, mayMerge, mergeSelection, collaborationRequest, reviewRunRequest, assignPulls, loadReviewRuns, awaitsGithub, OBSERVE_EVERY_MS, reviewRunTitle, reviewForPull, runDetailsElsewhere, notOursToObserve } from '../collaboration.js'
import { attachSourceProjects } from '../source-map.js'
import { frontendModules, renderModule } from './render-harness.mjs'
const pull = (number, extra = {}) => ({ number, title: 'A clear change', url: 'https://github.com/team/repo/pull/' + number,
  headRefOid: 'a'.repeat(40), baseRefName: 'main', baseRefOid: 'd'.repeat(40), baseRef: { target: { oid: 'b'.repeat(40) } }, repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' },
  author: { login: 'owner' }, assignees: { nodes: [] }, ...extra })

test('assignment and merge follow distinct repository permissions, never organisation membership', () => {
  for (const role of ['WRITE','MAINTAIN','ADMIN']) { assert.equal(mayAssign(role), true); assert.equal(mayMerge(role), true) }
  assert.equal(mayAssign('TRIAGE'), true); assert.equal(mayMerge('TRIAGE'), false)
  for (const role of [null, undefined, 'READ', 'mobius-os']) { assert.equal(mayMerge(role), false); assert.equal(mayAssign(role), false) }
})
test('assigned and own PRs remain selectable independently of unassigned work', () => {
  const rows = [pull(1), pull(2, { assignees: { nodes: [{ login: 'Owner' }] }, author: { login: 'other' } })]
  assert.deepEqual(matchingPulls(rows, 'unassigned', 'owner').map(pr => pr.number), [1])
  assert.deepEqual(matchingPulls(rows, 'assigned', 'owner').map(pr => pr.number), [2])
  assert.deepEqual(matchingPulls(rows, 'authored', 'owner').map(pr => pr.number), [1])
  assert.equal(matchingPulls(rows, 'all', 'owner').length, 2)
})
test('pagination replaces changed identities rather than duplicating them', () => {
  assert.equal(mergeSelection([pull(1)], [pull(1, { headRefOid: 'b'.repeat(40) })]).length, 1)
  assert.equal(mergeSelection([pull(1)], [pull(1, { headRefOid: 'b'.repeat(40) })])[0].headRefOid, 'b'.repeat(40))
})
test('repository access is not membership; explicitly added repositories retain permissions', () => {
  const repositories = [{ nameWithOwner: 'team/repo', viewerPermission: 'MAINTAIN', openPullRequestCount: 1 }]
  assert.deepEqual(attachSourceProjects(null, [], [], repositories), [])
  const projects = attachSourceProjects(null, [], [], repositories, ['team/repo'])
  assert.equal(projects.length, 1); assert.equal(projects[0].kind, 'external')
  assert.equal(projects[0].viewerPermission, 'MAINTAIN')
  assert.equal(projects[0].available, false)
})
test('PR discovery is read-only, includes own work, and reports pagination', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options }); return new Response(JSON.stringify({ data: { search: { nodes: [pull(1)], issueCount: 70, pageInfo: { hasNextPage: true, endCursor: 'next' } } } }))
  })
  const found = await discoverPulls('test', 'team/repo')
  assert.equal(found.hasNextPage, true); assert.equal(found.total, 70)
  assert.match(calls[0].body, /repo:team\/repo/)
  assert.doesNotMatch(calls[0].body, /mutation|no:assignee|-author/)
  await discoverPulls('test')
  assert.match(calls[1].body, /involves:@me/)
  await assert.rejects(discoverPulls('test', 'bad"repo'), /valid repository/)
})
test('missing GitHub data is an error, not a false empty queue', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ errors: [{ message: 'no access' }] })))
  await assert.rejects(discoverPulls('test'), /Could not check GitHub/)
  await assert.rejects(discoverRepositories('test'), /Could not check GitHub/)
})
test('old backend reports the activation requirement without mutation fallback', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}', { status: 404 }) })
  await assert.rejects(collaborationRequest('test', 80, 'review-runs', { items: [] }), /activated/)
  assert.equal(calls, 1)
})
test('a run with a saved merge or push GitHub may have settled is observed read-only, at most once a minute', async t => {
  const queued = { id: 'run-q', state: 'reviewing', items: [{ number: 1674, state: 'queued' }, { number: 1673, state: 'reviewing' }] }
  const settled = { ...queued, items: [{ number: 1674, state: 'merged' }, { number: 1673, state: 'reviewing' }] }
  assert.equal(awaitsGithub(queued), true)
  assert.equal(awaitsGithub({ state: 'reviewing', items: [{ state: 'reviewing' }, { state: 'merged' }] }), false)
  assert.equal(awaitsGithub({ ...queued, state: 'complete' }), false)
  const calls = []
  let observed = false
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(`${init.method} ${url}`)
    if (url.endsWith('/observe')) { observed = true; return new Response(JSON.stringify({ run: settled })) }
    return new Response(JSON.stringify({ runs: [observed ? settled : queued] }))
  })
  const shown = []
  const first = await loadReviewRuns('test', 80, { now: 1_000_000, onList: list => shown.push(list.runs[0].items[0].state) })
  assert.deepEqual(shown, ['queued'], 'the saved list shows before GitHub is checked')
  assert.equal(first.runs[0].items[0].state, 'merged', 'the list is re-read after GitHub reconciliation')
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs', 'POST /api/github/contributions/80/review-runs/run-q/observe', 'GET /api/github/contributions/80/review-runs'])
  observed = false; calls.length = 0
  await loadReviewRuns('test', 80, { now: 1_000_000 + OBSERVE_EVERY_MS - 1 })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs'], 'no second GitHub check within the minute')
})
test('a failed observation keeps the listed runs rather than hiding them', async t => {
  const run = { id: 'run-fail', state: 'reviewing', items: [{ number: 9, state: 'merge_unknown' }] }
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/observe')
    ? new Response(JSON.stringify({ detail: 'GitHub unavailable' }), { status: 502 })
    : new Response(JSON.stringify({ runs: [run] })))
  assert.deepEqual((await loadReviewRuns('test', 80, { now: 5_000_000 })).runs, [run])
})
test('review-and-merge confirmation names exact PRs and excludes extra public actions', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/ReviewConfirmation.jsx'; export const render = choice => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice}));`)
  const html = render({mode:'review_merge', pulls:[pull(1), pull(2)]})
  assert.match(html, /Start review, merge when safe/)
  assert.match(html, /all required checks pass, it merges each PR or adds it to the merge queue/); assert.match(html, /the merge of each PR\. No comments and no code changes\./, 'a batch merge discloses one merge per PR')
  assert.match(html, /<strong>#1<\/strong> A clear change<span>team\/repo<\/span>/)
  assert.match(html, /<strong>#2<\/strong> A clear change<span>team\/repo<\/span>/)
  assert.match(html, /Exact versions/, 'a saved pinned merge keeps its exact-version disclosure')
  assert.match(html, /It uses these exact versions\. Changed code needs a fresh approval\./)
  const privately = render({mode:'review', pulls:[pull(1)]})
  assert.match(privately, /Seen on GitHub:<\/strong> nothing\. Only you see the review\./); assert.match(privately, /Start private review/)
  const posting = render({mode:'review', pulls:[pull(1)], options:{post_review:true}})
  assert.doesNotMatch(posting, /Only you see the review|Start private review/, 'a review posted on GitHub is never called private')
  // Only a verdict the agent explicitly marks public is posted (G2 `publish: true`).
  assert.match(posting, /at most one review comment from your account, only for a verdict the agent marks as public\. Questions to you and unverified results stay private\./)
  assert.doesNotMatch(posting, /verdict and findings is posted|Findings posted on GitHub/, 'posting is a grant, not a promise that every outcome is public')
  assert.match(posting, /Start review, allow comment/)
})


test('the grant request binds the selected head and the live target-branch tip, not the PR comparison base', () => {
  const pr = pull(1)
  const choice = { request_id: 'same-retry', mode: 'review_merge', pulls: [pr] }
  assert.deepEqual(reviewRunRequest(choice), { request_id: 'same-retry', mode: 'review_merge', items: [{
    repo: 'team/repo', number: 1, head_sha: 'a'.repeat(40), base_ref: 'main', base_sha: 'b'.repeat(40),
  }] })
})


test('batch assignment pins each head and reports partial failures without replaying successes', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body)
    return body.number === 2 ? new Response(JSON.stringify({detail:'PR changed'}), {status:409}) : new Response('{}')
  })
  const result = await assignPulls('test', 80, [pull(1), pull(2), pull(3)], 'reviewer')
  assert.deepEqual(result.map(item => item.ok), [true, false, true])
  assert.match(result[1].error, /PR changed/)
  assert.deepEqual(calls.map(item => item.number), [1,2,3])
  assert.ok(calls.every(item => item.assignee === 'reviewer' && item.expected_head_sha === 'a'.repeat(40)))
})

test('merge option is enabled only for an entirely eligible exact selection', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/ReviewConfirmation.jsx'; export const render = (pulls, capabilities = {review_fix_merge:true}, mode = 'review') => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice:{mode,pulls},onModeChange:()=>{},capabilities}));`)
  const eligible = render([pull(1)])
  assert.match(eligible, /Merge when safe/)
  assert.doesNotMatch(eligible, /Not available for drafts|Needs merge rights/)
  // Merge when safe explains why an exact selection is not eligible.
  assert.match(render([pull(1), pull(2, {repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})]), /Needs merge rights on this repository\./)
  assert.match(render([pull(1, {isDraft:true})]), /Not available for drafts\./)
  // Review, fix and merge starts only for an entirely eligible selection, and says why not.
  assert.doesNotMatch(render([pull(1)], undefined, 'review_fix_merge'), /disabled="">Allow fix and merge/)
  for (const selection of [[pull(1), pull(2, {repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})], [pull(1, {isDraft:true})]]) {
    const html = render(selection, undefined, 'review_fix_merge')
    assert.match(html, /disabled="">Allow fix and merge/)
    // Without served draft support a draft is unavailable; rights explain first.
    assert.match(html, /needs the Möbius update|Requires merge access to every selected PR/)
  }
  // A workflow this Möbius does not advertise is never offered (or claimed loading forever).
  assert.match(render([pull(1)], {}, 'review_fix_merge'), /Needs a newer Möbius/)
  assert.match(render([pull(1)], null, 'review_fix_merge'), /Checking what this Möbius supports/)
  // A permanent rights blocker is not hidden behind the pending draft check.
  {
    const html = render([pull(1, {isDraft:true, repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})], undefined, 'review_fix_merge')
    assert.match(html, /Requires merge access to every selected PR/)
  }
})


test('takeover eligibility distinguishes drafts, base merge rights and fork push rights', async () => {
  const { takeoverBlocker } = await import('../collaboration.js')
  const ready = pull(9, { repository:{nameWithOwner:'team/repo',viewerPermission:'WRITE'}, headRepository:{nameWithOwner:'team/repo',viewerPermission:'WRITE'} })
  assert.equal(takeoverBlocker([ready]), '')
  assert.match(takeoverBlocker([{...ready,isDraft:true}]), /Draft/)
  assert.match(takeoverBlocker([{...ready,repository:{viewerPermission:'READ'}}]), /merge access/)
  assert.equal(takeoverBlocker([{...ready,headRepository:{nameWithOwner:'fork/repo',viewerPermission:'WRITE'}}]), '')
  assert.match(takeoverBlocker([{...ready,headRepository:{nameWithOwner:'fork/repo',viewerPermission:'READ'}}]), /push access/)
  // GitHub reports a deleted source fork as an explicit null.
  assert.match(takeoverBlocker([{...ready,headRepository:null}]), /source repository was deleted/)
  const { headRepository, ...legacy } = ready
  assert.equal(takeoverBlocker([legacy]), '', 'an absent field (older snapshot) defers to the server preflight')
})

test('one draft-scope selector feeds the chooser and the serialized start body', async () => {
  const { takeoverScope, reviewRunRequest, DRAFT_TAKEOVER_SCOPE, TAKEOVER_SCOPE } = await import('../collaboration.js')
  const draft = pull(9, { isDraft: true }), ready = pull(10)
  assert.equal(takeoverScope([ready]), TAKEOVER_SCOPE)
  assert.equal(takeoverScope([ready, draft]), DRAFT_TAKEOVER_SCOPE)
  for (const pulls of [[ready], [ready, draft]]) {
    const body = reviewRunRequest({ request_id: 'scope-fixture', mode: 'review_fix_merge', confirmation_scope: takeoverScope(pulls), pulls })
    assert.equal(body.confirmation_scope, takeoverScope(pulls))
  }
  assert.equal('confirmation_scope' in reviewRunRequest({ request_id: 'r', mode: 'review', pulls: [draft] }), false)
})

test('draft takeover discovery needs explicit readiness support and never bypasses fork rights', async () => {
  const { takeoverBlocker, reviewRunRequest, DRAFT_TAKEOVER_SCOPE, TAKEOVER_SCOPE } = await import('../collaboration.js')
  const draft=pull(9,{isDraft:true,headRepository:{viewerPermission:'WRITE'}})
  assert.match(takeoverBlocker([draft]), /Draft/)
  assert.equal(takeoverBlocker([draft],{allowDraft:true}), '')
  assert.match(takeoverBlocker([{...draft,headRepository:{viewerPermission:'READ'}}],{allowDraft:true}), /push access/)
  const old={request_id:'fixture-old',mode:'review_fix_merge',pulls:[draft]}
  // A legacy saved selection without a scope never acquires draft readiness.
  assert.equal(reviewRunRequest(old).confirmation_scope, TAKEOVER_SCOPE)
  assert.equal(reviewRunRequest({...old,confirmation_scope:DRAFT_TAKEOVER_SCOPE}).confirmation_scope, DRAFT_TAKEOVER_SCOPE)
})

test('a review run is named by what it does in public', () => {
  assert.equal(reviewRunTitle({ mode: 'review', options: { autopilot: true } }), 'Private review')
  assert.equal(reviewRunTitle({ mode: 'review', options: { post_review: true } }), 'GitHub review')
  assert.equal(reviewRunTitle({ mode: 'review_merge' }), 'Review & merge')
  assert.equal(reviewRunTitle({ mode: 'review_fix_merge', options: { post_review: true } }), 'Review, fix & merge')
})

test('an exact PR read rejects a response for another repository or number', async t => {
  let answer
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: { repository: { pullRequest: answer } } })))
  answer = pull(7)
  assert.equal((await discoverPull('test', 'team/repo', 7)).number, 7)
  for (const wrong of [pull(8), pull(7, { repository: { nameWithOwner: 'other/repo', viewerPermission: 'WRITE' } }), null]) {
    answer = wrong
    await assert.rejects(discoverPull('test', 'team/repo', 7), /unavailable to your GitHub account/)
  }
  await assert.rejects(discoverPull('test', 'not a repository', 7), /valid pull request/)
  await assert.rejects(discoverPull('test', 'team/repo', 0), /valid pull request/)
})

// G1's committed minimized projection (2541f4f12, out/G1.md) of a core review
// run Contribute did not start: no prompts, options, findings or brief.
const minimized = (extra = {}, item = {}) => ({ id: 'core-run', chat_id: 'owner-chat', state: 'reviewing', execution_state: 'running',
  mode: 'review', created_at: '2026-10-23T09:00:00Z', app_id: null, can_stop: false, post_review: false, details_in_owning_chat: true,
  items: [{ repo: 'team/repo', number: 7, head_sha: 'a'.repeat(40), base_ref: 'main', base_sha: 'b'.repeat(40), state: 'reviewing', ...item }], ...extra })

test('a minimized core run is titled by its mode and top-level post_review flag', () => {
  assert.equal(runDetailsElsewhere(minimized()), true)
  assert.equal(runDetailsElsewhere({ id: 'own', app_id: 80, mode: 'review', items: [] }), false)
  assert.equal(reviewRunTitle(minimized()), 'Private review')
  assert.equal(reviewRunTitle(minimized({ post_review: true })), 'GitHub review')
  assert.equal(reviewRunTitle(minimized({ mode: 'review_merge' })), 'Review & merge')
  assert.equal(reviewRunTitle(minimized({ mode: 'review_fix_merge', post_review: true })), 'Review, fix & merge')
  // Only the committed top-level flag counts for a minimized run.
  assert.equal(reviewRunTitle(minimized({ post_review: false, options: { post_review: true } })), 'Private review')
  assert.equal(reviewRunTitle({ mode: 'review', options: { post_review: true } }), 'GitHub review', 'own runs keep their frozen options')
})

test('a minimized core run attaches to its PR row by repository, number, head and base', () => {
  const run = minimized()
  assert.equal(reviewForPull([run], pull(7))?.run, run)
  assert.equal(reviewForPull([run], pull(7)).exactBase, true)
  assert.equal(reviewForPull([run], pull(7, { headRefOid: 'c'.repeat(40) })), null)
  assert.equal(reviewForPull([run], pull(8)), null)
  assert.equal(reviewForPull([minimized({}, { base_ref: 'release' })], pull(7)), null)
})

test('a minimized core run is never observed; a details_in_owning_chat refusal stops polling and is not an error', async t => {
  const calls = []
  let runs = [minimized({}, { state: 'queued', public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/7#r' } })]
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(`${init.method} ${url}`)
    if (url.endsWith('/observe')) return new Response(JSON.stringify({ detail: { code: 'details_in_owning_chat', message: 'Open the owning conversation to observe this core review run.' } }), { status: 403 })
    return new Response(JSON.stringify({ runs }))
  })
  const list = await loadReviewRuns('test', 80, { now: 9_000_000 })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs'], 'a marked run is not observed')
  assert.deepEqual(list.runs[0].items[0].public_review, { state: 'posted', url: 'https://github.com/team/repo/pull/7#r' })
  // A run listed without the marker that the server refuses as not ours is never asked again.
  const unmarked = { id: 'core-unmarked', state: 'reviewing', items: [{ number: 3, state: 'queued' }] }
  runs = [unmarked]; calls.length = 0
  const first = await loadReviewRuns('test', 80, { now: 20_000_000 })
  assert.deepEqual(first.runs, [unmarked], 'the refusal keeps the listed run')
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs', 'POST /api/github/contributions/80/review-runs/core-unmarked/observe'])
  calls.length = 0
  await loadReviewRuns('test', 80, { now: 20_000_000 + 10 * OBSERVE_EVERY_MS })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs'], 'polling stopped after the not-ours refusal')
  // The structured code is surfaced on request errors.
  const error = await collaborationRequest('test', 80, 'review-runs/core-unmarked/observe', {}).catch(error => error)
  assert.equal(notOursToObserve(error), true)
  assert.equal(notOursToObserve(Object.assign(new Error('x'), { status: 403 })), false)
})

test('a minimized run detail points to the owning conversation and offers no Stop or prompt warnings', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {RunDetail} from './ui/RunDetail.jsx'; export const render = (run, pulls) => renderToStaticMarkup(React.createElement(RunDetail, {run, pulls, listState: {}, onStop: () => {}}));`)
  const html = render(minimized({ post_review: true }, { public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/7#r' } }), [pull(7)])
  assert.match(html, /<h3>GitHub review<\/h3>/)
  assert.match(html, /Its instructions and findings are in the owning conversation/)
  assert.match(html, /Open the owning conversation for details/)
  assert.match(html, /Matches loaded PR version/)
  assert.match(html, /View the posted review on GitHub/)
  assert.doesNotMatch(html, /Stop workflow|prompt snapshot|Older PR version|Instructions used by this run|findings will appear here|not a new approval/)
  assert.match(render({ id: 'own', app_id: 80, mode: 'review', state: 'reviewing', items: [] }, []), /This older run did not save a prompt snapshot/)
})
