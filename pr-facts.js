// Facts for the PR machine (pr-machine.js): what GitHub's PR read says, plus
// what Contribute's own review runs hold for that PR. A fact that could not be
// read is 'unknown' (or readComplete is false), never a guess from older data.
// Pure: no DOM, no network.
import { checkSummary, ignoredNote, isBotAuthor, reviewItemProgress } from './collaboration.js'
import { isOwnPull } from './pull-view.js'

const LIFECYCLE = { MERGED: 'merged', CLOSED: 'closed' }
const MERGEABLE = { MERGEABLE: 'yes', CONFLICTING: 'conflict' }
const CHECKS = { success: 'pass', failure: 'fail', pending: 'pending' }
// GitHub's review events and the review states they leave behind.
const REVIEW_STATE = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' }

const samePr = (item, pr) => item.repo?.toLowerCase() === pr.repository?.nameWithOwner?.toLowerCase() && item.number === pr.number
const lower = value => String(value || '').toLowerCase()

function lifecycleOf(pr) {
  if (!pr?.headRefOid) return 'unknown'
  return LIFECYCLE[pr.state] || (pr.isDraft ? 'draft' : 'open')
}

// 'none' only when GitHub says the commit has no checks; a missing read is 'unknown'.
function checksOf(pr) {
  const commit = pr?.commits?.nodes?.at(-1)?.commit
  if (!commit || !('statusCheckRollup' in commit)) return 'unknown'
  if (commit.statusCheckRollup === null) return 'none'
  return CHECKS[checkSummary(pr)?.state] || 'unknown'
}

function reviewsOf(pr) {
  const nodes = pr?.latestOpinionatedReviews?.nodes
  if (!Array.isArray(nodes)) return null
  return nodes.filter(node => node?.author?.login && node.commit?.oid).map(node => ({
    by: lower(node.author.login), state: node.state, commit: node.commit.oid,
    bot: node.author.__typename === 'Bot' || isBotAuthor(node.author.login),
  }))
}

// Threads someone else spoke last in. A thread you answered counts as answered.
function openThreadsOf(pr, login) {
  const nodes = pr?.reviewThreads?.nodes
  if (!Array.isArray(nodes)) return 0
  return nodes.filter(thread => thread && thread.isResolved === false
    && lower(thread.comments?.nodes?.at(-1)?.author?.login) !== lower(login)).length
}

// The newest Contribute review of this PR (any version), with its run.
export function newestReviewOf(runs, pr) {
  const matches = (runs || []).flatMap(run => (run.items || []).filter(item => samePr(item, pr)).map(item => ({ run, item })))
  return matches.sort((a, b) => (Date.parse(b.run.created_at || '') || 0) - (Date.parse(a.run.created_at || '') || 0))[0] || null
}

// The job a run is on this PR. A run you stopped holds nothing; one that failed, was
// interrupted, or whose conversation ended while it still says "reviewing" has stalled.
const FINISHED = new Set(['completed', 'failed', 'interrupted'])
function jobOf(run, progress) {
  if (run.execution_state === 'stopped') return ''
  if (progress.waiting) return 'needs_answer'
  if (progress.halted) return 'stalled'
  if (progress.turn !== 'agent') return ''
  return FINISHED.has(run.execution_state) ? 'stalled' : 'running'
}
// What a saved item says is on its way to GitHub, or uncertain there.
const ITEM_OUTBOX = {
  merging: ['merge', 'sending'], queued: ['merge', 'sending'], merge_unknown: ['merge', 'unconfirmed'],
  pushing: ['push', 'sending'], push_unknown: ['push', 'unconfirmed'],
  marking_ready: ['ready', 'sending'], ready_unknown: ['ready', 'unconfirmed'],
  verdict_posting: ['verdict', 'sending'], verdict_unknown: ['verdict', 'unconfirmed'],
}
const VERDICT_OUTBOX = { proposed: 'drafted', posting: 'sending', unknown: 'unconfirmed' }
const COMMENT_OUTBOX = { posting: 'sending', unknown: 'unconfirmed' }

function outboxOf(item) {
  const proposal = item.verdict_proposal
  if (VERDICT_OUTBOX[proposal?.state]) return { kind: 'verdict', event: proposal.event, head: proposal.head_sha || item.head_sha, state: VERDICT_OUTBOX[proposal.state] }
  const repair = (item.repair_attempts || []).find(attempt => attempt.state === 'proposed')
  if (repair) return { kind: 'push', head: repair.head_sha || item.head_sha, state: 'drafted', attempt: repair.id }
  if (COMMENT_OUTBOX[item.public_review?.state]) return { kind: 'comment', head: item.head_sha, state: COMMENT_OUTBOX[item.public_review.state] }
  const [kind, state] = ITEM_OUTBOX[item.state] || []
  return kind ? { kind, head: item.head_sha, state } : null
}

function resultOf(item, progress, ignored) {
  if (item.state === 'all_clear') return { head: item.head_sha, outcome: 'clear', setAside: false }
  if (item.state !== 'needs_you' || progress.waiting || progress.halted) return null
  const setAside = !!ignoredNote(item, ignored) || ['discarded', 'not_dispatched'].includes(item.verdict_proposal?.state)
  return { head: item.head_sha, outcome: 'findings', setAside }
}

// A review this app saw GitHub confirm counts before GitHub's own list catches up.
function sentReview(item) {
  const proposal = item.verdict_proposal
  if (proposal?.state === 'posted') return { state: REVIEW_STATE[proposal.event] || 'COMMENTED', commit: proposal.head_sha || item.head_sha }
  if (item.public_review?.state === 'posted') return { state: 'COMMENTED', commit: item.head_sha }
  return null
}

function myReviewOf(pr, sent) {
  const github = pr?.viewerLatestReview?.commit?.oid ? { state: pr.viewerLatestReview.state, commit: pr.viewerLatestReview.commit.oid } : null
  if (!sent || github?.commit === pr.headRefOid) return github
  return sent.commit === pr.headRefOid ? sent : github || sent
}

// GitHub's opinions, plus a verdict of yours that GitHub confirmed to this app at
// this version but its list does not show yet (a newer opinion replaces the older).
function withSentVerdict(reviews, sent, pr, login) {
  if (!sent || sent.state === 'COMMENTED' || sent.commit !== pr.headRefOid) return reviews
  if (reviews.some(review => review.by === lower(login) && review.commit === sent.commit)) return reviews
  return [...reviews.filter(review => review.by !== lower(login)), { by: lower(login), state: sent.state, commit: sent.commit, bot: false }]
}

function runFacts(review, pr, own, ignored) {
  if (!review) return { job: null, result: null, outbox: null, sent: null }
  const { run, item } = review
  const progress = reviewItemProgress(run, item, { own, ignored })
  const outbox = outboxOf(item)
  const job = jobOf(run, progress)
  return {
    job: job && !(job === 'running' && outbox?.state === 'sending') ? { kind: run.mode || 'review', state: job } : null,
    result: resultOf(item, progress, ignored),
    outbox,
    sent: sentReview(item),
  }
}

// Facts for one PR. `runs` are Contribute's review runs; `ignored` the owner's
// set-aside notes; `login` the connected GitHub account.
export function prFacts({ pr, login, runs = [], ignored = null }) {
  const own = isOwnPull(pr, login)
  const reviews = reviewsOf(pr)
  const fromRuns = runFacts(newestReviewOf(runs, pr), pr, own, ignored)
  const myReview = own ? null : myReviewOf(pr, fromRuns.sent)
  return {
    role: own ? 'author' : 'reviewer',
    author: lower(pr?.author?.login),
    head: pr?.headRefOid || '',
    lifecycle: lifecycleOf(pr),
    checks: checksOf(pr),
    mergeable: MERGEABLE[pr?.mergeable] || 'unknown',
    permission: pr?.repository?.viewerPermission || 'unknown',
    reviews: own ? reviews || [] : withSentVerdict(reviews || [], fromRuns.sent, pr, login),
    myReview,
    openThreads: own ? openThreadsOf(pr, login) : 0,
    job: fromRuns.job,
    result: fromRuns.result,
    outbox: fromRuns.outbox,
    readComplete: reviews !== null,
  }
}
