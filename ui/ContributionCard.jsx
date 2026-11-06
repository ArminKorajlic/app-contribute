import React, { useEffect, useId, useRef, useState } from 'react'
import {
  ATTENTION_DETAIL,
  ATTENTION_HEADLINE,
  STATUS_LABELS,
  TYPE_LABELS,
  problemHeadline,
  screenshotCountText,
  statusNarration,
  timeAgo,
} from '../domain.js'
import { parseDiffStat } from '../diff.js'
import { contributionLabelOutcome } from '../labels.js'
import { contributionTitle } from '../run.js'
import {
  contributionFailureOwner,
  qualityReviewFor,
  recoveryReviewAction,
  reviewAllAction,
} from '../review.js'
import {
  autopilotState,
  autopilotNarration,
  autopilotRounds,
  isAutopilotResponding,
  needsHuman,
} from '../autopilot.js'
import { needsSourceRefresh, reviewIncomplete as recordReviewIncomplete, sendNeedsAttention } from '../send-readiness.js'
import { FileDiffList } from './FileDiffList.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { useScreenshots } from './useScreenshots.js'
import { Icon } from './Icons.jsx'
import { AgentHandoffButton } from './BatchAction.jsx'

// One ledger row. Cards deliberately expose explicit targets only — the title
// is the link on a linked PR/issue card, and prepared cards use their
// Send/Drop/Details controls; there is no whole-card click (removed for
// stability, so narration copy must not promise a tap). The status chip
// carries the group's identity in color, and the meta line reads
// type · repo#number · updated-time.
// Every field is optional-tolerant — the ledger is written by the agent and
// cron, so a missing summary or repo just drops that piece rather than breaking
// layout.
//
// Prepared records grow a review flow when the feed passes the handlers:
//   - with a `plan`, the collapsed card shows only high-level context; Review
//     expands the exact markdown body and an on-demand structured diff.
//   - without one (a record staged by a v1-skill agent), the card keeps the
//     plain fallback and Send returns a re-stage error from the platform.
// Send calls the platform submit endpoint directly for PR plans; Chat returns
// to the source conversation; Dismiss CAS-flips to abandoned via storage.js.

const ACTION_LABELS = {
  pr: 'Pull request',
  pr_update: 'Pull request update',
  issue: 'Issue',
  issue_comment: 'Issue comment',
  discussion_comment: 'Discussion reply',
}

const PREPARED_ACTION_LABELS = {
  pr: 'New PR',
  pr_update: 'Update PR',
  issue: 'New issue',
  issue_comment: 'New issue comment',
  discussion_comment: 'New discussion reply',
}

// The collapsed prepared card's one meta line: repo · branch · timeAgo. Kept to
// a single row — the branch (usually the longest, least critical char-by-char)
// is the piece that truncates, so repo and recency always stay legible.
function PlanMeta({ rec }) {
  const plan = rec.plan || {}
  const repo = plan.repo || rec.repo || ''
  const branch = plan.branch || rec.branch || ''
  const when = timeAgo(rec.updated_at || rec.created_at)
  const parts = [
    repo ? { cls: 'co-plan-meta-repo', value: repo } : null,
    branch ? { cls: 'co-plan-meta-branch', value: branch } : null,
    when ? { cls: 'co-plan-meta-time', value: when } : null,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <div className={'co-plan-meta' + (branch ? ' has-branch' : '')}>
      {parts.map((part, i) => (
        <React.Fragment key={part.cls}>
          {i > 0 ? (
            <span className="co-plan-meta-sep" aria-hidden="true">·</span>
          ) : null}
          <span className={part.cls}>{part.value}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

// The compact mono "N files +A −B" line, parsed from plan.diff_stat's summary
// (diff_stat is always stored). + green, − red; nothing renders if unparseable.
function DiffLine({ stat }) {
  const parsed = parseDiffStat(stat)
  if (!parsed || parsed.totalFiles === 0) return null
  const n = parsed.totalFiles
  return (
    <div className="co-diffline">
      <span className="co-diffline-files">{n} {n === 1 ? 'file' : 'files'}</span>
      <span className="co-diffline-add">+{parsed.additions}</span>
      <span className="co-diffline-del">{'−'}{parsed.deletions}</span>
    </div>
  )
}

function PlanSummary({ rec }) {
  const quality = qualityReviewFor(rec)
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'
  const showReadiness = isPr || rec.status === 'prepared'
  return (
    <div className="co-technical-summary">
      <PlanMeta rec={rec} />
      <DiffLine stat={rec.plan?.diff_stat} />
      {showReadiness ? (
        <span className={isPr ? 'co-quality-pill is-' + quality.state : 'co-quality-pill'}>
          <Icon name={isPr ? (quality.state === 'all_clear' ? 'check' : quality.state === 'changes_needed' ? 'fix' : 'review') : 'feedback'} size={13} />
          {isPr ? quality.label : 'Draft ready'}
        </span>
      ) : null}
    </div>
  )
}

const PRIOR_WORK_DECISIONS = {
  none: 'No overlapping work found',
  comment: 'The existing discussion is the right place to contribute',
  collaborate: 'Build on the active pull request',
  distinct_pr: 'A distinct pull request is justified after comparison',
}

function PriorWorkEvidence({ priorWork }) {
  if (!priorWork || typeof priorWork !== 'object') return null
  const query = typeof priorWork.query === 'string' ? priorWork.query.trim() : ''
  const summary = typeof priorWork.summary === 'string' ? priorWork.summary.trim() : ''
  const decision = PRIOR_WORK_DECISIONS[priorWork.decision] || 'Related work was checked'
  const matches = (Array.isArray(priorWork.matches) ? priorWork.matches : [])
    .map((item) => typeof item === 'string' ? { url: item } : item)
    .filter((item) => item && typeof item.url === 'string' &&
      item.url.startsWith('https://github.com/'))
  if (!query && !summary && matches.length === 0 && !priorWork.decision) return null

  return (
    <section className="co-prior-work" aria-label="Existing GitHub work checked">
      <div className="co-prior-work-head">
        <span className="co-prior-work-check" aria-hidden="true">✓</span>
        <div>
          <strong>Existing work checked</strong>
          <span>{decision}</span>
        </div>
      </div>
      {summary ? <p>{summary}</p> : null}
      {query || matches.length > 0 ? (
        <details className="co-prior-work-details">
          <summary>
            Search details
            {matches.length > 0 ? ` · ${matches.length} relevant ${matches.length === 1 ? 'match' : 'matches'}` : ''}
            <Icon name="right" className="co-prior-work-chevron" />
          </summary>
          <div>
            {query ? (
              <div className="co-prior-work-query">
                <span>Search</span>
                <code>{query}</code>
              </div>
            ) : null}
            {matches.length > 0 ? (
              <ul className="co-prior-work-links">
                {matches.slice(0, 5).map((item, index) => (
                  <li key={item.url + index}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {typeof item.title === 'string' && item.title.trim()
                        ? item.title.trim()
                        : `Related GitHub work ${index + 1}`}
                    </a>
                    {typeof item.note === 'string' && item.note.trim()
                      ? <span>{item.note.trim()}</span>
                      : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {matches.length > 5 ? (
              <span className="co-prior-work-more">+{matches.length - 5} more relevant links recorded</span>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function PlanLabels({ rec, outcome = contributionLabelOutcome(rec) }) {
  if (outcome.empty) return null
  const githubUrl = typeof rec.url === 'string' && rec.url.startsWith('https://github.com/')
    ? rec.url
    : null

  if (!outcome.published || !outcome.hasOutcome) {
    if (outcome.requested.length === 0) return null
    return (
      <section className="co-plan-labels" aria-label="Reviewed GitHub labels">
        <div className="co-plan-labels-row">
          <span>{outcome.published ? 'Reviewed labels' : 'Labels'}</span>
          <div>
            {outcome.requested.map((label) => (
              <span className="co-plan-label" key={label}>{label}</span>
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (!outcome.needsAttention) {
    return (
      <section className="co-plan-labels" aria-label="Published GitHub labels">
        <div className="co-plan-labels-row">
          <span>Labels applied</span>
          <div>
            {outcome.applied.map((label) => (
              <span className="co-plan-label" key={label}>{label}</span>
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      className={'co-label-outcome' + (outcome.needsAttention ? ' needs-attention' : '')}
      aria-label="Published GitHub label outcome"
    >
      <strong>{outcome.needsAttention ? 'Labels need attention' : 'Labels applied on GitHub'}</strong>
      {outcome.requested.length > 0 ? (
        <LabelOutcomeRow label="Requested" labels={outcome.requested} tone="muted" />
      ) : null}
      {outcome.applied.length > 0 ? (
        <LabelOutcomeRow label="Applied" labels={outcome.applied} />
      ) : null}
      {outcome.missing.length > 0 ? (
        <LabelOutcomeRow label="Not available" labels={outcome.missing} tone="muted" />
      ) : null}
      {outcome.unconfirmed.length > 0 ? (
        <LabelOutcomeRow label="Not confirmed" labels={outcome.unconfirmed} tone="muted" />
      ) : null}
      {outcome.note ? <p className="co-label-outcome-note">{outcome.note}</p> : null}
      {outcome.needsAttention ? (
        <p className="co-label-outcome-guidance">
          This pull request is already published. Adjust its labels on GitHub if needed;
          do not send it again.
        </p>
      ) : null}
      {outcome.needsAttention && githubUrl ? (
        <a className="co-review-link" href={githubUrl} target="_blank" rel="noopener noreferrer">
          Review labels on GitHub
        </a>
      ) : null}
    </section>
  )
}

function LabelOutcomeRow({ label, labels, tone = '' }) {
  return (
    <div className="co-label-outcome-row">
      <span>{label}</span>
      <div>
        {labels.map((value) => (
          <span className={'co-plan-label' + (tone ? ` is-${tone}` : '')} key={value}>
            {value}
          </span>
        ))}
      </div>
    </div>
  )
}

// A persisted submit failure, shown as a real alert strip (not stray red text)
// on the prepared card in both the collapsed and expanded states, so the reason
// a Send bounced stays visible while the partner fixes it.
function SubmitErrorAlert({ rec, reviewState, onReview }) {
  const blocked = reviewState?.state === 'needs_refresh'
  if (!blocked && !rec.last_submit_error) return null
  const message = blocked
    ? (reviewState.message || 'The staged source no longer matches this review.')
    : rec.last_submit_error
  // The backend tags each blocking problem with a stable `code`; lead with its
  // human headline and tuck the raw Git message behind Details. A persisted
  // last_submit_error carries no fresh code, so name it as one. An unmapped code
  // returns '' and the raw message becomes the headline (lenient fallback).
  const code = reviewState?.code || (rec.last_submit_error ? 'previous_submit_failure' : '')
  const headline = problemHeadline(code)
  const displayHeadline = headline || (blocked ? 'Fresh review needed' : 'Review needs refreshing')
  const reviewedHead = String(rec.plan?.head_sha || '')
  const branchWasPushed = (
    rec.last_submit_stage === 'pushed' &&
    reviewedHead &&
    String(rec.last_submit_push_sha || '') === reviewedHead &&
    typeof rec.last_pushed_branch_url === 'string' &&
    rec.last_pushed_branch_url.startsWith('https://github.com/')
  )

  return (
    <div className={'co-alert' + (blocked ? ' is-follow-up' : '')} role="status">
      <strong>{displayHeadline}</strong>
      <p className="co-alert-reassurance">
        {branchWasPushed
          ? 'The reviewed branch reached GitHub, but Contribute could not confirm the pull request.'
          : 'This review needs a quick check before it can continue.'}
      </p>
      <details className="co-alert-details">
        <summary>Technical details</summary>
        <p className="co-alert-text">{message}</p>
      </details>
      {branchWasPushed ? (
        <a
          className="co-review-link"
          href={rec.last_pushed_branch_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View pushed branch
        </a>
      ) : null}
      {typeof onReview === 'function' ? (
        <AgentHandoffButton
          action={recoveryReviewAction(rec)}
          onStart={onReview}
          className="co-btn co-btn-sm co-btn-primary"
          icon="review"
        />
      ) : null}
    </div>
  )
}

function attentionTitle(attention) {
  return attention?.title || ATTENTION_HEADLINE
}

function attentionMessage(attention) {
  return attention?.message || ATTENTION_DETAIL
}

function attentionDraft(rec) {
  const attention = rec.attention || {}
  const bits = [
    'Please sort out this upstream contribution:',
    rec.title ? '"' + rec.title + '"' : '',
    rec.repo ? '(' + rec.repo + ')' : '',
  ].filter(Boolean)
  const details = [
    attention.title || '',
    attention.message || '',
    attention.url || rec.url || '',
  ].filter(Boolean)
  return bits.join(' ') + (details.length ? '\n\nContext:\n' + details.join('\n') : '')
}

function recordAnchorId(rec) {
  const identity = String(rec?.id || rec?.number || rec?.title || 'legacy')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
  return `co-record-${identity}`
}

function attentionActivity(rec) {
  const candidates = [rec?.attention?.url, rec?.url, rec?.plan?.target_url]
  const exact = candidates.find(value => (
    typeof value === 'string' && value.startsWith('https://github.com/')
  ))
  if (exact) return { url: exact, label: 'View activity on GitHub' }

  const repo = String(rec?.plan?.repo || rec?.repo || '')
  const number = Number(rec?.number)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !Number.isInteger(number) || number < 1) {
    return null
  }
  const collection = rec?.type === 'pr' ? 'pull' : 'issues'
  return {
    url: `https://github.com/${repo}/${collection}/${number}`,
    label: rec?.type === 'pr' ? 'Open pull request on GitHub' : 'Open request on GitHub',
  }
}

function AttentionCallout({ rec, onFeedback, onInspect }) {
  const [note, setNote] = useState('')
  const attention = rec.attention || {}
  if (!rec.needs_attention && !attention.title && !attention.message) return null
  const activity = attentionActivity(rec)
  const sourceChatId = [rec?.chat_id, ...(Array.isArray(rec?.chat_ids) ? rec.chat_ids : [])]
    .find(value => typeof value === 'string' && !!value.trim())
  const canFixInChat = !!sourceChatId && typeof onFeedback === 'function'

  function handleAskAgent() {
    if (!canFixInChat) return
    const outcome = onFeedback(
      { ...rec, chat_id: sourceChatId },
      { draft: attentionDraft(rec) },
    ) || {}
    setNote(outcome.ok
      ? ''
      : outcome.reason === 'missing-chat'
        ? 'This older record no longer has a usable source chat.'
        : 'Open Contribute from inside Möbius to return to the source chat.')
  }

  return (
    <div className="co-attention" role="status">
      <div className="co-attention-copy">
        <div className="co-attention-title">{attentionTitle(attention)}</div>
        <p className="co-attention-text">{attentionMessage(attention)}</p>
        {activity ? (
          <a
            className="co-review-link"
            href={activity.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {activity.label}
          </a>
        ) : null}
        {!activity && !canFixInChat ? (
          <a
            className="co-review-link"
            href={`#${recordAnchorId(rec)}`}
            onClick={onInspect}
          >
            Review saved details
          </a>
        ) : null}
        {note ? <p className="co-review-error" role="status">{note}</p> : null}
      </div>
      {canFixInChat ? (
        <button
          type="button"
          className="co-icon-btn co-refresh-btn is-primary"
          aria-label="Fix this contribution in chat"
          title="Fix in chat"
          onClick={handleAskAgent}
        >
          <Icon name="feedback" />
          <span>Fix in chat</span>
        </button>
      ) : null}
    </div>
  )
}

function ReconciliationHint({ hint, onDismiss }) {
  if (!hint || hint.type !== 'already_landed') return null
  const landingUrl = hint.landing_pr?.url
  return (
    <div className="co-reconciliation-hint" role="status">
      <div>
        <strong>{hint.title || 'Looks already landed'}</strong>
        <p>{hint.message || 'Parts of this change are already on main, but the match is not conclusive.'}</p>
        {typeof landingUrl === 'string' && landingUrl.startsWith('https://github.com/') ? (
          <a href={landingUrl} target="_blank" rel="noopener noreferrer">
            View possible landing PR
          </a>
        ) : null}
      </div>
      <button type="button" className="co-btn co-btn-sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

function publicationHandoff(rec) {
  const handoff = rec?.plan?.after_merge
  if (!handoff || handoff.action !== 'connect_app') return null
  return handoff
}

function PublicationReviewNote({ rec }) {
  if (!publicationHandoff(rec)) return null
  return (
    <section className="co-publication-review" aria-label="Reviewed after-merge action">
      <span>After merge</span>
      <div>
        <strong>Link this local app to its published version</strong>
        <p>
          After merge, Contribute verifies the published source and offers one
          local link. The app and its saved data stay in place.
        </p>
      </div>
    </section>
  )
}

// Omitting the Möbius Agent co-author trailer is part of what the owner
// approves (the platform refuses a commit without it unless the reviewed plan
// says exactly `coauthor_trailer: false`), so the review names that choice.
function CoauthorOmittedNote({ rec }) {
  if (rec?.plan?.coauthor_trailer !== false) return null
  return (
    <section className="co-publication-review" aria-label="Reviewed commit attribution">
      <span>Attribution</span>
      <div>
        <strong>Möbius Agent is not listed as co-author</strong>
        <p>
          This commit leaves out the usual Co-authored-by line. Send it only if
          the project's policy forbids that line or you asked to omit it.
        </p>
      </div>
    </section>
  )
}

// The staged plan, rendered for review. Shown only when rec.plan exists. The
// diff now reads as a changed-file list (FileDiffList) that fetches and parses
// the full diff on expand — no raw diff_stat block, no excerpt step.
export function ReviewPlan({ rec, loadDiff }) {
  const plan = rec.plan
  const [tab, setTab] = useState('description')
  const isPr = plan.action === 'pr' || rec.type === 'pr'
  const screenshots = useScreenshots(rec, tab === 'description')
  return <>
    <nav className="co-detail-tabs" aria-label="Prepared contribution details">
      {['description', ...(isPr ? ['files'] : []), 'activity'].map(key => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{key === 'description' ? 'Description' : key === 'files' ? 'Files' : 'Activity'}</button>)}
    </nav>
    {tab === 'description' ? <>
      <MarkdownView markdown={plan.body_draft || rec.summary || 'No written description is saved for this proposal.'} images={screenshots.images} />
      {screenshots.count && rec.status === 'prepared' ? <p className="co-shot-note">
        {screenshotCountText(screenshots.count)} will be uploaded to your GitHub account when you send (your fork, or this repository if you own it), so the pull request can show {screenshots.count === 1 ? 'it' : 'them'}.
      </p> : null}
      {isPr ? <CoauthorOmittedNote rec={rec} /> : null}
      <PublicationReviewNote rec={rec} />
    </> : null}
    {tab === 'files' ? <FileDiffList rec={rec} loadDiff={loadDiff} /> : null}
    {tab === 'activity' ? <>
      <PriorWorkEvidence priorWork={plan.prior_work} />
      <PlanLabels rec={rec} />
      <p className="co-review-assurance">Prepared from the source conversation. Publication and merging remain separate approvals.</p>
      <details className="co-pr-metadata"><summary>Technical details</summary><div className="co-pr-metadata-body"><PlanMeta rec={rec} /><p>Prepared head: <code>{plan.head_sha || 'Not recorded'}</code></p></div></details>
    </> : null}
    {typeof plan.target_url === 'string' && plan.target_url.startsWith('https://github.com/') ? <a className="co-review-link" href={plan.target_url} target="_blank" rel="noopener noreferrer">View target on GitHub</a> : null}
  </>
}

// The Send/Dismiss row plus its outcome messaging; shared by the plan
// review and the plan-less v1 fallback.
function ReviewActions({
  rec, reviewState, reviewAction, onSend, onReview, onFeedback, onDismiss,
}) {
  const [sendNote, setSendNote] = useState(null)
  const [sending, setSending] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  // Dismiss removes the prepared record from the active list. It is reversible
  // from the Run's Dismissed fold, but still must not fire on a stray tap.
  const [confirmingDismiss, setConfirmingDismiss] = useState(false)
  const [note, setNote] = useState(null)
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'
  const isUpdate = rec.plan?.action === 'pr_update'
  const blocked = needsSourceRefresh(reviewState)
  // A failed publication needs the source-aware agent recovery above this
  // action row. Do not offer the same blind GitHub mutation again while its
  // cause is unresolved.
  const attentionBlocked = rec.needs_attention === true
  const submitFailed = sendNeedsAttention(rec)
  const reviewIncomplete = isPr && recordReviewIncomplete(rec)
  const keepButtonRef = useRef(null)
  const confirmDescriptionId = useId()

  // The confirm replaces the action row. Move focus to the safe choice so
  // keyboard and switch users never land on the state-changing action by default.
  useEffect(() => {
    if (confirmingDismiss) keepButtonRef.current?.focus()
  }, [confirmingDismiss])

  async function send() {
    if (!isPr || blocked || submitFailed || reviewIncomplete) return
    setSending(true)
    setAccepted(true)
    setSendNote(null)
    setNote(null)
    try {
      const outcome = (await onSend(rec)) || {}
      // Success and pending states already move the record out of this action
      // state. Only failures need a second line of explanation.
      if (!outcome.ok && !outcome.pending) {
        const recovery = contributionFailureOwner(outcome) === 'agent'
          ? await onReview?.(recoveryReviewAction(rec))
          : null
        if (!recovery?.ok) {
          setAccepted(false)
          setNote(outcome.error || recovery?.error || (isUpdate
            ? 'Could not update this pull request.'
            : 'Could not submit this contribution.'))
        }
      }
    } catch {
      setAccepted(false)
      setNote('The result could not be confirmed. Refresh before trying again.')
    } finally {
      setSending(false)
    }
  }

  function feedback() {
    setSendNote(null)
    setNote(null)
    const outcome = (typeof onFeedback === 'function' && onFeedback(
      rec,
      blocked ? {
        draft: `Please refresh contribution ${rec.id} ("${rec.title || 'untitled'}"). Contribute found: ${reviewState.message || 'the staged source changed after review.'}\n\n`,
      } : {},
    )) || {}
    if (!outcome.ok) {
      setNote(outcome.reason === 'missing-chat'
        ? 'This older record does not know which chat created it.'
        : 'Open Contribute from inside Möbius to jump back to the source chat.')
    }
  }

  async function dismiss() {
    setDismissing(true)
    setNote(null)
    try {
      const outcome = (await onDismiss(rec)) || {}
      if (outcome.conflict !== undefined) {
        setNote('This contribution just changed under you — the feed has been refreshed.')
      } else if (outcome.gone) {
        setNote('This record no longer exists — the feed has been refreshed.')
      } else if (outcome.error) {
        setNote(outcome.error === 'offline'
          ? 'You are offline — dismissing needs a connection; try again once you are back online.'
          : 'Could not dismiss: ' + outcome.error)
      }
    } finally {
      setDismissing(false)
      setConfirmingDismiss(false)
    }
  }

  if (accepted) return null

  return (
    <div className="co-action-block">
      {!confirmingDismiss ? (
        <ReconciliationHint
          hint={rec.reconciliation_hint}
          onDismiss={() => setConfirmingDismiss(true)}
        />
      ) : null}
      {confirmingDismiss ? (
        <div
          className="co-confirm"
          role="alertdialog"
          aria-label="Confirm dismissal"
          aria-describedby={confirmDescriptionId}
        >
          <p id={confirmDescriptionId} className="co-confirm-text">
            Dismiss this {isPr ? 'prepared pull request' : 'draft'}? It will leave
            your active list and can be restored from Dismissed.
          </p>
          <div className="co-confirm-actions">
            <button
              type="button"
              ref={keepButtonRef}
              className="co-btn co-btn-sm"
              disabled={dismissing}
              onClick={() => setConfirmingDismiss(false)}
            >
              Keep
            </button>
            <button
              type="button"
              className="co-btn co-btn-sm co-btn-caution"
              disabled={dismissing}
              onClick={dismiss}
            >
              {dismissing ? 'Dismissing…' : 'Dismiss'}
            </button>
          </div>
        </div>
      ) : (
        <div className="co-review-actions" role="group" aria-label="Contribution actions">
          {blocked ? (
            <button
              type="button"
              className="co-icon-btn co-refresh-btn is-primary"
              aria-label="Fix this contribution in chat"
              title="Fix in chat"
              onClick={feedback}
            >
              <Icon name="feedback" />
              <span>Fix in chat</span>
            </button>
          ) : isPr ? (
            <>
              {reviewIncomplete && typeof onReview === 'function' ? (
                <AgentHandoffButton
                  action={reviewAction || reviewAllAction([rec])}
                  onStart={onReview}
                  className="co-icon-btn co-review-btn is-primary"
                  icon="review"
                />
              ) : null}
              {!reviewIncomplete && !submitFailed && typeof onSend === 'function' ? (
                <button
                  type="button"
                  className={'co-icon-btn co-send-btn is-primary' + (sending ? ' is-sending' : '')}
                  disabled={sending}
                  onClick={send}
                  aria-busy={sending}
                  aria-label={sending
                    ? (isUpdate ? 'Sending pull request update' : 'Sending pull request')
                    : (isUpdate ? 'Send pull request update' : 'Send pull request')}
                  title={isUpdate ? 'Send update' : 'Send PR'}
                >
                  <Icon name="send" />
                  <span className="co-action-label">
                    <span>{sending ? 'Sending…' : (isUpdate ? 'Send update' : 'Send PR')}</span>
                    {sending ? (
                      <span className="co-action-label-sweep" aria-hidden="true">
                        Sending…
                      </span>
                    ) : null}
                  </span>
                </button>
              ) : null}
            </>
          ) : typeof onFeedback === 'function' ? (
            <button
              type="button"
              className="co-icon-btn co-send-btn is-primary"
              onClick={feedback}
              aria-label="Open this request's source conversation"
              title="Open source conversation"
            >
              <Icon name="feedback" />
              <span>Chat</span>
            </button>
          ) : null}
          {!blocked && !attentionBlocked && isPr ? (
            <button
              type="button"
              className="co-icon-btn co-secondary-action"
              onClick={feedback}
              aria-label="Open source chat"
              title="Open source chat"
            >
              <Icon name="feedback" />
              <span>Chat</span>
            </button>
          ) : null}
          <button
            type="button"
            className={isPr ? 'co-icon-btn co-secondary-action co-history-action' : 'co-request-history'}
            onClick={() => setConfirmingDismiss(true)}
            aria-label={isPr ? 'Dismiss prepared pull request' : 'Dismiss request draft'}
            title="Dismiss"
          >
            {isPr ? <span>Dismiss</span> : 'Dismiss'}
          </button>
        </div>
      )}
      {!isPr && rec.status === 'prepared' ? (
        <p className="co-review-note">
          Requests stay connected to their source conversation, where you can refine or publish them with the full context intact.
        </p>
      ) : null}
      {sendNote && (
        <p className="co-review-note" role="status" aria-live="polite">{sendNote}</p>
      )}
      {note && (
        <p className="co-review-error" role="status" aria-live="polite">{note}</p>
      )}
    </div>
  )
}

// Restore: bring an archived (abandoned) record back to Ready for review. No
// confirm — restoring is non-destructive, one tap. Its
// outcome messaging mirrors ReviewActions' dismiss so a conflict/offline reads
// the same everywhere.
function RestoreAction({ rec, onRestore }) {
  const [restoring, setRestoring] = useState(false)
  const [note, setNote] = useState(null)

  async function restore() {
    setRestoring(true)
    setNote(null)
    try {
      const outcome = (await onRestore(rec)) || {}
      if (outcome.conflict !== undefined) {
        setNote('This contribution just changed under you — the feed has been refreshed.')
      } else if (outcome.gone) {
        setNote('This record no longer exists — the feed has been refreshed.')
      } else if (outcome.error) {
        setNote(outcome.error === 'offline'
          ? 'You are offline — restoring needs a connection; try again once you are back online.'
          : 'Could not restore: ' + outcome.error)
      }
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="co-history-actions">
      <button
        type="button"
        className="co-btn co-btn-sm"
        disabled={restoring}
        onClick={restore}
      >
        {restoring ? 'Restoring…' : 'Restore'}
      </button>
      {note && (
        <p className="co-review-error" role="status" aria-live="polite">{note}</p>
      )}
    </div>
  )
}

function PublicationConnectionAction({ rec }) {
  const handoff = publicationHandoff(rec)
  const connection = rec.publication_connection
  if (!handoff || rec.status !== 'merged') return null

  if (
    connection?.status === 'connected' ||
    connection?.status === 'connected_conflict'
  ) {
    const conflicted = connection.status === 'connected_conflict'
    return (
      <div
        className={`co-publication-action is-connected${conflicted ? ' has-conflicts' : ''}`}
        role="status"
      >
        <span>{conflicted ? 'Linked with follow-up' : 'App linked'}</span>
        <strong>
          {conflicted
            ? 'The local app is linked, but its source changes need review.'
            : 'This local app now follows its published version.'}
        </strong>
        <p>
          {conflicted
            ? 'Your saved app data stayed in place. Open the app’s source chat to resolve the overlapping files.'
            : 'Future App Store updates will update this same app instead of creating a separate copy.'}
        </p>
      </div>
    )
  }

  return (
    <div className="co-publication-action" role="status">
      <span>Finishing publication</span>
      <strong>Attaching the published identity to this local app</strong>
      <p>
        Contribute completes this automatically after the reviewed change
        merges. Saved app data and newer local work stay in place.
      </p>
    </div>
  )
}

// Autopilot state for a shipped PR: the plain-language line, a Pause/Resume
// control, and the rounds timeline. The `autopilot` block on the record is a
// display-only mirror of a platform DB row — Pause/Resume calls the platform
// endpoint (onSetAutopilot), never a ledger write. Round summaries are plain
// text rendered without markdown (they may quote untrusted reviewer text).
function AutopilotPanel({ rec, onSetAutopilot }) {
  const block = autopilotState(rec)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  if (!block || typeof onSetAutopilot !== 'function') return null

  const enabled = !!block.enabled
  const line = autopilotNarration(rec)
  const rounds = autopilotRounds(rec)
  const responding = isAutopilotResponding(rec)
  const escalated = needsHuman(rec)

  const toggle = async () => {
    setBusy(true)
    setNote(null)
    const next = !enabled
    const outcome = (await onSetAutopilot(rec, next)) || {}
    if (outcome.error) setNote(outcome.error)
    setBusy(false)
  }

  return (
    <div className={`co-autopilot${escalated ? ' is-escalated' : ''}${responding ? ' is-responding' : ''}`}>
      <div className="co-autopilot-head">
        <span className="co-autopilot-badge">
          {responding ? 'Autopilot working' : enabled ? 'Autopilot on' : 'Autopilot paused'}
        </span>
        <button
          type="button"
          className="co-autopilot-toggle"
          onClick={toggle}
          disabled={busy}
        >
          {busy ? '…' : enabled ? 'Pause' : 'Resume'}
        </button>
      </div>
      {line ? <p className="co-autopilot-line">{line}</p> : null}
      {note ? <p className="co-autopilot-error">{note}</p> : null}
      {rounds.length > 0 && (
        <ul className="co-autopilot-rounds">
          {rounds.slice(0, 6).map((round, i) => (
            <li key={i}>
              <span className="co-autopilot-round-label">{round.label}</span>
              {round.summary ? (
                <span className="co-autopilot-round-summary">{round.summary}</span>
              ) : null}
              {round.when ? (
                <span className="co-autopilot-round-when">{timeAgo(round.when)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WithdrawAction({ rec, onWithdraw }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const keepRef = useRef(null)
  const descriptionId = useId()
  const eligible = rec.submission_mode === 'mobius-bot' &&
    ['draft', 'open'].includes(rec.status) &&
    typeof rec.relay_contribution_id === 'string' &&
    typeof onWithdraw === 'function'

  useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])

  if (!eligible) return null

  async function withdraw() {
    setBusy(true)
    setNote('')
    try {
      const outcome = (await onWithdraw(rec)) || {}
      if (!outcome.ok) {
        setNote(outcome.error || 'Could not withdraw this contribution.')
      }
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div className="co-published-action">
        <button
          type="button"
          className="co-btn co-btn-sm"
          onClick={() => { setNote(''); setConfirming(true) }}
        >
          Withdraw PR
        </button>
        {note ? <p className="co-review-error" role="status">{note}</p> : null}
      </div>
    )
  }

  return (
    <div
      className="co-confirm"
      role="alertdialog"
      aria-label="Confirm contribution withdrawal"
      aria-describedby={descriptionId}
    >
      <p id={descriptionId} className="co-confirm-text">
        Withdraw this pull request? Möbius will close it and remove its bot
        branch. The local record stays intact; nothing will be merged.
      </p>
      <div className="co-confirm-actions">
        <button
          type="button"
          ref={keepRef}
          className="co-btn co-btn-sm"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Keep open
        </button>
        <button
          type="button"
          className="co-btn co-btn-sm co-btn-caution"
          disabled={busy}
          onClick={withdraw}
        >
          {busy ? 'Withdrawing…' : 'Withdraw PR'}
        </button>
      </div>
    </div>
  )
}

// Action and attention live beside the record, not inside it. The focused
// review page can now answer two separate questions at a glance: what needs a
// decision (this tray), and what the pull request contains (ContributionCard).
export function ContributionDecision({
  rec,
  reviewState,
  reviewAction,
  onSend,
  onReview,
  onFeedback,
  onDismiss,
  onRestore,
  onWithdraw,
}) {
  const status = rec?.status || 'prepared'
  const isPr = rec?.plan?.action === 'pr' || rec?.type === 'pr'
  const hasAttention = rec?.needs_attention === true || !!rec?.attention?.title || !!rec?.attention?.message
  const hasSubmitAlert = reviewState?.state === 'needs_refresh' || !!rec?.last_submit_error
  const hasPreparedAction = status === 'prepared' && typeof onDismiss === 'function'
  const hasRestore = status === 'abandoned' && typeof onRestore === 'function'
  const hasWithdraw = rec?.submission_mode === 'mobius-bot' &&
    ['draft', 'open'].includes(status) &&
    typeof rec?.relay_contribution_id === 'string' &&
    typeof onWithdraw === 'function'
  const hasConnection = status === 'merged' && !!publicationHandoff(rec)
  const quality = qualityReviewFor(rec)
  const reviewInProgress = quality.state === 'reviewing' || quality.state === 'queued'
  const hasDecision = hasAttention || hasSubmitAlert ||
    hasPreparedAction || hasRestore || hasWithdraw || hasConnection
  if (!hasDecision) return null

  const title = hasSubmitAlert || hasAttention
    ? 'Needs attention'
    : reviewInProgress
      ? 'Review in progress'
      : status === 'prepared'
        ? 'Ready for your decision'
        : 'Follow-up'

  return (
    <section className="co-decision-surface" aria-label={title}>
      <AttentionCallout rec={rec} onFeedback={onFeedback} />
      <SubmitErrorAlert rec={rec} reviewState={reviewState} onReview={onReview} />
      <PublicationConnectionAction rec={rec} />
      <WithdrawAction rec={rec} onWithdraw={onWithdraw} />
      {hasPreparedAction ? (
        <ReviewActions
          rec={rec}
          reviewState={reviewState}
          reviewAction={reviewAction}
          onSend={onSend}
          onReview={onReview}
          onFeedback={onFeedback}
          onDismiss={onDismiss}
        />
      ) : null}
      {hasRestore ? <RestoreAction rec={rec} onRestore={onRestore} /> : null}
      {!isPr && status === 'prepared' && typeof onFeedback !== 'function' ? (
        <p className="co-review-note">Open the source conversation to continue this request.</p>
      ) : null}
    </section>
  )
}

export function ContributionCard({
  rec,
  reviewState,
  onSend,
  onReview,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  loadDiff,
  initialExpanded = false,
  showDecision = true,
}) {
  const status = rec.status || 'prepared'
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'
  const blocked = status === 'prepared' && (
    reviewState?.state === 'needs_refresh' || rec.needs_attention === true
  )
  const qualityState = qualityReviewFor(rec)
  const statusLabel = blocked
    ? 'Needs update'
    : status === 'prepared'
      ? (isPr ? qualityState.label : 'Draft')
      : (STATUS_LABELS[status] || status)
  const statusClass = blocked
    ? 'needs-refresh'
    : status === 'prepared' && isPr
      ? qualityState.state
      : status
  // The one plain-language line under the chip. A blocked card leads with its
  // SubmitErrorAlert instead, and an attention record with its callout, so both
  // suppress the calm lifecycle narration here.
  const narration = blocked ? '' : statusNarration(rec)
  const typeLabel = TYPE_LABELS[rec.type] || rec.type || 'Contribution'
  const when = timeAgo(rec.updated_at || rec.created_at)
  const [expanded, setExpanded] = useState(initialExpanded)

  // Reflection engagement signal: fire once each time the review opens, never
  // on collapse. `expanded` only ever goes true for a plan card, so this is
  // inherently scoped to real reviews.
  useEffect(() => {
    if (expanded) window.mobius?.signal?.('contribution_reviewed', { id: rec.id })
  }, [expanded])

  // repo, optionally with a #number; both tolerate absence.
  let where = rec.repo || ''
  if (where && rec.number) where += ' #' + rec.number
  const meta = [typeLabel, where, when].filter(Boolean)

  const title = rec.title || where || 'Untitled contribution'
  const hasLink =
    typeof rec.url === 'string' && rec.url.startsWith('https://github.com/')
  const labelOutcome = contributionLabelOutcome(rec)
  const showPublishedLabelOutcome = labelOutcome.published &&
    labelOutcome.hasOutcome && !labelOutcome.empty
  const reviewable = status === 'prepared' &&
    typeof onSend === 'function' && typeof onDismiss === 'function'
  const hasPlan = !!(rec.plan && typeof rec.plan === 'object' && (reviewable || initialExpanded))
  const plainTitle = hasPlan ? (rec.plan.title || title) : title
  const displayTitle = contributionTitle(rec, plainTitle)
  const planSummary = hasPlan && rec.summary && rec.summary !== displayTitle
    ? rec.summary
    : ''

  return (
    <div id={recordAnchorId(rec)} className={`co-card${blocked ? ' is-blocked' : ''}`}>
      <div className="co-card-top">
        <h3 className="co-card-heading">
          {hasLink ? (
            <a
              className="co-card-title"
              href={rec.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {displayTitle}
            </a>
          ) : (
            <span className="co-card-title">{displayTitle}</span>
          )}
        </h3>
        <span className={`co-chip is-${statusClass}`}>{statusLabel}</span>
      </div>
      {narration ? <p className="co-card-status">{narration}</p> : null}
      {planSummary ? (
        <p className={'co-card-summary' + (expanded ? '' : ' is-clamped')}>
          {planSummary}
        </p>
      ) : null}
      {!hasPlan && rec.summary ? <p className="co-card-summary">{rec.summary}</p> : null}
      {/* Non-plan cards keep the generic type · repo#number · time line; a
          prepared plan card carries its own repo · branch · time line inside
          the collapsed summary, so the two never stack. */}
      {!hasPlan && meta.length > 0 && (
        <div className="co-card-meta">
          {meta.map((part, i) => (
            <span key={i}>
              {i > 0 ? '· ' : ''}
              {part}
            </span>
          ))}
        </div>
      )}
      {showDecision ? (
        <AttentionCallout
          rec={rec}
          onFeedback={onFeedback}
          onInspect={() => setExpanded(true)}
        />
      ) : null}
      {status !== 'prepared' && autopilotState(rec) ? (
        <AutopilotPanel rec={rec} onSetAutopilot={onSetAutopilot} />
      ) : null}
      {showDecision ? <WithdrawAction rec={rec} onWithdraw={onWithdraw} /> : null}
      {showDecision ? (
        <SubmitErrorAlert
          rec={rec}
          reviewState={reviewState}
          onReview={onReview}
        />
      ) : null}
      {showPublishedLabelOutcome ? (
        <PlanLabels rec={rec} outcome={labelOutcome} />
      ) : null}
      {showDecision ? <PublicationConnectionAction rec={rec} /> : null}
      {hasPlan && (
        <div className={`co-card-footer${rec.reconciliation_hint ? ' is-reconciliation' : ''}`}>
          <button
            type="button"
            className="co-details-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{expanded ? 'Hide details' : 'Details'}</span>
            <span className={expanded ? 'is-open' : ''}><Icon name="chevron" size={16} /></span>
          </button>
          {/* Focused settled/public cards keep their reviewed plan readable, but
              active-queue actions belong only to still-prepared work. */}
          {showDecision && reviewable && (
            <ReviewActions
              rec={rec}
              reviewState={reviewState}
              onSend={onSend}
              onReview={onReview}
              onFeedback={onFeedback}
              onDismiss={onDismiss}
            />
          )}
        </div>
      )}
      {showDecision && reviewable && !hasPlan && (
        <div className="co-card-footer is-actions-only">
          <ReviewActions
            rec={rec}
            reviewState={reviewState}
            onSend={onSend}
            onReview={onReview}
            onFeedback={onFeedback}
            onDismiss={onDismiss}
          />
        </div>
      )}
      {hasPlan && expanded && (
        <div className="co-review">
          <PlanSummary rec={rec} />
          <ReviewPlan rec={rec} loadDiff={loadDiff} />
        </div>
      )}
      {showDecision && status === 'abandoned' && typeof onRestore === 'function' && (
        <RestoreAction rec={rec} onRestore={onRestore} />
      )}
    </div>
  )
}
