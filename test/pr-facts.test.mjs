import assert from 'node:assert/strict'
import test from 'node:test'
import { prFacts } from '../pr-facts.js'
import { decide } from '../pr-machine.js'

const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
const rollup = state => ({ commits: { nodes: [{ commit: { statusCheckRollup: state === null ? null : { state: 'SUCCESS', contexts: { totalCount: 2,
  checkRunCountsByState: [{ state, count: 2 }], statusContextCountsByState: [] } } } }] } })
const opinion = (login, state, oid = HEAD, typename = 'User') => ({ state, author: { login, __typename: typename }, commit: { oid } })
const pull = (extra = {}) => ({
  number: 7, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE',
  author: { login: 'Sam' }, repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] }, ...rollup('SUCCESS'), ...extra,
})
const mine = extra => pull({ author: { login: 'Alex' }, ...extra })
const run = (item, extra = {}) => ({ id: 'r1', created_at: '2026-11-04T10:00:00Z', execution_state: 'completed', state: 'complete', mode: 'review',
  items: [{ repo: 'o/r', number: 7, head_sha: HEAD, base_ref: 'main', ...item }], ...extra })
const decideFor = (pr, runs = [], ignored = null) => decide(prFacts({ pr, login: 'alex', runs, ignored }))

test('your PR after you pushed fixes waits on the reviewer, not on you (bug 1)', () => {
  const decision = decideFor(mine({ reviewDecision: 'CHANGES_REQUESTED', latestOpinionatedReviews: { nodes: [opinion('Sam', 'CHANGES_REQUESTED', OLD)] } }))
  assert.equal(decision.state, 'author.waiting_rereview')
  assert.match(decision.headline, /Waiting on sam to re-review/)
})

test('missing check data is never green; no checks at all is (bug 2)', () => {
  const approved = { latestOpinionatedReviews: { nodes: [opinion('Sam', 'APPROVED')] } }
  assert.equal(decideFor(mine({ ...approved, commits: undefined })).state, 'author.approved_checks')
  assert.equal(decideFor(mine({ ...approved, ...rollup(null) })).state, 'author.approved')
})

test('Merge on your PR needs someone else’s approval of this version (bug 3)', () => {
  const merge = decision => decision.actions.find(action => action.id === 'merge')
  assert.equal(merge(decideFor(mine({ reviewDecision: null }))).reason, 'Nobody but the author has approved it yet.')
  assert.equal(merge(decideFor(mine({ reviewDecision: 'APPROVED', latestOpinionatedReviews: { nodes: [opinion('Sam', 'APPROVED', OLD)] } }))).reason, 'The approval is for an older version.')
})

test('a verdict GitHub did not confirm asks you to check, never to send again (bug 4)', () => {
  const decision = decideFor(pull(), [run({ state: 'verdict_unknown', verdict_proposal: { state: 'unknown', event: 'APPROVE', head_sha: HEAD } })])
  assert.equal(decision.state, 'unconfirmed')
  assert.equal(decision.actions.find(action => action.id === 'send_draft').enabled, false)
})

test('an uncertain merge reads as unconfirmed in both roles (bug 5)', () => {
  assert.equal(decideFor(pull(), [run({ state: 'merge_unknown' })]).state, 'unconfirmed')
  assert.equal(decideFor(mine(), [run({ state: 'merge_unknown' })]).state, 'unconfirmed')
})

test('their new commits after your approval bring it back for re-review (bug 6)', () => {
  const pr = pull({ viewerLatestReview: { state: 'APPROVED', commit: { oid: OLD } }, latestOpinionatedReviews: { nodes: [opinion('Alex', 'APPROVED', OLD)] } })
  assert.equal(decideFor(pr).state, 'reviewer.re_review')
})

test('a review you made on GitHub itself counts (bug 7)', () => {
  const pr = pull({ viewerLatestReview: { state: 'COMMENTED', commit: { oid: HEAD } } })
  assert.equal(decideFor(pr).state, 'reviewer.reviewed')
})

test('a verdict you threw away is kept private, not "sent" (bug 8)', () => {
  const decision = decideFor(pull(), [run({ state: 'needs_you', verdict_proposal: { state: 'discarded', event: 'REQUEST_CHANGES', head_sha: HEAD } })])
  assert.equal(decision.state, 'reviewer.kept_private')
  assert.equal(decision.actions.find(action => action.id === 'draft_verdict').enabled, true)
})

test('their PR with changes requested by someone else still highlights Review (bug 9)', () => {
  const decision = decideFor(pull({ reviewDecision: 'CHANGES_REQUESTED', latestOpinionatedReviews: { nodes: [opinion('Bob', 'CHANGES_REQUESTED')] } }))
  assert.equal(decision.actions.find(action => action.highlighted)?.id, 'review')
})

test('a verdict GitHub confirmed to this app counts before GitHub’s list catches up', () => {
  const runs = [run({ state: 'all_clear', verdict_proposal: { state: 'posted', event: 'APPROVE', head_sha: HEAD } })]
  assert.equal(decideFor(pull(), runs).state, 'reviewer.mergeable')
})

test('your own older change request still blocks Merge after a later plain comment', () => {
  const pr = pull({ viewerLatestReview: { state: 'COMMENTED', commit: { oid: HEAD } },
    latestOpinionatedReviews: { nodes: [opinion('Alex', 'CHANGES_REQUESTED', OLD), opinion('Bob', 'APPROVED')] } })
  assert.match(decideFor(pr).actions.find(action => action.id === 'merge').reason, /alex asked for changes/)
})

test('a bot approval never counts, and an unread review list is unknown', () => {
  assert.equal(decideFor(mine({ latestOpinionatedReviews: { nodes: [opinion('qa-bot', 'APPROVED', HEAD, 'Bot')] } })).state, 'author.waiting_review')
  assert.equal(decideFor(mine({ latestOpinionatedReviews: undefined })).state, 'unknown')
})

test('open threads on your PR are feedback; a thread you answered last is not', () => {
  const thread = login => ({ isResolved: false, comments: { nodes: [{ author: { login } }] } })
  assert.equal(decideFor(mine({ reviewThreads: { nodes: [thread('Sam')] } })).state, 'author.feedback')
  assert.equal(decideFor(mine({ reviewThreads: { nodes: [thread('Alex')] } })).state, 'author.waiting_review')
})

test('a running review on an older version is still the one job on the PR', () => {
  const decision = decideFor(pull(), [run({ state: 'reviewing', head_sha: OLD }, { state: 'running', execution_state: 'running' })])
  assert.equal(decision.state, 'working')
  assert.equal(decision.actions.find(action => action.id === 'review').enabled, false)
})

test('findings of an older version of your PR no longer wait on you', () => {
  assert.equal(decideFor(mine(), [run({ state: 'needs_you', head_sha: OLD })]).state, 'author.waiting_review')
  assert.equal(decideFor(mine(), [run({ state: 'needs_you' })]).state, 'author.findings')
})

test('findings you set aside for this version stop waiting on you', () => {
  const ignored = { [`o/r#7@${HEAD}`]: { reason: 'Not a problem', at: '2026-11-04T10:00:00Z' } }
  assert.equal(decideFor(mine(), [run({ state: 'needs_you' })], ignored).state, 'author.waiting_review')
})
