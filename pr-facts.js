// Facts for the PR machine (pr-machine.js): what GitHub's PR read says, plus
// what Contribute's own review runs hold for that PR. A fact that could not be
// read is 'unknown' (or readComplete is false), never a guess from older data.
// Pure: no DOM, no network.
import { checkSummary, ignoredNote, isBotAuthor, reviewItemProgress, waitingRepair } from './collaboration.js'
import { isOwnPull } from './pull-view.js'
import { responseFor, responseOutbox } from './respond-result.js'

const LIFECYCLE = { MERGED: 'merged', CLOSED: 'closed' }
const MERGEABLE = { MERGEABLE: 'yes', CONFLICTING: 'conflict' }
const CHECKS = { success: 'pass', failure: 'fail', pending: 'pending' }
// GitHub's review events and the review states they leave behind.
const REVIEW_STATE = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' }

const samePr = (item, pr) => item.repo?.toLowerCase() === pr.repository?.nameWithOwner?.toLowerCase() && item.number === pr.number
const lower = value => String(value || '').toLowerCase()
const isBot = author => author?.__typename === 'Bot' || isBotAuthor(author?.login)

// A PR whose state GitHub did not return is unknown, never assumed open.
function lifecycleOf(pr) {
  if (!pr?.headRefOid || !['OPEN', 'CLOSED', 'MERGED'].includes(pr.state)) return 'unknown'
  return LIFECYCLE[pr.state] || (pr.isDraft ? 'draft' : 'open')
}

// 'none' only when GitHub says the commit has no checks; a missing read is 'unknown'.
function checksOf(pr) {
  const commit = pr?.commits?.nodes?.at(-1)?.commit
  if (!commit || !('statusCheckRollup' in commit)) return 'unknown'
  if (commit.statusCheckRollup === null) return 'none'
  return CHECKS[checkSummary(pr)?.state] || 'unknown'
}

// Every opinion GitHub lists. A deleted account reads as "ghost" and a review whose
// commit is gone (a force-push) keeps an empty commit: it still blocks as a change
// request and never counts as an approval of this version.
function reviewsOf(pr) {
  const nodes = pr?.latestOpinionatedReviews?.nodes
  if (!Array.isArray(nodes)) return null
  return nodes.filter(node => node?.state).map(node => ({
    by: node.author?.login || 'ghost', state: node.state, commit: node.commit?.oid || '', bot: isBot(node.author),
  }))
}

// Threads a person other than you spoke last in (a bot's thread is input, never
// waiting on you). The PR's own conversation counts as one more such thread: a plain
// comment is feedback too, until you answer it. Whoever of the newest ten comments spoke
// last among people decides, so a bot's update after a reviewer's comment does not hide it.
// Null when the threads were not read.
const waitsOnYou = (author, login) => !!author && !isBot(author) && lower(author.login) !== lower(login)
const lastPersonIn = comments => (comments || []).filter(comment => !isBot(comment?.author)).at(-1)?.author
function openThreadsOf(pr, login) {
  const nodes = pr?.reviewThreads?.nodes
  if (!Array.isArray(nodes)) return null
  const threads = nodes.filter(thread => thread && thread.isResolved === false && waitsOnYou(thread.comments?.nodes?.at(-1)?.author, login)).length
  return threads + (waitsOnYou(lastPersonIn(pr.comments?.nodes), login) ? 1 : 0)
}

// The newest Contribute review of this PR (any version), with its run.
export function newestReviewOf(runs, pr) {
  const matches = (runs || []).flatMap(run => (run.items || []).filter(item => samePr(item, pr)).map(item => ({ run, item })))
  return matches.sort((a, b) => (Date.parse(b.run.created_at || '') || 0) - (Date.parse(a.run.created_at || '') || 0))[0] || null
}

// The job a run is on this PR. A run you stopped holds nothing; one that failed or was
// interrupted has stalled. A review whose own turn ended ("completed") while it still says
// "reviewing" is working: it hands the PR to its reviewer helper and sleeps until that
// helper reports. When nothing will wake it any more, the platform reports "interrupted".
function jobOf(run, progress) {
  if (run.execution_state === 'stopped') return ''
  if (progress.waiting) return 'needs_answer'
  if (progress.halted) return 'stalled'
  return progress.turn === 'agent' ? 'running' : ''
}
// What a saved item says is on its way to GitHub, or uncertain there.
const ITEM_OUTBOX = {
  merging: ['merge', 'sending'], queued: ['merge', 'sending'], merge_unknown: ['merge', 'unconfirmed'],
  pushing: ['push', 'sending'], push_unknown: ['push', 'unconfirmed'],
  marking_ready: ['ready', 'sending'], ready_unknown: ['ready', 'unconfirmed'],
  verdict_posting: ['verdict', 'sending'], verdict_unknown: ['verdict', 'unconfirmed'],
}
// A verdict and a fix deal with the findings of their review: while one waits or is on its way it owns them (pr-machine.js).
const COVERING_KINDS = new Set(['verdict', 'push'])
const VERDICT_OUTBOX = { proposed: 'drafted', posting: 'sending', unknown: 'unconfirmed' }
const COMMENT_OUTBOX = { posting: 'sending', unknown: 'unconfirmed' }

function outboxOf(item) {
  const proposal = item.verdict_proposal
  if (VERDICT_OUTBOX[proposal?.state]) return { kind: 'verdict', event: proposal.event, head: proposal.head_sha || item.head_sha, state: VERDICT_OUTBOX[proposal.state], covers: true }
  const repair = waitingRepair(item)
  if (repair) return { kind: 'repair', head: repair.base, state: 'drafted', attempt: repair.id, covers: true }
  if (COMMENT_OUTBOX[item.public_review?.state]) return { kind: 'comment', head: item.head_sha, state: COMMENT_OUTBOX[item.public_review.state] }
  const [kind, state] = ITEM_OUTBOX[item.state] || []
  return kind ? { kind, head: item.head_sha, state, ...(COVERING_KINDS.has(kind) ? { covers: true } : {}) } : null
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

// Your review that counts: a plain comment never hides an opinion of yours (a change
// request you still owe a re-review on), and a pending review is not one yet.
function myReviewOf(pr, sent, reviews, login) {
  const latest = pr?.viewerLatestReview
  const opinion = (reviews || []).find(review => lower(review.by) === lower(login))
  const github = latest?.commit?.oid && latest.state !== 'PENDING'
    ? (latest.state === 'COMMENTED' && opinion ? opinion : { state: latest.state, commit: latest.commit.oid })
    : opinion || null
  if (!sent || github?.commit === pr.headRefOid) return github
  return sent.commit === pr.headRefOid ? sent : github || sent
}

// GitHub's opinions, plus a verdict of yours that GitHub confirmed to this app at
// this version but its list does not show yet (a newer opinion replaces the older).
function withSentVerdict(reviews, sent, pr, login) {
  if (!sent || sent.state === 'COMMENTED' || sent.commit !== pr.headRefOid) return reviews
  if (reviews.some(review => lower(review.by) === lower(login) && review.commit === sent.commit)) return reviews
  return [...reviews.filter(review => lower(review.by) !== lower(login)), { by: login, state: sent.state, commit: sent.commit, bot: false }]
}

// A Respond-to-feedback conversation is no review run, yet while it can still move it is
// the PR's one agent job. The platform lists those chats beside the runs; the PR page also
// needs the chat itself (its id) to offer it, so this one finder serves both.
export const respondChatOf = (chats, pr) => (chats || []).find(candidate => samePr(candidate, pr)) || null
const respondJobOf = (chats, pr) => {
  const chat = respondChatOf(chats, pr)
  return chat ? { kind: 'respond', state: chat.state } : null
}

// A stalled run holds nothing, so a live Respond conversation takes the PR before it.
const jobFor = (runJob, chats, pr) => (runJob && runJob.state !== 'stalled' ? runJob : respondJobOf(chats, pr) || runJob)

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

// Facts for one PR. `runs` are Contribute's review runs and `chats` its live
// Respond-to-feedback conversations ({ repo, number, state }); `ignored` the
// owner's set-aside notes; `login` the connected GitHub account.
export function prFacts({ pr, login, runs = [], ignored = null, chats = [], responses = [] }) {
  const own = isOwnPull(pr, login)
  const reviews = reviewsOf(pr)
  const review = newestReviewOf(runs, pr)
  const fromRuns = runFacts(review, pr, own, ignored)
  const myReview = own ? null : myReviewOf(pr, fromRuns.sent, reviews, login)
  const threads = own ? openThreadsOf(pr, login) : 0
  return {
    role: own ? 'author' : 'reviewer',
    author: pr?.author?.login || '',
    head: pr?.headRefOid || '',
    lifecycle: lifecycleOf(pr),
    checks: checksOf(pr),
    mergeable: MERGEABLE[pr?.mergeable] || 'unknown',
    permission: pr?.repository?.viewerPermission || 'unknown',
    reviews: own ? reviews || [] : withSentVerdict(reviews || [], fromRuns.sent, pr, login),
    myReview,
    openThreads: threads || 0,
    job: jobFor(fromRuns.job, chats, pr),
    result: fromRuns.result,
    // A review run's own draft comes first; otherwise a saved Respond answer is the draft (or the sending) there is.
    outbox: fromRuns.outbox || responseOutbox(responseFor(responses, pr), pr, review),
    readComplete: reviews !== null && threads !== null,
  }
}
