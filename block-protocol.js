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
    // The chat this card is rendered in and whether it is that chat's newest
    // card, attested by the chat host (`rows-v2`). Never taken from the card.
    context: typeof value.context?.chatId === 'string' && CHAT_ID.test(value.context.chatId)
      ? { chatId: value.context.chatId, latest: value.context.latest !== false } : null,
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
