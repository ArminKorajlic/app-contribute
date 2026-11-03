import { isAutopilotResponding } from '../autopilot.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  contributionFailureOwner,
  progressReviewAction,
  reviewStateFor,
} from '../review.js'
import {
  contributionPath,
  contributionPathDecision,
  contributionStackDecision,
} from '../contribution-policy.js'
import { feedbackPull } from '../desk.js'
import { sortStackRecords, stackMeta, stackPublicationRecords } from '../stack.js'
import {
  contributionTitle,
  findRunItemByRecord,
  attentionListItems,
  isPublicFeedback,
  runPrimaryRecord,
  runUnitKey,
  runUnitRecords,
} from '../run.js'
import { openAgentConversation } from './BatchAction.jsx'
import { ContributionCard, ContributionDecision } from './ContributionCard.jsx'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import { ProjectTabs } from './ProjectTabs.jsx'
import { AttentionList } from './AttentionList.jsx'

function itemProject(item) {
  return item?.project || { name: item?.detail || 'Contribution' }
}

function itemHeading(item) {
  if (item?.unit?.type === 'stack') return item.label
  const record = runPrimaryRecord(item)
  return record ? contributionTitle(record) : item.label
}

function itemPublicationRecords(item) {
  return item?.unit?.type === 'stack'
    ? stackPublicationRecords(item.unit)
    : runUnitRecords(item).filter(record => record?.status === 'prepared')
}

function actionCount(items) {
  return (items || []).reduce(
    (total, item) => total + itemPublicationRecords(item).length,
    0,
  )
}

function readyCount(items) {
  return (items || []).reduce((total, item) => total + runUnitRecords(item)
    .filter(record => record?.status === 'draft' && record?.submission_mode !== 'mobius-bot').length, 0)
}

export function batchFingerprint(items, mode, publicationPreference, githubState) {
  const rows = (items || []).flatMap(item => runUnitRecords(item).map(record => [
    item?.kind,
    runUnitKey(item),
    record?.id,
    record?.status,
    record?.plan?.action,
    record?.plan?.repo || record?.repo,
    record?.plan?.branch || record?.branch,
    record?.plan?.head_sha,
    record?.last_submit_push_sha,
    record?.submission_mode,
    record?.readying ? 'readying' : '',
    record?.last_submit_error,
    record?.last_ready_error_code,
  ].map(value => String(value || '')).join('\u0001')))
  return JSON.stringify([
    mode, publicationPreference, githubState, ...rows.sort(),
  ])
}

function captureBatchItems(items) {
  return (items || []).map((item) => {
    const records = runUnitRecords(item).map(record => ({
      ...record,
      plan: record?.plan ? { ...record.plan } : record?.plan,
      quality_review: record?.quality_review
        ? { ...record.quality_review }
        : record?.quality_review,
    }))
    const primaryId = runPrimaryRecord(item)?.id
    return {
      ...item,
      record: records.find(record => record.id === primaryId) || records[0] || null,
      unit: item?.unit ? {
        ...item.unit,
        record: records.find(record => record.id === item.unit?.record?.id) || null,
        records,
      } : item?.unit,
    }
  })
}

function publicationLine(record, publicationPreference, githubState) {
  if (record?.plan?.action === 'pr_update') return 'Update the existing pull request'
  return contributionPath(record, publicationPreference, githubState) === 'mobius'
    ? 'Open as a legacy draft'
    : 'Open ready for review'
}

export function publicationRouteProblem(item, publicationPreference, githubState) {
  if (item?.kind === 'mark_ready') {
    return githubState === 'connected'
      ? ''
      : 'Reconnect GitHub in Möbius Settings → Accounts before requesting review for these drafts.'
  }
  if (item?.kind !== 'publish') return ''
  const records = item?.unit?.type === 'stack'
    ? stackPublicationRecords(item.unit)
    : runUnitRecords(item)
  const updating = records.length > 0 && records.every(
    record => record?.plan?.action === 'pr_update',
  )
  if (updating) {
    return githubState === 'connected'
      ? ''
      : 'Connect GitHub in Möbius Settings → Accounts before updating these pull requests.'
  }
  if (item?.unit?.type === 'stack') {
    const route = contributionStackDecision(
      records, publicationPreference, githubState,
    )
    if (route.error) return route.error
    if (route.method === 'mobius') {
      return 'Connect GitHub in Möbius Settings → Accounts to send this related group as your account.'
    }
    return ''
  }
  const record = runPrimaryRecord(item)
  const route = contributionPathDecision(record, publicationPreference, githubState)
  return route.error || ''
}

// A handler acknowledgement is not settlement. Only a canonical receipt for
// this frozen phase may turn a row green; unavailable evidence stays owned.
export function canonicalBatchRecordOutcome(record, current, mode) {
  if (!current || current.id !== record.id) return null
  const repo = record.plan?.repo || record.repo
  if ((current.plan?.repo || current.repo) !== repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) return null
  const frozenHead = record.plan?.head_sha
  const publishedHead = current.plan?.head_sha
  const exactHead = !frozenHead || publishedHead === frozenHead
  // Fork publication may normalize author metadata after validating the same
  // tree and reviewed diff. Its canonical patch names the original head; only
  // a matching published receipt can settle that transition, not the marker
  // or a handler acknowledgement alone. Review requests never rewrite heads.
  const normalizedPublication = mode === 'send'
    && /^[a-f0-9]{40}$/i.test(frozenHead || '')
    && /^[a-f0-9]{40}$/i.test(publishedHead || '')
    && current.plan?.attribution_normalized_from === frozenHead
    && current.head_sha === publishedHead
    && current.last_submit_push_sha === publishedHead
  if (!exactHead && !normalizedPublication) return null
  const number = Number(current.number)
  const publicIdentity = Number.isSafeInteger(number) && number > 0
    && current.url === `https://github.com/${repo}/pull/${number}`
    && (!record.number || number === Number(record.number))
  if ((mode === 'ready' || record.number) && !publicIdentity) return null

  // An old diagnostic on unchanged intent is not this attempt's outcome.
  // A later canonical version with a new diagnostic (or a new durable submit
  // attempt) can settle a failure; a claim still in flight cannot.
  const errorKey = mode === 'ready' ? 'last_ready_error' : 'last_submit_error'
  const error = current[errorKey]
  const before = Date.parse(record.updated_at || record.created_at || '')
  const after = Date.parse(current.updated_at || '')
  const started = Date.parse(current.submit_started_at || '')
  const code = current[`${errorKey}_code`]
  const newDiagnostic = error !== record[errorKey]
    || typeof code === 'string' && !!code && code !== record[`${errorKey}_code`]
  const newSubmitAttempt = mode === 'send' && started > before && after >= started
    && current.submit_started_at !== record.submit_started_at
  const failedStatus = mode === 'ready'
    ? current.status === 'draft' && !current.readying
    : current.status === 'prepared'
  // Stack publication uses its nested target and parent, not just the flat
  // plan. Missing or invalid descriptors cannot identify the frozen attempt.
  const frozenStack = stackMeta(record)
  const currentStack = stackMeta(current)
  const hasFrozenStack = Object.hasOwn(record.plan || {}, 'stack')
  const hasCurrentStack = Object.hasOwn(current.plan || {}, 'stack')
  const exactStack = hasFrozenStack === hasCurrentStack && (!hasFrozenStack || (
    frozenStack && currentStack
    && Object.hasOwn(record.plan.stack, 'parent_record_id') === Object.hasOwn(current.plan.stack, 'parent_record_id')
    && (!Object.hasOwn(record.plan.stack, 'parent_record_id') || typeof record.plan.stack.parent_record_id === 'string')
    && record.plan.stack.parent_record_id === current.plan.stack.parent_record_id
    && ['id', 'position', 'total', 'baseBranch', 'parentRecordId'].every(
      key => currentStack[key] === frozenStack[key],
    )
  ))
  const exactPublicationIntent = exactStack
    && (current.plan?.branch || current.branch || '') === (record.plan?.branch || record.branch || '')
    && ['action', 'branch', 'base_branch', 'base_sha'].every(
      key => current.plan?.[key] === record.plan?.[key],
    )
  if (failedStatus && exactHead && exactPublicationIntent && typeof error === 'string' && error.trim()
    && /^[a-f0-9]{40}$/i.test(record.plan?.head_sha || '')
    && after > before && (newDiagnostic || newSubmitAttempt)
    && !String(code || '').endsWith('unconfirmed')) {
    return { error }
  }
  // Publication may add a PR number, head repository and operational receipts,
  // but it does not change the approved destination. A result for another
  // branch, target or stack cannot settle this frozen action (even as closed).
  const targetBranch = frozenStack?.baseBranch || record.plan?.base_branch
  if (!publicIdentity || !exactPublicationIntent
    || targetBranch && current.last_submit_base_branch && current.last_submit_base_branch !== targetBranch) return null
  // A terminal public state is an observed outcome, not proof that this
  // ready/update action succeeded. Keep its label distinct from completion.
  if (['closed', 'merged'].includes(current.status)) return current.status
  if (mode === 'ready') return current.status === 'open' && !current.readying ? 'done' : null
  if (!['draft', 'open', 'landing'].includes(current.status)) return null
  if (record.plan?.action === 'pr_update' && current.last_submit_push_sha !== publishedHead) return null
  return 'done'
}

export function batchRecordOutcome(record, current, outcome, mode) {
  const canonical = canonicalBatchRecordOutcome(record, current, mode)
  if (canonical) return canonical
  if (outcome?.pending || outcome?.uncertain || outcome?.ok || outcome?.alreadyHandled
    || current?.status === 'submitting' || current?.readying) return 'checking'
  // Only the callback that owns preflight can certify no public dispatch.
  // A generic automatic failure or missing response remains uncertain.
  if (outcome?.notAttempted === true) return {
    notAttempted: true,
    error: outcome.error || 'Preflight could not complete. Review and confirm again when it recovers.',
  }
  if (!outcome?.failure || outcome.failure.owner === 'automatic') return 'checking'
  return { error: outcome.error || (contributionFailureOwner(outcome) === 'agent'
    ? 'Moved back to private preparation.' : 'Needs attention.') }
}

const PROGRESS_TEXT = {
  ready: { working: 'Requesting review…', checking: 'Checking result…', 'not-attempted': 'Not requested', closed: 'Pull request closed', merged: 'Merged', done: 'Review requested' },
  send: { working: 'Sending…', checking: 'Checking result…', 'not-attempted': 'Not sent', closed: 'Pull request closed', merged: 'Merged', done: 'Sent to GitHub' },
}

function ExactActionList({
  items,
  mode,
  publicationPreference,
  githubState,
  onSelect,
  progress = {},
}) {
  return (
    <ol className="co-run-approval-list">
      {items.flatMap(item => {
        const unit = item.unit || item
        const ordered = unit?.type === 'stack'
          ? sortStackRecords(runUnitRecords(item))
          : runUnitRecords(item)
        const publicationIds = new Set(
          mode === 'send' ? itemPublicationRecords(item).map(record => record.id) : [],
        )
        return ordered
          .filter(record => mode !== 'send' || publicationIds.has(record.id))
          .filter(record => mode !== 'ready' || (
            record?.status === 'draft' && record?.submission_mode !== 'mobius-bot'
          ))
          .map(record => {
            const meta = stackMeta(record)
            return (
              <li key={record.id}>
                <span>
                  <strong>{contributionTitle(record)}</strong>
                  <small>{record?.plan?.repo || record?.repo || 'Project'}</small>
                </span>
                <em className={progress[record.id]?.error ? 'is-failed' : progress[record.id] === 'done' ? 'is-done' : ''}>{progress[record.id]?.notAttempted ? `${PROGRESS_TEXT[mode]['not-attempted']}: ` : ''}{progress[record.id]?.error
                  || PROGRESS_TEXT[mode]?.[progress[record.id]]
                  || (mode === 'ready' ? 'Request review' : publicationLine(record, publicationPreference, githubState))}</em>
                {meta ? <code>{meta.baseBranch} → {record?.plan?.branch || record?.branch}</code> : null}
                {typeof onSelect === 'function' ? (
                  <button type="button" onClick={() => onSelect(item)}>Details</button>
                ) : null}
              </li>
            )
          })
      })}
    </ol>
  )
}

function ExactBatchAction({
  items,
  records,
  onOwnershipChange,
  mode,
  publicationPreference,
  githubState,
  onSend,
  onSendStack,
  onMarkReady,
  onSelect,
}) {
  const task = useProjectTask()
  const [approval, setApproval] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const safeRef = useRef(null)
  const descriptionId = useId()
  const fingerprint = useMemo(() => batchFingerprint(
    items, mode, publicationPreference, githubState,
  ), [items, mode, publicationPreference, githubState])
  // A confirmed batch stays on screen while it runs and until the owner closes
  // its results; each handled item changes the live set, which must not close it.
  const confirming = !!approval && (approval.locked || approval.fingerprint === fingerprint)
  const [progress, setProgress] = useState({})
  const [finished, setFinished] = useState(false)
  const admitted = useRef(false)
  const currentRecords = useRef(records)
  currentRecords.current = records
  const checking = Object.values(progress).some(value => value === 'checking')
  const activeItems = confirming ? approval.items : items
  const count = mode === 'ready' ? readyCount(activeItems) : actionCount(activeItems)
  const singleRecord = count === 1 ? runPrimaryRecord(activeItems[0]) : null

  useEffect(() => {
    if (confirming) safeRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (!approval || approval.locked || approval.fingerprint === fingerprint) return
    setApproval((mode === 'ready' ? readyCount(items) : actionCount(items)) > 0
      ? { fingerprint, items: captureBatchItems(items) } : null)
    setBusy(false)
    setNote('The reviewed set changed. The current actions are listed now; confirm this refreshed set when you are ready.')
  }, [approval, fingerprint, items, mode])

  useEffect(() => { onOwnershipChange?.(mode, !!approval) }, [mode, !!approval, onOwnershipChange])
  useEffect(() => {
    if (!approval?.locked) return
    const frozen = approval.items.flatMap(runUnitRecords)
    setProgress(old => {
      let next = old
      for (const record of frozen) if (old[record.id] === 'checking') {
        const canonical = canonicalBatchRecordOutcome(record, records.find(value => value.id === record.id), mode)
        if (canonical) {
          if (next === old) next = { ...old }
          next[record.id] = canonical
        }
      }
      return next
    })
  }, [approval, records, mode])

  if (count < 1 && !approval?.locked) return null

  function outcomeFor(record, outcome) {
    const current = currentRecords.current.find(value => value.id === record.id)
    const receipt = outcome?.records?.find(value => value.id === record.id)
      || (outcome?.record?.id === record.id ? outcome.record : null)
    // A delayed pending response must not shadow canonical evidence already read.
    return batchRecordOutcome(record, canonicalBatchRecordOutcome(record, current, mode)
      ? current : receipt || current, outcome, mode)
  }

  // Independent review requests can continue, but unconfirmed rows remain
  // observationally pending rather than borrowing another member's receipt.
  async function requestReview(item) {
    const records = sortStackRecords(runUnitRecords(item)).filter(record => (
      record?.status === 'draft' && record?.submission_mode !== 'mobius-bot'
    ))
    setProgress(old => ({ ...old, ...Object.fromEntries(records.map(record => [record.id, 'working'])) }))
    for (const record of records) {
      let outcome
      try { outcome = await onMarkReady?.(record) } catch { outcome = { uncertain: true } }
      const value = outcomeFor(record, outcome)
      setProgress(old => ({ ...old, [record.id]: value }))
      if (value?.error) {
        const remaining = records.slice(records.indexOf(record) + 1)
        setProgress(old => ({ ...old, ...Object.fromEntries(remaining.map(value => [value.id, 'not-attempted'])) }))
        return false
      }
    }
    return true
  }
  async function send(item) {
    const records = itemPublicationRecords(item)
    setProgress(old => ({ ...old, ...Object.fromEntries(records.map(record => [record.id, 'working'])) }))
    let outcome
    try {
      if (item?.unit?.type === 'stack') outcome = await onSendStack?.(runUnitRecords(item))
      else outcome = await onSend?.(runPrimaryRecord(item))
    } catch { outcome = { uncertain: true } }
    const values = records.map(record => [record.id, outcomeFor(record, outcome)])
    setProgress(old => ({ ...old, ...Object.fromEntries(values) }))
    return !values.some(([, value]) => value?.error)
  }

  async function applyAll() {
    if (admitted.current) return
    if (!approval || approval.fingerprint !== fingerprint) {
      setApproval({ fingerprint, items: captureBatchItems(items) })
      setNote('The reviewed set changed. The current actions are listed now; confirm this refreshed set when you are ready.')
      return
    }
    admitted.current = true
    const approvedItems = approval.items
    setApproval({ ...approval, locked: true })
    setBusy(true)
    setNote('')
    setProgress({})
    let results = []
    if (mode === 'ready') {
      const queue = [...approvedItems]
      const worker = async () => { while (queue.length) results.push(await requestReview(queue.shift())) }
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
    } else {
      for (const item of approvedItems) results.push(await send(item))
    }
    const failed = results.filter(ok => !ok).length
    setBusy(false)
    setFinished(true)
    setNote(failed ? `${failed} ${failed === 1 ? 'item needs' : 'items need'} attention.` : '')
  }
  function closeResults() {
    if (checking || busy) return
    admitted.current = false
    setApproval(null); setFinished(false); setProgress({}); setNote('')
    task?.close()
  }

  if (!confirming) {
    return (
      <section className={'co-run-primary is-' + mode}>
        <span className="co-run-primary-mark" aria-hidden="true">
          <Icon name={mode === 'ready' ? 'review' : 'send'} size={19} />
        </span>
        <div>
          <strong>{mode === 'ready'
            ? `${count === 1 ? 'Your draft is' : `${count} drafts are`} ready for review`
            : `${count} prepared ${count === 1 ? 'PR' : 'PRs'}`}</strong>
          <span className="co-visually-hidden">{mode === 'ready' ? 'Marking it ready for review does not merge it.' : 'Privately reviewed. Nothing shared yet.'}</span>
          {note ? <p className="co-run-error" role="status">{note}</p> : null}
        </div>
        <button
          type="button"
          className="co-btn co-btn-primary"
          onClick={() => {
            setNote('')
            task?.open(`task:${mode}`)
            setApproval({ fingerprint, items: captureBatchItems(items) })
          }}
        >
          {mode === 'ready' ? 'Mark ready for review' : count === 1 ? 'Review and send' : `Review and send ${count}`}
        </button>
      </section>
    )
  }

  return (
    <>
    {task ? <button className="co-local-summary" onClick={() => task.open(`task:${mode}`)}><Icon name={mode === 'ready' ? 'review' : 'send'} size={20} /><span><strong>{singleRecord?.number ? `#${singleRecord.number} ${mode === 'ready' ? 'ready for review' : 'ready to share'}` : `${count} ${mode === 'ready' ? 'ready for review' : 'ready to share'}`}</strong><small>{singleRecord?.title || (mode === 'ready' ? 'Review the exact request' : 'Review the exact public actions')}</small></span><Icon name="right" size={16} /></button> : null}
    <TaskPane id={`task:${mode}`}>
    <section
      className="co-run-approval"
      role="alertdialog"
      aria-label={mode === 'ready' ? 'Confirm requesting review' : 'Confirm reviewed contribution publication'}
      aria-describedby={descriptionId}
    >
      <header>
        <h3>{mode === 'ready'
          ? `Mark ${count === 1 ? 'this draft' : `${count} drafts`} ready for review?`
          : `Send ${count} reviewed ${count === 1 ? 'pull request' : 'pull requests'}?`}</h3>
        <p id={descriptionId}>{mode === 'ready'
          ? 'GitHub takes it out of draft and tells the reviewers. Nothing merges.'
          : 'New pull requests use your connected GitHub account and open ready for review. Each line shows exactly where its change goes. Nothing merges.'}</p>
      </header>
      <ExactActionList
        items={activeItems}
        mode={mode}
        publicationPreference={publicationPreference}
        githubState={githubState}
        progress={progress}
        onSelect={busy ? undefined : onSelect}
      />
      {note ? <p className="co-run-error" role="status">{note}</p> : null}
      {checking ? <p className="co-run-error" role="status">Checking the recorded result. Refresh Contribute to check it; nothing will be sent again from this confirmation.</p> : null}
      {finished ? <div className="co-run-approval-actions">
        <button type="button" className="co-btn co-btn-primary" disabled={checking} onClick={closeResults}>{checking ? 'Checking result…' : 'Done'}</button>
      </div> : <div className="co-run-approval-actions">
        <button ref={safeRef} type="button" className="co-btn" disabled={busy} onClick={() => setApproval(null)}>
          {mode === 'ready' ? (count === 1 ? 'Keep as draft' : 'Keep as drafts') : 'Keep private'}
        </button>
        <button type="button" className="co-btn co-btn-primary" disabled={busy} aria-busy={busy} onClick={applyAll}>
          {busy ? 'Working…' : mode === 'ready'
            ? (count === 1 ? 'Mark ready on GitHub' : `Mark ${count} ready on GitHub`)
            : (count === 1 ? 'Send to GitHub' : `Send ${count} to GitHub`)}
        </button>
      </div>}
    </section>
    </TaskPane>
    </>
  )
}

function IncomingAction({ item, onAssign }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function assign() {
    setBusy(true)
    setNote('')
    const outcome = await onAssign?.(item)
    if (!outcome?.ok) setNote(outcome?.error || 'Could not start this review.')
    setBusy(false)
  }
  return (
    <>
      <button type="button" className="co-run-row-action is-primary" disabled={busy} onClick={assign}>
        {busy ? 'Assigning…' : 'Assign & review'}
      </button>
      {note ? <small className="co-run-row-error" role="status">{note}</small> : null}
    </>
  )
}

const STATE_LABELS = {
  publish: 'Ready',
  mark_ready: 'Review draft',
  ready_attention: 'Review',
  route_attention: 'Choose route',
  public_attention: 'Needs you',
  private_review: 'Review',
  connecting: 'Finishing publication',
  incoming_review: 'Incoming',
  request: 'Review draft',
}

function decisionActionLabel(item) {
  return DECISION_ACTION_LABELS[item.kind] || 'Review'
}

const DECISION_ACTION_LABELS = {
  ready_attention: 'Review',
  route_attention: 'Choose',
  private_review: 'Review',
  request: 'Review',
}

function DecisionRow({
  item,
  onSelect,
  onAssignIncomingReview,
}) {
  return (
    <article className={'co-run-row is-' + item.kind}>
      <button type="button" className="co-run-row-main" onClick={() => onSelect?.(item)}>
        <ProjectIcon project={itemProject(item)} className="co-run-row-icon" />
        <span>
          <strong>{itemHeading(item)}</strong>
          <small>{item.detail}</small>
        </span>
      </button>
      {item.kind === 'incoming_review' ? (
        <IncomingAction item={item.item} onAssign={onAssignIncomingReview} />
      ) : (
        <button
          type="button"
          className="co-run-row-action"
          onClick={() => onSelect?.(item)}
        >
          {decisionActionLabel(item)}
        </button>
      )}
    </article>
  )
}

function activityRowItem(item) {
  if (item.kind !== 'autopilot' || runUnitRecords(item).some(isAutopilotResponding)) return item
  const record = runPrimaryRecord(item)
  return { ...item, detail: `Agent follow-up queued · ${record?.repo || record?.plan?.repo || item.project?.name || 'Project'}` }
}

function QuietRow({ item, onSelect, active = false }) {
  return (
    <button type="button" className="co-run-quiet-row" onClick={() => onSelect?.(item)}>
      {active ? <span className="co-working-icon"><Icon name={item.kind === 'review_in_progress' ? 'review' : 'refresh'} size={16} /></span> : <span className={'co-run-dot is-' + item.kind} aria-hidden="true" />}
      <span><strong>{itemHeading(item)}</strong><small>{item.detail}</small></span>
      <Icon name="right" size={14} />
    </button>
  )
}

function SourceChatChoices({ records, onFeedback }) {
  const [note, setNote] = useState('')
  const sources = []
  const seen = new Set()
  for (const record of records || []) {
    for (const chatId of [record?.chat_id, ...(record?.chat_ids || [])]) {
      if (!chatId || seen.has(chatId)) continue
      seen.add(chatId)
      sources.push({ chatId, record })
    }
  }
  const reviewChats = [...new Set((records || []).map(record => record.quality_review?.chat_id).filter(Boolean))]
  if ((sources.length === 0 && reviewChats.length === 0) || typeof onFeedback !== 'function') return null
  function open(source) {
    const outcome = onFeedback({ ...source.record, chat_id: source.chatId }) || {}
    if (!outcome.ok) setNote('Open Contribute inside Möbius to return to this source chat.')
  }
  return (
    <div className="co-run-source-choices">
      {reviewChats.map((chatId, index) => <button key={`review:${chatId}`} type="button" className="co-btn co-btn-sm" onClick={() => {
        const outcome = openAgentConversation(chatId)
        if (!outcome?.ok) setNote('Open Contribute inside Möbius to view this review conversation.')
      }}>{reviewChats.length === 1 ? 'Open review conversation' : `Open review conversation ${index + 1}`}</button>)}
      {sources.map((source, index) => (
        <button key={source.chatId} type="button" className="co-btn co-btn-sm" onClick={() => open(source)}>
          {sources.length === 1 ? 'Open source chat' : `Open source chat ${index + 1}`}
        </button>
      ))}
      {note ? <small className="co-run-error">{note}</small> : null}
    </div>
  )
}

function StackFocus({ item, reviewStatus, onReview, onFeedback, onRestore, onSetAutopilot, loadDiff }) {
  const records = sortStackRecords(runUnitRecords(item))
  const needsAnswer = record => record?.needs_attention === true || !!record?.attention?.title || !!record?.attention?.message || record?.quality_review?.state === 'changes_needed'
  const questions = records.filter(needsAnswer)
  const reviewAction = item.kind === 'private_review' ? progressReviewAction(records, reviewStatus) : null
  const [note, setNote] = useState('')
  function addressTogether() {
    const owner = records.find(record => record.quality_review?.chat_id || record.chat_id)
    if (!owner) { setNote('No source conversation is saved for this group. Open a contribution below for its available actions.'); return }
    const draft = ['Help me address these related contributions together. Treat each finding independently and preserve their dependency order.',
      ...records.map(record => `${record.id}: ${contributionTitle(record)}${record.attention?.message ? ` — ${record.attention.message}` : ''}`),
      'Resolve what you can safely, ask me about remaining decisions, and return updated results for each contribution. This does not approve any public action.',
    ].join('\n')
    const result = onFeedback?.({ ...owner, chat_id: owner.quality_review?.chat_id || owner.chat_id }, { draft })
    if (!result?.ok) setNote('The conversation could not open. Try the individual source conversation below.')
  }
  return <div className="co-focus-unit">
    <section className={'co-run-focus-summary is-' + item.kind}>
      <h3>{itemHeading(item)}</h3>
      <p className="co-group-count">1 group · {records.length} contributions{questions.length ? ` · ${questions.length} need attention` : ''}</p>
      <p>{item.detail}</p>
      {item.kind === 'route_attention' ? <p>Connect GitHub in Möbius Settings → Accounts to send this related group as your account.</p> : null}
      {reviewAction && onReview ? <button className="co-btn co-btn-primary" onClick={() => onReview(reviewAction)}>Review group</button> : null}
      {onFeedback ? <button className="co-btn co-btn-primary" onClick={addressTogether}>Address group in conversation</button> : null}
      {note ? <p role="status">{note}</p> : null}
    </section>
    <div className="co-group-members">{records.map(record => <details className="co-group-member" key={record.id}>
      <summary>{contributionTitle(record)}<span className="co-group-count"> · {needsAnswer(record) ? 'Needs attention' : record.status === 'prepared' ? (record.plan?.action === 'pr_update' ? 'Private PR revision' : 'Private proposal') : record.status}</span></summary>
      {record?.status === 'abandoned' || needsAnswer(record) ? <ContributionDecision rec={record} reviewState={reviewStateFor(record, reviewStatus)} onFeedback={onFeedback} onRestore={onRestore} /> : null}
      <ContributionCard rec={record} reviewState={reviewStateFor(record, reviewStatus)} onSetAutopilot={onSetAutopilot} loadDiff={loadDiff} initialExpanded showDecision={false} />
      <SourceChatChoices records={[record]} onFeedback={onFeedback} />
    </details>)}</div>
  </div>
}

function ReadyAttentionFocus({ item, onMarkReady, onFeedback }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const records = sortStackRecords(runUnitRecords(item))
  const record = item.record || records.find(row => row?.last_ready_error) || records[0]
  const retryable = new Set([
    'ready_not_applied', 'ready_lookup_failed', 'ready_failed',
    'ready_auto_merge_enabled',
  ]).has(String(record?.last_ready_error_code || ''))
  async function run() {
    setBusy(true)
    setNote('')
    const outcome = await onMarkReady?.(record)
    if (!(outcome?.ok || outcome?.pending || outcome?.alreadyHandled)) {
      setNote(outcome?.error || 'Could not request review for this pull request.')
    }
    setBusy(false)
  }
  return (
    <section className="co-run-focus-summary is-ready_attention">
      <small>Review stage needs attention</small>
      <h3>{itemHeading(item)}</h3>
      <p>{record?.last_ready_error || item.detail}</p>
      {retryable ? (
        <button type="button" className="co-btn co-btn-primary" disabled={busy} onClick={run}>
          {busy
            ? 'Working…'
            : record?.last_ready_error_code === 'ready_auto_merge_enabled'
              ? 'I turned off auto-merge. Mark ready again'
              : 'Mark ready for review again'}
        </button>
      ) : null}
      {record?.url ? <a className="co-review-link" href={record.url} target="_blank" rel="noopener noreferrer">Open pull request ↗</a> : null}
      <SourceChatChoices records={records} onFeedback={onFeedback} />
      {note ? <p className="co-run-error" role="status">{note}</p> : null}
    </section>
  )
}

function IncomingFocus({ item, onAssignIncomingReview }) {
  const pull = item?.item || {}
  return (
    <section className="co-run-focus-summary is-incoming_review">
      <small>Incoming review</small>
      <h3>{itemHeading(item)}</h3>
      <p>{item.detail}</p>
      <div className="co-run-focus-actions">
        <IncomingAction item={pull} onAssign={onAssignIncomingReview} />
        {pull.url ? <a className="co-btn co-btn-sm" href={pull.url} target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a> : null}
      </div>
    </section>
  )
}

function BatchOwnedFocus({ item, reviewStatus, onReview, onFeedback, onSetAutopilot, loadDiff }) {
  const record = runPrimaryRecord(item)
  if (!record) return null
  return (
    <div className="co-focus-unit">
      {item.kind === 'private_review' ? <ContributionDecision rec={record} reviewState={reviewStateFor(record, reviewStatus)} reviewAction={progressReviewAction(runUnitRecords(item), reviewStatus)} onReview={onReview} onFeedback={onFeedback} /> : null}
      <SourceChatChoices records={runUnitRecords(item)} onFeedback={onFeedback} />
      <ContributionCard
        rec={record}
        reviewState={reviewStateFor(record, reviewStatus)}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
        initialExpanded
        showDecision={false}
      />
    </div>
  )
}

export function FocusedItem({
  item,
  reviewStatus,
  onFeedback,
  onReview,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onMarkReady,
  onAssignIncomingReview,
  loadDiff,
}) {
  const records = runUnitRecords(item)
  if (item.kind === 'incoming_review') {
    return <IncomingFocus item={item} onAssignIncomingReview={onAssignIncomingReview} />
  }
  if (item.kind === 'ready_attention') {
    return <ReadyAttentionFocus item={item} onMarkReady={onMarkReady} onFeedback={onFeedback} />
  }
  if (item.kind === 'connecting') {
    const record = runPrimaryRecord(item)
    return (
      <div className="co-focus-unit">
        <section className="co-run-focus-summary is-connecting">
          <small>Finishing publication</small>
          <h3>{itemHeading(item)}</h3>
          <p>The reviewed app is already public. Contribute is attaching that identity to the same local app automatically; saved data and newer local work stay in place.</p>
        </section>
        {record ? (
          <ContributionCard
            rec={record}
            reviewState={reviewStateFor(record, reviewStatus)}
            onSetAutopilot={onSetAutopilot}
            loadDiff={loadDiff}
            initialExpanded
            showDecision={false}
          />
        ) : null}
      </div>
    )
  }
  if (item?.unit?.type === 'stack') {
    return (
      <StackFocus
        item={item}
        reviewStatus={reviewStatus}
        onFeedback={onFeedback}
        onReview={onReview}
        onRestore={onRestore}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
      />
    )
  }
  if (item.kind === 'route_attention') {
    return (
      <section className="co-run-focus-summary is-route_attention">
        <small>Choose a publication route</small>
        <h3>{itemHeading(item)}</h3>
        <p>{item.detail}</p>
        <p>Connect GitHub in Möbius Settings → Accounts, then come back to this Send batch.</p>
        <SourceChatChoices records={records} onFeedback={onFeedback} />
      </section>
    )
  }
  if (['publish', 'mark_ready', 'private_review'].includes(item.kind)) {
    return (
      <BatchOwnedFocus
        item={item}
        reviewStatus={reviewStatus}
        onFeedback={onFeedback}
        onReview={onReview}
        onRestore={onRestore}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
      />
    )
  }
  const record = runPrimaryRecord(item)
  if (!record) return null
  return (
    <div className="co-focus-unit">
      <ContributionDecision
        rec={record}
        reviewState={reviewStateFor(record, reviewStatus)}
        reviewAction={progressReviewAction([record], reviewStatus)}
        onFeedback={onFeedback}
        onReview={onReview}
        onDismiss={onDismiss}
        onRestore={onRestore}
        onWithdraw={onWithdraw}
      />
      <ContributionCard
        rec={record}
        reviewState={reviewStateFor(record, reviewStatus)}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
        initialExpanded
        showDecision={false}
      />
    </div>
  )
}

export function ContributionRun({
  run,
  loading,
  omittedCount = 0,
  publicationPreference = 'mobius',
  githubState = 'unknown',
  reviewStatus,
  onSend,
  onSendStack,
  onMarkReady,
  onFeedback,
  onReview,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onAssignIncomingReview,
  loadDiff,
  presentation = 'project',
  renderPublicWork,
  controls,
  projectProgress,
  reviewRequestCount = 0,
  edits = null,
  editsCount = null,
  defaultTab = 'all',
  projectName = 'project',
  selectedId = '',
  onSelect,
  onBack,
  focusTarget,
  focusReady,
  onFocusConsumed,
  onOpenPull = null,
}) {
  const task = useProjectTask()
  const [missingTarget, setMissingTarget] = useState(false)
  const [batchOwnership, setBatchOwnership] = useState({})
  const changeBatchOwnership = useCallback((mode, owned) => setBatchOwnership(old => old[mode] === owned ? old : { ...old, [mode]: owned }), [])
  const projectedDecisions = useMemo(() => (run?.decisions || []).map((item) => {
    const problem = publicationRouteProblem(
      item, publicationPreference, githubState,
    )
    if (!problem) return item
    return {
      ...item,
      kind: 'route_attention',
      detail: problem,
    }
  }), [run?.decisions, publicationPreference, githubState])
  const allItems = useMemo(() => [
    ...projectedDecisions,
    ...(run?.working || []),
    ...(run?.recent || []),
    ...(run?.archive || []),
  ], [projectedDecisions, run?.working, run?.recent, run?.archive])
  const selected = allItems.find(item => item.id === selectedId) || null

  useEffect(() => {
    if (!focusTarget || !focusReady) return
    setMissingTarget(false)
    if (focusTarget.queue) onBack?.()
    else {
      const found = findRunItemByRecord(run, focusTarget.recordId)
      if (found) onSelect?.(found.item.id)
      else setMissingTarget(true)
    }
    onFocusConsumed?.(focusTarget.nonce)
  }, [focusTarget, focusReady, run, onFocusConsumed])

  function selectRunItem(item) { onSelect?.(item.id) }

  // Feedback on a published PR reads best on the PR page itself; anything
  // without a PR behind it keeps its saved decision card.
  function openAttentionItem(item) {
    const target = feedbackPull(item)
    if (target && onOpenPull) onOpenPull(target)
    else selectRunItem(item)
  }


  const decisions = projectedDecisions
  const privateItems = decisions.filter(item => item.kind === 'private_review' && !isPublicFeedback(item))
  const working = run?.working || []
  const visibleWorking = renderPublicWork ? working.filter(item => {
    return !runUnitRecords(item).every(record => record?.type === 'pr' && ['open', 'draft'].includes(record.status)
      && task?.publicKeys?.has(`${(record.repo || record.plan?.repo || '').toLowerCase()}#${record.number}`))
  }) : working
  // An open issue/PR is inventory, not evidence that an agent is working.
  const agentActivity = visibleWorking.filter(item => ['review_in_progress', 'autopilot'].includes(item.kind))
  const actionsInProgress = visibleWorking.filter(item => ['publishing', 'connecting'].includes(item.kind))
  const sharedItems = visibleWorking.filter(item => !['review_in_progress', 'autopilot', 'publishing', 'connecting'].includes(item.kind))
  const issues = sharedItems.filter(item => runUnitRecords(item).some(record => record?.type === 'issue'))
  const otherShared = sharedItems.filter(item => !issues.includes(item))
  const history = [...(run?.recent || []), ...(run?.archive || [])]
  const publishItems = decisions.filter(item => item.kind === 'publish')
  const readyItems = decisions.filter(item => item.kind === 'mark_ready')
  const ownerDecisions = attentionListItems(decisions)
  const preparedItems = [...privateItems, ...decisions.filter(item => item.kind === 'request')]

  // What needs the owner opens by itself; it can still be folded away.
  const needsYou = presentation === 'project'
    ? <AttentionList items={ownerDecisions} heading={itemHeading} onSelect={openAttentionItem} />
    : null

  const missingSelection = selectedId && !selectedId.startsWith('task:') && !selected
  const focus = (selected || missingTarget || missingSelection) ? (
      <TaskPane id={selectedId} dock={false}>
        <div className="co-run-focus-layout">
          <div className="co-run-focus-detail">
        {missingTarget || missingSelection ? (
          <div className="co-run-empty">
            <Icon name="cycle" size={20} />
            <strong>This contribution moved</strong>
            <span>The current run no longer contains that exact record. Refresh or return to its source chat.</span>
          </div>
        ) : (
          <FocusedItem
            item={selected}
            reviewStatus={reviewStatus}
            onFeedback={onFeedback}
            onReview={onReview}
            onDismiss={onDismiss}
            onRestore={onRestore}
            onSetAutopilot={onSetAutopilot}
            onWithdraw={onWithdraw}
            onMarkReady={onMarkReady}
            onAssignIncomingReview={onAssignIncomingReview}
            loadDiff={loadDiff}
          />
        )}
          </div>
        </div>
      </TaskPane>
    ) : null

  const fold = ([items, title]) => items.length ? (
    <details key={title} className="co-run-fold" aria-label={title}>
      <summary><span>{title}</span><b>{items.length}</b><Icon name="chevron" size={14} /></summary>
      <div>{items.map(item => <QuietRow key={item.id} item={activityRowItem(item)} active={item.kind === 'review_in_progress' || actionsInProgress.includes(item) || runUnitRecords(item).some(isAutopilotResponding)} onSelect={selectRunItem} />)}</div>
    </details>
  ) : null
  // All PRs keeps saved public work the live list does not show.
  const inventory = <>{[[issues, 'Issues'], [otherShared, 'Shared work']].map(fold)}</>
  // My work: agent jobs (above the PR list's agent reviews), then agent
  // activity and finished work, out of the PR list's way.
  const myWork = <>
    {[[agentActivity, 'Agent activity'], [actionsInProgress, 'Actions in progress']].map(fold)}
    {history.length > 0 ? (
      <details className="co-run-fold is-recent">
        <summary><span>Finished and closed work</span><b>{history.length}</b><Icon name="chevron" size={14} /></summary>
        <p className="co-inventory-note">Recorded outcomes and dismissed proposals, including closed, local-only, and superseded work. Not all were merged.</p>
        <div>{history.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
      </details>
    ) : null}
  </>

  const currentBatchRecords = useMemo(() => allItems.flatMap(runUnitRecords), [allItems])
  if (presentation === 'overview' && !actionCount(publishItems) && !readyCount(readyItems) && !omittedCount && !Object.values(batchOwnership).some(Boolean)) return null

  return (
    <section className="co-run" aria-label="Contributions">
      {focus}
      {!actionCount(publishItems) && !batchOwnership.send ? <TaskPane id="task:send"><h3>Publication status</h3><p>No reviewed changes are waiting to send. Your contributions below show their current public or private status.</p><button className="co-btn co-btn-primary" onClick={() => task?.close()}>Review public contributions</button></TaskPane> : null}
      {!readyCount(readyItems) && !batchOwnership.ready ? <TaskPane id="task:ready"><h3>Review status</h3><p>No drafts are waiting for a review request. Check your public contributions for their current state.</p><button className="co-btn" onClick={() => task?.close()}>View public contributions</button></TaskPane> : null}
      {/* What needs the owner comes first, in one box that disappears when
          there is nothing to act on; the project's status sits under it. */}
      <div className="co-decisions" aria-label="Ready for you">
      {needsYou}
      <ExactBatchAction
        key="send"
        records={currentBatchRecords}
        onOwnershipChange={changeBatchOwnership}
        items={publishItems}
        mode="send"
        publicationPreference={publicationPreference}
        githubState={githubState}
        onSend={onSend}
        onSendStack={onSendStack}
        onSelect={selectRunItem}
      />

      <ExactBatchAction
        key="ready"
        records={currentBatchRecords}
        onOwnershipChange={changeBatchOwnership}
        items={readyItems}
        mode="ready"
        publicationPreference={publicationPreference}
        githubState={githubState}
        onMarkReady={onMarkReady}
        onSelect={selectRunItem}
      />
      {presentation === 'project' && preparedItems.length ? <details className="co-run-fold co-prepared-work" aria-label="Prepared work">
        <summary><span>Prepared work</span><b>{preparedItems.length}</b><Icon name="chevron" size={14} /></summary>
        <div className="co-run-list">{preparedItems.map(item => <DecisionRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
      </details> : null}
      </div>
      {presentation === 'project' ? controls : null}

      {presentation === 'project' ? <ProjectTabs reviewCount={reviewRequestCount} renderPullRequests={renderPublicWork} inventory={inventory} myJobs={projectProgress} myWork={myWork} edits={edits} editsCount={editsCount} defaultTab={defaultTab} /> : null}
      {presentation !== 'project' ? renderPublicWork?.() : null}
      {omittedCount > 0 ? <p className="co-run-maintenance">{omittedCount} contribution records could not be shown.</p> : null}
    </section>
  )
}
