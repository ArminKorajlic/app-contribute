// The comet frame around a PR under review: pure geometry and state mapping,
// so it is testable without a DOM. ui/ReviewFrame.jsx draws it.
import { ignoredNote, reviewItemProgress, reviewRunHalted } from './collaboration.js'

export const COMET_SPEED = 160 // pixels per second: a slow, steady lap
export const COMET_LAYERS = 36

// Item states where an agent is still working on the PR.
const WORKING_ITEMS = new Set(['pending', 'starting', 'reviewing', 'repairing', 'pushing', 'marking_ready', 'merging', 'verdict_posting'])

// Length of a rounded rectangle's outline: the four straight sides plus four
// quarter-circle corners.
export function roundedRectPerimeter(width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  return 2 * (width + height) - 8 * r + 2 * Math.PI * r
}

// One comet is a stack of dash layers that share a head. The k-th longest layer
// has opacity 1/(N-k+1), so where m layers overlap the combined opacity is
// exactly m/N: a linear fade from a bright head to a clear tail.
export function cometLayers(perimeter, count = COMET_LAYERS) {
  const tail = Math.max(40, perimeter * 0.14)
  return Array.from({ length: count }, (_, index) => {
    const remaining = count - index
    const length = tail * remaining / count
    return { length, gap: perimeter - length, opacity: 1 / remaining }
  })
}

export const cometSeconds = perimeter => perimeter / COMET_SPEED

// What the frame shows for a review of one PR: it travels while an agent works,
// holds amber while the review waits on the owner, and is absent otherwise.
// Finished reviews stay as the chip alone: nothing records which results the
// owner has already seen, and a ring on every old review would never go away.
// `own` is whether the owner wrote the PR (see reviewItemProgress).
export function frameState(status, ctx) {
  if (!status) return 'idle'
  const { run, item } = status
  const progress = reviewItemProgress(run, item, ctx)
  if (progress.halted || progress.settled) return 'idle'
  if (progress.turn === 'owner' && (item.state !== 'failed' || progress.waiting)) return 'verdict'
  return WORKING_ITEMS.has(item.state) ? 'reviewing' : 'idle'
}

const OWNER_CHIP_WORDS = { merge_unknown: 'Check outcome', ready_unknown: 'Check outcome', verdict_pending: 'Verdict waiting', verdict_unknown: 'Verdict waiting' }
// What a review that waits on the owner calls itself, on a row and on the PR reviews page alike.
export const ownerChipLabel = item => OWNER_CHIP_WORDS[item.state] || 'Needs you'

// The chip beside a PR row's meta line for its current review. Only the owner's
// own move is amber; a review that waits on the PR's author reads quietly.
function currentReviewChip(status, pr, own, ignored, frame) {
  const { run, item } = status
  const progress = reviewItemProgress(run, item, { own, ignored })
  if (frame === 'reviewing') return null // the travelling frame says it
  if (progress.halted) return { label: 'Run stopped', tone: 'owner' }
  if (progress.turn === 'owner' && (progress.waiting || run.chat_id)) return { label: ownerChipLabel(item), tone: 'owner' }
  if (progress.turn === 'author') return { label: `Waiting on ${pr.author?.login || 'the author'}`, tone: 'waiting' }
  if (ignoredNote(item, ignored)) return { label: 'Ignored', tone: 'waiting' }
  if (item.state === 'all_clear' && !status.exactBase) return { label: `Reviewed on an older ${pr.baseRefName}`, tone: 'plain' }
  return { label: progress.label, tone: 'plain' }
}

// Someone else's PR you asked changes of, pushed again since: your move again.
const changesSinceYourReview = (earlier, own) => !own
  && earlier.item.state === 'needs_you'
  && earlier.item.verdict_proposal?.state === 'posted'
  && earlier.item.verdict_proposal.event === 'REQUEST_CHANGES'

// What a PR row shows for its review: the frame around it and the chip beside
// its meta line. `status` is the review of the PR's current version, `earlier`
// the newest review of another version (used only when the PR has moved on).
export function rowReview({ status, earlier = null, pr, own, ignored = null }) {
  if (status) {
    const frame = frameState(status, { own, ignored })
    return { frame, chip: currentReviewChip(status, pr, own, ignored, frame) }
  }
  if (earlier && changesSinceYourReview(earlier, own)) return { frame: 'verdict', chip: { label: 'New commits · review again', tone: 'owner' } }
  return { frame: 'idle', chip: null }
}

// Whether any review is still being worked on, so the desk polls only then.
export const hasActiveReview = runs => (runs || []).some(run => !reviewRunHalted(run)
  && (run.items || []).some(item => WORKING_ITEMS.has(item.state)))

// A saved record names its PR by repository and number; the newest review of
// that PR (at any version) is what its desk row should reflect while it runs.
export function reviewForRecord(runs, record) {
  const repo = String(record?.plan?.repo || record?.repo || '').toLowerCase()
  const number = Number(record?.number)
  if (!repo || !number) return null
  const matches = (runs || []).flatMap(run => (run.items || [])
    .filter(item => item.repo?.toLowerCase() === repo && item.number === number)
    .map(item => ({ run, item })))
  return matches.sort((a, b) => Date.parse(b.run.created_at || '') - Date.parse(a.run.created_at || ''))[0] || null
}
