import { NAMES } from './names.js'
// What the Review tab offers once a review exists, chosen by what actually
// happened (not by the saved word alone): the next step comes first, a finished
// review never offers "Stop review", and the conversation is a plain button for
// the day the owner wants to ask something specific. Pure, so the choice is
// tested without a browser. The tab wires each `key` to its handler.

// Why a finding is set aside. The note is for the owner's own memory: nothing
// is posted, and it applies to this exact version of the PR only.
export const IGNORE_REASONS = ['Not a problem', 'I’ll do it later', 'Already fixed', 'Out of scope']

// Findings can be posted while nothing of theirs is on GitHub (or an attempt certainly did not go out).
export const postableFindings = item => !item?.public_review || item.public_review.state === 'not_dispatched'

// Stop is for a review that is still going or waiting on an answer. A running
// review keeps its Stop after its own turn has ended: it hands the work to a
// helper and sleeps until the helper reports, so a helper that hangs leaves it
// running with no open turn to read. `progress` is reviewItemProgress's answer.
export const reviewStoppable = ({ run, tone, progress }) =>
  !!run.can_stop && run.state !== 'complete' && !progress.halted && !progress.settled &&
  (tone === 'running' || run.execution_state !== 'completed')

const primary = action => ({ ...action, primary: true })
const quiet = action => ({ ...action, quiet: true })

// `tone` is reviewContent's key (ui/ReviewTab.jsx). `can` says which actions this surface can
// take (a closed PR cannot start a review, an older run has no retry, ...).
export function reviewActionPlan({ tone, own = false, chat = false, asked = false, stoppable = false, can = {} }) {
  const ask = label => (chat ? [{ key: 'ask', label }] : [])
  const stop = stoppable ? [quiet({ key: 'stop', label: 'Stop review' })] : []
  switch (tone) {
    case 'running':
      return [...ask(NAMES.openChat).map(primary), ...stop]
    case 'halted':
      return [...(can.retry ? [{ key: 'retry', label: NAMES.reviewAgain }] : []), ...ask(NAMES.openChat)]
    case 'needs':
      return [...ask(asked ? NAMES.answerInChat : NAMES.openChat).map(primary), ...stop]
    case 'findings':
    case 'changes':
    case 'fix_ready':
      return [
        ...(own && can.fix ? [primary({ key: 'fix', label: NAMES.fixFindings })] : []),
        // On someone else's PR the next step is saying what you found. On your own PR nothing is ever
        // posted as a review of yourself (pr-machine.js): you fix it or set it aside.
        ...(can.post && !own ? [primary({ key: 'post', label: NAMES.postToGitHub })] : []),
        ...(can.ignore ? [{ key: 'ignore', label: 'Ignore…' }] : []),
        ...(can.again ? [{ key: 'again', label: NAMES.reviewAgain }] : []),
        ...ask('Ask the reviewer something'),
      ]
    case 'ignored':
      return [...(can.undo ? [{ key: 'undo', label: 'Undo ignore' }] : []), ...ask('Ask the reviewer something')]
    default: // a verdict card carries its own buttons; clear, waiting and settled reviews only offer the question
      return ask('Ask the reviewer something')
  }
}
