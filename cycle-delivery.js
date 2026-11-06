// Deliver cycle k of a project's work into the project's one conversation.
//
// Both platform calls are idempotent for the same (scope, cid):
// - POST /api/app-chats/start creates-or-retries the scope's conversation in
//   place under a per-scope lock and sends `cid` as its first turn, or
//   returns the already started conversation without sending (`reused`).
// - POST /api/chats/{id}/messages, which an app token may call for a
//   conversation it created, acknowledges a cid it already holds (queued or
//   in the transcript) as a duplicate instead of sending it again.
// The cid de-duplication is per conversation, not per scope: once the owner
// deletes the conversation, a scoped start creates a new one that has never
// seen the old cid. So the caller re-reads the project record before every
// call and delivers only its current, unconfirmed cycle; a retry that knows
// which conversation the cycle went to (`chatId`) is bound to it and never
// recreates the scope (`gone` when that conversation was deleted).
// Model and effort are applied only when `applyModel` is set, so a retry
// never re-applies a configuration.
export async function deliverCycleMessage(token, request, fetcher = globalThis.fetch) {
  const { scope, cid, title, draft, scopeLabel, chatId: boundChat, applyModel = true } = request || {}
  if (!scope || !cid || !title || !draft) return { ok: false, error: 'This agent handoff is incomplete.' }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  let timezone = 'UTC'
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { /* UTC */ }
  const agent = applyModel && request.agent?.model ? { provider: request.agent.provider, model: request.agent.model, ...(request.agent.effort ? { effort: request.agent.effort } : {}) } : null
  const failed = (error, extra = {}) => ({ ok: false, error, ...extra })
  if (boundChat) return sendToChat(String(boundChat))
  let started
  try {
    started = await fetcher('/api/app-chats/start', { method: 'POST', headers, body: JSON.stringify({
      title, scope, ...(scopeLabel ? { scope_label: scopeLabel } : {}), owner_visible: true, ...(agent || {}), content: draft, cid, timezone,
    }) })
  } catch { return failed('Could not reach Möbius. Send again.') }
  if (!started.ok) {
    // A first turn the platform did not accept still names its conversation.
    const detail = (await started.json().catch(() => null))?.detail
    return failed('Could not start the agent. Send again.', { status: started.status, ...(detail?.chat_id ? { chatId: String(detail.chat_id) } : {}) })
  }
  const data = await started.json().catch(() => null)
  const chatId = data?.chat_id ? String(data.chat_id) : ''
  if (!chatId) return failed('Could not start the agent. Send again.')
  if (data.outcome !== 'reused') return { ok: true, chatId, outcome: 'started', modelApplied: Boolean(agent) }
  return sendToChat(chatId)

  // This cycle is one more message in an existing conversation. Its provider
  // is fixed once it has started; the platform refuses a switch.
  async function sendToChat(chatId) {
  let modelApplied = false
  if (agent) {
    let patched
    try { patched = await fetcher(`/api/app-chats/${encodeURIComponent(chatId)}`, { method: 'PATCH', headers, body: JSON.stringify(agent) }) } catch { patched = null }
    if (!patched?.ok) return failed(patched?.status === 409
      ? 'This project’s conversation already uses another provider. Choose one of its models, or delete the conversation to start over.'
      : patched?.status === 404 ? 'This conversation was deleted.' : 'Could not apply the chosen model. Send again.', { chatId, ...(patched?.status === 404 ? { gone: true } : {}), ...(patched ? { status: patched.status } : {}) })
    modelApplied = true
  }
  let sent
  try { sent = await fetcher(`/api/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: draft, cid, timezone }) }) }
  catch { return failed('Could not reach Möbius. Send again.', { chatId, modelApplied }) }
  if (sent.status === 404) return failed('This conversation was deleted.', { chatId, gone: true, modelApplied })
  if (sent.status === 409 && (await sent.json().catch(() => null))?.detail?.code === 'pending_question_open') {
    return failed('This conversation is waiting for your answer to its own card. Answer or dismiss that card first.', { chatId, status: 409, modelApplied })
  }
  if (!sent.ok) return failed('Möbius did not accept this message. Send again.', { chatId, status: sent.status, modelApplied })
  const body = await sent.json().catch(() => null)
  if (body?.status === 'rejected') return failed('Möbius rejected this message.', { chatId, modelApplied })
  return { ok: true, chatId, outcome: body?.status === 'duplicate' ? 'duplicate' : 'sent', modelApplied }
  }
}
