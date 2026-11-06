// A saved Respond-to-feedback result and what the owner decided about it. Pure: no React, no I/O.
// The contract with respond_result.py (which writes the result) is in respond-result.md.
//
// The app reads strictly: a file that breaks a rule is not a response at all, never half shown. The helper
// has already enforced the same rules, so a file that fails here was edited or is from another version.

export const RESULT_FOLDER = 'respond-results/'
export const DECISION_FOLDER = 'respond-decisions/'
const VERSION = 1
const SHA = /^[0-9a-f]{40}$/
const RESULT_ID = /^r-[0-9a-f]{12}$/
const DIGEST = /^[0-9a-f]{64}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const LOGIN = /^[A-Za-z0-9-]{1,39}$/
const STATES = new Set(['ready', 'posting', 'posted', 'failed'])
const ENDINGS = new Set(['fixed', 'not_valid', 'out_of_scope'])
const FILE_STATUSES = new Set(['added', 'modified', 'removed', 'renamed'])

// The name the helper gives a PR's files: lower case, owner__repo__number.
export const resultSlug = (repo, number) => `${String(repo).toLowerCase().replace('/', '__')}__${number}`

const isText = (value, max, { empty = false } = {}) => typeof value === 'string' && value.length <= max && (empty || value.trim() !== '')
const isCount = value => Number.isInteger(value) && value >= 0
const list = (value, max) => (Array.isArray(value) && value.length <= max ? value : null)

function readPoint(point) {
  if (!point || typeof point !== 'object') return null
  const { reviewer, title, ending, commit, answer } = point
  if (!isText(reviewer, 60) || !isText(title, 160) || !ENDINGS.has(ending) || !isText(answer, 400, { empty: true })) return null
  if (commit !== null && !SHA.test(commit)) return null
  return { reviewer, title, ending, commit, answer }
}

function readReply(reply) {
  if (!reply || typeof reply !== 'object' || !isText(reply.body, 20000)) return null
  if (reply.reply_to !== null && !(Number.isInteger(reply.reply_to) && reply.reply_to > 0)) return null
  return { body: reply.body, reply_to: reply.reply_to }
}

function readCommit(commit) {
  return commit && typeof commit === 'object' && SHA.test(commit.sha) && isText(commit.title, 300, { empty: true }) ? { sha: commit.sha, title: commit.title } : null
}

function readFile(file) {
  if (!file || typeof file !== 'object' || !isText(file.path, 500) || !FILE_STATUSES.has(file.status) || !isCount(file.added) || !isCount(file.removed)) return null
  if (file.patch !== null && !isText(file.patch, 60000, { empty: true })) return null
  const read = { path: file.path, status: file.status, added: file.added, removed: file.removed, patch: file.patch }
  if (typeof file.previous_path === 'string') read.previous_path = file.previous_path
  if (file.binary === true) read.binary = true
  if (file.patch_omitted === true) read.patch_omitted = true
  return read
}

const stamped = value => (value && typeof value === 'object' && typeof value.at === 'string' ? value : null)

// What the helper recorded as done. Anything unreadable counts as not done, so the card never claims a step went out.
function readReceipts(raw) {
  if (!raw || typeof raw !== 'object') return null
  const push = raw.push && typeof raw.push === 'object' && SHA.test(raw.push.sha) && typeof raw.push.at === 'string' ? { sha: raw.push.sha, at: raw.push.at } : null
  const replies = (Array.isArray(raw.replies) ? raw.replies : []).filter(item => item && Number.isInteger(item.index) && typeof item.url === 'string' && typeof item.at === 'string')
    .map(item => ({ index: item.index, url: item.url, at: item.at }))
  const rerequest = stamped(raw.rerequest)
  return { push, replies, description: stamped(raw.description) ? { at: raw.description.at } : null, rerequest: rerequest ? { at: rerequest.at, reviewers: Array.isArray(rerequest.reviewers) ? rerequest.reviewers.filter(login => typeof login === 'string') : [] } : null }
}

function readEach(raw, read, max) {
  const items = list(raw, max)
  const read_ = items && items.map(read)
  return read_ && read_.every(Boolean) ? read_ : null
}

// A result as the helper wrote it, or null when it is anything else.
export function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== VERSION) return null
  const { id, repo, number, chat_id: chatId, created_at: createdAt, state, pr, tip_sha: tip, digest, tests, description, error } = raw
  if (!RESULT_ID.test(id) || !REPO.test(repo) || !Number.isInteger(number) || number < 1 || !isText(chatId, 128) || !isText(createdAt, 40) || !STATES.has(state)) return null
  if (!pr || typeof pr !== 'object' || !SHA.test(pr.head_sha) || !isText(pr.head_ref, 255) || !isText(pr.base_ref, 255) || !REPO.test(pr.head_repo) || !SHA.test(tip) || !DIGEST.test(digest)) return null
  if (!isText(tests, 500, { empty: true }) || (description !== null && !isText(description, 60000))) return null
  const rerequest = list(raw.rerequest, 10)
  const points = readEach(raw.points, readPoint, 30)
  const replies = readEach(raw.replies, readReply, 12)
  const commits = readEach(raw.commits, readCommit, 60)
  const files = readEach(raw.files, readFile, 300)
  const receipts = readReceipts(raw.receipts)
  if (!rerequest || !rerequest.every(login => LOGIN.test(login)) || !points || !replies || !commits || !files || !receipts) return null
  const failure = error && typeof error === 'object' && typeof error.step === 'string' && typeof error.message === 'string' ? { step: error.step, message: error.message } : null
  if (error !== null && !failure) return null
  return { version: VERSION, id, repo, number, chat_id: chatId, created_at: createdAt, state, pr: { head_sha: pr.head_sha, head_ref: pr.head_ref, base_ref: pr.base_ref, head_repo: pr.head_repo },
    tip_sha: tip, points, replies, description, rerequest, tests, commits, files, digest, receipts, error: failure }
}

// What the owner decided: only Post (approved) and Discard are ever written.
export function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return null
  if (!RESULT_ID.test(raw.result_id) || !DIGEST.test(raw.digest) || !['approved', 'discarded'].includes(raw.decision)) return null
  return { result_id: raw.result_id, digest: raw.digest, decision: raw.decision, at: typeof raw.at === 'string' ? raw.at : '' }
}

const samePr = (result, pr) => result.repo.toLowerCase() === pr?.repository?.nameWithOwner?.toLowerCase() && result.number === pr?.number

// The saved response of this PR: `{ slug, result, decision }`, or null.
export const responseFor = (responses, pr) => (responses || []).find(entry => entry?.result && samePr(entry.result, pr)) || null

// The owner's decision, counted only for the exact answer it names: another result, or the same result changed since, ignores it.
const decisionOf = entry => (entry.decision && entry.decision.result_id === entry.result.id && entry.decision.digest === entry.result.digest ? entry.decision.decision : null)

// Where a response stands on its PR:
//   ready (fresh, nothing decided), approved (Post pressed, the chat has not started), stale (the PR moved after the answer),
//   posting, failed (stopped part-way), posted (the PR is where the post left it), or null (discarded, or history).
export function responseStatus(entry, pr) {
  const result = entry?.result
  if (!result) return null
  const decision = decisionOf(entry)
  if (result.state === 'posted') return pr?.headRefOid === result.tip_sha || pr?.headRefOid === result.pr.head_sha ? 'posted' : null
  if (result.state === 'posting' || result.state === 'failed') return result.state
  if (decision === 'discarded') return null
  if (pr?.headRefOid !== result.pr.head_sha) return 'stale'
  return decision === 'approved' ? 'approved' : 'ready'
}

// The seconds after Post. Both real posts had the message at the chat in 2 s, the first step done by 8.6 s and everything posted by 13 s.
// The chat gets this long to start before the card offers Send again.
export const RESEND_AFTER_MS = 30000
// After Post an answer is read closely for this long, then on the idle cadence: a chat that never starts is not read fast for ever.
export const WATCH_MS = 300000
// A clock a few seconds behind the one that pressed Post is normal; further off, the time is not trusted.
const SKEW_MS = 5000

// Whether `at` (a saved time) is less than `limit` ms before `now`. An unreadable time is never within.
const withinMs = (at, now, limit) => { const elapsed = now - Date.parse(at || ''); return elapsed > -SKEW_MS && elapsed < limit }

// Whether the owner pressed Post so recently that the chat is still expected to be starting the command: the card says so and offers no
// Send again yet. Only an approved answer can be starting (posting and stopped have their own states).
export const chatStarting = (view, now = Date.now()) => view?.status === 'approved' && withinMs(view.decision?.at, now, RESEND_AFTER_MS)

// Whether this answer is being posted, and Post was pressed recently enough to read it closely.
export const postingSoon = (entry, now = Date.now()) => ['ready', 'posting'].includes(entry.result.state) && decisionOf(entry) === 'approved' && withinMs(entry.decision.at, now, WATCH_MS)

// The PR page's view of a response: the entry and its status, or null when there is nothing to show.
export function responseView(responses, pr) {
  const entry = responseFor(responses, pr)
  const status = responseStatus(entry, pr)
  return status ? { ...entry, status } : null
}

// What the PR logic already understands: a draft waiting for the owner, something being sent, something GitHub did not confirm.
// It is about the PR as it stands now (the logic ignores a fact about another head), so once the push has moved the head, a post
// that stopped part-way still reads as not confirmed.
const OUTBOX_STATES = { ready: 'drafted', approved: 'sending', posting: 'sending', failed: 'unconfirmed' }

export function responseOutbox(entry, pr) {
  const state = OUTBOX_STATES[responseStatus(entry, pr)]
  return state ? { kind: 'push', head: pr.headRefOid, state } : null
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
const names = logins => (logins.length < 2 ? logins.join('') : `${logins.slice(0, -1).join(', ')} and ${logins.at(-1)}`)

// What Post will do, in the order the helper does it, and only what there is to do.
export function planSteps(result) {
  return [
    result.commits.length ? { key: 'push', text: `Push ${plural(result.commits.length, 'commit', 'commits')} to the PR’s branch, on top of ${result.pr.head_sha.slice(0, 7)}` } : null,
    result.replies.length ? { key: 'replies', text: `Post ${plural(result.replies.length, 'reply', 'replies')}, as you` } : null,
    result.description !== null ? { key: 'description', text: 'Update the description' } : null,
    result.rerequest.length ? { key: 'rerequest', text: `Ask ${names(result.rerequest)} to review again` } : null,
  ].filter(Boolean)
}

// Whether the helper has recorded a step as done (a step that is not in the plan is never "done").
export function stepDone(result, key) {
  const receipts = result.receipts
  if (key === 'replies') return result.replies.length > 0 && receipts.replies.length >= result.replies.length
  return Boolean(receipts[key])
}

export const POST_COMMAND = result => `python3 /data/apps/contribute/respond_result.py post --pr ${result.repo}#${result.number} --id ${result.id}`

// The one message Post sends the chat. The helper checks the approval itself; this only tells the chat to run it.
export const postMessage = result => [
  `Approved in Contribute: post result ${result.id} for ${result.repo}#${result.number}, built on ${result.pr.head_sha.slice(0, 7)}.`,
  '',
  'Run exactly this and report what it printed:',
  '',
  `    ${POST_COMMAND(result)}`,
  '',
  'It posts only what was shown and approved, and checks the approval and the PR head itself.',
  'Do not push, comment, reply or edit anything on GitHub by hand. If it refuses, say why and stop.',
].join('\n')
