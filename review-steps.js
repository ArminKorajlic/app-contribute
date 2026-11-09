// Where your own PR is in its cycle, for the strip on top of its Review tab: answer the
// feedback, check it, fix what the check found, then wait on reviewers. Read only from the PR
// machine's decision (pr-machine.js), so the strip can never disagree with the headline.
// It marks a position, not a record: earlier steps are shown as passed, never ticked as done.
// Pure, so every state is tested without a browser.

const STEPS = ['Answer feedback', 'Check', 'Fix', 'Reviewers']
const STEP_OF_STATE = {
  'author.feedback': 0, 'author.draft': 1, 'author.findings': 2, 'author.blocked': 2, 'author.draft_ready': 3,
  'author.waiting_review': 3, 'author.waiting_rereview': 3, 'author.looked_again': 3, 'author.approval_stale': 3,
  'author.approved': 3, 'author.approved_checks': 3, 'author.approved_no_rights': 3,
}
// An agent job is on the step its kind does; Finish it for me moves between checking and
// fixing, so what its saved review is doing right now decides first.
const STEP_OF_JOB = { respond: 0, fix: 2, review: 1, review_merge: 1, review_fix_merge: 2 }
const STEP_OF_ITEM = { reviewing: 1, repairing: 2, pushing: 2 }

function currentStep(standing, itemState) {
  if (standing.state === 'to_confirm') return standing.coveredBy === 'repair' ? 2 : 0
  if (['working', 'needs_answer', 'stalled'].includes(standing.state)) return STEP_OF_ITEM[itemState] ?? STEP_OF_JOB[standing.jobKind] ?? -1
  return STEP_OF_STATE[standing.state] ?? -1
}

// `itemState`: what the PR's saved review is doing. A prepared fix waiting for your Push is the machine's `coveredBy: 'repair'`.
// Returns [] when the strip has nothing true to say.
export function reviewSteps(standing, { itemState = '' } = {}) {
  if (standing?.role !== 'author') return []
  const current = currentStep(standing, itemState)
  if (current < 0) return []
  return STEPS.map((label, index) => ({
    label: index === current && standing.coveredBy === 'repair' ? 'Fix ready: push?' : label,
    at: index < current ? 'passed' : index === current ? 'current' : 'ahead',
  }))
}
