import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHAT_ACTION, cardKind, hintedIds, inChat } from '../chat-blocks.js'
import { frontendModules, renderModule } from './render-harness.mjs'
import { readBlockSession } from '../block-protocol.js'
import { reviewAddressFor } from '../send-readiness.js'
import { attemptOutcome, confirmationItem, CONTINUED_TITLE, EXPIRED_NOTE, HOLD, LEDGER_NOTE, LEGACY_NOTE, NEWER_NOTE, RECHECK_DELAYS_MS, RECHECK_WINDOW_MS, RECOVERY_NOTE,
  REFRESH_FAILED_NOTE, REVIEW_REUSE_MS, TIMEOUT_NOTE, UNCHECKED_NOTE, VISIBLE_REREAD_MS, createInlineSession, decodeCheckpoint, encodeCheckpoint, localHold, observeAttempt, rowMeta } from '../inline-session.js'

const HEAD = 'a'.repeat(40), NEXT = 'c'.repeat(40)
// The chat the host attests the card is in, and another one.
const CHAT = '00000000-0000-4000-8000-00000000c4a7', OTHER = '9b1c7a52-0d3e-4f1a-8c55-2e6f4b7d9a10'
const KEY = CHAT_ACTION
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
function harness({ ids = null, actions = card(ids).actions, items = card(ids || []).items, features = ['row-state', 'rows-v2'], context = { chatId: CHAT, latest: true },
  records, checkpoint = null, retain = false, send, sendStack, address = null, loadExact = null, runtime: extra = {}, timers, now }) {
  const store = new Map(records.map(record => [record.id, record]))
  const states = [], sends = [], needs = [], reads = []
  const session = createInlineSession({ sessionId: 'session-1', actions, items, features, context, checkpoint, retain, publish: state => states.push(structuredClone(state)),
    loadExact: id => { reads.push(id); return loadExact ? loadExact(id, store) : Promise.resolve(store.has(id) ? structuredClone(store.get(id)) : null) },
    onNeedRuntime: ids => needs.push(ids), ...(timers ? { timers, now } : {}) })
  const runtime = () => ({ records: [...store.values()], ledgerReady: true, connection: 'connected', frozenBinding: true,
    reviewStatus: serverReviewStatus(address || reviewAddressFor(needs.at(-1) || session.sendIds(), [...store.values()]), store),
    send: async rec => { sends.push({ kind: 'single', ids: [rec.id], records: [structuredClone(rec)] }); return send ? send(rec) : { ok: true } },
    sendStack: async recs => { sends.push({ kind: 'stack', ids: recs.map(rec => rec.id), records: structuredClone(recs) }); return sendStack ? sendStack(recs) : { ok: true } },
    refresh() {}, ...extra })
  let nonce = 0
  const fire = (key, event) => session.handleEvent({ sessionId: 'session-1', key, event, nonce: `n${++nonce}` })
  const last = () => states.at(-1)
  const action = key => last().actions.find(item => item.key === key)
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
  const there = harness({ ids: ['mine', 'theirs'], records: [mine, theirs], context: { chatId: OTHER, latest: true } })
  there.session.start(); await tick()
  assert.deepEqual(there.last().rows.map(row => row.intent), ['review:theirs'])
  assert.equal(inChat(theirs, CHAT), false)
  assert.equal(inChat(mine, ''), false, 'no chat, no membership')
})

test('without the host\'s chat the card only shows status and never sends', async () => {
  for (const options of [{ context: null }, { features: ['row-state'] }, { features: [] }]) {
    const h = harness({ ids: ['one'], records: [prepared('one')], ...options })
    h.session.start(); await tick()
    h.fire(KEY, 'activate'); await tick()
    h.provide(); await tick()
    h.fire(KEY, 'confirm'); await tick()
    assert.equal(h.needs.length, 0, JSON.stringify(options))
    assert.equal(h.sends.length, 0)
    assert.equal(h.action(KEY).confirming, false)
  }
  const older = harness({ ids: ['one'], records: [prepared('one')], features: [] })
  older.session.start(); await tick()
  assert.deepEqual([older.action(KEY).disabled, older.action(KEY).open, older.action(KEY).note], [true, false, NEWER_NOTE])
  const rowState = harness({ ids: ['one'], records: [prepared('one')], features: ['row-state'] })
  rowState.session.start(); await tick()
  assert.deepEqual([rowState.action(KEY).open, rowState.action(KEY).label, rowState.action(KEY).note], [true, 'Open Contribute', ''])
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
  assert.deepEqual(dangling.pills(), [['a', 'Replaced']])
  assert.equal(dangling.action(KEY).hidden, true, 'nothing left to send')
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
  const h = harness({ ids: ['one'], records: [prepared('one')], context: { chatId: CHAT, latest: false } })
  h.session.start(); await tick()
  assert.deepEqual([h.last().title, h.last().rows, h.action(KEY).hidden], [CONTINUED_TITLE, [], true])
  assert.deepEqual(h.reads, [], 'an earlier card reads nothing')
  h.session.refresh('turn'); h.fire(KEY, 'activate'); await tick()
  assert.deepEqual([h.reads, h.needs], [[], []], 'nor on a refresh hint or a tap')
  h.session.update({ context: { chatId: CHAT, latest: true } }); await tick()
  assert.equal(h.last().title, '1 contribution')
  assert.deepEqual(h.reads, ['one'])
})

test('a card that a newer card follows drops its open Confirm and folds, but keeps an unresolved send', async () => {
  const h = harness({ ids: ['one'], records: [prepared('one')] })
  await openConfirm(h)
  assert.equal(h.action(KEY).confirming, true)
  h.session.update({ context: { chatId: CHAT, latest: false } }); await tick()
  assert.equal(h.action(KEY).confirming, false)
  assert.equal(h.last().title, CONTINUED_TITLE)
  h.fire(KEY, 'confirm'); await tick()
  assert.equal(h.sends.length, 0, 'the dropped confirmation cannot be spent')
  // A card mid-send keeps showing that send until it settles.
  const gate = deferred()
  const busy = harness({ ids: ['one'], records: [prepared('one')], send: () => gate.promise })
  await openConfirm(busy)
  busy.fire(KEY, 'confirm'); await tick()
  busy.session.update({ context: { chatId: CHAT, latest: false } }); await tick()
  assert.equal(busy.last().title, 'Sending 1')
  assert.equal(busy.row('one').pill, 'Sending')
  // A different chat id for the same session is ignored.
  busy.session.update({ context: { chatId: OTHER, latest: true } }); await tick()
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
  h.provide()
  h.fire(KEY, 'activate'); await tick()
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
  assert.equal(h.action(KEY).note, '')
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
test('a failed exact read ends the check with an enabled Try again that can then reach Confirm', async () => {
  let failing = true
  const h = harness({ ids: ['one'], records: [prepared('one')],
    loadExact: async (id, store) => { if (failing) throw new Error('offline'); return structuredClone(store.get(id)) } })
  h.session.start(); await tick()
  assert.deepEqual(h.last().rows, [{ title: 'one', pill: 'Couldn’t check', intent: 'review:one' }], 'an unread record is not called missing')
  h.fire(KEY, 'activate'); await tick()
  h.provide(); await tick()
  assert.deepEqual([h.action(KEY).confirming, h.action(KEY).disabled, h.action(KEY).label], [false, false, 'Try again'])
  failing = false
  h.fire(KEY, 'activate'); await tick()
  assert.deepEqual(h.needs.at(-1), ['one'], 'the tap asks the app to check the record it can now read')
  assert.equal(h.action(KEY).label, 'Checking…', 'a check addressed to other records is still loading')
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
  h.provide(); await tick()
  h.fire(KEY, 'activate'); await tick()
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
  h.provide(); await tick()
  h.fire(KEY, 'activate'); await tick()
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
  assert.equal(h.action(KEY).confirming, true, 'only a new Try again reaches Confirm')
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
  assert.deepEqual([h.action(KEY).open, h.action(KEY).label, h.action(KEY).note], [true, 'Open Contribute', ''])
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
  assert.deepEqual(cardKind([{ key: KEY }], items), { kind: 'chat', key: KEY, hints: ['a', 'b'] })
  assert.deepEqual(cardKind([{ key: 'chat-send-batch:968bcf1a16b2b0ee' }], items), { kind: 'old', key: 'chat-send-batch:968bcf1a16b2b0ee', hints: ['a', 'b'] })
  assert.deepEqual(cardKind([{ key: 'chat-send:a' }], []), { kind: 'old', key: 'chat-send:a', hints: ['a'] }, 'a card printed before items named its record')
  assert.deepEqual(cardKind([{ key: 'chat-send:a' }], reviewItems(['b'])).hints, ['b'])
  assert.equal(cardKind([{ key: 'send:a' }], items), null)
  assert.deepEqual(hintedIds([{ intent: 'review:../x' }, { intent: 'reviews:queue' }, { intent: 'review:ok' }]), ['ok'])
  assert.equal(hintedIds(Array.from({ length: 20 }, (_, n) => ({ intent: `review:r${n}` }))).length, 12)
})

test('an old card shows its records\' current state as rows and never sends', async () => {
  const actions = [{ key: 'chat-send-batch:968bcf1a16b2b0ee', label: 'Contribute all' }]
  const records = [published(prepared('one'), 3101), prepared('two', { record: { status: 'abandoned' } }), prepared('three')]
  const h = harness({ actions, items: reviewItems(['one', 'two', 'three']), records })
  h.session.start(); await tick()
  assert.deepEqual(h.pills(), [['one', 'Open'], ['two', 'Dismissed'], ['three', '']])
  assert.equal(h.last().title, '1 of 2 sent')
  assert.equal(h.last().actions[0].hidden, true, 'nothing to do from an old card')
  h.fire(actions[0].key, 'activate'); h.provide(); await tick()
  h.fire(actions[0].key, 'confirm'); await tick()
  assert.deepEqual([h.needs, h.sends], [[], []], 'an old card never asks for the send runtime')
  // It shows another chat's records too: it is only status.
  const there = harness({ actions, items: reviewItems(['one']), records: [published(prepared('one', { record: { chat_id: OTHER, chat_ids: [OTHER] } }))] })
  there.session.start(); await tick()
  assert.deepEqual(there.pills(), [['one', 'Open']])
  assert.equal(there.last().title, '1 pull request')
})

test('a card printed before items named records shows its record status, on any host, and never sends', async () => {
  const actions = [{ key: 'chat-send:one', label: 'Contribute' }]
  const show = async (record, features = ['row-state']) => {
    const h = harness({ actions, items: [], features, records: record ? [record] : [] })
    h.session.start(); await tick()
    const state = h.action('chat-send:one')
    h.fire('chat-send:one', 'activate'); h.provide(); await tick()
    h.fire('chat-send:one', 'confirm'); await tick()
    assert.deepEqual([h.action('chat-send:one').confirming, h.sends.length, h.needs.length], [false, 0, 0])
    return state
  }
  const sent = await show(published(prepared('one')))
  // A legacy card has no item rows, so on a row-state host the action itself stays visible.
  assert.deepEqual([sent.hidden, sent.disabled, sent.open, sent.label, sent.status, sent.statusTone, sent.note], [false, true, false, 'Sent', 'Open', 'success', ''])
  assert.deepEqual(sent.links, [{ label: '#7', url: 'https://github.com/owner/repo/pull/7' }])
  const waiting = await show(prepared('one'))
  assert.deepEqual([waiting.open, waiting.label, waiting.note, waiting.status], [true, 'Open Contribute', '', ''])
  const missing = await show(null)
  assert.deepEqual([missing.open, missing.note], [false, 'This contribution is no longer in Contribute.'])
  const dismissed = await show(prepared('one', { record: { status: 'abandoned' } }))
  assert.equal(dismissed.note, 'This contribution was dismissed.')
  const older = await show(prepared('one'), [])
  assert.deepEqual([older.open, older.disabled, older.note], [false, true, LEGACY_NOTE])
  const rows = await show(published(prepared('one')), ['row-state', 'rows-v2'])
  assert.equal(rows.hidden, true, 'a host that draws the app\'s rows shows the result there')
})

test('an old card that could not check its record offers Try again, which only reads again', async () => {
  let reachable = false
  const h = harness({ actions: [{ key: 'chat-send:one' }], items: [], features: ['row-state'], records: [published(prepared('one'))],
    loadExact: async (id, store) => { if (!reachable) throw new Error('offline'); return structuredClone(store.get(id)) } })
  h.session.start(); await tick()
  let state = h.action('chat-send:one')
  assert.deepEqual([state.note, state.label, state.disabled], [UNCHECKED_NOTE, 'Try again', false], 'an unavailable read is not reported as a missing contribution')
  reachable = true
  h.fire('chat-send:one', 'activate'); await tick()
  state = h.action('chat-send:one')
  assert.deepEqual([state.status, state.label, state.disabled, state.note], ['Open', 'Sent', true, ''])
  assert.deepEqual([h.needs.length, h.sends.length], [0, 0])
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
  assert.deepEqual(view.actions, [{ key: KEY, label: 'Contribute all' }])
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

test('the host shows a legacy card\'s published status and PR link, and a neutral note while prepared', async t => {
  const host = await hostRenderer(t)
  if (!host) return
  const block = host.parse(JSON.stringify({ app: 'contribute', intent: 'review:one', title: 'Change one', interaction: 'inline',
    facts: [{ label: 'Repository', value: 'owner/repo' }, { label: 'Action', value: 'Open a new pull request' }],
    action: { label: 'Contribute', intent: 'chat-send:one' } }))
  const rendered = async (record, features) => {
    const h = harness({ ...host.init(block), features, records: [record] })
    h.session.start(); await tick()
    const { sessionId, ...body } = h.last()
    return host.render(block, { type: 'moebius:app-block-state', sessionId, ...body })
  }
  // As the host advertises itself: an older host draws status as text.
  const actionFeatures = host.features.filter(feature => feature === 'row-state')
  const sent = await rendered(published(prepared('one')), actionFeatures)
  assert.match(sent, /md-app-block__(pill|status) is-success">Open<\/span>/)
  assert.match(sent, /href="https:\/\/github.com\/owner\/repo\/pull\/7"[^>]*>#7/)
  assert.match(sent, /<button[^>]*disabled=""[^>]*>Sent<\/button>/)
  const waiting = await rendered(prepared('one'), actionFeatures)
  if (actionFeatures.length) {
    assert.match(waiting, /<a class="md-app-block__action is-secondary" href="[^"]*">Open Contribute<\/a>/)
    assert.doesNotMatch(waiting, /md-app-block__note|<button[^>]*md-app-block__action/)
  } else {
    assert.match(waiting, /<button[^>]*disabled=""[^>]*>Open Contribute<\/button>/)
    assert.match(waiting, /Open Contribute to send it\./)
  }
  if (host.features.includes('rows-v2')) {
    const rows = await rendered(published(prepared('one')), host.features)
    assert.match(rows, /<p class="md-app-block__item-meta">owner\/repo · \+2 −0<\/p>/)
    assert.match(rows, /md-app-block__title-mark is-success/)
    assert.doesNotMatch(rows, /Open a new pull request|<footer>/, 'the saved facts give way to the app\'s rows')
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
  const earlier = await render({ context: { chatId: CHAT, latest: false } }, { onJump() {} })
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
