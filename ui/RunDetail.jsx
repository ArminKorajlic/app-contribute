import { baseTip, OWNER_ITEM_STATES, prKey, reviewItemProgress, reviewRunHalted, reviewRunStateLabel, reviewRunTitle, runDetailsElsewhere } from '../collaboration.js'
import { verdictCopy } from '../review-copy.js'
import { openAgentConversation } from './BatchAction.jsx'
import { Icon } from './Icons.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { ResolvedPrompt } from './ReviewPromptSettings.jsx'

// Saved conversations outlive the open-PR inventory. Its current snapshot
// provides context, never new approval or a fresh verdict for old findings.
export function savedVersion(item, pulls = [], listState = {}) {
  if (listState.loading || listState.error) return 'Current version not checked'
  const pr = pulls.find(pr => prKey(pr) === `${item.repo.toLowerCase()}#${item.number}`)
  if (!pr) return 'Not in the loaded open PRs'
  if (item.head_sha !== pr.headRefOid || item.base_ref !== pr.baseRefName) return 'Older PR version'
  if (!item.base_sha || !baseTip(pr)) return 'Current base not checked'
  return item.base_sha === baseTip(pr) ? 'Matches loaded PR version' : 'Older base version'
}

// A proposed approve or request changes: the exact words GitHub would show,
// and the owner's own Submit or Discard. Only a proposal still waiting offers them.
function VerdictProposal({ proposal, mode, busy, onDecide }) {
  const copy = verdictCopy(proposal, mode)
  const waiting = proposal.state === 'proposed' && onDecide
  return <div className={'co-verdict' + (proposal.event === 'APPROVE' ? ' is-approve' : ' is-changes')}>
    <p className="co-verdict-status" role="status">{copy.status}</p>
    {proposal.state === 'posted' && proposal.url ? <a href={proposal.url} target="_blank" rel="noopener noreferrer">View it on GitHub</a> : null}
    {waiting ? <>
      <details className="co-task-details" open><summary>What it would post</summary><MarkdownView markdown={proposal.body} /></details>
      <p className="co-task-footnote">{copy.note}</p>
      <div className="co-verdict-actions">
        <button type="button" className="co-btn co-btn-primary" disabled={busy} onClick={() => onDecide(proposal, 'submit')}>{busy ? 'Working…' : copy.submit}</button>
        <button type="button" className="co-btn" disabled={busy} onClick={() => onDecide(proposal, 'discard')}>Discard</button>
      </div>
    </> : null}
  </div>
}

// The one presentation of a review run, wherever it is opened from: a PR row,
// the project's review history, or a chat link to the run.
export function RunDetail({ run, pulls, listState, busy = false, error = '', onStop, retryPulls = [], onRetry, onVerdict, updater = null }) {
  const halted = reviewRunHalted(run)
  const needsAnswer = run.execution_state === 'awaiting_owner' || run.items?.some(item => item.state !== 'verdict_pending' && OWNER_ITEM_STATES.has(item.state))
  const stoppable = run.can_stop && run.state !== 'complete' && !halted
  const retryable = halted && retryPulls.length > 0 && onRetry
  const elsewhere = runDetailsElsewhere(run)
  return <>
    <Icon name="review" size={23} /><h3>{reviewRunTitle(run)}</h3>
    <p>Recorded status: {reviewRunStateLabel(run)}</p>{run.summary ? <p>{run.summary}</p> : null}
    {elsewhere ? <p className="co-task-footnote">Started outside Contribute. Its instructions and findings are in the owning conversation.</p>
      : <details className="co-task-details"><summary>Instructions used by this run</summary>{run.options ? <ResolvedPrompt snapshot={run.options} /> : <p>This older run did not save a prompt snapshot.</p>}</details>}
    <div className="co-task-pulls">{run.items?.map(item => <div key={`${item.repo}:${item.number}`}>
      <strong>#{item.number} · {reviewItemProgress(run, item).label}</strong>
      <p className="co-pr-note">{savedVersion(item, pulls, listState)} · Recorded version <code>{item.head_sha?.slice(0, 7) || 'unknown'} → {item.base_ref || 'unknown'} ({item.base_sha?.slice(0, 7) || 'unknown'})</code>.{elsewhere ? '' : ' Saved findings are not a new approval.'}</p>
      {item.summary ? <MarkdownView markdown={item.summary} /> : elsewhere ? null : <p>The agent’s findings will appear here.</p>}
      {item.public_review?.state === 'posted' && item.public_review.url ? <a href={item.public_review.url} target="_blank" rel="noopener noreferrer">View the posted review on GitHub</a>
        : item.public_review?.state === 'posting' ? <p className="co-task-footnote">Posting the review on GitHub…</p>
        : item.public_review?.summary ? <p className="co-task-footnote">{item.public_review.summary}</p> : null}
      {item.verdict_proposal ? <VerdictProposal proposal={item.verdict_proposal} mode={run.mode} busy={busy}
        onDecide={onVerdict && !elsewhere ? (proposal, decision) => onVerdict(item, proposal, decision) : null} /> : null}
    </div>)}</div>
    {run.chat_id ? <button className="co-btn co-btn-primary co-task-primary" onClick={() => openAgentConversation(run.chat_id)}>{needsAnswer ? 'Answer in review conversation' : elsewhere ? 'Open the owning conversation for details' : 'Open review conversation'}</button> : null}
    {stoppable && onStop ? <><button className="co-quiet-action" disabled={busy} onClick={onStop}>Stop workflow</button><p className="co-task-footnote">Stop prevents future actions. An already-started public action may finish; its outcome stays visible.</p></> : null}
    {retryable ? <><button className="co-btn co-task-secondary" disabled={busy} onClick={() => onRetry(retryPulls)}>Start again</button><p className="co-task-footnote">Starts a new run on the current versions. You can pick another model.</p></> : null}
    {!run.can_stop && run.state !== 'complete' && run.chat_id && !retryable ? <p className="co-task-footnote">Use Stop in the owning conversation to stop this workflow.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {run.items?.some(item => item.state === 'merged') && updater ? <><p className="co-task-footnote">Merged on GitHub. {updater.where}</p><button className="co-btn co-task-secondary" onClick={updater.open}>{updater.label}</button></> : null}
    {run.items?.some(item => item.state === 'queued') ? <p>In the merge queue, not merged yet. Contribute checks GitHub and shows when it lands.</p> : null}
  </>
}
