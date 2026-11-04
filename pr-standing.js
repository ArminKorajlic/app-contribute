// How a PR's machine decision (pr-machine.js) shows on a row: the comet frame
// and the chip. Pure, so rows, the desk and the PR page cannot disagree.
import { prFacts } from './pr-facts.js'
import { decide } from './pr-machine.js'

export const standingFor = ({ pr, login, runs = [], ignored = null, chats = [] }) => decide(prFacts({ pr, login, runs, ignored, chats }))

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
