import { useEffect, useState } from 'react'
import { OWNER_ITEM_STATES, ignoredNote, reviewItemProgress, reviewRunHalted } from '../collaboration.js'
import { postableFindings, reviewActionPlan, reviewStoppable } from '../review-actions.js'
import { frameOf } from '../pr-standing.js'
import { openAgentConversation } from './BatchAction.jsx'
import { ClampedMarkdown } from './ClampedMarkdown.jsx'
import { CopyId, commentReference } from './CopyId.jsx'
import { ReviewFrame } from './ReviewFrame.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { RepairProposal, VerdictProposal, savedVersion } from './RunDetail.jsx'

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

// The saved review itself: its title, its box and which buttons fit what it holds.
// Where the PR stands overall, and which actions are allowed, is the PR
// machine's decision (`standing`), never worked out here.
export function reviewContent(status, ctx) {
  if (!status) return { key: 'none', title: 'No review yet' }
  const { run, item } = status
  const progress = reviewItemProgress(run, item, ctx)
  if (progress.halted || item.state === 'failed') return { key: 'halted', title: progress.label, box: 'changes' }
  if (progress.turn === 'agent') return { key: 'running', title: progress.label }
  if (item.state === 'verdict_pending') return { key: 'verdict', title: 'Verdict waiting for you', box: 'verdict' }
  if (progress.turn === 'author') return { key: 'waiting', title: progress.label }
  if (ignoredNote(item, ctx?.ignored)) return { key: 'ignored', title: 'Ignored' }
  if (item.state === 'needs_you' && item.verdict_proposal?.event === 'REQUEST_CHANGES') return { key: 'changes', title: 'Changes found', box: 'changes' }
  if (item.state === 'needs_you' && !progress.waiting) return { key: 'findings', title: ctx?.own ? 'Your check found problems' : 'Problems found', box: 'verdict' }
  if (OWNER_ITEM_STATES.has(item.state)) return { key: 'needs', title: progress.label, box: 'verdict' }
  if (item.state === 'all_clear') return { key: 'clear', title: 'Review clear', box: 'clear' }
  return { key: 'settled', title: progress.label }
}

const allowed = (standing, ...ids) => !!standing?.actions?.some(action => ids.includes(action.id) && action.enabled)

// The Review tab of a PR: nothing yet, a running review, or what the last review
// found. It reuses the run's own verdict and conversation actions.
export function ReviewTab({ pr, status, standing = null, earlier = null, own = null, ignored = null, canPost = false, readOnly = false, busy = false, error = '', onStart, onStop, onRetry, onVerdict, onRepair, onCheck, onFix, onIgnore, onUndoIgnore, onPost, pulls = [], listState = {} }) {
  const tone = reviewContent(status, { own, ignored })
  const running = tone.key === 'running'
  const elapsed = useElapsed(status?.run?.created_at, running)
  if (!status && earlier) return <EarlierReview earlier={earlier} readOnly={readOnly} onStart={onStart} role={standing?.role} />
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
  const progress = reviewItemProgress(run, item, { own, ignored })
  const stoppable = reviewStoppable({ run, tone: tone.key, progress })
  const note = ignoredNote(item, ignored)
  const asked = progress.waiting
  const plan = reviewActionPlan({ tone: tone.key, own: own === true, chat: !!run.chat_id, asked, stoppable: stoppable && !!onStop, can: { retry: halted && !!onRetry, fix: !readOnly && !!onFix && allowed(standing, 'respond'), post: !readOnly && canPost && !!onPost && postableFindings(item) && allowed(standing, 'draft_verdict'), ignore: !readOnly && !!onIgnore && allowed(standing, 'set_aside'), undo: !readOnly && !!onUndoIgnore, again: !readOnly && !!onStart && allowed(standing, 'review', 'check_my_pr') } })
  const handlers = { ask: () => openAgentConversation(run.chat_id), stop: onStop, retry: onRetry, fix: () => onFix(item), post: () => onPost({ run, item }), ignore: () => onIgnore(item), undo: () => onUndoIgnore?.(item), again: () => onStart(standing?.role === 'author' ? 'check_my_pr' : 'review') }
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
    {tone.key === 'halted' && run.summary ? <p className="co-review-note">{run.summary}</p> : null}
    {item.summary ? <ClampedMarkdown markdown={item.summary} /> : null}
    {item.verdict_proposal ? <VerdictProposal proposal={item.verdict_proposal} mode={run.mode} busy={busy} own={own}
      onDecide={onVerdict ? (proposal, decision, extra) => onVerdict(item, proposal, decision, extra) : null} onCheck={onCheck || null} /> : null}
    <RepairProposal item={item} busy={busy} onDecide={onRepair && !readOnly ? (attempt, decision) => onRepair(item, attempt, decision) : null} />
    {posted ? <a className="co-quiet-action" href={item.public_review.url} target="_blank" rel="noopener noreferrer">View the posted review on GitHub</a> : null}
    {item.tests ? <details className="co-task-details"><summary>What it ran</summary><p className="co-review-note">{item.tests}</p></details> : null}
    <p className="co-review-note">{savedVersion(item, pulls, listState)}</p>
    {error ? <p role="alert">{error}</p> : null}
    {tone.key === 'ignored' && note ? <p className="co-review-note">Ignored: {note.reason}. Only for this version; it comes back if the PR changes.</p> : null}
    <div className="co-review-actions">
      {plan.map(action => <button key={action.key} type="button" disabled={busy && action.key !== 'ask'} className={action.primary ? 'co-btn co-btn-primary' : action.quiet ? 'co-quiet-action' : 'co-btn'} onClick={handlers[action.key]}>{action.label}</button>)}
    </div>
  </div>
  return <ReviewFrame state={standing ? frameOf(standing) : 'idle'} radius={12}>{body}</ReviewFrame>
}

// The PR changed after its last review, so that review is of an earlier version:
// show it for what it was, and offer to review the version that is here now.
function EarlierReview({ earlier, readOnly, onStart, role }) {
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
      {readOnly ? null : <button type="button" className="co-btn co-btn-primary" onClick={() => onStart?.(role === 'author' ? 'check_my_pr' : 'review')}>{role === 'author' ? 'Check this version' : 'Review this version'}</button>}
    </div>
  </div>
}
