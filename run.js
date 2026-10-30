import {
  actionableSourceProjects,
  projectNeedsSorting,
  projectReadyToPrepare,
  projectStatus,
} from './source-map.js'
import { groupRecords, timeAgo } from './domain.js'
import {
  contributionScopeHash,
  hasAttentionSignal,
  organizePrivateWorkAction,
  partitionReviewUnits,
  qualityReviewFor,
} from './review.js'
import {
  groupContributionUnits,
  preparedContributionUnits,
  publicContributionUnits,
  sortStackRecords,
  stackMeta,
  stackReadiness,
} from './stack.js'
import {
  canAgentHandleAttention,
  isActionableAttention,
  isAutopilotResponding,
  needsHuman,
} from './autopilot.js'

const REQUEST_TYPES = new Set(['issue', 'issue_comment', 'discussion_comment'])

// Ownership and capability are separate. Unknown attention remains a human
// decision, while a known agent-handleable event belongs to the one private
// run even when autopilot has not been granted for that pull request.
function requiresHumanAttention(record) {
  return needsHuman(record) || (
    hasAttentionSignal(record) && !canAgentHandleAttention(record)
  )
}

function needsPrivateAttention(record) {
  return hasAttentionSignal(record) &&
    canAgentHandleAttention(record) &&
    !(isAutopilotResponding(record) || isActionableAttention(record))
}

// Feedback on a published pull request still belongs to the private run (the
// Prepare agent picks it up), but for the owner it is news, not a draft. Only
// the record the attention is about decides: a published sibling in the same
// group does not turn a private child's review into public feedback.
export const isPublicFeedback = item => item.kind === 'private_review'
  && ['open', 'draft'].includes(item.record?.status)
  && hasAttentionSignal(item.record)

// Decisions that wait on the owner: the project's Needs you, Mark ready and
// Send rows. Private review work and requests belong to Prepared work.
export function ownerAttentionCount(decisions = []) {
  return decisions.filter(item => isPublicFeedback(item) || !['private_review', 'request'].includes(item.kind)).length
}

export function runUnitRecords(value) {
  const unit = value?.unit || value
  if (Array.isArray(unit?.records)) return unit.records.filter(Boolean)
  const record = value?.record || unit?.record
  return record ? [record] : []
}

export function runPrimaryRecord(value) {
  return value?.record || value?.unit?.record
    || runUnitRecords(value)[0] || null
}

export function runUnitKey(value) {
  if (value?.id) return String(value.id)
  const unit = value?.unit || value
  const record = runPrimaryRecord(value)
  return `${unit?.type || 'record'}:${unit?.id || record?.id || 'unknown'}`
}

export function contributionTitle(record, title = record?.plan?.title || record?.title || record?.summary || 'Untitled contribution') {
  const number = Number(record?.number || record?.pr_number || record?.plan?.pr_number || 0)
  const kind = String(record?.type || '').toLowerCase()
  const action = String(record?.plan?.action || '').toLowerCase()
  const publicPullRequest = number > 0 && (['pr', 'pull_request'].includes(kind) || ['pr', 'pr_update'].includes(action))
  return publicPullRequest && !String(title).startsWith(`#${number}`) ? `#${number} ${title}` : title
}

function recordRepo(record) {
  return record?.plan?.repo || record?.repo || 'Other'
}

function unitTitle(unit) {
  return unit?.type === 'stack'
    ? (unit.name || 'Related pull requests')
    : contributionTitle(runPrimaryRecord(unit))
}

function unitRepo(unit) {
  return recordRepo(runPrimaryRecord(unit))
}

function projectIndex(projects) {
  const byRepo = new Map()
  for (const project of projects || []) {
    const repo = String(project?.canonical_repo || '').toLowerCase()
    if (repo) byRepo.set(repo, project)
  }
  return byRepo
}

function projectForUnit(unit, byRepo) {
  return byRepo.get(String(unitRepo(unit)).toLowerCase()) || null
}

function decision(kind, unit, byRepo, extra = {}) {
  const records = runUnitRecords(unit)
  const record = extra.record || records.find(row => row?.needs_attention) || records[0] || null
  return {
    id: `${kind}:${runUnitKey(unit)}`,
    kind,
    unit,
    record,
    project: projectForUnit(unit, byRepo),
    label: unitTitle(unit),
    detail: unitRepo(unit),
    ...extra,
  }
}

function revisionHash(values) {
  return contributionScopeHash([...values].sort().join('\u0001'))
}

function recordRevisionPart(record) {
  const stack = stackMeta(record)
  return [
    record?.id,
    record?.status,
    record?.updated_at,
    record?.url,
    record?.number,
    record?.submission_mode,
    record?.needs_attention ? 'attention' : '',
    record?.attention?.type,
    record?.attention?.key,
    record?.attention?.message,
    record?.autopilot?.enabled ? 'autopilot-on' : '',
    record?.autopilot?.state,
    record?.readying ? 'readying' : '',
    record?.last_ready_error_code,
    record?.last_ready_error,
    record?.last_submit_error,
    record?.last_submit_push_sha,
    record?.publication_connection?.status,
    record?.quality_review?.state,
    record?.quality_review?.reviewed_head_sha,
    record?.plan?.action,
    record?.plan?.repo,
    record?.plan?.branch,
    record?.plan?.head_sha,
    stack?.id,
    stack?.position,
    stack?.total,
    stack?.baseBranch,
    stack?.parentRecordId,
    record?.chat_id,
    ...(record?.chat_ids || []).map(value => `chat:${value}`).sort(),
  ].map(value => String(value || '')).join('\u0002')
}

function runRevision({ decisions, working, recent, archive, projects, privateAction }) {
  const values = []
  for (const [section, items] of Object.entries({ decisions, working, recent, archive })) {
    for (const item of items || []) {
      values.push([
        section,
        item?.id,
        item?.kind,
        item?.label,
        item?.detail,
        runUnitRecords(item).map(recordRevisionPart).sort().join('\u0003'),
        item?.action?.event,
        item?.action?.revision,
        item?.action?.scope,
        item?.action?.draft,
      ].map(value => String(value || '')).join('\u0000'))
    }
  }
  for (const row of projects || []) {
    values.push([
      'project', row?.id, row?.kind, row?.label, row?.detail,
    ].map(value => String(value || '')).join('\u0000'))
  }
  if (privateAction) {
    values.push([
      'private', privateAction.event, privateAction.revision,
      privateAction.scope, privateAction.count, privateAction.draft,
    ].map(value => String(value || '')).join('\u0000'))
  }
  return revisionHash(values)
}

function projectRows(projects) {
  return (projects || []).map((project) => {
    const status = projectStatus(project)
    const incoming = Number(project?.incomingFiles || 0)
    const outgoing = Number(project?.outgoingFiles || 0)
    const attention = [
      ...(project?.contributions || []),
      ...(project?.issues || []),
    ].some(record => record?.needs_attention)
    let kind = 'current'
    if (projectReadyToPrepare(project)) kind = 'prepare'
    else if (projectNeedsSorting(project)) kind = 'sort'
    else if (incoming > 0 && outgoing === 0) kind = 'align'
    else if (attention) kind = 'sort'
    return {
      id: `project:${project?.key || project?.canonical_repo || project?.name}`,
      kind,
      project,
      label: project?.name || project?.canonical_repo || 'Project',
      detail: status?.label || project?.summary || 'Current',
    }
  })
}

function awaitingAppConnection(record) {
  if (record?.status !== 'merged') return false
  if (record?.plan?.after_merge?.action !== 'connect_app') return false
  return !['connected', 'connected_conflict'].includes(record?.publication_connection?.status)
}

function settledRecords(records) {
  return (records || [])
    .filter(record => ![
      'prepared', 'submitting', 'landing', 'draft', 'open', 'abandoned',
    ].includes(record?.status))
    .filter(record => !awaitingAppConnection(record))
    .sort((left, right) => String(right?.updated_at || right?.created_at || '').localeCompare(
      String(left?.updated_at || left?.created_at || ''),
    ))
}

function unitLatestRecord(unit) {
  return [...runUnitRecords(unit)].sort((left, right) => (
    String(right?.updated_at || right?.created_at || '').localeCompare(
      String(left?.updated_at || left?.created_at || ''),
    )
  ))[0] || null
}

function terminalRunItem(unit, byRepo, kind) {
  const record = unitLatestRecord(unit)
  const records = runUnitRecords(unit)
  const accepted = records.length > 0 && records.every(row => row?.status === 'merged')
  return {
    id: `${kind}:${runUnitKey(unit)}`,
    kind,
    unit,
    record,
    project: projectForUnit(unit, byRepo),
    label: unitTitle(unit),
    detail: [
      accepted ? 'Accepted' : 'Closed',
      timeAgo(record?.updated_at || record?.created_at),
    ].filter(Boolean).join(' · '),
  }
}

/**
 * One read-only projection of the current contribution snapshot.
 *
 * The ledger remains the source of truth; the Run stores no parallel stage or
 * queue state. Each active record appears exactly once in Decisions or Working,
 * while a bounded terminal tail appears in Recent.
 */
export function buildContributionRun({
  records = [],
  reviewStatus = { byId: {} },
  projects = [],
  incomingReviews = [],
  recentLimit = 12,
} = {}) {
  const safeRecords = (Array.isArray(records) ? records : []).filter(Boolean)
  const safeProjects = (Array.isArray(projects) ? projects : []).filter(Boolean)
  const byRepo = projectIndex(safeProjects)
  const prRecords = safeRecords.filter(record => record?.type === 'pr')
  const requests = safeRecords.filter(record => REQUEST_TYPES.has(record?.type))
  const prGroups = groupRecords(prRecords)
  const connectionRecords = safeRecords.filter(awaitingAppConnection)
  const connectionStackIds = new Set(
    connectionRecords.map(stackMeta).filter(Boolean).map(meta => meta.id),
  )
  const connectionUnits = [
    ...groupContributionUnits(prRecords.filter(record => {
      const meta = stackMeta(record)
      return meta && connectionStackIds.has(meta.id)
    })).filter(unit => unit?.type === 'stack'),
    ...connectionRecords.filter(record => !stackMeta(record)).map(record => ({
      type: 'record', id: record.id, record, records: [record],
    })),
  ]
  const readyUnits = preparedContributionUnits(prGroups.ready, prRecords).map((unit) => {
    if (unit?.type !== 'stack') return unit
    const recordsInStack = prRecords.filter(record => stackMeta(record)?.id === unit.id)
    return recordsInStack.length > 0
      ? { ...unit, records: sortStackRecords(recordsInStack) }
      : unit
  }).filter(unit => !(unit?.type === 'stack' && connectionStackIds.has(unit.id)))
  const structurallyBlocked = []
  const failedSubmitUnits = []
  const reviewableUnits = []
  for (const unit of readyUnits) {
    const submitFailure = runUnitRecords(unit).find(record => (
      record?.status === 'prepared' && record?.last_submit_error
    ))
    if (submitFailure) {
      failedSubmitUnits.push({ unit, message: submitFailure.last_submit_error })
      continue
    }
    const readiness = unit?.type === 'stack' ? stackReadiness(unit) : { ok: true }
    if (readiness.ok) reviewableUnits.push(unit)
    else structurallyBlocked.push({ unit, readiness })
  }
  const partition = partitionReviewUnits(reviewableUnits, reviewStatus)
  const preparedStackIds = new Set(
    readyUnits.filter(unit => unit?.type === 'stack').map(unit => unit.id),
  )
  const publicUnits = publicContributionUnits(prGroups.open, prRecords)
    .filter(unit => !(unit?.type === 'stack' && preparedStackIds.has(unit.id)))
    .filter(unit => !(unit?.type === 'stack' && connectionStackIds.has(unit.id)))
  const activeStackIds = new Set([
    ...preparedStackIds,
    ...connectionStackIds,
    ...publicUnits.filter(unit => unit?.type === 'stack').map(unit => unit.id),
  ])
  const decisions = []
  const working = []

  for (const unit of partition.readyToSend) {
    decisions.push(decision('publish', unit, byRepo, {
      detail: unit?.type === 'stack'
        ? `${unit.records.filter(record => record.status === 'prepared').length} reviewed pull requests · ${unitRepo(unit)}`
        : `Reviewed · ${unitRepo(unit)}`,
    }))
  }

  for (const unit of publicUnits) {
    const recordsInUnit = runUnitRecords(unit)
    const active = recordsInUnit.filter(record => ['submitting', 'landing', 'draft', 'open'].includes(record?.status))
    if (active.some(record => record?.readying)) {
      working.push(decision('publishing', unit, byRepo, {
        detail: `Confirming review stage · ${unitRepo(unit)}`,
      }))
      continue
    }
    const readyFailure = active.find(record => (
      record?.status === 'draft'
      && record?.submission_mode !== 'mobius-bot'
      && record?.last_ready_error
    ))
    if (readyFailure) {
      decisions.push(decision('ready_attention', unit, byRepo, {
        record: readyFailure,
        label: unitTitle(unit),
        detail: readyFailure.last_ready_error,
      }))
      continue
    }
    const human = active.find(requiresHumanAttention)
    if (human) {
      decisions.push(decision('public_attention', unit, byRepo, {
        record: human,
        label: contributionTitle(human),
        detail: human?.attention?.message || `Public follow-up · ${recordRepo(human)}`,
      }))
      continue
    }
    const privateAttention = active.find(needsPrivateAttention)
    if (privateAttention) {
      decisions.push(decision('private_review', unit, byRepo, {
        record: privateAttention,
        label: unitTitle(unit),
        detail: privateAttention?.attention?.message || `Private follow-up · ${recordRepo(privateAttention)}`,
      }))
      continue
    }
    const personalDrafts = active.filter(record => (
      record?.status === 'draft' && record?.submission_mode !== 'mobius-bot'
    ))
    if (personalDrafts.length > 0) {
      decisions.push(decision('mark_ready', unit, byRepo, {
        record: personalDrafts[0],
        label: unitTitle(unit),
        detail: `${personalDrafts.length === 1 ? 'Draft ready to mark ready for review' : `${personalDrafts.length} drafts ready to mark ready for review`} · ${unitRepo(unit)}`,
      }))
      continue
    }
    if (active.some(record => ['submitting', 'landing'].includes(record?.status))) {
      working.push(decision('publishing', unit, byRepo, {
        detail: `Public action in progress · ${unitRepo(unit)}`,
      }))
      continue
    }
    if (active.some(record => isAutopilotResponding(record) || isActionableAttention(record))) {
      working.push(decision('autopilot', unit, byRepo, {
        detail: `Agent handling public follow-up · ${unitRepo(unit)}`,
      }))
      continue
    }
    working.push(decision('public', unit, byRepo, {
      detail: `${active.some(record => record.status === 'draft') ? 'Draft on GitHub' : 'Open on GitHub'} · ${unitRepo(unit)}`,
    }))
  }

  for (const unit of partition.needsAttention) {
    const recordsInUnit = runUnitRecords(unit)
    const human = recordsInUnit.find(requiresHumanAttention)
    if (human) {
      decisions.push(decision('public_attention', unit, byRepo, {
        record: human,
        label: contributionTitle(human),
        detail: human?.attention?.message || `Your input is needed · ${recordRepo(human)}`,
      }))
    } else {
      decisions.push(decision('private_review', unit, byRepo, {
        detail: `${recordsInUnit.some(record => qualityReviewFor(record).state === 'changes_needed') ? 'Private fixes needed' : 'Private review needed'} · ${unitRepo(unit)}`,
      }))
    }
  }
  for (const unit of partition.needsReview) {
    decisions.push(decision('private_review', unit, byRepo, {
      detail: `Private review needed · ${unitRepo(unit)}`,
    }))
  }
  for (const { unit, readiness } of structurallyBlocked) {
    decisions.push(decision('private_review', unit, byRepo, {
      detail: `${readiness.message || 'This pull-request chain needs repair.'} · ${unitRepo(unit)}`,
    }))
  }
  for (const { unit, message } of failedSubmitUnits) {
    decisions.push(decision('private_review', unit, byRepo, {
      detail: `${message || 'The earlier public result needs reconciliation.'} · ${unitRepo(unit)}`,
    }))
  }
  for (const unit of partition.reviewing) {
    working.push(decision('review_in_progress', unit, byRepo, {
      detail: `Private review in progress · ${unitRepo(unit)}`,
    }))
  }

  for (const unit of connectionUnits) {
    const record = runUnitRecords(unit).find(awaitingAppConnection)
    working.push(decision('connecting', unit, byRepo, {
      record,
      label: contributionTitle(record),
      detail: `Finishing the local publication link · ${recordRepo(record)}`,
    }))
  }

  for (const item of Array.isArray(incomingReviews) ? incomingReviews : []) {
    const repo = item?.repository?.nameWithOwner || ''
    decisions.push({
      id: `incoming:${item?.url || `${repo}#${item?.number || ''}`}`,
      kind: 'incoming_review',
      item,
      project: byRepo.get(String(repo).toLowerCase()) || null,
      label: item?.title || 'Incoming pull request',
      detail: `${repo}${item?.number ? ` #${item.number}` : ''}`.trim(),
    })
  }

  for (const record of requests) {
    const unit = { type: 'record', id: record.id, record, records: [record] }
    if (record.status === 'prepared') {
      decisions.push(decision('request', unit, byRepo, {
        record,
        detail: `Draft ${record.type === 'issue' ? 'issue' : 'reply'} · ${recordRepo(record)}`,
      }))
    } else if (['submitting', 'draft', 'open'].includes(record.status)) {
      working.push(decision('public', unit, byRepo, {
        record,
        detail: `${record.status === 'submitting' ? 'Publishing' : 'Public'} · ${recordRepo(record)}`,
      }))
    }
  }

  const recent = groupContributionUnits(settledRecords(safeRecords).filter(record => {
    const meta = stackMeta(record)
    return !meta || !activeStackIds.has(meta.id)
  }))
    .sort((left, right) => String(
      unitLatestRecord(right)?.updated_at || unitLatestRecord(right)?.created_at || '',
    ).localeCompare(String(
      unitLatestRecord(left)?.updated_at || unitLatestRecord(left)?.created_at || '',
    )))
    .slice(0, Math.max(0, Number(recentLimit) || 0))
    .map(unit => terminalRunItem(unit, byRepo, 'recent'))
  const archive = groupContributionUnits(
    safeRecords.filter(record => {
      if (record?.status !== 'abandoned') return false
      const meta = stackMeta(record)
      return !meta || !activeStackIds.has(meta.id)
    }),
  )
    .sort((left, right) => String(
      unitLatestRecord(right)?.updated_at || unitLatestRecord(right)?.created_at || '',
    ).localeCompare(String(
      unitLatestRecord(left)?.updated_at || unitLatestRecord(left)?.created_at || '',
    )))
    .map(unit => terminalRunItem(unit, byRepo, 'archived'))
  const projectProjection = projectRows(safeProjects)
  const repairReasons = new Map()
  for (const { unit, readiness } of structurallyBlocked) {
    for (const record of runUnitRecords(unit)) {
      repairReasons.set(record.id, readiness.message || 'This pull-request chain needs repair.')
    }
  }
  for (const { unit, message } of failedSubmitUnits) {
    for (const record of runUnitRecords(unit)) {
      repairReasons.set(record.id, message || 'The earlier public result needs reconciliation.')
    }
  }
  const privateRecords = prRecords
    .filter(record => repairReasons.has(record.id)
      || (!requiresHumanAttention(record)
        && !(isAutopilotResponding(record) || isActionableAttention(record))))
    .map(record => repairReasons.has(record.id) ? {
      ...record,
      needs_attention: true,
      attention: {
        ...(record.attention || {}),
        key: `private-repair:${record.id}:${record?.plan?.head_sha || ''}`,
        type: 'private_repair',
        message: repairReasons.get(record.id),
      },
    } : record)
  const privateAction = organizePrivateWorkAction(
    privateRecords,
    reviewStatus,
    actionableSourceProjects(safeProjects),
  )

  const uniqueDecisions = [...new Map(decisions.map(item => [item.id, item])).values()]
  const result = {
    privateAction,
    decisions: uniqueDecisions,
    working,
    recent,
    archive,
    projects: projectProjection,
  }
  return { revision: runRevision(result), ...result }
}

export function findRunItemByRecord(run, recordId) {
  const wanted = String(recordId || '')
  if (!wanted) return null
  for (const section of ['decisions', 'working', 'recent', 'archive']) {
    const item = (run?.[section] || []).find(candidate => (
      runUnitRecords(candidate).some(record => record?.id === wanted)
    ))
    if (item) return { section, item }
  }
  return null
}
