import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_INTENTS, YOUR_INTENTS, actionsMenuModel, pullHeader } from '../actions-menu.js'
import { standingFor } from '../pr-standing.js'

const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
const checks = (state = 'SUCCESS', count = 2) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state, contexts: { totalCount: count, checkRunCountsByState: [{ state, count }], statusContextCountsByState: [] } } } }] } })
const pull = (extra = {}) => ({
  number: 7, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE',
  author: { login: 'sam' }, repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] }, ...checks(), ...extra,
})
const mine = extra => pull({ author: { login: 'alex' }, ...extra })
const ALL = { mark_ready_now: true, back_to_draft_now: true, request_rereview_now: true, ask_approval_now: true, merge_now: true, close_now: true }
const menu = (pr, capabilities = ALL, record = null) => actionsMenuModel([pr], [standingFor({ pr, login: 'alex' })], { capabilities, record })
const ids = items => items.map(item => item.intent)
const item = (model, intent) => [...model.you, ...model.agent].find(entry => entry.intent === intent)

test('your own PR offers only author jobs: a private check, respond, finish', () => {
  const model = menu(mine())
  assert.deepEqual(ids(model.agent).sort(), ['check_my_pr', 'finish_it', 'respond'])
  assert.ok(!model.agent.some(entry => ['review', 'take_over'].includes(entry.intent)), 'you never review your own PR')
  assert.match(item(model, 'check_my_pr').detail, /Nothing is posted/)
})

test('their PR offers a review and, apart at the bottom, take over; never fixing their branch', () => {
  const model = menu(pull())
  assert.deepEqual(ids(model.agent), ['review', 'take_over'])
  assert.equal(item(model, 'take_over').reason, 'Only maintainers can take over someone else’s PR.')
  assert.equal(item(menu(pull({ repository: { nameWithOwner: 'o/r', viewerPermission: 'MAINTAIN' } })), 'take_over').off, false)
  assert.equal(item(model, 'review').title, 'Review')
  const reviewed = pull({ viewerLatestReview: { state: 'COMMENTED', commit: { oid: OLD } } })
  assert.equal(item(menu(reviewed), 'review').title, 'Review again', 'once you reviewed it, the job is Review again')
})

test('the highlighted choice is the machine’s next step, first in its group', () => {
  const feedback = menu(mine({ latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'sam' }, commit: { oid: HEAD } }] } }))
  assert.equal(feedback.agent[0].intent, 'respond')
  assert.equal(feedback.agent[0].rec, true)
  assert.match(feedback.headline, /feedback is waiting/)
  const approved = menu(mine({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'sam' }, commit: { oid: HEAD } }] } }))
  assert.equal(approved.you[0].intent, 'merge', 'the highlighted choice of your own comes first')
  assert.equal(approved.you[0].rec, true)
})

test('Merge on your PR stays dimmed with the machine’s reason until someone else approves this version', () => {
  assert.equal(item(menu(mine()), 'merge').reason, 'Nobody but the author has approved it yet.')
  const old = mine({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'sam' }, commit: { oid: OLD } }] } })
  assert.equal(item(menu(old), 'merge').reason, 'The approval is for an older version.')
  assert.equal(item(menu(old), 'ask_rereview').off, false, 'you can ask them to look again')
})

test('your own actions appear only where this Möbius can do them', () => {
  assert.deepEqual(ids(menu(mine(), {}).you), [])
  assert.deepEqual(ids(menu(mine(), { merge_now: true }).you), ['merge'])
  assert.deepEqual(ids(menu(mine()).you), ['open_for_review', 'back_to_draft', 'ask_rereview', 'ask_approval', 'merge', 'close'])
  assert.deepEqual(ids(menu(mine(), { ...ALL, ask_approval_now: false }).you), ['open_for_review', 'back_to_draft', 'ask_rereview', 'merge', 'close'], 'the note is offered only where this Möbius can post it')
  assert.deepEqual(ids(menu(pull()).you), ['merge', 'close'], 'on their PR you may merge or close, never change its draft state')
  const appDraft = menu(mine({ isDraft: true }), {}, { status: 'draft', submission_mode: 'github' })
  assert.deepEqual(ids(appDraft.you), ['open_for_review'], 'a draft this app sent opens through its own record')
})

test('a batch offers one review of each, off when any PR cannot take it', () => {
  const pulls = [pull(), mine({ number: 8 })]
  const model = actionsMenuModel(pulls, pulls.map(pr => standingFor({ pr, login: 'alex' })))
  assert.deepEqual(model.header, { label: '2 PRs', text: 'selected' })
  assert.deepEqual(ids(model.agent), ['review'])
  assert.equal(model.agent[0].off, false)
  const busy = [pull(), pull({ number: 9, repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' } })]
  const runs = [{ id: 'r', created_at: '2026-11-04T10:00:00Z', state: 'running', execution_state: 'running', items: [{ repo: 'o/r', number: 9, head_sha: HEAD, base_ref: 'main', state: 'reviewing' }] }]
  const batch = actionsMenuModel(busy, busy.map(pr => standingFor({ pr, login: 'alex', runs })))
  assert.equal(batch.agent[0].reason, 'An agent is already working on this PR.')
})

test('every menu intent is a machine action, and the header says what GitHub shows', () => {
  for (const intent of [...AGENT_INTENTS, ...YOUR_INTENTS]) assert.ok(standingFor({ pr: mine(), login: 'alex' }).actions.some(action => action.id === intent) || standingFor({ pr: pull(), login: 'alex' }).actions.some(action => action.id === intent), intent)
  assert.deepEqual(pullHeader(pull({ isDraft: true, reviewDecision: 'APPROVED', ...checks('FAILURE', 1), mergeable: 'CONFLICTING' })),
    { label: '#7', text: 'draft · no reviews · 1 failing check · conflicts with main' }, 'GitHub’s approval summary is not repeated: the headline says who approved which version')
})

test('Close pull request is the one destructive row: red, apart, and last in You, whatever the machine highlights', () => {
  const model = menu(mine({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'sam' }, commit: { oid: HEAD } }] } }))
  assert.equal(model.you.at(-1).intent, 'close')
  assert.equal(item(model, 'close').danger, true)
  assert.equal(item(model, 'close').title, 'Close pull request')
  assert.equal(item(model, 'close').detail, 'Asks you to confirm first.')
  assert.ok(model.you.filter(entry => entry.intent !== 'close').every(entry => !entry.danger))
  assert.equal(model.you.at(-1).rec, false, 'closing is never the recommended step')
})

test('a reviewer who looked again without approving is asked to approve first, with the re-review ask dimmed and explained', () => {
  const node = (state, oid) => ({ state, author: { login: 'sam', __typename: 'User' }, commit: { oid } })
  const looked = mine({ latestOpinionatedReviews: { nodes: [node('CHANGES_REQUESTED', OLD)] }, latestReviews: { nodes: [node('COMMENTED', HEAD)] } })
  const model = menu(looked)
  assert.equal(model.headline.startsWith('Your PR · sam looked again and left a comment'), true)
  assert.equal(model.you[0].intent, 'ask_approval', 'the highlighted choice comes first')
  assert.equal(model.you[0].title, 'Ask sam to approve')
  assert.equal(model.you[0].rec, true)
  assert.equal(item(model, 'ask_rereview').reason, 'They already looked at this version. Ask them to approve.')
  assert.equal(item(menu(looked, { ...ALL, ask_approval_now: undefined }), 'ask_approval'), undefined, 'a Möbius that cannot post the note does not offer it')
})
