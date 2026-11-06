// The PR reviews page and its rail badge: every review the owner started, one
// row per PR (its newest review), sorted into what is still going and what is
// done. Where each PR stands is the PR machine's decision (pr-machine.js) on a
// live read of that PR: a saved review cannot say whether its PR moved on, so
// every PR is read, in bounded batches. A PR that could not be read is shown as
// unknown, never classified from older saved data.
import { PR_FIELDS, fetchLiveStates } from './api.js'
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

const validRef = ref => /^[\w.-]+\/[\w.-]+$/.test(ref.repo) && Number.isSafeInteger(ref.number) && ref.number > 0

// One batch of PR reads. A batch GitHub cannot answer fails the whole read, so a long history is
// never half-read and then treated as complete; a PR missing from an answered batch is unknown.
async function readBatch(token, refs) {
  const reads = refs.map((ref, index) => {
    const [owner, name] = ref.repo.split('/')
    return `p${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { pullRequest(number:${ref.number}) { ${PR_FIELDS} } }`
  })
  const data = await fetchLiveStates(token, `query ContributeReviewPulls { ${reads.join(' ')} }`)
  if (!data) throw new Error('Could not read the pull requests. Try again.')
  return refs.map((ref, index) => [reviewKey(ref.repo, ref.number), data[`p${index}`]?.pullRequest || null])
}

// Every PR a review belongs to, read live in batches one after another. The
// result holds only the PRs GitHub returned; the rest stay unknown.
export async function loadReviewPulls(token, refs) {
  const wanted = refs.filter(validRef)
  const read = []
  for (let from = 0; from < wanted.length; from += BATCH) read.push(...await readBatch(token, wanted.slice(from, from + BATCH)))
  return new Map(read.filter(([, pr]) => pr))
}
