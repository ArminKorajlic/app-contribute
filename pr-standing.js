// How a PR's machine decision (pr-machine.js) shows on a row: the comet frame
// and the chip. Pure, so rows, the desk and the PR page cannot disagree.
import { prFacts } from './pr-facts.js'
import { decide } from './pr-machine.js'
import { responseView } from './respond-result.js'
import { NAMES } from './names.js'

// A saved answer makes Respond to feedback a second pass: the action says so and what it replaces. The machine's own decision is
// otherwise untouched; this only words the one action, so the menu and the panel stay in agreement.
function secondPass(decision, view) {
  if (!['ready', 'stale'].includes(view?.status)) return decision
  const again = { title: NAMES.respondAgain, detail: 'Replaces the waiting answer. It does not review again.' }
  return { ...decision, actions: decision.actions.map(action => (action.id === 'respond' ? { ...action, ...again } : action)) }
}

export const standingFor = ({ pr, login, runs = [], ignored = null, chats = [], responses = [] }) => secondPass(decide(prFacts({ pr, login, runs, ignored, chats, responses })), responseView(responses, pr))

// States that exist because of a Contribute review: they hold the amber frame.
const REVIEW_MOVES = new Set(['to_confirm', 'unconfirmed', 'needs_answer', 'stalled', 'author.findings', 'reviewer.result_ready', 'reviewer.re_review'])
// A PR's ordinary resting states say nothing a row needs to repeat.
const QUIET = new Set(['reviewer.to_review', 'reviewer.draft', 'author.draft', 'author.waiting_review', 'merged', 'closed', 'working'])
const TONE = { you: 'owner', other: 'waiting', none: 'plain', agent: 'plain' }

export function frameOf(decision) {
  if (decision.turn === 'agent') return 'reviewing'
  return REVIEW_MOVES.has(decision.state) ? 'verdict' : 'idle'
}

export const chipOf = decision => (QUIET.has(decision.state) ? null : { label: decision.label, tone: TONE[decision.turn] })
