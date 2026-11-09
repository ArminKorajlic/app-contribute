import { useEffect, useState } from 'react'
import { Icon } from './Icons.jsx'
import { contributionActionScope } from '../review.js'

// Mini-app frames have an opaque origin, so a frame-origin target silently
// drops this shell command. postMessage still goes only to the direct parent;
// `*` is required for the shell to receive it across the opaque boundary.
export function openAgentConversation(chatId) {
  if (!chatId || window.parent === window) return false
  window.parent.postMessage({
    type: 'moebius:open-chat',
    chatId,
  }, '*')
  return true
}

export function AgentHandoffButton({
  action,
  onStart,
  className = 'co-btn',
  icon = '',
  collapseOnStart = true,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(null)
  const scope = contributionActionScope(action)
  const actionKey = `${scope}:${action?.event || ''}:${action?.title || ''}`
  useEffect(() => {
    let cancelled = false
    setStarted(null)
    setError('')
    if (!scope || typeof window.mobius?.chat?.list !== 'function') {
      return () => { cancelled = true }
    }
    window.mobius.chat.list({ scope }).then((chats) => {
      if (cancelled || !Array.isArray(chats) || chats.length === 0) return
      const chat = [...chats].sort((a, b) => (
        String(b.activity_at || b.updated_at || '').localeCompare(
          String(a.activity_at || a.updated_at || ''),
        )
      ))[0]
      if (chat?.id) setStarted({
        chatId: chat.id,
        reused: true,
        usage: chat.usage || null,
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [actionKey])
  if (!action) return null

  async function run() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const outcome = await onStart?.(action)
      if (!outcome?.ok) {
        setError(outcome?.error || 'Could not start the agent. Try again.')
      } else {
        setStarted(outcome)
      }
    } catch {
      setError('Could not start the agent. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function viewConversation() {
    if (!openAgentConversation(started?.chatId)) return
    window.mobius?.signal?.('contribute_agent_conversation_opened', {
      event: action.event || 'contribute_agent_handoff',
    })
  }

  if (started) {
    if (collapseOnStart) return null
    const tokenTotal = Number(started?.usage?.totals?.total_tokens)
    const usageLabel = Number.isFinite(tokenTotal) && tokenTotal >= 0
      ? `Helper chat total: ${new Intl.NumberFormat(undefined, {
          notation: 'compact', maximumFractionDigits: 1,
        }).format(tokenTotal)} tokens`
      : ''
    return (
      <div className="co-agent-started" role="status" aria-live="polite">
        <span>
          <strong>{started.reused
            ? (action.reusedLabel || 'Review already running')
            : (action.startedLabel || 'Agent started')}</strong>
          <small>{action.startedMessage || 'Keep working here. New decisions and ready changes will appear in Contribute.'}</small>
          {usageLabel ? <small>{usageLabel}</small> : null}
        </span>
        {window.parent !== window ? (
          <button type="button" className="co-agent-chat-link" onClick={viewConversation}>
            View conversation
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="co-agent-handoff">
      <button
        type="button"
        className={className}
        disabled={busy}
        aria-busy={busy}
        onClick={run}
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        {busy ? (action.busyLabel || 'Starting…') : action.label}
      </button>
      {error ? <p className="co-agent-handoff-error" role="status">{error}</p> : null}
    </div>
  )
}
