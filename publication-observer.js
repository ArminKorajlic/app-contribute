// Settles uncertain publications by asking the platform to read GitHub
// (api.js observeContributionPublication). One observer serves everything in
// a frame: the app's refresh coordinator and a chat card's "Checking GitHub"
// state share its answers, so a record is observed once at a time, and a
// failed request backs off. It only reads: nothing here ever sends.
//
// Answers are kept per record version (its id and last write). A settled,
// changed or not_eligible answer is final for that version: it is never asked
// again. pending and unavailable may change, so they are asked again, but not
// more often than ANSWER_REUSE_MS. A request that got no answer waits
// TRANSPORT_BACKOFF_MS before the next one. An older Möbius without the
// observe route turns the observer off for the frame: the callers then do
// what they did before (read the ledger and wait).
import { observeContributionPublication } from './api.js'
import { uncertainPublication } from './domain.js'

export const FINAL_OUTCOMES = new Set(['settled', 'changed', 'not_eligible'])
export const ANSWER_REUSE_MS = 2500
export const TRANSPORT_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000]
// The app refresh observes at most this many records per pass.
export const MAX_PER_PASS = 4
// A send this frame may still be running claims its record as `submitting`
// first; the refresh leaves such a record alone this long.
export const SUBMITTING_GRACE_MS = 60 * 1000

const versionOf = record => `${record.id}@${record.updated_at || ''}`

export function createPublicationObserver({ observe, now = () => Date.now() }) {
  const entries = new Map() // record id -> { version, inflight, answer, at, failures, retryAt }
  let unsupported = false

  // The latest answer for this record version, asking again when allowed.
  // Resolves to null when nothing new can be said yet (a backoff, or a
  // record that is not ours to observe).
  function check(record) {
    if (!observe || unsupported || !record?.id) return Promise.resolve(unsupported ? { outcome: 'unsupported' } : null)
    const version = versionOf(record)
    let entry = entries.get(record.id)
    if (!entry || entry.version !== version) {
      // A new write is a new question; an answer still on its way for the
      // previous version is not this one's.
      entry = { version, inflight: null, answer: null, at: 0, failures: 0, retryAt: 0 }
      entries.set(record.id, entry)
    }
    if (entry.inflight) return entry.inflight
    if (entry.answer && (FINAL_OUTCOMES.has(entry.answer.outcome) || now() - entry.at < ANSWER_REUSE_MS)) return Promise.resolve(entry.answer)
    if (now() < entry.retryAt) return Promise.resolve(null)
    const current = entry
    current.inflight = Promise.resolve().then(() => observe(record)).catch(() => ({ outcome: 'transport' })).then(answer => {
      current.inflight = null
      const value = answer && typeof answer === 'object' ? answer : { outcome: 'transport' }
      if (value.outcome === 'unsupported') { unsupported = true; return value }
      if (value.outcome === 'transport') {
        current.retryAt = now() + TRANSPORT_BACKOFF_MS[Math.min(current.failures, TRANSPORT_BACKOFF_MS.length - 1)]
        current.failures += 1
        return null
      }
      current.failures = 0
      current.answer = value
      current.at = now()
      return value
    })
    return current.inflight
  }

  // The app refresh: observe the ledger's uncertain records (a bounded few
  // per pass, oldest first) and hand each settled record to `onSettled`.
  async function sweep(records, onSettled) {
    if (!observe || unsupported) return
    const due = (Array.isArray(records) ? records : []).filter(record => uncertainPublication(record)
      && !(record.status === 'submitting' && now() - Date.parse(record.updated_at || '') < SUBMITTING_GRACE_MS))
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
      .slice(0, MAX_PER_PASS)
    await Promise.all(due.map(async record => {
      const answer = await check(record)
      if (answer?.outcome === 'settled' && answer.record) onSettled?.(answer.record)
    }))
  }

  return { check, sweep, get unsupported() { return unsupported } }
}

// One observer per frame and app, shared by the card session and the app.
// The latest token a caller holds is the one the next request uses.
const shared = new Map()
export function sharedPublicationObserver(appId, token) {
  let entry = shared.get(appId)
  if (!entry) {
    entry = { token }
    entry.observer = createPublicationObserver({
      observe: record => observeContributionPublication({ appId, token: entry.token, recordId: record.id }),
    })
    shared.set(appId, entry)
  }
  if (token) entry.token = token
  return entry.observer
}
