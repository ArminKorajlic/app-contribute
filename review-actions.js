// What the Review tab offers once a review exists, chosen by what actually
// happened (not by the saved word alone): the next step comes first, a finished
// review never offers "Stop review", and the conversation is a plain button for
// the day the owner wants to ask something specific. Pure, so the choice is
// tested without a browser. The tab wires each `key` to its handler.

// Why a finding is set aside. The note is for the owner's own memory: nothing
// is posted, and it applies to this exact version of the PR only.
export const IGNORE_REASONS = ['Not a problem', 'I’ll do it later', 'Already fixed', 'Out of scope']

const primary = action => ({ ...action, primary: true })
const quiet = action => ({ ...action, quiet: true })

// `tone` is reviewStateTone's key. `can` says which actions this surface can
// take (a closed PR cannot start a review, an older run has no retry, ...).
export function reviewActionPlan({ tone, own = false, chat = false, asked = false, stoppable = false, can = {} }) {
  const ask = label => (chat ? [{ key: 'ask', label }] : [])
  const stop = stoppable ? [quiet({ key: 'stop', label: 'Stop review' })] : []
  switch (tone) {
    case 'running':
      return [...ask('Open review conversation').map(primary), ...stop]
    case 'halted':
      return [...(can.retry ? [{ key: 'retry', label: 'Start again' }] : []), ...ask('Open review conversation')]
    case 'needs':
      return [...ask(asked ? 'Answer in review conversation' : 'Open review conversation').map(primary), ...stop]
    case 'findings':
    case 'changes':
      return [
        ...(own && can.fix ? [primary({ key: 'fix', label: 'Fix these findings' })] : []),
        ...(!own && can.post ? [primary({ key: 'post', label: 'Post to GitHub' })] : []),
        ...(can.ignore ? [{ key: 'ignore', label: 'Ignore…' }] : []),
        ...(can.again ? [{ key: 'again', label: 'Review again' }] : []),
        ...ask('Ask the reviewer something'),
      ]
    case 'ignored':
      return [...(can.ignore ? [{ key: 'undo', label: 'Undo ignore' }] : []), ...ask('Ask the reviewer something')]
    default: // a verdict card carries its own buttons; clear, waiting and settled reviews only offer the question
      return ask('Ask the reviewer something')
  }
}
