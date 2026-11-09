import { useEffect, useState } from 'react'
import { loadWorkflowOptions, oversizedPrompt, previewWorkflow, promptBytes, PROMPT_BYTE_LIMIT, saveWorkflowOptions, reviewOptions, workflowAgent } from '../review-prompts.js'
import { requestOptions } from '../collaboration.js'

const PROMPTS = [['review_prompt','Review'],['fix_prompt','Fix'],['merge_prompt','Merge decision']]
export const PROMPT_CSS = `
.co-prompt-settings { margin:20px 0; padding:20px 0; border-top:1px solid var(--border); }
.co-prompt-choices { display:flex; gap:6px; margin:14px 0 8px; }
.co-prompt-choices button { min-height:44px; min-width:44px; padding:8px 14px; border:0; border-radius:7px; color:var(--muted); background:none; font:inherit; cursor:pointer; }
.co-prompt-choices button[aria-pressed=true] { color:var(--accent); background:var(--accent-dim); }
.co-prompt-settings h3 { margin:0 0 8px; font-size:18px; }
.co-prompt-settings p { font-size:14px; line-height:1.5; color:var(--muted); }
.co-prompt-settings label { display:block; margin:14px 0 6px; font-size:14px; }
.co-prompt-settings textarea { box-sizing:border-box; width:100%; min-height:120px; padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font:inherit; font-size:16px; line-height:1.5; resize:vertical; }
.co-prompt-settings summary { min-height:44px; display:flex; align-items:center; cursor:pointer; font-size:14px; }
.co-prompt-settings pre,.co-resolved-prompt { white-space:pre-wrap; overflow-wrap:anywhere; max-height:360px; overflow:auto; font:inherit; font-size:14px; line-height:1.5; background:var(--bg); padding:12px; border-radius:8px; }
.co-prompt-settings textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
`

export function ResolvedPrompt({ snapshot }) {
  const [active, setActive] = useState('review_prompt')
  if (!snapshot) return null
  const value = snapshot.options || snapshot.snapshot || snapshot
  return <section className="co-prompt-settings" aria-label="Instructions used"><style>{PROMPT_CSS}</style>
    <PromptChoices active={active} onChange={setActive} />
    <pre className="co-resolved-prompt">{value[active] || 'No instructions recorded for this step.'}</pre>
  </section>
}

function PromptChoices({ active, onChange }) {
  return <div className="co-prompt-choices" role="group" aria-label="Prompt to inspect">{PROMPTS.map(([key,label]) => <button type="button" key={key} aria-pressed={key === active} onClick={()=>onChange(key)}>{label}</button>)}</div>
}

export function ReviewPromptSettings({ token, appId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [active, setActive] = useState('review_prompt')
  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    loadWorkflowOptions(token, appId)
      .then(value => { if (alive) setData(value) })
      .catch(failure => { if (alive) setError(failure.message) })
    return () => { alive = false }
  }, [token, appId, retry])
  function change(key, value) {
    setData(old => ({ ...old, options: { ...old.options, [key]: value } }))
    setNotice('')
  }
  async function save() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const receipt = await saveWorkflowOptions(data.options, data.version, data.defaults)
      setData(old => ({ ...old, version: receipt.version }))
      setNotice('Saved for new review workflows. Existing runs are unchanged.')
    } catch (failure) {
      setError(failure.status === 412 ? 'These settings changed elsewhere. Reload before saving; your edits have not replaced them.' : failure.message)
    } finally {
      setBusy(false)
    }
  }
  // The platform limit is in UTF-8 bytes, so non-ASCII text fills it sooner.
  const bytes = data ? promptBytes(data.options[active]) : 0
  const tooLong = data ? oversizedPrompt(data.options) : ''
  return <section className="co-prompt-settings" aria-label="Review workflow settings"><style>{PROMPT_CSS}</style>
    {!data && !error ? <div className="co-settings-skeleton" role="status">Loading settings…</div> : null}
    {data ? <>
      <p>Edit guidance for new runs. Existing runs stay unchanged.</p>
      <PromptChoices active={active} onChange={setActive} />
      <div className="co-prompt-editor-group">
        <label className="co-visually-hidden" htmlFor={`co-${active}`}>{PROMPTS.find(([key]) => key === active)[1]} prompt</label>
        <textarea id={`co-${active}`} value={data.options[active] || ''} aria-describedby={`co-${active}-size`} onChange={event => change(active, event.target.value)} />
        <p id={`co-${active}-size`} className={bytes > PROMPT_BYTE_LIMIT ? 'co-task-footnote is-failed' : 'co-task-footnote'}>{bytes.toLocaleString('en-US')} of {PROMPT_BYTE_LIMIT.toLocaleString('en-US')} bytes{bytes > PROMPT_BYTE_LIMIT ? ': too long to save' : ''}</p>
        <button type="button" className="co-quiet-action" onClick={() => change(active, data.defaults[active])}>Restore this prompt</button>
      </div>
      <div className="co-board-actions"><button type="button" className="co-btn co-btn-primary" disabled={busy || Boolean(tooLong)} onClick={save}>Save defaults</button></div>
      {tooLong ? <p role="status">The {PROMPTS.find(([key]) => key === tooLong)[1]} prompt is too long to save.</p> : null}
    </> : null}
    {error ? <p role="alert">{error} <button className="co-quiet-action" disabled={busy} onClick={() => setRetry(x => x + 1)}>{data ? 'Reload settings' : 'Retry'}</button></p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>
}

export function ReviewPromptPreview({ token, appId, choice, onResolved, onUnsupported }) {
  const [state,setState]=useState({loading:true})
  const [retry,setRetry]=useState(0)
  const optionKey = JSON.stringify(choice?.options || null)
  const agentKey = JSON.stringify(workflowAgent(choice?.agent) || null)
  useEffect(() => {
    if (!choice) return
    let alive=true; setState({loading:true});onResolved?.(null)
    async function resolve() {
      const data=await loadWorkflowOptions(token,appId)
      // Frozen selections keep their exact options; defaults apply only to new work.
      // A saved selection keeps its exact frozen options; new work starts from the settings.
      const options=requestOptions(choice.preview_sha256 ? choice.options : reviewOptions(choice.options,data.options),choice.mode)
      // A Möbius without posted review does not accept the grant at all.
      if(!choice.preview_sha256) {
        const caps=data.capabilities||{}
        if(caps.post_review !== true || (choice.mode==='review_merge' && caps.post_review_merge !== true)) { delete options.post_review; delete options.propose_verdict }
        if(caps.propose_verdict !== true) delete options.propose_verdict
      }
      const agent=workflowAgent(choice.agent)
      const preview=await previewWorkflow(token,appId,options,agent,choice.mode)
      if(choice.preview_sha256 && choice.preview_sha256!==preview.preview_sha256) throw new Error('The saved instructions or model changed. Ask the agent to prepare a fresh review link; nothing was started.')
      return {options,agent,preview,capabilities:data.capabilities}
    }
    // A Möbius without the core review routes answers 404: it supports none of
    // the optional workflows, which is not a check still in progress.
    resolve().then(value=>{if(alive){setState(value);onResolved?.(value)}}).catch(error=>{if(alive){setState({error:error.message});if(error?.status===404)onUnsupported?.()}})
    return()=>{alive=false}
  },[token,appId,choice?.request_id,choice?.mode,choice?.preview_sha256,optionKey,agentKey,retry])
  return state.error ? <p role="alert">Could not check this run: {state.error} <button className="co-quiet-action" onClick={()=>setRetry(x=>x+1)}>Retry</button></p> : null
}
