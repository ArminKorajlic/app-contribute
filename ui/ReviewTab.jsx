import { useEffect, useState } from 'react'
import { OWNER_ITEM_STATES, reviewItemProgress, reviewRunHalted } from '../collaboration.js'
import { frameState } from '../review-frame.js'
import { openAgentConversation } from './BatchAction.jsx'
import { ClampedMarkdown } from './ClampedMarkdown.jsx'
import { CopyId, commentReference } from './CopyId.jsx'
import { ReviewFrame } from './ReviewFrame.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { VerdictProposal, savedVersion } from './RunDetail.jsx'

// Seconds since the run started, ticking once a second while `running`.
function useElapsed(startedAt, running) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const started = Date.parse(startedAt || '')
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null
}

export const formatElapsed = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// How a review reads on the PR: one title and tone per state, chosen from the
// platform's own run state. `changes` is a proposal to request changes.
export function reviewStateTone(status) {
  if (!status) return { key: 'none', title: 'No review yet' }
  const { run, item } = status
  const progress = reviewItemProgress(run, item)
  if (progress.halted || item.state === 'failed') return { key: 'halted', title: progress.label, box: 'changes' }
  if (frameState(status) === 'reviewing') return { key: 'running', title: progress.label }
  if (item.state === 'verdict_pending') return { key: 'verdict', title: 'Verdict waiting for you', box: 'verdict' }
  if (item.state === 'needs_you' && item.verdict_proposal?.event === 'REQUEST_CHANGES') return { key: 'changes', title: 'Changes found', box: 'changes' }
  if (OWNER_ITEM_STATES.has(item.state)) return { key: 'needs', title: progress.label, box: 'verdict' }
  if (item.state === 'all_clear') return { key: 'clear', title: 'Review clear', box: 'clear' }
  return { key: 'settled', title: progress.label }
}

// The Review tab of a PR: nothing yet, a running review, or what the last review
// found. It reuses the run's own verdict and conversation actions.
export function ReviewTab({ pr, status, earlier = null, own = false, readOnly = false, busy = false, error = '', onStart, onStop, onRetry, onVerdict, pulls = [], listState = {} }) {
  const tone = reviewStateTone(status)
  const running = tone.key === 'running'
  const elapsed = useElapsed(status?.run?.created_at, running)
  if (!status && earlier) return <EarlierReview earlier={earlier} readOnly={readOnly} onStart={onStart} />
  if (!status) {
    // The Agent button above already starts a review, so there is nothing to offer here.
    return <div className="co-review-box" aria-label="Review">
      <h4>No review yet</h4>
      <p className="co-review-note" style={{ color: 'var(--text)', fontSize: 15 }}>You haven’t made a review for this PR.</p>
      {readOnly ? null : <p className="co-review-note">Use Agent above to start one.</p>}
    </div>
  }
  const { run, item } = status
  const halted = reviewRunHalted(run)
  const stoppable = run.can_stop && run.state !== 'complete' && !halted
  const version = `${item.head_sha?.slice(0, 7) || '…'} → ${item.base_ref || 'main'}`
  const reviewId = item.verdict_proposal?.review_id || commentReference(item.public_review?.url)
  const posted = item.public_review?.state === 'posted' && item.public_review.url
  const body = <div className={'co-review-box' + (tone.box ? ' is-' + tone.box : '')} aria-label="Review">
    <div className="co-review-head">
      {running ? <span className="co-arc" aria-hidden="true" /> : null}
      <h4>{tone.title}</h4>
      {running && elapsed !== null ? <span className="co-review-elapsed">· {formatElapsed(elapsed)}</span> : null}
      {tone.key === 'clear' ? <CopyId id={String(reviewId || '')} label="review id" /> : null}
      <span className="co-review-version">{version}</span>
    </div>
    {running ? <p className="co-review-note">The agent is reading the PR. Its findings appear here when it finishes. You can leave this page: the frame on the list shows when it is done.</p> : null}
    {item.summary ? <ClampedMarkdown markdown={item.summary} /> : null}
    {item.verdict_proposal ? <VerdictProposal proposal={item.verdict_proposal} mode={run.mode} busy={busy} own={own}
      onDecide={onVerdict ? (proposal, decision) => onVerdict(item, proposal, decision) : null} /> : null}
    {posted ? <a className="co-quiet-action" href={item.public_review.url} target="_blank" rel="noopener noreferrer">View the posted review on GitHub</a> : null}
    {item.tests ? <details className="co-task-details"><summary>What it ran</summary><p className="co-review-note">{item.tests}</p></details> : null}
    <p className="co-review-note">{savedVersion(item, pulls, listState)}</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="co-review-actions">
      {run.chat_id ? <button type="button" className={'co-btn' + (running || tone.key === 'needs' ? ' co-btn-primary' : '')} onClick={() => openAgentConversation(run.chat_id)}>{tone.key === 'needs' ? 'Answer in review conversation' : 'Open review conversation'}</button> : null}
      {stoppable && onStop ? <button type="button" className="co-quiet-action" disabled={busy} onClick={onStop}>Stop review</button> : null}
      {halted && onRetry ? <button type="button" className="co-btn" disabled={busy} onClick={onRetry}>Start again</button> : null}
    </div>
  </div>
  return <ReviewFrame state={frameState(status)} radius={12}>{body}</ReviewFrame>
}

// The PR changed after its last review, so that review is of an earlier version:
// show it for what it was, and offer to review the version that is here now.
function EarlierReview({ earlier, readOnly, onStart }) {
  const { run, item } = earlier
  return <div className="co-review-box" aria-label="Review">
    <div className="co-review-head">
      <h4>Reviewed an earlier version</h4>
      <span className="co-review-version">{item.head_sha?.slice(0, 7) || '…'} → {item.base_ref || 'main'}</span>
    </div>
    <p className="co-review-note" style={{ color: 'var(--text)', fontSize: 15 }}>The last review was <TimeAgo value={run.created_at} />, on commit <code>{item.head_sha?.slice(0, 7)}</code>. This PR has changed since, so its findings may no longer apply.</p>
    {item.summary ? <ClampedMarkdown markdown={item.summary} /> : null}
    <div className="co-review-actions">
      {run.chat_id ? <button type="button" className="co-btn" onClick={() => openAgentConversation(run.chat_id)}>Open that review conversation</button> : null}
      {readOnly ? null : <>
        <button type="button" className="co-btn co-btn-primary" onClick={() => onStart?.('private')}>Review this version</button>
        <button type="button" className="co-btn" onClick={() => onStart?.('github')}>Review on GitHub</button>
      </>}
    </div>
  </div>
}
