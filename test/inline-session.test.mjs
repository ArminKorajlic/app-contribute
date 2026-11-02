import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchHandle, cardRecordIds, itemRecordIds, sendTarget } from '../chat-blocks.js'
import { readBlockSession } from '../block-protocol.js'
import { reviewAddressFor } from '../send-readiness.js'
import { attemptOutcome, confirmationItem, descriptionExcerpt, LEDGER_NOTE, NEWER_NOTE, UNLISTED_LAYER_NOTE, REFRESH_FAILED_NOTE, SIZE_NOTE, TIMEOUT_NOTE, createInlineSession, decodeCheckpoint, encodeCheckpoint, observeAttempt, RECOVERY_NOTE } from '../inline-session.js'

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
function harness({ actions, items = defaultItems(actions), records, checkpoint = null, retain = false, send, sendStack, address = null, loadExact = null, runtime: extra = {} }) {
  const store = new Map(records.map(record => [record.id, record]))
  const states = [], sends = [], needs = []
  const session = createInlineSession({ sessionId: 'session-1', actions, items, checkpoint, retain, publish: state => states.push(structuredClone(state)),
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

test('Contribute becomes Confirm with the complete app-sourced identity of each frozen change', async () => {
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
  // The card's per-contribution facts (Project, Change) lead, with the card's values.
  assert.deepEqual(item.facts.map(fact => fact.label), ['Project', 'Change', 'Action', 'Branch', 'Version', 'Reviewed diff', 'Review'])
  assert.deepEqual(item.facts.slice(0, 2), [{ label: 'Project', value: 'owner/repo' }, { label: 'Change', value: '1 file · +2 −0' }])
  const sized = confirmationItem(prepared('sized', { plan: { diff_stat: ' 3 files changed, 40 insertions(+), 2 deletions(-)' } }))
  assert.deepEqual(sized.facts.find(fact => fact.label === 'Change'), { label: 'Change', value: '3 files · +40 −2' }, 'Confirm shows how big the change is')
  const stacked = confirmationItem({ ...layer('base', 1, ''), plan: { ...layer('base', 1, '').plan, diff_stat: '1 file changed, 1 insertion(+)' } })
  assert.equal(stacked.facts.length, 8, 'a stack layer with its size stays within the eight-fact limit')
  assert.equal(stacked.facts.find(fact => fact.label === 'Change').value, '1 file · +1 −0')
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
  assert.deepEqual(done.links, [{ label: 'View PR #7', url: 'https://github.com/owner/repo/pull/7' }])
  assert.equal(h.last().checkpoint, null, 'a proven result releases the checkpoint')
})

test('the newest attempt owns the checkpoint after fail, restage and retry (reload before response)', async () => {
  let call = 0
  const second = deferred()
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')],
    send: () => ++call === 1 ? { error: 'Push rejected', failure: { owner: 'agent' } } : second.promise })
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.action('chat-send:one').status, 'Needs attention')
  assert.equal(h.last().checkpoint, null, 'a known failure is not a lock')
  // The agent restages a new reviewed head; the owner confirms again.
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z' } }))
  h.provide()
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirmation[0].facts.find(fact => fact.label === 'Version').value, NEXT.slice(0, 12))
  h.fire('chat-send:one', 'confirm'); await tick()
  const saved = decodeCheckpoint(h.last().checkpoint)
  assert.equal(saved.length, 1, 'only the unresolved retry crosses reload')
  assert.deepEqual(saved[0].ids, ['one'])
  // Reload: a new document restores from that checkpoint and stays locked.
  const reloaded = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', { head: NEXT })], checkpoint: h.last().checkpoint, retain: true })
  reloaded.session.start(); await tick()
  assert.equal(reloaded.last().checkpointAck, h.last().checkpoint.id)
  assert.equal(reloaded.action('chat-send:one').label, 'Check again')
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
  assert.match(h.action('chat-send:one').note, /saved proposal changed/)
  assert.equal(h.action('chat-send:one').disabled, false)
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirming, true, 'not attempted can be confirmed again')

  const lost = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ uncertain: true }) })
  await openConfirm(lost, 'chat-send:one')
  lost.fire('chat-send:one', 'confirm'); await tick()
  assert.ok(lost.last().checkpoint, 'a lost response stays owned')
  assert.equal(lost.action('chat-send:one').status, 'Checking result')
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
  assert.deepEqual(h.last().summary, '1 sent · 3 prepared', 'a finished unit settles before slower siblings')
  assert.equal(h.action(batch).busy, true)
  h.store.set('base', published(h.store.get('base'), 9)); h.store.set('top', published(h.store.get('top'), 10))
  gates.stack.resolve({ ok: true }); await tick()
  gates.one.resolve({ error: 'Push rejected', failure: { owner: 'agent' } }); await tick()
  assert.equal(h.action(batch).status, 'Needs attention')
  assert.equal(h.last().summary, '3 sent · 1 prepared', 'a sibling failure never makes a sent unit pending')
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
  assert.equal(state.disabled, true)
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
    assert.equal(state.disabled, true)
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
  assert.equal(batch.disabled, true)
  assert.match(batch.note, /no longer matches/)
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
  assert.equal(update.facts.find(fact => fact.label === 'Action').value, 'Update pull request #12')
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
  assert.equal(state.disabled, true)
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
      assert.match(state.note, /not confirmed yet/)
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

test('Confirm shows the public PR title and the first line of its description within the fact limit', () => {
  const item = confirmationItem(prepared('pub', { plan: { title: 'Fix the flaky upload retry', body_draft: '## Summary\n\nRetries uploads once on a reset connection.\n\nMore detail.' } }))
  assert.equal(item.title, 'Fix the flaky upload retry', 'the PR title is the item heading')
  assert.deepEqual(item.facts.find(fact => fact.label === 'Description'), { label: 'Description', value: 'Retries uploads once on a reset connection.' }, 'headings are skipped')
  assert.equal(descriptionExcerpt('\n\n- First point\nSecond'), 'First point')
  const long = descriptionExcerpt('x'.repeat(400))
  assert.equal(long.length, 160); assert.ok(long.endsWith('…'))
  assert.ok(item.facts.length <= 8)
  // A stack layer with its size already uses all eight facts: the description is left out, never a ninth fact.
  const full = confirmationItem({ ...layer('base', 1, ''), plan: { ...layer('base', 1, '').plan, diff_stat: '1 file changed, 1 insertion(+)', body_draft: 'Body' } })
  assert.equal(full.facts.length, 8)
  assert.equal(full.facts.some(fact => fact.label === 'Description'), false)
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
    assert.equal(state.disabled, true, `${name}: single stays blocked`)
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

test('the description excerpt keeps emphasis and skips comments and code fences', () => {
  assert.equal(descriptionExcerpt('**Summary** of the fix'), '**Summary** of the fix', 'emphasis is not a list marker')
  assert.equal(descriptionExcerpt('*important* change'), '*important* change')
  assert.equal(descriptionExcerpt('- First point'), 'First point')
  assert.equal(descriptionExcerpt('+ Added thing'), 'Added thing')
  assert.equal(descriptionExcerpt('> Quoted'), 'Quoted')
  assert.equal(descriptionExcerpt('1. Step one'), 'Step one')
  assert.equal(descriptionExcerpt('#hashtag-like start'), '#hashtag-like start', 'not a heading without a space')
  assert.equal(descriptionExcerpt('<!-- template: fill in -->\nReal summary'), 'Real summary')
  assert.equal(descriptionExcerpt('<!--\nmulti-line\ncomment\n-->\nAfter the comment'), 'After the comment')
  assert.equal(descriptionExcerpt('```js\nconst x = 1\n```\nProse after code'), 'Prose after code')
  assert.equal(descriptionExcerpt('## Summary\n\nRetries once.'), 'Retries once.')
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
    for (const record of records) writeFileSync(join(ledger, `${record.id}.json`), JSON.stringify(record))
    const run = spawnSync('python3', [new URL('../prepared_block.py', import.meta.url).pathname, ...records.map(record => record.id), '--ledger-dir', ledger], { encoding: 'utf8' })
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
  // Confirm repeats each item's card facts.
  const block = printedCard(records)
  for (const [index, item] of block.items.entries()) assert.deepEqual(state.confirmation[index].facts.slice(0, 2), item.facts)
  assert.equal(block.items[1].facts[1].value, '1 file · +2 −0 · 2 screenshots', 'the card and Confirm name the same screenshots')
  // A card printed for one stack layer lists the whole phase, so it reaches Confirm.
  const layers = [layer('base', 1, ''), layer('top', 2, 'base')]
  layers[1].plan.base_sha = layers[0].plan.head_sha
  const ledgerDir = mkdtempSync(join(tmpdir(), 'contribute-card-'))
  let stackCard
  try {
    for (const record of layers) writeFileSync(join(ledgerDir, `${record.id}.json`), JSON.stringify(record))
    const run = spawnSync('python3', [new URL('../prepared_block.py', import.meta.url).pathname, 'base', '--ledger-dir', ledgerDir], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    stackCard = await hostView(JSON.parse(/```mobius-app\n(.*)\n```/s.exec(run.stdout)[1]))
  } finally { rmSync(ledgerDir, { recursive: true, force: true }) }
  assert.deepEqual(stackCard.items, reviewItems(['base', 'top']))
  const stacked = harness({ actions: stackCard.actions, items: stackCard.items, records: layers })
  await openConfirm(stacked, stackCard.actions[0].key)
  assert.deepEqual(stacked.action(stackCard.actions[0].key).confirmation.map(item => item.title), ['Change base', 'Change top'])
  const single = await hostView(printedCard([prepared('one')]))
  const one = harness({ actions: single.actions, items: single.items, records: [prepared('one')] })
  await openConfirm(one, single.actions[0].key)
  assert.deepEqual(one.action(single.actions[0].key).confirmation.map(item => item.title), ['Change one'])
})

const SHA = 'e'.repeat(64)
const shot = (name, alt = name) => ({ name, sha256: SHA, size: 1200, alt })

test('the description excerpt never shows raw screenshot markup', () => {
  assert.equal(descriptionExcerpt('![Before, desktop](screenshot:before-desktop.png)\n\nMakes the header wrap on phones.'), 'Makes the header wrap on phones.', 'an image-only line is skipped')
  assert.equal(descriptionExcerpt('| Before | After |\n| --- | --- |\n| ![Before](screenshot:before.png) | ![After](screenshot:after.png) |\n\nFixes the clipped title.'), 'Fixes the clipped title.', 'a before/after table is skipped')
  assert.equal(descriptionExcerpt('The header now wraps ![After](screenshot:after.png) on phones.'), 'The header now wraps After on phones.', 'an inline image becomes its alt text')
  assert.doesNotMatch(descriptionExcerpt('## Screenshots\n\n![Only](screenshot:only.png)'), /screenshot:|!\[/)
})

test('Confirm names the screenshots a new pull request will publish on its Change line', () => {
  const body = '## Summary\n\nFixes the clipped title.\n\n| Before | After |\n| --- | --- |\n| ![Before](screenshot:before.png) | ![After](screenshot:after.png) |'
  const item = confirmationItem(prepared('shots', { plan: { body_draft: body, screenshots: [shot('before.png'), shot('after.png')] } }))
  assert.equal(item.facts.find(fact => fact.label === 'Change').value, '1 file · +2 −0 · 2 screenshots')
  assert.equal(item.facts.some(fact => fact.label === 'Screenshots'), false, 'no separate fact spends the limit')
  assert.equal(item.facts.find(fact => fact.label === 'Description')?.value, 'Fixes the clipped title.', 'the excerpt is kept')
  assert.ok(item.facts.length <= 8)
  assert.ok(item.facts.every(fact => !/screenshot:/.test(fact.value)))
  assert.equal(confirmationItem(prepared('one', { plan: { screenshots: [shot('one.png')] } })).facts.find(fact => fact.label === 'Change').value,
    '1 file · +2 −0 · 1 screenshot')

  // Malformed entries are not counted; none at all leaves the Change line as is.
  const plain = confirmationItem(prepared('plain', { plan: { screenshots: [{ name: '../x.png', sha256: SHA }, { name: 'ok.png', sha256: 'short' }] } }))
  assert.equal(plain.facts.find(fact => fact.label === 'Change').value, '1 file · +2 −0')

  // Without a readable diff stat, the count still gets its own Change line.
  const unsized = confirmationItem(prepared('unsized', { plan: { diff_stat: '', screenshots: [shot('a.png')] } }))
  assert.equal(unsized.facts.find(fact => fact.label === 'Change')?.value, '1 screenshot')

  // A stack layer already uses all eight facts; the count still fits on its Change line.
  const base = layer('base', 1, '')
  const full = confirmationItem({ ...base, plan: { ...base.plan, diff_stat: '1 file changed, 1 insertion(+)', screenshots: [shot('a.png'), shot('b.png')] } })
  assert.equal(full.facts.length, 8)
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
  assert.equal(parsed[0].facts.find(fact => fact.label === 'Description').value, 'Fix.')
  assert.match(parsed[1].facts.find(fact => fact.label === 'Change').value, /1 screenshot$/)
})
