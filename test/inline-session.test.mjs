import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHAT_INTENT, batchHandle, cardKind, hintedIds, inChat } from '../chat-blocks.js'
import { frontendModules, renderModule } from './render-harness.mjs'
import { connectInlineSession, readBlockSession } from '../block-protocol.js'
import { reviewAddressFor } from '../send-readiness.js'
import { createPublicationObserver, TRANSPORT_BACKOFF_MS } from '../publication-observer.js'
import { attemptOutcome, AUTOPILOT_PILL, CHANGED_NOTE, CHANGED_PILL, PUBLICATION_CHANGED, confirmationItem, CONTINUED_TITLE, HOLD, LEDGER_NOTE, NEWER_NOTE, UNREAD_NOTE, RECHECK_DELAYS_MS, RECHECK_WINDOW_MS, RECOVERY_NOTE,
  REFRESH_FAILED_NOTE, REVIEW_REUSE_MS, TIMEOUT_NOTE, UNCHECKED_NOTE, VISIBLE_REREAD_MS, createInlineSession, decodeCheckpoint, encodeCheckpoint, localHold, observeAttempt, rowMeta } from '../inline-session.js'

const HEAD = 'a'.repeat(40), NEXT = 'c'.repeat(40)
// The chat the host attests the card is in, and another one.
const CHAT = '00000000-0000-4000-8000-00000000c4a7', OTHER = '9b1c7a52-0d3e-4f1a-8c55-2e6f4b7d9a10'
// The card's action in model tests; the model never resolves it against the
// items (only a host without rows-v2, through inline-session-v1.js, does).
const KEY = 'chat-send-batch:0000000000000000'
// The action prepared_block.py prints for these records.
const printedKey = ids => ids.length === 1 ? `chat-send:${ids[0]}` : `chat-send-batch:${batchHandle(ids)}`
function prepared(id, extra = {}) {
  const head = extra.head || HEAD
  return { id, type: 'pr', status: 'prepared', repo: 'owner/repo', updated_at: '2026-10-20T10:00:00Z', chat_id: CHAT, chat_ids: [CHAT],
    // As staging records it: `git diff --shortstat` of the reviewed change.
    plan: { action: 'pr', repo: 'owner/repo', title: `Change ${id}`, branch: `fix/${id}`, head_sha: head, diff_sha256: 'd'.repeat(64), diff_stat: ' 1 file changed, 2 insertions(+)', ...extra.plan },
    quality_review: { state: 'all_clear', reviewed_head_sha: head }, ...extra.record }
}
function layer(id, position, parent, status = 'prepared') {
  return prepared(id, { record: { status, ...(status === 'open' ? { number: 40 + position, url: `https://github.com/owner/repo/pull/${40 + position}` } : {}) },
    plan: { branch: `stack/s1/0${position}`, base_sha: parent ? HEAD : undefined,
      stack: { id: 's1', name: 'Stack', position, total: 2, base_branch: parent ? 'stack/s1/01' : 'main', ...(parent ? { parent_record_id: parent } : {}) } } })
}
const published = (record, number = 7) => ({ ...record, status: 'open', number, url: `https://github.com/owner/repo/pull/${number}`, updated_at: '2026-10-20T11:00:00Z' })
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

// The review status the real server returns: rows only for the records the app
// addressed (#1911), which is what the app asks for via reviewAddressFor.
function serverReviewStatus(addressed, store) {
  const ids = addressed.filter(id => store.get(id)?.status === 'prepared')
  return { state: 'ready', addressed, byId: Object.fromEntries(ids.map(id => [id, { state: 'ready' }])) }
}
// The item intents the host sends with the session (`init.items`).
const reviewItems = ids => ids.map(id => ({ intent: `review:${id}` }))
// The card prepared_block.py prints: one action, the records as fallback items.
const card = ids => ({ actions: [{ key: KEY, label: ids.length === 1 ? 'Contribute' : 'Contribute all' }], items: reviewItems(ids) })
// A current host draws the app's rows and attests the chat; pass `features`
// or `context` to model an older host or another chat.
function harness({ ids = null, actions = card(ids).actions, items = card(ids || []).items, features = ['row-state', 'rows-v2'], context = { chatId: CHAT, latest: true, intent: CHAT_INTENT },
  records, checkpoint = null, retain = false, send, sendStack, address = null, loadExact = null, observe = null, runtime: extra = {}, timers, now }) {
  const store = new Map(records.map(record => [record.id, record]))
  const states = [], sends = [], needs = [], reads = []
  // Every envelope goes through the app's own protocol parser, as in the frame.
  const parse = envelope => readBlockSession({ sessionId: 'session-1', generation: 1, actions: actions || [], ...envelope })
  const session = createInlineSession({ ...parse({ items, features, context, checkpoint, retain }), publish: state => states.push(structuredClone(state)),
    loadExact: id => { reads.push(id); return loadExact ? loadExact(id, store) : Promise.resolve(store.has(id) ? structuredClone(store.get(id)) : null) },
    onNeedRuntime: ids => needs.push(ids), ...(observe ? { observe: record => observe(record, store) } : {}), ...(timers ? { timers, now } : {}) })
  const update = session.update
  session.update = envelope => update(parse({ items, features, ...envelope }))
  const runtime = () => ({ records: [...store.values()], ledgerReady: true, connection: 'connected', frozenBinding: true,
    reviewStatus: serverReviewStatus(address || reviewAddressFor(needs.at(-1) || session.sendIds(), [...store.values()]), store),
    send: async rec => { sends.push({ kind: 'single', ids: [rec.id], records: [structuredClone(rec)] }); return send ? send(rec) : { ok: true } },
    sendStack: async recs => { sends.push({ kind: 'stack', ids: recs.map(rec => rec.id), records: structuredClone(recs) }); return sendStack ? sendStack(recs) : { ok: true } },
    refresh() {}, ...extra })
  let nonce = 0
  // KEY names this card's own action, whatever it is.
  const keyOf = key => key === KEY ? actions[0].key : key
  const fire = (key, event) => session.handleEvent({ sessionId: 'session-1', key: keyOf(key), event, nonce: `n${++nonce}` })
  const last = () => states.at(-1)
  const action = key => last().actions.find(item => item.key === keyOf(key))
  const provide = () => session.updateRuntime(runtime())
  // One row as the card reports it, by record id.
  const row = id => last().rows?.find(item => item.intent === `review:${id}`)
  const pills = () => last().rows.map(item => [item.intent.slice(7), item.pill || ''])
  return { session, store, states, sends, needs, reads, fire, last, action, provide, runtime, row, pills }
}
async function openConfirm(h, key = KEY) {
  h.session.start(); await tick()
  h.fire(key, 'activate'); await tick()
  assert.equal(h.needs.length > 0, true, 'activation asked for the publication runtime')
  h.provide(); await tick()
}

// ---- The card's set comes from the ledger, scoped to the attested chat.
test('the card shows each named record as a row from the ledger, and reading never sends', async () => {
  const h = harness({ ids: ['one', 'two'], records: [prepared('one', { plan: { diff_stat: ' 3 files changed, 142 insertions(+), 38 deletions(-)' } }), prepared('two')] })
  h.session.start(); await tick()
  assert.deepEqual(h.last().rows, [
    { title: 'Change one', meta: 'owner/repo · +142 −38', intent: 'review:one' },
    { title: 'Change two', meta: 'owner/repo · +2 −0', intent: 'review:two' }])
  assert.equal(h.last().title, '2 contributions')
  assert.equal(h.last().titleTone, 'neutral')
  assert.equal('items' in h.last(), false, 'the app\'s own rows replace the card\'s items')
  const state = h.action(KEY)
  assert.deepEqual([state.label, state.disabled, state.open, state.note], ['Contribute all', false, false, ''])
  assert.equal(h.sends.length, 0)
  assert.equal(h.needs.length, 0, 'reading the card needs no send runtime, so no GitHub or source check')
  assert.deepEqual([...new Set(h.reads)].sort(), ['one', 'two'], 'exact local reads only')
})

test('a record from another chat is never shown or sent, whatever the card names', async () => {
  const mine = prepared('mine'), theirs = prepared('theirs', { record: { chat_id: OTHER, chat_ids: [OTHER] } })
  const reconciled = prepared('reconciled', { record: { chat_id: OTHER, chat_ids: [OTHER, CHAT] } })
  const h = harness({ ids: ['mine', 'theirs', 'reconciled'], records: [mine, theirs, reconciled] })
  await openConfirm(h)
  assert.deepEqual(h.last().rows.map(row => row.intent), ['review:mine', 'review:reconciled'], 'chat_ids counts, another chat\'s record does not')
  assert.deepEqual(h.needs.at(-1), ['mine', 'reconciled'], 'only this chat\'s records are checked')
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Change mine', 'Change reconciled'])
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(send => send.ids).flat().sort(), ['mine', 'reconciled'])
  // The same card shown in the other chat covers only that chat's records.
  const there = harness({ ids: ['mine', 'theirs'], records: [mine, theirs], context: { chatId: OTHER, latest: true, intent: CHAT_INTENT } })
  there.session.start(); await tick()
  assert.deepEqual(there.last().rows.map(row => row.intent), ['review:theirs'])
  assert.equal(inChat(theirs, CHAT), false)
  assert.equal(inChat(mine, ''), false, 'no chat, no membership')
})

test('without the host\'s chat the card reads and shows no records, and never sends', async () => {
  for (const options of [{ context: null }, { features: ['row-state'] }, { features: [] }]) {
    const h = harness({ ids: ['one'], records: [prepared('one')], ...options })
    h.session.start(); await tick()
    h.fire(KEY, 'activate'); await tick()
    h.provide(); await tick()
    h.fire(KEY, 'confirm'); await tick()
    assert.deepEqual([h.reads, h.needs, h.sends], [[], [], []], JSON.stringify(options))
    assert.equal('rows' in h.last(), false, 'the card\'s own fallback rows stay')
    assert.equal(h.last().title, '')
    assert.equal(h.action(KEY).confirming, false)
  }
  const older = harness({ ids: ['one'], records: [prepared('one')], features: [] })
  older.session.start(); await tick()
  assert.deepEqual([older.action(KEY).disabled, older.action(KEY).open, older.action(KEY).note], [true, false, NEWER_NOTE])
  const rowState = harness({ ids: ['one'], records: [prepared('one')], features: ['row-state'] })
  rowState.session.start(); await tick()
  assert.deepEqual([rowState.action(KEY).open, rowState.action(KEY).label, rowState.action(KEY).note], [true, 'Open Contribute', ''])
})

test('a card in another intent group is never the live card, even with the live action', async () => {
  // The host computes `latest` per app and block intent: a fence that keeps
  // the action but changes its intent is newest of its own group only.
  const h = harness({ ids: ['one'], records: [prepared('one')], context: { chatId: CHAT, latest: true, intent: 'review:one' } })
  await openConfirm(h).catch(() => {})
  h.fire(KEY, 'activate'); await tick()
  h.provide(); await tick()
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual([h.needs, h.sends], [[], []])
  assert.deepEqual(h.pills(), [['one', '']], 'it still shows this chat\'s status')
  assert.equal(h.action(KEY).hidden, true)
})

test('a re-prepared record resolves through superseded_by to its successor, quietly', async () => {
  const old = prepared('v1', { record: { status: 'superseded', superseded_by: 'v2' } })
  const middle = prepared('v2', { record: { status: 'superseded', superseded_by: 'v3' } })
  const latest = prepared('v3', { plan: { title: 'Calmer in-chat send states', diff_stat: '2 files changed, 96 insertions(+), 24 deletions(-)' } })
  const h = harness({ ids: ['v1'], records: [old, middle, latest] })
  await openConfirm(h)
  assert.deepEqual(h.last().rows, [{ title: 'Calmer in-chat send states', meta: 'owner/repo · +96 −24', intent: 'review:v3' }])
  assert.deepEqual(h.needs.at(-1), ['v3'])
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Calmer in-chat send states'])
  // A loop or a dangling link never hangs the card.
  const loop = harness({ ids: ['a'], records: [prepared('a', { record: { status: 'superseded', superseded_by: 'b' } }), prepared('b', { record: { status: 'superseded', superseded_by: 'a' } })] })
  loop.session.start(); await tick(12)
  assert.deepEqual(loop.pills(), [['b', 'Replaced']])
  const dangling = harness({ ids: ['a'], records: [prepared('a', { record: { status: 'superseded', superseded_by: 'gone' } })] })
  dangling.session.start(); await tick(12)
  assert.deepEqual(dangling.pills(), [['a', HOLD.gone]], 'a successor that is gone is not a completed dismissal')
  assert.deepEqual([dangling.action(KEY).hidden, dangling.action(KEY).open], [false, true], 'it holds the card')
})

test('a dismissed record stays as a quiet row and drops out of the action', async () => {
  const h = harness({ ids: ['one', 'two'], records: [prepared('one'), prepared('two', { record: { status: 'abandoned' } })] })
  await openConfirm(h)
  assert.deepEqual(h.pills(), [['one', ''], ['two', 'Dismissed']])
  assert.equal(h.last().title, '1 contribution')
  assert.equal(h.action(KEY).label, 'Contribute')
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Change one'])
  const all = harness({ ids: ['two'], records: [prepared('two', { record: { status: 'abandoned' } })] })
  all.session.start(); await tick()
  assert.equal(all.last().title, 'Nothing left to send')
  assert.equal(all.action(KEY).hidden, true)
})

// ---- Newest card wins.
test('an earlier card folds to Continued below with no reads, and wakes if it becomes the newest again', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')], context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } })
  h.session.start(); await tick()
  assert.deepEqual([h.last().title, h.last().rows, h.action(KEY).hidden], [CONTINUED_TITLE, [], true])
  assert.deepEqual(h.reads, [], 'an earlier card reads nothing')
  h.session.refresh('turn'); h.fire(KEY, 'activate'); await tick()
  assert.deepEqual([h.reads, h.needs], [[], []], 'nor on a refresh hint or a tap')
  h.session.update({ context: { chatId: CHAT, latest: true, intent: CHAT_INTENT } }); await tick()
  assert.equal(h.last().title, '1 contribution')
  assert.deepEqual(h.reads, ['one'])
})

test('a card that a newer card follows drops its open Confirm and folds, but keeps an unresolved send', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')] })
  await openConfirm(h)
  assert.equal(h.action(KEY).confirming, true)
  h.session.update({ context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } }); await tick()
  assert.equal(h.action(KEY).confirming, false)
  assert.equal(h.last().title, CONTINUED_TITLE)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.length, 0, 'the dropped confirmation cannot be spent')
  // A card mid-send keeps showing that send until it settles.
  const gate = deferred()
  const busy = harness({ ids: ['one'], records: [prepared('one')], send: () => gate.promise })
  await openConfirm(busy)
  busy.fire(KEY, 'confirm'); await tick()
  busy.session.update({ context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } }); await tick()
  assert.equal(busy.last().title, 'Sending 1')
  assert.equal(busy.row('one').pill, 'Sending')
  // A different chat id for the same session is ignored.
  busy.session.update({ context: { chatId: OTHER, latest: true, intent: CHAT_INTENT } }); await tick()
  assert.equal(busy.row('one').pill, 'Sending')
  gate.resolve({ ok: true })
})

// ---- Staleness: local reads on mount, visibility and the refresh hint.
test('a settled turn re-reads the records; a shown tab re-reads only after 30 seconds', async () => {
  let at = Date.parse('2026-11-07T00:00:00Z')
  const h = harness({ ids: ['one'], records: [prepared('one')], timers: { set: () => 0, clear() {} }, now: () => at })
  h.session.start(); await tick()
  assert.equal(h.reads.length, 1)
  h.store.set('one', published(prepared('one'), 3101))
  h.session.refresh('visible'); await tick()
  assert.equal(h.reads.length, 1, 'a tab shown again soon after a read does not re-read')
  at += VISIBLE_REREAD_MS + 1
  h.session.refresh('visible'); await tick()
  assert.equal(h.reads.length, 2)
  assert.deepEqual(h.row('one').links, [{ label: '#3101', url: 'https://github.com/owner/repo/pull/3101' }])
  assert.equal(h.last().title, '1 pull request', 'a card read later says what exists, not that it just opened')
  h.store.set('one', { ...published(prepared('one'), 3101), status: 'merged' })
  h.session.refresh('turn'); await tick()
  assert.equal(h.reads.length, 3, 'a settled turn always re-reads')
  assert.deepEqual([h.row('one').pill, h.row('one').tone], ['Merged', 'accent'])
  assert.equal(h.needs.length, 0, 'none of this checks GitHub or the source')
})

test('a tap reuses a review check younger than two minutes and checks again after', async () => {
  let at = Date.parse('2026-11-07T00:00:00Z')
  let refreshes = 0
  const h = harness({ ids: ['one'], records: [prepared('one')], timers: { set: () => 0, clear() {} }, now: () => at,
    runtime: { reviewCheckedAt: at, refreshDone: 0, refreshing: false, refresh() { refreshes += 1 } } })
  await openConfirm(h)
  assert.equal(h.action(KEY).confirming, true)
  h.fire(KEY, 'cancel'); await tick()
  at += REVIEW_REUSE_MS - 1000
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes, 0, 'a recent check is reused')
  assert.equal(h.action(KEY).confirming, true)
  h.fire(KEY, 'cancel'); await tick()
  at += 2000
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes, 1, 'an older check is made again')
  assert.equal(h.action(KEY).label, 'Checking…', 'and the tap waits for it')
  h.session.updateRuntime({ ...h.runtime(), reviewCheckedAt: at, refreshDone: 1 }); await tick()
  assert.equal(h.action(KEY).confirming, true)
})

// ---- Confirm: exactly the ready records at the tap, all or none.
test('Contribute becomes Confirm with each frozen change as the card shows it', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')] })
  h.session.start(); await tick()
  assert.equal(h.action(KEY).label, 'Contribute')
  await openConfirm(h)
  const state = h.action(KEY)
  assert.equal(state.confirming, true)
  assert.deepEqual(state.confirmation, [{ title: 'Change one', facts: [{ label: 'Project', value: 'owner/repo' }, { label: 'Change', value: '1 file · +2 −0' }] }])
  const sized = confirmationItem(prepared('sized', { plan: { diff_stat: ' 3 files changed, 40 insertions(+), 2 deletions(-)' } }))
  assert.deepEqual(sized.facts.find(fact => fact.label === 'Change'), { label: 'Change', value: '3 files · +40 −2' })
  const stacked = confirmationItem({ ...layer('base', 1, ''), plan: { ...layer('base', 1, '').plan, diff_stat: '1 file changed, 1 insertion(+)' } })
  assert.deepEqual(stacked.facts.map(fact => fact.label), ['Project', 'Change', 'Stack'], 'a stack layer also names its layer')
  assert.equal(h.sends.length, 0, 'activation is not approval')
})

test('Confirm sends the frozen snapshot once and publishes the unresolved checkpoint first', async () => {
  const gate = deferred()
  const h = harness({ ids: ['one'], records: [prepared('one')], send: () => gate.promise })
  await openConfirm(h)
  const frozenTitle = h.action(KEY).confirmation[0].title
  h.store.set('one', prepared('one', { plan: { title: 'Edited after Confirm appeared' } }))
  h.fire(KEY, 'confirm'); h.fire(KEY, 'confirm')
  await tick()
  assert.equal(h.sends.length, 1, 'double Confirm sends once')
  assert.equal(h.sends[0].records[0].plan.title, frozenTitle, 'the frozen snapshot, not a refreshed substitute, is sent')
  assert.ok(h.last().checkpoint, 'checkpoint exists while the request is outstanding')
  assert.equal(h.last().retain, true)
  assert.deepEqual([h.last().title, h.last().titleBusy], ['Sending 1', true])
  assert.deepEqual([h.action(KEY).label, h.action(KEY).busy, h.action(KEY).disabled], ['Sending…', true, true])
  h.store.set('one', published(prepared('one')))
  gate.resolve({ ok: true }); await tick()
  assert.equal(h.action(KEY).hidden, true, 'the button goes away')
  assert.deepEqual([h.row('one').pill, h.row('one').tone, h.row('one').links], ['Open', 'success', [{ label: '#7', url: 'https://github.com/owner/repo/pull/7' }]])
  assert.deepEqual([h.last().title, h.last().titleTone], ['Pull request opened', 'success'])
  assert.equal(h.last().checkpoint, null, 'a proven result releases the checkpoint')
})

test('a set that grows after the tap does not change what Confirm sends', async () => {
  const h = harness({ ids: ['one', 'two'], records: [prepared('one'), prepared('two', { record: { status: 'abandoned' } })] })
  await openConfirm(h)
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Change one'])
  h.store.set('two', prepared('two'))
  h.session.refresh('turn'); await tick()
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Change one'], 'the frozen list stands')
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(send => send.ids), [['one']])
})

test('the newest attempt owns the checkpoint after fail, restage and retry (reload before response)', async () => {
  let call = 0
  const second = deferred()
  const h = harness({ ids: ['one'], records: [prepared('one')],
    send: () => ++call === 1 ? { error: 'Push rejected', failure: { owner: 'agent' } } : second.promise })
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual([h.row('one').pill, h.row('one').tone], ['Not sent', 'danger'])
  assert.equal(h.action(KEY).label, 'Retry', 'a definite failure the send path accepts again is retried explicitly')
  assert.equal(h.last().checkpoint, null, 'a known failure is not a lock')
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z' } }))
  h.fire(KEY, 'activate'); await tick()
  h.provide(); await tick() // the tap checks the restaged head
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.at(-1).records[0].plan.head_sha, NEXT, 'the retry sends the new reviewed head')
  const saved = decodeCheckpoint(h.last().checkpoint)
  assert.deepEqual(saved.map(attempt => attempt.ids), [['one']], 'only the unresolved retry crosses reload')
  const reloaded = harness({ ids: ['one'], records: [prepared('one', { head: NEXT })], checkpoint: h.last().checkpoint, retain: true })
  reloaded.session.start(); await tick()
  assert.equal(reloaded.last().checkpointAck, h.last().checkpoint.id)
  assert.deepEqual([reloaded.action(KEY).label, reloaded.action(KEY).busy, reloaded.action(KEY).note], ['Checking…', true, ''])
  reloaded.provide(); reloaded.fire(KEY, 'activate'); await tick()
  assert.equal(reloaded.action(KEY).confirming, false, 'an unknown result never becomes a fresh Confirm')
  assert.equal(reloaded.sends.length, 0)
  reloaded.store.set('one', published(prepared('one', { head: NEXT }), 9))
  reloaded.session.refresh('turn'); await tick()
  assert.equal(reloaded.action(KEY).hidden, true)
  assert.equal(reloaded.last().checkpoint, null)
})

test('only uncertain sends lock after reload; a known failure allows a new explicit Confirm', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')], send: () => ({ notAttempted: true, error: 'The saved proposal changed.' }) })
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.last().checkpoint, null)
  assert.deepEqual([h.row('one').pill, h.row('one').tone], ['Not sent', 'neutral'], 'nothing was sent: no danger tone')
  assert.equal(h.action(KEY).note, 'The saved proposal changed.', 'the reason is said once, beside the action')
  h.fire(KEY, 'activate'); await tick()
  assert.equal(h.action(KEY).confirming, true, 'not attempted can be confirmed again')
  const lost = harness({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }) })
  await openConfirm(lost)
  lost.fire(KEY, 'confirm'); await tick()
  assert.ok(lost.last().checkpoint, 'a lost response stays owned')
  assert.deepEqual([lost.row('one').pill, lost.row('one').busy], ['Checking GitHub', true])
  assert.equal(lost.last().title, 'Sending 1')
})

test('Contribute all sends independent units in parallel and a stack as one ordered request', async () => {
  const gates = { one: deferred(), two: deferred(), stack: deferred() }
  const records = [prepared('one'), prepared('two'), layer('base', 1, ''), layer('top', 2, 'base')]
  records[3].plan.base_sha = records[2].plan.head_sha
  const h = harness({ ids: ['one', 'two', 'base', 'top'], records, send: rec => gates[rec.id].promise, sendStack: () => gates.stack.promise })
  await openConfirm(h)
  const confirming = h.action(KEY)
  assert.deepEqual(confirming.confirmation.map(item => item.title), ['Change one', 'Change two', 'Change base', 'Change top'])
  assert.equal(confirming.confirmation[2].facts[2].value, 'Layer 1 of 2 · Stack')
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(call => call.ids.join('+')).sort(), ['base+top', 'one', 'two'], 'both singles are in flight together')
  h.store.set('two', published(prepared('two'), 8))
  gates.two.resolve({ ok: true }); await tick()
  assert.deepEqual(h.pills(), [['one', 'Sending'], ['two', 'Open'], ['base', 'Sending'], ['top', 'Sending']], 'a finished unit settles before slower siblings')
  h.store.set('base', published(h.store.get('base'), 9)); h.store.set('top', published(h.store.get('top'), 10))
  gates.stack.resolve({ ok: true }); await tick()
  gates.one.resolve({ error: 'Push rejected', failure: { owner: 'agent' } }); await tick()
  assert.deepEqual([h.last().title, h.last().titleTone], ['3 of 4 sent', 'attention'])
  assert.deepEqual(h.last().rows.map(row => [row.intent.slice(7), row.pill, row.links?.[0]?.label]), [['one', 'Not sent', undefined],
    ['two', 'Open', '#8'], ['base', 'Open', '#9'], ['top', 'Open', '#10']], 'a sibling failure never makes a sent unit pending')
  assert.equal(h.action(KEY).hidden, false)
})

test('a card showing one layer never confirms or sends the stack layers it does not show', async () => {
  const records = [layer('base', 1, ''), layer('top', 2, 'base')]
  records[1].plan.base_sha = records[0].plan.head_sha
  const h = harness({ ids: ['base'], records })
  await openConfirm(h)
  assert.equal(h.action(KEY).confirming, false, 'no partial or expanded Confirm')
  assert.equal(h.action(KEY).open, true)
  assert.deepEqual(h.pills(), [['base', HOLD.stack]])
  assert.equal(h.last().title, '1 needs a fix')
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual(h.sends, [])
})

test('a card showing every prepared layer reaches Confirm once each is addressed, and sends the stack as one', async () => {
  const records = [layer('base', 1, ''), layer('top', 2, 'base')]
  records[1].plan.base_sha = records[0].plan.head_sha
  assert.deepEqual(reviewAddressFor(['base'], records), ['base', 'top'], 'the status request covers the whole stack phase')
  const narrow = harness({ ids: ['base', 'top'], records, runtime: { reviewStatus: { state: 'ready', addressed: ['base', 'top'], byId: { base: { state: 'ready' } } } } })
  await openConfirm(narrow)
  assert.equal(narrow.action(KEY).confirming, false, 'one layer without a current check holds the phase')
  assert.equal(narrow.pills().find(([, pill]) => pill)?.[1], HOLD.attention)
  const h = harness({ ids: ['base', 'top'], records })
  await openConfirm(h)
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Change base', 'Change top'])
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(call => [call.kind, call.ids.join(',')]), [['stack', 'base,top']])
})

test('chat never sends without server binding of the confirmed snapshot or a check addressed to its records', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')], runtime: { frozenBinding: false } })
  await openConfirm(h)
  assert.deepEqual([h.action(KEY).confirming, h.action(KEY).open], [false, true])
  assert.match(h.action(KEY).note, /newer Möbius/)
  const unaddressed = harness({ ids: ['one'], records: [prepared('one')], runtime: { reviewStatus: { state: 'ready', addressed: null, byId: { one: { state: 'ready' } } } } })
  await openConfirm(unaddressed)
  assert.equal(unaddressed.action(KEY).confirming, false)
  assert.match(unaddressed.action(KEY).note, /newer Möbius/, 'a check with no address comes from an older Möbius')
  const elsewhere = harness({ ids: ['one'], records: [prepared('one')], runtime: { reviewStatus: { state: 'ready', addressed: [], byId: { one: { state: 'ready' } } } } })
  await openConfirm(elsewhere)
  assert.deepEqual([elsewhere.action(KEY).confirming, elsewhere.action(KEY).label], [false, 'Checking…'], 'a check for other records never confirms these')
  elsewhere.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.length + unaddressed.sends.length + elsewhere.sends.length, 0)
})

test('readiness fails closed without a current positive check of the exact record', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')], runtime: { reviewStatus: { state: 'ready', addressed: ['one'], byId: {} } } })
  await openConfirm(h)
  assert.equal(h.action(KEY).confirming, false)
  assert.deepEqual(h.pills(), [['one', HOLD.attention]])
  const stale = harness({ ids: ['one'], records: [prepared('one', { record: { quality_review: { state: 'all_clear', reviewed_head_sha: NEXT } } })] })
  stale.session.start(); await tick()
  assert.deepEqual(stale.pills(), [['one', HOLD.review]], 'a review of another head shows before any tap')
  assert.deepEqual([stale.last().title, stale.last().titleTone], ['1 needs a fix', 'attention'])
  assert.deepEqual([stale.action(KEY).open, stale.action(KEY).label, stale.action(KEY).note], [true, 'Open Contribute', ''])
})

test('the action covers every pending record or none: one that needs attention holds the card and is marked', async () => {
  const blocked = prepared('open-chats', { plan: { title: 'Open chats without duplicate requests from a pull request link' },
    record: { last_submit_error: 'Push outcome unknown' } })
  const h = harness({ ids: ['open-chats', 'media-call'], records: [blocked, prepared('media-call')] })
  await openConfirm(h)
  const state = h.action(KEY)
  assert.deepEqual([state.confirming, state.confirmation, state.open, state.note], [false, null, true, ''])
  assert.deepEqual(h.pills(), [['open-chats', HOLD.notSent], ['media-call', '']])
  assert.equal(h.row('open-chats').tone, 'attention', 'held is calm, not red')
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.length, 0, 'nothing is sent')
  // An already published row does not hold the rest.
  const sent = harness({ ids: ['open-chats', 'media-call'], records: [published(prepared('open-chats')), prepared('media-call')] })
  await openConfirm(sent)
  assert.deepEqual(sent.action(KEY).confirmation.map(item => item.title), ['Change media-call'])
  assert.equal(sent.last().title, '1 of 2 sent')
})

// A stack whose existing-PR prefix is updated first and whose new child opens
// in a later phase, shown with an unrelated ready contribution.
function mixedStack({ topError = null } = {}) {
  const base = layer('base', 1, '')
  base.plan.action = 'pr_update'
  Object.assign(base, { number: 41 })
  const top = layer('top', 2, 'base')
  top.plan.base_sha = base.plan.head_sha
  if (topError) top.last_submit_error = topError
  return [base, top, prepared('solo')]
}
for (const [label, topError, pill] of [['a blocked deferred child', 'Needs attention', HOLD.notSent], ['an otherwise ready deferred child', null, HOLD.later]]) {
  test(`a stack layer outside the phase being confirmed holds the card: ${label}`, async () => {
    const h = harness({ ids: ['base', 'top', 'solo'], records: mixedStack({ topError }) })
    await openConfirm(h)
    assert.equal(h.action(KEY).confirming, false, 'Confirm never covers only the update phase')
    assert.equal(h.action(KEY).open, true)
    assert.deepEqual(h.pills(), [['base', ''], ['top', pill], ['solo', '']], 'the held layer itself is marked')
    h.fire(KEY, 'confirm'); await tick()
    assert.equal(h.sends.length, 0, 'nothing freezes or sends for an incomplete set')
  })
}

test('a change without a readable size is never offered for Confirm, single or in a stack', async () => {
  for (const [name, diffStat] of [['missing', undefined], ['empty', ''], ['malformed', 'lots of changes'], ['suffix', '1 file changed, lots of deletions']]) {
    const single = harness({ ids: ['one'], records: [prepared('one', { plan: { diff_stat: diffStat } })] })
    await openConfirm(single)
    assert.equal(single.action(KEY).confirming, false, `${name}: single`)
    assert.deepEqual(single.pills(), [['one', HOLD.check]])
    single.fire(KEY, 'confirm'); await tick()
    assert.equal(single.sends.length, 0)
    const base = layer('base', 1, ''), top = layer('top', 2, 'base')
    top.plan.base_sha = base.plan.head_sha
    top.plan.diff_stat = diffStat
    const stack = harness({ ids: ['base', 'top', 'solo'], records: [base, top, prepared('solo')] })
    await openConfirm(stack)
    assert.equal(stack.action(KEY).confirming, false, `${name}: stack`)
    assert.deepEqual(stack.pills(), [['base', ''], ['top', HOLD.check], ['solo', '']], 'the unsized layer, not its sized parent')
    assert.equal(stack.sends.length, 0)
  }
  const deletions = harness({ ids: ['one'], records: [prepared('one', { plan: { diff_stat: ' 2 files changed, 7 deletions(-)' } })] })
  await openConfirm(deletions)
  assert.equal(deletions.action(KEY).confirmation[0].facts.find(fact => fact.label === 'Change').value, '2 files · +0 −7')
  assert.equal(rowMeta(prepared('x', { plan: { diff_stat: '' } })), 'owner/repo', 'no size, no lines on the row')
})

test('a relay (mobius-bot) contribution is never confirmable from chat and is never sent', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one', { record: { submission_mode: 'mobius-bot' } })] })
  h.session.start(); await tick()
  assert.deepEqual(h.pills(), [['one', HOLD.relay]])
  await openConfirm(h)
  assert.deepEqual([h.action(KEY).confirming, h.action(KEY).open], [false, true])
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.length, 0)
  assert.equal(localHold(prepared('ok')), '')
})

test('a card never reports more than one confirming action, and a repeated tap adds none', async () => {
  const h = harness({ ids: ['one', 'two'], records: [prepared('one'), prepared('two')] })
  const confirmingKeys = () => h.last().actions.filter(action => action.confirming).map(action => action.key)
  await openConfirm(h)
  assert.deepEqual(confirmingKeys(), [KEY])
  h.fire(KEY, 'activate'); await tick()
  assert.deepEqual(confirmingKeys(), [KEY])
  h.fire(KEY, 'cancel'); await tick()
  assert.deepEqual(confirmingKeys(), [])
  for (const state of h.states) assert.ok(state.actions.filter(action => action.confirming).length <= 1)
})

test('a broken or missing recovery checkpoint never resurrects Send', async () => {
  for (const options of [{ checkpoint: { id: 'c', data: '{"version":2}' } }, { retain: true }]) {
    const h = harness({ ids: ['one'], records: [prepared('one')], ...options })
    h.session.start(); await tick()
    assert.equal(h.last().recoveryError, true)
    assert.equal(h.action(KEY).note, RECOVERY_NOTE)
    h.fire(KEY, 'activate'); await tick()
    assert.equal(h.action(KEY).confirming, false)
  }
})

test('checkpoint and outcome rules are bounded and conservative', () => {
  assert.equal(encodeCheckpoint([{ id: 'x', unitKey: 'record:a', ids: ['a'], at: 1, state: 'failed' }]), null)
  const data = encodeCheckpoint([{ id: 'x', unitKey: 'record:a', ids: ['a'], at: 1, state: 'sending', note: 'not persisted' }])
  assert.deepEqual(JSON.parse(data), { version: 1, attempts: [{ id: 'x', unitKey: 'record:a', ids: ['a'], at: 1 }] })
  assert.throws(() => decodeCheckpoint({ id: 'c', data: JSON.stringify({ version: 1, attempts: [{ id: 'x', unitKey: 'record:a', ids: ['../a'], at: 1 }] }) }))
  assert.equal(attemptOutcome({ ok: true }).state, 'unknown')
  assert.equal(attemptOutcome({ error: 'lost', failure: { owner: 'automatic' } }).state, 'unknown')
  assert.equal(attemptOutcome({ notAttempted: true, failure: { owner: 'automatic' } }).state, 'not_attempted')
  assert.equal(attemptOutcome({ error: 'no', failure: { owner: 'agent' } }).state, 'failed')
  const update = confirmationItem({ ...prepared('u'), number: 12, plan: { ...prepared('u').plan, action: 'pr_update' } })
  assert.deepEqual(update, confirmationItem(prepared('u')), 'an update shows the same row as a new pull request')
})

test('an uncertified approval_changed refusal stays unknown and locked end to end; only not_attempted releases Confirm', async () => {
  const { submitContribution } = await import('../api.js')
  const previousFetch = globalThis.fetch
  const refused = notAttempted => {
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'approval_changed', changed_record_ids: ['one'], not_attempted: notAttempted } }) })
    return submitContribution({ appId: 80, token: 't', rec: { id: 'one' }, expectedRecord: {} })
  }
  try {
    for (const notAttempted of [false, undefined]) {
      const outcome = await refused(notAttempted)
      assert.equal(outcome.failure.owner, 'automatic', 'a maybe-attempted refusal is owned by reconciliation')
      const h = harness({ ids: ['one'], records: [prepared('one')], send: () => outcome })
      await openConfirm(h)
      h.fire(KEY, 'confirm'); await tick()
      assert.ok(h.last().checkpoint, 'the unresolved attempt stays in the checkpoint')
      assert.deepEqual([h.last().retain, h.action(KEY).label, h.action(KEY).disabled, h.row('one').pill], [true, 'Checking…', true, 'Checking GitHub'])
      h.fire(KEY, 'activate'); await tick()
      assert.equal(h.action(KEY).confirming, false, 'Confirm is not offered again')
      h.fire(KEY, 'confirm'); await tick()
      assert.equal(h.sends.length, 1, 'no second send while the outcome is unknown')
    }
    const certified = await refused(true)
    const h = harness({ ids: ['one'], records: [prepared('one')], send: () => certified })
    await openConfirm(h)
    h.fire(KEY, 'confirm'); await tick()
    assert.equal(h.last().checkpoint, null, 'a certified non-attempt releases the checkpoint')
    h.fire(KEY, 'activate'); await tick()
    assert.equal(h.action(KEY).confirming, true, 'only not_attempted re-enables Confirm')
  } finally { globalThis.fetch = previousFetch }
  assert.equal(attemptOutcome({ error: 'changed', failure: { owner: 'agent', code: 'approval_changed' } }).state, 'unknown')
  assert.equal(attemptOutcome({ notAttempted: true, failure: { owner: 'agent', code: 'approval_changed' } }).state, 'not_attempted')
})

// ---- Checks that could not finish end on Try again, which only reads again.
test('a failed exact read holds the card with Try again, which reaches Confirm once the record reads', async () => {
  let failing = true
  const h = harness({ ids: ['one'], records: [prepared('one')], runtime: { records: [] },
    loadExact: async (id, store) => { if (failing) throw new Error('offline'); return structuredClone(store.get(id)) } })
  h.session.start(); await tick()
  assert.deepEqual(h.last().rows, [{ title: 'one', meta: '', intent: 'review:one', pill: HOLD.unread }], 'an unread record is not called missing')
  assert.deepEqual([h.action(KEY).label, h.action(KEY).open], ['Try again', false])
  h.fire(KEY, 'activate'); await tick()
  h.provide(); await tick()
  assert.deepEqual([h.action(KEY).confirming, h.action(KEY).disabled, h.action(KEY).label, h.action(KEY).note], [false, false, 'Try again', UNREAD_NOTE])
  failing = false
  h.fire(KEY, 'activate'); await tick()
  assert.deepEqual(h.needs.at(-1), ['one'], 'the tap asks the app to check the record it can now read')
  h.provide(); await tick()
  assert.equal(h.action(KEY).confirming, true, 'the retry reaches Confirm')
  assert.equal(h.sends.length, 0)
})

test('an unavailable review check ends the check with an enabled Try again that can then reach Confirm', async () => {
  const refreshes = []
  const h = harness({ ids: ['one'], records: [prepared('one')], runtime: { refresh() { refreshes.push(true) } } })
  const unavailable = () => h.session.updateRuntime({ ...h.runtime(), reviewStatus: { state: 'unavailable', byId: {} } })
  h.session.start(); await tick()
  h.fire(KEY, 'activate'); await tick()
  unavailable(); await tick()
  assert.equal(h.action(KEY).label, 'Try again')
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'Try again asks for a fresh check')
  assert.equal(h.action(KEY).label, 'Checking…', 'still checking while that refresh is pending')
  unavailable(); await tick()
  assert.deepEqual([h.action(KEY).confirming, h.action(KEY).disabled, h.action(KEY).label], [false, false, 'Try again'])
  h.fire(KEY, 'activate'); await tick()
  h.provide(); await tick() // the check recovers
  assert.equal(h.action(KEY).confirming, true, 'the retry reaches Confirm')
  assert.equal(h.sends.length, 0)
})

test('a record whose own source check could not finish offers Try again; a reconnect does not', async () => {
  const refreshes = []
  const h = harness({ ids: ['one'], records: [prepared('one')], runtime: { refresh() { refreshes.push(true) } } })
  const check = row => h.session.updateRuntime({ ...h.runtime(), reviewStatus: { state: 'ready', addressed: ['one'], byId: { one: row } } })
  h.session.start(); await tick()
  h.fire(KEY, 'activate'); await tick()
  check({ state: 'unavailable', code: 'github_reconnect' }); await tick()
  assert.equal(h.action(KEY).open, true, 'only the owner can clear a reconnect')
  assert.deepEqual(h.pills(), [['one', HOLD.attention]])
  check({ state: 'unavailable', code: 'review_unavailable' }); await tick()
  assert.deepEqual([h.action(KEY).disabled, h.action(KEY).label], [false, 'Try again'])
  assert.match(h.action(KEY).note, /could not be checked just now\. Try again in a moment\./)
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'Try again asks for a fresh check')
  h.provide(); await tick()
  h.fire(KEY, 'activate'); await tick()
  assert.equal(h.action(KEY).confirming, true)
  assert.equal(h.sends.length, 0)
})

test('a retry during the first ledger read never strands the card on Checking', async () => {
  const refreshes = []
  const h = harness({ ids: ['one'], records: [prepared('one')] })
  const unavailable = { state: 'unavailable', byId: {}, addressed: ['one'] }
  let ledgerReady = false
  const runtime = () => ({ ...h.runtime(), ledgerReady, reviewStatus: unavailable, refresh: () => refreshes.push(true) })
  h.session.start(); await tick()
  h.fire(KEY, 'activate'); await tick()
  h.session.updateRuntime(runtime()); await tick()
  assert.deepEqual([h.action(KEY).label, h.action(KEY).disabled], ['Try again', false])
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes.length, 1)
  ledgerReady = true
  h.session.updateRuntime(runtime()); await tick()
  assert.deepEqual([h.action(KEY).confirming, h.action(KEY).disabled, h.action(KEY).label], [false, false, 'Try again'])
  h.fire(KEY, 'activate'); await tick()
  h.provide(); await tick()
  assert.equal(h.action(KEY).confirming, true)
  assert.equal(h.sends.length, 0)
})

test('an incomplete ledger ends the check with a clear note, and Try again waits for its whole re-read', async () => {
  const refreshes = []
  const h = harness({ ids: ['one'], records: [prepared('one')], runtime: { refresh: () => refreshes.push(true) } })
  const report = fields => h.session.updateRuntime({ ...h.runtime(), refreshing: false, refreshDone: 0, ...fields })
  h.session.start(); await tick()
  h.fire(KEY, 'activate'); await tick()
  report({ ledgerReady: false, ledger: 'incomplete' }); await tick()
  assert.deepEqual([h.action(KEY).confirming, h.action(KEY).note, h.action(KEY).disabled], [false, LEDGER_NOTE, false])
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'Try again requested a full ledger re-read')
  report({ ledgerReady: false, ledger: 'incomplete', refreshing: true }); await tick()
  report({ ledgerReady: false, ledger: 'incomplete', refreshing: true, connection: 'connected' }); await tick()
  assert.deepEqual([h.action(KEY).label, h.action(KEY).disabled], ['Checking…', true], 'an intermediate report does not end the check')
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'no second refresh while one is outstanding')
  report({ ledger: 'current', refreshing: false, refreshDone: 1 }); await tick()
  assert.equal(h.action(KEY).confirming, true)
  // A re-read that completes still incomplete goes back to Try again.
  const again = harness({ ids: ['one'], records: [prepared('one')] })
  const reportAgain = fields => again.session.updateRuntime({ ...again.runtime(), refreshing: false, refreshDone: 0, ...fields })
  again.session.start(); await tick()
  again.fire(KEY, 'activate'); await tick()
  reportAgain({ ledgerReady: false, ledger: 'incomplete' }); await tick()
  again.fire(KEY, 'activate'); await tick()
  reportAgain({ ledgerReady: false, ledger: 'incomplete', refreshing: false, refreshDone: 1 }); await tick()
  assert.deepEqual([again.action(KEY).note, again.action(KEY).label], [LEDGER_NOTE, 'Try again'])
  assert.equal(h.sends.length + again.sends.length, 0)
})

test('a refresh that times out or fails ends the check on Try again, and a late answer cannot complete it', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')], runtime: { refresh: () => {} } })
  const report = fields => h.session.updateRuntime({ ...h.runtime(), refreshing: false, refreshDone: 0, refreshOutcome: '', ...fields })
  h.session.start(); await tick()
  h.fire(KEY, 'activate'); await tick()
  report({ reviewStatus: { state: 'unavailable', byId: {}, addressed: ['one'] } }); await tick()
  h.fire(KEY, 'activate'); await tick()
  report({ reviewStatus: { state: 'loading', byId: {} }, refreshDone: 1, refreshOutcome: 'timeout' }); await tick()
  assert.deepEqual([h.action(KEY).label, h.action(KEY).note, h.action(KEY).confirming], ['Try again', TIMEOUT_NOTE, false])
  report({ refreshDone: 1, refreshOutcome: 'timeout' }); await tick()
  assert.equal(h.action(KEY).confirming, false, 'no Confirm from a late answer')
  h.fire(KEY, 'activate'); await tick()
  report({ refreshDone: 2, refreshOutcome: 'done' }); await tick()
  assert.equal(h.action(KEY).confirming, true, 'only a new Try again, with its own check, reaches Confirm')
  const failed = harness({ ids: ['one'], records: [prepared('one')], runtime: { refresh: () => Promise.reject(new Error('listing failed')) } })
  const reportFailed = fields => failed.session.updateRuntime({ ...failed.runtime(), refreshing: false, refreshDone: 0, refreshOutcome: '', ...fields })
  failed.session.start(); await tick()
  failed.fire(KEY, 'activate'); await tick()
  reportFailed({ ledgerReady: false, ledger: 'incomplete' }); await tick()
  failed.fire(KEY, 'activate'); await tick()
  await new Promise(resolve => setImmediate(resolve))
  reportFailed({ ledger: 'current', refreshDone: 1, refreshOutcome: 'failed' }); await tick()
  assert.deepEqual([failed.action(KEY).confirming, failed.action(KEY).label, failed.action(KEY).note], [false, 'Try again', REFRESH_FAILED_NOTE])
  assert.equal(h.sends.length + failed.sends.length, 0)
})

// ---- Card states: calm progress, rechecks, and what each row says afterwards.
function clock(start = Date.parse('2026-10-20T10:30:00Z')) {
  let at = start
  const pending = new Map()
  let next = 1
  return {
    now: () => at,
    timers: { set: (fn, ms) => { const id = next++; pending.set(id, { fn, due: at + ms }); return id }, clear: id => pending.delete(id) },
    pending: () => [...pending.values()],
    async advance(ms) {
      at += ms
      for (const [id, timer] of [...pending]) if (timer.due <= at) { pending.delete(id); timer.fn() }
      await tick()
    },
  }
}
const timed = (options, c) => harness({ ...options, timers: c.timers, now: c.now })

test('sending shows calm per-row progress and a disabled Sending… with no warning text', async () => {
  const gate = deferred()
  const h = harness({ ids: ['one', 'two'], records: [prepared('one'), prepared('two')], send: () => gate.promise })
  await openConfirm(h)
  assert.equal(h.last().title, '2 contributions')
  h.fire(KEY, 'confirm'); await tick()
  const state = h.action(KEY)
  assert.deepEqual([state.label, state.busy, state.disabled, state.note, state.status], ['Sending…', true, true, '', ''])
  assert.deepEqual([h.last().title, h.last().titleBusy], ['Sending 2', true])
  assert.deepEqual(h.last().rows.map(row => [row.pill, row.busy, row.tone]), [['Sending', true, 'neutral'], ['Sending', true, 'neutral']])
  gate.resolve({ ok: true })
})

test('an unconfirmed push is rechecked on its own, never resent, and settles when the record is published', async () => {
  const c = clock()
  let refreshes = 0
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }), runtime: { refresh() { refreshes += 1 } } }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.action(KEY).label, 'Checking…')
  assert.equal(c.pending().length, 1, 'one recheck is scheduled')
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.equal(refreshes, 1, 'the recheck uses the app\'s refresh path')
  h.store.set('one', published(prepared('one'), 12))
  await c.advance(RECHECK_DELAYS_MS[1])
  assert.equal(h.action(KEY).hidden, true)
  assert.equal(h.last().title, 'Pull request opened')
  assert.deepEqual(h.row('one').links, [{ label: '#12', url: 'https://github.com/owner/repo/pull/12' }])
  assert.equal(h.last().checkpoint, null)
  assert.equal(c.pending().length, 0, 'nothing left to check')
  assert.equal(h.sends.length, 1, 'never sent twice')
})

test('after the recheck window an unconfirmed push says Not confirmed and only opens Contribute', async () => {
  const c = clock()
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }) }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.last().title, 'Sending 1')
  for (let elapsed = 0; elapsed <= RECHECK_WINDOW_MS && c.pending().length; elapsed += 60000) await c.advance(60000)
  assert.equal(c.pending().length, 0, 'rechecks stop after the window')
  const state = h.action(KEY)
  assert.deepEqual([state.open, state.label, state.busy, state.note], [true, 'Open Contribute', false, ''])
  assert.deepEqual(h.row('one').pill, 'Not confirmed')
  assert.deepEqual([h.last().title, h.last().titleTone], ['Result not confirmed', 'attention'])
  assert.ok(h.last().checkpoint, 'the unresolved attempt still crosses a reload')
  h.fire(KEY, 'activate'); await tick()
  assert.equal(h.action(KEY).confirming, false)
  assert.equal(h.sends.length, 1)
  h.store.set('one', published(prepared('one'), 13)); h.session.refresh('turn'); await tick()
  assert.equal(h.action(KEY).hidden, true)
  // A reloaded card past its window does not recheck forever.
  const old = encodeCheckpoint([{ id: 'a1', unitKey: 'record:one', ids: ['one'], at: c.now() - RECHECK_WINDOW_MS - 1, state: 'unknown' }])
  const reloaded = timed({ ids: ['one'], records: [prepared('one')], checkpoint: { id: 'cp', data: old }, retain: true }, c)
  reloaded.session.start(); await tick()
  assert.equal(c.pending().length, 0)
  assert.equal(reloaded.action(KEY).open, true)
})

test('with another row sent, an expired check counts what is known', async () => {
  const c = clock()
  const m = timed({ ids: ['one', 'two'], records: [prepared('one'), prepared('two')], send: rec => rec.id === 'one' ? { ok: true } : { uncertain: true } }, c)
  await openConfirm(m)
  m.store.set('one', published(prepared('one'), 5))
  m.fire(KEY, 'confirm'); await tick()
  for (let i = 0; i < 20 && c.pending().length; i++) await c.advance(60000)
  assert.equal(m.last().title, '1 of 2 sent')
})

test('a partly sent card links the sent rows, marks the failed one, and opens Contribute when it cannot retry', async () => {
  const h = harness({ ids: ['one', 'two'], records: [prepared('one'), prepared('two')],
    send: rec => rec.id === 'one' ? { ok: true } : { error: 'The branch already exists.', failure: { owner: 'agent' } } })
  await openConfirm(h)
  h.store.set('one', published(prepared('one'), 21))
  h.store.set('two', prepared('two', { record: { last_submit_error: 'The branch already exists.', updated_at: '2026-10-20T23:00:00Z' } }))
  h.fire(KEY, 'confirm'); await tick(); h.provide(); await tick()
  assert.deepEqual([h.last().title, h.last().titleTone], ['1 of 2 sent', 'attention'])
  assert.deepEqual(h.last().rows.map(row => [row.pill, row.tone, row.links]), [['Open', 'success', [{ label: '#21', url: 'https://github.com/owner/repo/pull/21' }]],
    ['Not sent', 'danger', []]])
  assert.deepEqual([h.action(KEY).open, h.action(KEY).label, h.action(KEY).note], [true, 'Open Contribute', 'The branch already exists.'])
})

test('a partly sent card retries only the failed contribution through a second Confirm', async () => {
  let first = true
  const h = harness({ ids: ['one', 'two'], records: [prepared('one'), prepared('two')],
    send: rec => rec.id === 'two' && first ? (first = false, { notAttempted: true, error: 'The saved proposal changed.' }) : { ok: true } })
  await openConfirm(h)
  h.store.set('one', published(prepared('one'), 5))
  h.fire(KEY, 'confirm'); await tick(); h.provide(); await tick()
  assert.deepEqual([h.action(KEY).label, h.action(KEY).disabled], ['Retry', false])
  h.fire(KEY, 'activate'); await tick(); h.provide(); await tick()
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Change two'], 'Confirm lists only the unsent one')
  h.store.set('two', published(prepared('two'), 6))
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(send => send.ids), [['one'], ['two'], ['two']])
  assert.deepEqual([h.last().title, h.last().titleTone], ['2 pull requests opened', 'success'])
})

test('an update to an existing pull request is reported as sent, not opened, and Merged is purple', async () => {
  const h = harness({ ids: ['one'], records: [published(prepared('one', { plan: { action: 'pr_update' } }), 30)] })
  h.session.start(); await tick()
  assert.equal(h.last().title, 'Contribution sent')
  assert.equal(h.row('one').links[0].label, '#30')
  const merged = harness({ ids: ['one'], records: [{ ...published(prepared('one'), 8), status: 'merged' }] })
  merged.session.start(); await tick()
  assert.deepEqual([merged.row('one').pill, merged.row('one').tone], ['Merged', 'accent'])
})

test('disposing the card cancels its pending recheck', async () => {
  const c = clock()
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }) }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(c.pending().length, 1)
  h.session.dispose()
  assert.equal(c.pending().length, 0)
})

// ---- Cards printed before this one only show status.
test('a card is recognised by its action; its items are only hints of where to look', () => {
  const items = reviewItems(['a', 'b', 'a'])
  assert.deepEqual(cardKind([{ key: 'chat-send-batch:968bcf1a16b2b0ee' }], items), { key: 'chat-send-batch:968bcf1a16b2b0ee', hints: ['a', 'b'] })
  assert.deepEqual(cardKind([{ key: 'chat-send:a' }], []), { key: 'chat-send:a', hints: ['a'] }, 'a card printed before items named its record')
  assert.deepEqual(cardKind([{ key: 'chat-send:a' }], reviewItems(['b'])).hints, ['b'])
  assert.equal(cardKind([{ key: 'send:a' }], items), null)
  assert.deepEqual(hintedIds([{ intent: 'review:../x' }, { intent: 'reviews:queue' }, { intent: 'review:ok' }]), ['ok'])
  assert.equal(hintedIds(Array.from({ length: 20 }, (_, n) => ({ intent: `review:r${n}` }))).length, 12)
})

// An old card on a host that attests its chat: its block intent is not this card's.
const OLD_CONTEXT = { chatId: CHAT, latest: true, intent: 'reviews:queue' }

test('an old card shows only this chat\'s records, from the ledger, and never sends', async () => {
  for (const actions of [[{ key: 'chat-send-batch:968bcf1a16b2b0ee', label: 'Contribute all' }], [{ key: 'chat-send:one', label: 'Contribute' }]]) {
    const items = actions[0].key === 'chat-send:one' ? [] : reviewItems(['one', 'two', 'three', 'theirs'])
    const records = [published(prepared('one'), 3101), prepared('two', { record: { status: 'abandoned' } }), prepared('three'),
      published(prepared('theirs', { record: { chat_id: OTHER, chat_ids: [OTHER] } }), 9)]
    const h = harness({ actions, items, records, context: OLD_CONTEXT })
    h.session.start(); await tick()
    const expected = items.length ? [['one', 'Open'], ['two', 'Dismissed'], ['three', '']] : [['one', 'Open']]
    assert.deepEqual(h.pills(), expected, `${actions[0].key}: another chat's record is not shown`)
    assert.equal(h.last().actions[0].hidden, true, 'nothing to do from an old card')
    h.fire(actions[0].key, 'activate'); h.provide(); await tick()
    h.fire(actions[0].key, 'confirm'); await tick()
    assert.deepEqual([h.needs, h.sends], [[], []], 'an old card never asks for the send runtime')
  }
  // Nor through a successor that belongs to another chat.
  const chain = harness({ actions: [{ key: 'chat-send:old' }], items: [], context: OLD_CONTEXT, records: [prepared('old', { record: { status: 'superseded', superseded_by: 'moved' } }),
    prepared('moved', { record: { chat_id: OTHER, chat_ids: [OTHER] } })] })
  chain.session.start(); await tick(12)
  assert.deepEqual(chain.last().rows, [])
  // Without the host's chat, an old card reads and shows nothing.
  const unattested = harness({ actions: [{ key: 'chat-send:one' }], items: [], features: ['row-state'], records: [published(prepared('one'))] })
  unattested.session.start(); await tick()
  assert.deepEqual([unattested.reads, 'rows' in unattested.last(), unattested.action('chat-send:one').open], [[], false, true])
})

test('an old card that could not read its record offers Try again, which only reads again', async () => {
  let reachable = false
  const h = harness({ actions: [{ key: 'chat-send:one' }], items: [], context: OLD_CONTEXT, records: [published(prepared('one'))],
    loadExact: async (id, store) => { if (!reachable) throw new Error('offline'); return structuredClone(store.get(id)) } })
  h.session.start(); await tick()
  assert.deepEqual([h.action('chat-send:one').note, h.action('chat-send:one').label, h.action('chat-send:one').disabled], [UNCHECKED_NOTE, 'Try again', false])
  assert.deepEqual(h.pills(), [['one', HOLD.unread]], 'an unavailable read is not reported as a missing contribution')
  reachable = true
  h.fire('chat-send:one', 'activate'); await tick()
  assert.deepEqual(h.pills(), [['one', 'Open']])
  assert.equal(h.action('chat-send:one').hidden, true)
  assert.deepEqual([h.needs.length, h.sends.length], [0, 0])
})

// ---- Review regressions: newest card, versions, missing records.
test('a card a newer one follows never starts another send after a settled attempt', async () => {
  for (const outcome of [{ notAttempted: true, error: 'The saved proposal changed.' }, { error: 'Push rejected', failure: { owner: 'agent' } }]) {
    const h = harness({ ids: ['one'], records: [prepared('one')], send: () => outcome })
    await openConfirm(h)
    h.fire(KEY, 'confirm'); await tick()
    h.session.update({ context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } }); await tick()
    assert.deepEqual([h.last().title, h.action(KEY).hidden], [CONTINUED_TITLE, true], 'a settled attempt does not keep an earlier card live')
    h.fire(KEY, 'activate'); await tick(); h.provide(); await tick()
    h.fire(KEY, 'confirm'); await tick()
    assert.equal(h.sends.length, 1, 'no second send from an earlier card')
  }
  // A sent card folds too.
  const sent = harness({ ids: ['one'], records: [prepared('one')] })
  await openConfirm(sent)
  sent.store.set('one', published(prepared('one')))
  sent.fire(KEY, 'confirm'); await tick()
  sent.session.update({ context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } }); await tick()
  assert.equal(sent.last().title, CONTINUED_TITLE)
  // A retry confirmation open when a newer card appears is dropped.
  let first = true
  const retry = harness({ ids: ['one', 'two'], records: [prepared('one'), prepared('two')],
    send: rec => rec.id === 'two' && first ? (first = false, { notAttempted: true, error: 'changed' }) : { ok: true } })
  await openConfirm(retry)
  retry.store.set('one', published(prepared('one'), 5))
  retry.fire(KEY, 'confirm'); await tick()
  retry.fire(KEY, 'activate'); await tick(); retry.provide(); await tick()
  assert.equal(retry.action(KEY).confirming, true)
  retry.session.update({ context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } }); await tick()
  retry.fire(KEY, 'confirm'); await tick()
  assert.deepEqual(retry.sends.map(call => call.ids), [['one'], ['two']], 'the dropped retry is never sent')
})

test('a reused check must be for the exact version: a restaged head is checked again', async () => {
  let at = Date.parse('2026-11-07T00:00:00Z')
  let refreshes = 0
  const h = harness({ ids: ['one'], records: [prepared('one')], timers: { set: () => 0, clear() {} }, now: () => at,
    runtime: { refreshDone: 0, refreshing: false, refresh() { refreshes += 1 } } })
  await openConfirm(h)
  assert.equal(h.action(KEY).confirming, true)
  h.fire(KEY, 'cancel'); await tick()
  // The same record is restaged with a new head and its own all clear.
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z' } }))
  h.session.refresh('turn'); await tick()
  at += 1000
  h.fire(KEY, 'activate'); await tick()
  assert.equal(refreshes, 1, 'a check of the previous head is not reused for the new one')
  assert.equal(h.action(KEY).confirming, false)
  h.session.updateRuntime({ ...h.runtime(), refreshDone: 1 }); await tick()
  assert.equal(h.action(KEY).confirming, true)
  assert.equal(h.action(KEY).confirmation.length, 1)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends[0].records[0].plan.head_sha, NEXT)
  // A check that answers after its record changed again is a check of the
  // version it was asked for: the tap ends, and Try again checks the new one.
  const THIRD = 'f'.repeat(40)
  h.store.set('one', prepared('one', { head: THIRD, record: { updated_at: '2026-10-20T13:00:00Z' } }))
  const moving = harness({ ids: ['one'], records: [prepared('one', { head: NEXT })], runtime: { refreshDone: 0, refreshing: false } })
  await openConfirm(moving)
  moving.fire(KEY, 'cancel'); await tick()
  moving.store.set('one', prepared('one', { head: THIRD, record: { updated_at: '2026-10-20T13:00:00Z' } }))
  moving.session.refresh('turn'); await tick()
  moving.fire(KEY, 'activate'); await tick()
  moving.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T14:00:00Z' } }))
  moving.session.refresh('turn'); await tick()
  moving.session.updateRuntime({ ...moving.runtime(), refreshDone: 1 }); await tick()
  assert.deepEqual([moving.action(KEY).confirming, moving.action(KEY).label, moving.action(KEY).note], [false, 'Try again', CHANGED_NOTE])
})

test('the tap checks a successor it discovers, not the record the card named', async () => {
  const h = harness({ ids: ['v1'], records: [prepared('v1')] })
  h.session.start(); await tick()
  h.store.set('v1', prepared('v1', { record: { status: 'superseded', superseded_by: 'v2', updated_at: '2026-10-20T12:00:00Z' } }))
  h.store.set('v2', prepared('v2'))
  h.fire(KEY, 'activate'); await tick(12)
  assert.deepEqual(h.needs, [['v2']], 'the runtime is addressed after the tap\'s own read')
  h.provide(); await tick()
  assert.deepEqual(h.action(KEY).confirmation.map(item => item.title), ['Change v2'])
})

test('a named record that is gone holds the card; it is never left out of an all-or-none send', async () => {
  const h = harness({ ids: ['one', 'gone'], records: [prepared('one')] })
  h.session.start(); await tick()
  assert.deepEqual(h.pills(), [['one', ''], ['gone', HOLD.gone]])
  assert.equal(h.action(KEY).open, true)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.deepEqual([h.action(KEY).confirming, h.sends.length], [false, 0])
  // A record that disappears after a successful read is not shown as it was.
  const later = harness({ ids: ['one'], records: [prepared('one')] })
  later.session.start(); await tick()
  later.store.delete('one')
  later.session.refresh('turn'); await tick()
  assert.deepEqual(later.pills(), [['one', HOLD.gone]])
})

test('a successor that failed to read is read again on the next trigger', async () => {
  let failNew = true
  const h = harness({ ids: ['old'], records: [prepared('old', { record: { status: 'superseded', superseded_by: 'new' } }), prepared('new', { plan: { title: 'Newer' } })],
    loadExact: async (id, store) => { if (id === 'new' && failNew) throw new Error('offline'); return structuredClone(store.get(id)) } })
  h.session.start(); await tick(12)
  assert.deepEqual(h.pills(), [['old', HOLD.unread]], 'an unread successor is not a dismissal')
  assert.equal(h.action(KEY).label, 'Try again')
  failNew = false
  h.session.refresh('turn'); await tick(12)
  assert.deepEqual(h.last().rows.map(row => [row.title, row.pill || '']), [['Newer', '']])
  assert.equal(h.action(KEY).label, 'Contribute')
})

test('triggers during a card read run one more read after it, not another alongside', async () => {
  const gate = deferred()
  let calls = 0
  const h = harness({ ids: ['one'], records: [prepared('one')], loadExact: async (id, store) => { calls += 1; if (calls === 1) await gate.promise; return structuredClone(store.get(id)) } })
  h.session.start(); await tick()
  h.session.refresh('turn'); h.session.refresh('turn'); h.session.refresh('turn'); await tick()
  assert.equal(calls, 1)
  gate.resolve(); await tick(12)
  assert.equal(calls, 2, 'one coalesced rerun')
})

// ---- End to end through the app's own protocol adapter, as the frame runs it.
async function hostEnvelope(session, generation) {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return { sessionId: session.sessionId, generation, actions: session.actions, items: session.items, features: session.features,
    checkpoint: null, retain: false, recoveryError: null, ...(session.context ? { context: session.context } : {}) }
  const { blockSessionEnvelope } = await import(`${BLOCKS}/src/components/AppCanvas/appBlockSessionHost.js`)
  return blockSessionEnvelope(session, generation)
}
// Whether the host named by MOBIUS_BLOCKS_FRONTEND (if any) attests a chat.
async function hostAttests() {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return true
  const { SESSION_FEATURES = [] } = await import(`${BLOCKS}/src/components/ChatView/markdown/appBlockSession.js`)
  return SESSION_FEATURES.includes('rows-v2')
}
// A frame wired as in production: the host envelope and window messages reach
// the card only through connectInlineSession. `fence` is the printed card
// ({ intent, actions, items }); `features` and `context` model the host.
async function wired({ context = { chatId: CHAT, latest: true, intent: CHAT_INTENT }, features = ['row-state', 'rows-v2'], records, loadExact = null,
  fence = null }) {
  const listeners = new Set(), posted = []
  const parent = { postMessage: message => posted.push(structuredClone(message)) }
  globalThis.window = { parent, location: { origin: 'https://mobius.example' },
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  const store = new Map(records.map(record => [record.id, record]))
  const needs = [], sends = []
  const ids = records.map(record => record.id)
  const { actions, items } = fence || { actions: [{ key: printedKey(ids), label: ids.length === 1 ? 'Contribute' : 'Contribute all' }], items: reviewItems(ids) }
  const key = actions[0].key
  const envelope = latest => hostEnvelope({ sessionId: 'e2e', actions: actions.map(action => ({ key: action.key, intent: action.key, label: action.label })),
    items, features, ...(context ? { context: { ...context, ...(latest === undefined ? {} : { latest }) } } : {}) }, 3)
  const connection = connectInlineSession({ blockSession: await envelope(), onNeedRuntime: ids => needs.push(ids),
    loadExact: id => loadExact ? loadExact(id, store) : Promise.resolve(store.has(id) ? structuredClone(store.get(id)) : null) })
  const deliver = data => [...listeners].forEach(fn => fn({ source: parent, origin: 'https://mobius.example', data }))
  let nonce = 0
  const fire = event => deliver({ type: 'moebius:app-block-action', sessionId: 'e2e', generation: 3, key, event, nonce: `e${++nonce}` })
  const provide = () => connection.updateRuntime({ records: [...store.values()], ledgerReady: true, ledger: 'current', connection: 'connected', frozenBinding: true,
    reviewStatus: serverReviewStatus(needs.at(-1) || [], store), refresh() {},
    send: async rec => { sends.push(rec.id); return { ok: true } }, sendStack: async recs => { sends.push(recs.map(rec => rec.id).join('+')); return { ok: true } } })
  const last = () => posted.at(-1)
  const action = () => last().actions.find(item => item.key === key)
  const confirmFlow = async () => { fire('activate'); await tick(12); provide(); await tick(); const confirming = action().confirming; fire('confirm'); await tick(12); return confirming }
  return { connection, deliver, fire, provide, last, action, confirmFlow, needs, sends, store, posted, envelope, key,
    done: () => { connection.dispose(); delete globalThis.window } }
}
// An older Möbius: no rows-v2 and no context (it ignores both), as each host shipped.
const OLD_HOSTS = [['row-state', ['row-state']], ['no row state', []]]
// The fence printed before this card (#144): a queue intent and the same action shape.
const oldFence = ids => ({ actions: [{ key: printedKey(ids), label: ids.length === 1 ? 'Contribute' : 'Contribute all' }], items: reviewItems(ids) })

test('end to end, new host and this card: the host envelope through the app\'s parser reaches Confirm and sends once', async t => {
  if (!await hostAttests()) return t.skip('this host does not attest a chat (no rows-v2)')
  const w = await wired({ records: [prepared('one'), prepared('two')] })
  await tick()
  assert.equal(w.last().type, 'moebius:app-block-state')
  assert.equal(w.last().generation, 3, 'reports carry the document generation')
  assert.deepEqual(w.last().rows.map(row => row.intent), ['review:one', 'review:two'])
  assert.deepEqual([w.action().label, w.action().hidden], ['Contribute all', false])
  assert.equal(await w.confirmFlow(), true)
  assert.deepEqual(w.needs, [['one', 'two']])
  w.store.set('one', published(prepared('one'), 11)); w.store.set('two', published(prepared('two'), 12))
  w.deliver({ type: 'moebius:app-block-refresh', sessionId: 'e2e', generation: 3, reason: 'turn' }); await tick(12)
  assert.deepEqual(w.sends.sort(), ['one', 'two'])
  assert.equal(w.last().title, '2 pull requests opened')
  // The host says a newer card now follows: the next init folds this one.
  w.deliver({ type: 'moebius:app-block-init', ...(await w.envelope(false)) }); await tick()
  assert.equal(w.last().title, CONTINUED_TITLE)
  w.done()
})

test('end to end, new host and an old card: this chat\'s status only, never a send', async t => {
  if (!await hostAttests()) return t.skip('this host does not attest a chat (no rows-v2)')
  for (const intent of ['reviews:queue', 'review:one']) {
    const w = await wired({ records: [prepared('one'), prepared('two', { record: { chat_id: OTHER, chat_ids: [OTHER] } })],
      context: { chatId: CHAT, latest: true, intent }, fence: oldFence(['one', 'two']) })
    await tick()
    assert.deepEqual(w.last().rows.map(row => row.intent), ['review:one'], 'another chat\'s record is not shown')
    assert.equal(w.action().hidden, true)
    await w.confirmFlow()
    assert.deepEqual([w.needs, w.sends], [[], []], intent)
    w.done()
  }
})

for (const [hostName, features] of OLD_HOSTS) {
  test(`end to end, older host (${hostName}) and this card: the earlier card, sending exactly its items`, async () => {
    // Records ready to send, plus one of the chat's records the card does not list.
    const records = [prepared('one'), prepared('two')]
    const w = await wired({ features, context: null, records: [...records, prepared('unlisted')], fence: {
      actions: [{ key: printedKey(['one', 'two']), label: 'Contribute all' }], items: reviewItems(['one', 'two']) } })
    await tick()
    assert.equal('rows' in w.last(), false, 'no ledger rows: the host draws the printed ones')
    assert.equal(await w.confirmFlow(), true, 'it reaches Confirm as before')
    assert.deepEqual(w.needs, [['one', 'two']], 'the check addresses exactly the items')
    assert.deepEqual(w.sends.sort(), ['one', 'two'], 'and it sends exactly the items')
    w.done()
  })

  test(`end to end, older host (${hostName}): an action that does not match the items, or an old card, behaves as before`, async () => {
    const mismatched = await wired({ features, context: null, records: [prepared('one'), prepared('two')], fence: {
      actions: [{ key: printedKey(['one', 'three']), label: 'Contribute all' }], items: reviewItems(['one', 'two']) } })
    await tick()
    assert.equal(await mismatched.confirmFlow(), false, 'a handle naming another set is refused, as before')
    assert.deepEqual(mismatched.sends, [])
    mismatched.done()
    const old = await wired({ features, context: null, records: [prepared('one')], fence: oldFence(['one']) })
    await tick()
    assert.equal(await old.confirmFlow(), true, 'an old single card sends its one record, as before')
    assert.deepEqual(old.sends, ['one'])
    old.done()
    // A new host outside a chat (no attested context) is treated the same way.
    if (features.length) {
      const outside = await wired({ features: ['row-state', 'rows-v2'], context: null, records: [prepared('one')], fence: oldFence(['one']) })
      await tick()
      assert.equal(await outside.confirmFlow(), true)
      assert.deepEqual(outside.sends, ['one'])
      outside.done()
    }
  })
}

test('end to end, a fresh read that fails on the tap holds the card instead of confirming a cached copy', async t => {
  if (!await hostAttests()) return t.skip('this host does not attest a chat (no rows-v2)')
  let failing = false
  const w = await wired({ records: [prepared('one')], loadExact: async (id, store) => { if (failing) throw new Error('offline'); return structuredClone(store.get(id)) } })
  await tick()
  assert.equal(w.last().rows[0].pill, undefined, 'read and ready')
  failing = true
  w.fire('activate'); await tick(12)
  w.provide(); await tick() // the runtime's ledger still has the record
  const state = w.last()
  assert.deepEqual([state.actions[0].confirming, state.actions[0].label, state.actions[0].note], [false, 'Try again', UNREAD_NOTE])
  assert.equal(state.rows[0].pill, HOLD.unread)
  failing = false
  w.fire('activate'); await tick(12)
  w.provide(); await tick()
  assert.equal(w.last().actions[0].confirming, true, 'Try again reads again and can then confirm')
  w.done()
})

test('a failed fresh read holds a row with a cached or ledger copy, named record or resolved successor', async () => {
  // Read once, then the record cannot be read: the cached copy is not used.
  let fail = new Set()
  const loadExact = async (id, store) => { if (fail.has(id)) throw new Error('offline'); return structuredClone(store.get(id)) }
  const h = harness({ ids: ['one'], records: [prepared('one')], loadExact })
  h.session.start(); await tick()
  fail = new Set(['one'])
  await openConfirm(h).catch(() => {})
  h.fire(KEY, 'activate'); await tick(12); h.provide(); await tick()
  assert.deepEqual([h.action(KEY).confirming, h.row('one').pill], [false, HOLD.unread])
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.length, 0)
  // A successor that read before and now fails holds the row too.
  fail = new Set()
  const chain = harness({ ids: ['old'], records: [prepared('old', { record: { status: 'superseded', superseded_by: 'new' } }), prepared('new')], loadExact })
  chain.session.start(); await tick(12)
  assert.equal(chain.row('new').pill, undefined)
  fail = new Set(['new'])
  chain.session.refresh('turn'); await tick(12)
  assert.equal(chain.row('new').pill, HOLD.unread)
  chain.fire(KEY, 'activate'); await tick(12); chain.provide(); await tick()
  assert.equal(chain.action(KEY).confirming, false)
})

// ---- The printed card, read as the host reads it.
function printedCard(records, ids = records.map(record => record.id), chatId = CHAT) {
  const ledger = mkdtempSync(join(tmpdir(), 'contribute-card-'))
  try {
    for (const record of records) writeFileSync(join(ledger, `${record.id}.json`), JSON.stringify(record))
    const run = spawnSync('python3', [new URL('../prepared_block.py', import.meta.url).pathname, ...ids, '--ledger-dir', ledger, '--chat-id', chatId], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    return JSON.parse(/```mobius-app\n(.*)\n```/s.exec(run.stdout)[1])
  } finally { rmSync(ledger, { recursive: true, force: true }) }
}
async function hostView(block) {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return { actions: [block.action].filter(Boolean).map(action => ({ key: action.intent, label: action.label })), items: block.items.map(({ intent }) => ({ intent })) }
  const { appBlockFromToken, blockActions, blockItems } = await import(`${BLOCKS}/src/components/ChatView/markdown/appBlock.js`)
  const parsed = appBlockFromToken({ type: 'code', lang: 'mobius-app', text: JSON.stringify(block) })
  assert.ok(parsed, 'the host accepts the printed card')
  assert.equal(parsed.expand, false)
  return { actions: blockActions(parsed).map(({ key, label }) => ({ key, label })), items: readBlockSession({ sessionId: 's', actions: [], items: blockItems(parsed) }).items }
}

test('the printed card reaches Confirm for the chat\'s waiting work, with the rows it printed', async () => {
  const shots = [{ name: 'before.png', sha256: 'e'.repeat(64), size: 1200, alt: 'Before' }, { name: 'after.png', sha256: 'e'.repeat(64), size: 1200, alt: 'After' }]
  const records = [prepared('one'), prepared('two', { plan: { screenshots: shots } }), prepared('three', { record: { created_at: '2026-10-01T00:00:00Z' } })]
  const block = printedCard(records, ['one', 'two'])
  assert.equal(block.intent, 'chat:contributions')
  assert.deepEqual(block.items.map(item => item.intent), ['review:one', 'review:two', 'review:three'], 'the chat\'s earlier prepared work joins')
  const view = await hostView(block)
  assert.deepEqual(view.actions, [{ key: printedKey(['one', 'two', 'three']), label: 'Contribute all' }], 'the earlier card\'s action, so an older host runs it as before')
  const h = harness({ actions: view.actions, items: view.items, records })
  await openConfirm(h)
  const state = h.action(KEY)
  assert.deepEqual(state.confirmation, block.items.map(({ title, facts }) => ({ title, facts })), 'Confirm\'s rows are the printed rows')
  assert.equal(block.items[1].facts[1].value, '1 file · +2 −0 · 2 screenshots')
  // A card printed for one stack layer lists the whole phase, so it reaches Confirm.
  const layers = [layer('base', 1, ''), layer('top', 2, 'base')]
  layers[1].plan.base_sha = layers[0].plan.head_sha
  const stackCard = await hostView(printedCard(layers, ['base']))
  assert.deepEqual(stackCard.items, reviewItems(['base', 'top']))
  const stacked = harness({ actions: stackCard.actions, items: stackCard.items, records: layers })
  await openConfirm(stacked)
  assert.deepEqual(stacked.action(KEY).confirmation.map(item => item.title), ['Change base', 'Change top'])
})

// The real host modules, when MOBIUS_BLOCKS_FRONTEND names a Möbius frontend.
async function hostRenderer(t) {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS || !frontendModules) { t.skip('set MOBIUS_BLOCKS_FRONTEND and MOBIUS_FRONTEND_NODE_MODULES to render the real host block'); return null }
  const markdown = `${BLOCKS}/src/components/ChatView/markdown`
  const stub = { name: 'stub-host', load(id) {
    if (id.endsWith('.css')) return { code: '', moduleType: 'js' }
    if (/AppCanvas\/AppCanvas\.jsx$|useAppBlockSession\.js$/.test(id)) return { code: 'export default function Stub() { return null }', moduleType: 'js' }
    return null
  } }
  return renderModule(`
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PassiveBlockView } from '${markdown}/PassiveAppBlock.jsx'
import { appBlockFromToken, blockActions, blockItems } from '${markdown}/appBlock.js'
import * as session from '${markdown}/appBlockSession.js'
export const features = session.SESSION_FEATURES ? [...session.SESSION_FEATURES] : []
export const parse = text => appBlockFromToken({ type: 'code', lang: 'mobius-app', text })
export const init = block => ({ actions: blockActions(block), items: blockItems(block) })
export function render(block, message, extra = {}) {
  const state = session.sessionState(message, message.sessionId, new Set(blockActions(block).map(action => action.key)), new Set(blockItems(block).map(item => item.intent)), block.app)
  return renderToStaticMarkup(createElement(PassiveBlockView, { block, app: { id: 1, name: 'Contribute', slug: 'contribute' },
    state, locked: false, onEvent() {}, onInternalNav() {}, ...extra }))
}`, [stub])
}

test('the host draws an old card as this chat\'s status rows, and only an open link without a chat', async t => {
  const host = await hostRenderer(t)
  if (!host) return
  const block = host.parse(JSON.stringify({ app: 'contribute', intent: 'review:one', title: 'Change one', interaction: 'inline',
    facts: [{ label: 'Repository', value: 'owner/repo' }, { label: 'Action', value: 'Open a new pull request' }],
    action: { label: 'Contribute', intent: 'chat-send:one' } }))
  const rendered = async (record, features, context) => {
    const h = harness({ ...host.init(block), features, context, records: [record] })
    h.session.start(); await tick()
    const { sessionId, ...body } = h.last()
    return host.render(block, { type: 'moebius:app-block-state', sessionId, ...body })
  }
  // Without the host's chat: the printed snapshot and a way into Contribute, nothing read.
  const actionFeatures = host.features.filter(feature => feature === 'row-state')
  const unattested = await rendered(published(prepared('one')), actionFeatures, null)
  assert.match(unattested, /<dt>Repository<\/dt><dd>owner\/repo<\/dd>/)
  assert.doesNotMatch(unattested, /pull\/7|is-success">Open/)
  if (actionFeatures.length) assert.match(unattested, /<a class="md-app-block__action is-secondary" href="[^"]*">Open Contribute<\/a>/)
  else assert.match(unattested, /<button[^>]*disabled=""[^>]*>Open Contribute<\/button>/)
  if (host.features.includes('rows-v2')) {
    const context = { chatId: CHAT, latest: true, intent: 'review:one' }
    const rows = await rendered(published(prepared('one')), host.features, context)
    assert.match(rows, /<p class="md-app-block__item-meta">owner\/repo · \+2 −0<\/p>/)
    assert.match(rows, /md-app-block__title-mark is-success/)
    assert.doesNotMatch(rows, /Open a new pull request|<footer>/, 'the saved facts give way to the app\'s rows')
    const elsewhere = await rendered(published(prepared('one', { record: { chat_id: OTHER, chat_ids: [OTHER] } })), host.features, context)
    assert.doesNotMatch(elsewhere, /pull\/7|Change one<\/a>/, 'another chat\'s record is not drawn')
  }
})

test('the host draws the live card: ledger rows, one action, a sent ending, and a folded earlier card', async t => {
  const host = await hostRenderer(t)
  if (!host) return
  if (!host.features.includes('rows-v2')) return t.skip('this host has no rows-v2')
  const records = [prepared('one', { plan: { title: 'Show confirmation rows in place', diff_stat: '4 files changed, 142 insertions(+), 38 deletions(-)' } }),
    prepared('two', { plan: { title: 'Calmer in-chat send states', diff_stat: '3 files changed, 88 insertions(+), 21 deletions(-)' } })]
  const block = host.parse(JSON.stringify(printedCard(records)))
  const render = async (options, extra) => {
    const h = harness({ ...host.init(block), features: host.features, records, ...options })
    h.session.start(); await tick()
    if (options.confirm) { h.fire(KEY, 'activate'); await tick(); h.provide(); await tick() }
    const { sessionId, ...body } = h.last()
    return host.render(block, { type: 'moebius:app-block-state', sessionId, ...body }, extra)
  }
  const ready = await render({})
  assert.match(ready, /<strong>2 contributions<\/strong>/)
  assert.match(ready, /intent=review%3Aone">Show confirmation rows in place<\/a><p class="md-app-block__item-meta">owner\/repo · \+142 −38<\/p>/)
  assert.doesNotMatch(ready, /From this conversation|<dt>|Rows from/, 'every row is the app\'s')
  assert.match(ready, /<footer>[^]*>Contribute all<\/button>/)
  const confirming = await render({ confirm: true })
  assert.match(confirming, /<li class="is-confirmation">[^]*<dt>Project<\/dt>/, 'Confirm\'s rows keep their labels')
  assert.match(confirming, />Not now<\/button><button[^>]*>Confirm<\/button>/)
  const sentRecords = records.map((record, n) => published(record, 3101 + n))
  const sent = await render({ records: sentRecords })
  assert.match(sent, /md-app-block__title-mark is-success[^]*<strong>2 pull requests<\/strong>/)
  assert.doesNotMatch(sent, /<footer>/, 'the button goes away')
  assert.match(sent, />#3101<svg[^]*md-app-block__pill is-success">Open</)
  const earlier = await render({ context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } }, { onJump() {} })
  assert.match(earlier, /<section class="md-app-block md-app-block--value-facts md-app-block--folded" aria-label="Continued below">/)
  assert.match(earlier, />Jump to latest<svg/)
})

// ---- Unchanged contracts.
const SHA = 'e'.repeat(64)
const shot = (name, alt = name) => ({ name, sha256: SHA, size: 1200, alt })
test('a recorded server failure after the attempt releases a recovered lock', () => {
  const attempt = { id: 'a1', unitKey: 'record:one', ids: ['one'], at: Date.parse('2026-10-20T10:30:00Z'), state: 'unknown' }
  const older = prepared('one', { record: { last_submit_error: 'old', updated_at: '2026-10-20T10:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', older]])).state, 'unknown')
  const newer = prepared('one', { record: { last_submit_error: 'Push rejected', updated_at: '2026-10-20T11:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', newer]])).state, 'failed')
  assert.equal(observeAttempt(attempt, new Map([['one', published(prepared('one'))]])).state, 'sent')
  const changed = prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T11:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', changed]])).state, 'unknown', 'a changed record is not proof nothing was sent')
})

test('the review-status address is bounded and adds only prepared layers of named stacks', () => {
  const records = [layer('base', 1, '', 'open'), layer('top', 2, 'base'), prepared('alone')]
  assert.deepEqual(reviewAddressFor(['top', 'alone', 'top'], records), ['top', 'alone'], 'a published layer needs no check')
  assert.deepEqual(reviewAddressFor(['missing'], records), ['missing'])
  assert.equal(reviewAddressFor(Array.from({ length: 60 }, (_, n) => `id${n}`), []).length, 50)
})

test('a card refresh runs one at a time, through the coordinator after the first ledger read, and reports completion', async () => {
  // The card runtime's refresh, executed from index.jsx's source.
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.match(app, /refresh: cardRefresh, refreshing: cardRefreshes\.running, refreshDone: cardRefreshes\.done,/)
  const body = app.match(/const cardRefresh = useCallback\((\(\) => \{[\s\S]*?\n  \}), \[/)?.[1]
  assert.ok(body, 'cardRefresh is defined')
  for (const ready of [false, true]) {
    const calls = [], states = []
    let finish
    const make = (...args) => new Function('ledgerReadyRef', 'cardRefreshRef', 'forceRefreshRef', 'refreshCoordinatorRef', 'refreshReviewStatus', 'setCardRefreshes', 'CARD_REFRESH_DEADLINE_MS', `return ${body}`)(...args, 20000)
    const forceRefreshRef = { current: false }
    let state = { running: false, done: 0 }
    const refresh = make({ current: ready }, { current: null }, forceRefreshRef,
      { current: () => { calls.push(['full refresh', forceRefreshRef.current]); return new Promise(done => { finish = done }) } },
      () => { calls.push(['review status']); return new Promise(done => { finish = done }) },
      update => { state = update(state); states.push(state) })
    const first = refresh(), second = refresh()
    assert.equal(first, second, 'a second Try again joins the running refresh')
    assert.deepEqual(calls, [ready ? ['full refresh', true] : ['review status']], `ledger ready: ${ready}`)
    assert.deepEqual(states, [{ running: true, done: 0 }])
    finish(); await first
    assert.deepEqual(states.at(-1), { running: false, done: 1, outcome: 'done' }, 'completion is reported once the refresh settles')
  }
})

test('only a whole Git shortstat line counts as a change size', () => {
  const sizeOf = diffStat => confirmationItem(prepared('s', { plan: { diff_stat: diffStat } })).facts.find(fact => fact.label === 'Change')?.value
  for (const [stat, size] of [
    [' 3 files changed, 40 insertions(+), 2 deletions(-)', '3 files · +40 −2'],
    ['1 file changed, 1 insertion(+)', '1 file · +1 −0'],
    [' 2 files changed, 7 deletions(-)\n', '2 files · +0 −7'],
    ['1 file changed', '1 file · +0 −0'],
  ]) assert.equal(sizeOf(stat), size, stat)
  for (const stat of ['1 file changed, lots of deletions', '2 files changed, 40 insertions(+), ??? deletions(-)',
    'about 1 file changed', '1 file changed, 2 insertions(+) and more', '1 file changed, 2 deletions(-), 3 insertions(+)',
    ' 3 files changed, 4 insertions(+)\n 1 file changed']) {
    assert.equal(sizeOf(stat), undefined, `unreadable: ${JSON.stringify(stat)}`)
  }
})

test('the card runtime reports the ledger as loading, current or incomplete', async () => {
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  const expression = app.match(/\n\s*ledger: ([^\n]+),\n/)?.[1]
  assert.ok(expression, 'the runtime exposes ledger')
  const state = (ledgerReady, current) => new Function('ledgerReady', 'ledgerCurrentRef', `return ${expression}`)(ledgerReady, { current })
  assert.equal(state(false, false), 'loading')
  assert.equal(state(true, true), 'current')
  assert.equal(state(true, false), 'incomplete')
})

test('a card refresh settles as failed after its deadline or a rejection, never leaving the card waiting', async t => {
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  const deadline = Number(app.match(/export const CARD_REFRESH_DEADLINE_MS = (\d+)/)?.[1])
  assert.ok(deadline >= 10000 && deadline <= 30000, 'one named deadline of about 20 s')
  const body = app.match(/const cardRefresh = useCallback\((\(\) => \{[\s\S]*?\n  \}), \[/)?.[1]
  const make = (work, onState) => new Function('ledgerReadyRef', 'cardRefreshRef', 'forceRefreshRef', 'refreshCoordinatorRef', 'refreshReviewStatus', 'setCardRefreshes', 'CARD_REFRESH_DEADLINE_MS', `return ${body}`)(
    { current: true }, { current: null }, { current: false }, { current: work }, work, update => onState(update), deadline)
  // A read that never settles.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let state = { running: false, done: 0 }
  const hung = make(() => new Promise(() => {}), update => { state = update(state) })()
  assert.deepEqual(state, { running: true, done: 0 })
  t.mock.timers.tick(deadline - 1); await Promise.resolve()
  assert.equal(state.running, true, 'still running before the deadline')
  t.mock.timers.tick(1); await hung
  assert.deepEqual(state, { running: false, done: 1, outcome: 'timeout' }, 'the deadline completes the refresh as a timeout')
  t.mock.timers.reset()
  // A rejected read: completed, and no unhandled rejection.
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    state = { running: false, done: 0 }
    await make(() => Promise.reject(new Error('listing failed')), update => { state = update(state) })()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(state, { running: false, done: 1, outcome: 'failed' })
    assert.deepEqual(unhandled, [])
  } finally { process.off('unhandledRejection', onUnhandled) }
})

test('Confirm names the screenshots a new pull request will publish on its Change line', () => {
  const body = '## Summary\n\nFixes the clipped title.\n\n| Before | After |\n| --- | --- |\n| ![Before](screenshot:before.png) | ![After](screenshot:after.png) |'
  const item = confirmationItem(prepared('shots', { plan: { body_draft: body, screenshots: [shot('before.png'), shot('after.png')] } }))
  assert.equal(item.facts.find(fact => fact.label === 'Change').value, '1 file · +2 −0 · 2 screenshots')
  assert.equal(item.facts.some(fact => fact.label === 'Screenshots'), false, 'on the Change line, as on the card')
  assert.ok(item.facts.every(fact => !/screenshot:/.test(fact.value)))
  assert.equal(confirmationItem(prepared('one', { plan: { screenshots: [shot('one.png')] } })).facts.find(fact => fact.label === 'Change').value,
    '1 file · +2 −0 · 1 screenshot')

  // Malformed entries are not counted; none at all leaves the Change line as is.
  const plain = confirmationItem(prepared('plain', { plan: { screenshots: [{ name: '../x.png', sha256: SHA }, { name: 'ok.png', sha256: 'short' }] } }))
  assert.equal(plain.facts.find(fact => fact.label === 'Change').value, '1 file · +2 −0')

  // Without a readable diff stat, the count still gets its own Change line.
  const unsized = confirmationItem(prepared('unsized', { plan: { diff_stat: '', screenshots: [shot('a.png')] } }))
  assert.equal(unsized.facts.find(fact => fact.label === 'Change')?.value, '1 screenshot')

  const base = layer('base', 1, '')
  const full = confirmationItem({ ...base, plan: { ...base.plan, diff_stat: '1 file changed, 1 insertion(+)', screenshots: [shot('a.png'), shot('b.png')] } })
  assert.equal(full.facts.find(fact => fact.label === 'Change').value, '1 file · +1 −0 · 2 screenshots')
})

test('the B2 host accepts a confirmation that names screenshots', async t => {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return t.skip('set MOBIUS_BLOCKS_FRONTEND to a Möbius frontend with the passive block host to run this check')
  const b2 = await import(`${BLOCKS}/src/components/ChatView/markdown/appBlockSession.js`)
  const base = layer('base', 1, '')
  const items = [
    confirmationItem(prepared('shots', { plan: { body_draft: '![Before](screenshot:a.png)\n\nFix.', screenshots: [shot('a.png'), shot('b.png')] } })),
    confirmationItem({ ...base, plan: { ...base.plan, diff_stat: '1 file changed, 1 insertion(+)', screenshots: [shot('a.png')] } }),
  ]
  const parsed = b2.confirmationOf(items)
  assert.ok(parsed, 'the host rejected the list, which would keep Confirm disabled')
  assert.equal(parsed[0].facts.find(fact => fact.label === 'Change').value, '1 file · +2 −0 · 2 screenshots')
  assert.match(parsed[1].facts.find(fact => fact.label === 'Change').value, /1 screenshot$/)
})

// ---- Observation settles an unknown send (publication-observer.js, mobius #2083/#2084).
// The platform answers what it read on GitHub; the card only shows it and
// never sends again. `answers` is the sequence the platform gives.
function observing(answers) {
  const calls = []
  const observe = async (record, store) => {
    calls.push(record.id)
    const answer = typeof answers === 'function' ? answers(record, store, calls.length) : answers[Math.min(calls.length, answers.length) - 1]
    return answer ?? null
  }
  return { calls, observe }
}

test('a lost response settles from observation alone: the PR shows without a resend or the ledger changing first', async () => {
  const c = clock()
  const o = observing((record) => ({ outcome: 'settled', record: published(prepared(record.id), 21) }))
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }), observe: o.observe }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.row('one').pill, 'Checking GitHub')
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.deepEqual(o.calls, ['one'], 'the recheck asked the platform to observe once')
  assert.equal(h.store.get('one').status, 'prepared', 'the local ledger copy never moved')
  assert.deepEqual(h.row('one').links, [{ label: '#21', url: 'https://github.com/owner/repo/pull/21' }])
  assert.equal(h.last().title, 'Pull request opened')
  assert.equal(h.action(KEY).hidden, true)
  assert.equal(h.last().checkpoint, null, 'nothing unresolved crosses a reload')
  assert.equal(c.pending().length, 0, 'nothing left to check')
  assert.equal(h.sends.length, 1, 'never sent twice')
})

test('a published branch whose PR is not confirmed keeps Checking GitHub and keeps asking within the window', async () => {
  const c = clock()
  const o = observing(() => ({ outcome: 'pending', effect: 'branch_published' }))
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }), observe: o.observe }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  await c.advance(RECHECK_DELAYS_MS[1])
  assert.equal(o.calls.length, 2)
  assert.deepEqual([h.row('one').pill, h.row('one').busy], ['Checking GitHub', true])
  assert.deepEqual([h.action(KEY).label, h.action(KEY).disabled], ['Checking…', true])
  assert.equal(h.last().title, 'Sending 1')
  h.fire(KEY, 'activate'); await tick()
  assert.equal(h.action(KEY).confirming, false, 'still locked')
  // The window and its fallback stay: after it, Not confirmed and Contribute.
  for (let i = 0; i < 30 && c.pending().length; i++) await c.advance(60000)
  assert.equal(h.row('one').pill, 'Not confirmed')
  assert.equal(h.action(KEY).open, true)
  assert.ok(h.last().checkpoint, 'still unresolved across a reload')
  assert.equal(h.sends.length, 1)
})

test('a target that changed holds the row with publication_changed, stops checking and stays locked', async () => {
  const c = clock()
  const o = observing(() => ({ outcome: 'changed', message: 'The signed publication claim no longer matches this review.' }))
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }), observe: o.observe }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.deepEqual([h.row('one').pill, h.row('one').tone, h.row('one').busy], [CHANGED_PILL, 'attention', false])
  assert.deepEqual([h.last().title, h.last().titleTone], [CHANGED_PILL, 'attention'])
  const state = h.action(KEY)
  assert.deepEqual([state.open, state.label, state.busy], [true, 'Open Contribute', false], 'without ask-v1 the action opens Contribute')
  assert.equal(c.pending().length, 0, 'a changed answer is final: no more checks')
  assert.equal(o.calls.length, 1)
  h.fire(KEY, 'activate'); await tick()
  assert.equal(h.action(KEY).confirming, false, 'a changed target is not proof nothing was sent')
  assert.ok(h.last().checkpoint)
  assert.equal(PUBLICATION_CHANGED, 'publication_changed')
  assert.equal(h.sends.length, 1)
})

test('an update Autopilot owns is left to Autopilot with a neutral status', async () => {
  const c = clock()
  // The platform's real answer carries no attempt context: Autopilot comes
  // from the record's own Autopilot grant.
  const o = observing(() => ({ outcome: 'not_eligible', message: 'Autopilot recovers its own update; checking never settles or retires it.' }))
  const h = timed({ ids: ['one'], records: [prepared('one', { record: { autopilot: { enabled: true, state: 'idle' } } })], send: () => ({ uncertain: true }), observe: o.observe }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.deepEqual([h.row('one').pill, h.row('one').tone, h.row('one').busy], [AUTOPILOT_PILL, 'neutral', false])
  assert.deepEqual([h.last().title, h.last().titleTone], [AUTOPILOT_PILL, 'neutral'])
  assert.equal(c.pending().length, 0, 'the card stops checking')
  assert.equal(o.calls.length, 1)
  assert.equal(h.action(KEY).confirming, false)
  assert.equal(h.sends.length, 1)
  // Another record the platform does not observe keeps today's checking.
  const other = observing(() => ({ outcome: 'not_eligible' }))
  const k = timed({ ids: ['two'], records: [prepared('two')], send: () => ({ uncertain: true }), observe: other.observe }, c)
  await openConfirm(k)
  k.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0]); await c.advance(RECHECK_DELAYS_MS[1])
  assert.equal(other.calls.length, 1, 'asked once, then left alone')
  assert.equal(k.row('two').pill, 'Checking GitHub')
  k.store.set('two', published(prepared('two'), 4)); await c.advance(RECHECK_DELAYS_MS[2])
  assert.equal(k.last().title, 'Pull request opened', 'the ledger re-read still settles it')
})

test('an older Möbius without the observe route keeps the ledger-only recheck', async () => {
  const c = clock()
  const o = observing(() => ({ outcome: 'unsupported' }))
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }), observe: o.observe }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0]); await c.advance(RECHECK_DELAYS_MS[1])
  assert.equal(o.calls.length, 1, 'the route is not asked for again')
  assert.equal(h.row('one').pill, 'Checking GitHub')
  h.store.set('one', published(prepared('one'), 9)); await c.advance(RECHECK_DELAYS_MS[2])
  assert.deepEqual(h.row('one').links, [{ label: '#9', url: 'https://github.com/owner/repo/pull/9' }])
  assert.equal(h.sends.length, 1)
})

test('a reloaded card observes its restored unknown send once, even past the window, and never sends', async () => {
  const c = clock()
  const old = encodeCheckpoint([{ id: 'a1', unitKey: 'record:one', ids: ['one'], at: c.now() - RECHECK_WINDOW_MS - 1, state: 'unknown' }])
  const o = observing(record => ({ outcome: 'settled', record: published(prepared(record.id), 30) }))
  let sent = 0
  const h = timed({ ids: ['one'], records: [prepared('one')], checkpoint: { id: 'cp', data: old }, retain: true, observe: o.observe,
    runtime: { send: () => { sent += 1 }, sendStack: () => { sent += 1 } } }, c)
  h.session.start(); await tick()
  assert.deepEqual(o.calls, ['one'])
  assert.equal(h.last().title, 'Pull request opened')
  assert.equal(h.last().checkpoint, null)
  assert.equal(h.sends.length + sent, 0, 'observation never sends')
})

test('an unconfirmed 503 saved on the record is not a refusal: the row checks and stays locked', async () => {
  const attempt = { id: 'a1', unitKey: 'record:one', ids: ['one'], at: Date.parse('2026-10-20T10:30:00Z'), state: 'unknown' }
  const unconfirmed = prepared('one', { record: { last_submit_error: 'GitHub has not confirmed', last_submit_error_code: 'publication_unconfirmed', updated_at: '2026-10-20T11:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', unconfirmed]])).state, 'unknown')
  assert.equal(localHold(unconfirmed), HOLD.checking)
  const pushed = prepared('one', { record: { last_submit_stage: 'push_ambiguous', last_submit_error: 'Push outcome unknown', updated_at: '2026-10-20T11:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', pushed]])).state, 'unknown')
  const h = harness({ ids: ['one'], records: [unconfirmed] })
  await openConfirm(h)
  assert.deepEqual(h.pills(), [['one', HOLD.checking]])
  assert.equal(h.action(KEY).confirming, false)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.length, 0)
})

test('the card and the app refresh share one observer: one request at a time, then backoff after no answer', async () => {
  const c = clock()
  const gate = deferred()
  let requests = 0
  const observer = createPublicationObserver({ now: c.now, observe: () => { requests += 1; return requests === 1 ? gate.promise : Promise.reject(new Error('offline')) } })
  const unknown = prepared('one', { record: { status: 'submitting', updated_at: '2026-10-20T10:00:00Z' } })
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }), observe: record => observer.check(record) }, c)
  await openConfirm(h)
  h.store.set('one', unknown)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  // The app's refresh sweeps the same record while the card's request runs.
  const settledRows = []
  const sweep = observer.sweep([unknown], record => settledRows.push(record))
  await tick()
  assert.equal(requests, 1, 'one request serves the card and the refresh')
  gate.resolve({ outcome: 'transport' }); await sweep; await tick()
  assert.deepEqual(settledRows, [])
  // No answer: the next request waits for the backoff, whoever asks.
  await observer.sweep([unknown]); await tick()
  assert.equal(requests, 1, 'still backing off')
  assert.ok(RECHECK_DELAYS_MS[1] > TRANSPORT_BACKOFF_MS[0])
  await c.advance(RECHECK_DELAYS_MS[1])
  assert.equal(requests, 2, 'the card asked again once the backoff passed')
  // A second miss waits longer than the card's next recheck.
  assert.ok(RECHECK_DELAYS_MS[2] < TRANSPORT_BACKOFF_MS[1])
  await c.advance(RECHECK_DELAYS_MS[2])
  assert.equal(requests, 2, 'the longer backoff holds')
  assert.equal(h.row('one').pill, 'Checking GitHub', 'no answer is not an outcome')
  assert.equal(h.sends.length, 1)
})

// ---- Review regressions (app-observer-wiring.md B2, B4): the reviewer's probes.
test('B4: a changed finding expires when the record gets a new version, which is observed afresh', async () => {
  const c = clock()
  let calls = 0
  const h = timed({ ids: ['one'], records: [prepared('one')], send: () => ({ uncertain: true }),
    observe: async () => { calls += 1; return { outcome: calls === 1 ? 'changed' : 'pending' } } }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.equal(h.row('one').pill, CHANGED_PILL)
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z', last_submit_error_code: 'publication_unconfirmed' } }))
  h.session.refresh('turn'); await tick(); h.provide(); await tick()
  assert.equal(calls, 2, 'the new version was observed')
  assert.equal(h.row('one').pill, 'Checking GitHub')
  assert.ok(c.pending().length > 0, 'checking resumed')
  assert.equal(h.sends.length, 1)
})

test('B4: a late settlement for an older version never overwrites a newer exact read', async () => {
  const c = clock()
  const gate = deferred()
  const old = prepared('one')
  const h = timed({ ids: ['one'], records: [old], send: () => ({ uncertain: true }), observe: () => gate.promise }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z', last_submit_error_code: 'publication_unconfirmed' } }))
  h.session.refresh('turn'); await tick()
  gate.resolve({ outcome: 'settled', record: published(old, 7) }); await tick()
  assert.notEqual(h.last().title, 'Pull request opened')
  assert.deepEqual(h.row('one').links, [])
  assert.ok(h.last().checkpoint, 'the unknown attempt is still owned')
  assert.equal(h.sends.length, 1)
})

test('B2: a saved post-push error keeps the attempt unknown and the row checking', async () => {
  const attempt = { id: 'a1', unitKey: 'record:one', ids: ['one'], at: Date.parse('2026-10-20T10:30:00Z'), state: 'unknown' }
  const pushed = prepared('one', { record: { last_submit_stage: 'pushed', last_submit_push_sha: HEAD,
    last_submit_error: 'GitHub command failed. The branch was pushed.', updated_at: '2026-10-20T11:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', pushed]])).state, 'unknown')
  assert.equal(localHold(pushed), HOLD.checking)
  const c = clock()
  const h = timed({ ids: ['one'], records: [prepared('one')], observe: async () => ({ outcome: 'pending', effect: 'branch_published' }),
    send: rec => { h.store.set(rec.id, pushed); return { error: pushed.last_submit_error, record: pushed, failure: { status: 409, code: '' }, uncertain: true } } }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.equal(h.row('one').pill, 'Checking GitHub')
  assert.ok(h.last().checkpoint)
})

// ---- "Fix in chat" (`ask-v1`): a held row asks this chat's agent, by code.
const ASKS = ['row-state', 'rows-v2', 'ask-v1']
const refsOf = h => h.last().ask?.refs.map(ref => [ref.id, ref.code]) || null

test('without ask-v1 a held card reports no ask and still opens Contribute', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one', { record: { quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD } } })] })
  h.session.start(); await tick()
  assert.equal('ask' in h.last(), false)
  assert.deepEqual([h.action(KEY).open, h.action(KEY).label], [true, 'Open Contribute'])
})

test('a held row becomes Fix in chat with its record id and code, before any tap', async () => {
  const cases = [
    [{ quality_review: { state: 'all_clear', reviewed_head_sha: NEXT } }, 'needs_review'],
    [{ quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD } }, 'changes_needed'],
    [{ last_submit_error: 'remote: rejected https://example.com <b>x</b>' }, 'send_failed'],
    [{ last_submit_error: 'x', last_submit_error_code: 'commit_identity_mismatch' }, 'commit_identity_mismatch'],
    [{ last_submit_error: 'x', last_submit_error_code: 'invalid_pr_text' }, 'invalid_pr_text'],
    [{ last_submit_error: 'x', last_submit_error_code: 'publication_destination_unavailable' }, 'publication_destination_unavailable'],
    [{ needs_attention: true }, 'needs_attention'],
  ]
  for (const [record, code] of cases) {
    const h = harness({ ids: ['one', 'two'], features: ASKS, records: [prepared('one', { record }), prepared('two')] })
    h.session.start(); await tick()
    const rev = h.last().ask.refs[0].rev
    assert.deepEqual(h.last().ask, { refs: [{ id: 'one', code, rev }] }, code)
    assert.match(rev, /^[0-9a-f]{7,64}$/)
    // The action stays as the fallback the host replaces.
    assert.deepEqual([h.action(KEY).open, h.action(KEY).label], [true, 'Open Contribute'])
    assert.equal(h.last().title, '1 needs a fix')
  }
  const ready = harness({ ids: ['one'], features: ASKS, records: [prepared('one')] })
  ready.session.start(); await tick()
  assert.equal(ready.last().ask, null, 'a ready card asks nothing')
  assert.equal(ready.action(KEY).label, 'Contribute')
})

test('the tap\'s source check names conflicts, a moved base and commit identity by code', async () => {
  for (const [code, pill] of [['upstream_conflict', 'Conflicts'], ['upstream_base_moved', 'Upstream moved'],
    ['commit_identity_mismatch', 'Wrong author'], ['invalid_pr_text', 'Text not valid'], ['branch_moved', HOLD.source]]) {
    const h = harness({ ids: ['one'], features: ASKS, records: [prepared('one')],
      runtime: { reviewStatus: { state: 'ready', addressed: ['one'], byId: { one: { state: 'needs_refresh', code } } } } })
    await openConfirm(h)
    assert.equal(h.action(KEY).confirming, false)
    assert.deepEqual(h.pills(), [['one', pill]], code)
    assert.deepEqual(refsOf(h), [['one', code === 'branch_moved' ? 'source_changed' : code]])
    h.fire(KEY, 'confirm'); await tick()
    assert.deepEqual(h.sends, [])
  }
})

test('a missing named record, an incomplete stack and an expired unknown send are asks too', async () => {
  const missing = harness({ ids: ['gone', 'two'], features: ASKS, records: [prepared('two')] })
  missing.session.start(); await tick()
  assert.deepEqual(refsOf(missing), [['gone', 'not_in_contribute']])
  const records = [layer('base', 1, ''), layer('top', 2, 'base')]
  records[1].plan.base_sha = records[0].plan.head_sha
  const stack = harness({ ids: ['base'], features: ASKS, records })
  await openConfirm(stack)
  assert.deepEqual(refsOf(stack), [['base', 'stack_incomplete']])
  const c = clock()
  const h = timed({ ids: ['one'], features: ASKS, records: [prepared('one')], send: () => ({ uncertain: true }) }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.last().ask, null, 'nothing is asked while the result is still being checked')
  for (let i = 0; i < 20 && c.pending().length; i++) await c.advance(60000)
  assert.deepEqual(refsOf(h), [['one', 'result_unknown']])
  assert.equal(h.sends.length, 1, 'an ask never sends again')
})

test('the GitHub connection is the owner\'s: a named account action, never an ask', async () => {
  const off = harness({ ids: ['one'], features: ASKS, records: [prepared('one')], runtime: { connection: 'disconnected' } })
  await openConfirm(off)
  assert.equal(off.last().ask, null)
  assert.deepEqual([off.action(KEY).open, off.action(KEY).label, off.action(KEY).note], [true, 'Connect GitHub', ''])
  const reconnect = harness({ ids: ['one'], features: ASKS, records: [prepared('one')],
    runtime: { reviewStatus: { state: 'ready', addressed: ['one'], byId: { one: { state: 'unavailable', code: 'github_reconnect' } } } } })
  await openConfirm(reconnect)
  assert.equal(reconnect.last().ask, null)
  assert.deepEqual([reconnect.action(KEY).open, reconnect.action(KEY).label], [true, 'Reconnect GitHub'])
  const failed = harness({ ids: ['one'], features: ASKS, records: [prepared('one', { record: { last_submit_error: 'x', last_submit_error_code: 'github_reconnect' } })] })
  failed.session.start(); await tick()
  assert.equal(failed.last().ask, null)
  assert.equal(failed.action(KEY).label, 'Reconnect GitHub')
})

test('a retryable check, a confirmation, a send in progress and an older card never ask', async () => {
  const retry = harness({ ids: ['one'], features: ASKS, records: [prepared('one')],
    runtime: { reviewStatus: { state: 'ready', addressed: ['one'], byId: { one: { state: 'unavailable', code: 'review_unavailable' } } } } })
  await openConfirm(retry)
  assert.deepEqual([retry.action(KEY).label, retry.last().ask], ['Try again', null])
  const confirming = harness({ ids: ['one'], features: ASKS, records: [prepared('one')] })
  await openConfirm(confirming)
  assert.deepEqual([confirming.action(KEY).confirming, confirming.last().ask], [true, null])
  const gate = deferred()
  const sending = harness({ ids: ['one'], features: ASKS, records: [prepared('one')], send: () => gate.promise })
  await openConfirm(sending)
  sending.fire(KEY, 'confirm'); await tick()
  assert.equal(sending.last().ask, null)
  gate.resolve({ ok: true }); await tick()
  const held = prepared('one', { record: { needs_attention: true } })
  const older = harness({ ids: ['one'], features: ASKS, records: [held], context: { chatId: CHAT, latest: false, intent: CHAT_INTENT } })
  older.session.start(); await tick()
  assert.equal(older.last().ask, null)
  const relay = harness({ ids: ['one'], features: ASKS, records: [prepared('one', { record: { submission_mode: 'mobius-bot' } })] })
  relay.session.start(); await tick()
  assert.deepEqual([relay.last().ask, relay.action(KEY).label], [null, 'Open Contribute'], 'a relay record is sent in Contribute')
})

test('after the agent fixes and re-stages, the next turn hint brings Contribute back', async () => {
  const h = harness({ ids: ['one'], features: ASKS, records: [prepared('one', { record: { quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD } } })] })
  h.session.start(); await tick()
  assert.deepEqual(refsOf(h), [['one', 'changes_needed']])
  const before = h.last().ask.refs[0].rev
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z', quality_review: { state: 'changes_needed', reviewed_head_sha: NEXT } } }))
  h.session.refresh('turn'); await tick()
  assert.notEqual(h.last().ask.refs[0].rev, before, 'a restaged version is a new state, so it can be asked about again')
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:30:00Z' } }))
  h.session.refresh('turn'); await tick()
  assert.equal(h.last().ask, null)
  assert.deepEqual([h.action(KEY).label, h.action(KEY).open], ['Contribute', false])
})

test('every ask the card builds is one the host accepts and words itself', async t => {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return t.skip('set MOBIUS_BLOCKS_FRONTEND to a Möbius frontend with the passive block host to run this check')
  const host = await import(`${BLOCKS}/src/components/ChatView/markdown/appBlockSession.js`)
  if (!host.askMessage) return t.skip('this Möbius frontend predates ask-v1')
  const { ASK_CODES, cardAsk } = await import('../card-asks.js')
  for (const code of ASK_CODES) {
    const ask = cardAsk('contribute-card-states-20261106', code, 'a'.repeat(40))
    assert.deepEqual(host.sessionAsk(ask), ask, code)
    assert.equal(host.askMessage('contribute', ask),
      `Please fix what the contribute card in this chat flagged:\n\n\`contribute · contribute-card-states-20261106 · ${code}\``)
  }
})

// ---- Observation through Fix in chat (`ask-v1`).
test('a changed target asks publication_changed; Autopilot and Checking GitHub ask nothing', async () => {
  const c = clock()
  const h = timed({ ids: ['one'], features: ASKS, records: [prepared('one')], send: () => ({ uncertain: true }),
    observe: async () => ({ outcome: 'changed' }) }, c)
  await openConfirm(h)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.last().ask, null, 'Checking GitHub asks nothing')
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.equal(h.row('one').pill, CHANGED_PILL)
  assert.deepEqual(refsOf(h), [['one', PUBLICATION_CHANGED]], 'changed comes before result_unknown, even within the window')
  const rev = h.last().ask.refs[0].rev
  // An unrelated write that keeps the attempt and source is the same state.
  h.store.set('one', { ...prepared('one'), updated_at: '2026-10-20T10:40:00Z' }); h.session.refresh('turn'); await tick()
  assert.equal(h.row('one').pill, CHANGED_PILL, 'the new version was observed again')
  assert.equal(h.last().ask.refs[0].rev, rev, 'the same changed state asks once')
  assert.equal(h.sends.length, 1, 'an ask never sends again')

  const a = timed({ ids: ['two'], features: ASKS, records: [prepared('two', { record: { autopilot: { enabled: true } } })], send: () => ({ uncertain: true }),
    observe: async () => ({ outcome: 'not_eligible' }) }, c)
  await openConfirm(a)
  a.fire(KEY, 'confirm'); await tick()
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.equal(a.row('two').pill, AUTOPILOT_PILL)
  assert.equal(a.last().ask, null, 'Autopilot owns it: no ask')
  for (let i = 0; i < 20 && c.pending().length; i++) await c.advance(60000)
  assert.equal(a.last().ask, null, 'still no ask after the window')

  // A newly opened card on a record whose saved send may be public: Checking GitHub, no ask.
  const saved = harness({ ids: ['three'], features: ASKS, records: [prepared('three', { record: { last_submit_error: 'x', last_submit_error_code: 'publication_unconfirmed' } })] })
  await openConfirm(saved)
  assert.deepEqual(saved.pills(), [['three', HOLD.checking]])
  assert.equal(saved.last().ask, null)
})

test('an incomplete record whose saved send may be public shows Checking GitHub and never asks restage', async () => {
  const shapes = {
    unconfirmed: { last_submit_error: 'May be public', last_submit_error_code: 'publication_unconfirmed' },
    pushed: { last_submit_stage: 'pushed', last_submit_error: 'The branch was pushed.' },
    ambiguous: { last_submit_stage: 'push_ambiguous' },
  }
  for (const [name, fields] of Object.entries(shapes)) {
    for (const [gap, plan] of Object.entries({ size: { diff_stat: '' }, identity: { branch: '' } })) {
      const record = prepared('one', { plan, record: fields })
      // The reviewer's probe: a fresh card, before any tap.
      const fresh = harness({ ids: ['one'], features: ASKS, records: [record] })
      fresh.session.start(); await tick()
      assert.deepEqual(fresh.pills(), [['one', HOLD.checking]], `${name} ${gap}`)
      assert.equal(fresh.last().ask, null, `${name} ${gap} before a tap`)
      // And after the tap's check.
      const tapped = harness({ ids: ['one'], features: ASKS, records: [record] })
      await openConfirm(tapped)
      assert.equal(tapped.last().ask, null, `${name} ${gap} after a tap`)
      assert.equal(tapped.action(KEY).confirming, false)
      assert.equal(tapped.sends.length, 0)
    }
  }
  // The same incomplete record without a possibly-public send still asks restage.
  const plain = harness({ ids: ['one'], features: ASKS, records: [prepared('one', { plan: { diff_stat: '' } })] })
  plain.session.start(); await tick()
  assert.deepEqual(refsOf(plain), [['one', 'restage']])
})
