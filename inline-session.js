// The in-chat Send session behind a Contribute card. Pure state: the host
// renders the controls, this model says what each one may do. Reading never
// sends; only the owner's Confirm of a frozen snapshot reaches the app's
// guarded Send handlers, which bind that snapshot on the server.
//
// Each Confirm creates immutable attempts, one per independent unit. Units run
// in parallel; a stack's layers are sent in order by its one stack request.
// Only attempts whose outcome is unknown cross a reload, and they lock their
// unit until a read-only observation proves the result.
import { sendTarget } from './chat-blocks.js'
import { planScreenshots, screenshotCountText } from './domain.js'
import { isPublished, publicationUnits, publishedPull } from './send-readiness.js'
import { stackMeta } from './stack.js'

const copy = value => JSON.parse(JSON.stringify(value))
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const CHECKPOINT_BYTES = 32768
const MAX_ATTEMPTS = 24
const UNRESOLVED = new Set(['sending', 'unknown'])
const UNKNOWN_NOTE = 'The result is not confirmed yet. Check Contribute before trying again.'
export const LEDGER_NOTE = 'Could not read every contribution. Open Contribute to send.'
export const TIMEOUT_NOTE = 'Contribute didn’t answer in time. Try again.'
export const REFRESH_FAILED_NOTE = 'Contribute couldn’t check this right now. Try again.'
export const NEWER_NOTE = 'Sending from chat needs a newer Möbius. Open Contribute to send.'
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

// The first line of prose in a PR description (headings skipped), as plain
// bounded text.
export function descriptionExcerpt(body, max = 160) {
  // Skip HTML comments (also across lines) and fenced code blocks; prefer
  // prose over headings.
  // Image-only lines and table rows are skipped and inline images become their
  // alt text, so a before/after screenshot never shows as raw
  // ![...](screenshot:...) markup.
  let fenced = false
  const lines = String(body || '').replace(/<!--[\s\S]*?(-->|$)/g, '').split('\n').map(value => value.trim())
    .filter(value => {
      if (/^(```|~~~)/.test(value)) { fenced = !fenced; return false }
      return !fenced
    })
    .map(value => /^\|.*\|$/.test(value) || /^(\s*!\[[^\]]*\]\([^)]*\))+\s*$/.test(value) ? ''
      : value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
    .filter(Boolean)
  const prose = lines.find(value => !/^#+\s/.test(value)) || lines[0] || ''
  // Strip a block marker only when it is one (followed by whitespace), so
  // emphasis such as **Summary** stays intact.
  const line = prose.replace(/^(#+|[-*+>]|\d+\.)\s+/, '').trim()
  return line.length <= max ? line : line.slice(0, max - 1).trimEnd() + '…'
}

// ---- The app-sourced identity Confirm shows for each frozen record.
export function confirmationItem(record) {
  const plan = record.plan || {}
  const meta = stackMeta(record)
  // The card's own per-contribution facts (Project, Change) come first, with
  // the same values, then the exact identity this Confirm binds.
  const facts = [
    ['Project', plan.repo || record.repo],
    ...(changeSize(plan) ? [['Change', changeSize(plan)]] : []),
    ...(meta ? [['Stack', `Layer ${meta.position} of ${meta.total} · ${meta.name}`]] : []),
    ['Action', plan.action === 'pr_update' ? `Update pull request #${record.number}` : 'Open a new pull request'],
    ['Branch', meta ? `${plan.branch || record.branch} → ${meta.baseBranch}` : plan.branch || record.branch],
    ['Version', String(plan.head_sha || '').slice(0, 12)],
    ['Reviewed diff', String(plan.diff_sha256 || '').slice(0, 12)],
    ['Review', 'All clear for this version'],
  ]
  // Screenshots are published with the PR, so Confirm always names them, on
  // the Change line: the fact budget stays free for the description excerpt.
  const screenshots = planScreenshots(plan).length
  const change = facts.findIndex(([label]) => label === 'Change')
  if (screenshots && change >= 0) facts[change] = ['Change', `${facts[change][1]} · ${screenshotCountText(screenshots)}`]
  else if (screenshots) facts.splice(1, 0, ['Change', screenshotCountText(screenshots)]) // after Project, as on the card
  // The public text the owner publishes: the PR title is the item's heading,
  // and the description's first line is shown when the 8-fact limit allows.
  const excerpt = descriptionExcerpt(plan.body_draft)
  if (excerpt && facts.length < 8) facts.splice(facts.length - 1, 0, ['Description', excerpt])
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
export const UNLISTED_LAYER_NOTE = 'This card doesn’t list every layer of the stack. Open Contribute to send it.'
export const SIZE_NOTE = 'This contribution needs a fresh check in Contribute before it can be sent: its change size is missing.'
const confirmable = record => !relayed(record) && sized(record) && confirmationItem(record).facts.every(fact => fact.value)

const PUBLIC_LABELS = { draft: 'Draft', open: 'Open', landing: 'Open', merged: 'Merged', closed: 'Closed' }

export function createInlineSession({ sessionId, actions, items = null, checkpoint = null, retain = false, recoveryError = false, publish, loadExact, onNeedRuntime }) {
  const advertised = [...new Map((actions || []).filter(item => typeof item?.key === 'string').map(item => [item.key, item])).values()]
  // The card's items name its records; its one action covers exactly them.
  const targets = new Map(advertised.map(item => [item.key, sendTarget(item.key, items)]))
  const idsFor = key => targets.get(key)?.ids || []
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

  const allIds = () => [...new Set([...advertised.flatMap(item => idsFor(item.key)), ...attempts.flatMap(attempt => attempt.ids)])]
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
  // Readiness is decided only from a complete ledger, a current review check,
  // a known connection and finished exact reads of everything this card names.
  const authoritative = key => Boolean(runtime?.ledgerReady) && runtime.reviewStatus?.state === 'ready'
    && runtime.connection !== 'checking' && !reading.size && !idsFor(key).some(id => unreadable.has(id))

  function blockedReason(key) {
    // A host that does not send the card's items cannot say which records the
    // action covers, so nothing is confirmable from here.
    if (targets.get(key)?.needsItems) return NEWER_NOTE
    if (targets.get(key)?.invalid) return 'This card no longer matches its listed contributions. Open Contribute to send them.'
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
    if (readyUnits(key).length) return ''
    if (all.some(unit => unit.ready.length && !unit.ready.every(sized))) return SIZE_NOTE
    return all.map(unit => unit.reason).find(Boolean) || (all.some(locked) ? UNKNOWN_NOTE : '')
  }

  function actionState(item) {
    const key = item.key
    const ids = idsFor(key)
    const now = current()
    const records = ids.map(id => now.get(id))
    const mine = attempts.filter(attempt => attempt.ids.some(id => ids.includes(id)))
    const busy = mine.some(attempt => attempt.state === 'sending')
    const unknown = !busy && mine.some(attempt => attempt.state === 'unknown')
    const published = records.length > 0 && records.every(isPublished)
    const failure = published ? null : mine.filter(attempt => ['failed', 'not_attempted'].includes(attempt.state)).at(-1)
    const confirming = frozen?.key === key
    const checking = activating === key
    const loading = ids.some(id => !now.has(id) && reading.has(id))
    // A failed check or read can be retried; retrying only reads again.
    const retry = runtime?.reviewStatus?.state === 'unavailable' || ids.some(id => unreadable.has(id)) || ledgerIncomplete() || Boolean(refreshNote)
    const reason = fault || blockedReason(key)
    const label = busy ? 'Contributing…' : checking ? 'Checking…' : loading ? 'Loading…'
      : unknown && ids.length === 1 ? 'Check again' : retry ? 'Try again' : item.label || 'Contribute'
    const status = fault ? 'Needs attention' : busy ? 'Contributing' : unknown ? 'Checking result' : failure ? 'Needs attention'
      : published ? (records.length === 1 ? PUBLIC_LABELS[records[0].status] || 'Sent' : 'Sent')
      : checking ? 'Checking' : reason ? 'Needs attention' : ''
    const tone = fault || failure ? 'danger' : unknown || reason ? 'attention' : published ? 'success' : 'neutral'
    return {
      key, label,
      disabled: Boolean(fault) || busy || checking || loading || sending() || Boolean(frozen) && !confirming
        || Boolean(reason) && !retry && !unknown,
      busy,
      confirming,
      confirmation: confirming ? frozen.units.flatMap(unit => unit.ready.map(confirmationItem)) : null,
      hidden: published && !busy && !confirming,
      note: text(fault || (unknown ? UNKNOWN_NOTE : '') || failure?.note || (activating === key ? '' : refreshNote) || reason),
      tone, status, statusTone: tone,
      links: records.filter(isPublished).map(record => ({ label: `View PR #${publishedPull(record).number}`, url: publishedPull(record).url })),
      badges: records.length === 1 && records[0]?.status === 'prepared' && !reason ? [{ label: 'All clear', tone: 'success' }] : [],
    }
  }

  function summary() {
    const batch = advertised.find(item => targets.get(item.key)?.kind === 'batch')
    if (!batch) return ''
    const now = current()
    const records = idsFor(batch.key).map(id => now.get(id))
    const sent = records.filter(isPublished).length
    const prepared = records.filter(record => record?.status === 'prepared').length
    return [sent && `${sent} sent`, prepared && `${prepared} prepared`].filter(Boolean).join(' · ')
  }

  function emit() {
    if (!alive) return
    let data = null
    try { data = encodeCheckpoint(attempts) } catch { fault = 'This card has too many unresolved results. Open Contribute to check them.' }
    if (fault) data = lastCheckpoint?.data ?? null
    if (data !== (lastCheckpoint?.data ?? null)) lastCheckpoint = data ? { id: crypto.randomUUID(), data } : null
    publish({
      sessionId, actions: advertised.map(actionState), summary: summary(),
      retain: Boolean(fault || lastCheckpoint || frozen || activating || sending()),
      checkpoint: lastCheckpoint, checkpointAck, recoveryError: Boolean(fault), ackNonce,
    })
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
    const results = await Promise.all(ids.map(id => Promise.resolve().then(() => loadExact(id)).catch(() => null)))
    if (!alive) return
    ids.forEach((id, index) => {
      if (generations.get(id) !== issued[index]) return
      reading.delete(id)
      if (results[index]?.id === id) { exact.set(id, results[index]); unreadable.delete(id) } else unreadable.add(id)
    })
    settle(); emit()
  }

  function activate(key) {
    if (fault || sending() || frozen) return
    activating = key
    awaitDone = -1
    awaitLegacy = false
    refreshNote = ''
    if (!runtime) onNeedRuntime?.()
    // A failed check or an incomplete ledger is read again by the app (one
    // refresh at a time); the card waits until that refresh completes.
    else if (runtime.reviewStatus?.state === 'unavailable' || ledgerIncomplete()) {
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
    const at = Date.now()
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
    dispose() { alive = false },
  }
}
