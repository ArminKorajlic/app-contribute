// The Desk home: pure logic for the side views, their counts, and the
// per-project grouping the envelopes render. UI stays in ui/Desk.jsx and
// ui/DeskViews.jsx; everything here is testable without a DOM.
import { checkSummary } from './collaboration.js'
import { attentionListItems } from './run.js'
import {
  localChangeSummary,
  projectIsQuiet,
  projectNeedsSorting,
  projectReadyToPrepare,
} from './source-map.js'

export const DESK_VIEWS = [
  { key: 'needs', label: 'Needs you', icon: 'review' },
  // The rail is narrow, so it says To confirm; the page says the whole thing.
  { key: 'confirm', label: 'To confirm', heading: 'Waiting for your confirmation', icon: 'send' },
  { key: 'requests', label: 'Review requests', icon: 'feedback' },
  { key: 'mine', label: 'My PRs', icon: 'github' },
  { key: 'work', label: 'My work', icon: 'prepare' },
  { key: 'reviews', label: 'PR reviews', icon: 'review' },
  { key: 'edits', label: 'Your edits', icon: 'edit' },
  { key: 'merged', label: 'Merged this week', icon: 'check' },
]

const sameLogin = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

// The next step on a PR the owner authored, in plain words. Passing checks are
// never a review verdict; an approval on a draft still waits on Mark ready.
export function authoredPullState(pr) {
  const checks = checkSummary(pr)
  if (checks?.failed) {
    return { key: 'failing', label: `${checks.failed} failing ${checks.failed === 1 ? 'check' : 'checks'}`, tone: 'blocker' }
  }
  if (pr?.mergeable === 'CONFLICTING') return { key: 'conflict', label: 'Merge blocked', tone: 'blocker' }
  if (pr?.reviewDecision === 'CHANGES_REQUESTED') return { key: 'changes', label: 'Changes requested', tone: 'blocker' }
  if (pr?.reviewDecision === 'APPROVED') {
    if (pr.isDraft) return { key: 'approved_draft', label: 'Approved, still a draft', tone: 'ready' }
    return { key: 'ready', label: 'Approved, ready to merge', tone: 'ready' }
  }
  return { key: 'waiting', label: 'Waiting on reviewers', tone: 'quiet' }
}

// PRs the owner authored, out of everything GitHub says involves them.
export function authoredPulls(incoming, login) {
  return (incoming || []).filter(pr => !pr.reviewRequested && sameLogin(pr?.author?.login, login))
}

// Group one repository's PRs into base→head chains (a stack) so related work
// reads as one unit. Order inside a chain follows merge order: the PR whose
// base no other PR provides merges first.
export function chainPulls(pulls) {
  const list = (pulls || []).filter(pr => pr?.headRefName)
  const byHead = new Map(list.map(pr => [pr.headRefName, pr]))
  const roots = list.filter(pr => !byHead.has(pr.baseRefName))
  const chained = new Set()
  const groups = []
  for (const root of roots) {
    const chain = [root]
    chained.add(root.headRefName)
    let next = list.find(pr => pr.baseRefName === chain[chain.length - 1].headRefName && !chained.has(pr.headRefName))
    while (next) {
      chain.push(next)
      chained.add(next.headRefName)
      next = list.find(pr => pr.baseRefName === chain[chain.length - 1].headRefName && !chained.has(pr.headRefName))
    }
    groups.push(chain)
  }
  // A cycle (never expected from GitHub) or missing data falls back to singles.
  for (const pr of list) if (!chained.has(pr.headRefName)) groups.push([pr])
  return groups
}

// Projects with local work to publish, rail and Your-edits view alike.
export function editProjects(projects) {
  return (projects || []).filter(project => project.kind !== 'external'
    && (projectReadyToPrepare(project) || projectNeedsSorting(project)))
}

export const MERGED_WINDOW_DAYS = 7

export function mergedRecently(records, now = Date.now()) {
  const cutoff = now - MERGED_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return (records || []).filter(record => ['merged', 'superseded'].includes(record?.status)
    && (Date.parse(record.updated_at || record.created_at || '') || 0) >= cutoff)
}

// A PR's identity across feedback records and the authored-PR list.
export const pullKey = pr => `${String(pr?.repository?.nameWithOwner || '').toLowerCase()}#${pr?.number}`

// PRs that already have a feedback card, so the PR is not listed a second time.
export function feedbackPullKeys(items) {
  return new Set((items || []).map(feedbackPull).filter(Boolean).map(pullKey))
}

// What a project's card lists in Needs you, as one definition for the card
// and for the project's number in the rail: review requests, feedback cards,
// and the owner's own PRs that need a step and have no feedback card already.
export function needsPulls(project, items, login) {
  const covered = feedbackPullKeys(items)
  return authoredPulls(project.incomingReviews, login)
    .filter(pr => !covered.has(pullKey(pr)))
    .map(pr => [pr, authoredPullState(pr)])
    .filter(([, state]) => state.tone !== 'quiet' && state.key !== 'approved_draft')
}

export function projectNeedsCount(project, decisions, login) {
  const items = attentionListItems(decisions)
  return (project.reviewRequests?.length || 0) + items.length + needsPulls(project, items, login).length
}

// The clickable counts under the heading: what needs the owner, by next step.
export function deskCounts({ projects = [], decisions = [], incoming = [], records = [], login = '', reviews = null } = {}) {
  const questionItems = attentionListItems(decisions)
  const covered = feedbackPullKeys(questionItems)
  const pulls = authoredPulls(incoming, login)
  const states = pulls.map(authoredPullState)
  // A PR with a feedback card AND a merge or fix step is one thing to do, not two.
  const doubled = pulls.filter((pr, index) => covered.has(pullKey(pr)) && (states[index].key === 'ready' || states[index].tone === 'blocker')).length
  const edits = editProjects(projects)
  return {
    questions: questionItems.length,
    doubled,
    requests: (incoming || []).filter(pr => pr.reviewRequested).length,
    merge: states.filter(state => state.key === 'ready').length,
    fix: states.filter(state => state.tone === 'blocker').length,
    drafts: states.filter(state => state.key === 'approved_draft').length,
    editedFiles: edits.reduce((total, project) => total + localChangeSummary(project).changed, 0),
    editProjects: edits.length,
    mine: pulls.length,
    work: decisions.length,
    merged: mergedRecently(records).length,
    // Reviews you started: waiting on you (the badge) and agents still at work (a spinner).
    reviewsWaiting: reviews?.waiting || 0,
    reviewsRunning: reviews?.running || 0,
    reviewsConfirm: reviews?.confirm || 0,
  }
}

export const needsCount = counts => counts.questions + counts.requests + counts.merge + counts.fix - (counts.doubled || 0)

export function railBadge(view, counts) {
  switch (view) {
    case 'needs': return needsCount(counts)
    case 'requests': return counts.requests
    case 'mine': return counts.mine
    case 'work': return counts.work
    case 'reviews': return counts.reviewsWaiting || 0
    case 'confirm': return counts.reviewsConfirm || 0
    case 'edits': return counts.editedFiles
    case 'merged': return counts.merged
    default: return 0
  }
}

// A quiet dot on anything that changed since the owner last opened Contribute.
// The timestamp lives in app settings, written once per visit.
export const DESK_LAST_LOOKED_KEY = 'desk_last_looked'

export function newSince(value, lastLooked) {
  const seen = Date.parse(lastLooked || '') || 0
  if (!seen) return false
  const changed = Date.parse(value || '') || 0
  return changed > seen
}

// Feedback about a published PR reads best on the PR itself: its page shows
// the review text in Conversation. Publication decisions keep their card.
export function feedbackPull(item) {
  if (!['public_attention', 'private_review'].includes(item?.kind)) return null
  const record = item?.record
  const repo = record?.plan?.repo || record?.repo
  const number = Number(record?.number)
  if (!repo || !Number.isSafeInteger(number) || number <= 0) return null
  return { number, repository: { nameWithOwner: repo } }
}

// The rail's project groups, in the directory's own order: projects with
// something going on first, quiet apps folded, externals last.
export function splitProjects(projects, attention = {}) {
  const tracked = (projects || []).filter(project => project.kind !== 'external' && !project.builtHere)
  const isQuiet = project => projectIsQuiet(project) && !attention[project.key] && !(project.reviewRequests?.length)
  return {
    active: tracked.filter(project => !isQuiet(project)),
    quiet: tracked.filter(isQuiet),
    builtHere: (projects || []).filter(project => project.builtHere),
    external: (projects || []).filter(project => project.kind === 'external'),
  }
}
