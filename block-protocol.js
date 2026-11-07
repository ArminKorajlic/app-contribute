import { cardRecordIds } from './chat-blocks.js'
import { createInlineSession } from './inline-session.js'
import { createInlineSession as createInlineSessionV1 } from './inline-session-v1.js'

// The one adapter between Contribute's inline Send session and the chat
// host's passive app-block protocol. Only this file knows message names and
// envelope shapes, so a protocol revision changes nothing else.
const INIT = 'moebius:app-block-init'
const ACTION = 'moebius:app-block-action'
const STATE = 'moebius:app-block-state'
const REFRESH = 'moebius:app-block-refresh'
// The chat host's ids are UUIDs; anything else is not a chat context.
const CHAT_ID = /^[A-Za-z0-9-]{1,64}$/

// The host's intent grammar (#1914 appBlock.js).
const INTENT = /^[a-z][a-z0-9-]{0,31}:[\x21-\x7e]{1,256}$/

export function readBlockSession(value) {
  if (typeof value?.sessionId !== 'string' || !value.sessionId || !Array.isArray(value.actions)) return null
  return {
    sessionId: value.sessionId,
    generation: Number.isSafeInteger(value.generation) ? value.generation : null,
    actions: value.actions.filter(action => typeof action?.key === 'string').map(({ key, label }) => ({ key, label })),
    // The card's item intents, in card order (validated intents only; first
    // wins). null when the host sent none, so nothing is resolved from them.
    items: Array.isArray(value.items) ? value.items.map(item => item?.intent).filter(intent => typeof intent === 'string' && INTENT.test(intent))
      .filter((intent, index, list) => list.indexOf(intent) === index).map(intent => ({ intent })) : null,
    // What the host draws beyond the original report fields (`row-state`).
    features: Array.isArray(value.features) ? value.features.filter(feature => typeof feature === 'string').slice(0, 16) : [],
    // The chat this card is rendered in, the block intent the host groups it
    // by, and whether it is that group's newest block, attested by the chat
    // host (`rows-v2`). Never taken from the card.
    context: typeof value.context?.chatId === 'string' && CHAT_ID.test(value.context.chatId)
      ? { chatId: value.context.chatId, latest: value.context.latest !== false,
        intent: typeof value.context.intent === 'string' && INTENT.test(value.context.intent) ? value.context.intent : '' } : null,
    checkpoint: value.checkpoint && typeof value.checkpoint === 'object' ? { id: value.checkpoint.id, data: value.checkpoint.data } : null,
    retain: value.retain === true,
    recoveryError: Boolean(value.recoveryError),
  }
}

// Host messages come only from the parent shell document on this origin.
export function listenBlockSession({ onInit, onAction, onRefresh = null }) {
  const listener = event => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return
    if (event.data?.type === INIT) {
      const session = readBlockSession(event.data)
      if (session) onInit(session)
    } else if (event.data?.type === ACTION) {
      const { sessionId, key, event: name, nonce } = event.data
      onAction({ sessionId, key, event: name, nonce })
    } else if (event.data?.type === REFRESH) {
      const { sessionId, reason } = event.data
      if (typeof sessionId === 'string') onRefresh?.({ sessionId, reason: reason === 'visible' ? 'visible' : 'turn' })
    }
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

// Every report names the document generation it belongs to; the host drops a
// report with a missing, older or newer one. The host's session handle stamps
// it itself; otherwise the generation is copied from the session envelope this
// document received. Without one there is nothing the host would accept.
export function publishBlockState(state, target = null) {
  const { sessionId, generation: _ignored, ...body } = state
  if (target?.sessionId !== sessionId) return false
  if (typeof target.setState === 'function') { target.setState(body); return true }
  if (!Number.isSafeInteger(target.generation)) return false
  window.parent.postMessage({ type: STATE, sessionId, generation: target.generation, ...body }, window.location.origin)
  return true
}

// Which card session a host gets: the ledger-backed card only where the host
// draws the app's rows and attests the card's chat; anywhere else, exactly the
// earlier card, whose record set is the host's items and nothing else.
export const attestsChat = init => Array.isArray(init?.features) && init.features.includes('rows-v2') && Boolean(init.context?.chatId)

// The whole app side of a card session, as the headless component runs it:
// the host's envelope and messages, read only through this adapter, drive one
// inline session. `loadExact(id)` reads a record; `onNeedRuntime(ids)` asks for
// the send runtime, checking exactly `ids`. Returns `updateRuntime(runtime)`
// and `dispose()`.
export function connectInlineSession({ blockSession, loadExact, onNeedRuntime }) {
  let session = null
  let runtime = null
  // Where this document's reports go: the host's handle when it gave one for
  // this session, otherwise the latest envelope (with its generation).
  let target = null
  function start(init) {
    target = blockSession?.sessionId === init.sessionId && typeof blockSession.setState === 'function'
      && (init.generation === null || init.generation === blockSession.generation) ? blockSession : init
    // A repeated init for this session carries the host's current verdict on
    // the card's chat (for example that a newer card now follows it).
    if (session?.sessionId === init.sessionId) { if (session.update) session.update(init); else session.start(); return }
    session?.dispose()
    // The earlier card checks the records its action and items name, as before.
    const v1 = !attestsChat(init)
    const needs = v1 ? () => onNeedRuntime?.(cardRecordIds(init.actions.map(action => action.key), init.items)) : ids => onNeedRuntime?.(ids)
    session = (v1 ? createInlineSessionV1 : createInlineSession)({ ...init, publish: state => publishBlockState(state, target), loadExact, onNeedRuntime: needs })
    if (runtime) session.updateRuntime(runtime)
    session.start()
  }
  const stop = listenBlockSession({
    onInit: start,
    onAction: event => { if (event.sessionId === session?.sessionId) session.handleEvent(event) },
    onRefresh: hint => { if (hint.sessionId === session?.sessionId) session.refresh?.(hint.reason) },
  })
  const initial = readBlockSession(blockSession)
  if (initial) start(initial)
  return {
    updateRuntime(next) { runtime = next; if (next) session?.updateRuntime(next) },
    dispose() { stop(); session?.dispose(); session = null },
  }
}
