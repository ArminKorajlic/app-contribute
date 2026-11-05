import React, { useCallback, useEffect, useRef, useState } from 'react'
import { openGithubSettings } from '../github-connection.js'
import { Icon } from './Icons.jsx'
import { DEFAULT_STAGE, stageWords } from '../publication-stage.js'
import { ReviewPromptSettings } from './ReviewPromptSettings.jsx'
import { DefaultAgentSettings } from './DefaultAgentSettings.jsx'
import { NAMES } from '../names.js'
// Component-local settings layout. The app shell keeps its existing theme tokens.
export const SETTINGS_CSS = `
.co-settings-workspace { box-sizing:border-box; width:min(820px,calc(100vw - 32px)); height:min(947px,calc(100dvh - 110px)); max-height:calc(100dvh - 110px); display:flex; flex-direction:column; padding:20px; overflow:hidden; scrollbar-width:none; }
.co-settings-workspace::-webkit-scrollbar,.co-settings-content::-webkit-scrollbar { display:none; }
.co-settings-workspace > header { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; margin:0; padding-bottom:12px; border-bottom:1px solid var(--border); }
.co-settings-layout { flex:1; min-height:0; display:flex; }
.co-settings-content { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; padding-top:4px; overflow-y:auto; scrollbar-width:none; }
.co-settings-content h3 { margin:14px 0 8px; font-size:var(--co-text-meta); line-height:1.4; font-weight:650; color:var(--muted); }
.co-settings-content .co-prompt-settings { flex:1 0 auto; min-height:0; display:flex; flex-direction:column; margin:0; padding:0; border:0; }
.co-settings-content .co-prompt-settings textarea { flex:1; min-height:150px; font-size:var(--co-text-body); line-height:1.55; resize:none; }
.co-settings-skeleton { min-height:240px; padding:24px 0; color:var(--muted); }
.co-prompt-editor-group { flex:1; min-height:0; display:flex; flex-direction:column; padding:0; }
.co-settings-account,.co-settings-agent { flex:0 0 auto; }
.co-set-picker { padding:0 12px 12px; }
.co-set-picker .co-agent-picker { max-width:none; margin:0; }
.co-settings-account .co-conn { display:block; }
.co-set-card { border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--bg); }
.co-set-row { display:flex; align-items:center; gap:12px; min-height:56px; padding:8px 12px; }
.co-set-row + .co-set-row { border-top:1px solid var(--border); }
.co-set-tile { flex:0 0 auto; display:grid; place-items:center; width:36px; height:36px; border-radius:var(--co-radius-control); background:var(--surface-2,var(--surface)); color:var(--muted); }
.co-set-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; cursor:default; }
.co-set-text strong { font-size:var(--co-text-body); font-weight:650; }
.co-set-text small { color:var(--muted); font-size:var(--co-text-meta); line-height:1.4; }
.co-set-row > .co-seg { flex:0 0 auto; }
.co-set-row .co-btn { flex:0 0 auto; gap:8px; height:40px; min-height:40px; padding:0 12px; font-size:var(--co-text-meta); }
.co-settings-workspace > header .co-btn co-btn-quiet { display:grid; place-items:center; width:44px; min-height:44px; padding:0; border:0; border-radius:var(--co-radius-field); background:none; color:var(--muted); cursor:pointer; }
.co-settings-workspace > header .co-btn co-btn-quiet:hover { background:var(--surface-2); color:var(--text); }
@media(max-width:650px) { .co-set-row.has-choice { flex-wrap:wrap; } .co-set-row.has-choice > .co-set-text { min-width:200px; } .co-set-row.has-choice > .co-seg { margin-left:48px; } .co-settings-workspace { position:fixed; inset:68px 16px auto; width:auto; height:auto; max-height:calc(100dvh - 84px); padding:16px; overflow-y:auto; } .co-settings-content .co-prompt-settings textarea { flex:none; min-height:240px; } .co-set-row { flex-wrap:wrap; } }
`


// One settings surface, opened on demand. It shows which GitHub account
// Contribute uses; connecting or changing that account happens in Möbius
// Settings, which owns the instance-wide GitHub connection.
export function ConnectionSettings(props) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const accountLabel = props.conn?.state === 'connected' && props.conn?.login
    ? props.conn.login
    : props.conn?.state === 'disconnected' ? 'Connect GitHub' : 'GitHub'
  const accountStatus = props.conn?.state === 'connected' ? 'GitHub connected' : accountLabel
  useEffect(() => {
    if (!open) return
    const outside = event => { if (ref.current && !ref.current.contains(event.target)) ref.current.open = false }
    const escape = event => { if (event.key === 'Escape') { ref.current.open = false; ref.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <details className="co-settings" ref={ref} onToggle={event => {
    const next = event.currentTarget.open
    setOpen(next)
    if (next) void props.onChanged?.()
  }}>
    <summary aria-label={`${accountStatus}${props.conn?.state === 'connected' && props.conn?.login ? ` as ${props.conn.login}` : ''} — Contribute settings`} title={`${accountStatus} · Settings`}>
      <Icon name="settings" size={20} /><span className="co-label-long">{NAMES.settings}</span><span className="co-label-short">Settings</span>
    </summary>
    {open ? <div className="co-settings-panel co-settings-workspace"><style>{SETTINGS_CSS}</style>
      <header><h2>{NAMES.settings}</h2><button type="button" className="co-btn co-btn-quiet co-btn-icon" aria-label="Close settings" title="Close" onClick={() => { ref.current.open = false; ref.current.querySelector('summary')?.focus() }}><Icon name="close" size={18} /></button></header>
      <div className="co-settings-layout">
        <div className="co-settings-content">
          <section className="co-settings-account" aria-label="GitHub account"><h3>GitHub</h3><ConnectionCard {...props} /></section>
          <DefaultAgentSettings token={props.token} agent={props.reviewAgent} onChange={props.onChangeReviewAgent} />
          <ReviewPromptSettings token={props.token} appId={props.appId} />
        </div>
      </div>
    </div> : null}
  </details>
}

const settingsButton = (label, primary = false) => (
  <button
    type="button"
    className={primary ? 'co-btn co-btn-primary co-btn-block' : 'co-btn'}
    onClick={openGithubSettings}
  >
    {label}
  </button>
)

// Read-only view of the instance GitHub account, which Möbius Settings owns:
//   checking     — the initial status probe is still in flight
//   unknown      — the probe failed; retryable, the feed still shows from cache
//   connected    — the account in use, plus Contribute's own settings
//   disconnected — a pointer to Settings, where the owner connects GitHub
export function ConnectionCard({
  conn,
  onChanged,
  onRetry,
  autopilotDefault = true,
  onToggleAutopilotDefault,
  newPrStage = DEFAULT_STAGE,
  onChangeNewPrStage,
}) {
  const [statusRetrying, setStatusRetrying] = useState(false)

  const retryStatus = useCallback(async () => {
    if (statusRetrying) return
    setStatusRetrying(true)
    try {
      await (onRetry || onChanged)?.()
    } finally {
      setStatusRetrying(false)
    }
  }, [statusRetrying, onRetry, onChanged])


  const state = conn?.state

  if (state === 'checking') return <p className="co-conn-note" role="status">Checking account…</p>

  if (state === 'unknown') {
    return (
      <div className="co-conn" role="status" aria-live="polite">
        <span className="co-conn-dot is-warn" aria-hidden="true" />
        <div className="co-conn-body">
          <p className="co-conn-title">GitHub status unavailable</p>
          <p className="co-conn-text">
            {conn?.message || 'Contribute could not reach the GitHub connection service.'}
            {' '}Your saved contribution feed is still available.
          </p>
          <div className="co-conn-actions">
            <button type="button" className="co-btn" onClick={retryStatus} disabled={statusRetrying} aria-busy={statusRetrying}>
              {statusRetrying ? 'Checking…' : 'Check GitHub again'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'connected') {
    return (
      <div className="co-conn is-connected">
        <div className="co-set-card" role="group" aria-label="GitHub account and contribution settings">
          <div className="co-set-row">
            <span className="co-set-tile" aria-hidden="true"><Icon name="github" size={18} /></span>
            <div className="co-set-text"><strong>{conn.login}</strong><small>This account is shared across Möbius apps.</small></div>
            <button type="button" className="co-btn" onClick={openGithubSettings}><Icon name="settings" size={15} />Manage account</button>
          </div>
          {typeof onChangeNewPrStage === 'function' && (
            <div className="co-set-row has-choice">
              <span className="co-set-tile" aria-hidden="true"><Icon name={stageWords(newPrStage).icon} size={18} /></span>
              <div className="co-set-text" id="co-new-pr-stage">
                <strong>New pull requests start as</strong>
                <small>{newPrStage === 'draft' ? 'Nobody is asked to review a PR until you open it for review.' : 'Reviewers are asked as soon as a PR opens.'} Pick the other one for a single send from its arrow.</small>
              </div>
              <div className="co-seg" role="radiogroup" aria-labelledby="co-new-pr-stage">
                {['draft', 'ready'].map(stage => <button key={stage} type="button" role="radio" aria-checked={newPrStage === stage}
                  className={newPrStage === stage ? 'is-on' : ''} onClick={() => onChangeNewPrStage(stage)}>{stage === 'draft' ? 'Draft' : 'Ready'}</button>)}
              </div>
            </div>
          )}
          {conn.autopilotAvailable && typeof onToggleAutopilotDefault === 'function' && (
            <div className="co-set-row">
              <span className="co-set-tile" aria-hidden="true"><Icon name="cycle" size={18} /></span>
              <label className="co-set-text" htmlFor="co-follow-sent-prs">
                <strong>Follow sent PRs</strong>
                <small>Follows sent PRs through checks and review, addresses comments automatically, and asks when it needs you.</small>
              </label>
              <span className="co-setting-switch">
                <input
                  id="co-follow-sent-prs"
                  type="checkbox"
                  checked={autopilotDefault}
                  onChange={(event) => onToggleAutopilotDefault(event.target.checked)}
                />
                <i aria-hidden="true" />
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="co-conn is-column">
      <div className="co-account-default"><Icon name="check" size={18} /><div><strong>Möbius</strong><small>Legacy Möbius drafts only. New contributions use GitHub.</small></div></div>
      <div className="co-github-upgrade">
        <strong>GitHub is connected in Settings</strong>
        <p className="co-conn-note">To contribute as yourself, go to <b>Möbius Settings → Accounts → GitHub</b> and connect your account there. Contribute picks it up automatically when you come back.</p>
      </div>
      {settingsButton('Go to Settings to connect', true)}
    </div>
  )
}
