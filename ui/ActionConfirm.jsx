import { useEffect, useId, useRef, useState } from 'react'
import { focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { CloseWindowButton, WindowHead } from './WindowHead.jsx'
import { MarkdownView } from './MarkdownView.jsx'

const FACT_ICON = { ok: 'check', warn: 'info', bad: 'close' }

// The confirm sheet for one of the owner's own actions on a PR (Open for review,
// Merge): what it does, what GitHub shows right now, and one button. The X is
// the only way out, so there is no Cancel; a finished action swaps it for Done.
// `copy` is the words and the icon (see action-copy.js; `says` shows text the action will post, `disabled` keeps the button off while it is not ready); `onConfirm` runs the action and
// returns the outcome the app's handlers already use ({ ok } | { alreadyHandled }
// | { pending, error } | { error }). Opened inside a ReviewDialog.
export function ActionConfirm({ pr, copy, onConfirm, onClose, onDone }) {
  const region = useRef(null)
  const titleId = useId()
  const [phase, setPhase] = useState('confirm')
  const [error, setError] = useState('')
  // An action with ways to do it (Merge: squash, merge commit, rebase) asks once, in the sheet.
  const [picked, setPicked] = useState(copy.choices?.value || '')
  const [result, setResult] = useState(null)
  useEffect(() => { focusActionRegion(region.current) }, [])
  const working = phase === 'working'
  async function confirm() {
    setPhase('working'); setError('')
    let outcome
    try { outcome = await onConfirm({ choice: picked }) } catch { outcome = { error: 'Could not reach GitHub. Check the PR before trying again.' } }
    if (outcome?.ok || outcome?.alreadyHandled) { setResult(outcome); setPhase('done'); onDone?.(outcome); return }
    setError(outcome?.error || 'Could not complete this. Nothing changed.')
    // An unconfirmed result is read back, never repeated from here.
    setPhase(outcome?.pending ? 'unconfirmed' : 'confirm')
  }
  const done = phase === 'done'
  const finished = typeof copy.done === 'function' ? copy.done(result) : copy.done
  const selected = copy.choices?.options.find(option => option.key === picked)
  return <section ref={region} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <WindowHead icon={done ? 'check' : copy.icon} title={done ? finished.title : copy.title} titleId={titleId} pulls={[pr]} done={done}
      tools={done ? null : <CloseWindowButton disabled={working} onClick={onClose} />} />
    {done ? <div className="co-rw-body"><p className="co-rw-result" role="status">{finished.text}</p>{/^https:\/\//.test(finished.link?.href || '') ? <a className="co-btn co-btn-quiet" href={finished.link.href} target="_blank" rel="noopener noreferrer">{finished.link.label}</a> : null}</div> : <div className="co-rw-body">
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
          : <button type="button" className="co-btn co-btn-primary" disabled={working || phase === 'unconfirmed' || copy.disabled === true} aria-busy={working} onClick={confirm}>{working ? copy.working : selected?.action || copy.confirm}</button>}
      </div>
    </footer>
  </section>
}
