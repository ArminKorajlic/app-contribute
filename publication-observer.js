// Settles uncertain publications by asking the platform to read GitHub
// (api.js observeContributionPublication). One observer serves everything in
// a frame: the app's refresh coordinator and a chat card share its answers,
// so a record version is observed once at a time, and a failed request backs
// off. It only reads: nothing here ever sends. Across frames and the
// scheduled job a duplicate read is possible; the platform's per-record lock
// serializes them.
//
// Every answer is for one exact record version (domain.js
// publicationVersion) and carries it as `version`. A caller applies an answer
// only while its record is still that version; a late answer for an older one
// is dropped. settled, changed and not_eligible are final for their version:
// it is never asked again, but a new version is a new question. pending and
// unavailable may change, so they are asked again, but not more often than
// ANSWER_REUSE_MS. A request that got no answer waits TRANSPORT_BACKOFF_MS.
// An older Möbius without the observe route turns the observer off for the
// frame: the callers then do what they did before (read the ledger and wait).
import { observeContributionPublication } from './api.js'
import { publicationVersion, uncertainPublication } from './domain.js'

export const FINAL_OUTCOMES = new Set(['settled', 'changed', 'not_eligible'])
export const ANSWER_REUSE_MS = 2500
export const TRANSPORT_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000]
// The app refresh sends at most this many new requests per pass.
export const MAX_PER_PASS = 4
// A send this frame may still be running claims its record as `submitting`
// first; the refresh leaves such a record alone this long.
export const SUBMITTING_GRACE_MS = 60 * 1000

export function createPublicationObserver({ observe, now = () => Date.now() }) {
  const entries = new Map() // record id -> { version, inflight, answer, at, askedAt, failures, retryAt }
  let unsupported = false

  function entryFor(record) {
    const version = publicationVersion(record)
    let entry = entries.get(record.id)
    if (!entry || entry.version !== version) {
      // A new version is a new question; an answer still on its way for the
      // previous one goes only to whoever asked it, tagged with its version.
      entry = { version, inflight: null, answer: null, at: 0, askedAt: 0, failures: 0, retryAt: 0 }
      entries.set(record.id, entry)
    }
    return entry
  }
  // A new request may go out now for this record version.
  const askable = entry => !entry.inflight && now() >= entry.retryAt
    && !(entry.answer && (FINAL_OUTCOMES.has(entry.answer.outcome) || now() - entry.at < ANSWER_REUSE_MS))

  // The latest answer for this record version, asking again when allowed.
  // Resolves to null when nothing new can be said yet (a backoff).
  function check(record) {
    if (!observe || unsupported || !record?.id) return Promise.resolve(unsupported ? { outcome: 'unsupported' } : null)
    const entry = entryFor(record)
    if (entry.inflight) return entry.inflight
    if (!askable(entry)) return Promise.resolve(entry.answer && now() >= entry.retryAt ? entry.answer : null)
    entry.askedAt = now()
    entry.inflight = Promise.resolve().then(() => observe(record)).catch(() => ({ outcome: 'transport' })).then(answer => {
      entry.inflight = null
      const value = answer && typeof answer === 'object' ? answer : { outcome: 'transport' }
      if (value.outcome === 'unsupported') { unsupported = true; return value }
      if (value.outcome === 'transport') {
        entry.retryAt = now() + TRANSPORT_BACKOFF_MS[Math.min(entry.failures, TRANSPORT_BACKOFF_MS.length - 1)]
        entry.failures += 1
        return null
      }
      entry.failures = 0
      entry.answer = { ...value, version: entry.version }
      entry.at = now()
      return entry.answer
    })
    return entry.inflight
  }

  // The app refresh: observe the ledger's uncertain records that can be asked
  // now (not final, backing off, reused or in flight for their version), the
  // least recently asked first, a bounded few per pass. A settled record goes
  // to `onSettled` only while `currentOf(id)` is still the version observed.
  async function sweep(records, onSettled, currentOf = () => null) {
    if (!observe || unsupported) return
    const due = (Array.isArray(records) ? records : []).filter(record => uncertainPublication(record)
      && !(record.status === 'submitting' && now() - Date.parse(record.updated_at || '') < SUBMITTING_GRACE_MS)
      && askable(entryFor(record)))
      .sort((a, b) => entryFor(a).askedAt - entryFor(b).askedAt || String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
      .slice(0, MAX_PER_PASS)
    await Promise.all(due.map(async record => {
      const answer = await check(record)
      if (answer?.outcome === 'settled' && answer.record && publicationVersion(currentOf(record.id)) === answer.version) onSettled?.(answer.record)
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
