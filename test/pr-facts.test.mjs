import assert from 'node:assert/strict'
import test from 'node:test'
import { PR_FIELDS } from '../api.js'
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
const decideFor = (pr, runs = [], ignored = null, chats = []) => decide(prFacts({ pr, login: 'alex', runs, ignored, chats }))

test('your PR after you pushed fixes waits on the reviewer, not on you (bug 1)', () => {
  const decision = decideFor(mine({ reviewDecision: 'CHANGES_REQUESTED', latestOpinionatedReviews: { nodes: [opinion('Sam', 'CHANGES_REQUESTED', OLD)] } }))
  assert.equal(decision.state, 'author.waiting_rereview')
  assert.match(decision.headline, /Waiting on Sam to re-review/, 'names keep their own case')
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

test('GitHub’s own review gate keeps Merge off even when someone approved this version', () => {
  const merge = decision => decision.actions.find(action => action.id === 'merge')
  // Someone other than the PR's author (Sam) approved it, at this version.
  const approved = reviewer => ({ latestOpinionatedReviews: { nodes: [opinion(reviewer, 'APPROVED')] } })
  for (const [pr, reviewer] of [[mine, 'Sam'], [pull, 'Bob']]) {
    const gated = decideFor(pr({ ...approved(reviewer), reviewDecision: 'REVIEW_REQUIRED' }))
    assert.deepEqual([merge(gated).enabled, merge(gated).reason], [false, 'GitHub still needs a review.'])
    assert.notEqual(gated.state, 'author.approved', 'it is not "Merge it"')
    assert.notEqual(gated.state, 'reviewer.mergeable')
    for (const reviewDecision of ['APPROVED', null, undefined]) assert.equal(merge(decideFor(pr({ ...approved(reviewer), reviewDecision }))).enabled, true, String(reviewDecision))
  }
  assert.match(decideFor(mine({ ...approved('Sam'), reviewDecision: 'REVIEW_REQUIRED' })).headline, /approved\. GitHub still needs a review\./)
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

test('a write nobody confirmed is held when the PR moves on: a new head neither confirms nor refutes it', () => {
  const actionOf = (decision, id) => decision.actions.find(action => action.id === id)
  const approved = { latestOpinionatedReviews: { nodes: [opinion('Sam', 'APPROVED')] } }
  // Written to at OLD; the PR is at HEAD now. The same items one version later would be held too.
  const unknown = { push_unknown: {}, merge_unknown: {}, ready_unknown: {}, verdict_unknown: { verdict_proposal: { state: 'unknown', event: 'APPROVE', head_sha: OLD } } }
  for (const [state, extra] of Object.entries(unknown)) {
    for (const [role, pr] of [['yours', mine(approved)], ['theirs', pull(approved)]]) {
      const decision = decideFor(pr, [run({ state, head_sha: OLD, ...extra })])
      assert.equal(decision.state, 'unconfirmed', `${state} on ${role}`)
      for (const id of ['merge', 'check_my_pr', 'respond', 'finish_it', 'review', 'take_over'].filter(id => actionOf(decision, id))) {
        assert.equal(actionOf(decision, id).enabled, false, `${id} stays off while ${state} is unresolved`)
        assert.match(actionOf(decision, id).reason, /not confirmed yet|Nobody|Needs|Only/, `${id}: ${actionOf(decision, id).reason}`)
      }
    }
  }
  assert.equal(actionOf(decideFor(mine(approved), [run({ state: 'merge_unknown', head_sha: OLD })]), 'merge').reason, 'Something sent to GitHub is not confirmed yet.')
  // Still on its way out when the push itself moved the head.
  assert.equal(decideFor(mine(approved), [run({ state: 'pushing', head_sha: OLD })]).state, 'sending')
  // A draft is another matter: it belongs to the version it was written for, and goes stale with it.
  const draft = run({ state: 'verdict_pending', head_sha: OLD, verdict_proposal: { state: 'proposed', event: 'APPROVE', head_sha: OLD } })
  assert.equal(decideFor(pull(), [draft]).state, 'reviewer.to_review')
  assert.equal(decideFor(pull(), [{ ...draft, items: [{ ...draft.items[0], head_sha: HEAD, verdict_proposal: { ...draft.items[0].verdict_proposal, head_sha: HEAD } }] }]).state, 'to_confirm')
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

test('a review list with another page is unknown: an opinion on the next page must never be missed', () => {
  const merge = decision => decision.actions.find(action => action.id === 'merge')
  // The approval is on the first page; a change request from another writer is on the second.
  const firstPage = { latestOpinionatedReviews: { pageInfo: { hasNextPage: true }, nodes: [opinion('Sam', 'APPROVED')] } }
  const whole = { latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [opinion('Sam', 'APPROVED')] } }
  assert.equal(decideFor(mine(whole)).state, 'author.approved', 'a list GitHub says is whole is read as it is')
  assert.equal(merge(decideFor(mine(whole))).enabled, true)
  for (const pr of [mine(firstPage), pull(firstPage)]) {
    const decision = decideFor(pr)
    assert.equal(decision.state, 'unknown', 'a first page of a longer list says nothing about the rest')
    assert.deepEqual([merge(decision).enabled, merge(decision).reason], [false, 'This PR could not be read. Try again.'])
  }
  assert.equal(prFacts({ pr: mine(firstPage), login: 'alex' }).readComplete, false)
  assert.match(PR_FIELDS, /latestOpinionatedReviews\([^)]*\) \{ pageInfo \{ hasNextPage \}/, 'the read asks GitHub whether the list goes on')
})

test('a clean private review of their PR is settled, and comes back for re-review when they push', () => {
  const clean = head => [run({ state: 'all_clear', head_sha: head })]
  // At this version it reads as done: there is no verdict to send and no finding to set aside.
  const settled = decideFor(pull(), clean(HEAD))
  assert.deepEqual([settled.state, settled.turn], ['reviewer.kept_private', 'none'])
  // After new commits it is an older version: the PR is back in front of the reviewer.
  const pushed = decideFor(pull(), clean(OLD))
  assert.deepEqual([pushed.state, pushed.turn, pushed.next], ['reviewer.re_review', 'you', 'review'])
  assert.equal(pushed.actions.find(action => action.id === 'review').title, 'Re-review')
  // Findings on a version the PR left behind are old news, and your own PR is never nagged about it.
  assert.equal(decideFor(pull(), [run({ state: 'needs_you', head_sha: OLD })]).state, 'reviewer.to_review')
  assert.equal(decideFor(mine(), clean(OLD)).state, 'author.waiting_review')
  // A re-review that already ran at the new version is not "new commits" again.
  assert.equal(decideFor(pull(), clean(HEAD)).state, 'reviewer.kept_private')
})

test('open threads on your PR are feedback; a thread you answered last is not', () => {
  const thread = login => ({ isResolved: false, comments: { nodes: [{ author: { login } }] } })
  assert.equal(decideFor(mine({ reviewThreads: { nodes: [thread('Sam')] } })).state, 'author.feedback')
  assert.equal(decideFor(mine({ reviewThreads: { nodes: [thread('Alex')] } })).state, 'author.waiting_review')
})

test('threads GitHub says go on are not read as the whole, and neither is a PR with no known viewer', () => {
  const thread = login => ({ isResolved: false, comments: { nodes: [{ author: { login } }] } })
  const lastPage = { reviewThreads: { pageInfo: { hasPreviousPage: true }, nodes: [thread('Alex')] } }
  const whole = { reviewThreads: { pageInfo: { hasPreviousPage: false }, nodes: [thread('Sam')] } }
  const unread = decideFor(mine(lastPage))
  assert.equal(unread.state, 'unknown', 'older threads could be waiting on you')
  assert.equal(unread.actions.find(action => action.id === 'respond').reason, 'This PR could not be read. Try again.')
  assert.equal(decideFor(mine(whole)).state, 'author.feedback')
  assert.match(PR_FIELDS, /reviewThreads\([^)]*\) \{ pageInfo \{ hasPreviousPage \}/, 'the read asks GitHub whether the list goes on')
  for (const login of ['', null, undefined]) {
    const decision = decide(prFacts({ pr: mine(), login }))
    assert.equal(decision.state, 'unknown', 'your own PR is never decided as someone else’s')
    assert.equal(decision.actions.find(action => action.id === 'merge').enabled, false)
  }
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
