// The comet frame around a PR under review: pure geometry and state mapping,
// so it is testable without a DOM. ui/ReviewFrame.jsx draws it.
import { OWNER_ITEM_STATES, reviewItemProgress, reviewRunHalted } from './collaboration.js'

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
export function frameState(status) {
  if (!status) return 'idle'
  const { run, item } = status
  const progress = reviewItemProgress(run, item)
  if (progress.halted || progress.settled) return 'idle'
  if (OWNER_ITEM_STATES.has(item.state) && item.state !== 'failed') return 'verdict'
  if (progress.waiting) return 'verdict'
  return WORKING_ITEMS.has(item.state) ? 'reviewing' : 'idle'
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
