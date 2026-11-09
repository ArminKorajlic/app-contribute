import { useEffect, useId, useRef, useState } from 'react'
import { focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { MarkdownView } from './MarkdownView.jsx'

const FACT_ICON = { ok: 'check', warn: 'info', bad: 'close' }

// The confirm sheet for one of the owner's own actions on a PR (Open for review,
// Merge): what it does, what GitHub shows right now, and one button. The X is
// the only way out, so there is no Cancel; a finished action swaps it for Done.
// `copy` is the words and the icon (see action-copy.js; `says` shows text the action will post, `disabled` keeps the button off while it is not ready); `onConfirm` runs the action and
// returns the outcome the app's handlers already use ({ ok } | { alreadyHandled }
// | { pending, error } | { error }). A { pending } outcome may have happened on GitHub: the sheet
// first has the owner's view read GitHub again (`onUnconfirmed`, read-only), and its button stays
// off for good, so another attempt can only start from that fresh read. Opened inside a ReviewDialog.
export function ActionConfirm({ pr, copy, onConfirm, onClose, onDone, onUnconfirmed }) {
  const region = useRef(null)
  const titleId = useId()
  const [phase, setPhase] = useState('confirm')
  const [error, setError] = useState('')
  // An action with ways to do it (Merge: squash, merge commit, rebase) asks once, in the sheet.
  const [picked, setPicked] = useState(copy.choices?.value || '')
  const [result, setResult] = useState(null)
  useEffect(() => { focusActionRegion(region.current) }, [])
  // Writing, or reading GitHub back after a write that could not be confirmed.
  const working = phase === 'working' || phase === 'checking'
  async function confirm() {
    setPhase('working'); setError('')
    let outcome
    // A handler that throws never said whether the write reached GitHub.
    try { outcome = await onConfirm({ choice: picked }) } catch { outcome = { pending: true, error: 'Lost contact with GitHub. Check the PR before trying again.' } }
    if (outcome?.ok || outcome?.alreadyHandled) { setResult(outcome); setPhase('done'); onDone?.(outcome); return }
    setError(outcome?.error || 'Could not complete this. Nothing changed.')
    if (!outcome?.pending) { setPhase('confirm'); return }
    // An unconfirmed result is read back, never repeated from here.
    setPhase('checking')
    try { await onUnconfirmed?.() } catch { /* the view shows its own read error */ }
    setPhase('unconfirmed')
  }
  const done = phase === 'done'
  const finished = typeof copy.done === 'function' ? copy.done(result) : copy.done
  const selected = copy.choices?.options.find(option => option.key === picked)
  return <section ref={region} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <header className={'co-rw-head' + (done ? ' is-done' : '')}>
      <span className="co-rw-icon"><Icon name={done ? 'check' : copy.icon} size={22} /></span>
      <div>
        <h3 id={titleId}>{done ? finished.title : copy.title}</h3>
        <p className="co-rw-pr"><strong>#{pr.number} {pr.title}</strong><span>{pr.repository.nameWithOwner}</span></p>
      </div>
      {done ? null : <button type="button" className="co-quiet-action co-rw-close" aria-label="Close" disabled={working} onClick={onClose}><Icon name="close" size={18} /></button>}
    </header>
    {done ? <div className="co-rw-body"><p className="co-rw-result" role="status">{finished.text}</p>{/^https:\/\//.test(finished.link?.href || '') ? <a className="co-quiet-action" href={finished.link.href} target="_blank" rel="noopener noreferrer">{finished.link.label}</a> : null}</div> : <div className="co-rw-body">
      <ul className="co-rw-facts">{copy.facts.map(fact => <li key={fact.text} className={'is-' + fact.tone}><Icon name={FACT_ICON[fact.tone]} size={18} /><span>{fact.text}</span></li>)}</ul>
      {copy.says ? <details className="co-task-details" open><summary>{copy.says.label}</summary><MarkdownView markdown={copy.says.markdown} /></details> : null}
      {copy.choices ? <>
        <h4 className="co-rw-label">{copy.choices.label}</h4>
        <div className="co-rw-rungs" role="radiogroup" aria-label={copy.choices.label}>
          {copy.choices.options.map(option => <button key={option.key} type="button" role="radio" aria-checked={picked === option.key} disabled={working}
            className={'co-rw-rung' + (picked === option.key ? ' is-on' : '')} onClick={() => setPicked(option.key)}>
            <i aria-hidden="true" /><span><strong>{option.label}</strong><small>{option.detail}</small></span>
          </button>)}
        </div>
      </> : null}
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </div>}
    <footer className="co-rw-foot">
      {done ? null : <p>{copy.footnote}</p>}
      <div className="co-rw-actions">
        {done
          ? <button type="button" className="co-btn co-btn-primary" onClick={onClose}>Done</button>
          : <button type="button" className="co-btn co-btn-primary" disabled={working || phase === 'unconfirmed' || copy.disabled === true} aria-busy={working} onClick={confirm}>{phase === 'checking' ? 'Checking GitHub…' : working ? copy.working : selected?.action || copy.confirm}</button>}
      </div>
    </footer>
  </section>
}
