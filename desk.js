// The Desk home: pure logic for the side views, their counts, and the
// per-project grouping the envelopes render. UI stays in ui/Desk.jsx and
// ui/DeskViews.jsx; everything here is testable without a DOM.
import { checkSummary, prKey } from './collaboration.js'
import { attentionListItems } from './run.js'
import { NAMES } from './names.js'
import { projectIsQuiet } from './source-map.js'

// The four views (finding 2). Every other place a PR can be lives inside one of them.
// `short` is the word under the count on the phone's four-segment bar.
export const DESK_VIEWS = [
  { key: 'needs', label: NAMES.needsYou, short: NAMES.needsYou, icon: 'review' },
  { key: 'requests', label: NAMES.reviewRequests, short: 'Requests', icon: 'feedback' },
  { key: 'mine', label: NAMES.myPrs, short: NAMES.myPrs, icon: 'pull' },
  { key: 'runs', label: NAMES.agentRuns, short: NAMES.agentRuns, icon: 'cycle' },
]

// The views that were folded in, by the view that holds their rows now. A saved
// place or an older link to one of them lands there.
export const FOLDED_VIEWS = { confirm: 'needs', edits: 'needs', merged: 'mine', work: 'runs', reviews: 'runs' }
export const deskViewKey = key => FOLDED_VIEWS[key] || key

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

// Submitting a review answers its request on GitHub, which then stops listing
// the PR as waiting on the owner. Say so at once instead of at the next read.
export function settleReviewRequest(incoming, repo, number) {
  const key = `${repo.toLowerCase()}#${number}`
  return incoming.map(pr => (pr.reviewRequested && prKey(pr) === key ? { ...pr, reviewRequested: false } : pr))
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

// A review run that waits on you (its result, a draft to send, a question, a stop)
// and is not already a row of its own in Needs you.
const AGENT_WAITS = new Set(['waiting', 'stalled'])
export const agentRunsWaiting = (entries, shownKeys) => (entries || [])
  .filter(entry => AGENT_WAITS.has(entry.bucket) && !shownKeys.has(entry.id))

// The PR keys Needs you already lists as rows: review requests, feedback cards, and
// your own PRs with a step. An agent run on one of them is not counted twice.
export function needsRowKeys(incoming, questionItems, login) {
  const covered = feedbackPullKeys(questionItems)
  const own = authoredPulls(incoming, login)
    .filter(pr => !covered.has(pullKey(pr)))
    .filter(pr => { const state = authoredPullState(pr); return state.tone === 'blocker' || state.key === 'ready' })
  return new Set([...covered, ...(incoming || []).filter(pr => pr.reviewRequested).map(pullKey), ...own.map(pullKey)])
}

// The counts of the Needs you chips: one per next step. The rail badge is their sum
// (needsCount), so the two can never disagree. A PR whose feedback card is listed
// counts once, as that card. Drafts ready to open and local files are not urgent:
// they get a quiet line and the project banner, never a number here.
export function deskCounts({ projects = [], decisions = [], incoming = [], records = [], login = '', reviews = null, reviewEntries = [] } = {}) {
  const questionItems = attentionListItems(decisions)
  const covered = feedbackPullKeys(questionItems)
  const pulls = authoredPulls(incoming, login)
  const open = pulls.filter(pr => !covered.has(pullKey(pr))).map(authoredPullState)
  const states = pulls.map(authoredPullState)
  return {
    questions: questionItems.length,
    requests: (incoming || []).filter(pr => pr.reviewRequested).length,
    merge: open.filter(state => state.key === 'ready').length,
    fix: open.filter(state => state.tone === 'blocker').length,
    agent: agentRunsWaiting(reviewEntries, needsRowKeys(incoming, questionItems, login)).length,
    drafts: states.filter(state => state.key === 'approved_draft').length,
    mine: pulls.length,
    merged: mergedRecently(records).length,
    reviewsRunning: reviews?.running || 0,
    reviewsFinished: (reviewEntries || []).length - (reviews?.running || 0),
  }
}

// The Needs you chips, in order; each filters the list below it to its rows.
export const NEEDS_CHIPS = [
  { key: 'look', label: 'To look at', count: counts => counts.questions },
  { key: 'review', label: 'Review', count: counts => counts.requests },
  { key: 'merge', label: 'Merge', count: counts => counts.merge },
  { key: 'fix', label: 'Fix', count: counts => counts.fix },
  { key: 'agent', label: NAMES.agentRuns, count: counts => counts.agent || 0 },
]

export const needsCount = counts => NEEDS_CHIPS.reduce((total, chip) => total + chip.count(counts), 0)

// A badge on a view that waits on you is purple and is the sum of that page's
// chips; the others are a quiet total of what the page holds.
export function railBadge(view, counts) {
  switch (view) {
    case 'needs': return needsCount(counts)
    case 'requests': return counts.requests
    case 'mine': return counts.mine
    case 'runs': return counts.reviewsRunning || 0
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
