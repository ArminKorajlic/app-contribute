import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationCount, isBotAuthor, discoverPull, discoverPulls, discoverRepositories, matchingPulls, mayAssign, mayMerge, mergeSelection, collaborationRequest, reviewRunRequest, assignPulls, loadReviewRuns, awaitsGithub, OBSERVE_EVERY_MS, reviewRunTitle, reviewForPull, runDetailsElsewhere, notOursToObserve } from '../collaboration.js'
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
  assert.equal(awaitsGithub({ state: 'needs_you', items: [{ state: 'verdict_unknown' }] }), true, 'an unconfirmed verdict is re-checked against GitHub')
  assert.equal(awaitsGithub({ state: 'needs_you', items: [{ state: 'verdict_pending' }] }), false, 'a verdict waiting for you is not on GitHub to find')
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
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/ReviewConfirmation.jsx'; export const render = (pulls, capabilities = {review_fix_merge:true, post_review:true, propose_verdict:true}, mode = 'review') => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice:{mode,pulls,intent:'review',options:{post_review:true,propose_verdict:true}},onModeChange:()=>{},onOptionsChange:()=>{},capabilities}));`)
  const eligible = render([pull(1)])
  assert.match(eligible, /Merge after I approve/)
  assert.doesNotMatch(eligible, /Not available for drafts|Needs merge rights/)
  // Merge after I approve explains why an exact selection is not eligible.
  assert.match(render([pull(1), pull(2, {repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})]), /Needs merge rights on this repository\./)
  assert.match(render([pull(1, {isDraft:true})]), /Not available for drafts\./)
  // Review, fix and merge starts only for an entirely eligible selection, and says why not.
  assert.doesNotMatch(render([pull(1)], undefined, 'review_fix_merge'), /disabled="">Start, ask me before each push/)
  assert.doesNotMatch(render([pull(1, {isDraft:true})], undefined, 'review_fix_merge'), /disabled="">Start, ask me before each push/, 'a draft can be finished: the agent never readies it')
  for (const selection of [[pull(1), pull(2, {repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})]]) {
    const html = render(selection, undefined, 'review_fix_merge')
    assert.match(html, /disabled="">Start, ask me before each push/)
    assert.match(html, /Requires merge access to every selected PR/)
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

test('a takeover never asks to mark a draft ready: one repair scope, and a reason only when you gave one', async () => {
  const { takeoverBlocker, reviewRunRequest, TAKEOVER_SCOPE } = await import('../collaboration.js')
  const draft = pull(9, { isDraft: true, headRepository: { viewerPermission: 'WRITE' } })
  assert.match(takeoverBlocker([draft]), /Draft/)
  assert.equal(takeoverBlocker([draft], { allowDraft: true }), '', 'a draft can be taken over: the agent never readies it, you do')
  assert.match(takeoverBlocker([{ ...draft, headRepository: { viewerPermission: 'READ' } }], { allowDraft: true }), /push access/)
  const old = { request_id: 'fixture-old', mode: 'review_fix_merge', pulls: [draft] }
  assert.equal(reviewRunRequest(old).confirmation_scope, TAKEOVER_SCOPE)
  assert.equal(reviewRunRequest({ ...old, confirmation_scope: 'named_pr_repairs_ready_and_reviewed_successors' }).confirmation_scope, TAKEOVER_SCOPE, 'an older saved draft-ready scope is never sent again')
  assert.equal('takeover_reason' in reviewRunRequest(old), false)
  assert.equal(reviewRunRequest({ ...old, takeover_reason: '  the author is away  ' }).takeover_reason, 'the author is away')
  assert.equal('confirmation_scope' in reviewRunRequest({ request_id: 'r', mode: 'review', pulls: [draft] }), false)
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
  assert.match(html, /Open the owning chat for details/)
  assert.match(html, /Matches loaded PR version/)
  assert.match(html, /View the posted review on GitHub/)
  assert.doesNotMatch(html, /Stop workflow|prompt snapshot|Older PR version|Instructions used by this run|findings will appear here|not a new approval/)
  assert.match(render({ id: 'own', app_id: 80, mode: 'review', state: 'reviewing', items: [] }, []), /This older run did not save a prompt snapshot/)
})

test('the Agent menu jobs map to exact platform modes and publishing presets', async () => {
  const { reviewIntent, requestOptions } = await import('../collaboration.js')
  const PRIVATE = { post_review: false, propose_verdict: false, agent_submits_verdict: false }
  // Review and Check my PR both open private; the window can draft or (if you allow it) let the agent post.
  assert.deepEqual(reviewIntent('review'), { intent: 'review', mode: 'review', options: PRIVATE })
  assert.deepEqual(reviewIntent('check_my_pr'), { intent: 'check_my_pr', mode: 'review', options: PRIVATE })
  assert.deepEqual(reviewIntent('finish_it'), { intent: 'finish_it', mode: 'review_fix_merge' })
  assert.deepEqual(reviewIntent('take_over'), { intent: 'take_over', mode: 'review_fix_merge' })
  // A raw mode (a retry) passes through with its own defaults.
  assert.deepEqual(reviewIntent('review_merge'), { mode: 'review_merge' })
  // The agent may post only on a plain review, and only with a drafted verdict; never with merging.
  const agent = { post_review: true, propose_verdict: true, agent_submits_verdict: true }
  assert.equal(requestOptions(agent, 'review').agent_submits_verdict, true)
  assert.equal('agent_submits_verdict' in requestOptions(agent, 'review_merge'), false)
  assert.equal('agent_submits_verdict' in requestOptions({ post_review: true, agent_submits_verdict: true }, 'review'), false)
})

test('a PR changed after its review still finds that review, as an earlier version', async () => {
  const { earlierReviewForPull, reviewForPull } = await import('../collaboration.js')
  const pr = { number: 233, headRefOid: 'new'.padEnd(40, '1'), baseRefName: 'main', repository: { nameWithOwner: 'Team/Repo' } }
  const run = (id, at, head, number = 233, repo = 'team/repo') => ({ id, created_at: at, items: [{ repo, number, head_sha: head, base_ref: 'main', state: 'all_clear' }] })
  const older = run('older', '2026-11-03T08:00:00Z', 'old'.padEnd(40, '0'))
  const newest = run('newest', '2026-11-03T09:30:00Z', 'mid'.padEnd(40, '0'))
  const runs = [older, newest, run('other-pr', '2026-11-03T09:40:00Z', 'zzz'.padEnd(40, '0'), 9), run('other-repo', '2026-11-03T09:50:00Z', 'yyy'.padEnd(40, '0'), 233, 'team/else')]
  // Nothing was reviewed at the current head, so it is not "never reviewed".
  assert.equal(reviewForPull(runs, pr), null)
  assert.equal(earlierReviewForPull(runs, pr).run.id, 'newest')
  assert.equal(earlierReviewForPull([], pr), null)
  // A review of the current head is the review, not an earlier one.
  const current = run('current', '2026-11-03T10:00:00Z', pr.headRefOid)
  assert.equal(earlierReviewForPull([current], pr), null)
})

test('a row counts the conversation the PR page lists: comments plus reviews', () => {
  assert.equal(conversationCount({ comments: { totalCount: 1 }, reviews: { totalCount: 2 } }), 3)
  assert.equal(conversationCount({ comments: { totalCount: 0 }, reviews: { totalCount: 2 } }), 2)
  assert.equal(conversationCount({}), 0)
})

test('drafts, failing checks and bots are filters of their own', () => {
  const failing = { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'FAILURE', count: 1 }, { state: 'SUCCESS', count: 1 }], statusContextCountsByState: [] } } } }] } }
  const rows = [{ number: 1, isDraft: true, author: { login: 'owner' } }, { number: 2, author: { login: 'dependabot' }, ...failing }, { number: 3, author: { login: 'renovate[bot]' } }]
  assert.deepEqual(matchingPulls(rows, 'drafts', 'owner').map(pr => pr.number), [1])
  assert.deepEqual(matchingPulls(rows, 'failing', 'owner').map(pr => pr.number), [2])
  assert.deepEqual(matchingPulls(rows, 'bots', 'owner').map(pr => pr.number), [2, 3])
  assert.equal(isBotAuthor('ArminKorajlic'), false)
  for (const person of ['abbot', 'talbot', 'robot']) assert.equal(isBotAuthor(person), false, person)
  for (const bot of ['qa-bot', 'review_bot', 'copilot[bot]']) assert.equal(isBotAuthor(bot), true, bot)
})
