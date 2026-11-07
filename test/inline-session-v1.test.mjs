// The earlier chat card (#144), kept unchanged for hosts without rows-v2
// (inline-session-v1.js): these are its tests, run against it unchanged,
// except that the card printed today is written with its chat.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchHandle, cardRecordIds, itemRecordIds, sendTarget } from '../chat-blocks.js'
import { frontendModules, renderModule } from './render-harness.mjs'
import { readBlockSession } from '../block-protocol.js'
import { reviewAddressFor } from '../send-readiness.js'
import { attemptOutcome, confirmationItem, EXPIRED_NOTE, RECHECK_DELAYS_MS, RECHECK_WINDOW_MS, LEDGER_NOTE, LEGACY_NOTE, NEWER_NOTE, UNCHECKED_NOTE, UNMATCHED_NOTE, UNLISTED_LAYER_NOTE, REFRESH_FAILED_NOTE, SIZE_NOTE, TIMEOUT_NOTE, createInlineSession, decodeCheckpoint, encodeCheckpoint, observeAttempt, RECOVERY_NOTE } from '../inline-session-v1.js'

const HEAD = 'a'.repeat(40), NEXT = 'c'.repeat(40)
function prepared(id, extra = {}) {
  const head = extra.head || HEAD
  return { id, type: 'pr', status: 'prepared', repo: 'owner/repo', updated_at: '2026-10-20T10:00:00Z',
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
// The item intents the host sends with the session (#1914 `init.items`). By
// default a one-record card's item; a batch card passes its items.
const reviewItems = ids => ids.map(id => ({ intent: `review:${id}` }))
const defaultItems = actions => reviewItems(actions.flatMap(item => /^chat-send:(.+)$/.exec(item.key)?.[1] || []))
// A current host draws row state by default; pass `features: []` for an older one.
function harness({ actions, items = defaultItems(actions), features = ['row-state'], records, checkpoint = null, retain = false, send, sendStack, address = null, loadExact = null, runtime: extra = {} }) {
  const store = new Map(records.map(record => [record.id, record]))
  const states = [], sends = [], needs = []
  const session = createInlineSession({ sessionId: 'session-1', actions, items, features, checkpoint, retain, publish: state => states.push(structuredClone(state)),
    loadExact: loadExact ? id => loadExact(id, store) : async id => store.has(id) ? structuredClone(store.get(id)) : null, onNeedRuntime: () => needs.push(true) })
  const runtime = () => ({ records: [...store.values()], ledgerReady: true, connection: 'connected', frozenBinding: true,
    reviewStatus: serverReviewStatus(address || reviewAddressFor(cardRecordIds(actions.map(item => item.key), items), [...store.values()]), store),
    send: async rec => { sends.push({ kind: 'single', ids: [rec.id], records: [structuredClone(rec)] }); return send ? send(rec) : { ok: true } },
    sendStack: async recs => { sends.push({ kind: 'stack', ids: recs.map(rec => rec.id), records: structuredClone(recs) }); return sendStack ? sendStack(recs) : { ok: true } },
    refresh() {}, ...extra })
  let nonce = 0
  const fire = (key, event) => session.handleEvent({ sessionId: 'session-1', key, event, nonce: `n${++nonce}` })
  const last = () => states.at(-1)
  const action = key => last().actions.find(item => item.key === key)
  const provide = () => session.updateRuntime(runtime())
  return { session, store, states, sends, needs, fire, last, action, provide, runtime }
}
async function openConfirm(h, key) {
  h.session.start(); await tick()
  h.fire(key, 'activate'); await tick()
  assert.equal(h.needs.length > 0, true, 'activation asked for the publication runtime')
  h.provide(); await tick()
}

test('Contribute becomes Confirm with each frozen change as the card shows it', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one', label: 'Contribute' }], records: [prepared('one')] })
  h.session.start(); await tick()
  assert.equal(h.action('chat-send:one').disabled, false)
  assert.equal(h.sends.length, 0, 'reading the card never sends')
  await openConfirm(h, 'chat-send:one')
  const state = h.action('chat-send:one')
  assert.equal(state.confirming, true)
  assert.equal(state.confirmation.length, 1)
  const [item] = state.confirmation
  assert.equal(item.title, 'Change one')
  assert.ok(item.facts.length <= 8)
  for (const fact of item.facts) assert.ok(fact.label && fact.value && fact.value.length <= 512, JSON.stringify(fact))
  // The host draws these rows in place of the card's, so they are the card's
  // own facts with the card's values, and nothing more.
  assert.deepEqual(item.facts, [{ label: 'Project', value: 'owner/repo' }, { label: 'Change', value: '1 file · +2 −0' }])
  const sized = confirmationItem(prepared('sized', { plan: { diff_stat: ' 3 files changed, 40 insertions(+), 2 deletions(-)' } }))
  assert.deepEqual(sized.facts.find(fact => fact.label === 'Change'), { label: 'Change', value: '3 files · +40 −2' }, 'Confirm shows how big the change is')
  const stacked = confirmationItem({ ...layer('base', 1, ''), plan: { ...layer('base', 1, '').plan, diff_stat: '1 file changed, 1 insertion(+)' } })
  assert.deepEqual(stacked.facts, [{ label: 'Project', value: 'owner/repo' }, { label: 'Change', value: '1 file · +1 −0' },
    { label: 'Stack', value: 'Layer 1 of 2 · Stack' }], 'a stack layer also names its layer')
  assert.equal(h.sends.length, 0, 'activation is not approval')
})

test('Confirm sends the frozen snapshot once and publishes the unresolved checkpoint first', async () => {
  const gate = deferred()
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => gate.promise })
  await openConfirm(h, 'chat-send:one')
  const frozenTitle = h.action('chat-send:one').confirmation[0].title
  h.store.set('one', prepared('one', { plan: { title: 'Edited after Confirm appeared' } }))
  h.fire('chat-send:one', 'confirm'); h.fire('chat-send:one', 'confirm')
  await tick()
  assert.equal(h.sends.length, 1, 'double Confirm sends once')
  assert.equal(h.sends[0].records[0].plan.title, frozenTitle, 'the frozen snapshot, not a refreshed substitute, is sent')
  const pending = h.last()
  assert.ok(pending.checkpoint, 'checkpoint exists while the request is outstanding')
  assert.equal(pending.retain, true)
  assert.equal(h.action('chat-send:one').busy, true)
  h.store.set('one', published(prepared('one')))
  gate.resolve({ ok: true }); await tick()
  const done = h.action('chat-send:one')
  assert.equal(done.hidden, true)
  // The row links to its pull request; the header says what happened.
  assert.deepEqual(h.last().items, [{ intent: 'review:one', status: 'Open', statusTone: 'success', links: [{ label: '#7', url: 'https://github.com/owner/repo/pull/7' }] }])
  assert.equal(h.last().title, 'Pull request opened')
  assert.equal(h.last().checkpoint, null, 'a proven result releases the checkpoint')
})

test('the newest attempt owns the checkpoint after fail, restage and retry (reload before response)', async () => {
  let call = 0
  const second = deferred()
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')],
    send: () => ++call === 1 ? { error: 'Push rejected', failure: { owner: 'agent' } } : second.promise })
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.deepEqual(h.last().items, [{ intent: 'review:one', status: 'Not sent', statusTone: 'danger', note: 'Push rejected' }])
  assert.equal(h.action('chat-send:one').label, 'Retry', 'a definite failure the send path accepts again is retried explicitly')
  assert.equal(h.last().checkpoint, null, 'a known failure is not a lock')
  // The agent restages a new reviewed head; the owner confirms again.
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z' } }))
  h.provide()
  h.fire('chat-send:one', 'activate'); await tick()
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.sends.at(-1).records[0].plan.head_sha, NEXT, 'the retry sends the new reviewed head')
  const saved = decodeCheckpoint(h.last().checkpoint)
  assert.equal(saved.length, 1, 'only the unresolved retry crosses reload')
  assert.deepEqual(saved[0].ids, ['one'])
  // Reload: a new document restores from that checkpoint and stays locked.
  const reloaded = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', { head: NEXT })], checkpoint: h.last().checkpoint, retain: true })
  reloaded.session.start(); await tick()
  assert.equal(reloaded.last().checkpointAck, h.last().checkpoint.id)
  assert.equal(reloaded.action('chat-send:one').label, 'Checking…')
  assert.equal(reloaded.action('chat-send:one').busy, true)
  assert.equal(reloaded.action('chat-send:one').note, '', 'checking is calm: no warning text')
  reloaded.provide(); reloaded.fire('chat-send:one', 'activate'); await tick()
  assert.equal(reloaded.action('chat-send:one').confirming, false, 'an unknown result never becomes a fresh Confirm')
  assert.equal(reloaded.sends.length, 0)
  reloaded.store.set('one', published(prepared('one', { head: NEXT }), 9))
  reloaded.fire('chat-send:one', 'activate'); await tick()
  assert.equal(reloaded.action('chat-send:one').hidden, true)
  assert.equal(reloaded.last().checkpoint, null)
})

test('only uncertain sends lock after reload; a known failure allows a new explicit Confirm', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ notAttempted: true, error: 'The saved proposal changed.' }) })
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.last().checkpoint, null)
  assert.equal(h.last().items[0].note, 'The saved proposal changed.', 'the row says why, once')
  assert.equal(h.last().items[0].statusTone, 'neutral', 'nothing was sent: no danger tone')
  assert.equal(h.action('chat-send:one').note, '')
  assert.equal(h.action('chat-send:one').disabled, false)
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirming, true, 'not attempted can be confirmed again')

  const lost = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ uncertain: true }) })
  await openConfirm(lost, 'chat-send:one')
  lost.fire('chat-send:one', 'confirm'); await tick()
  assert.ok(lost.last().checkpoint, 'a lost response stays owned')
  assert.deepEqual(lost.last().items, [{ intent: 'review:one', status: 'Checking GitHub', busy: true }])
  assert.equal(lost.last().title, 'Sending 1 contribution')
})

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

test('Contribute all sends independent units in parallel and a stack as one ordered request', async () => {
  const gates = { one: deferred(), two: deferred(), stack: deferred() }
  const records = [prepared('one'), prepared('two'), layer('base', 1, ''), layer('top', 2, 'base')]
  records[3].plan.base_sha = records[2].plan.head_sha
  const ids = ['one', 'two', 'base', 'top']
  // The card's one action; its items name the records it covers.
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, items: reviewItems(ids), records, send: rec => gates[rec.id].promise, sendStack: () => gates.stack.promise })
  const batch = actions[0].key
  await openConfirm(h, batch)
  const confirming = h.action(batch)
  assert.equal(confirming.confirming, true)
  assert.deepEqual(confirming.confirmation.map(item => item.title), ['Change one', 'Change two', 'Change base', 'Change top'])
  assert.equal(confirming.confirmation[2].facts[2].value, 'Layer 1 of 2 · Stack')
  h.fire(batch, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(call => call.ids.join('+')).sort(), ['base+top', 'one', 'two'], 'both singles are in flight together')
  assert.equal(h.sends.find(call => call.kind === 'stack').ids.join(','), 'base,top')
  h.store.set('two', published(prepared('two'), 8))
  gates.two.resolve({ ok: true }); await tick()
  assert.deepEqual(h.last().items.map(item => [item.intent, item.status]), [['review:one', 'Sending'], ['review:two', 'Open'],
    ['review:base', 'Sending'], ['review:top', 'Sending']], 'a finished unit settles before slower siblings')
  assert.equal(h.action(batch).busy, true)
  h.store.set('base', published(h.store.get('base'), 9)); h.store.set('top', published(h.store.get('top'), 10))
  gates.stack.resolve({ ok: true }); await tick()
  gates.one.resolve({ error: 'Push rejected', failure: { owner: 'agent' } }); await tick()
  assert.equal(h.last().title, '3 of 4 sent')
  assert.deepEqual(h.last().items.map(item => [item.intent, item.status, item.links?.[0]?.label]), [['review:one', 'Not sent', undefined],
    ['review:two', 'Open', '#8'], ['review:base', 'Open', '#9'], ['review:top', 'Open', '#10']], 'a sibling failure never makes a sent unit pending')
  assert.equal(h.action(batch).hidden, false)
})

test('a card listing one layer never confirms or sends the stack layers it does not list', async () => {
  // The reviewer's probe: items=[review:base], action=chat-send:base.
  const records = [layer('base', 1, ''), layer('top', 2, 'base')]
  records[1].plan.base_sha = records[0].plan.head_sha
  const h = harness({ actions: [{ key: 'chat-send:base', label: 'Contribute' }], items: reviewItems(['base']), records })
  await openConfirm(h, 'chat-send:base')
  const state = h.action('chat-send:base')
  assert.equal(state.confirming, false, 'no partial or expanded Confirm')
  assert.equal(state.note, UNLISTED_LAYER_NOTE)
  h.fire('chat-send:base', 'confirm'); await tick()
  assert.deepEqual(h.sends, [])
})

test('a card listing every prepared layer reaches Confirm once each is addressed, and sends the stack as one', async () => {
  const records = [layer('base', 1, ''), layer('top', 2, 'base')]
  records[1].plan.base_sha = records[0].plan.head_sha
  const ids = ['base', 'top']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const key = actions[0].key
  assert.deepEqual(reviewAddressFor(['base'], records), ['base', 'top'], 'the status request covers the whole stack phase')
  // The server answered for both layers but has no current check of one: the whole phase waits.
  const narrow = harness({ actions, items: reviewItems(ids), records,
    runtime: { reviewStatus: { state: 'ready', addressed: ids, byId: { base: { state: 'ready' } } } } })
  await openConfirm(narrow, key)
  assert.equal(narrow.action(key).confirming, false)
  assert.match(narrow.action(key).note, /current source check/)
  const h = harness({ actions, items: reviewItems(ids), records })
  await openConfirm(h, key)
  const state = h.action(key)
  assert.equal(state.confirming, true)
  assert.deepEqual(state.confirmation.map(item => item.title), ['Change base', 'Change top'])
  h.fire(key, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(call => [call.kind, call.ids.join(',')]), [['stack', 'base,top']])
})

test('the review-status address is bounded and adds only prepared layers of named stacks', () => {
  const records = [layer('base', 1, '', 'open'), layer('top', 2, 'base'), prepared('alone')]
  assert.deepEqual(reviewAddressFor(['top', 'alone', 'top'], records), ['top', 'alone'], 'a published layer needs no check')
  assert.deepEqual(reviewAddressFor(['missing'], records), ['missing'])
  assert.equal(reviewAddressFor(Array.from({ length: 60 }, (_, n) => `id${n}`), []).length, 50)
})

test('chat never sends without server binding of the confirmed snapshot', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { frozenBinding: false } })
  await openConfirm(h, 'chat-send:one')
  const state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.open, true)
  assert.match(state.note, /newer Möbius/)
})

test('readiness fails closed without a current positive check of the exact record', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { reviewStatus: { state: 'ready', addressed: ['one'], byId: {} } } })
  await openConfirm(h, 'chat-send:one')
  assert.equal(h.action('chat-send:one').confirming, false)
  assert.match(h.action('chat-send:one').note, /current source check/)
  const stale = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', { record: { quality_review: { state: 'all_clear', reviewed_head_sha: NEXT } } })] })
  await openConfirm(stale, 'chat-send:one')
  assert.match(stale.action('chat-send:one').note, /needs review first/)
})

test('a review check that was not addressed to the card records never enables Confirm', async () => {
  for (const addressed of [null, []]) {
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')],
      runtime: { reviewStatus: { state: 'ready', addressed, byId: { one: { state: 'ready' } } } } })
    await openConfirm(h, 'chat-send:one')
    assert.equal(h.action('chat-send:one').confirming, false)
    assert.match(h.action('chat-send:one').note, /newer Möbius/)
  }
})

test('the card action resolves only to the exact records its items name', () => {
  const items = reviewItems(['a', 'b'])
  const handle = `chat-send-batch:${batchHandle(['b', 'a'])}`
  assert.deepEqual(sendTarget(handle, items), { kind: 'batch', ids: ['a', 'b'] }, 'in card order')
  assert.equal(sendTarget(handle, reviewItems(['a', 'c'])).invalid, true, 'a handle naming another set is refused')
  assert.equal(sendTarget(handle, reviewItems(['a'])).invalid, true, 'a dropped item is not silently narrowed')
  assert.equal(sendTarget(handle, [...items, { intent: 'reviews:queue' }]).invalid, true, 'every item must be a ledger entry')
  assert.deepEqual(sendTarget('chat-send:a', reviewItems(['a'])), { kind: 'record', ids: ['a'] })
  assert.equal(sendTarget('chat-send:a', items).invalid, true, 'a one-record action on a two-item card is refused')
  assert.equal(sendTarget('chat-send:a', []).invalid, true)
  assert.equal(sendTarget('chat-send-batch:not-a-handle', items), null)
  assert.equal(sendTarget('chat-send:../x', items), null)
  // An older host sends no items: the action names nothing.
  assert.deepEqual(sendTarget(handle, null), { kind: 'batch', ids: [], needsItems: true })
  assert.deepEqual(sendTarget('chat-send:a', undefined), { kind: 'record', ids: [], needsItems: true })
  assert.deepEqual(itemRecordIds([{ intent: 'review:a' }, { intent: 'review:a' }, { intent: 'review:b' }]), ['a', 'b'])
  const long = Array.from({ length: 12 }, (_, i) => `record-${'x'.repeat(110)}-${i}`)
  assert.ok(`chat-send-batch:${batchHandle(long)}`.length <= 32, 'the batch intent stays short however long the ids are')
  assert.deepEqual(sendTarget(`chat-send-batch:${batchHandle(long)}`, reviewItems(long)).ids, long)
  const many = Array.from({ length: 13 }, (_, i) => `r${i}`)
  assert.equal(sendTarget(`chat-send-batch:${batchHandle(many)}`, reviewItems(many)).invalid, true, 'never more than the host item limit')
  assert.deepEqual(cardRecordIds([handle], items), ['a', 'b'])
  assert.deepEqual(cardRecordIds([handle], null), [], 'no status is addressed without items')
})

test('without the card items (an older Möbius) the action is never confirmable and reads nothing', async () => {
  const ids = ['one', 'two']
  for (const actions of [[{ key: 'chat-send:one' }], [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]]) {
    const h = harness({ actions, items: null, records: ids.map(id => prepared(id)) })
    h.session.start(); await tick()
    let state = h.last().actions[0]
    assert.equal(state.open, true)
    assert.equal(state.note, NEWER_NOTE)
    h.fire(actions[0].key, 'activate'); h.provide(); await tick()
    state = h.last().actions[0]
    assert.equal(state.confirming, false)
    assert.equal(state.note, NEWER_NOTE)
    h.fire(actions[0].key, 'confirm'); await tick()
    assert.equal(h.sends.length, 0)
  }
})

test('the action covers every item, and an unknown item record is refused', async () => {
  const ids = ['one', 'two']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, items: reviewItems(ids), records: ids.map(id => prepared(id)) })
  await openConfirm(h, actions[0].key)
  assert.deepEqual(h.action(actions[0].key).confirmation.map(item => item.title), ['Change one', 'Change two'])
  const missing = harness({ actions, items: reviewItems(ids), records: [prepared('one')] })
  await openConfirm(missing, actions[0].key)
  assert.equal(missing.action(actions[0].key).confirming, false)
  assert.match(missing.action(actions[0].key).note, /Could not read this contribution/)
  const published1 = harness({ actions, items: reviewItems(ids), records: [prepared('one'), published(prepared('two'))] })
  await openConfirm(published1, actions[0].key)
  assert.deepEqual(published1.action(actions[0].key).confirmation.map(item => item.title), ['Change one'], 'a record that is no longer prepared is never confirmed')
})

test('a stale or forged batch card offers nothing to send', async () => {
  const actions = [{ key: `chat-send-batch:${batchHandle(['a', 'c'])}` }]
  const h = harness({ actions, items: reviewItems(['a', 'b']), records: [prepared('a'), prepared('b')] })
  h.session.start(); await tick()
  const batch = h.action(actions[0].key)
  // A mismatch points to Contribute without a warning: the control is the pointer.
  assert.deepEqual([batch.open, batch.label, batch.note, batch.tone, batch.status], [true, 'Open Contribute', '', 'neutral', ''])
})

test('a card printed before its items named records shows only its record status and never sends', async () => {
  // Such a card has no `review:` items; its one action names the record.
  assert.deepEqual(sendTarget('chat-send:a', []), { kind: 'record', ids: [], invalid: true, legacy: 'a' })
  assert.deepEqual(sendTarget('chat-send:a', [{ intent: 'pull-request:owner/repo#7' }]), { kind: 'record', ids: [], invalid: true, legacy: 'a' })
  assert.deepEqual(sendTarget('chat-send:a', reviewItems(['b'])), { kind: 'record', ids: [], invalid: true }, 'a new card that does not match is not legacy')
  assert.deepEqual(sendTarget(`chat-send-batch:${batchHandle(['a', 'b'])}`, []), { kind: 'batch', ids: [], invalid: true })
  assert.deepEqual(cardRecordIds(['chat-send:a'], []), [], 'nothing is addressed for sending')
  const actions = [{ key: 'chat-send:one', label: 'Contribute' }]
  const show = async record => {
    const h = harness({ actions, items: [], records: record ? [record] : [] })
    h.session.start(); await tick()
    const state = h.action('chat-send:one')
    h.fire('chat-send:one', 'activate'); h.provide(); await tick()
    h.fire('chat-send:one', 'confirm'); await tick()
    assert.equal(h.action('chat-send:one').confirming, false)
    assert.equal(h.sends.length, 0, 'a legacy card is never confirmable from chat')
    return state
  }
  const sent = await show(published(prepared('one')))
  // A legacy card has no item rows, so the action itself stays visible.
  assert.deepEqual([sent.hidden, sent.disabled, sent.open, sent.label, sent.status, sent.statusTone, sent.note], [false, true, false, 'Sent', 'Open', 'success', ''])
  assert.deepEqual(sent.links, [{ label: '#7', url: 'https://github.com/owner/repo/pull/7' }])
  // Prepared: the control opens Contribute, so the note that says so is not repeated.
  const waiting = await show(prepared('one'))
  assert.deepEqual([waiting.open, waiting.label, waiting.note, waiting.tone, waiting.status, waiting.badges], [true, 'Open Contribute', '', 'neutral', '', []])
  const missing = await show(null)
  assert.deepEqual([missing.open, missing.note, missing.tone, missing.status], [true, 'This contribution is no longer in Contribute.', 'neutral', ''])
  const dismissed = await show(prepared('one', { record: { status: 'abandoned' } }))
  assert.deepEqual([dismissed.note, dismissed.tone, dismissed.status], ['This contribution was dismissed.', 'neutral', ''])
  // An older host draws no open link: the same card stays disabled and says where to send it.
  const older = harness({ actions, items: [], features: [], records: [prepared('one')] })
  older.session.start(); await tick()
  assert.deepEqual([older.action('chat-send:one').open, older.action('chat-send:one').disabled, older.action('chat-send:one').note], [false, true, LEGACY_NOTE])
})

test('a legacy card that could not check its record offers Try again, which only reads again', async () => {
  let reachable = false
  const h = harness({ actions: [{ key: 'chat-send:one' }], items: [], records: [published(prepared('one'))],
    loadExact: async (id, store) => { if (!reachable) throw new Error('offline'); return structuredClone(store.get(id)) } })
  h.session.start(); await tick()
  let state = h.action('chat-send:one')
  assert.deepEqual([state.note, state.tone, state.status, state.label, state.disabled], [UNCHECKED_NOTE, 'neutral', '', 'Try again', false],
    'an unavailable read is not reported as a missing contribution')
  reachable = true
  h.fire('chat-send:one', 'activate'); await tick()
  state = h.action('chat-send:one')
  assert.deepEqual([state.status, state.label, state.disabled, state.note], ['Open', 'Sent', true, ''])
  assert.deepEqual(state.links, [{ label: '#7', url: 'https://github.com/owner/repo/pull/7' }])
  assert.equal(h.needs.length, 0, 'a legacy card never asks for the publication runtime')
  assert.equal(h.sends.length, 0)
})

test('a legacy batch card and a mismatched new card stay closed with a neutral note', async () => {
  const ids = ['one', 'two']
  for (const [actions, items] of [[[{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }], []],
    [[{ key: 'chat-send:one' }], reviewItems(['two'])]]) {
    const h = harness({ actions, items, records: ids.map(id => prepared(id)) })
    h.session.start(); await tick()
    const state = h.last().actions[0]
    assert.deepEqual([state.open, state.note, state.tone, state.status, state.hidden], [true, '', 'neutral', '', false])
    h.fire(actions[0].key, 'activate'); h.provide(); await tick()
    h.fire(actions[0].key, 'confirm'); await tick()
    assert.equal(h.last().actions[0].confirming, false)
    assert.equal(h.sends.length, 0)
  }
  // The matching card for the same record is unchanged: it reaches Confirm and sends once.
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')] })
  await openConfirm(h, 'chat-send:one')
  assert.equal(h.action('chat-send:one').confirming, true)
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.deepEqual(h.sends.map(send => send.ids), [['one']])
})

test('a broken or missing recovery checkpoint never resurrects Send', async () => {
  for (const options of [{ checkpoint: { id: 'c', data: '{"version":2}' } }, { retain: true }]) {
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], ...options })
    h.session.start(); await tick()
    assert.equal(h.last().recoveryError, true)
    assert.equal(h.action('chat-send:one').note, RECOVERY_NOTE)
    h.fire('chat-send:one', 'activate'); await tick()
    assert.equal(h.action('chat-send:one').confirming, false)
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

// One card with a Contribute all action, opened to Confirm on that action.
async function confirmingCard() {
  const ids = ['one', 'two']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, items: reviewItems(ids), records: ids.map(id => prepared(id)) })
  const batch = actions[0].key
  const confirmingKeys = () => h.last().actions.filter(action => action.confirming).map(action => action.key)
  await openConfirm(h, batch)
  assert.deepEqual(confirmingKeys(), [batch])
  // A repeated tap while confirming never adds a second Confirm.
  h.fire(batch, 'activate'); await tick()
  assert.deepEqual(confirmingKeys(), [batch])
  h.fire(batch, 'cancel'); await tick()
  assert.deepEqual(confirmingKeys(), [])
  h.fire(batch, 'activate'); await tick()
  assert.deepEqual(confirmingKeys(), [batch])
  for (const state of h.states) assert.ok(state.actions.filter(action => action.confirming).length <= 1, 'never two confirming actions')
  return { h, actions }
}

test('a card never reports more than one confirming action', async () => {
  await confirmingCard()
})

// The real B2 host parser, only when MOBIUS_BLOCKS_FRONTEND names a Möbius
// frontend checkout that has it; the test above covers the rule everywhere.
test('the B2 host keeps Confirm available for that one confirming action', async t => {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return t.skip('set MOBIUS_BLOCKS_FRONTEND to a Möbius frontend with the passive block host to run this check')
  const b2 = await import(`${BLOCKS}/src/components/ChatView/markdown/appBlockSession.js`)
  const { h, actions } = await confirmingCard()
  const parsed = b2.sessionState({ type: 'moebius:app-block-state', ...h.last() }, 'session-1', new Set(actions.map(action => action.key)))
  const confirming = parsed.actions.filter(action => action.confirming)
  assert.equal(confirming.length, 1)
  assert.ok(confirming[0].confirmation?.length === 2 && !confirming[0].disabled, 'the host shows the app-sourced list and an enabled Confirm')
  assert.notEqual(confirming[0].note, b2.AMBIGUOUS_CONFIRMATION)
})

test('a relay (mobius-bot) contribution is never confirmable from chat and is never sent', async () => {
  const relay = prepared('one', { record: { submission_mode: 'mobius-bot' } })
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [relay] })
  await openConfirm(h, 'chat-send:one')
  const state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.open, true)
  assert.match(state.note, /Möbius relay.*Open Contribute to send it/)
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.sends.length, 0)
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
      const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => outcome })
      await openConfirm(h, 'chat-send:one')
      h.fire('chat-send:one', 'confirm'); await tick()
      const state = h.action('chat-send:one')
      assert.ok(h.last().checkpoint, 'the unresolved attempt stays in the checkpoint')
      assert.equal(h.last().retain, true)
      assert.equal(state.label, 'Checking…')
      assert.equal(state.disabled, true)
      assert.equal(h.last().items[0].status, 'Checking GitHub')
      h.fire('chat-send:one', 'activate'); await tick()
      assert.equal(h.action('chat-send:one').confirming, false, 'Confirm is not offered again')
      h.fire('chat-send:one', 'confirm'); await tick()
      assert.equal(h.sends.length, 1, 'no second send while the outcome is unknown')
    }
    const certified = await refused(true)
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => certified })
    await openConfirm(h, 'chat-send:one')
    h.fire('chat-send:one', 'confirm'); await tick()
    assert.equal(h.last().checkpoint, null, 'a certified non-attempt releases the checkpoint')
    h.fire('chat-send:one', 'activate'); await tick()
    assert.equal(h.action('chat-send:one').confirming, true, 'only not_attempted re-enables Confirm')
  } finally { globalThis.fetch = previousFetch }
  // The rule also holds for a host that forwards the code without the owner fix.
  assert.equal(attemptOutcome({ error: 'changed', failure: { owner: 'agent', code: 'approval_changed' } }).state, 'unknown')
  assert.equal(attemptOutcome({ notAttempted: true, failure: { owner: 'agent', code: 'approval_changed' } }).state, 'not_attempted')
})

test('a failed exact read ends the check with an enabled Try again that can then reach Confirm', async () => {
  let failing = true
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')],
    loadExact: async (id, store) => { if (failing) throw new Error('offline'); return structuredClone(store.get(id)) } })
  h.session.start(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  h.provide(); await tick()
  let state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.disabled, false, 'the card is not stuck on a disabled Checking…')
  assert.equal(state.label, 'Try again')
  failing = false
  h.fire('chat-send:one', 'activate'); await tick()
  state = h.action('chat-send:one')
  assert.equal(state.confirming, true, 'the retry reaches Confirm')
  assert.equal(h.sends.length, 0)
})

test('an unavailable review check ends the check with an enabled Try again that can then reach Confirm', async () => {
  const refreshes = []
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { refresh() { refreshes.push(true) } } })
  const unavailable = () => h.session.updateRuntime({ ...h.runtime(), reviewStatus: { state: 'unavailable', byId: {} } })
  h.session.start(); await tick()
  unavailable(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'activation asks for a fresh check')
  assert.equal(h.action('chat-send:one').label, 'Checking…', 'still checking while that refresh is pending')
  unavailable(); await tick() // the refreshed check is unavailable too
  let state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.disabled, false, 'the card is not stuck on a disabled Checking…')
  assert.equal(state.label, 'Try again')
  h.provide(); await tick() // the check recovers
  h.fire('chat-send:one', 'activate'); await tick()
  state = h.action('chat-send:one')
  assert.equal(state.confirming, true, 'the retry reaches Confirm')
  assert.equal(h.sends.length, 0)
})

test('a record whose own source check could not finish offers Try again; a reconnect does not', async () => {
  const refreshes = []
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { refresh() { refreshes.push(true) } } })
  const check = row => h.session.updateRuntime({ ...h.runtime(), reviewStatus: { state: 'ready', addressed: ['one'], byId: { one: row } } })
  h.session.start(); await tick()
  check({ state: 'unavailable', code: 'github_reconnect' }); await tick()
  let state = h.action('chat-send:one')
  assert.equal(state.open, true, 'only the owner can clear a reconnect')
  assert.match(state.note, /Reconnect GitHub in Möbius Settings/)
  check({ state: 'unavailable', code: 'review_unavailable' }); await tick()
  state = h.action('chat-send:one')
  assert.equal(state.disabled, false)
  assert.equal(state.label, 'Try again')
  assert.match(state.note, /could not be checked just now\. Try again in a moment\./)
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'Try again asks for a fresh check')
  h.provide(); await tick() // the check recovers
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirming, true)
  assert.equal(h.sends.length, 0)
})

// The independent review's sequence: the review check fails before the first
// ledger read finishes, the owner retries, then the ledger read completes.
test('a retry during the first ledger read never strands the card on Checking', async () => {
  const refreshes = []
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')] })
  const unavailable = { state: 'unavailable', byId: {}, addressed: ['one'] }
  let ledgerReady = false
  const runtime = () => ({ ...h.runtime(), ledgerReady, reviewStatus: unavailable, refresh: () => refreshes.push(true) })
  h.session.start(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  h.session.updateRuntime(runtime()); await tick()
  assert.equal(h.action('chat-send:one').label, 'Try again')
  assert.equal(h.action('chat-send:one').disabled, false)
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'the retry asks for a fresh check')
  // The ledger read finishes; the check is still the same unavailable answer.
  ledgerReady = true
  h.session.updateRuntime(runtime()); await tick()
  let state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.disabled, false, 'an unavailable answer is never held as pending')
  assert.equal(state.label, 'Try again')
  // A later retry reaches Confirm once the check recovers.
  h.provide(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  state = h.action('chat-send:one')
  assert.equal(state.confirming, true)
  assert.equal(h.sends.length, 0)
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

test('a change without a readable size is never offered for Confirm, single or in a stack', async () => {
  for (const [name, diffStat] of [['missing', undefined], ['empty', ''], ['malformed', 'lots of changes']]) {
    const unsized = { plan: { diff_stat: diffStat } }
    // A single contribution.
    const single = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', unsized)] })
    await openConfirm(single, 'chat-send:one')
    let state = single.action('chat-send:one')
    assert.equal(state.confirming, false, `${name}: single`)
    assert.equal(state.open, true, `${name}: single stays blocked`)
    assert.equal(state.note, SIZE_NOTE)
    single.fire('chat-send:one', 'confirm'); await tick()
    assert.equal(single.sends.length, 0)
    // One layer of a two-layer stack lacks its size: the whole phase is blocked.
    const base = layer('base', 1, ''), top = layer('top', 2, 'base')
    top.plan.base_sha = base.plan.head_sha
    top.plan.diff_stat = diffStat
    const stackKey = `chat-send-batch:${batchHandle(['base', 'top'])}`
    const stack = harness({ actions: [{ key: stackKey }], items: reviewItems(['base', 'top']), records: [base, top] })
    await openConfirm(stack, stackKey)
    state = stack.action(stackKey)
    assert.equal(state.confirming, false, `${name}: stack`)
    assert.equal(state.note, SIZE_NOTE)
    assert.equal(stack.sends.length, 0)
  }
  // A staged --shortstat, including deletions only, is accepted.
  const deletions = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', { plan: { diff_stat: ' 2 files changed, 7 deletions(-)' } })] })
  await openConfirm(deletions, 'chat-send:one')
  assert.equal(deletions.action('chat-send:one').confirming, true)
  assert.equal(deletions.action('chat-send:one').confirmation[0].facts.find(fact => fact.label === 'Change').value, '2 files · +0 −7')
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

test('a malformed shortstat suffix keeps the card blocked', async () => {
  for (const stat of ['1 file changed, lots of deletions', '2 files changed, 40 insertions(+), ??? deletions(-)']) {
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', { plan: { diff_stat: stat } })] })
    await openConfirm(h, 'chat-send:one')
    const state = h.action('chat-send:one')
    assert.equal(state.confirming, false, stat)
    assert.equal(state.note, SIZE_NOTE)
    assert.equal(h.sends.length, 0)
  }
})

test('an incomplete ledger ends the check with a clear note, and Try again waits for its whole re-read', async () => {
  const refreshes = []
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { refresh: () => refreshes.push(true) } })
  // Reports as the app sends them: `refreshing` while a card refresh runs, `refreshDone` once it completes.
  const report = fields => h.session.updateRuntime({ ...h.runtime(), refreshing: false, refreshDone: 0, ...fields })
  h.session.start(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  report({ ledgerReady: false, ledger: 'incomplete' }); await tick()
  let state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.note, LEDGER_NOTE)
  assert.equal(state.disabled, false, 'the owner can try again')
  // Try again starts one full re-read.
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'Try again requested a full ledger re-read')
  // Intermediate reports while the ledger read is still pending (status and connection already back).
  report({ ledgerReady: false, ledger: 'incomplete', refreshing: true }); await tick()
  report({ ledgerReady: false, ledger: 'incomplete', refreshing: true, connection: 'connected' }); await tick()
  state = h.action('chat-send:one')
  assert.equal(state.label, 'Checking…', 'an intermediate report does not end the check')
  assert.equal(state.disabled, true, 'no second Try again while the re-read runs')
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(refreshes.length, 1, 'no second refresh while one is outstanding')
  // The deferred ledger listing lands complete: the refresh completes and Confirm is reachable.
  report({ ledger: 'current', refreshing: false, refreshDone: 1 }); await tick()
  assert.equal(h.action('chat-send:one').confirming, true)
  assert.equal(h.sends.length, 0)
})

test('a re-read that completes still incomplete goes back to Try again', async () => {
  const refreshes = []
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { refresh: () => refreshes.push(true) } })
  const report = fields => h.session.updateRuntime({ ...h.runtime(), refreshing: false, refreshDone: 0, ...fields })
  h.session.start(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  report({ ledgerReady: false, ledger: 'incomplete' }); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  report({ ledgerReady: false, ledger: 'incomplete', refreshing: true }); await tick()
  report({ ledgerReady: false, ledger: 'incomplete', refreshing: false, refreshDone: 1 }); await tick()
  const state = h.action('chat-send:one')
  assert.equal(state.note, LEDGER_NOTE)
  assert.equal(state.disabled, false)
  assert.equal(state.label, 'Try again')
  // While the ledger is still loading, it keeps checking.
  const loading = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')] })
  loading.session.start(); await tick()
  loading.fire('chat-send:one', 'activate'); await tick()
  loading.session.updateRuntime({ ...loading.runtime(), ledgerReady: false, ledger: 'loading' }); await tick()
  assert.equal(loading.action('chat-send:one').label, 'Checking…')
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

test('a rejected card refresh leaves no unhandled rejection and ends on Try again', async () => {
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { refresh: () => Promise.reject(new Error('listing failed')) } })
    const report = fields => h.session.updateRuntime({ ...h.runtime(), refreshing: false, refreshDone: 0, ...fields })
    h.session.start(); await tick()
    h.fire('chat-send:one', 'activate'); await tick()
    report({ ledgerReady: false, ledger: 'incomplete' }); await tick()
    h.fire('chat-send:one', 'activate'); await tick()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(unhandled, [], 'the rejection is handled')
    // The app reports the failed refresh as completed.
    report({ ledgerReady: false, ledger: 'incomplete', refreshDone: 1 }); await tick()
    const state = h.action('chat-send:one')
    assert.equal(state.label, 'Try again')
    assert.equal(state.disabled, false)
    assert.equal(state.confirming, false)
  } finally { process.off('unhandledRejection', onUnhandled) }
})

test('a refresh that times out ends the check on Try again, and a late answer cannot complete it', async () => {
  const refreshes = []
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { refresh: () => refreshes.push(true) } })
  const report = fields => h.session.updateRuntime({ ...h.runtime(), refreshing: false, refreshDone: 0, refreshOutcome: '', ...fields })
  const unavailable = { state: 'unavailable', byId: {}, addressed: ['one'] }
  h.session.start(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  report({ reviewStatus: unavailable }); await tick()
  assert.equal(h.action('chat-send:one').label, 'Try again')
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(refreshes.length, 1)
  // The review check is still loading when the deadline passes.
  report({ reviewStatus: { state: 'loading', byId: {} }, refreshing: true }); await tick()
  report({ reviewStatus: { state: 'loading', byId: {} }, refreshDone: 1, refreshOutcome: 'timeout' }); await tick()
  let state = h.action('chat-send:one')
  assert.equal(state.label, 'Try again', 'the timed-out check ends')
  assert.equal(state.disabled, false)
  assert.equal(state.note, TIMEOUT_NOTE)
  assert.equal(state.confirming, false)
  // The late answer arrives: it updates data but cannot complete the ended activation.
  report({ refreshDone: 1, refreshOutcome: 'timeout' }); await tick()
  state = h.action('chat-send:one')
  assert.equal(state.confirming, false, 'no Confirm from a late answer')
  assert.equal(h.sends.length, 0)
  // Only a new Try again reaches Confirm.
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirming, true)
  assert.equal(h.sends.length, 0)
})

test('a refresh that fails ends the check on Try again with a note', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { refresh: () => {} } })
  const report = fields => h.session.updateRuntime({ ...h.runtime(), refreshing: false, refreshDone: 0, refreshOutcome: '', ...fields })
  h.session.start(); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  report({ ledgerReady: false, ledger: 'incomplete' }); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  report({ ledger: 'current', refreshDone: 1, refreshOutcome: 'failed' }); await tick()
  const state = h.action('chat-send:one')
  assert.equal(state.confirming, false, 'a failed refresh never confirms, even if the data now looks complete')
  assert.equal(state.label, 'Try again')
  assert.equal(state.note, REFRESH_FAILED_NOTE)
})

// The card prepared_block.py prints, read as the host reads it: the root
// action is the only action, and the session carries the item intents.
function printedCard(records) {
  const ledger = mkdtempSync(join(tmpdir(), 'contribute-card-'))
  try {
    for (const record of records) writeFileSync(join(ledger, `${record.id}.json`), JSON.stringify({ ...record, chat_id: 'chat-v1' }))
    const run = spawnSync('python3', [new URL('../prepared_block.py', import.meta.url).pathname, ...records.map(record => record.id), '--ledger-dir', ledger, '--chat-id', 'chat-v1'], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    return JSON.parse(/```mobius-app\n(.*)\n```/s.exec(run.stdout)[1])
  } finally { rmSync(ledger, { recursive: true, force: true }) }
}
async function hostView(block) {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return { actions: [block.action, ...block.items.map(item => item.action)].filter(Boolean).map(action => ({ key: action.intent, label: action.label })), items: block.items.map(({ intent }) => ({ intent })) }
  const { appBlockFromToken, blockActions, blockItems } = await import(`${BLOCKS}/src/components/ChatView/markdown/appBlock.js`)
  const parsed = appBlockFromToken({ type: 'code', lang: 'mobius-app', text: JSON.stringify(block) })
  assert.ok(parsed, 'the host accepts the printed card')
  assert.equal(parsed.expand, false)
  // The session init's items exactly as the host builds them (#1944 blockItems), read through this app's adapter.
  const items = blockItems ? readBlockSession({ sessionId: 's', actions: [], items: blockItems(parsed) }).items : parsed.items.map(({ intent }) => ({ intent }))
  return { actions: blockActions(parsed).map(({ key, label }) => ({ key, label })), items }
}

test('the printed card has one action that reaches Confirm for exactly its items', async () => {
  const shots = [{ name: 'before.png', sha256: 'e'.repeat(64), size: 1200, alt: 'Before' }, { name: 'after.png', sha256: 'e'.repeat(64), size: 1200, alt: 'After' }]
  const records = [prepared('one'), prepared('two', { plan: { screenshots: shots } }), prepared('three')]
  const view = await hostView(printedCard(records))
  assert.equal(view.actions.length, 1, 'one block-level action, no per-item actions')
  const h = harness({ actions: view.actions, items: view.items, records })
  await openConfirm(h, view.actions[0].key)
  const state = h.action(view.actions[0].key)
  assert.equal(state.confirming, true)
  assert.deepEqual(state.confirmation.map(item => item.title), ['Change one', 'Change two', 'Change three'])
  // The host draws Confirm's rows in place of the card's, so they are the same rows.
  const block = printedCard(records)
  assert.deepEqual(state.confirmation, block.items.map(({ title, facts }) => ({ title, facts })))
  assert.equal(block.items[1].facts[1].value, '1 file · +2 −0 · 2 screenshots', 'the card and Confirm name the same screenshots')
  // A card printed for one stack layer lists the whole phase, so it reaches Confirm.
  const layers = [layer('base', 1, ''), layer('top', 2, 'base')]
  layers[1].plan.base_sha = layers[0].plan.head_sha
  const ledgerDir = mkdtempSync(join(tmpdir(), 'contribute-card-'))
  let stackCard
  try {
    for (const record of layers) writeFileSync(join(ledgerDir, `${record.id}.json`), JSON.stringify({ ...record, chat_id: 'chat-v1' }))
    const run = spawnSync('python3', [new URL('../prepared_block.py', import.meta.url).pathname, 'base', '--ledger-dir', ledgerDir, '--chat-id', 'chat-v1'], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    stackCard = await hostView(JSON.parse(/```mobius-app\n(.*)\n```/s.exec(run.stdout)[1]))
  } finally { rmSync(ledgerDir, { recursive: true, force: true }) }
  assert.deepEqual(stackCard.items, reviewItems(['base', 'top']))
  const stacked = harness({ actions: stackCard.actions, items: stackCard.items, records: layers })
  await openConfirm(stacked, stackCard.actions[0].key)
  assert.deepEqual(stacked.action(stackCard.actions[0].key).confirmation.map(item => item.title), ['Change base', 'Change top'])
  // A layer's row adds only which layer it is.
  assert.deepEqual(stacked.action(stackCard.actions[0].key).confirmation[1].facts.map(fact => fact.label), ['Project', 'Change', 'Stack'])
  const single = await hostView(printedCard([prepared('one')]))
  const one = harness({ actions: single.actions, items: single.items, records: [prepared('one')] })
  await openConfirm(one, single.actions[0].key)
  assert.deepEqual(one.action(single.actions[0].key).confirmation.map(item => item.title), ['Change one'])
})

test('Contribute all covers every listed record or none: one that needs attention holds the card and is named', async () => {
  const ids = ['open-chats', 'media-call']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const blocked = prepared('open-chats', { plan: { title: 'Open chats without duplicate requests from a pull request link' },
    record: { last_submit_error: 'Push outcome unknown' } })
  const h = harness({ actions, items: reviewItems(ids), records: [blocked, prepared('media-call')] })
  await openConfirm(h, actions[0].key)
  const state = h.action(actions[0].key)
  assert.equal(state.confirming, false, 'no Confirm for only part of the card')
  assert.equal(state.confirmation, null)
  assert.equal(state.open, true)
  assert.equal(state.note, '“Open chats without duplicate requests…”: The last send needs attention in Contribute.')
  h.fire(actions[0].key, 'confirm'); await tick()
  assert.equal(h.sends.length, 0, 'nothing is sent')

  // A single-record card keeps its own reason, unnamed.
  const one = harness({ actions: [{ key: 'chat-send:open-chats' }], records: [blocked] })
  await openConfirm(one, 'chat-send:open-chats')
  assert.equal(one.action('chat-send:open-chats').note, 'The last send needs attention in Contribute.')
  // An already published row does not hold the rest.
  const sent = harness({ actions, items: reviewItems(ids), records: [published(prepared('open-chats')), prepared('media-call')] })
  await openConfirm(sent, actions[0].key)
  assert.deepEqual(sent.action(actions[0].key).confirmation.map(item => item.title), ['Change media-call'])
})

// A stack whose existing-PR prefix is updated first and whose new child opens
// in a later phase, listed with an unrelated ready contribution.
function mixedStack({ topError = null } = {}) {
  const base = layer('base', 1, '')
  base.plan.action = 'pr_update'
  Object.assign(base, { number: 41 })
  const top = layer('top', 2, 'base')
  top.plan.base_sha = base.plan.head_sha
  if (topError) top.last_submit_error = topError
  return [base, top, prepared('solo')]
}
for (const [label, topError, reason] of [
  ['a blocked deferred child', 'Needs attention', 'The last send needs attention in Contribute.'],
  ['an otherwise ready deferred child', null, 'It is sent after the layers before it. Open Contribute to send them in order.'],
]) {
  test(`a listed stack layer outside the phase being confirmed holds the card: ${label}`, async () => {
    const ids = ['base', 'top', 'solo']
    const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
    const h = harness({ actions, items: reviewItems(ids), records: mixedStack({ topError }) })
    await openConfirm(h, actions[0].key)
    const state = h.action(actions[0].key)
    assert.equal(state.confirming, false, 'Confirm never covers only the update phase')
    assert.equal(state.open, true)
    assert.equal(state.note, `“Change top”: ${reason}`, 'the held layer itself is named')
    h.fire(actions[0].key, 'confirm'); await tick()
    assert.equal(h.sends.length, 0, 'nothing freezes or sends for an incomplete listed set')
  })
}

test('in one phase, the unsized layer is named with its own reason, not its sized parent', async () => {
  const ids = ['base', 'top', 'solo']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const base = layer('base', 1, '')
  const top = layer('top', 2, 'base')
  top.plan.base_sha = base.plan.head_sha
  top.plan.diff_stat = ''
  const h = harness({ actions, items: reviewItems(ids), records: [base, top, prepared('solo')] })
  await openConfirm(h, actions[0].key)
  const state = h.action(actions[0].key)
  assert.equal(state.confirming, false)
  assert.equal(state.note, `“Change top”: ${SIZE_NOTE}`)
  h.fire(actions[0].key, 'confirm'); await tick()
  assert.equal(h.sends.length, 0)
})

const SHA = 'e'.repeat(64)
const shot = (name, alt = name) => ({ name, sha256: SHA, size: 1200, alt })

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

// ---- Card states: calm progress, rechecks, and what each row says afterwards.
function clock(start = Date.parse('2026-10-20T10:30:00Z')) {
  let at = start
  const pending = new Map()
  let next = 1
  return {
    now: () => at,
    timers: { set: (fn, ms) => { const id = next++; pending.set(id, { fn, due: at + ms }); return id }, clear: id => pending.delete(id) },
    pending: () => [...pending.values()],
    // Advance time and run every timer that is due, as the browser would.
    async advance(ms) {
      at += ms
      for (const [id, timer] of [...pending]) if (timer.due <= at) { pending.delete(id); timer.fn() }
      await tick()
    },
  }
}
function timed(options, c) {
  const h = harness(options)
  h.session.dispose()
  const states = h.states
  const session = createInlineSession({ sessionId: 'session-1', actions: options.actions, items: options.items ?? defaultItems(options.actions), features: options.features ?? ['row-state'],
    checkpoint: options.checkpoint ?? null, retain: options.retain ?? false, publish: state => states.push(structuredClone(state)),
    loadExact: async id => h.store.has(id) ? structuredClone(h.store.get(id)) : null, onNeedRuntime: () => h.needs.push(true),
    timers: c.timers, now: c.now })
  let nonce = 100
  return { ...h, session, fire: (key, event) => session.handleEvent({ sessionId: 'session-1', key, event, nonce: `t${++nonce}` }),
    provide: () => session.updateRuntime(h.runtime()) }
}

test('sending shows calm per-row progress and a disabled Sending… with no warning text', async () => {
  const gate = deferred()
  const ids = ['one', 'two']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, items: reviewItems(ids), records: ids.map(id => prepared(id)), send: () => gate.promise })
  await openConfirm(h, actions[0].key)
  assert.equal(h.last().title, '', 'before anything happens the card keeps its own title')
  assert.deepEqual(h.last().items, [])
  h.fire(actions[0].key, 'confirm'); await tick()
  const state = h.action(actions[0].key)
  assert.deepEqual([state.label, state.busy, state.disabled, state.note, state.status], ['Sending…', true, true, '', ''])
  assert.equal(h.last().title, 'Sending 2 contributions')
  assert.deepEqual(h.last().items, ids.map(id => ({ intent: `review:${id}`, status: 'Sending', busy: true })))
  gate.resolve({ ok: true })
})

test('an unconfirmed push is rechecked on its own, never resent, and settles when the record is published', async () => {
  const c = clock()
  let refreshes = 0
  const h = timed({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ uncertain: true }),
    runtime: { refresh() { refreshes += 1 } } }, c)
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.action('chat-send:one').label, 'Checking…')
  assert.equal(c.pending().length, 1, 'one recheck is scheduled')
  await c.advance(RECHECK_DELAYS_MS[0])
  assert.equal(refreshes, 1, 'the recheck uses the app\'s refresh path')
  assert.equal(c.pending().length, 1, 'still unknown: the next recheck is scheduled')
  h.store.set('one', published(prepared('one'), 12))
  await c.advance(RECHECK_DELAYS_MS[1])
  assert.equal(h.action('chat-send:one').hidden, true)
  assert.equal(h.last().title, 'Pull request opened')
  assert.deepEqual(h.last().items[0].links, [{ label: '#12', url: 'https://github.com/owner/repo/pull/12' }])
  assert.equal(h.last().checkpoint, null)
  assert.equal(c.pending().length, 0, 'nothing left to check')
  assert.equal(h.sends.length, 1, 'never sent twice')
})

test('after the recheck window an unconfirmed push says Not confirmed and only opens Contribute', async () => {
  const c = clock()
  const h = timed({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ uncertain: true }) }, c)
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  for (let elapsed = 0; elapsed <= RECHECK_WINDOW_MS && c.pending().length; elapsed += 60000) await c.advance(60000)
  assert.equal(c.pending().length, 0, 'rechecks stop after the window')
  const state = h.action('chat-send:one')
  assert.deepEqual([state.open, state.label, state.busy, state.note], [true, 'Open Contribute', false, ''])
  assert.deepEqual(h.last().items, [{ intent: 'review:one', status: 'Not confirmed' }])
  assert.ok(h.last().checkpoint, 'the unresolved attempt still crosses a reload')
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirming, false)
  assert.equal(h.sends.length, 1)
  // A record that later turns out published still settles the card.
  h.store.set('one', published(prepared('one'), 13)); h.provide(); await tick()
  assert.equal(h.action('chat-send:one').hidden, true)
})

test('a reloaded card past its window does not recheck forever', async () => {
  const c = clock()
  const old = encodeCheckpoint([{ id: 'a1', unitKey: 'record:one', ids: ['one'], at: c.now() - RECHECK_WINDOW_MS - 1, state: 'unknown' }])
  const h = timed({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], checkpoint: { id: 'cp', data: old }, retain: true }, c)
  h.session.start(); await tick()
  assert.equal(c.pending().length, 0)
  assert.equal(h.action('chat-send:one').open, true)
})

test('a partly sent card links the sent rows, names the failed one, and opens Contribute when it cannot retry', async () => {
  const ids = ['one', 'two']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, items: reviewItems(ids), records: ids.map(id => prepared(id)),
    send: rec => rec.id === 'one' ? { ok: true } : { error: 'The branch already exists.', failure: { owner: 'agent' } } })
  await openConfirm(h, actions[0].key)
  h.store.set('one', published(prepared('one'), 21))
  // The server records the failure on the record, which holds it for Contribute.
  h.store.set('two', prepared('two', { record: { last_submit_error: 'The branch already exists.', updated_at: '2026-10-20T23:00:00Z' } }))
  h.fire(actions[0].key, 'confirm'); await tick(); h.provide(); await tick()
  assert.equal(h.last().title, '1 of 2 sent')
  assert.deepEqual(h.last().items, [
    { intent: 'review:one', status: 'Open', statusTone: 'success', links: [{ label: '#21', url: 'https://github.com/owner/repo/pull/21' }] },
    { intent: 'review:two', status: 'Not sent', statusTone: 'danger', note: 'The branch already exists.' }])
  const state = h.action(actions[0].key)
  assert.deepEqual([state.open, state.label], [true, 'Open Contribute'])
  assert.equal(state.note.includes('already exists'), false, 'the reason is said once, on its row')
})

test('a held card names the contribution that holds it and opens Contribute', async () => {
  const ids = ['one', 'two']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, items: reviewItems(ids),
    records: [prepared('one'), prepared('two', { record: { quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD } } })] })
  await openConfirm(h, actions[0].key)
  const state = h.action(actions[0].key)
  assert.equal(state.confirming, false)
  assert.deepEqual([state.open, state.label, state.tone, state.status], [true, 'Open Contribute', 'neutral', ''])
  assert.match(state.note, /^“Change two”: /)
})

test('an update to an existing pull request is reported as sent, not opened; rows need the host\'s items', async () => {
  const update = prepared('one', { plan: { action: 'pr_update' } })
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [published(update, 30)] })
  h.session.start(); h.provide(); await tick()
  assert.equal(h.last().title, 'Contribution sent')
  assert.equal(h.last().items[0].links[0].label, '#30')
  const older = harness({ actions: [{ key: 'chat-send:one' }], items: null, records: [published(prepared('one'), 31)] })
  older.session.start(); older.provide(); await tick()
  assert.deepEqual(older.last().items, [], 'without the card items there are no rows to report on')
})

test('the host shows a legacy card\'s published status and PR link, and a neutral note while prepared', async t => {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS || !frontendModules) return t.skip('set MOBIUS_BLOCKS_FRONTEND and MOBIUS_FRONTEND_NODE_MODULES to render the real host block')
  const markdown = `${BLOCKS}/src/components/ChatView/markdown`
  // Host modules only: stylesheets and the hidden app canvas are not rendered.
  const stub = { name: 'stub-host', load(id) {
    if (id.endsWith('.css')) return { code: '', moduleType: 'js' }
    if (/AppCanvas\/AppCanvas\.jsx$|useAppBlockSession\.js$/.test(id)) return { code: 'export default function Stub() { return null }', moduleType: 'js' }
    return null
  } }
  const host = await renderModule(`
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PassiveBlockView } from '${markdown}/PassiveAppBlock.jsx'
import { appBlockFromToken, blockActions, blockItems } from '${markdown}/appBlock.js'
import { sessionState } from '${markdown}/appBlockSession.js'
export const parse = text => appBlockFromToken({ type: 'code', lang: 'mobius-app', text })
export const init = block => ({ actions: blockActions(block), items: blockItems(block), features: ['row-state'] })
export function render(block, message) {
  const state = sessionState(message, message.sessionId, new Set(blockActions(block).map(action => action.key)))
  return renderToStaticMarkup(createElement(PassiveBlockView, { block, app: { id: 1, name: 'Contribute', slug: 'contribute' },
    state, locked: false, onEvent() {}, onInternalNav() {} }))
}`, [stub])
  // A card as printed before #116: root facts and one action, no items.
  const block = host.parse(JSON.stringify({ app: 'contribute', intent: 'review:one', title: 'Change one', interaction: 'inline',
    facts: [{ label: 'Repository', value: 'owner/repo' }, { label: 'Action', value: 'Open a new pull request' }],
    action: { label: 'Contribute', intent: 'chat-send:one' } }))
  const rendered = async record => {
    const { actions, items, features } = host.init(block)
    const h = harness({ actions, items, features, records: [record] })
    h.session.start(); await tick()
    const { sessionId, ...body } = h.last()
    return host.render(block, { type: 'moebius:app-block-state', sessionId, ...body })
  }
  const sent = await rendered(published(prepared('one')))
  assert.match(sent, /<span class="md-app-block__pill is-success">Open<\/span>/)
  assert.match(sent, /<a class="md-app-block__link" href="https:\/\/github.com\/owner\/repo\/pull\/7"[^>]*>#7<svg/)
  assert.match(sent, /<button[^>]*disabled=""[^>]*>Sent<\/button>/)
  const waiting = await rendered(prepared('one'))
  assert.match(waiting, /<a class="md-app-block__action is-secondary" href="[^"]*">Open Contribute<\/a>/)
  assert.doesNotMatch(waiting, /md-app-block__note|<button[^>]*md-app-block__action/)
  for (const markup of [sent, waiting]) assert.doesNotMatch(markup, /Needs attention|no longer matches|is-attention/)
})

test('after the window the header says the result is not confirmed, never still sending', async () => {
  const c = clock()
  const h = timed({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ uncertain: true }) }, c)
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.last().title, 'Sending 1 contribution')
  for (let i = 0; i < 20 && c.pending().length; i++) await c.advance(60000)
  assert.equal(h.last().title, 'Result not confirmed')
  // With another row sent, the header counts what is known.
  const two = ['one', 'two']
  const actions = [{ key: `chat-send-batch:${batchHandle(two)}` }]
  const c2 = clock()
  const m = timed({ actions, items: reviewItems(two), records: two.map(id => prepared(id)), send: rec => rec.id === 'one' ? { ok: true } : { uncertain: true } }, c2)
  await openConfirm(m, actions[0].key)
  m.store.set('one', published(prepared('one'), 5))
  m.fire(actions[0].key, 'confirm'); await tick()
  for (let i = 0; i < 20 && c2.pending().length; i++) await c2.advance(60000)
  assert.equal(m.last().title, '1 of 2 sent')
})

test('a partly sent card retries only the failed contribution through a second Confirm', async () => {
  const ids = ['one', 'two']
  const actions = [{ key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  let first = true
  const h = harness({ actions, items: reviewItems(ids), records: ids.map(id => prepared(id)),
    send: rec => rec.id === 'two' && first ? (first = false, { notAttempted: true, error: 'The saved proposal changed.' }) : { ok: true } })
  const key = actions[0].key
  await openConfirm(h, key)
  h.store.set('one', published(prepared('one'), 5))
  h.fire(key, 'confirm'); await tick(); h.provide(); await tick()
  assert.equal(h.action(key).label, 'Retry')
  assert.equal(h.action(key).disabled, false)
  h.fire(key, 'activate'); await tick(); h.provide(); await tick()
  assert.deepEqual(h.action(key).confirmation.map(item => item.title), ['Change two'], 'Confirm lists only the unsent one')
  h.store.set('two', published(prepared('two'), 6))
  h.fire(key, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(send => send.ids), [['one'], ['two'], ['two']])
  assert.equal(h.last().title, '2 pull requests opened')
})

test('disposing the card cancels its pending recheck', async () => {
  const c = clock()
  const h = timed({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ uncertain: true }) }, c)
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(c.pending().length, 1)
  h.session.dispose()
  assert.equal(c.pending().length, 0)
})

test('on an older host the action itself carries the result, and nothing relies on row state', async () => {
  const gate = deferred()
  const h = harness({ actions: [{ key: 'chat-send:one' }], features: [], records: [prepared('one')], send: () => gate.promise })
  await openConfirm(h, 'chat-send:one')
  assert.equal('itemFacts' in h.last(), false)
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.deepEqual([h.action('chat-send:one').label, h.action('chat-send:one').status], ['Sending…', 'Sending'])
  assert.deepEqual([h.last().title, h.last().items], ['', []])
  h.store.set('one', { ...published(prepared('one'), 7), status: 'merged' })
  gate.resolve({ ok: true }); await tick()
  const sent = h.action('chat-send:one')
  assert.deepEqual([sent.hidden, sent.disabled, sent.open, sent.label, sent.status, sent.statusTone], [false, true, false, 'Sent', 'Merged', 'accent'])
  assert.deepEqual(sent.links, [{ label: '#7', url: 'https://github.com/owner/repo/pull/7' }])
  // An expired check is a disabled control with one line saying where to look.
  const c = clock()
  const lost = timed({ actions: [{ key: 'chat-send:one' }], features: [], records: [prepared('one')], send: () => ({ uncertain: true }) }, c)
  await openConfirm(lost, 'chat-send:one')
  lost.fire('chat-send:one', 'confirm'); await tick()
  for (let i = 0; i < 20 && c.pending().length; i++) await c.advance(60000)
  const state = lost.action('chat-send:one')
  assert.deepEqual([state.open, state.disabled, state.status, state.note], [false, true, 'Not confirmed', EXPIRED_NOTE])
})

test('a row-state host gets value-only row facts and a purple Merged pill', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [{ ...published(prepared('one'), 8), status: 'merged' }] })
  h.session.start(); h.provide(); await tick()
  assert.equal(h.last().itemFacts, 'values')
  assert.deepEqual(h.last().items[0], { intent: 'review:one', status: 'Merged', statusTone: 'accent', links: [{ label: '#8', url: 'https://github.com/owner/repo/pull/8' }] })
})
