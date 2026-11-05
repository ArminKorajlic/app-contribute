import { useEffect, useRef, useState } from 'react'
import { addressBrief, addressItems, RUNGS } from '../address-feedback.js'
import { requestOptions } from '../collaboration.js'
import { loadWorkflowOptions, previewWorkflow, reviewOptions } from '../review-prompts.js'
import { loadPullActivity, loadPullThreads } from '../pull-details.js'
import { AgentModelSettings } from './AgentModelSettings.jsx'
import { SeenOnGithub } from './SeenOnGithub.jsx'
import { CloseWindowButton, WindowHead } from './WindowHead.jsx'
import { openAgentConversation } from './BatchAction.jsx'
import { focusActionRegion } from './TaskPane.jsx'

// What was found, each with a tick. The owner unticks what the agent should
// leave alone.
export function AddressChecklist({ items, onToggle, disabled }) {
  return <ul className="co-rw-checks" aria-label="What it will address">
    {items.map(item => <li key={item.key}>
      <label className="co-rw-check">
        <input type="checkbox" checked={item.checked} disabled={disabled} onChange={event => onToggle(item.key, event.target.checked)} />
        <span><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
      </label>
    </li>)}
  </ul>
}

// How far it may go: a choice of two, not a setting to hunt for.
export function AddressRungs({ value, onChange, disabled }) {
  return <div className="co-rw-rungs" role="radiogroup" aria-label="How far should it go?">
    {RUNGS.map(rung => <button key={rung.key} type="button" role="radio" aria-checked={value === rung.key} disabled={disabled}
      className={'co-rw-rung' + (value === rung.key ? ' is-on' : '')} onClick={() => onChange(rung.key)}>
      <i aria-hidden="true" /><span><strong>{rung.title}</strong><small>{rung.detail}</small></span>
    </button>)}
  </div>
}

const STEPS = [
  'It reads the reviews, threads and checks you tick. Reviewers’ words are treated as data, not orders.',
  'It makes the changes in a private copy of the PR’s branch and runs the checks.',
  'It drafts a reply for each thread. Replies are never posted on their own.',
]

// The window behind Agent > Respond to feedback. It reads what the PR asks for,
// asks how far to go, then starts an agent conversation from a written brief.
export function AddressFeedbackWindow({ pr, findings = null, token, appId, defaultAgent = null, onStart, onClose }) {
  const root = useRef(null)
  const [state, setState] = useState({ phase: 'loading', items: [], partial: false })
  const [rung, setRung] = useState('show')
  // The agent saved for reviews and fixes starts the window and is the picker's
  // Default row; without one, the server's answer below names the default.
  const ownDefault = defaultAgent?.model ? defaultAgent : null
  const [agent, setAgent] = useState(ownDefault)
  // What "default" means right now (the owner's background agent and its quota
  // fallback), read the way the review window reads it, so the picker can name it.
  const [defaultChoice, setDefaultChoice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(null)
  useEffect(() => { focusActionRegion(root.current) }, [])
  useEffect(() => {
    const controller = new AbortController()
    Promise.allSettled([loadPullActivity(token, pr, 1, controller.signal), loadPullThreads(token, pr, null, controller.signal)]).then(([activity, threads]) => {
      if (controller.signal.aborted) return
      if (activity.status === 'rejected' && threads.status === 'rejected') { setState({ phase: 'error', items: [], partial: false }); return }
      setState({
        phase: 'ready', partial: activity.status === 'rejected' || threads.status === 'rejected' || !!activity.value?.errors?.length || !!threads.value?.errors?.length,
        items: addressItems(pr, { activity: activity.value?.items || [], threads: threads.value?.threads || [], findings }),
      })
    })
    return () => controller.abort()
  }, [token, pr.repository.nameWithOwner, pr.number, pr.headRefOid])
  useEffect(() => {
    if (ownDefault) return undefined
    let alive = true
    loadWorkflowOptions(token, appId)
      .then(data => previewWorkflow(token, appId, requestOptions(reviewOptions({ post_review: false, propose_verdict: false }, data.options), 'review'), undefined, 'review'))
      .then(preview => { if (alive) setDefaultChoice(preview?.options?.choice || null) })
      .catch(() => {})
    return () => { alive = false }
  }, [token, appId])
  const toggle = (key, checked) => setState(old => ({ ...old, items: old.items.map(item => item.key === key ? { ...item, checked } : item) }))
  const ticked = state.items.filter(item => item.checked).length
  const pushing = rung === 'push'
  async function start() {
    setBusy(true); setError('')
    try {
      const brief = addressBrief({ pr, items: state.items, rung })
      const result = await onStart({ ...brief, ...(agent?.model ? { agent } : {}) })
      if (result?.ok) setStarted(result)
      else setError(result?.error || 'Could not start the agent. Try again.')
    } catch { setError('Could not start the agent. Try again.') }
    finally { setBusy(false) }
  }
  const heading = (seen = null) => <WindowHead icon="feedback" title="Respond to feedback" pulls={[pr]} tools={<>{seen}<CloseWindowButton onClick={onClose} /></>} />
  if (started) return <section ref={root} tabIndex={-1} className="co-review-window" aria-label="Respond to feedback started">
    {heading()}
    <div className="co-rw-body">
      <p className="co-rw-note">{started.reused ? 'An agent is already working on this PR.' : 'The agent is on it.'} The conversation has its progress and, when it finishes, the changes it made, the test results and the replies it drafted. Nothing has been sent to GitHub{pushing ? ' and it will ask you before it pushes' : ''}.</p>
    </div>
    <footer className="co-rw-foot"><div className="co-rw-actions">
      <button type="button" className="co-btn" onClick={onClose}>Close</button>
      <button type="button" className="co-btn co-btn-primary" onClick={() => { openAgentConversation(started.chatId); onClose() }}>Open the conversation</button>
    </div></footer>
  </section>
  return <section ref={root} tabIndex={-1} className="co-review-window" aria-label="Respond to feedback">
    {heading(<SeenOnGithub tone={pushing ? 'public' : 'private'} text={pushing ? 'only the fixes it pushes, after you approve. The drafted replies need their own approval.' : 'nothing. It works in a private copy until you decide.'} />)}
    <div className="co-rw-body">
      <h4 className="co-rw-label">What should it address?</h4>
      {state.phase === 'loading' ? <p className="co-rw-note" role="status">Reading the reviews and threads…</p> : null}
      {state.phase === 'error' ? <p className="co-rw-blocker" role="alert">Could not read this PR’s reviews and threads from GitHub. Close this and try again.</p> : null}
      {state.phase === 'ready' && !state.items.length ? <p className="co-rw-note">Nothing to address was found: no requested changes, open threads, failing checks or conflict. Use Review if you want a fresh look.</p> : null}
      {state.items.length ? <AddressChecklist items={state.items} onToggle={toggle} disabled={busy} /> : null}
      {state.partial && state.phase === 'ready' ? <p className="co-rw-note">Some of this PR’s feedback could not be read, so the list may be incomplete.</p> : null}
      <h4 className="co-rw-label">How far should it go?</h4>
      <AddressRungs value={rung} onChange={setRung} disabled={busy} />
      <h4 className="co-rw-label">What happens</h4>
      <ol className="co-rw-steps">
        {[...STEPS, pushing ? 'It stops and shows you the result, then waits for your one approval before pushing to the branch.' : 'It stops and shows you the result. Nothing is pushed.'].map((text, index) => <li key={text}><b>{index + 1}</b><span>{text}</span></li>)}
      </ol>
      <AgentModelSettings token={token} choice={agent} defaultChoice={ownDefault || defaultChoice} explicitDefault={!!ownDefault}
        defaultHint={ownDefault ? 'Your default for reviews and fixes' : 'Your background agent setting'} onChange={next => { setAgent(next); return true }} />
    </div>
    <footer className="co-rw-foot">
      <p>It reads the PR as it is now. If the PR changes while the agent works, it stops and tells you.</p>
      <div className="co-rw-actions">
        <button type="button" className="co-btn co-btn-primary" disabled={busy || state.phase !== 'ready' || !ticked} onClick={start}>{busy ? 'Starting…' : RUNGS.find(item => item.key === rung).start}</button>
      </div>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </footer>
  </section>
}
