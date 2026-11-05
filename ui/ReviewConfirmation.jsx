import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { baseTip, mayMerge, prKey, takeoverBlocker } from '../collaboration.js'
import { isOwnPull } from '../pull-view.js'
import { mergeWhenSafeBlocker, reviewSwitchHints, reviewWindowCopy } from '../review-copy.js'
import { focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { ReviewPromptPreview } from './ReviewPromptSettings.jsx'
import { AgentModelSettings } from './AgentModelSettings.jsx'
import { SeenOnGithub } from './SeenOnGithub.jsx'
import { CloseWindowButton, WindowHead } from './WindowHead.jsx'

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

// Review: who sees the result is the first choice. "Draft for me" waits for your
// tap; "Agent posts" lets the agent send its verdict itself, and only when you pick it.
const WHO = [
  ['private', 'Only me', 'It writes its findings for you. Nothing reaches GitHub.'],
  ['draft', 'Draft for me', 'It drafts approve, request changes or comment with its wording. Nothing is posted until you send it. It waits under Needs you.'],
  ['agent', 'Agent posts', 'It posts its verdict from your account: approve, request changes or comment. You allowed it here, for this review only.'],
]
export const WHO_OPTIONS = {
  private: { post_review: false, propose_verdict: false, agent_submits_verdict: false },
  draft: { post_review: true, propose_verdict: true, agent_submits_verdict: false },
  agent: { post_review: true, propose_verdict: true, agent_submits_verdict: true },
}
function WhoSees({ who, agentAllowed, disabled, onChange }) {
  const choices = WHO.filter(([key]) => key !== 'agent' || agentAllowed)
  return <div className="co-rw-who">
    <div className="co-rw-who-row">
      <h4 className="co-rw-label">Who sees the result?</h4>
      <div className="co-seg" role="radiogroup" aria-label="Who sees the result">
        {choices.map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={who === key}
          className={who === key ? 'is-on' : ''} disabled={disabled} onClick={() => onChange(key)}>{label}</button>)}
      </div>
    </div>
    <p className="co-rw-note">{WHO.find(([key]) => key === who)?.[2]}</p>
  </div>
}

// Take over: the reason is required and is posted on the PR when you start.
function TakeoverReason({ value, disabled, onChange }) {
  return <label className="co-rw-reason">
    <span className="co-rw-label">Why are you taking it over?</span>
    <textarea value={value} maxLength={500} rows={3} disabled={disabled} placeholder="For example: the author is away and this blocks the release."
      onChange={event => onChange(event.target.value)} />
    <small>Posted on the PR as a comment from your account, so its author knows{value.trim() ? <>: “Taking this PR over: {value.trim()}”</> : '.'}</small>
  </label>
}

function WhatHappens({ copy }) {
  return <>
    <h4 className="co-rw-label">What happens</h4>
    <ol className="co-rw-steps">{copy.steps.map((step, index) => <li key={step.text} className={step.added ? 'is-added' : ''}><b>{index + 1}</b><span>{step.text}</span></li>)}</ol>
  </>
}

// What this choice actually grants on this Möbius. A saved selection can still hold an older grant
// that posts a plain comment, so its words must say so; a new launch never creates one.
export function publicChoice(choice, promptOptions, capabilities) {
  const option = key => (choice.options?.[key] ?? promptOptions?.[key]) === true
  const merge = choice.mode === 'review_merge'
  const posting = option('post_review') && (!merge || capabilities?.post_review_merge === true)
  const verdict = posting && option('propose_verdict') && capabilities?.propose_verdict === true
  return { merge, posting, verdict, agentPosts: verdict && !merge && option('agent_submits_verdict') && capabilities?.agent_submits_verdict === true }
}
const whoOf = ({ posting, verdict, agentPosts }) => (agentPosts ? 'agent' : posting && verdict ? 'draft' : 'private')

// The PRs in this selection you wrote. An agent only ever checks those for you.
export const ownedPulls = (pulls, login) => pulls.filter(pr => isOwnPull(pr, login))

function OwnNote({ own, total }) {
  return <p className="co-rw-note" role="status"><Icon name="lock" size={16} /> {own === total
    ? `${total === 1 ? 'This is your own PR' : 'These are your own PRs'}, so the agent only checks ${total === 1 ? 'it' : 'them'} for you. Nothing is posted, proposed or merged.`
    : `${own} of these ${total} are your own PRs. The agent only checks those for you: nothing is posted, proposed or merged on them.`}</p>
}

// Who sees the result, then whether it merges once you approve. Merging only ever
// follows a verdict you sent yourself, so it needs "Draft for me".
function ReviewSwitches({ choice, promptOptions, capabilities, onModeChange, onOptionsChange, busy, own }) {
  const granted = publicChoice(choice, promptOptions, capabilities)
  const who = whoOf(granted)
  const drafts = choice.pulls.some(pr => pr.isDraft)
  const mayMergeAll = choice.pulls.every(pr => mayMerge(pr.repository.viewerPermission))
  const mergeBlocker = mergeWhenSafeBlocker({ drafts, mayMergeAll, notDrafting: who !== 'draft' })
  const canDraft = !!onOptionsChange && capabilities?.post_review === true && capabilities?.propose_verdict === true
  const hints = reviewSwitchHints(choice.pulls.length)
  if (own === choice.pulls.length) return <OwnNote own={own} total={own} />
  const pick = key => {
    onOptionsChange({ ...promptOptions, ...choice.options, ...WHO_OPTIONS[key] })
    if (key !== 'draft' && granted.merge) onModeChange?.('review')
  }
  // A switch that cannot be turned on is no switch: the reason is a plain line, so nothing looks available that is not.
  const blocked = !granted.merge && !!mergeBlocker
  const mergeSwitch = !onModeChange || choice.intent !== 'review' ? null : blocked
    ? <p className="co-rw-option is-line"><strong>Merge after I approve</strong><small>{mergeBlocker}</small></p>
    : <Switch checked={granted.merge} disabled={busy} label="Merge after I approve" detail={hints.merge}
      onChange={checked => onModeChange(checked ? 'review_merge' : 'review')} />
  return <>
    {canDraft ? <WhoSees who={who} agentAllowed={capabilities?.agent_submits_verdict === true} disabled={busy || !promptOptions} onChange={pick} /> : null}
    {mergeSwitch && canDraft ? <div className="co-rw-options">{mergeSwitch}</div> : null}
    {own ? <OwnNote own={own} total={choice.pulls.length} /> : null}
  </>
}

// The exact heads and target tips behind this approval, out of the way.
function VersionDetails({ pulls, live }) {
  return <details className="co-task-details co-rw-versions"><summary>{live ? (pulls.length === 1 ? 'Commit this review covers' : 'Commits this review covers') : 'Exact versions'}</summary>
    {pulls.map(pr => <p key={prKey(pr)}>#{pr.number}: <code>{pr.headRefOid?.slice(0, 7)} → {pr.baseRefName} ({live ? 'last seen ' : ''}{baseTip(pr)?.slice(0, 7)})</code></p>)}
  </details>
}

// Rights do not depend on the capability read, so they explain first. A draft can be
// taken over: the agent never marks it ready, you do.
function takeoverBlockerFor(choice, capabilities, saved) {
  return takeoverBlocker(choice.pulls, { allowDraft: true })
    || takeoverCapabilityBlocker({ capabilities, saved })
    || (choice.intent === 'take_over' && !String(choice.takeover_reason || '').trim() ? 'Write why you are taking it over.' : '')
}

// The consent for one agent workflow on exact PRs: what the agent will do,
// what GitHub will see, which model runs it, and one start button whose label
// matches what is allowed. Opened in a dialog from a PR list, or inline on a
// saved review-link page.
export function ReviewConfirmation({ choice, busy, disabled, error, onConfirm, onCancel, onModeChange, appId, token, onResolved, onOptionsChange, onAgentChange, onReasonChange, bindCurrentTarget = false, capabilities: served = null, ownLogin = '', defaultAgent = null }) {
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
  // The agent the owner saved for reviews and fixes starts every window and is
  // the picker's Default row; without one, the server's answer above is.
  const ownDefault = defaultAgent?.model ? defaultAgent : null
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
  const blocker = takeover ? takeoverBlockerFor(choice, capabilities, saved) : ''
  const own = takeover ? 0 : ownedPulls(choice.pulls, ownLogin).length
  const ownOnly = own > 0 && own === choice.pulls.length
  // On your own PR the agent only checks, so the words describe a private review.
  const { posting, verdict, agentPosts } = takeover || ownOnly ? {} : publicChoice(choice, promptOptions, capabilities)
  const copy = reviewWindowCopy({ mode: ownOnly ? 'review' : choice.mode, intent: ownOnly ? 'check_my_pr' : choice.intent, posting, verdict, agentPosts, count: choice.pulls.length, bindCurrentTarget })
  const postingUnavailable = choice.mode === 'review_merge' && !!capabilities && !(capabilities.post_review === true && capabilities.propose_verdict === true)
  const startBlocked = takeover && !!blocker
  return <section ref={confirmation} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <WindowHead icon={takeover ? 'fix' : 'review'} title={copy.title} titleId={titleId} pulls={choice.pulls}
      tools={<><SeenOnGithub tone={copy.publicEffect.tone} text={copy.publicEffect.text} />{onCancel ? <CloseWindowButton onClick={onCancel} /> : null}</>} />
    <div className="co-rw-body">
      {takeover && choice.intent === 'take_over' && onReasonChange ? <TakeoverReason value={choice.takeover_reason || ''} disabled={busy} onChange={onReasonChange} /> : null}
      {takeover
        ? <p className="co-rw-note">The agent fixes what it finds and stops before every push for your approval. It never merges: when it is clean, you merge.</p>
        : <ReviewSwitches choice={choice} promptOptions={promptOptions} capabilities={capabilities} onModeChange={onModeChange} onOptionsChange={onOptionsChange} busy={busy} own={own} />}
      {startBlocked ? <p className="co-rw-blocker" role="status">{blocker}</p> : null}
      {postingUnavailable ? <p className="co-rw-blocker" role="status">Merging after your approval needs a newer Möbius. This would run as a private review.</p> : null}
      <WhatHappens copy={copy} />
      {onAgentChange ? <AgentModelSettings token={token} choice={choice.agent} defaultChoice={ownDefault || defaultChoice} explicitDefault={!!ownDefault}
        defaultHint={ownDefault ? 'Your default for reviews and fixes' : 'Your background agent setting'} onChange={next => { onAgentChange(next); return true }} /> : null}
      {appId && token ? <ReviewPromptPreview token={token} appId={appId} choice={choice} onResolved={resolve} onUnsupported={() => setUnsupported(true)} /> : null}
      <VersionDetails pulls={choice.pulls} live={bindCurrentTarget} />
    </div>
    <footer className="co-rw-foot">
      <p>{copy.footnote}</p>
      <div className="co-rw-actions">
        <button type="button" className="co-btn co-btn-primary" disabled={busy || disabled || startBlocked} onClick={onConfirm}>{busy ? 'Starting…' : copy.startLabel}</button>
      </div>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </footer>
  </section>
}
