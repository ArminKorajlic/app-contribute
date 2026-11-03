// What the Agent menu offers for the PR(s) in front of it. Pure: the header
// line says where the PR stands, the choice it needs comes first, and a choice
// that cannot run stays in its place, dimmed, with one line saying why.
import { checkSummary, conversationCount, mayMerge, takeoverBlocker } from './collaboration.js'

// The jobs in their fixed order. `intent` is what the review window opens
// with (reviewIntent in collaboration.js).
export const AGENT_JOBS = [
  { intent: 'review', icon: 'review', title: 'Review', detail: 'Private notes, or a review on GitHub.' },
  { intent: 'address', icon: 'feedback', title: 'Address feedback', detail: 'Act on the reviews and open threads. Shows you the changes first.' },
  { intent: 'merge', icon: 'merge', title: 'Review and merge', detail: 'Reviews it, then merges if approved and green.' },
  { intent: 'review_fix_merge', icon: 'fix', title: 'Hand it over', detail: 'Reviews, fixes what it finds, merges when clean.' },
]

// The jobs this build can open. Address feedback joins when its window exists.
export const OPENABLE_JOBS = ['review', 'address', 'merge', 'review_fix_merge']

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

// `offered` lists the intents this build can open (Address feedback is added
// when its window exists). Returns { header, items }; each item is a job plus
// { rec, off, reason }.
export function agentMenuModel(pulls, { offered = OPENABLE_JOBS } = {}) {
  const list = Array.isArray(pulls) ? pulls.filter(Boolean) : []
  const one = list.length === 1
  const standings = list.map(pullStanding)
  const first = standings[0] || null
  const anyDraft = standings.some(standing => standing.draft)
  const feedbackNeeded = one && (first.decision === 'CHANGES_REQUESTED' || first.failing || first.conflict)
  const ready = one && !first.draft && first.decision === 'APPROVED' && !first.failing && !first.conflict
    && first.canMerge && (!first.checks || first.checks.state === 'success')
  const recommended = feedbackNeeded && offered.includes('address') ? 'address' : ready ? 'merge' : 'review'

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
  const items = AGENT_JOBS.filter(job => offered.includes(job.intent)).map(job => {
    const reason = reasonFor[job.intent]?.() || ''
    return { ...job, rec: job.intent === recommended && !reason, off: !!reason, reason }
  })
  items.sort((a, b) => Number(b.rec) - Number(a.rec))
  return { header: one ? headerFor(list[0], first) : list.length ? { label: `${list.length} PRs`, text: 'selected' } : null, items }
}
