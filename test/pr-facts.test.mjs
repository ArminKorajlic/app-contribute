import assert from 'node:assert/strict'
import test from 'node:test'
import { prFacts, respondChatOf } from '../pr-facts.js'
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
const decideFor = (pr, runs = [], ignored = null, chats = []) => decide(prFacts({ pr, login: 'alex', runs, ignored, chats }))

test('your PR after you pushed fixes waits on the reviewer, not on you (bug 1)', () => {
  const decision = decideFor(mine({ reviewDecision: 'CHANGES_REQUESTED', latestOpinionatedReviews: { nodes: [opinion('Sam', 'CHANGES_REQUESTED', OLD)] } }))
  assert.equal(decision.state, 'author.waiting_rereview')
  assert.match(decision.headline, /Waiting on Sam to review again/, 'names keep their own case')
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
  assert.match(decideFor(pr).actions.find(action => action.id === 'merge').reason, /Alex asked for changes/)
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

// "Respond to feedback" is an ordinary conversation, not a review run: the platform lists it beside the runs.
const BUSY = 'An agent is already working on this PR.'
const respond = (extra = {}) => ({ repo: 'o/r', number: 7, state: 'running', chat_id: 'c1', ...extra })
const actionOf = (decision, id) => decision.actions.find(action => action.id === id)

test('a live Respond conversation is the one agent job on its PR', () => {
  const theirs = decideFor(pull(), [], null, [respond({ repo: 'O/R' })])
  assert.equal(theirs.state, 'working')
  assert.deepEqual([actionOf(theirs, 'review').enabled, actionOf(theirs, 'review').reason], [false, BUSY])
  const yours = decideFor(mine(), [], null, [respond()])
  assert.equal(yours.state, 'working')
  for (const id of ['check_my_pr', 'finish_it']) assert.deepEqual([actionOf(yours, id).enabled, actionOf(yours, id).reason], [false, BUSY], id)
})

test('a Respond conversation that waits on you says so, and still holds the PR', () => {
  const decision = decideFor(mine(), [], null, [respond({ state: 'needs_answer' })])
  assert.equal(decision.state, 'needs_answer')
  assert.equal(actionOf(decision, 'finish_it').reason, BUSY)
})

test('a Respond conversation on another PR changes nothing here', () => {
  const others = [respond({ number: 8 }), respond({ repo: 'o/other' })]
  assert.deepEqual(prFacts({ pr: mine(), login: 'alex', chats: others }), prFacts({ pr: mine(), login: 'alex' }))
  assert.equal(decideFor(mine(), [], null, others).state, 'author.waiting_review')
})

test('a run that is working still names the job before a Respond conversation does; a stalled one yields to it', () => {
  const working = run({ state: 'reviewing' }, { state: 'running', execution_state: 'running' })
  const stalled = run({ state: 'reviewing' }, { state: 'running', execution_state: 'failed' })
  assert.deepEqual(prFacts({ pr: pull(), login: 'alex', runs: [working], chats: [respond()] }).job, { kind: 'review', state: 'running' })
  assert.deepEqual(prFacts({ pr: pull(), login: 'alex', runs: [stalled], chats: [respond()] }).job, { kind: 'respond', state: 'running' })
  assert.equal(prFacts({ pr: pull(), login: 'alex', runs: [stalled] }).job.state, 'stalled')
})

test('a review whose own turn ended while its reviewer helper works is still running; an interrupted one has stalled', () => {
  const waitingOnHelper = run({ state: 'reviewing' }, { state: 'reviewing', execution_state: 'completed' })
  const interrupted = run({ state: 'reviewing' }, { state: 'reviewing', execution_state: 'interrupted' })
  assert.deepEqual(prFacts({ pr: pull(), login: 'alex', runs: [waitingOnHelper] }).job, { kind: 'review', state: 'running' })
  assert.equal(prFacts({ pr: pull(), login: 'alex', runs: [interrupted] }).job.state, 'stalled')
})

test('findings of an older version of your PR no longer wait on you', () => {
  assert.equal(decideFor(mine(), [run({ state: 'needs_you', head_sha: OLD })]).state, 'author.waiting_review')
  assert.equal(decideFor(mine(), [run({ state: 'needs_you' })]).state, 'author.findings')
})

test('findings you set aside for this version stop waiting on you', () => {
  const ignored = { [`o/r#7@${HEAD}`]: { reason: 'Not a problem', at: '2026-11-04T10:00:00Z' } }
  assert.equal(decideFor(mine(), [run({ state: 'needs_you' })], ignored).state, 'author.waiting_review')
})

test('a plain comment after your change request leaves the re-review yours', () => {
  const pr = pull({ viewerLatestReview: { state: 'COMMENTED', commit: { oid: HEAD } },
    latestOpinionatedReviews: { nodes: [opinion('Alex', 'CHANGES_REQUESTED', OLD)] } })
  assert.equal(decideFor(pr).state, 'reviewer.re_review')
  assert.equal(decideFor(pull({ viewerLatestReview: { state: 'PENDING', commit: { oid: HEAD } } })).state, 'reviewer.to_review', 'a pending review is not one yet')
})

test('a review from a deleted account, or of a commit that is gone, still blocks and never approves', () => {
  const pr = mine({ latestOpinionatedReviews: { nodes: [opinion('Bob', 'APPROVED'), { state: 'CHANGES_REQUESTED', author: null, commit: null }] } })
  assert.match(decideFor(pr).actions.find(action => action.id === 'merge').reason, /ghost asked for changes/)
  const gone = mine({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'Bob', __typename: 'User' }, commit: null }] } })
  assert.equal(decideFor(gone).state, 'author.approval_stale')
})

test('a person whose login ends in "bot" is a person; a bot thread is never feedback waiting on you', () => {
  assert.equal(decideFor(mine({ latestOpinionatedReviews: { nodes: [opinion('Talbot', 'APPROVED')] } })).state, 'author.approved')
  const botThread = { isResolved: false, comments: { nodes: [{ author: { login: 'copilot', __typename: 'Bot' } }] } }
  const approved = { latestOpinionatedReviews: { nodes: [opinion('Sam', 'APPROVED')] } }
  assert.equal(decideFor(mine({ ...approved, reviewThreads: { nodes: [botThread] } })).state, 'author.approved')
})

test('a PR without its state, or your PR without its threads, is unknown', () => {
  assert.equal(decideFor(pull({ state: undefined })).state, 'unknown')
  assert.equal(decideFor(mine({ reviewThreads: undefined })).state, 'unknown')
})

test('no checks at all reads as no checks, never green', () => {
  const pr = mine({ latestOpinionatedReviews: { nodes: [opinion('Sam', 'APPROVED')] }, ...rollup(null) })
  assert.match(decideFor(pr).headline, /no checks\. Merge it/)
})

test('the Respond conversation of a PR is found by its exact repository (any case) and number, and by nothing else', () => {
  const chats = [respond({ repo: 'o/other' }), respond({ number: 8 }), respond({ repo: 'O/R', chat_id: 'c-here' })]
  assert.equal(respondChatOf(chats, pull()).chat_id, 'c-here')
  assert.equal(respondChatOf([respond({ number: 8 })], pull()), null)
  assert.equal(respondChatOf([], pull()), null)
  assert.equal(respondChatOf(undefined, pull()), null)
})

// The platform saves a prepared fix's new commit as head_sha and the PR version it builds on as from_sha.
test('a prepared fix waiting on this version is a fix to push, not open findings', () => {
  const FIX = 'f'.repeat(40)
  const repair = { id: 'a1', state: 'proposed', head_sha: FIX, from_sha: HEAD, files: ['api.js'] }
  const decision = decideFor(mine(), [run({ state: 'needs_you', repair_attempts: [repair] }, { mode: 'review_fix_merge' })])
  assert.equal(decision.state, 'to_confirm')
  assert.equal(decision.label, 'Fix to push')
  assert.match(decision.headline, /A fix is ready/)
})

test('a plain comment from someone else on your PR is feedback until you reply; a bot’s is not, and a bot’s update after a person’s does not hide it', () => {
  const said = (...voices) => ({ comments: { totalCount: voices.length, nodes: voices.map(([login, typename = 'User']) => ({ author: { login, __typename: typename } })) } })
  assert.equal(decideFor(mine(said(['Sam']))).state, 'author.feedback')
  assert.notEqual(decideFor(mine(said(['Sam'], ['alex']))).state, 'author.feedback', 'your own reply answers it')
  assert.notEqual(decideFor(mine(said(['ci-bot', 'Bot']))).state, 'author.feedback')
  assert.equal(decideFor(mine(said(['Sam'], ['ci-bot', 'Bot']))).state, 'author.feedback', 'a bot posting after Sam leaves Sam unanswered')
  assert.notEqual(decideFor(mine(said(['Sam'], ['alex'], ['ci-bot', 'Bot']))).state, 'author.feedback', 'and after your reply, it stays answered')
})

test('a plain comment arriving while an agent works leaves it working, then asks for an answer once the run is done', () => {
  const comment = { comments: { totalCount: 1, nodes: [{ author: { login: 'Sam', __typename: 'User' } }] } }
  assert.equal(decideFor(mine(comment), [run({ state: 'reviewing' }, { state: 'running', execution_state: 'running' })]).state, 'working')
  assert.equal(decideFor(mine(comment), [run({ state: 'all_clear' })]).state, 'author.feedback')
})

// A review that only comments, with words in it, is spoken in the PR's conversation (#129: two such reviews, no thread, no verdict).
const wordsReview = (login, body, submittedAt, oid = HEAD) => ({ ...opinion(login, 'COMMENTED', oid), body, submittedAt })
const talk = (login, createdAt) => ({ createdAt, author: { login, __typename: 'User' } })

test('a review that only comments is feedback to answer until you reply, and it can be answered by a later comment', () => {
  const review = wordsReview('Sam', 'I found the following concrete risks.', '2026-11-05T12:00:00Z')
  const open = decideFor(mine({ latestReviews: { nodes: [review] } }))
  assert.equal(open.state, 'author.feedback')
  assert.equal(open.actions.find(action => action.id === 'respond').enabled, true, 'Respond to feedback is on, as #129 needed')
  assert.equal(open.actions.find(action => action.id === 'ask_approval').enabled, true, 'and so is asking Sam to approve')
  const answered = decideFor(mine({ latestReviews: { nodes: [review] }, comments: { nodes: [talk('alex', '2026-11-05T13:00:00Z')] } }))
  assert.equal(answered.state, 'author.commented', 'your reply after the review answers it; Sam still has not approved')
  assert.deepEqual(answered.approvalFrom, ['Sam'])
  const again = decideFor(mine({ latestReviews: { nodes: [{ ...review, submittedAt: '2026-11-05T14:00:00Z' }] }, comments: { nodes: [talk('alex', '2026-11-05T13:00:00Z')] } }))
  assert.equal(again.state, 'author.feedback', 'a newer review than your reply is waiting again')
})

test('a comment review with no words, from a bot, or by you is no feedback', () => {
  for (const node of [wordsReview('Sam', '  ', '2026-11-05T12:00:00Z'), { ...wordsReview('ci-bot', 'Looks fine', '2026-11-05T12:00:00Z'), author: { login: 'ci-bot', __typename: 'Bot' } }, wordsReview('alex', 'Noted', '2026-11-05T12:00:00Z')]) {
    assert.notEqual(decideFor(mine({ latestReviews: { nodes: [node] } })).state, 'author.feedback', JSON.stringify(node.author))
  }
  assert.equal(decideFor(mine({ latestReviews: { nodes: [wordsReview('Sam', 'Looks good', '2026-11-05T12:00:00Z', OLD)] } })).state, 'author.feedback', 'on an older version it is still words to answer')
})

const withComments = (reviews, ...nodes) => mine({ reviewDecision: 'CHANGES_REQUESTED', latestOpinionatedReviews: { nodes: reviews }, latestReviews: { nodes } })

test('a reviewer who commented on this version after asking for changes is read as having looked again', () => {
  const decision = decideFor(withComments([opinion('Sam', 'CHANGES_REQUESTED', OLD)], opinion('Sam', 'COMMENTED', HEAD)))
  assert.equal(decision.state, 'author.looked_again')
  assert.deepEqual(decision.lookedAgain, ['Sam'])
  assert.equal(decision.actions.find(action => action.highlighted).id, 'ask_approval')
})

test('only a plain comment is read from the newest reviews: an approval or a request there is the opinion list’s to give', () => {
  const approvedAgain = decideFor(withComments([opinion('Sam', 'CHANGES_REQUESTED', OLD)], opinion('Sam', 'APPROVED', HEAD)))
  assert.equal(approvedAgain.state, 'author.waiting_rereview', 'an approval that GitHub’s opinions did not list is not counted')
  assert.equal(decideFor(withComments([opinion('Sam', 'CHANGES_REQUESTED', OLD)], opinion('Sam', 'COMMENTED', OLD))).state, 'author.waiting_rereview', 'a comment on the old version is no sign of looking again')
})

test('a read without the newest reviews only leaves "looked again" unsaid; the PR still reads', () => {
  const decision = decideFor(mine({ latestOpinionatedReviews: { nodes: [opinion('Sam', 'CHANGES_REQUESTED', OLD)] } }))
  assert.equal(decision.state, 'author.waiting_rereview')
})

test('an approval of an older commit carries the reader’s proof that the work is the same', () => {
  const carried = decideFor(mine({ latestOpinionatedReviews: { nodes: [{ ...opinion('Sam', 'APPROVED', OLD), sameWork: true }] } }))
  assert.equal(carried.state, 'author.approved')
  assert.deepEqual(carried.carriedFrom, [{ by: 'Sam', commit: OLD }])
  for (const sameWork of [false, null]) {
    assert.equal(decideFor(mine({ latestOpinionatedReviews: { nodes: [{ ...opinion('Sam', 'APPROVED', OLD), sameWork }] } })).state, 'author.approval_stale')
  }
})

test('on someone else’s PR a plain comment in the newest reviews is not mistaken for your own review', () => {
  const decision = decide(prFacts({ pr: pull({ latestReviews: { nodes: [opinion('alex', 'COMMENTED', HEAD)] } }), login: 'alex' }))
  assert.equal(decision.state, 'reviewer.to_review')
})
