import { useEffect, useId, useRef, useState } from 'react'
import { focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'

const FACT_ICON = { ok: 'check', warn: 'info', bad: 'close' }

// The confirm sheet for one of the owner's own actions on a PR (Open for review,
// Merge): what it does, what GitHub shows right now, and one button. The X is
// the only way out, so there is no Cancel; a finished action swaps it for Done.
// `copy` is the words (see action-copy.js); `onConfirm` runs the action and
// returns the outcome the app's handlers already use ({ ok } | { alreadyHandled }
// | { pending, error } | { error }). Opened inside a ReviewDialog.
export function ActionConfirm({ pr, copy, icon = 'send', onConfirm, onClose, onDone }) {
  const region = useRef(null)
  const titleId = useId()
  const [phase, setPhase] = useState('confirm')
  const [error, setError] = useState('')
  useEffect(() => { focusActionRegion(region.current) }, [])
  const working = phase === 'working'
  async function confirm() {
    setPhase('working'); setError('')
    let outcome
    try { outcome = await onConfirm() } catch { outcome = { error: 'Could not reach GitHub. Check the PR before trying again.' } }
    if (outcome?.ok || outcome?.alreadyHandled) { setPhase('done'); onDone?.(outcome); return }
    setError(outcome?.error || 'Could not complete this. Nothing changed.')
    // An unconfirmed result is read back, never repeated from here.
    setPhase(outcome?.pending ? 'unconfirmed' : 'confirm')
  }
  const done = phase === 'done'
  return <section ref={region} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <header className={'co-rw-head' + (done ? ' is-done' : '')}>
      <span className="co-rw-icon"><Icon name={done ? 'check' : icon} size={22} /></span>
      <div>
        <h3 id={titleId}>{done ? copy.done.title : copy.title}</h3>
        <p className="co-rw-pr"><strong>#{pr.number} {pr.title}</strong><span>{pr.repository.nameWithOwner}</span></p>
      </div>
      {done ? null : <button type="button" className="co-quiet-action co-rw-close" aria-label="Close" disabled={working} onClick={onClose}><Icon name="close" size={18} /></button>}
    </header>
    {done ? <div className="co-rw-body"><p className="co-rw-result" role="status">{copy.done.text}</p></div> : <div className="co-rw-body">
      <ul className="co-rw-facts">{copy.facts.map(fact => <li key={fact.text} className={'is-' + fact.tone}><Icon name={FACT_ICON[fact.tone]} size={18} /><span>{fact.text}</span></li>)}</ul>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </div>}
    <footer className="co-rw-foot">
      {done ? null : <p>{copy.footnote}</p>}
      <div className="co-rw-actions">
        {done
          ? <button type="button" className="co-btn co-btn-primary" onClick={onClose}>Done</button>
          : <button type="button" className="co-btn co-btn-primary" disabled={working || phase === 'unconfirmed'} aria-busy={working} onClick={confirm}>{working ? copy.working : copy.confirm}</button>}
      </div>
    </footer>
  </section>
}
