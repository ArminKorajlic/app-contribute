// The PR reviews page and its rail badge: every review the owner started, one
// row per PR (its newest review), sorted into what is still going and what is
// done. Where each PR stands is the PR machine's decision (pr-machine.js) on a
// live read of that PR: a saved review cannot say whether its PR moved on, so
// every PR is read, in bounded batches. A PR that could not be read is shown as
// unknown, never classified from older saved data.
import { PR_FIELDS, aliasedPulls, fetchLiveStates, validPullRef } from './api.js'
import { standingFor } from './pr-standing.js'

const BATCH = 25

export const reviewKey = (repo, number) => `${String(repo).toLowerCase()}#${number}`

// The newest review of each PR, by when its run began.
export function reviewEntries(runs) {
  const newest = new Map()
  for (const run of runs || []) {
    for (const item of run.items || []) {
      const id = reviewKey(item.repo, item.number)
      const at = Date.parse(run.created_at || '') || 0
      if (!newest.has(id) || at > newest.get(id).at) newest.set(id, { id, run, item, at })
    }
  }
  return [...newest.values()].sort((a, b) => b.at - a.at)
}

// One run's state as it matters to GitHub: the run and each item with its verdict.
// Not its conversation (execution_state): a review chat ends a turn each time its
// helper takes over, and that moves nothing on the PR.
const runSignature = run => [run.state, ...(run.items || []).map(item => `${item.state}:${item.verdict_proposal?.state || ''}`)].join('|')

// The PRs of the reviews that changed state between two reads of the runs, each
// with whether its verdict was posted: that answers the PR's review request.
// Runs that are new, or from before there was a read to compare with, are not changes.
export function changedReviewRuns(before, after) {
  const known = new Map((before || []).map(run => [run.id, runSignature(run)]))
  return (after || []).filter(run => known.has(run.id) && known.get(run.id) !== runSignature(run))
    .flatMap(run => (run.items || []).map(item => ({ repo: item.repo, number: item.number, verdictPosted: item.verdict_proposal?.state === 'posted' })))
}

// The runs with `run` shown in place of the one it answers (or first, when it is new).
export const withReviewRun = (runs, run) => (runs.some(item => item.id === run.id) ? runs.map(item => (item.id === run.id ? run : item)) : [run, ...runs])

const chip = (label, tone) => ({ label, tone })
const TONE = { you: 'owner', agent: 'running', other: 'quiet', none: 'quiet' }
const GOOD = new Set(['merged', 'reviewer.mergeable', 'author.approved'])

// A PR's resting states (nothing reviewed, or nothing to check yet) leave no review waiting
// on you: a review you stopped is done here, even though the PR is still yours to review.
const RESTING = new Set(['merged', 'closed', 'reviewer.to_review', 'reviewer.draft', 'author.draft', 'author.waiting_review'])
function bucketOf(decision) {
  if (RESTING.has(decision.state)) return 'done'
  if (decision.state === 'stalled') return 'stalled'
  if (decision.turn === 'agent') return 'running'
  return decision.turn === 'you' ? 'waiting' : 'done'
}

// Where one review's PR stands. `live` is that PR as GitHub returns it now
// (PR_FIELDS); without it the PR is unknown. `runs` are all review runs and
// `chats` the live Respond-to-feedback conversations.
export function classifyReview(entry, { login = '', ignored = null, live = null, runs = [], chats = [] } = {}) {
  if (!live) return { bucket: 'unknown', confirm: false, chips: [chip('Couldn’t read', 'quiet')] }
  const decision = standingFor({ pr: live, login, runs, ignored, chats })
  const tone = GOOD.has(decision.state) ? 'good' : TONE[decision.turn]
  return { bucket: bucketOf(decision), confirm: ['to_confirm', 'unconfirmed'].includes(decision.state), chips: [chip(decision.label, tone)], decision }
}

export function reviewCounts(entries) {
  const count = bucket => entries.filter(entry => entry.bucket === bucket).length
  return { waiting: count('waiting'), confirm: entries.filter(entry => entry.confirm).length, running: count('running'), stalled: count('stalled'), unknown: count('unknown'), done: count('done') }
}

async function readBatch(token, refs) {
  const data = await fetchLiveStates(token, `query ContributeReviewPulls { rateLimit { remaining } ${aliasedPulls(refs, PR_FIELDS)} }`)
  return refs.map((ref, index) => [reviewKey(ref.repo, ref.number), data?.[`p${index}`]?.pullRequest || null])
}

// Every PR a review belongs to, read live in batches one after another. The
// result holds only the PRs GitHub returned; the rest stay unknown.
export async function loadReviewPulls(token, refs) {
  const wanted = refs.filter(validPullRef)
  const batches = Array.from({ length: Math.ceil(wanted.length / BATCH) }, (_, index) => wanted.slice(index * BATCH, (index + 1) * BATCH))
  const read = []
  for (const batch of batches) read.push(...await readBatch(token, batch))
  return new Map(read.filter(([, pr]) => pr))
}

// One live read of the PRs the reviews belong to: all of `refs`, or only those whose keys are in `keys`.
// What was asked for travels with the answer, so a merge can tell a PR GitHub did not return from one nobody asked about.
export async function readReviewPulls(token, refs, keys = null) {
  const asked = keys ? refs.filter(ref => keys.has(reviewKey(ref.repo, ref.number))) : refs
  return { everything: !keys, asked: asked.map(ref => reviewKey(ref.repo, ref.number)), pulls: await loadReviewPulls(token, asked) }
}

// The PRs known after a read. A read of everything replaces them; a partial one replaces just the PRs it asked
// for, so one GitHub did not return is unknown again (never kept from an older read) and the rest keep theirs.
export function mergeReviewPulls(known, { everything, asked, pulls }) {
  if (everything) return pulls
  const next = new Map(known)
  asked.forEach(key => next.delete(key))
  return new Map([...next, ...pulls])
}
