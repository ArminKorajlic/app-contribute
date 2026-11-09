// What the Actions menu offers for the PR(s) in front of it. Pure: the header
// line says where the PR stands, then two groups: what you can do yourself
// ("You") and what an agent can do ("Agent"). The choice a PR needs comes
// first, and a choice that cannot run stays in its place, dimmed, with one line
// saying why.
import { checkSummary, conversationCount, mayMerge, takeoverBlocker } from './collaboration.js'
import { isPersonalDraft } from './domain.js'
import { intentBlocker } from './pr-flow.js'

// The agent jobs in their fixed order. `intent` is what the review window opens
// with (reviewIntent in collaboration.js).
export const AGENT_JOBS = [
  { intent: 'review', icon: 'review', title: 'Review', detail: 'Private notes, or a review on GitHub.' },
  { intent: 'address', icon: 'feedback', title: 'Address feedback', detail: 'Act on the reviews and open threads. Shows you the changes first.' },
  { intent: 'merge', icon: 'merge', title: 'Review and merge', detail: 'Reviews it, then merges if approved and green.' },
  { intent: 'review_fix_merge', icon: 'fix', title: 'Hand it over', detail: 'Reviews, fixes what it finds, merges when clean.' },
]

// On your own PR an agent's review is a private check of your work: it never posts anything.
const OWN_DETAILS = { review: 'Checks your PR privately. Nothing is posted.' }

// The agent jobs this build can open. Address feedback joins when its window exists.
export const OPENABLE_JOBS = ['review', 'address', 'merge', 'review_fix_merge']

// What you can do yourself on one PR. Each ends in a confirm sheet (ActionConfirm).
export const YOUR_ACTIONS = [
  { intent: 'open_review', icon: 'send', title: 'Open for review', detail: 'Asks reviewers to look. Nothing merges.' },
  { intent: 'merge_now', icon: 'merge', title: 'Merge', detail: 'Lands it in the target branch. You confirm once more.' },
]
export const YOUR_INTENTS = new Set(YOUR_ACTIONS.map(action => action.intent))

// What a single PR's list data says about it.
export function pullStanding(pr) {
  const checks = checkSummary(pr)
  return {
    draft: pr?.isDraft === true,
    decision: pr?.reviewDecision || '',
    failing: checks?.failed > 0,
    checks,
    conflict: pr?.mergeable === 'CONFLICTING',
    conversation: conversationCount(pr),
    canMerge: mayMerge(pr?.repository?.viewerPermission),
    base: pr?.baseRefName || 'the target branch',
  }
}

const DECISION_WORDS = { CHANGES_REQUESTED: 'changes requested', APPROVED: 'approved', REVIEW_REQUIRED: 'review required' }

function headerFor(pr, standing) {
  const parts = []
  if (standing.draft) parts.push('draft')
  if (DECISION_WORDS[standing.decision]) parts.push(DECISION_WORDS[standing.decision])
  else if (!standing.conversation) parts.push('no reviews')
  if (standing.failing) parts.push(`${standing.checks.failed} failing ${standing.checks.failed === 1 ? 'check' : 'checks'}`)
  else if (standing.checks?.state === 'success') parts.push('checks passing')
  else if (standing.checks?.state === 'pending') parts.push('checks running')
  if (standing.conflict) parts.push(`conflicts with ${standing.base}`)
  return { label: `#${pr.number}`, text: parts.join(' · ') }
}

// Why Merge cannot run on this PR right now, in the words of the PR's own
// state; '' when nothing in the list data stands in the way. The platform
// re-checks everything at the moment of merging, so this only explains early.
export function mergeBlocker(standing) {
  if (standing.draft) return 'Open it for review first.'
  if (!standing.canMerge) return 'Needs merge access.'
  if (standing.decision === 'CHANGES_REQUESTED') return 'Changes are requested.'
  if (standing.decision === 'REVIEW_REQUIRED') return 'GitHub still needs a review.'
  if (standing.failing) return 'Checks are failing.'
  if (standing.checks?.state === 'pending') return 'Checks are still running.'
  if (standing.conflict) return `It conflicts with ${standing.base}.`
  return ''
}

// Your own actions on one PR. Open for review exists for a draft this app sent
// and for a draft you wrote where this Möbius can mark it ready for you; Merge
// only where this Möbius can merge for you.
function yourActions({ one, first, record, capabilities, own }) {
  if (!one) return []
  const offered = YOUR_ACTIONS.filter(action => action.intent === 'open_review'
    ? first.draft && (isPersonalDraft(record) || (own === true && capabilities?.mark_ready_now === true))
    : capabilities?.merge_now === true)
  return offered.map(action => {
    const reason = action.intent === 'merge_now' ? mergeBlocker(first) : ''
    return { ...action, off: !!reason, reason }
  })
}

// `offered` lists the agent intents this build can open. Returns
// { header, you, agent }; each item is a job plus { rec, off, reason }. `record`
// is the saved contribution behind a single PR (if any), and `capabilities`
// what this Möbius advertises, and `own` whether you wrote the PR.
export function actionsMenuModel(pulls, { offered = OPENABLE_JOBS, record = null, capabilities = null, own = false } = {}) {
  const list = Array.isArray(pulls) ? pulls.filter(Boolean) : []
  const one = list.length === 1
  const standings = list.map(pullStanding)
  const first = standings[0] || null
  const anyDraft = standings.some(standing => standing.draft)
  const feedbackNeeded = one && (first.decision === 'CHANGES_REQUESTED' || first.failing || first.conflict)
  const ready = one && !first.draft && first.decision === 'APPROVED' && !first.failing && !first.conflict
    && first.canMerge && (!first.checks || first.checks.state === 'success')
  const you = yourActions({ one, first, record, capabilities, own })
  const canMergeNow = you.some(item => item.intent === 'merge_now' && !item.off)
  // Merge yourself outranks asking an agent to merge; a draft waits on Open for review.
  const recommended = feedbackNeeded && offered.includes('address') ? 'address'
    : ready && canMergeNow ? 'merge_now'
    : ready ? 'merge'
    : first?.draft && first.decision === 'APPROVED' && you.some(item => item.intent === 'open_review') ? 'open_review'
    : 'review'

  const reasonFor = {
    address: () => {
      if (!one) return 'Choose one PR at a time.'
      if (feedbackNeeded || first.conversation > 0) return ''
      return first.decision === 'APPROVED' ? 'Nothing open to address.' : 'No feedback yet.'
    },
    merge: () => {
      if (anyDraft) return 'Mark it ready for review first.'
      if (list.some(pr => !mayMerge(pr?.repository?.viewerPermission))) return 'Needs merge access.'
      if (!one) return ''
      if (first.decision === 'CHANGES_REQUESTED') return 'Changes are requested.'
      if (first.failing) return 'Checks are failing.'
      if (first.conflict) return `It conflicts with ${first.base}.`
      return ''
    },
    // Whether a draft may be handed over depends on what this Möbius supports,
    // which the window checks; the menu only knows rights and a deleted fork.
    review_fix_merge: () => (list.length ? takeoverBlocker(list, { allowDraft: true }) : ''),
  }
  // Who you are on the PR decides what an agent may do for you (pr-flow.js). A batch mixes
  // roles, so only a single PR is judged here; the server keeps your own PRs private either way.
  const role = own ? 'author' : 'reviewer'
  const agent = AGENT_JOBS.filter(job => offered.includes(job.intent)).map(job => {
    const reason = (one ? intentBlocker(role, job.intent) : '') || reasonFor[job.intent]?.() || ''
    const detail = one && own ? OWN_DETAILS[job.intent] || job.detail : job.detail
    return { ...job, detail, rec: job.intent === recommended && !reason, off: !!reason, reason }
  })
  const marked = you.map(item => ({ ...item, rec: item.intent === recommended && !item.off }))
  // The choice a PR needs comes first inside its group.
  agent.sort((a, b) => Number(b.rec) - Number(a.rec))
  return {
    header: one ? headerFor(list[0], first) : list.length ? { label: `${list.length} PRs`, text: 'selected' } : null,
    you: marked,
    agent,
  }
}
