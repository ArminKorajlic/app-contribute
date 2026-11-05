// The PR page's next-step panel and state line (findings 1, 10 and 13). Both only read
// the PR machine's decision (pr-machine.js): the pill says what is true, the hint is
// the machine's own sentence, and the one filled button is the next step it names.
// Pure, so every state's panel is tested without a browser.
import { NAMES } from './names.js'
import { mayRunYourAction, AGENT_INTENTS } from './actions-menu.js'
import { frameOf } from './pr-standing.js'

// How each next step runs. 'menu' goes through the same handler as the Actions menu
// (its confirm sheet or review window); 'review' opens the Review tab, where the
// verdict card, the draft and the stopped run live; 'sync' reads GitHub again.
const ROUTES = {
  check_my_pr: 'menu', respond: 'menu', review: 'menu', open_for_review: 'menu', merge: 'menu',
  rerun_job: 'menu',
  draft_verdict: 'review', send_draft: 'review', check_github: 'review', open_job: 'review',
  retry: 'sync',
}
// Where the machine's own action title would be a sentence, the button says the job.
const TITLES = { draft_verdict: 'See the review', send_draft: 'Read the draft', retry: NAMES.sync }

// A stopped job starts over as the same job through the Actions menu's own window: the machine lets
// a stalled job be run again, and nothing else is working on the PR. Which menu action that is depends
// on the job's kind and whose PR it is (review_fix_merge is Finish it for me on yours, Take over on theirs).
const RERUN_ACTION = {
  review: { author: 'check_my_pr', reviewer: 'review' }, review_merge: { author: 'check_my_pr', reviewer: 'review' },
  respond: { author: 'respond', reviewer: 'respond' }, fix: { author: 'respond', reviewer: 'respond' },
  review_fix_merge: { author: 'finish_it', reviewer: 'take_over' },
}
const actionToRun = decision => (decision.next === 'rerun_job' ? RERUN_ACTION[decision.jobKind]?.[decision.role] || 'review' : decision.next)

const GOOD_STATES = new Set(['author.draft_ready', 'author.approved', 'reviewer.mergeable'])
const BAD_STATES = new Set(['author.blocked', 'unconfirmed', 'unknown'])

// The pill's colour: one meaning each. Amber = an agent job stopped or waits on a decision of
// yours, purple = your move, red = blocked, green = ready, grey = nothing for you to do.
export function pillTone(decision) {
  if (BAD_STATES.has(decision.state)) return 'blocker'
  if (GOOD_STATES.has(decision.state)) return 'ready'
  if (frameOf(decision) === 'verdict') return 'waiting'
  return decision.turn === 'you' ? 'you' : 'quiet'
}

// { pill, hint, primary } for the panel under the facts line. `primary` is null when the
// next step is not yours to take, cannot run yet (the menu says why), or this Möbius
// cannot run it for you.
export function nextStepModel(decision, { record = null, capabilities = null } = {}) {
  if (!decision) return null
  const action = decision.actions.find(item => item.id === actionToRun(decision))
  const route = ROUTES[decision.next]
  const allowed = action?.enabled && route && (route !== 'menu' || AGENT_INTENTS.has(action.id) || mayRunYourAction(action.id, { record, capabilities }))
  // The button keeps the words of the machine's own next step (Review again, Run it again), whichever action runs.
  const title = TITLES[decision.next] || decision.actions.find(item => item.id === decision.next)?.title || action?.title
  return {
    pill: { label: decision.label, tone: pillTone(decision) },
    hint: decision.headline,
    primary: allowed ? { intent: action.id, route, title } : null,
  }
}

export const STATE_STEPS = ['Draft', 'In review', 'Approved', 'Merged']

// Where a PR is on its way: Draft, In review, Approved, Merged. Real data only: a draft is
// GitHub's draft flag, Approved is an approval of this exact version by someone other than
// the author (the machine's own count), Merged is GitHub's. A closed PR has no line.
export function stateLine(pr, decision) {
  if (pr?.state === 'CLOSED' && !pr?.mergedAt) return null
  const merged = !!pr?.mergedAt || pr?.state === 'MERGED'
  const at = merged ? 3 : pr?.isDraft ? 0 : decision?.approvedBy?.length ? 2 : 1
  return { steps: STATE_STEPS.map((label, index) => ({ label, done: index < at, current: index === at })), current: STATE_STEPS[at], at }
}
