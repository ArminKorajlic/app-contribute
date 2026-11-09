import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { baseTip, DRAFT_TAKEOVER_SCOPE, mayMerge, prKey, takeoverBlocker } from '../collaboration.js'
import { mergeWhenSafeBlocker, reviewSwitchHints, reviewWindowCopy } from '../review-copy.js'
import { focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { ReviewPromptPreview } from './ReviewPromptSettings.jsx'
import { AgentModelSettings } from './AgentModelSettings.jsx'

// A saved (frozen) selection keeps its own scope; only fresh launches consult
// the served capability. Unresolved capabilities are a pending check.
export function draftCapabilityBlocker({ drafts, capabilities, saved, allowDraft }) {
  if (!drafts || allowDraft || saved) return ''
  if (!capabilities) return 'Checking draft support…'
  return 'Draft takeover needs the Möbius update to be activated.'
}

// A fresh launch offers only the workflows this Möbius advertises.
export function takeoverCapabilityBlocker({ capabilities, saved }) {
  if (saved) return ''
  if (!capabilities) return 'Checking what this Möbius supports…'
  return capabilities.review_fix_merge === true ? '' : 'Needs a newer Möbius.'
}

function Switch({ checked, disabled, label, detail, onChange }) {
  return <label className={'co-rw-option' + (disabled ? ' is-off' : '')}>
    <span><strong>{label}</strong><small>{detail}</small></span>
    <input type="checkbox" role="switch" className="co-switch" checked={checked} disabled={disabled} aria-checked={checked} onChange={event => onChange(event.target.checked)} />
  </label>
}

function PullHeading({ pulls, title, titleId, onCancel, takeover }) {
  const one = pulls.length === 1
  return <header className="co-rw-head">
    <span className="co-rw-icon"><Icon name={takeover ? 'fix' : 'review'} size={22} /></span>
    <div>
      <h3 id={titleId}>{title}</h3>
      {one
        ? <p className="co-rw-pr"><strong>#{pulls[0].number} {pulls[0].title}</strong><span>{pulls[0].repository.nameWithOwner}</span></p>
        : <><p className="co-rw-pr"><strong>{pulls.length} PRs</strong></p><ul className="co-rw-list">{pulls.map(pr => <li key={prKey(pr)}><strong>#{pr.number}</strong> {pr.title}<span>{pr.repository.nameWithOwner}</span></li>)}</ul></>}
    </div>
    {onCancel ? <button type="button" className="co-quiet-action co-rw-close" aria-label="Close" onClick={onCancel}><Icon name="close" size={18} /></button> : null}
  </header>
}

function WhatHappens({ copy }) {
  const privateRun = copy.publicEffect.tone === 'private'
  return <>
    <h4 className="co-rw-label">What happens</h4>
    <ol className="co-rw-steps">{copy.steps.map((step, index) => <li key={step.text} className={step.added ? 'is-added' : ''}><b>{index + 1}</b><span>{step.text}</span></li>)}</ol>
    <p className={'co-rw-public ' + (privateRun ? 'is-private' : 'is-public')} role="status">
      <Icon name={privateRun ? 'lock' : 'globe'} size={18} /><span><strong>Seen on GitHub:</strong> {copy.publicEffect.text}</span>
    </p>
  </>
}

// Review only: the two switches. Posting and merging are separate platform
// grants (posting is valid only in plain review), so one blocks the other.
function ReviewSwitches({ choice, promptOptions, capabilities, onModeChange, onOptionsChange, busy }) {
  const merge = choice.mode === 'review_merge'
  const posting = !merge && (choice.options?.post_review ?? promptOptions?.post_review) === true
  const drafts = choice.pulls.some(pr => pr.isDraft)
  const mayMergeAll = choice.pulls.every(pr => mayMerge(pr.repository.viewerPermission))
  const mergeBlocker = mergeWhenSafeBlocker({ drafts, mayMergeAll, posting })
  const canPost = onOptionsChange && capabilities?.post_review === true
  const hints = reviewSwitchHints(choice.pulls.length)
  if (!canPost && !onModeChange) return null
  return <div className="co-rw-options">
    {canPost ? <Switch checked={posting} disabled={busy || !promptOptions || merge}
      label="Allow posting the review on GitHub"
      detail={merge ? 'Turn off Merge when safe to post a review.' : hints.posting}
      onChange={checked => onOptionsChange({ ...promptOptions, ...choice.options, post_review: checked })} /> : null}
    {onModeChange ? <Switch checked={merge} disabled={busy || (!merge && !!mergeBlocker)}
      label="Merge when safe"
      detail={!merge && mergeBlocker ? mergeBlocker : hints.merge}
      onChange={checked => onModeChange(checked ? 'review_merge' : 'review')} /> : null}
  </div>
}

// The exact heads and target tips behind this approval, out of the way.
function VersionDetails({ pulls, live }) {
  return <details className="co-task-details co-rw-versions"><summary>{live ? 'Versions it starts from' : 'Exact versions'}</summary>
    {pulls.map(pr => <p key={prKey(pr)}>#{pr.number}: <code>{pr.headRefOid?.slice(0, 7)} → {pr.baseRefName} ({live ? 'last seen ' : ''}{baseTip(pr)?.slice(0, 7)})</code></p>)}
  </details>
}

function takeoverState(choice, capabilities, saved) {
  const drafts = choice.pulls.some(pr => pr.isDraft)
  const draftScope = choice.confirmation_scope === DRAFT_TAKEOVER_SCOPE
  const allowDraft = capabilities?.draft_takeover === true && (!saved || draftScope)
  // Rights do not depend on the capability read, so they explain first.
  const blocker = takeoverBlocker(choice.pulls, { allowDraft: true })
    || takeoverCapabilityBlocker({ capabilities, saved })
    || draftCapabilityBlocker({ drafts, capabilities, saved, allowDraft })
    || takeoverBlocker(choice.pulls, { allowDraft })
  return { draftScope, blocker }
}

// The consent for one agent workflow on exact PRs: what the agent will do,
// what GitHub will see, which model runs it, and one start button whose label
// matches what is allowed. Opened in a dialog from a PR list, or inline on a
// saved review-link page.
export function ReviewConfirmation({ choice, busy, disabled, error, onConfirm, onCancel, onModeChange, appId, token, onResolved, onOptionsChange, onAgentChange, bindCurrentTarget = false, capabilities: served = null }) {
  const confirmation = useRef(null)
  const titleId = useId()
  const [promptOptions, setPromptOptions] = useState(null)
  // null until the server preset resolves: loading is not the same as an
  // inactive capability, so the launch must not claim an update is missing.
  const [resolvedCapabilities, setCapabilities] = useState(null)
  const [unsupported, setUnsupported] = useState(false)
  const capabilities = resolvedCapabilities || served || (unsupported ? {} : null)
  // The preview resolves what "default" means right now (owner background
  // agent setting and its quota fallback); keep that answer for the picker.
  const [defaultChoice, setDefaultChoice] = useState(null)
  const resolve = useCallback(value => {
    setPromptOptions(value?.options || null); setCapabilities(value ? (value.capabilities || {}) : null)
    if (value) setUnsupported(false)
    if (value && !value.agent) setDefaultChoice(value.preview?.options?.choice || null)
    onResolved?.(value)
  }, [onResolved])
  useEffect(() => { if (choice) focusActionRegion(confirmation.current) }, [choice])
  if (!choice) return null
  const takeover = choice.mode === 'review_fix_merge'
  const saved = !!choice.preview_sha256
  const { draftScope, blocker } = takeoverState(choice, capabilities, saved)
  const posting = choice.mode === 'review' && (choice.options?.post_review ?? promptOptions?.post_review) === true
  const copy = reviewWindowCopy({ mode: choice.mode, posting, draftScope, count: choice.pulls.length, bindCurrentTarget })
  const startBlocked = takeover && !!blocker
  return <section ref={confirmation} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <PullHeading pulls={choice.pulls} title={copy.title} titleId={titleId} onCancel={onCancel} takeover={takeover} />
    <div className="co-rw-body">
      {takeover
        ? <p className="co-rw-note">No options here. The agent keeps going until {choice.pulls.length === 1 ? 'the PR is' : 'the PRs are'} merged, or until it needs you.</p>
        : <ReviewSwitches choice={choice} promptOptions={promptOptions} capabilities={capabilities} onModeChange={onModeChange} onOptionsChange={onOptionsChange} busy={busy} />}
      {startBlocked ? <p className="co-rw-blocker" role="status">{blocker}</p> : null}
      <WhatHappens copy={copy} />
      {onAgentChange ? <AgentModelSettings token={token} choice={choice.agent} defaultChoice={defaultChoice} defaultHint="Your background agent setting" onChange={next => { onAgentChange(next); return true }} /> : null}
      {appId && token ? <ReviewPromptPreview token={token} appId={appId} choice={choice} onResolved={resolve} onUnsupported={() => setUnsupported(true)} /> : null}
      <VersionDetails pulls={choice.pulls} live={bindCurrentTarget} />
    </div>
    <footer className="co-rw-foot">
      <p>{copy.footnote}</p>
      <div className="co-rw-actions">
        {onCancel ? <button type="button" className="co-btn" disabled={busy} onClick={onCancel}>Cancel</button> : null}
        <button type="button" className="co-btn co-btn-primary" disabled={busy || disabled || startBlocked} onClick={onConfirm}>{busy ? 'Starting…' : copy.startLabel}</button>
      </div>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </footer>
  </section>
}
