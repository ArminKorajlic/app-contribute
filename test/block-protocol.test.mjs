import test from 'node:test'
import assert from 'node:assert/strict'
import { listenBlockSession, publishBlockState, readBlockSession } from '../block-protocol.js'

function fakeWindow() {
  const listeners = new Set(), posted = []
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const win = { parent, location: { origin: 'https://mobius.example' },
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  return { win, posted, deliver: event => [...listeners].forEach(fn => fn(event)), listeners }
}

test('only the parent shell on this origin can initialise or drive a card session', () => {
  const { win, deliver, listeners } = fakeWindow()
  globalThis.window = win
  const inits = [], actions = []
  const stop = listenBlockSession({ onInit: value => inits.push(value), onAction: value => actions.push(value) })
  const init = { type: 'moebius:app-block-init', sessionId: 's', actions: [{ key: 'chat-send:a', label: 'Contribute', extra: 1 }] }
  deliver({ source: {}, origin: 'https://mobius.example', data: init })
  deliver({ source: win.parent, origin: 'https://evil.example', data: init })
  deliver({ source: win.parent, origin: 'https://mobius.example', data: init })
  deliver({ source: win.parent, origin: 'https://mobius.example', data: { type: 'moebius:app-block-action', sessionId: 's', key: 'chat-send:a', event: 'confirm', nonce: 'n' } })
  assert.equal(inits.length, 1)
  assert.deepEqual(inits[0].actions, [{ key: 'chat-send:a', label: 'Contribute' }])
  assert.deepEqual(actions, [{ sessionId: 's', key: 'chat-send:a', event: 'confirm', nonce: 'n' }])
  stop()
  assert.equal(listeners.size, 0)
  delete globalThis.window
})

test('state goes through the host handle, or is posted with the document generation it received', () => {
  const { win, posted } = fakeWindow()
  globalThis.window = win
  const sent = []
  const handle = { sessionId: 's', generation: 3, setState: state => sent.push(state) }
  assert.equal(publishBlockState({ sessionId: 's', actions: [] }, handle), true)
  assert.deepEqual(sent, [{ actions: [] }])
  // A session announced by message is answered with that envelope's generation.
  assert.equal(publishBlockState({ sessionId: 'm', generation: 99, actions: [] }, { sessionId: 'm', generation: 7 }), true)
  assert.deepEqual(posted, [{ message: { type: 'moebius:app-block-state', sessionId: 'm', generation: 7, actions: [] }, origin: 'https://mobius.example' }])
  // No generation, or another session: nothing the host would accept is sent.
  assert.equal(publishBlockState({ sessionId: 'm', actions: [] }, { sessionId: 'm', generation: null }), false)
  assert.equal(publishBlockState({ sessionId: 'x', actions: [] }, handle), false)
  assert.equal(publishBlockState({ sessionId: 's', actions: [] }), false)
  assert.equal(posted.length, 1)
  delete globalThis.window
  assert.equal(readBlockSession({ sessionId: 's', generation: 3, actions: [] }).generation, 3)
  assert.equal(readBlockSession({ actions: [] }), null)
  assert.deepEqual(readBlockSession({ sessionId: 's', generation: '3', actions: [], retain: 'yes', checkpoint: { id: 'c', data: '{}', other: 1 } }),
    { sessionId: 's', generation: null, actions: [], items: null, features: [], context: null, checkpoint: { id: 'c', data: '{}' }, retain: false, recoveryError: false })
  // What the host draws beyond the original fields; only strings are kept.
  assert.deepEqual(readBlockSession({ sessionId: 's', actions: [], features: ['row-state', 3, null] }).features, ['row-state'])
})

test('the card item intents are read in card order, validated and deduplicated, and absent items stay absent', () => {
  const read = items => readBlockSession({ sessionId: 's', actions: [], items })?.items
  assert.deepEqual(read([{ intent: 'review:a', title: 'A', facts: [{ label: 'x', value: 'y' }] }, { intent: 'review:b' }, { intent: 'review:a' }]),
    [{ intent: 'review:a' }, { intent: 'review:b' }], 'intents only: no titles or facts, first wins')
  assert.deepEqual(read([{ intent: 'Review:a' }, { intent: 'review:a b' }, { intent: 7 }, null, { intent: `review:${'x'.repeat(257)}` }, { intent: 'review:c' }]),
    [{ intent: 'review:c' }], 'only valid host intents')
  assert.equal(read(undefined), null)
  assert.equal(read('review:a'), null)
  assert.equal(readBlockSession({ sessionId: 's', actions: [] }).items, null, 'an older host sends no items')
})

test('the chat context comes only from the host envelope, and refresh hints reach the card', () => {
  const read = context => readBlockSession({ sessionId: 's', actions: [], context })?.context
  assert.deepEqual(read({ chatId: '4ed0eedd-8d65-4708-96a7-1c90cf8a5c3d', latest: false, other: 1 }),
    { chatId: '4ed0eedd-8d65-4708-96a7-1c90cf8a5c3d', latest: false })
  assert.deepEqual(read({ chatId: 'chat-1' }), { chatId: 'chat-1', latest: true })
  for (const bad of [undefined, null, {}, { chatId: '' }, { chatId: 7 }, { chatId: '../other chat' }, { chatId: 'x'.repeat(65) }]) {
    assert.equal(read(bad), null, JSON.stringify(bad))
  }
  const { win, deliver } = fakeWindow()
  globalThis.window = win
  const hints = []
  const stop = listenBlockSession({ onInit() {}, onAction() {}, onRefresh: hint => hints.push(hint) })
  deliver({ source: win.parent, origin: 'https://mobius.example', data: { type: 'moebius:app-block-refresh', sessionId: 's', generation: 1, reason: 'visible' } })
  deliver({ source: win.parent, origin: 'https://mobius.example', data: { type: 'moebius:app-block-refresh', sessionId: 's', reason: 'anything' } })
  deliver({ source: {}, origin: 'https://mobius.example', data: { type: 'moebius:app-block-refresh', sessionId: 's', reason: 'turn' } })
  assert.deepEqual(hints, [{ sessionId: 's', reason: 'visible' }, { sessionId: 's', reason: 'turn' }])
  stop()
  delete globalThis.window
})

// The real B2 host modules, only when MOBIUS_BLOCKS_FRONTEND names a Möbius
// frontend checkout that has them. The tests above cover the same contract
// everywhere.
const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
async function b2(t) {
  if (!BLOCKS) { t.skip('set MOBIUS_BLOCKS_FRONTEND to a Möbius frontend with the passive block host to run this check'); return null }
  return {
    host: await import(`${BLOCKS}/src/components/AppCanvas/appBlockSessionHost.js`),
    state: await import(`${BLOCKS}/src/components/ChatView/markdown/appBlockSession.js`),
  }
}

test('the B2 host accepts exactly the reports this adapter posts for its document', async t => {
  const modules = await b2(t)
  if (!modules) return
  const { win, posted } = fakeWindow()
  globalThis.window = win
  const documents = modules.host.createBlockDocuments()
  const live = documents.load('v1')
  documents.mounted('v1', { blockGeneration: live.generation, supportsAppBlocks: true })
  const envelope = readBlockSession(modules.host.blockSessionEnvelope({ sessionId: 's', actions: [] }, live.generation))
  publishBlockState({ sessionId: 's', actions: [] }, envelope)
  const forwarded = []
  assert.equal(modules.host.forwardBlockState({ message: posted[0].message, session: { sessionId: 's' }, document: live, isLive: true, onState: m => forwarded.push(m) }), true)
  // After a reload (new generation), the old document's report is dropped.
  const reloaded = documents.load('v1')
  documents.mounted('v1', { blockGeneration: reloaded.generation, supportsAppBlocks: true })
  assert.equal(modules.host.forwardBlockState({ message: posted[0].message, session: { sessionId: 's' }, document: reloaded, isLive: true, onState: m => forwarded.push(m) }), false)
  assert.equal(forwarded.length, 1)
  delete globalThis.window
})
