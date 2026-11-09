import assert from 'node:assert/strict'
import test from 'node:test'
import { frameState } from '../review-frame.js'
import { frameOf, standingFor } from '../pr-standing.js'

// One review run as the server returns it, read through the app's two mappings:
//   frameState                      (review-frame.js)  the Desk row of a saved record
//   frameOf(standingFor(...))       (pr-standing.js)   a PR row and the PR page
// Both must give the same meaning for the same run: the review is AT WORK, it is the
// OWNER's move, or it is IDLE (nothing to show). The shapes below are what the platform's
// run view produces (routes/contribution_reviews.py `_run_view`, built on
// contribution_review_runs.py `view` and `verdict_overlay`); `job` is what its
// `_job_on_pull` says the run holds on the PR. A row marked `known` is a real
// disagreement today: it runs as a todo and starts passing the day it is fixed.

const AT_WORK = 'at work'
const OWNER = 'owner'
const IDLE = 'idle'
const FRAME_MEANING = { reviewing: AT_WORK, verdict: OWNER, idle: IDLE }
const ROLES = ['reviewer', 'author']
const REVIEWER = ['reviewer'] // GitHub refuses a verdict on your own PR, and none is ever sent there

const HEAD = 'b'.repeat(40)
const verdict = (state, event = 'APPROVE') => ({ verdict_proposal: { state, event, head_sha: HEAD } })
const HALTED_RUN_DISAGREEMENT = 'review-frame.js frameState reads a halted run as idle (its test: "the chip says it"), while pr-standing.js frameOf holds the amber frame for the stalled job (Agent stopped)'
const HELPER_STILL_WORKING = { name: 'its own turn ended while its reviewer helper still works', state: 'reviewing', execution: 'completed', item: { state: 'reviewing' }, job: 'running', meaning: AT_WORK }

const CASES = [
  // The review's conversation, while the review is still on its first item.
  { name: 'a review just started: its conversation has no turn yet', state: 'reviewing', item: { state: 'reviewing' }, job: 'running', meaning: AT_WORK },
  { name: 'a review whose turn is running', state: 'reviewing', execution: 'running', item: { state: 'reviewing' }, job: 'running', meaning: AT_WORK },
  HELPER_STILL_WORKING,
  { name: 'parked on a provider limit, resuming by itself', state: 'reviewing', execution: 'parked', item: { state: 'reviewing' }, job: 'running', meaning: AT_WORK },
  { name: 'about to resume after a park', state: 'reviewing', execution: 'resume_pending', item: { state: 'reviewing' }, job: 'running', meaning: AT_WORK },
  // The server passes a notified park through unchanged and `_job_on_pull` still holds the PR for it.
  { name: 'a provider park the owner was already told about', state: 'reviewing', execution: 'parked_notified', item: { state: 'reviewing' }, job: 'running', meaning: AT_WORK },
  // The server overrides the run to needs_you; nothing will wake these, so the move is the owner's.
  { name: 'interrupted: nothing is left that will wake it', state: 'needs_you', execution: 'interrupted', item: { state: 'reviewing' }, job: 'stalled', meaning: OWNER, known: HALTED_RUN_DISAGREEMENT },
  { name: 'its last turn failed', state: 'needs_you', execution: 'failed', item: { state: 'reviewing' }, job: 'stalled', meaning: OWNER, known: HALTED_RUN_DISAGREEMENT },
  { name: 'stopped by the owner: it asks nothing of them', state: 'needs_you', execution: 'stopped', item: { state: 'reviewing' }, job: 'stalled', meaning: IDLE },
  { name: 'waiting on an open owner card', state: 'needs_you', execution: 'awaiting_owner', item: { state: 'reviewing' }, job: 'needs_answer', meaning: OWNER },
  // The run says needs_you, yet its items and conversation are unchanged and the server still holds the PR.
  { name: 'the chat model no longer matches the frozen workflow', state: 'needs_you', execution: 'completed', item: { state: 'reviewing' }, job: 'running', meaning: AT_WORK },
  // An item's own progress: fixing, then effects on their way to GitHub.
  { name: 'fixing its findings', state: 'repairing', execution: 'running', item: { state: 'repairing' }, job: 'running', meaning: AT_WORK },
  { name: 'a scoped fix on its way to GitHub', state: 'pushing', execution: 'running', item: { state: 'pushing' }, job: null, meaning: AT_WORK },
  { name: 'marking the PR ready on GitHub', state: 'marking_ready', execution: 'running', item: { state: 'marking_ready' }, job: null, meaning: AT_WORK },
  { name: 'a merge on its way to GitHub', state: 'reviewing', execution: 'running', item: { state: 'merging' }, job: null, meaning: AT_WORK },
  { name: 'a verdict on its way to GitHub', state: 'needs_you', execution: 'completed', item: { state: 'verdict_posting', ...verdict('posting') }, job: null, meaning: AT_WORK, roles: REVIEWER },
  // GitHub did not confirm, or the review ended with something to decide.
  { name: 'the merge outcome is unconfirmed', state: 'needs_you', execution: 'completed', item: { state: 'merge_unknown' }, job: null, meaning: OWNER },
  { name: 'the ready-for-review outcome is unconfirmed', state: 'needs_you', execution: 'completed', item: { state: 'ready_unknown' }, job: null, meaning: OWNER },
  { name: 'the ready-for-review attempt can no longer be attributed', state: 'needs_you', execution: 'completed', item: { state: 'ready_unattributable' }, job: null, meaning: OWNER,
    known: 'collaboration.js OWNER_ITEM_STATES and review-frame.js WORKING_ITEMS lack ready_unattributable (the platform _OWNER_ITEMS has it): frameState reads idle, pr-facts reads a running job so the PR standing reads Agent working' },
  { name: 'the verdict outcome is unconfirmed', state: 'needs_you', execution: 'completed', item: { state: 'verdict_unknown', ...verdict('unknown') }, job: null, meaning: OWNER, roles: REVIEWER },
  { name: 'a proposed verdict waits for the owner to send it', state: 'needs_you', execution: 'completed', item: { state: 'verdict_pending', ...verdict('proposed') }, job: null, meaning: OWNER, roles: REVIEWER },
  { name: 'the review found problems', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', summary: 'P1' }, job: null, meaning: OWNER },
  { name: 'a repair proposal waits for the owner to push it', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', repair_attempts: [{ id: 'a', state: 'proposed', head_sha: HEAD }] }, job: null, meaning: OWNER },
  { name: 'a repair push GitHub did not confirm', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', repair_attempts: [{ id: 'a', state: 'push_unknown', head_sha: HEAD }] }, job: null, meaning: OWNER },
  { name: 'a public review comment GitHub did not confirm', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', public_review: { state: 'unknown' } }, job: null, meaning: OWNER, roles: REVIEWER },
  { name: 'a public review comment that certainly did not go out', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', public_review: { state: 'not_dispatched' } }, job: null, meaning: OWNER, roles: REVIEWER },
  { name: 'a public review comment being sent', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', public_review: { state: 'posting' } }, job: null, meaning: AT_WORK, roles: REVIEWER,
    known: 'review-frame.js frameState reads the saved needs_you as the owner\'s move (amber) while pr-facts reads the comment as sending (Sending to GitHub, at work)' },
  { name: 'a verdict refused before it reached GitHub', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', ...verdict('not_dispatched') }, job: null, meaning: OWNER, roles: REVIEWER,
    known: 'the platform verdict_overlay says a refused verdict always needs the owner and frameState agrees, but pr-facts resultOf sets it aside, so the PR standing reads Kept private (idle)' },
  // What the owner already did about the findings.
  { name: 'a clean review of their PR is waiting for a verdict', state: 'complete', execution: 'completed', item: { state: 'all_clear' }, job: null, meaning: OWNER, roles: REVIEWER,
    known: 'frameState keeps a finished review chip-only (idle); the PR standing is reviewer.result_ready (amber) until a verdict is sent or kept private' },
  { name: 'a clean review of your own PR', state: 'complete', execution: 'completed', item: { state: 'all_clear' }, job: null, meaning: IDLE, roles: ['author'] },
  { name: 'an approval GitHub confirmed', state: 'complete', execution: 'completed', item: { state: 'all_clear', ...verdict('posted') }, job: null, meaning: IDLE, roles: REVIEWER },
  { name: 'changes requested: the PR\'s author holds the move', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', ...verdict('posted', 'REQUEST_CHANGES') }, job: null, meaning: IDLE, roles: REVIEWER },
  { name: 'a comment verdict GitHub confirmed on findings', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', ...verdict('posted', 'COMMENT') }, job: null, meaning: IDLE, roles: REVIEWER,
    known: 'collaboration.js reviewItemProgress only hands over for REQUEST_CHANGES or an agent-posted review without a verdict, so frameState keeps the owner\'s move (amber) after a posted COMMENT verdict; the PR standing is reviewer.reviewed (idle)' },
  { name: 'a verdict the owner threw away', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', ...verdict('discarded') }, job: null, meaning: IDLE, roles: REVIEWER },
  { name: 'a public review comment GitHub confirmed', state: 'needs_you', execution: 'completed', item: { state: 'needs_you', public_review: { state: 'posted' } }, job: null, meaning: IDLE, roles: REVIEWER },
  // Settled on GitHub.
  { name: 'a merge waiting in GitHub\'s queue', state: 'queued', execution: 'completed', item: { state: 'queued' }, job: null, meaning: IDLE,
    known: 'pr-facts.js ITEM_OUTBOX reads queued as a merge still sending (standing: at work) while collaboration.js and the platform _SETTLED_ITEMS settle it (frameState: idle)' },
  { name: 'merged', state: 'complete', execution: 'completed', item: { state: 'merged' }, job: null, meaning: IDLE },
  { name: 'a finished review whose conversation failed afterwards', state: 'complete', execution: 'failed', item: { state: 'merged' }, job: null, meaning: IDLE },
]

const pullFor = role => ({
  number: 7, state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE', author: { login: role === 'author' ? 'me' : 'someone-else' },
  repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
})

const serverRun = ({ state, execution, item }) => ({
  id: 'run-1', chat_id: 'chat-1', mode: 'review', created_at: '2026-11-04T10:00:00Z', can_stop: true, state,
  ...(execution ? { execution_state: execution } : {}),
  items: [{ repo: 'team/repo', number: 7, head_sha: HEAD, base_ref: 'main', ...item }],
})

function readings(testCase, role) {
  const run = serverRun(testCase)
  const desk = frameState({ run, item: run.items[0] }, { own: role === 'author' })
  const page = frameOf(standingFor({ pr: pullFor(role), login: 'me', runs: [run] }))
  return { desk: FRAME_MEANING[desk], page: FRAME_MEANING[page] }
}

function assertBothRead(testCase, role) {
  const { desk, page } = readings(testCase, role)
  const where = `${testCase.name} (${role})`
  assert.equal(desk, testCase.meaning, `${where}: the Desk frame reads ${desk}`)
  assert.equal(page, testCase.meaning, `${where}: the PR standing reads ${page}`)
}

const rolesOf = testCase => testCase.roles || ROLES

test('a run reads the same on the Desk frame and the PR standing, for every server run shape', () => {
  for (const testCase of CASES.filter(({ known }) => !known)) rolesOf(testCase).forEach(role => assertBothRead(testCase, role))
})

for (const testCase of CASES.filter(({ known }) => known)) {
  test(`known disagreement: ${testCase.name}`, { todo: testCase.known }, () => rolesOf(testCase).forEach(role => assertBothRead(testCase, role)))
}

test('a review that ended its own turn but still has a helper working reads as at work, never stopped', () => {
  for (const role of ROLES) assert.deepEqual(readings(HELPER_STILL_WORKING, role), { desk: AT_WORK, page: AT_WORK }, role)
})

test('what the table expects never contradicts the platform job reading of the same run (_job_on_pull)', () => {
  const liveMeaning = { running: AT_WORK, needs_answer: OWNER }
  for (const { name, job, meaning } of CASES) {
    if (liveMeaning[job]) assert.equal(meaning, liveMeaning[job], `${name}: a ${job} job`)
    if (job === 'stalled') assert.notEqual(meaning, AT_WORK, `${name}: a stalled job holds nothing`)
  }
})

test('every execution state and item state the platform produces has a case', () => {
  const executions = ['running', 'completed', 'stopped', 'failed', 'interrupted', 'parked', 'resume_pending', 'parked_notified', 'awaiting_owner', undefined]
  const items = ['reviewing', 'repairing', 'pushing', 'marking_ready', 'merging', 'queued', 'merged', 'merge_unknown', 'ready_unknown', 'ready_unattributable',
    'needs_you', 'all_clear', 'verdict_pending', 'verdict_posting', 'verdict_unknown']
  const covered = { executions: new Set(CASES.map(({ execution }) => execution)), items: new Set(CASES.map(({ item }) => item.state)) }
  executions.forEach(state => assert.ok(covered.executions.has(state), `no case for execution_state ${state}`))
  items.forEach(state => assert.ok(covered.items.has(state), `no case for item state ${state}`))
})
