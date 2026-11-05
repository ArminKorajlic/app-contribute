// One readiness model for every Send surface: which publication unit owns a
// record, whether its next phase can be sent now, and why not. Pure; the
// guarded Send handlers in index.jsx remain the only publication path.
import { qualityReviewFor, reviewStateFor } from './review.js'
import { publicationStackUnit, stackIntent, stackPublicationRecords, stackReadiness } from './stack.js'

const PUBLIC_STATUSES = new Set(['draft', 'open', 'landing', 'merged', 'closed'])
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

// The PR a record became, only when its saved URL is exactly that PR.
export function publishedPull(record) {
  const repo = record?.plan?.repo || record?.repo || ''
  const number = Number(record?.number)
  return REPO.test(repo) && Number.isSafeInteger(number) && number > 0
    && record?.url === `https://github.com/${repo}/pull/${number}` ? { number, url: record.url } : null
}
export const isPublished = record => PUBLIC_STATUSES.has(record?.status) && Boolean(publishedPull(record))

export const needsSourceRefresh = reviewState => reviewState?.state === 'needs_refresh'
export const sendNeedsAttention = record => Boolean(record?.last_submit_error) || record?.needs_attention === true
export const reviewIncomplete = record => qualityReviewFor(record).state !== 'all_clear'

// Why one prepared record cannot be sent now, or '' when it can. Chat cards
// pass `requireCheck`: without a current positive source check they fail closed.
export function sendBlocker(record, reviewState, { requireCheck = false } = {}) {
  if (!record) return 'This contribution is no longer in Contribute.'
  if (record.status !== 'prepared') {
    return record.status === 'abandoned' ? 'This contribution was dismissed.' : 'This contribution is not waiting to be sent.'
  }
  if (!['pr', 'pr_update'].includes(record.plan?.action)) return 'Only pull requests can be sent from here.'
  if (needsSourceRefresh(reviewState)) return 'The reviewed source changed. Sync Contribute to read it again.'
  if (sendNeedsAttention(record)) return 'The last send needs attention in Contribute.'
  if (reviewIncomplete(record)) return 'This exact version needs review first.'
  if (requireCheck && reviewState?.state !== 'ready') return 'This contribution needs a current source check in Contribute.'
  return ''
}

// The unit that owns one record: the record itself, or its complete stack,
// whose next ready phase one request sends in layer order.
export function publicationUnit(record, records, reviewStatus, options) {
  const blocker = rec => sendBlocker(rec, reviewStateFor(rec, reviewStatus), options)
  if (stackIntent(record).kind === 'standalone') {
    const reason = isPublished(record) ? '' : blocker(record)
    return { key: `record:${record.id}`, stack: false, records: [record], ready: !reason && record.status === 'prepared' ? [record] : [], reason }
  }
  const unit = publicationStackUnit(record, records)
  const readiness = stackReadiness(unit)
  const phase = readiness.ok ? stackPublicationRecords(unit) : []
  const reason = readiness.ok ? phase.map(blocker).find(Boolean) || '' : readiness.code === 'settled' ? '' : readiness.message
  return { key: `stack:${unit.id}`, stack: true, records: unit.records, ready: reason ? [] : phase, reason }
}

// Distinct units for the named records. Several layers of one stack share one.
export function publicationUnits(ids, records, reviewStatus, options) {
  const byId = new Map((records || []).map(record => [record.id, record]))
  const units = new Map()
  for (const id of ids) {
    const record = byId.get(id)
    const unit = record ? publicationUnit(record, records, reviewStatus, options)
      : { key: `record:${id}`, stack: false, records: [], ready: [], reason: 'This contribution is no longer in Contribute.' }
    if (!units.has(unit.key)) units.set(unit.key, unit)
  }
  return [...units.values()]
}

// The records whose review status a chat card must ask for: the records it
// names plus every prepared layer of their stacks, because a stack's next
// phase is checked as a whole and the server answers only addressed records.
// Bounded by the server's per-request limit.
export const REVIEW_ADDRESS_LIMIT = 50
export function reviewAddressFor(ids, records) {
  const named = [...new Set(ids || [])]
  const addressed = new Set(named)
  const byId = new Map((records || []).map(record => [record.id, record]))
  for (const id of named) {
    const record = byId.get(id)
    const unit = record ? publicationStackUnit(record, records) : null
    for (const member of unit?.records || []) if (member.status === 'prepared') addressed.add(member.id)
  }
  return [...addressed].slice(0, REVIEW_ADDRESS_LIMIT)
}

// Chat sends only with the platform binding the confirmed snapshot, checked at
// the moment of the write: if the binding disappeared after Confirm (for
// example a connection refresh against an older Möbius), or the record would
// go through the relay, which cannot bind it, nothing is sent.
export function writeBindingRefusal({ requireBinding = false, frozenBinding = false, relay = false } = {}) {
  if (!requireBinding || (frozenBinding === true && !relay)) return null
  return {
    notAttempted: true,
    error: 'This Möbius no longer confirms the exact version you approved, so nothing was sent. Open Contribute to send it.',
    failure: { owner: 'owner', code: 'binding_unavailable' },
  }
}
