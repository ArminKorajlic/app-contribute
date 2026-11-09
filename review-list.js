// The PR reviews page and its rail badge: every review the owner started, one
// row per PR (its newest review), sorted into what is still going and what is
// done. A saved review cannot say whether its PR is still open, who wrote it or
// whether it was pushed again, so the PRs that could still wait on someone are
// read live once; until that read answers they are "checking", never counted.
import { fetchLiveStates } from './api.js'
import { ignoredNote, reviewItemProgress } from './collaboration.js'
import { ownerChipLabel } from './review-frame.js'
import { prFlow } from './pr-flow.js'

const FINISHED_EXECUTION = new Set(['completed', 'stopped', 'failed', 'interrupted'])
// GitHub answers one query for this many PRs; a longer history is read in batches.
const LIVE_READ_BATCH = 40
const sameLogin = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()

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

// Whether the PR itself is worth reading: only a merged review is settled for
// good. A clear review belongs to the version it read, so its PR is read too: a
// push since then puts it back in front of the reviewer (pr-flow rule 4).
export const needsLiveRead = entry => entry.item.state !== 'merged'

const done = (...chips) => ({ bucket: 'done', chips })
const chip = (label, tone) => ({ label, tone })

function finishedChips(item, progress) {
  if (item.state === 'all_clear') return [chip(item.verdict_proposal?.state === 'posted' && item.verdict_proposal.event === 'APPROVE' ? 'Approved' : 'Review clear', 'good')]
  if (item.state === 'merged') return [chip('Merged', 'good')]
  return [chip(progress.label, 'quiet')]
}

// Where one review stands. `live` is the PR's own state now ({ state, head,
// author }) when it has been read; without it only the saved review speaks.
export function classifyReview({ run, item }, { login = '', ignored = null, live = null } = {}) {
  const own = live?.author ? sameLogin(live.author, login) : null
  const progress = reviewItemProgress(run, item, { own, ignored })
  // A PR that is no longer open is history, whatever its review said.
  if (live && live.state !== 'OPEN') return done(chip(live.state === 'MERGED' || item.state === 'merged' ? 'Merged' : 'Closed', live.state === 'MERGED' ? 'good' : 'quiet'))
  const moved = !!live?.head && !!item.head_sha && live.head !== item.head_sha
  if (progress.halted) return done(chip('Stopped', 'quiet'))
  if (progress.turn === 'agent') {
    return FINISHED_EXECUTION.has(run.execution_state)
      ? { bucket: 'stalled', chips: [chip('Not finished', 'owner')] }
      : { bucket: 'running', chips: [chip('Reviewing', 'running')] }
  }
  if (progress.turn === 'owner') {
    // Findings on a version the PR has left behind are old news.
    if (moved) return done(chip('Older version', 'quiet'))
    // A draft only you can send is told apart from a review that simply waits on you. Only a PR
    // known to be someone else's can wait for a confirmation (see pr-flow.js).
    const flow = prFlow({ pr: { state: live?.state, author: { login: live?.author } }, own: own !== false, status: { run, item }, ignored })
    return { bucket: 'waiting', confirm: flow.confirm, chips: [chip(flow.confirm ? flow.label : ownerChipLabel(item), 'owner')] }
  }
  if (progress.turn === 'author') {
    const requested = item.verdict_proposal?.state === 'posted' && item.verdict_proposal.event === 'REQUEST_CHANGES'
    if (moved && requested) return { bucket: 'waiting', chips: [chip('New commits · review again', 'owner')] }
    return done(chip(progress.label, requested ? 'blocker' : 'quiet'), chip(`Waiting on ${live?.author || 'the author'}`, 'quiet'))
  }
  // A clear or approved review is of the version it read. Pushed since, the PR needs another review;
  // on your own PR the clear check is only an older version, which you never asked to be nagged about.
  if (moved && item.state === 'all_clear') return own === true ? done(chip('Older version', 'quiet')) : { bucket: 'waiting', chips: [chip('New commits · review again', 'owner')] }
  return done(...finishedChips(item, progress))
}

export function reviewCounts(entries) {
  const count = bucket => entries.filter(entry => entry.bucket === bucket).length
  return { waiting: count('waiting'), confirm: entries.filter(entry => entry.confirm).length, running: count('running'), stalled: count('stalled'), done: count('done') }
}

// One read of the live state of the PRs a review could still be waiting on: every valid
// reference, in bounded batches that are combined. A batch GitHub cannot answer fails the whole
// read, so a long history is never half-read and then treated as complete.
async function readReviewBatch(token, batch) {
  const reads = batch.map((ref, index) => {
    const [owner, name] = ref.repo.split('/')
    return `p${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { pullRequest(number:${ref.number}) { state headRefOid author { login } } }`
  })
  const data = await fetchLiveStates(token, `query ContributeReviewPulls { ${reads.join(' ')} }`)
  if (!data) throw new Error('Could not read the pull requests. Try again.')
  const live = batch.map((ref, index) => [reviewKey(ref.repo, ref.number), data[`p${index}`]?.pullRequest])
  return live.filter(([, pr]) => pr).map(([id, pr]) => [id, { state: pr.state, head: pr.headRefOid, author: pr.author?.login || '' }])
}

export async function loadReviewPulls(token, refs) {
  const wanted = refs.filter(ref => /^[\w.-]+\/[\w.-]+$/.test(ref.repo) && Number.isSafeInteger(ref.number) && ref.number > 0)
  const found = []
  for (let from = 0; from < wanted.length; from += LIVE_READ_BATCH) found.push(...await readReviewBatch(token, wanted.slice(from, from + LIVE_READ_BATCH)))
  return new Map(found)
}
