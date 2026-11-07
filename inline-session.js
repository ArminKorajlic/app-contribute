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
// the card asks the platform to read GitHub for it (`observe`, shared with the
// app's refresh in publication-observer.js) and re-reads its records, with
// backoff, for RECHECK_WINDOW_MS after the send; it never sends again. A
// settled answer shows the pull request; a published branch whose PR is not
// confirmed keeps "Checking GitHub"; a target that changed holds the row
// (`publication_changed`); a record with Autopilot on that the platform does
// not observe is left to Autopilot. Every answer and finding belongs to one
// exact record version: a late answer for an older version is dropped, and a
// new version is observed afresh. Without the observe route (an older
// Möbius) the card only re-reads.
//
// The card reports calm state to the host: a live title, and per row a status
// pill, the pull request link once published, and one short reason when a
// send failed (building-apps.md "Passive block sessions").
//
// When a held or failed row needs something only this chat's agent can do,
// a host that draws asks (`ask-v1`) gets "Fix in chat" in place of the
// action: the held record's id and a stable code (card-asks.js), which the
// host sends in its own words as the owner's message. A GitHub connection problem opens the
// account instead. Without `ask-v1` the action opens Contribute, as before.
import { cardKind, CHAT_INTENT, inChat, validRecordId } from './chat-blocks.js'
import { planScreenshots, publicationVersion, screenshotCountText, uncertainPublication } from './domain.js'
import { isAutopilotEnabled } from './autopilot.js'
import { isPublished, publicationUnits, publishedPull, reviewIncomplete, sendBlocker } from './send-readiness.js'
import { RETRY_CHECK_REASON, reviewStateFor } from './review.js'
import { ACCOUNT_CODES, askRev, cardAsk, holdCode } from './card-asks.js'

const copy = value => JSON.parse(JSON.stringify(value))
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const CHECKPOINT_BYTES = 32768
const MAX_ATTEMPTS = 24
const UNRESOLVED = new Set(['sending', 'unknown'])
const UNKNOWN_NOTE = 'GitHub hasn’t confirmed the result yet.'
// Rechecks of an unknown outcome: quick at first, then once a minute, for ten
// minutes after the send. After that the row says "Not confirmed" and the
// card asks the agent to check it (or, without `ask-v1`, opens Contribute);
// nothing is ever retried blindly.
export const RECHECK_DELAYS_MS = [3000, 6000, 12000, 24000, 45000, 60000]
export const RECHECK_WINDOW_MS = 10 * 60 * 1000
// An open pull request needs no word beside its link; Merged is the finished state.
const PULL_STATUS = { draft: ['Draft', 'neutral'], open: ['', 'neutral'], landing: ['', 'neutral'], merged: ['Merged', 'success'], closed: ['Closed', 'neutral'] }
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
  // A saved error that says the send may already be public is not a refusal.
  const failed = records.find(record => record?.status === 'prepared' && record.last_submit_error
    && !uncertainPublication(record) && Date.parse(record.updated_at) > attempt.at)
  return failed ? { ...attempt, state: 'failed', note: text(failed.last_submit_error) } : attempt
}

// The size of the change, from the reviewed diff stat (as the static card shows it).
// The whole trimmed `git diff --shortstat` line, and nothing else. Git omits a
// zero count, so insertions-only, deletions-only and a bare "N files changed"
// (binary, mode, rename or empty-file changes) are all valid; any other text
// is unreadable and keeps the card blocked.
const STAT = /^(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/
export function lineCounts(plan) {
  const stat = STAT.exec(String(plan?.diff_stat || '').trim())
  return stat ? { added: Number(stat[2] || 0), removed: Number(stat[3] || 0) } : null
}
// "+a −r", with a no-break space so the two stay together.
export const linesText = lines => `+${lines.added}\u00a0−${lines.removed}`

// What a card row shows besides its title, in order: project, the screenshots
// a new PR will publish, the stack layer, then the change size. The printed
// card (prepared_block.py prepared_item), the live rows and Confirm's rows all
// use it, so Confirm approves the list the owner just read.
function rowValues(record) {
  const plan = record?.plan || {}
  const shots = planScreenshots(plan).length
  return { project: text(plan.repo || record?.repo, 100), shots: shots ? screenshotCountText(shots) : '',
    layer: stackLayer(plan), lines: lineCounts(plan) }
}
// The row's "Layer k of n", by one strict rule shared with the printed card
// (prepared_block.py stack_layer, test/fixtures/stack-layers.json): a
// non-empty string id and whole-number position and total, 1 <= position <=
// total, 2 <= total <= 999. Staging writes these as numbers; anything else
// shows no layer rather than guess.
const layerCount = n => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 999
function stackLayer(plan) {
  const stack = plan?.stack && typeof plan.stack === 'object' ? plan.stack : {}
  return typeof stack.id === 'string' && stack.id && layerCount(stack.position) && layerCount(stack.total) && stack.total >= 2 && stack.position <= stack.total
    ? `Layer ${stack.position} of ${stack.total}` : ''
}

// ---- The row Confirm shows for each frozen record. The host draws these rows
// in place of the card's own (the block opts in to value-only facts, labels
// kept for assistive technology), and draws the change size in colour from
// `lines`; an older host shows its text. What Confirm sends is the frozen
// snapshot, which the server binds exactly.
export function confirmationItem(record) {
  const { project, shots, layer, lines } = rowValues(record)
  const facts = [{ label: 'Project', value: project },
    ...(shots ? [{ label: 'Screenshots', value: shots }] : []),
    ...(layer ? [{ label: 'Stack', value: layer }] : []),
    ...(lines ? [{ label: 'Change', value: linesText(lines), lines }] : [])]
  return { title: text(record.plan?.title || record.title || record.id, 240), facts }
}
// A record sent through Möbius's relay (submission_mode 'mobius-bot') uses a
// relay request that cannot bind the confirmed snapshot on the server, so it
// is never confirmable from chat; Contribute itself still sends it.
const relayed = record => record?.submission_mode === 'mobius-bot'
export const RELAY_NOTE = 'This contribution is sent through the Möbius relay, which chat cannot send with a confirmed snapshot. Open Contribute to send it.'
// A ready card names nothing; a held one marks the row that holds it with one
// short pill, and its action asks the agent to fix it (`ask-v1`) or opens
// Contribute. Only a reason no row explains is a line of text.
export const LEDGER_NOTE = 'Could not read every contribution. Try again; nothing was sent.'
export const HOLD = Object.freeze({ review: 'Needs review', notSent: 'Not sent', attention: 'Needs attention', check: 'Needs a fresh check',
  source: 'Source changed', later: 'Sent after its stack', stack: 'Stack incomplete', parentMerged: 'Parent merged',
  parentChanged: 'Parent changed', invalidStack: 'Stack not valid', relay: 'Send in Contribute', sending: 'Sending',
  checking: 'Checking GitHub', gone: 'Not in Contribute', unread: 'Couldn’t check' })
// Why a stack cannot be sent as a whole (stack.js stackReadiness codes, plus
// a stack the card lists only in part), as its row's pill and ask code.
const STACK_HOLDS = Object.freeze({
  incomplete: { pill: HOLD.stack, code: 'stack_incomplete' },
  refresh: { pill: HOLD.parentMerged, code: 'stack_parent_merged' },
  restack: { pill: HOLD.parentChanged, code: 'stack_parent_changed' },
  invalid: { pill: HOLD.invalidStack, code: '' },
})
// Held rows that wait rather than need a fix: a send in flight, one GitHub has
// not answered yet, or a stack layer due after its parent.
const WAITING = new Set([HOLD.sending, HOLD.checking, HOLD.later, HOLD.unread])
export const UNREAD_NOTE = 'Could not read this contribution. Try again; nothing was sent.'
// What observation of an unknown send can conclude. A changed target holds
// the row with this ask code; an update Autopilot owns gets a neutral pill.
// Both stay locked; observation stops for them and for any other record the
// platform does not observe (which keeps today's ledger-only recheck).
export const PUBLICATION_CHANGED = 'publication_changed'
export const CHANGED_PILL = 'Changed on GitHub'
export const AUTOPILOT_PILL = 'With Autopilot'
const CONCLUDED = new Set(['changed', 'autopilot'])
const STOPPED = new Set(['changed', 'autopilot', 'ineligible'])
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
const sized = record => Boolean(lineCounts(record?.plan))
const identified = record => [record.plan?.repo || record.repo, record.plan?.branch || record.branch,
  record.plan?.head_sha, record.plan?.diff_sha256].every(Boolean)
const confirmable = record => !relayed(record) && sized(record) && identified(record)
// A source check's more specific finding than "Source changed".
const CODE_PILL = Object.freeze({ upstream_conflict: 'Conflicts', upstream_base_moved: 'Upstream moved',
  commit_identity_mismatch: 'Wrong author', invalid_pr_text: 'Text not valid' })
// The code for a record held by its own fields alone, before a tap.
// A send that may already be public asks nothing here: only its observed
// outcome asks (publication_changed, or result_unknown after the window).
const localCode = record => relayed(record) || uncertainPublication(record) ? '' : holdCode(record) || (sized(record) && identified(record) ? '' : 'restage')


// The row's quiet metadata line. A host with `lines-v1` draws the change size
// itself from the row's `lines`; an older one gets it here as text.
export function rowMeta(record, { linesApart = false } = {}) {
  const { project, shots, layer, lines } = rowValues(record)
  return [project, shots, layer, lines && !linesApart ? linesText(lines) : ''].filter(Boolean).join(' · ')
}

// Why a prepared record cannot be sent, from the record alone, as its pill.
// The tap's check adds what only the source and GitHub can say.
export function localHold(record) {
  if (relayed(record)) return HOLD.relay
  if (uncertainPublication(record)) return HOLD.checking
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
  if (/confirmed the last send/i.test(reason)) return HOLD.checking
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
  observe = null, timers = DEFAULT_TIMERS, now = () => Date.now() }) {
  const advertised = [...new Map((actions || []).filter(item => typeof item?.key === 'string').map(item => [item.key, item])).values()]
  const card = cardKind(advertised, items)
  // Record ids the card's items name: where to look, never what is sent.
  const hints = card?.hints || []
  // A host that draws an open-only action says `row-state`; one that also
  // draws the app's own rows and attests the card's chat says `rows-v2`.
  const drawsRows = Array.isArray(features) && features.includes('row-state')
  const ownRows = drawsRows && features.includes('rows-v2')
  // One that also draws asks to this chat's agent says `ask-v1`.
  const asks = ownRows && features.includes('ask-v1')
  // The host draws a row's change size from `lines` (in colour, spoken).
  const drawsLines = ownRows && features.includes('lines-v1')
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
  // What observation found for a record whose send is unknown, with the
  // record version it is about: 'pending', 'changed', 'autopilot' or
  // 'ineligible'. A finding for another version is ignored. Session-only: a
  // reloaded card asks again. `observeOff` once the host has no observe route.
  const findings = new Map()
  const findingOf = (id, record = current().get(id)) => {
    const found = findings.get(id)
    return found && record && found.version === publicationVersion(record) ? found.outcome : ''
  }
  let observeOff = !observe
  let observing = false

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
  // Before the first exact read of a named record answers, the card knows
  // nothing: that is loading, never "No contributions". The host keeps the
  // card's own saved rows meanwhile.
  const firstRead = () => tracks() && !folded() && !entries().length && hints.some(hint => {
    const found = resolve(hint)
    const target = found.next || found.id
    return !found.record && !absent.has(target) && !unreadable.has(target)
  })

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
  // A hold names the record the action is about (`id`, `pill`, `code`) and,
  // in `holds`, every held record with its own reason: the rows show each
  // one and the header counts them.
  function unresolvedHold() {
    const holds = entries().filter(item => item.kind === 'missing' || item.kind === 'unread')
      .map(entry => ({ id: entry.id, pill: entry.kind === 'missing' ? HOLD.gone : HOLD.unread, note: entry.kind === 'unread' ? UNREAD_NOTE : '',
        code: entry.kind === 'missing' ? 'not_in_contribute' : 'couldnt_check' }))
    return holds.length ? { ...holds[0], holds } : null
  }

  // Why the card's action cannot reach Confirm, as `{ note, id?, pill? }`:
  // `id` is the record that holds the card (its row gets `pill`); `note` is a
  // reason no row explains. Nothing when it can.
  // What stops the card's action, with every per-record blocker collected in
  // `holds` in one pass: unresolved reads and local holds, relay records,
  // incomplete stacks and the authoritative check's own findings. The first
  // of them is the action's reason; rows and counts read them all.
  function blocked(key) {
    const checked = checkedBlock(key)
    if (!unresolvedHold()) return checked
    const local = localHeld()
    return { ...local, holds: distinctHolds([...local.holds, ...checked?.holds || []]) }
  }
  // The first reason found for a record is its reason.
  const distinctHolds = holds => holds.filter((hold, i) => holds.findIndex(other => other.id === hold.id) === i)
  function checkedBlock(key) {
    if (!runtime) return null
    if (runtime.reviewStatus?.state === 'unavailable') return { note: 'Could not verify the current review. Try again; nothing was sent.' }
    if (ledgerIncomplete()) return { note: LEDGER_NOTE }
    if (!authoritative(key)) return null
    if (runtime.connection !== 'connected') return { note: 'Connect GitHub in Möbius Settings → Accounts to send.', account: 'connect' }
    // Without server-side binding of the confirmed snapshot, or a review check
    // addressed to these exact records, chat never sends.
    if (runtime.frozenBinding !== true || !Array.isArray(runtime.reviewStatus?.addressed)) return { note: NEWER_NOTE }
    const ids = idsFor(key)
    const ready = readyUnits(key)
    // The action covers every record the card shows or none: with some units
    // ready, each pending record must be in the exact phase this Confirm would
    // send. A deferred stack layer holds the card too.
    const confirmed = new Set(ready.flatMap(unit => unit.ready.map(record => record.id)))
    const holds = units(key).flatMap(unit => unitHolds(key, unit, ids.filter(id => !confirmed.has(id)
      && (unit.records.some(record => record.id === id) || unit.key === `record:${id}`))))
    if (holds.length) return { ...holds[0], holds }
    return ready.length ? null : { note: '' }
  }
  // The blockers of one publication unit, among its held records the card
  // lists. Every record blocked for a reason of its own is one (a relay
  // record, a failed check, an unsized change). A stack the card lists only
  // in part, or one that is structurally incomplete, is one blocker shown on
  // its first listed layer. A record held only because another member of the
  // same unit is blocked (a sized parent of an unsized layer) shows nothing.
  function unitHolds(key, unit, held) {
    if (!held.length) return []
    const now = current()
    const own = id => {
      const record = now.get(id)
      if (!record) return HOLD.gone
      if (relayed(record)) return HOLD.relay
      return holdFor(sendBlocker(record, reviewStateFor(record, runtime.reviewStatus), { requireCheck: true }))
        || (locked(unit) ? HOLD.checking : '') || (sized(record) && identified(record) ? '' : HOLD.check)
    }
    const holdOne = id => {
      const record = now.get(id)
      const pill = own(id) || holdFor(unit.reason) || (unit.ready.some(member => member.id === id) ? HOLD.attention : HOLD.later)
      // The code the agent is asked to fix: the record's own, or an incomplete
      // size or identity. A record whose send is still being checked, or one
      // that only waits for its turn in a stack, has none.
      const code = holdCode(record, reviewStateFor(record, runtime.reviewStatus))
        || (pill === HOLD.check && !uncertainPublication(record) ? 'restage' : '')
      // A check that can be retried says so; the row keeps its pill.
      return { id, pill: (pill === HOLD.source && CODE_PILL[code]) || pill, code, note: unit.reason === RETRY_CHECK_REASON ? RETRY_CHECK_REASON : '' }
    }
    const blockers = held.filter(own)
    if (blockers.length) return blockers.map(holdOne)
    // A stack that cannot be sent as a whole says why, on its first listed
    // layer: layers missing from the card or the ledger, a merged or changed
    // parent the remaining layers must be rebuilt on, or a chain no chat repair
    // fits (no ask; the action opens Contribute).
    const structural = unlisted(key, unit) ? 'incomplete' : unit.stackCode
    if (structural) return [{ id: held[0], ...STACK_HOLDS[structural], note: '' }]
    return [holdOne(held[0])]
  }


  // Before a tap, from the records alone: the first row that holds the card.
  // An unresolved record leads (the action reads again first); every record
  // held by its own fields is listed too.
  function localHeld() {
    const holds = [...unresolvedHold()?.holds || [], ...entries().filter(item => item.kind === 'pending' && (item.record.status === 'submitting' || localHold(item.record)))
      .map(entry => ({ id: entry.id, pill: entry.record.status === 'submitting' ? HOLD.sending : localHold(entry.record),
        code: entry.record.status === 'submitting' ? '' : localCode(entry.record) }))]
    return holds.length ? { ...holds[0], holds } : null
  }

  // An unknown outcome is still being checked until its window has passed, or
  // until observation concluded for each of its records (a changed target, or
  // an update Autopilot owns): those stay locked but are no longer checked.
  const concluded = attempt => attempt.ids.every(id => isPublished(current().get(id)) || CONCLUDED.has(findingOf(id)))
  const checkingAttempt = attempt => attempt.state === 'unknown' && now() - attempt.at < RECHECK_WINDOW_MS && !concluded(attempt)
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
      const [status, statusTone] = PULL_STATUS[record.status] || ['', 'neutral']
      return { status, statusTone, links: [{ label: `#${pull.number}`, url: pull.url }] }
    }
    if (attempt?.state === 'unknown') {
      // The card's action asks for its repair (fixFor, `publication_changed`).
      if (findingOf(id) === 'changed') return { status: CHANGED_PILL, statusTone: 'attention' }
      if (findingOf(id) === 'autopilot') return { status: AUTOPILOT_PILL }
      return checkingAttempt(attempt) ? { status: 'Checking GitHub', busy: true } : { status: 'Not confirmed' }
    }
    const failed = rowFailure(id)
    if (failed) return { status: 'Not sent', statusTone: failed.state === 'failed' ? 'attention' : 'neutral' }
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
    // A record that could not be read has no title to show; its id is not one.
    const fallback = kind === 'unread' ? 'Couldn’t load this contribution' : kind === 'missing' ? 'Contribution no longer in Contribute' : id
    const lines = drawsLines ? lineCounts(record?.plan) : null
    const row = { title: text(record?.plan?.title || record?.title || fallback, 120), meta: record ? rowMeta(record, { linesApart: Boolean(lines) }) : '',
      ...(lines ? { lines } : {}), intent: `review:${id}` }
    if (kind === 'missing') return { ...row, pill: HOLD.gone, tone: 'attention' }
    if (kind === 'unread') return { ...row, pill: HOLD.unread }
    if (kind === 'dismissed') return { ...row, pill: record.status === 'abandoned' ? 'Dismissed' : 'Replaced' }
    const state = rowState(id)
    if (state) return { ...row, pill: state.status, tone: state.statusTone || 'neutral', busy: state.busy === true, links: state.links || [] }
    if (record.status === 'submitting') return { ...row, pill: HOLD.sending, busy: true }
    const held = hold?.holds?.find(item => item.id === id)
    return held ? { ...row, pill: held.pill, tone: 'attention' } : row
  }
  function ownRowsReport(key, head) {
    if (folded()) return []
    const hold = sendKey(key) ? heldNow(key) : null
    const rows = entries().map(entry => rowFor(entry, hold)).slice(0, 12)
    // One state, said once: when every row carries the same state and the
    // header already says it (a shared send or check, or a title that is the
    // pill), the rows drop it. A row whose state differs keeps its pill.
    const shared = rows.length && rows.every(row => row.pill && row.pill === rows[0].pill && !row.links?.length)
    return shared && (head.titleBusy || head.title === rows[0].pill || head.covers === rows[0].pill)
      ? rows.map(({ pill: _pill, tone: _tone, busy: _busy, ...row }) => row) : rows
  }

  // ---- The header says what the card stands at.
  function heading(key) {
    if (folded()) return { title: CONTINUED_TITLE }
    if (!tracks() || firstRead()) return { title: '' }
    const list = entries()
    const pending = list.filter(entry => entry.kind === 'pending')
    const sent = list.filter(entry => entry.kind === 'sent')
    const counted = list.filter(entry => entry.kind !== 'dismissed')
    // Only a send or a check still underway is "Sending"; an expired check
    // says the result is not confirmed (or how many were sent).
    const inFlight = counted.filter(entry => !isPublished(current().get(entry.id)) && (latestAttempt(entry.id)?.state === 'sending'
      || (latestAttempt(entry.id) && checkingAttempt(latestAttempt(entry.id)))))
    // A send still underway says Sending; once every one has left and only
    // GitHub's answer is awaited, the card says so.
    if (inFlight.length) {
      const leaving = inFlight.filter(entry => latestAttempt(entry.id)?.state === 'sending').length
      const checking = inFlight.length - leaving
      const title = !leaving ? 'Checking GitHub…' : checking ? `Sending ${leaving} · checking ${checking}…` : `Sending ${leaving}…`
      return { title, titleBusy: true }
    }
    if (!counted.length) return { title: list.length ? 'Nothing left to send' : 'No contributions' }
    if (sent.length === counted.length) {
      const opened = attempts.some(attempt => attempt.ids.some(id => sent.some(entry => entry.id === id)))
      const prs = sent.every(entry => entry.record.plan?.action === 'pr')
      const count = sent.length
      const title = prs ? opened ? count === 1 ? 'Pull request opened' : `${count} pull requests opened` : count === 1 ? '1 pull request' : `${count} pull requests`
        : count === 1 ? 'Contribution sent' : `${count} contributions sent`
      // Success only on the live card and only when none was closed unmerged:
      // a history card stays neutral.
      return { title, titleTone: newest() && sent.every(entry => entry.record.status !== 'closed') ? 'success' : 'neutral' }
    }
    const unknown = pending.filter(entry => latestAttempt(entry.id)?.state === 'unknown')
    if (unknown.length) {
      if (unknown.every(entry => findingOf(entry.id) === 'autopilot')) return { title: sent.length ? `${sent.length} of ${counted.length} sent` : AUTOPILOT_PILL, covers: AUTOPILOT_PILL, titleTone: 'neutral' }
      const changed = unknown.some(entry => findingOf(entry.id) === 'changed')
      // An unconfirmed result is not a failure: it is counted as not confirmed.
      const unconfirmed = unknown.filter(entry => findingOf(entry.id) !== 'autopilot').length
      return { title: sent.length ? `${sent.length} of ${counted.length} sent · ${unconfirmed} not confirmed` : changed ? CHANGED_PILL : 'Not confirmed yet', covers: changed ? CHANGED_PILL : 'Not confirmed', titleTone: 'attention' }
    }
    // What holds the card, each counted for real and said as what it is: a
    // blocked GitHub account is the owner's, a record that could not be read
    // only needs reading again, and only the rest need a fix. The rows show
    // the same holds (rowFor).
    const hold = sendKey(key) ? heldNow(key) : null
    const holds = hold?.holds || []
    const account = sendKey(key) ? blocked(key)?.account || (holds.some(item => ACCOUNT_CODES.has(item.code)) ? 'reconnect' : '') : ''
    const unreadCount = list.filter(entry => entry.kind === 'unread').length
    const fixIds = new Set([...pending.filter(entry => rowFailure(entry.id) && !ACCOUNT_CODES.has(rowFailure(entry.id).code)).map(entry => entry.id),
      ...holds.filter(item => !WAITING.has(item.pill) && !ACCOUNT_CODES.has(item.code)).map(item => item.id)])
    const parts = [
      account ? account === 'connect' ? 'GitHub not connected' : 'Reconnect GitHub' : '',
      fixIds.size ? `${fixIds.size} ${fixIds.size === 1 ? 'needs' : 'need'} a fix` : '',
      unreadCount ? `couldn’t load ${unreadCount}` : '',
    ].filter(Boolean)
    const tone = account || fixIds.size ? 'attention' : 'neutral'
    if (sent.length) return { title: [`${sent.length} of ${counted.length} sent`, ...parts].join(' · '), titleTone: tone }
    if (parts.length) {
      const title = parts.join(' · ')
      return { title: title[0].toUpperCase() + title.slice(1), titleTone: tone }
    }
    // Readiness is claimed only once the tap's check found it: while that
    // check runs the header says so; otherwise (saved, loading, before a
    // tap) the header is a neutral count.
    if (sendKey(key) && activating === key) return { title: 'Checking contributions', titleBusy: true }
    if (sendKey(key) && frozen?.key === key) return { title: `${frozen.units.flatMap(unit => unit.ready).length} ready to send` }
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

  // What the card's held action asks of this chat's agent (`ask-v1`): the
  // held record and its code, or the GitHub account, which only the owner
  // can fix. Nothing when the action would not only open Contribute.
  function fixFor({ hold, before, found, expired, list }) {
    if (!asks || fault) return null
    if (found?.account) return { account: found.account }
    if (expired) {
      const unknown = list.filter(item => item.kind === 'pending' && latestAttempt(item.id)?.state === 'unknown')
      // A target that changed asks for its own repair; a row Autopilot owns
      // asks nothing. Any other unconfirmed result asks the agent to check it.
      const changed = unknown.find(item => findingOf(item.id) === 'changed')
      if (changed) return { id: changed.id, code: PUBLICATION_CHANGED }
      const entry = unknown.find(item => findingOf(item.id) !== 'autopilot')
      return entry ? { id: entry.id, code: 'result_unknown', attempt: latestAttempt(entry.id) } : null
    }
    const held = hold || before
    if (!held?.code) return null
    return ACCOUNT_CODES.has(held.code) ? { account: 'reconnect' } : { id: held.id, code: held.code }
  }

  // One action's state, and for the card's own action the ask it reports.
  function cardAction(item) {
    const key = item.key
    if (folded()) return { state: { ...quiet, key, label: item.label || 'Contribute', disabled: true, hidden: true, open: false, note: '' } }
    if (!attested()) return { state: unattestedAction(item) }
    if (key !== card?.key || !ours()) return { state: statusAction(item) }
    const sendable = newest()
    const ids = idsFor(key)
    const list = entries()
    const mine = attempts.filter(attempt => attempt.ids.some(id => list.some(entry => entry.id === id)))
    const busy = mine.some(attempt => attempt.state === 'sending')
    const unknown = !busy && mine.some(attempt => attempt.state === 'unknown')
    // Still checking: a calm, disabled "Checking…". Past the window, the agent
    // is asked to check it (`ask-v1`), or the action opens Contribute.
    const checkingResult = unknown && mine.some(checkingAttempt)
    const nothingLeft = !list.some(entry => entry.kind === 'pending' || entry.kind === 'missing' || entry.kind === 'unread')
    const failure = mine.filter(attempt => ['failed', 'not_attempted'].includes(attempt.state) && attempt.ids.some(id => ids.includes(id))).at(-1)
    const confirming = frozen?.key === key
    const checking = activating === key
    const loading = (hints.some(id => reading.has(id)) || firstRead()) && !list.length
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
      : retry ? 'Try again' : failure ? 'Retry' : ids.length > 1 ? `Send ${ids.length}` : 'Send'
    // Rows carry each record's state as a pill; one line of text says what a
    // pill cannot: a check to retry, the account, an older Möbius, or why the
    // last send was refused.
    const note = busy || checkingResult || unknown ? '' : text(fault || (checking ? '' : refreshNote) || reason || failure?.note)
    const state = {
      ...quiet, key, label,
      disabled: !openOnly && (busy || checkingResult || checking || loading || sending() || Boolean(frozen) && !confirming || Boolean(reason) && !retry),
      busy: busy || checkingResult,
      open: openOnly,
      confirming,
      confirmation: confirming ? frozen.units.flatMap(unit => unit.ready.map(confirmationItem)) : null,
      // While the tap's check, a send or GitHub's answer is underway the
      // header says so; the action slot is empty rather than a disabled
      // button. The action keeps its busy state for the host's locking.
      hidden: (busy || checkingResult || checking) && !fault
        || nothingLeft && !busy && !unknown && !confirming && !fault && !retry && !loading && !firstRead(),
      note,
    }
    const fix = openOnly && sendable ? fixFor({ hold, before, found, expired: unknown && !checkingResult, list }) : null
    // A send Autopilot now owns asks nothing of the owner: no action at all
    // (the header already opens Contribute).
    const autopilotOnly = unknown && !checkingResult && list.filter(item => item.kind === 'pending' && latestAttempt(item.id)?.state === 'unknown')
      .every(item => findingOf(item.id) === 'autopilot')
    if (autopilotOnly && !fix) return { state: { ...state, hidden: true } }
    // The account is the owner's: the action opens it, named, in Contribute.
    if (fix?.account) return { state: { ...state, label: fix.account === 'connect' ? 'Connect GitHub' : 'Reconnect GitHub', note: '' } }
    if (!fix) return { state }
    // The host draws the ask in this action's place. The action stays as it
    // was, so a host that does not draw this ask still opens Contribute.
    return { state, ask: cardAsk(fix.id, fix.code, askRev(fix.id, fix.code, current().get(fix.id) || null, fix.attempt)) }
  }

  // Re-read an unknown outcome on a backoff; reads never send.
  function scheduleRecheck() {
    if (!alive) return
    const open = attempts.filter(checkingAttempt)
    // Nothing left to check (settled, or concluded by observation): drop a
    // recheck scheduled before the answer arrived.
    if (!open.length) { if (recheckTimer !== null) timers.clear(recheckTimer); recheckTimer = null; return }
    if (recheckTimer !== null) return
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
      // The app's own refresh path re-reads the ledger and review status;
      // observation asks GitHub, through the platform, what became of it.
      if (runtime && !runtime.refreshing) Promise.resolve().then(() => runtime.refresh?.()).catch(() => {})
      void read(ids).then(observeUnknown)
    }, delay)
  }

  // Ask the platform to read GitHub for each record of an unknown send, once
  // at a time (the shared observer dedupes and backs off). Only reads: a
  // settled answer brings the saved record, nothing else changes the ledger.
  async function observeUnknown() {
    if (observeOff || observing || !alive) return
    const asked = new Map()
    for (const id of new Set(attempts.filter(attempt => attempt.state === 'unknown').flatMap(attempt => attempt.ids))) {
      const record = current().get(id)
      if (record && !isPublished(record) && !STOPPED.has(findingOf(id, record))) asked.set(id, record)
    }
    if (!asked.size) return
    observing = true
    let answers
    try { answers = await Promise.all([...asked.values()].map(record => Promise.resolve().then(() => observe(record)).catch(() => null))) } finally { observing = false }
    if (!alive) return
    ;[...asked].forEach(([id, record], index) => {
      const answer = answers[index]
      if (answer?.outcome === 'unsupported') { observeOff = true; return }
      // Only an answer about the record as it still is: a newer read wins.
      const version = publicationVersion(record)
      if (!answer || (answer.version ?? version) !== version || publicationVersion(current().get(id)) !== version) return
      // A settlement is newer than every exact read already in flight.
      if (answer.outcome === 'settled' && answer.record?.id === id) { landExact(id, issueRead(id), { record: answer.record }); findings.delete(id) }
      else if (['pending', 'changed'].includes(answer.outcome)) findings.set(id, { version, outcome: answer.outcome })
      // The platform does not observe Autopilot's own update; whether this
      // record is Autopilot's comes from the record, not from that answer.
      else if (answer.outcome === 'not_eligible') findings.set(id, { version, outcome: isAutopilotEnabled(record) ? 'autopilot' : 'ineligible' })
    })
    settle(); emit()
  }

  function emit() {
    if (!alive) return
    let data = null
    try { data = encodeCheckpoint(attempts) } catch { fault = 'This card has too many unresolved results. Open Contribute to check them.' }
    if (fault) data = lastCheckpoint?.data ?? null
    if (data !== (lastCheckpoint?.data ?? null)) lastCheckpoint = data ? { id: crypto.randomUUID(), data } : null
    const key = card?.key || ''
    const head = heading(key)
    const { title = '', titleTone = 'neutral', titleBusy = false } = head
    const reports = advertised.map(cardAction)
    const ask = reports.find(report => report.ask)?.ask || null
    publish({
      sessionId, actions: reports.map(report => report.state), title,
      ...(asks ? { ask } : {}),
      // Rows only for the chat the host attests; otherwise the card's own
      // fallback rows stay, and nothing is read.
      ...(tracks() ? { ...(firstRead() ? {} : { rows: ownRowsReport(key, head) }), titleTone, titleBusy } : {}),
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

  // One ordering for every exact result of a record, read or observed: each
  // result is issued a generation, and only the newest issued one lands. An
  // older result still on its way (a stale copy, a missing or a failed read)
  // is dropped.
  function issueRead(id) {
    const generation = (generations.get(id) || 0) + 1
    generations.set(id, generation)
    return generation
  }
  function landExact(id, generation, { record, failed }) {
    if (generations.get(id) !== generation) return
    reading.delete(id)
    if (record?.id === id) { exact.set(id, record); unreadable.delete(id); absent.delete(id); return }
    if (failed) { unreadable.add(id); absent.delete(id); return }
    // An authoritative read found it gone: forget any earlier copy.
    exact.delete(id); unreadable.delete(id); absent.add(id)
  }

  // Newest-issued exact result wins per record; reads never send.
  async function read(ids) {
    if (!ids.length) return
    lastRead = now()
    const issued = ids.map(id => { reading.add(id); return issueRead(id) })
    const results = await Promise.all(ids.map(id => Promise.resolve().then(() => loadExact(id)).then(record => ({ record }), () => ({ failed: true }))))
    if (!alive) return
    ids.forEach((id, index) => landExact(id, issued[index], results[index]))
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
    // A restored unknown send is observed once its records are read, even
    // past its window: the answer can settle it without the owner.
    start() { emit(); void readCard().then(observeUnknown) },
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
      // A record that changed since its last answer is observed afresh.
      void readCard().then(observeUnknown)
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
