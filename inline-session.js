// The in-chat Send session behind a Contribute card. Pure state: the host
// renders the controls, this model says what each one may do. Reading never
// sends; only the owner's Confirm of a frozen snapshot reaches the app's
// guarded Send handlers, which bind that snapshot on the server.
//
// What a card shows comes from the ledger, not from the card. The chat host
// attests which chat the card is in and whether it is that chat's newest card
// (`context`, `rows-v2`). The card's rows are the records its items name,
// followed through `superseded_by` to their current version, kept only when
// they belong to that chat; its action covers those still waiting to be sent.
// Only the newest card of a chat is live: an earlier one folds to "Continued
// below". A card the host cannot attest, and every card printed before this
// one, only shows status and never sends.
//
// The card re-reads its records (exact local reads, no network) when it
// mounts, when a turn in its chat settles and when the tab is shown again.
// GitHub and the source are checked only when the owner taps the action, and
// a check younger than REVIEW_REUSE_MS is reused.
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
import { cardKind, CHAT_INTENT, inChat, validRecordId } from './chat-blocks.js'
import { planScreenshots, screenshotCountText } from './domain.js'
import { isPublished, publicationUnits, publishedPull, reviewIncomplete, sendBlocker } from './send-readiness.js'
import { RETRY_CHECK_REASON, reviewStateFor } from './review.js'
import { stackMeta } from './stack.js'

const copy = value => JSON.parse(JSON.stringify(value))
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const CHECKPOINT_BYTES = 32768
const MAX_ATTEMPTS = 24
const UNRESOLVED = new Set(['sending', 'unknown'])
const UNKNOWN_NOTE = 'GitHub hasn’t confirmed the result yet.'
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
export const TIMEOUT_NOTE = 'Contribute didn’t answer in time. Try again.'
export const REFRESH_FAILED_NOTE = 'Contribute couldn’t check this right now. Try again.'
export const NEWER_NOTE = 'Sending from chat needs a newer Möbius. Open Contribute to send.'
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
// A ready card names nothing; a held one marks the row that holds it with one
// short pill (and its own action opens Contribute until the agent can be
// asked from the card). Only a reason no row explains is a line of text.
export const LEDGER_NOTE = 'Could not read every contribution. Try again; nothing was sent.'
export const HOLD = Object.freeze({ review: 'Needs review', notSent: 'Not sent', attention: 'Needs attention', check: 'Needs a fresh check',
  source: 'Source changed', later: 'Sent after its stack', stack: 'Stack incomplete', relay: 'Send in Contribute', sending: 'Sending',
  checking: 'Checking GitHub', gone: 'Not in Contribute', unread: 'Couldn’t check' })
export const UNREAD_NOTE = 'Could not read this contribution. Try again; nothing was sent.'
export const CHANGED_NOTE = 'A contribution changed while it was being checked. Try again.'
export const CONTINUED_TITLE = 'Continued below'
// A tap reuses a source and review check this recent; a tab shown again
// re-reads the ledger only if the last read is older than VISIBLE_REREAD_MS.
export const REVIEW_REUSE_MS = 2 * 60 * 1000
export const VISIBLE_REREAD_MS = 30 * 1000
// How far a card follows `superseded_by` to a record's current version.
const MAX_SUCCESSORS = 8
// A frozen record is confirmable only when its whole identity is present.
// The owner must see how big each change is, so a record without a readable
// diff stat is never confirmable (staging always records one from Git).
const sized = record => Boolean(changeSize(record?.plan))
const identified = record => [record.plan?.repo || record.repo, record.plan?.branch || record.branch,
  record.plan?.head_sha, record.plan?.diff_sha256].every(Boolean)
const confirmable = record => !relayed(record) && sized(record) && identified(record)


// The row's quiet metadata line: project and lines changed (files and
// screenshots are named in Confirm's rows).
const STAT_LINES = /^\d+ files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/
export function rowMeta(record) {
  const repo = text(record?.plan?.repo || record?.repo, 100)
  const stat = STAT_LINES.exec(String(record?.plan?.diff_stat || '').trim())
  return [repo, stat ? `+${stat[1] || 0} −${stat[2] || 0}` : ''].filter(Boolean).join(' · ')
}

// Why a prepared record cannot be sent, from the record alone, as its pill.
// The tap's check adds what only the source and GitHub can say.
export function localHold(record) {
  if (relayed(record)) return HOLD.relay
  if (record?.last_submit_error) return HOLD.notSent
  if (record?.needs_attention === true) return HOLD.attention
  if (reviewIncomplete(record)) return HOLD.review
  return sized(record) && identified(record) ? '' : HOLD.check
}

// The pill for a reason the tap's check found.
function holdFor(reason) {
  if (!reason) return ''
  if (/source changed/i.test(reason)) return HOLD.source
  if (/needs review/i.test(reason)) return HOLD.review
  if (/last send/i.test(reason)) return HOLD.notSent
  if (/no longer in Contribute/i.test(reason)) return HOLD.gone
  if (/not waiting to be sent/i.test(reason)) return HOLD.sending
  return HOLD.attention
}


// One record version: its exact head, base and reviewed diff.
const versionOf = record => [record?.plan?.head_sha, record?.plan?.base_sha, record?.plan?.diff_sha256].map(value => String(value || '')).join(':')
// The chat host's context: which chat, whether this is the newest card of the
// block intent it names, and that intent (`rows-v2`). Never from the card.
const readContext = value => value?.chatId ? { chatId: value.chatId, latest: value.latest !== false, intent: String(value.intent || '') } : null

export function createInlineSession({ sessionId, actions, items = null, features = null, context = null, checkpoint = null, retain = false, recoveryError = false, publish, loadExact, onNeedRuntime,
  timers = DEFAULT_TIMERS, now = () => Date.now() }) {
  const advertised = [...new Map((actions || []).filter(item => typeof item?.key === 'string').map(item => [item.key, item])).values()]
  const card = cardKind(advertised, items)
  // Record ids the card's items name: where to look, never what is sent.
  const hints = card?.hints || []
  // A host that draws an open-only action says `row-state`; one that also
  // draws the app's own rows and attests the card's chat says `rows-v2`.
  const drawsRows = Array.isArray(features) && features.includes('row-state')
  const ownRows = drawsRows && features.includes('rows-v2')
  let chat = readContext(context)
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
  const absent = new Set() // an exact read found no record
  let lastRead = -Infinity
  let cardRead = null // the card read in flight
  let rereadCard = false // another trigger arrived during it
  let runtime = null
  let activating = ''
  // Until the tap's own read finishes, nothing is decided: the records to
  // check are chosen from that read.
  let deciding = false
  // The tap asked for a source and review check (or mounted the runtime,
  // whose first check it is). The next ready answer is that check.
  let requested = false
  // The record versions the requested check is for, taken when it was asked.
  let requestedKey = ''
  // The last check this card received: the exact versions of the records it
  // covered, and when. A tap reuses it only for those versions, briefly.
  let checked = null
  // The app's refresh completion count an activation is waiting for. The app
  // reports `refreshDone` (completed card refreshes) and `refreshing`; reports
  // sent while that refresh is still running are intermediate and never end
  // the activation. A runtime without these fields (older app) counts its next
  // report as the answer.
  let awaitDone = -1
  let awaitLegacy = false
  // Set when the check an activation waited for ended without an answer
  // (timeout, failure, or a record that changed). That activation has ended;
  // only a new Try again can reach Confirm.
  let refreshNote = ''
  const awaitingCheck = () => deciding || awaitLegacy || (awaitDone >= 0 && !(Number(runtime?.refreshDone) >= awaitDone))
  let frozen = null // { key, units } — the exact snapshot the owner confirms
  let ackNonce = null
  let alive = true
  let recheckTimer = null
  let rechecks = 0

  // The host attests the chat: only then does the card read or show records.
  const attested = () => ownRows && Boolean(chat)
  const tracks = () => attested() && Boolean(card)
  // This card, in the group its host computes `latest` for.
  const ours = () => tracks() && chat.intent === CHAT_INTENT
  // Only the newest card of its chat may start or confirm a send.
  const newest = () => ours() && chat.latest !== false
  const unresolved = () => attempts.some(attempt => UNRESOLVED.has(attempt.state))
  // An earlier card folds once it owns nothing unresolved.
  const folded = () => ours() && !newest() && !unresolved()
  const sendKey = key => newest() && key === card?.key

  // Newest saved copy wins between the app's ledger and exact reads; a record
  // an exact read found gone is gone.
  const current = () => {
    const merged = new Map()
    for (const record of [...(runtime?.records || []), ...exact.values()]) {
      const previous = merged.get(record?.id)
      if (record?.id && !absent.has(record.id) && (!previous || String(record.updated_at || '') >= String(previous.updated_at || ''))) merged.set(record.id, record)
    }
    return merged
  }
  // A named record's current version: follow `superseded_by` while it leads
  // to a record not yet visited. `next` is a successor not read yet.
  function resolve(id, byId = current()) {
    const seen = new Set([id])
    let at = id
    for (let step = 0; step < MAX_SUCCESSORS; step++) {
      const record = byId.get(at)
      const next = record?.status === 'superseded' && validRecordId(record.superseded_by) && !seen.has(record.superseded_by) ? record.superseded_by : ''
      if (!next) return { id: at, record: record || null, seen }
      if (!byId.has(next)) return { id: at, record, seen, next }
      seen.add(next)
      at = next
    }
    return { id: at, record: byId.get(at) || null, seen }
  }
  // Every id the card reads: the named records, their successors (read or
  // still to read), and the records of its own unresolved attempts.
  const readIds = () => [...new Set([...hints.flatMap(id => { const found = resolve(id); return [...found.seen, ...(found.next ? [found.next] : [])] }),
    ...attempts.flatMap(attempt => attempt.ids)])]

  // The card's rows, in card order: each named record's current version that
  // belongs to the attested chat, as `pending` (waiting to be sent), `sent`,
  // `dismissed`, `missing` (a named record or successor that is gone) or
  // `unread` (one that could not be read yet). Missing and unread rows hold
  // the card: they are never a completed dismissal.
  function entries() {
    if (!tracks()) return []
    const byId = current()
    const seen = new Set()
    const list = []
    for (const hint of hints) {
      const { id, record, next, seen: chain } = resolve(hint, byId)
      if (seen.has(id)) continue
      seen.add(id)
      if (record && !inChat(record, chat.chatId)) continue
      // A fresh read that failed holds the row, whatever copy is cached: a
      // record is never shown or sent as it was before a read that failed.
      const failed = [...chain, ...(next ? [next] : [])].some(link => unreadable.has(link))
      if (!record || next || failed) {
        // Not read yet: no row until its read answers.
        const target = next || id
        if (absent.has(target)) list.push({ id, record, kind: 'missing' })
        else if (failed) list.push({ id, record, kind: 'unread' })
        continue
      }
      const kind = isPublished(record) ? 'sent' : ['prepared', 'submitting'].includes(record.status) ? 'pending'
        : ['abandoned', 'superseded'].includes(record.status) ? 'dismissed' : ''
      if (kind) list.push({ id, record, kind })
    }
    return list
  }
  // What the action covers: the card's records still waiting to be sent.
  const idsFor = key => sendKey(key) ? entries().filter(entry => entry.kind === 'pending').map(entry => entry.id) : []
  const versionKey = ids => [...ids].sort().map(id => `${id}@${versionOf(current().get(id))}`).join('\n')
  const unreadNow = () => !reading.size && entries().some(entry => entry.kind === 'unread')

  const sending = () => attempts.some(attempt => attempt.state === 'sending')
  const overlaps = (attempt, unit) => attempt.unitKey === unit.key || attempt.ids.some(id => unit.records.some(record => record.id === id))
  const locked = unit => attempts.some(attempt => UNRESOLVED.has(attempt.state) && overlaps(attempt, unit))
  const units = key => publicationUnits(idsFor(key), [...current().values()], runtime?.reviewStatus, { requireCheck: true })
  // The action covers exactly the card's records: a unit whose ready phase
  // includes a record the card does not show (another stack layer) is never
  // confirmed, partly or expanded.
  const unlisted = (key, unit) => unit.ready.some(record => !idsFor(key).includes(record.id))
  const readyUnits = key => units(key).filter(unit => unit.ready.length && !unlisted(key, unit) && !locked(unit) && unit.ready.every(confirmable))
  // A unit blocked only by a check that can be retried is read again by Try again.
  const checkRetryable = key => units(key).some(unit => unit.reason === RETRY_CHECK_REASON)
  // A check addressed to other records (the card's set changed since the app
  // asked) is still loading the right one; only a check with no address at
  // all comes from a Möbius too old to send from chat.
  const addressedElsewhere = key => Array.isArray(runtime?.reviewStatus?.addressed)
    && !idsFor(key).every(id => runtime.reviewStatus.addressed.includes(id))
  const answered = key => Boolean(runtime?.ledgerReady) && runtime.reviewStatus?.state === 'ready' && !addressedElsewhere(key)
    && runtime.connection !== 'checking' && !reading.size
  // Readiness is decided only from a complete ledger, a known connection,
  // finished reads, and a current check of exactly these record versions.
  const authoritative = key => answered(key) && checked?.key === versionKey(idsFor(key))
  const reusable = key => Boolean(runtime) && authoritative(key) && now() - checked.at <= REVIEW_REUSE_MS
    && !ledgerIncomplete() && !checkRetryable(key)
  const ledgerIncomplete = () => runtime?.ledger === 'incomplete'

  // A named record that is gone or unread holds the card, before anything else.
  function unresolvedHold() {
    const entry = entries().find(item => item.kind === 'missing' || item.kind === 'unread')
    return entry ? { id: entry.id, pill: entry.kind === 'missing' ? HOLD.gone : HOLD.unread, note: entry.kind === 'unread' ? UNREAD_NOTE : '' } : null
  }

  // Why the card's action cannot reach Confirm, as `{ note, id?, pill? }`:
  // `id` is the record that holds the card (its row gets `pill`); `note` is a
  // reason no row explains. Nothing when it can.
  function blocked(key) {
    const gone = unresolvedHold()
    if (gone) return gone
    if (!runtime) return null
    if (runtime.reviewStatus?.state === 'unavailable') return { note: 'Could not verify the current review. Try again; nothing was sent.' }
    if (ledgerIncomplete()) return { note: LEDGER_NOTE }
    if (!authoritative(key)) return null
    if (runtime.connection !== 'connected') return { note: 'Connect GitHub in Möbius Settings → Accounts to send.' }
    // Without server-side binding of the confirmed snapshot, or a review check
    // addressed to these exact records, chat never sends.
    if (runtime.frozenBinding !== true || !Array.isArray(runtime.reviewStatus?.addressed)) return { note: NEWER_NOTE }
    const now = current()
    const relay = idsFor(key).find(id => relayed(now.get(id)))
    if (relay) return { id: relay, pill: HOLD.relay }
    const all = units(key)
    const outside = all.find(unit => unlisted(key, unit))
    if (outside) return { id: outside.records.find(record => idsFor(key).includes(record.id))?.id, pill: HOLD.stack }
    const ready = readyUnits(key)
    // The action covers every record the card shows or none: with some units
    // ready, each pending record must be in the exact phase this Confirm would
    // send. A deferred stack layer holds the card too.
    const confirmed = new Set(ready.flatMap(unit => unit.ready.map(record => record.id)))
    const held = idsFor(key).filter(id => !confirmed.has(id))
    if (ready.length && !held.length) return null
    return held.length ? holdOf(key, held) : { note: '' }
  }

  // The record that holds a card and its pill: the first with a reason of its
  // own (a send blocker, an unresolved send, a missing size or identity), else
  // the first held. Only a record outside its stack's next phase waits for
  // its turn.
  function holdOf(key, held) {
    const now = current()
    const unitOf = id => units(key).find(unit => unit.records.some(record => record.id === id))
    const own = id => {
      const record = now.get(id)
      if (!record) return HOLD.gone
      const unit = unitOf(id)
      return holdFor(sendBlocker(record, reviewStateFor(record, runtime.reviewStatus), { requireCheck: true }))
        || (unit && locked(unit) ? HOLD.checking : '') || (sized(record) && identified(record) ? '' : HOLD.check)
    }
    const id = held.find(own) || held[0]
    const unit = unitOf(id)
    const pill = own(id) || holdFor(unit?.reason) || (unit?.ready.some(record => record.id === id) ? HOLD.attention : HOLD.later)
    // A check that can be retried says so; the row keeps its pill.
    return { id, pill, note: unit?.reason === RETRY_CHECK_REASON ? RETRY_CHECK_REASON : '' }
  }

  // Before a tap, from the records alone: the first row that holds the card.
  function localHeld() {
    const gone = unresolvedHold()
    if (gone) return gone
    const entry = entries().find(item => item.kind === 'pending' && (item.record.status === 'submitting' || localHold(item.record)))
    return entry ? { id: entry.id, pill: entry.record.status === 'submitting' ? HOLD.sending : localHold(entry.record) } : null
  }

  // An unknown outcome is still being checked until its window has passed.
  const checkingAttempt = attempt => attempt.state === 'unknown' && now() - attempt.at < RECHECK_WINDOW_MS
  const latestAttempt = id => attempts.filter(attempt => attempt.ids.includes(id)).at(-1)

  // This record's last send failed and it is not published.
  function rowFailure(id) {
    const attempt = latestAttempt(id)
    return attempt && ['failed', 'not_attempted'].includes(attempt.state) && !isPublished(current().get(id)) ? attempt : null
  }

  // One record's live state: sending, checking, its pull request, or why it failed.
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
    if (failed) return { status: 'Not sent', statusTone: failed.state === 'failed' ? 'danger' : 'neutral' }
    return null
  }

  // The held record and pill for the card now: the tap's finding while it
  // stands, else what the records alone say.
  function heldNow(key) {
    const found = activating || frozen ? null : blocked(key)
    return found?.id ? found : runtime && authoritative(key) ? null : localHeld()
  }

  // ---- The app's own rows (`rows-v2`).
  function rowFor({ id, record, kind }, hold) {
    const row = { title: text(record?.plan?.title || record?.title || id, 120), meta: record ? rowMeta(record) : '', intent: `review:${id}` }
    if (kind === 'missing') return { ...row, pill: HOLD.gone, tone: 'attention' }
    if (kind === 'unread') return { ...row, pill: HOLD.unread }
    if (kind === 'dismissed') return { ...row, pill: record.status === 'abandoned' ? 'Dismissed' : 'Replaced' }
    const state = rowState(id)
    if (state) return { ...row, pill: state.status, tone: state.statusTone || 'neutral', busy: state.busy === true, links: state.links || [] }
    if (record.status === 'submitting') return { ...row, pill: HOLD.sending, busy: true }
    return hold?.id === id ? { ...row, pill: hold.pill, tone: 'attention' } : row
  }
  function ownRowsReport(key) {
    if (folded()) return []
    const hold = sendKey(key) ? heldNow(key) : null
    return entries().map(entry => rowFor(entry, hold)).slice(0, 12)
  }

  // ---- The header says what the card stands at.
  function heading(key) {
    if (folded()) return { title: CONTINUED_TITLE }
    if (!tracks()) return { title: '' }
    const list = entries()
    const pending = list.filter(entry => entry.kind === 'pending')
    const sent = list.filter(entry => entry.kind === 'sent')
    const counted = list.filter(entry => entry.kind !== 'dismissed')
    // Only a send or a check still underway is "Sending"; an expired check
    // says the result is not confirmed (or how many were sent).
    const inFlight = counted.filter(entry => !isPublished(current().get(entry.id)) && (latestAttempt(entry.id)?.state === 'sending'
      || (latestAttempt(entry.id) && checkingAttempt(latestAttempt(entry.id)))))
    if (inFlight.length) return { title: `Sending ${inFlight.length}`, titleBusy: true }
    if (!counted.length) return { title: list.length ? 'Nothing left to send' : 'No contributions' }
    if (sent.length === counted.length) {
      const opened = attempts.some(attempt => attempt.ids.some(id => sent.some(entry => entry.id === id)))
      const prs = sent.every(entry => entry.record.plan?.action === 'pr')
      const count = sent.length
      const title = prs ? opened ? count === 1 ? 'Pull request opened' : `${count} pull requests opened` : count === 1 ? '1 pull request' : `${count} pull requests`
        : count === 1 ? 'Contribution sent' : `${count} contributions sent`
      return { title, titleTone: 'success' }
    }
    if (pending.some(entry => latestAttempt(entry.id)?.state === 'unknown')) return { title: sent.length ? `${sent.length} of ${counted.length} sent` : 'Result not confirmed', titleTone: 'attention' }
    const failed = pending.filter(entry => rowFailure(entry.id))
    const hold = sendKey(key) ? heldNow(key) : null
    if (sent.length) return { title: `${sent.length} of ${counted.length} sent`, titleTone: failed.length || hold ? 'attention' : 'neutral' }
    if (hold) return { title: '1 needs a fix', titleTone: 'attention' }
    return { title: plural(counted.length, 'contribution', 'contributions') }
  }

  const quiet = { busy: false, confirming: false, confirmation: null, tone: 'neutral', status: '', statusTone: 'neutral', links: [], badges: [] }

  // A card that shows no records: the host could not attest its chat. It
  // opens Contribute, or on a host without open-only actions says so.
  function unattestedAction(item) {
    return { ...quiet, key: item.key, label: 'Open Contribute', open: drawsRows && !fault, disabled: !drawsRows || Boolean(fault), hidden: false,
      note: text(fault || (drawsRows ? '' : NEWER_NOTE)) }
  }

  // A card that only shows status (printed before this one, or this card
  // outside its group): never Confirm. Its rows say everything; it offers
  // Try again when a record could not be read, which only reads again.
  function statusAction(item) {
    const retry = !fault && unreadNow()
    return { ...quiet, key: item.key, label: retry ? 'Try again' : 'Open Contribute', disabled: !retry, open: false, hidden: !retry && !fault,
      note: text(fault || (retry ? UNCHECKED_NOTE : '')) }
  }

  function actionState(item) {
    const key = item.key
    if (folded()) return { ...quiet, key, label: item.label || 'Contribute', disabled: true, hidden: true, open: false, note: '' }
    if (!attested()) return unattestedAction(item)
    if (key !== card?.key || !ours()) return statusAction(item)
    const sendable = newest()
    const ids = idsFor(key)
    const list = entries()
    const mine = attempts.filter(attempt => attempt.ids.some(id => list.some(entry => entry.id === id)))
    const busy = mine.some(attempt => attempt.state === 'sending')
    const unknown = !busy && mine.some(attempt => attempt.state === 'unknown')
    // Still checking: a calm, disabled "Checking…". Past the window: Contribute.
    const checkingResult = unknown && mine.some(checkingAttempt)
    const nothingLeft = !list.some(entry => entry.kind === 'pending' || entry.kind === 'missing' || entry.kind === 'unread')
    const failure = mine.filter(attempt => ['failed', 'not_attempted'].includes(attempt.state) && attempt.ids.some(id => ids.includes(id))).at(-1)
    const confirming = frozen?.key === key
    const checking = activating === key
    const loading = hints.some(id => reading.has(id)) && !list.length
    const found = checking || confirming ? null : blocked(key)
    const hold = found?.id ? found : null
    const before = !runtime || !authoritative(key) ? localHeld() : null
    // A failed check or read can be retried; retrying only reads again.
    const retry = sendable && (runtime?.reviewStatus?.state === 'unavailable' || unreadNow() || ledgerIncomplete() || checkRetryable(key) || Boolean(refreshNote))
    const reason = fault || found?.note || ''
    // Nothing can be done from the chat (or from a card a newer one follows):
    // the control opens Contribute.
    const settled = !busy && !unknown
    const stuck = Boolean(fault) || unknown && !checkingResult || settled && !retry && (Boolean(hold || before || reason) || !sendable)
    const openOnly = stuck && !busy && !checking && !confirming
    const label = openOnly ? 'Open Contribute' : busy ? 'Sending…' : checkingResult || checking ? 'Checking…' : loading ? 'Loading…'
      : retry ? 'Try again' : failure ? 'Retry' : ids.length === 1 ? 'Contribute' : 'Contribute all'
    // Rows carry each record's state as a pill; one line of text says what a
    // pill cannot: a check to retry, the account, an older Möbius, or why the
    // last send was refused.
    const note = busy || checkingResult || unknown ? '' : text(fault || (checking ? '' : refreshNote) || reason || failure?.note)
    return {
      ...quiet, key, label,
      disabled: !openOnly && (busy || checkingResult || checking || loading || sending() || Boolean(frozen) && !confirming || Boolean(reason) && !retry),
      busy: busy || checkingResult,
      open: openOnly,
      confirming,
      confirmation: confirming ? frozen.units.flatMap(unit => unit.ready.map(confirmationItem)) : null,
      hidden: nothingLeft && !busy && !unknown && !confirming && !fault && !retry,
      note,
    }
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
    const key = card?.key || ''
    const { title = '', titleTone = 'neutral', titleBusy = false } = heading(key)
    publish({
      sessionId, actions: advertised.map(actionState), title,
      // Rows only for the chat the host attests; otherwise the card's own
      // fallback rows stay, and nothing is read.
      ...(tracks() ? { rows: ownRowsReport(key), titleTone, titleBusy } : {}),
      retain: Boolean(fault || lastCheckpoint || frozen || activating || sending()),
      checkpoint: lastCheckpoint, checkpointAck, recoveryError: Boolean(fault), ackNonce,
    })
    scheduleRecheck()
  }

  // A preflight that finished without authority: every read for the card is
  // done, but a named record could not be read or the check is unavailable.
  // It ends the activation so the card offers Try again.
  const preflightFailed = () => Boolean(runtime) && !reading.size && !awaitingCheck()
    && (unreadNow() || runtime.reviewStatus?.state === 'unavailable' || ledgerIncomplete())

  function settle() {
    const byId = current()
    attempts = attempts.map(attempt => observeAttempt(attempt, byId))
    if (!activating) return
    // Decide only on the completed check, never on an intermediate report.
    if (awaitingCheck()) return
    const waited = awaitDone >= 0
    awaitDone = -1
    const key = activating
    if (waited && ['timeout', 'failed'].includes(runtime?.refreshOutcome)) {
      activating = ''; requested = false
      refreshNote = runtime.refreshOutcome === 'timeout' ? TIMEOUT_NOTE : REFRESH_FAILED_NOTE
      return
    }
    // The ledger the runtime read can change which records the action covers
    // (a successor, a record the exact read missed): check those instead.
    if (requested && addressedElsewhere(key)) { requestedKey = versionKey(idsFor(key)); onNeedRuntime?.(idsFor(key)); return }
    // The check this tap asked for has answered: it covers the versions it
    // was asked for. A record that changed since makes it a check of another
    // version, which ends the tap below.
    if (requested && answered(key)) { checked = { key: requestedKey, at: now() }; requested = false }
    if (!authoritative(key)) {
      if (preflightFailed()) { activating = ''; requested = false }
      // An answer for other versions (a record changed meanwhile) ends the
      // tap; Try again checks the current ones.
      else if (!requested && answered(key)) { activating = ''; refreshNote = CHANGED_NOTE }
      return
    }
    activating = ''
    const ready = blocked(key) ? [] : readyUnits(key)
    frozen = ready.length ? { key, units: copy(ready) } : null
  }

  // Newest-issued exact read wins per record; reads never send.
  async function read(ids) {
    if (!ids.length) return
    lastRead = now()
    const issued = ids.map(id => { const generation = (generations.get(id) || 0) + 1; generations.set(id, generation); reading.add(id); return generation })
    const results = await Promise.all(ids.map(id => Promise.resolve().then(() => loadExact(id)).then(record => ({ record }), () => ({ failed: true }))))
    if (!alive) return
    ids.forEach((id, index) => {
      if (generations.get(id) !== issued[index]) return
      reading.delete(id)
      const { record, failed } = results[index]
      if (record?.id === id) { exact.set(id, record); unreadable.delete(id); absent.delete(id); return }
      if (failed) { unreadable.add(id); absent.delete(id); return }
      // An authoritative read found it gone: forget any earlier copy.
      exact.delete(id); unreadable.delete(id); absent.add(id)
    })
    settle(); emit()
  }

  // Read the card's records and any successor they lead to (each at most once
  // per pass, a bounded number of steps). Local storage only. A trigger during
  // a pass runs one more pass after it, never a second one alongside it.
  function readCard() {
    if (!tracks() || folded()) return Promise.resolve()
    if (cardRead) { rereadCard = true; return cardRead }
    cardRead = (async () => {
      do {
        rereadCard = false
        const tried = new Set(readIds())
        await read([...tried])
        for (let step = 0; step < MAX_SUCCESSORS && alive; step++) {
          const next = [...new Set(hints.map(id => resolve(id).next).filter(id => id && !tried.has(id)))]
          if (!next.length) break
          next.forEach(id => tried.add(id))
          await read(next)
        }
      } while (rereadCard && alive)
    })().finally(() => { cardRead = null })
    return cardRead
  }

  async function activate(key) {
    if (fault || sending() || frozen || activating) return
    // A card that only shows status reads its records again; it never sends.
    if (!sendKey(key)) { void readCard(); return }
    activating = key
    awaitDone = -1
    awaitLegacy = false
    refreshNote = ''
    deciding = true
    emit()
    // The tap first reads the card's records, so it checks what they are now.
    await readCard()
    if (!alive || activating !== key) { deciding = false; return }
    // The app mounts its send runtime (once) and checks exactly these records.
    onNeedRuntime?.(idsFor(key))
    requestedKey = versionKey(idsFor(key))
    if (!runtime) requested = true
    else if (!reusable(key)) {
      // One refresh at a time; the card waits until it completes.
      requested = true
      if ('refreshDone' in runtime) awaitDone = (Number(runtime.refreshDone) || 0) + 1
      else awaitLegacy = true
      // A failed refresh is reported through refreshDone; never leave its
      // rejection unhandled.
      if (!runtime.refreshing) Promise.resolve(runtime.refresh?.()).catch(() => {})
    }
    deciding = false
    settle(); emit()
  }

  function cancel(key) {
    if (sending()) return
    if (frozen?.key === key) frozen = null
    if (activating === key) { activating = ''; requested = false }
  }

  async function confirm(key) {
    if (fault || sending() || frozen?.key !== key || !runtime || !sendKey(key)) return
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
    start() { emit(); void readCard() },
    // A new envelope for this session: the host's verdict on whether the card
    // is still the newest of its chat. A card a newer one follows drops any
    // open confirmation or tap (nothing was sent) and can start no new send;
    // it keeps showing a send it already started until that settles.
    update(init) {
      const next = readContext(init?.context)
      // The chat a card is in never changes; only the newest-card verdict does.
      if (chat && next && next.chatId !== chat.chatId) return
      const wasFolded = folded()
      chat = next
      if (!newest()) { frozen = null; if (activating) { activating = ''; requested = false; deciding = false } }
      emit()
      if (wasFolded && !folded()) void readCard()
    },
    // The host's hint that something may have changed: a turn in this chat
    // settled, or the tab was shown again (re-read only if the last read is
    // older than VISIBLE_REREAD_MS). Local reads only.
    refresh(reason) {
      if (!alive || !tracks() || folded()) return
      if (reason === 'visible' && now() - lastRead < VISIBLE_REREAD_MS) return
      void readCard()
    },
    // The records this card's action would cover now.
    sendIds() { return idsFor(card?.key || '') },
    updateRuntime(next) { runtime = next; awaitLegacy = false; settle(); emit() },
    handleEvent(event) {
      if (!advertised.some(item => item.key === event?.key) || !['activate', 'cancel', 'confirm'].includes(event.event)
        || typeof event.nonce !== 'string' || !event.nonce || event.nonce.length > 128) return false
      if (event.nonce !== ackNonce) {
        ackNonce = event.nonce
        if (event.event === 'activate') void activate(event.key)
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
