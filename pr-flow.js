// The PR flow: the one place that says who you are on a PR, where it stands,
// whose move it is and what you may do next. Every screen asks this file instead
// of working it out again, so the rules cannot drift apart.
//
// Two roles, because the owner is on one side of every PR:
//   author   - you wrote it. You check it, fix it, answer reviewers and merge it.
//   reviewer - someone else wrote it. You review it, then re-review what they change.
//
// The hard rules, in plain words (each one is checked by test/pr-flow.test.mjs):
//   1. You never review your own PR in public: no approve, no request changes, no
//      suggestions addressed to yourself. An agent's check of your PR stays private.
//   2. You never fix someone else's branch unless you take it over on purpose.
//   3. An agent never posts, approves or merges by itself. It drafts; you confirm.
//   4. A verdict belongs to one exact version. A new push makes it old.
//   5. Whose move it is comes from what already happened, never from a guess.
//
// Pure: no DOM, no network. Facts in, a description of the PR's standing out.
import { checkSummary, mayMerge, reviewItemProgress } from './collaboration.js'

export const ROLES = { author: 'author', reviewer: 'reviewer' }

// Whose move a state is. 'you' and 'agent' are what the app shows as work in
// progress; 'other' means someone else must act; 'none' means nothing is left.
export const TURNS = { you: 'you', agent: 'agent', other: 'other', none: 'none' }

// Every state, with its plain-words label. `confirm` marks the states where an
// agent has drafted something and only your tap can send it: they are what the
// "Waiting for your confirmation" list shows. `next` is the action to highlight.
// `headline` reads as one line under the PR title: who you are, then the move.
export const STATES = {
  'author.draft':          { turn: 'you',   label: 'Draft',                      headline: 'Your PR · a draft. Check it, then open it for review', next: 'review' },
  'author.checking':       { turn: 'agent', label: 'Checking',                   headline: 'Your PR · an agent is checking it for you' },
  'author.findings':       { turn: 'you',   label: 'Findings to deal with',      headline: 'Your PR · your check found problems. Fix them or set them aside', next: 'address' },
  'author.attention':      { turn: 'you',   label: 'Check did not finish',       headline: 'Your PR · the check did not finish. Run it again', next: 'review' },
  'author.feedback':       { turn: 'you',   label: 'Feedback to answer',         headline: 'Your PR · feedback is waiting. Answer every point', next: 'address' },
  'author.waiting':        { turn: 'other', label: 'Waiting on reviewers',       headline: 'Your PR · waiting on reviewers' },
  'author.approved':       { turn: 'you',   label: 'Approved',                   headline: 'Your PR · approved and green. Merge it', next: 'merge_now' },
  'reviewer.to_review':    { turn: 'you',   label: 'To review',                  headline: 'Their PR · your turn: review it', next: 'review' },
  'reviewer.reviewing':    { turn: 'agent', label: 'Reviewing',                  headline: 'Their PR · an agent is reviewing it for you' },
  'reviewer.decide':       { turn: 'you',   label: 'Review ready',               headline: 'Their PR · the review is ready. Send it or set it aside', confirm: true },
  'reviewer.confirm':      { turn: 'you',   label: 'Waiting for your confirmation', headline: 'Their PR · a verdict is drafted. Confirm it to post it', confirm: true },
  'reviewer.waiting_author': { turn: 'other', label: 'Waiting on the author',    headline: 'Their PR · you asked for changes. Waiting on the author' },
  'reviewer.re_review':    { turn: 'you',   label: 'Changed since your review',  headline: 'Their PR · it changed since your review. Review again', next: 'review' },
  'reviewer.done':         { turn: 'none',  label: 'Reviewed',                   headline: 'Their PR · you reviewed this version' },
  merged:                  { turn: 'none',  label: 'Merged',                     headline: 'Merged' },
  closed:                  { turn: 'none',  label: 'Closed',                     headline: 'Closed' },
}

// What an agent can be asked to do, by the intent the Actions menu opens.
// `roles` lists who may use it; `blocked` is the plain reason it is off for the
// other role, so the menu can show the choice dimmed with its reason.
export const AGENT_INTENTS = {
  review: { roles: ['author', 'reviewer'] },
  address: { roles: ['author'], blocked: { reviewer: 'This is someone else’s branch. Ask the author to fix it, or take it over.' } },
  merge: { roles: ['reviewer'], blocked: { author: 'You cannot approve your own PR. Someone else approves it, then you merge it.' } },
  review_fix_merge: { roles: ['author', 'reviewer'] },
}

// Why an agent job is not for this role, or '' when it is.
export function intentBlocker(role, intent) {
  const rule = AGENT_INTENTS[intent]
  return rule && !rule.roles.includes(role) ? rule.blocked?.[role] || '' : ''
}

// Things only you can do, and the states and roles where they make sense. Each
// ends in a confirm sheet. An agent never does any of these on its own.
export const YOUR_RULES = {
  open_review: { roles: ['author'], states: ['author.draft'] },
  merge_now: { roles: ['author', 'reviewer'], states: ['author.approved', 'reviewer.to_review', 'reviewer.done', 'reviewer.waiting_author', 'reviewer.re_review'] },
  submit_verdict: { roles: ['reviewer'], states: ['reviewer.confirm'] },
  discard_verdict: { roles: ['reviewer'], states: ['reviewer.confirm'] },
  send_findings: { roles: ['reviewer'], states: ['reviewer.decide'] },
  ignore_findings: { roles: ['author', 'reviewer'], states: ['author.findings', 'reviewer.decide'] },
}

// The only actions that put a review in front of other people. Rule 1: none of
// them ever exists for an author.
export const PUBLIC_REVIEW_ACTIONS = ['submit_verdict', 'send_findings']

const failing = checks => checks?.failed > 0

// The facts behind one PR, as the list already holds them. `own` is whether you
// wrote it; `status` is the review of this exact version ({ run, item }); `earlier`
// the newest review of another version; `ignored` the notes of findings set aside.
export function prFlow({ pr, own, status = null, earlier = null, ignored = null }) {
  const role = own ? ROLES.author : ROLES.reviewer
  const key = own ? authorState(pr, status, ignored) : reviewerState(pr, status, earlier, ignored)
  const state = STATES[key]
  const waitingOn = state.turn === 'other' ? (own ? 'reviewers' : pr?.author?.login || 'the author') : ''
  // Naming the person beats "the author" once we know who it is.
  const headline = key === 'reviewer.waiting_author' ? `Their PR · you asked for changes. Waiting on ${waitingOn}` : state.headline
  return { role, state: key, turn: state.turn, label: state.label, headline, confirm: state.confirm === true, next: state.next || '', waitingOn }
}

function authorState(pr, status, ignored) {
  if (pr?.state === 'MERGED') return 'merged'
  if (pr?.state === 'CLOSED') return 'closed'
  const progress = status ? reviewItemProgress(status.run, status.item, { own: true, ignored }) : null
  if (progress?.turn === 'agent') return 'author.checking'
  if (progress?.turn === 'owner') return progress.halted || status.item.state !== 'needs_you' ? 'author.attention' : 'author.findings'
  if (pr?.isDraft) return 'author.draft'
  const checks = checkSummary(pr)
  if (pr?.reviewDecision === 'CHANGES_REQUESTED' || failing(checks) || pr?.mergeable === 'CONFLICTING') return 'author.feedback'
  const ready = pr?.reviewDecision === 'APPROVED' && (!checks || checks.state === 'success') && mayMerge(pr?.repository?.viewerPermission)
  return ready ? 'author.approved' : 'author.waiting'
}

const requestedChanges = item => item?.state === 'needs_you' && item.verdict_proposal?.state === 'posted' && item.verdict_proposal.event === 'REQUEST_CHANGES'

function reviewerState(pr, status, earlier, ignored) {
  if (pr?.state === 'MERGED') return 'merged'
  if (pr?.state === 'CLOSED') return 'closed'
  if (!status) return earlier && requestedChanges(earlier.item) ? 'reviewer.re_review' : 'reviewer.to_review'
  const progress = reviewItemProgress(status.run, status.item, { own: false, ignored })
  if (progress.turn === 'agent') return 'reviewer.reviewing'
  if (progress.turn === 'author') return 'reviewer.waiting_author'
  if (progress.turn === 'owner') return status.item.verdict_proposal && ['proposed', 'unknown'].includes(status.item.verdict_proposal.state) ? 'reviewer.confirm' : 'reviewer.decide'
  return 'reviewer.done'
}

// Your own actions that make sense in this state, for this role. Anything that
// would put a review of your own PR in public is never in the list (rule 1).
export function yourActionsFor(flow) {
  return Object.entries(YOUR_RULES)
    .filter(([, rule]) => rule.roles.includes(flow.role) && rule.states.includes(flow.state))
    .map(([name]) => name)
}

// A PR whose state waits on a draft only you can send.
export const waitsForConfirmation = flow => flow.confirm === true

// For the docs and the "Waiting for your confirmation" copy: states grouped by turn.
export const statesByTurn = turn => Object.entries(STATES).filter(([, state]) => state.turn === turn).map(([key]) => key)
