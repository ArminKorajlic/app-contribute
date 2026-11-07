// The chat card session for a host without `rows-v2` (no attested chat): the
// card shipped before the ledger-backed card (#144), kept unchanged so such a
// host behaves exactly as it did. block-protocol.js connectInlineSession picks
// it; inline-session.js is the card on a host that attests its chat.
// The in-chat Send session behind a Contribute card. Pure state: the host
// renders the controls, this model says what each one may do. Reading never
// sends; only the owner's Confirm of a frozen snapshot reaches the app's
// guarded Send handlers, which bind that snapshot on the server.
//
// Each Confirm creates immutable attempts, one per independent unit. Units run
// in parallel; a stack's layers are sent in order by its one stack request.
// Only attempts whose outcome is unknown cross a reload, and they lock their
// unit until a read-only observation proves the result. While one is unknown
// the card re-reads on its own (exact reads and the app's refresh), with
// backoff, for RECHECK_WINDOW_MS after the send; it never sends again.
//
// The card reports calm state to the host: a live title, and per row a status
// pill, the pull request link once published, and one short reason when a
// send failed (building-apps.md "Passive block sessions").
import { sendTarget } from './chat-blocks.js'
import { planScreenshots, screenshotCountText } from './domain.js'
import { isPublished, publicationUnits, publishedPull, sendBlocker } from './send-readiness.js'
import { RETRY_CHECK_REASON, reviewStateFor } from './review.js'
import { stackMeta } from './stack.js'

const copy = value => JSON.parse(JSON.stringify(value))
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const CHECKPOINT_BYTES = 32768
const MAX_ATTEMPTS = 24
const UNRESOLVED = new Set(['sending', 'unknown'])
const UNKNOWN_NOTE = 'GitHub hasn’t confirmed the result yet.'
// After the recheck window, on a host without row state (no Open control).
export const EXPIRED_NOTE = 'GitHub hasn’t confirmed the result. Open Contribute to check it.'
// Rechecks of an unknown outcome: quick at first, then once a minute, for ten
// minutes after the send. After that the row says "Not confirmed" and the
// card opens Contribute; nothing is ever retried blindly.
export const RECHECK_DELAYS_MS = [3000, 6000, 12000, 24000, 45000, 60000]
export const RECHECK_WINDOW_MS = 10 * 60 * 1000
const PULL_STATUS = { draft: ['Draft', 'neutral'], open: ['Open', 'success'], landing: ['Open', 'success'], merged: ['Merged', 'accent'], closed: ['Closed', 'neutral'] }
// A pending recheck never keeps a process alive on its own (Node's unref);
// in a browser frame it is an ordinary timeout.
const DEFAULT_TIMERS = { set: (fn, ms) => { const id = setTimeout(fn, ms); id?.unref?.(); return id }, clear: id => clearTimeout(id) }
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
export const LEDGER_NOTE = 'Could not read every contribution. Open Contribute to send.'
export const TIMEOUT_NOTE = 'Contribute didn’t answer in time. Try again.'
export const REFRESH_FAILED_NOTE = 'Contribute couldn’t check this right now. Try again.'
export const NEWER_NOTE = 'Sending from chat needs a newer Möbius. Open Contribute to send.'
// A card whose action does not match its items only points to Contribute.
export const UNMATCHED_NOTE = 'Open Contribute to send them.'
export const LEGACY_NOTE = 'Open Contribute to send it.'
export const UNCHECKED_NOTE = 'Couldn’t check this contribution right now.'
export const RECOVERY_NOTE = 'The previous result from this card could not be restored. Open Contribute to check it; nothing will be sent from here.'

// ---- Recovery checkpoint: unresolved attempt identities only, never records,
// confirmation text or approval.
const validAttempt = value => typeof value?.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value.id)
  && typeof value.unitKey === 'string' && /^(record|stack):.{1,200}$/.test(value.unitKey)
  && Array.isArray(value.ids) && value.ids.length >= 1 && value.ids.length <= 12
  && value.ids.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id))
  && Number.isSafeInteger(value.at) && value.at > 0

export function encodeCheckpoint(attempts) {
  const open = attempts.filter(attempt => UNRESOLVED.has(attempt.state))
    .map(({ id, unitKey, ids, at }) => ({ id, unitKey, ids, at }))
  if (!open.length) return null
  const data = JSON.stringify({ version: 1, attempts: open })
  if (open.length > MAX_ATTEMPTS || new TextEncoder().encode(data).length > CHECKPOINT_BYTES) throw new Error('Recovery checkpoint is too large')
  return data
}

export function decodeCheckpoint(checkpoint) {
  if (!checkpoint) return []
  if (typeof checkpoint.id !== 'string' || typeof checkpoint.data !== 'string'
    || new TextEncoder().encode(checkpoint.data).length > CHECKPOINT_BYTES) throw new Error('Invalid recovery checkpoint')
  const value = JSON.parse(checkpoint.data)
  if (value?.version !== 1 || !Array.isArray(value.attempts) || !value.attempts.length
    || value.attempts.length > MAX_ATTEMPTS || !value.attempts.every(validAttempt)) throw new Error('Invalid recovery checkpoint')
  return value.attempts.map(({ id, unitKey, ids, at }) => ({ id, unitKey, ids: [...ids], at, state: 'unknown', note: UNKNOWN_NOTE }))
}

// ---- Outcomes. Only a certified non-attempt or a definite refusal releases a
// unit; a lost, pending or merely accepted response stays unknown until read.
export function attemptOutcome(outcome = {}) {
  if (outcome.notAttempted) return { state: 'not_attempted', note: text(outcome.error) || 'Nothing was sent.' }
  // A changed-approval refusal without the server's not_attempted certificate
  // may already have been attempted: it stays unknown and locked.
  if (outcome.ok || outcome.pending || outcome.uncertain || outcome.alreadyHandled
    || outcome.failure?.owner === 'automatic' || outcome.failure?.code === 'approval_changed') return { state: 'unknown', note: UNKNOWN_NOTE }
  return { state: 'failed', note: text(outcome.error) || 'Some changes were not sent. Check Contribute for the rest.' }
}

// Read-only reconciliation against exact current records.
export function observeAttempt(attempt, byId) {
  if (!UNRESOLVED.has(attempt.state) && attempt.state !== 'failed') return attempt
  const records = attempt.ids.map(id => byId.get(id))
  if (records.length && records.every(isPublished)) return { ...attempt, state: 'sent', note: '' }
  if (attempt.state !== 'unknown') return attempt
  const failed = records.find(record => record?.status === 'prepared' && record.last_submit_error
    && Date.parse(record.updated_at) > attempt.at)
  return failed ? { ...attempt, state: 'failed', note: text(failed.last_submit_error) } : attempt
}

// The size of the change, from the reviewed diff stat (as the static card shows it).
// The whole trimmed `git diff --shortstat` line, and nothing else. Git omits a
// zero count, so insertions-only, deletions-only and a bare "N files changed"
// (binary, mode, rename or empty-file changes) are all valid; any other text
// is unreadable and keeps the card blocked.
const STAT = /^(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/
export function changeSize(plan) {
  const stat = STAT.exec(String(plan?.diff_stat || '').trim())
  if (!stat) return ''
  const files = Number(stat[1])
  return `${files} ${files === 1 ? 'file' : 'files'} · +${stat[2] || 0} −${stat[3] || 0}`
}

// ---- The row Confirm shows for each frozen record. The host draws these rows
// in place of the card's own, so they carry the card's facts with the same
// values (prepared_block.py prepared_item), plus the layer for a stack. What
// Confirm sends is the frozen snapshot, which the server binds exactly.
export function confirmationItem(record) {
  const plan = record.plan || {}
  const meta = stackMeta(record)
  const screenshots = planScreenshots(plan).length
  const change = [changeSize(plan), screenshots ? screenshotCountText(screenshots) : ''].filter(Boolean).join(' · ')
  const facts = [
    ['Project', plan.repo || record.repo],
    ...(change ? [['Change', change]] : []),
    ...(meta ? [['Stack', `Layer ${meta.position} of ${meta.total} · ${meta.name}`]] : []),
  ]
  return { title: text(plan.title || record.title || record.id, 240), facts: facts.map(([label, value]) => ({ label, value: text(value) })) }
}
// A record sent through Möbius's relay (submission_mode 'mobius-bot') uses a
// relay request that cannot bind the confirmed snapshot on the server, so it
// is never confirmable from chat; Contribute itself still sends it.
const relayed = record => record?.submission_mode === 'mobius-bot'
export const RELAY_NOTE = 'This contribution is sent through the Möbius relay, which chat cannot send with a confirmed snapshot. Open Contribute to send it.'
// A frozen record is confirmable only when its whole identity is present.
// The owner must see how big each change is, so a record without a readable
// diff stat is never confirmable (staging always records one from Git).
const sized = record => Boolean(changeSize(record?.plan))
const identified = record => [record.plan?.repo || record.repo, record.plan?.branch || record.branch,
  record.plan?.head_sha, record.plan?.diff_sha256].every(Boolean)
export const UNLISTED_LAYER_NOTE = 'This card doesn’t list every layer of the stack. Open Contribute to send it.'
export const IDENTITY_NOTE = 'Its saved version is incomplete. Open Contribute to send it.'
const ATTENTION_NOTE = 'It needs attention in Contribute.'
export const DEFERRED_NOTE = 'It is sent after the layers before it. Open Contribute to send them in order.'
export const SIZE_NOTE = 'This contribution needs a fresh check in Contribute before it can be sent: its change size is missing.'
const confirmable = record => !relayed(record) && sized(record) && identified(record)

export function createInlineSession({ sessionId, actions, items = null, features = null, checkpoint = null, retain = false, recoveryError = false, publish, loadExact, onNeedRuntime,
  timers = DEFAULT_TIMERS, now = () => Date.now() }) {
  const advertised = [...new Map((actions || []).filter(item => typeof item?.key === 'string').map(item => [item.key, item])).values()]
  // The card's items name its records; its one action covers exactly them.
  const targets = new Map(advertised.map(item => [item.key, sendTarget(item.key, items)]))
  const idsFor = key => targets.get(key)?.ids || []
  // The records whose status a card shows: its send set, or the one record a
  // legacy card names, which is read for status only.
  const shownIds = key => targets.get(key)?.legacy ? [targets.get(key).legacy] : idsFor(key)
  let attempts = []
  let fault = ''
  try {
    if (recoveryError || retain && !checkpoint) throw new Error('Unresolved ownership without a checkpoint')
    attempts = decodeCheckpoint(checkpoint)
  } catch { fault = RECOVERY_NOTE }
  // A replacement document acknowledges the exact checkpoint it was handed.
  const checkpointAck = checkpoint?.id || null
  let lastCheckpoint = checkpoint && !fault ? { id: checkpoint.id, data: checkpoint.data } : null
  const exact = new Map()
  const generations = new Map()
  const reading = new Set()
  const unreadable = new Set()
  const absent = new Set() // unreadable because the read found no record
  let runtime = null
  let activating = ''
  // The app's refresh completion count an activation is waiting for. The app
  // reports `refreshDone` (completed card refreshes) and `refreshing`; reports
  // sent while that refresh is still running are intermediate and never end
  // the activation. A runtime without these fields (older app) counts its next
  // report as the answer.
  let awaitDone = -1
  let awaitLegacy = false
  // Set when the refresh an activation waited for completed without an answer
  // (timeout or failure). That activation has ended; only a new Try again can
  // reach Confirm, whatever a late response later reports.
  let refreshNote = ''
  const awaitingCheck = () => awaitLegacy || (awaitDone >= 0 && !(Number(runtime?.refreshDone) >= awaitDone))
  let frozen = null // { key, units } — the exact snapshot the owner confirms
  let ackNonce = null
  let alive = true
  let recheckTimer = null
  let rechecks = 0
  // The host's row intents; a row reports state only for a record it lists.
  const rowIntents = new Set((Array.isArray(items) ? items : []).map(item => item?.intent).filter(intent => typeof intent === 'string'))
  const rowOf = id => `review:${id}`
  // A host that draws row state, a live title and open-only actions says so;
  // an older one gets the earlier presentation on the action itself.
  const drawsRows = Array.isArray(features) && features.includes('row-state')

  const allIds = () => [...new Set([...advertised.flatMap(item => shownIds(item.key)), ...attempts.flatMap(attempt => attempt.ids)])]
  // Newest saved copy wins between the app's ledger and exact reads.
  const current = () => {
    const merged = new Map()
    for (const record of [...(runtime?.records || []), ...exact.values()]) {
      const previous = merged.get(record?.id)
      if (record?.id && (!previous || String(record.updated_at || '') >= String(previous.updated_at || ''))) merged.set(record.id, record)
    }
    return merged
  }
  const sending = () => attempts.some(attempt => attempt.state === 'sending')
  const overlaps = (attempt, unit) => attempt.unitKey === unit.key || attempt.ids.some(id => unit.records.some(record => record.id === id))
  const locked = unit => attempts.some(attempt => UNRESOLVED.has(attempt.state) && overlaps(attempt, unit))
  const units = key => publicationUnits(idsFor(key), [...current().values()], runtime?.reviewStatus, { requireCheck: true })
  // The action covers exactly the records the card lists: a unit whose ready
  // phase includes a record the card does not list (another stack layer) is
  // never confirmed, partly or expanded.
  const unlisted = (key, unit) => unit.ready.some(record => !idsFor(key).includes(record.id))
  const readyUnits = key => units(key).filter(unit => unit.ready.length && !unlisted(key, unit) && !locked(unit) && unit.ready.every(confirmable))
  // A unit blocked only by a check that can be retried is read again by Try again.
  const checkRetryable = key => units(key).some(unit => unit.reason === RETRY_CHECK_REASON)
  // Readiness is decided only from a complete ledger, a current review check,
  // a known connection and finished exact reads of everything this card names.
  const authoritative = key => Boolean(runtime?.ledgerReady) && runtime.reviewStatus?.state === 'ready'
    && runtime.connection !== 'checking' && !reading.size && !idsFor(key).some(id => unreadable.has(id))

  function blockedReason(key) {
    // A host that does not send the card's items cannot say which records the
    // action covers, so nothing is confirmable from here.
    if (targets.get(key)?.needsItems) return NEWER_NOTE
    if (targets.get(key)?.legacy) return legacyNote(targets.get(key).legacy)
    if (targets.get(key)?.invalid) return UNMATCHED_NOTE
    if (!runtime) return ''
    if (runtime.reviewStatus?.state === 'unavailable') return 'Could not verify the current review. Try again; nothing was sent.'
    if (idsFor(key).some(id => unreadable.has(id)) && !reading.size) return 'Could not read this contribution. Try again; nothing was sent.'
    if (ledgerIncomplete()) return LEDGER_NOTE
    if (!authoritative(key)) return ''
    if (runtime.connection !== 'connected') return 'Connect GitHub in Möbius Settings → Accounts to send.'
    // Without server-side binding of the confirmed snapshot, or a review check
    // addressed to these exact records, chat never sends.
    if (runtime.frozenBinding !== true || !idsFor(key).every(id => runtime.reviewStatus?.addressed?.includes(id))) {
      return NEWER_NOTE
    }
    if (idsFor(key).some(id => relayed(current().get(id)))) return RELAY_NOTE
    const all = units(key)
    if (all.some(unit => unlisted(key, unit))) return UNLISTED_LAYER_NOTE
    const ready = readyUnits(key)
    // The action covers every record the card lists or none: with some units
    // ready, each listed record must be published or in the exact phase this
    // Confirm would send. A deferred stack layer holds the card too.
    if (ready.length) {
      const confirmed = new Set(ready.flatMap(unit => unit.ready.map(record => record.id)))
      const held = idsFor(key).filter(id => !confirmed.has(id) && !isPublished(current().get(id)))
      return held.length ? heldNote(key, held) : ''
    }
    if (all.some(unit => unit.ready.length && !unit.ready.every(sized))) return SIZE_NOTE
    return all.map(unit => unit.reason).find(Boolean) || (all.some(locked) ? UNKNOWN_NOTE : '')
  }

  // One status line naming the listed record that holds a partly ready card:
  // the first with a reason of its own (a send blocker, an unresolved send, a
  // missing size or identity), else the first held. Only a record outside its
  // stack's next phase is said to wait for its turn.
  function heldNote(key, held) {
    const now = current()
    const unitOf = id => units(key).find(unit => unit.records.some(record => record.id === id))
    const own = id => {
      const record = now.get(id)
      if (!record) return 'This contribution is no longer in Contribute.'
      const unit = unitOf(id)
      return sendBlocker(record, reviewStateFor(record, runtime.reviewStatus), { requireCheck: true })
        || (unit && locked(unit) ? UNKNOWN_NOTE : '') || (sized(record) ? '' : SIZE_NOTE) || (identified(record) ? '' : IDENTITY_NOTE)
    }
    const id = held.find(own) || held[0]
    const unit = unitOf(id)
    const reason = own(id) || unit?.reason || (unit?.ready.some(record => record.id === id) ? ATTENTION_NOTE : DEFERRED_NOTE)
    const title = text(now.get(id)?.plan?.title || now.get(id)?.title || id, 500)
    const name = title.length <= 40 ? title : `${title.slice(0, 40).replace(/\s+\S*$/, '')}…`
    return `“${name}”: ${reason}`
  }

  // How a legacy card's record stands, once read: nothing when it is
  // published (its status and link show it), else where to send or check it.
  function legacyNote(id) {
    const record = current().get(id)
    if (!record) return absent.has(id) ? sendBlocker(null) : unreadable.has(id) ? UNCHECKED_NOTE : ''
    if (isPublished(record)) return ''
    return record.status === 'prepared' ? LEGACY_NOTE : sendBlocker(record)
  }

  // An unknown outcome is still being checked until its window has passed.
  const checkingAttempt = attempt => attempt.state === 'unknown' && now() - attempt.at < RECHECK_WINDOW_MS
  const latestAttempt = id => attempts.filter(attempt => attempt.ids.includes(id)).at(-1)
  // The rows carry each record's state when this host draws row state and the
  // card lists every record the action shows as a row. A legacy card (no rows)
  // or an older host keeps the state on the action instead.
  const rowsShown = key => drawsRows && shownIds(key).length > 0 && shownIds(key).every(id => rowIntents.has(rowOf(id)))

  function actionState(item) {
    const key = item.key
    const target = targets.get(key)
    const ids = idsFor(key)
    const shown = shownIds(key)
    const records = shown.map(id => current().get(id))
    const mine = attempts.filter(attempt => attempt.ids.some(id => ids.includes(id)))
    const busy = mine.some(attempt => attempt.state === 'sending')
    const unknown = !busy && mine.some(attempt => attempt.state === 'unknown')
    // Still checking: a calm, disabled "Checking…". Past the window: Contribute.
    const checkingResult = unknown && mine.some(checkingAttempt)
    const published = records.length > 0 && records.every(isPublished)
    const failure = published ? null : mine.filter(attempt => ['failed', 'not_attempted'].includes(attempt.state)).at(-1)
    const confirming = frozen?.key === key
    const checking = activating === key
    const loading = shown.some(id => !current().has(id) && reading.has(id))
    // A card that does not match its items never reaches Confirm; it shows
    // status and points to Contribute, which is not a warning.
    const passive = Boolean(target?.invalid)
    const legacy = target?.legacy
    // A legacy record that could not be checked is read again by Try again.
    const recheck = Boolean(legacy) && unreadable.has(legacy) && !absent.has(legacy)
    // A failed check or read can be retried; retrying only reads again.
    const retry = recheck || runtime?.reviewStatus?.state === 'unavailable' || ids.some(id => unreadable.has(id)) || ledgerIncomplete() || checkRetryable(key) || Boolean(refreshNote)
    const reason = fault || blockedReason(key)
    const rows = rowsShown(key)
    const sentLegacy = Boolean(legacy) && published
    // Nothing can be done from the chat: on a host that draws it, the control
    // opens Contribute instead of sitting disabled.
    const stuck = Boolean(fault) || unknown && !checkingResult || Boolean(reason) && !retry && !unknown
    const openOnly = drawsRows && stuck && !busy && !checking && !confirming && !sentLegacy
    const label = openOnly ? 'Open Contribute' : busy ? 'Sending…' : checkingResult || checking ? 'Checking…' : loading ? 'Loading…'
      : retry ? 'Try again' : sentLegacy || published && !rows ? 'Sent' : failure ? 'Retry' : item.label || 'Contribute'
    // A failure the rows already explain is not repeated under the action, and
    // a note that only says to open Contribute is the open control itself.
    const rowsExplain = rows && ids.some(id => rowFailure(id))
    const onlyPoints = openOnly && [LEGACY_NOTE, UNMATCHED_NOTE].includes(reason)
    const note = busy || checkingResult || (rowsExplain || onlyPoints) && !fault ? ''
      : unknown ? (rows ? '' : EXPIRED_NOTE)
      : text(fault || failure?.note || (activating === key ? '' : refreshNote) || reason)
    // Without rows the action carries the result: a status pill and PR links.
    const [status, statusTone] = rows ? ['', 'neutral'] : actionStatus({ fault, busy, checkingResult, unknown, failure, published, records })
    return {
      key, label,
      disabled: !openOnly && (busy || checkingResult || checking || loading || sending() || Boolean(frozen) && !confirming
        || passive && !recheck || Boolean(reason) && !retry || sentLegacy || published && !rows),
      busy: busy || checkingResult,
      open: openOnly,
      confirming,
      confirmation: confirming ? frozen.units.flatMap(unit => unit.ready.map(confirmationItem)) : null,
      hidden: published && rows && !busy && !confirming,
      note, tone: 'neutral', status, statusTone,
      links: rows ? [] : records.filter(isPublished).map(record => ({ label: `#${publishedPull(record).number}`, url: publishedPull(record).url })),
      badges: [],
    }
  }

  // The action's own status where there are no rows to carry it.
  function actionStatus({ fault, busy, checkingResult, unknown, failure, published, records }) {
    if (fault) return ['Needs attention', 'danger']
    if (busy) return ['Sending', 'neutral']
    if (checkingResult) return ['Checking GitHub', 'neutral']
    if (unknown) return ['Not confirmed', 'neutral']
    if (failure) return ['Not sent', failure.state === 'failed' ? 'danger' : 'neutral']
    if (published) return records.length === 1 ? PULL_STATUS[records[0].status] || ['Sent', 'success'] : ['Sent', 'success']
    return ['', 'neutral']
  }

  // This record's last send failed and it is not published.
  function rowFailure(id) {
    const attempt = latestAttempt(id)
    return attempt && ['failed', 'not_attempted'].includes(attempt.state) && !isPublished(current().get(id)) ? attempt : null
  }

  // One row's live state: sending, checking, its pull request, or why it failed.
  function rowState(id) {
    const record = current().get(id)
    const attempt = latestAttempt(id)
    if (attempt?.state === 'sending') return { status: 'Sending', busy: true }
    if (isPublished(record)) {
      const pull = publishedPull(record)
      const [status, statusTone] = PULL_STATUS[record.status] || ['Sent', 'success']
      return { status, statusTone, links: [{ label: `#${pull.number}`, url: pull.url }] }
    }
    if (attempt?.state === 'unknown') return checkingAttempt(attempt) ? { status: 'Checking GitHub', busy: true } : { status: 'Not confirmed' }
    const failed = rowFailure(id)
    if (failed) return { status: 'Not sent', statusTone: failed.state === 'failed' ? 'danger' : 'neutral', note: text(failed.note, 200) }
    return null
  }

  function rows() {
    if (!drawsRows) return []
    return allIds().filter(id => rowIntents.has(rowOf(id)))
      .flatMap(id => { const state = rowState(id); return state ? [{ intent: rowOf(id), ...state }] : [] }).slice(0, 12)
  }

  // The header says what happened; until something has, the card keeps its own.
  function title() {
    const ids = [...new Set(advertised.flatMap(item => idsFor(item.key)))]
    if (!drawsRows || !ids.length) return ''
    const now = current()
    const records = ids.map(id => now.get(id))
    const open = id => !isPublished(now.get(id))
    // Only a send or a check still underway is "Sending"; an expired check
    // says the result is not confirmed (or how many were sent).
    if (ids.some(id => open(id) && (latestAttempt(id)?.state === 'sending' || latestAttempt(id) && checkingAttempt(latestAttempt(id))))) {
      return `Sending ${plural(ids.length, 'contribution', 'contributions')}`
    }
    const sent = records.filter(isPublished).length
    if (sent < ids.length) {
      if (sent) return `${sent} of ${ids.length} sent`
      return ids.some(id => latestAttempt(id)?.state === 'unknown') ? 'Result not confirmed' : ''
    }
    // An update to an existing pull request did not open one.
    if (records.every(record => record.plan?.action === 'pr')) return sent === 1 ? 'Pull request opened' : `${sent} pull requests opened`
    return sent === 1 ? 'Contribution sent' : `${sent} contributions sent`
  }

  // Re-read an unknown outcome on a backoff; reads never send.
  function scheduleRecheck() {
    if (!alive || recheckTimer !== null) return
    const open = attempts.filter(checkingAttempt)
    if (!open.length) return
    // The last check lands just after the window, so the card then settles on
    // "Not confirmed" without waiting for another report.
    const windowLeft = Math.max(0, Math.min(...open.map(attempt => attempt.at + RECHECK_WINDOW_MS - now())))
    const delay = Math.min(RECHECK_DELAYS_MS[Math.min(rechecks, RECHECK_DELAYS_MS.length - 1)], windowLeft + 50)
    recheckTimer = timers.set(() => {
      recheckTimer = null
      rechecks += 1
      if (!alive) return
      const ids = [...new Set(attempts.filter(attempt => attempt.state === 'unknown').flatMap(attempt => attempt.ids))]
      if (!ids.length) return
      // The app's own refresh path re-reads the ledger and review status.
      if (runtime && !runtime.refreshing) Promise.resolve().then(() => runtime.refresh?.()).catch(() => {})
      void read(ids)
    }, delay)
  }

  function emit() {
    if (!alive) return
    let data = null
    try { data = encodeCheckpoint(attempts) } catch { fault = 'This card has too many unresolved results. Open Contribute to check them.' }
    if (fault) data = lastCheckpoint?.data ?? null
    if (data !== (lastCheckpoint?.data ?? null)) lastCheckpoint = data ? { id: crypto.randomUUID(), data } : null
    publish({
      sessionId, actions: advertised.map(actionState), title: title(), items: rows(),
      // Contribute's row facts (project, size) read on their own.
      ...(drawsRows ? { itemFacts: 'values' } : {}),
      retain: Boolean(fault || lastCheckpoint || frozen || activating || sending()),
      checkpoint: lastCheckpoint, checkpointAck, recoveryError: Boolean(fault), ackNonce,
    })
    scheduleRecheck()
  }

  // A preflight that finished without authority: every read for the card is
  // done, but a named record could not be read or the review check is
  // unavailable. It ends the activation so the card offers Try again.
  const preflightFailed = key => Boolean(runtime) && !reading.size && !awaitingCheck()
    && (idsFor(key).some(id => unreadable.has(id)) || runtime.reviewStatus?.state === 'unavailable' || ledgerIncomplete())
  // The ledger read finished but could not list every contribution, so the
  // whole stack and current versions cannot be verified from here.
  const ledgerIncomplete = () => runtime?.ledger === 'incomplete'

  function settle() {
    const now = current()
    attempts = attempts.map(attempt => observeAttempt(attempt, now))
    if (!activating) return
    // Decide only on the completed refresh, never on an intermediate report.
    if (awaitingCheck()) return
    const waited = awaitDone >= 0
    awaitDone = -1
    if (waited && ['timeout', 'failed'].includes(runtime?.refreshOutcome)) {
      activating = ''
      refreshNote = runtime.refreshOutcome === 'timeout' ? TIMEOUT_NOTE : REFRESH_FAILED_NOTE
      return
    }
    if (!authoritative(activating)) {
      if (preflightFailed(activating)) activating = ''
      return
    }
    const key = activating
    activating = ''
    const ready = blockedReason(key) ? [] : readyUnits(key)
    frozen = ready.length ? { key, units: copy(ready) } : null
  }

  // Newest-issued exact read wins per record; reads never send.
  async function read(ids) {
    const issued = ids.map(id => { const generation = (generations.get(id) || 0) + 1; generations.set(id, generation); reading.add(id); return generation })
    const results = await Promise.all(ids.map(id => Promise.resolve().then(() => loadExact(id)).then(record => ({ record }), () => ({ failed: true }))))
    if (!alive) return
    ids.forEach((id, index) => {
      if (generations.get(id) !== issued[index]) return
      reading.delete(id)
      const { record, failed } = results[index]
      if (record?.id === id) { exact.set(id, record); unreadable.delete(id); absent.delete(id); return }
      unreadable.add(id)
      if (failed) absent.delete(id); else absent.add(id)
    })
    settle(); emit()
  }

  function activate(key) {
    if (fault || sending() || frozen) return
    // A legacy card only reads its record again; it never needs the runtime.
    if (targets.get(key)?.legacy) { void read(shownIds(key)); return }
    activating = key
    awaitDone = -1
    awaitLegacy = false
    refreshNote = ''
    if (!runtime) onNeedRuntime?.()
    // A failed check or an incomplete ledger is read again by the app (one
    // refresh at a time); the card waits until that refresh completes.
    else if (runtime.reviewStatus?.state === 'unavailable' || ledgerIncomplete() || checkRetryable(key)) {
      if ('refreshDone' in runtime) awaitDone = (Number(runtime.refreshDone) || 0) + 1
      else awaitLegacy = true
      // A failed refresh is reported through refreshDone; never leave its
      // rejection unhandled.
      if (!runtime.refreshing) Promise.resolve(runtime.refresh?.()).catch(() => {})
    }
    void read(allIds())
  }

  function cancel(key) {
    if (sending()) return
    if (frozen?.key === key) frozen = null
    if (activating === key) activating = ''
  }

  async function confirm(key) {
    if (fault || sending() || frozen?.key !== key || !runtime) return
    const approval = frozen
    frozen = null
    const at = now()
    const started = approval.units.map(unit => ({ id: crypto.randomUUID(), unitKey: unit.key, ids: unit.ready.map(record => record.id), at, state: 'sending', note: '' }))
    attempts = [...attempts.filter(attempt => !started.some(next => next.unitKey === attempt.unitKey)), ...started]
    emit() // the unresolved checkpoint is published before any request leaves
    const { send, sendStack } = runtime
    await Promise.all(approval.units.map(async (unit, index) => {
      let outcome
      if ([...unit.records, ...unit.ready].some(relayed)) outcome = { notAttempted: true, error: RELAY_NOTE }
      else try { outcome = (unit.stack ? await sendStack(unit.records) : await send(unit.ready[0])) || {} } catch { outcome = { uncertain: true } }
      if (!alive) return
      attempts = attempts.map(attempt => attempt.id === started[index].id ? { ...attempt, ...attemptOutcome(outcome) } : attempt)
      await read(started[index].ids) // each unit settles independently of slower siblings
    }))
  }

  return {
    sessionId,
    start() { emit(); if (allIds().length) void read(allIds()) },
    updateRuntime(next) { runtime = next; awaitLegacy = false; settle(); emit() },
    handleEvent(event) {
      if (!advertised.some(item => item.key === event?.key) || !['activate', 'cancel', 'confirm'].includes(event.event)
        || typeof event.nonce !== 'string' || !event.nonce || event.nonce.length > 128) return false
      if (event.nonce !== ackNonce) {
        ackNonce = event.nonce
        if (event.event === 'activate') activate(event.key)
        else if (event.event === 'cancel') cancel(event.key)
        else void confirm(event.key)
      }
      emit()
      return true
    },
    dispose() {
      alive = false
      if (recheckTimer !== null) timers.clear(recheckTimer)
      recheckTimer = null
    },
  }
}
