// Pure helpers for the Ready-for-review validity layer. The platform returns
// one local, read-only verdict per prepared record. Send still performs its
// own authoritative validation; this layer makes invalidated work visible
// before the user attempts to submit it.

import { projectWorkRevision } from './source-map.js'

function stableApprovalValue(value) {
  if (Array.isArray(value)) return value.map(stableApprovalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key, stableApprovalValue(value[key]),
  ]))
}

// Public approval belongs to the exact durable action the owner saw, not just
// to a record id. Keep the projection narrower than transient UI state, but
// include every fact that can change the target, code, public text, or action.
export function contributionApprovalFingerprint(record) {
  if (!record || typeof record !== 'object') return ''
  return JSON.stringify(stableApprovalValue({
    id: record.id,
    type: record.type,
    status: record.status,
    revision: record.revision,
    updated_at: record.updated_at,
    repo: record.repo,
    title: record.title,
    summary: record.summary,
    url: record.url,
    number: record.number,
    branch: record.branch,
    head_repository: record.head_repository,
    submission_mode: record.submission_mode,
    relay_contribution_id: record.relay_contribution_id,
    last_submit_push_sha: record.last_submit_push_sha,
    last_submit_error: record.last_submit_error,
    needs_attention: record.needs_attention === true,
    attention: record.attention || null,
    readying: record.readying || null,
    last_ready_error_code: record.last_ready_error_code,
    plan: record.plan || null,
    quality_review: record.quality_review || null,
  }))
}

export function contributionApprovalIsCurrent(approved, current) {
  const approvedFingerprint = contributionApprovalFingerprint(approved)
  return !!approvedFingerprint && approvedFingerprint === contributionApprovalFingerprint(current)
}

export function contributionPhaseApprovalIsCurrent(approvedRecords, currentRecords) {
  if (!Array.isArray(approvedRecords) || !Array.isArray(currentRecords)) return false
  return approvedRecords.length > 0
    && approvedRecords.length === currentRecords.length
    && currentRecords.every((current, index) => (
      current?.id === approvedRecords[index]?.id
      && contributionApprovalIsCurrent(approvedRecords[index], current)
    ))
}

export function contributionScopeHash(input) {
  let hash = 0xcbf29ce484222325n
  const value = String(input || '')
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function indexReviewStatus(payload) {
  const byId = {}
  const rows = Array.isArray(payload?.records) ? payload.records : []
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id) continue
    if (row.state !== 'ready' && row.state !== 'needs_refresh') continue
    byId[row.id] = {
      state: row.state,
      code: typeof row.code === 'string' ? row.code : '',
      message: typeof row.message === 'string' ? row.message : '',
    }
  }
  return {
    state: 'ready',
    byId,
    checkedAt: typeof payload?.generated_at === 'string'
      ? payload.generated_at
      : '',
    // Which records the server checked directly; an older server omits it.
    addressed: Array.isArray(payload?.addressed_record_ids)
      ? payload.addressed_record_ids.filter(id => typeof id === 'string')
      : null,
  }
}

// The verdict is the platform's to give. This used to override a local-ready
// verdict by regex-matching `last_submit_error` for an upstream conflict,
// because the read-only status endpoint genuinely could not see one. It now
// recomputes mergeability itself and reports `upstream_conflict` directly, so
// reading the failure prose here would only be a second, staler opinion — it
// matched a message left by a past attempt even after the branch was fixed.
export function reviewStateFor(rec, reviewStatus) {
  return reviewStatus?.byId?.[rec?.id] || null
}

const QUALITY_REVIEW_STATES = new Set([
  'queued', 'reviewing', 'changes_needed', 'all_clear',
])

// One exact prepared head owns one review conversation. The scope travels with
// the app-owned chat, so a second tap (or a remounted Contribute frame) can find
// the already-running review instead of starting another agent. A compact
// 64-bit digest keeps batch scopes inside the platform's bounded metadata field
// without making the UI remember a parallel registry.
export function contributionReviewScope(records, mode = 'review') {
  const identities = (Array.isArray(records) ? records : [])
    .filter((rec) => rec && typeof rec.id === 'string' && rec.id)
    .map((rec) => `${rec.id}\u0000${String(rec.plan?.head_sha || '')}`)
    .sort()
  if (identities.length === 0) return ''
  const input = `${mode}\u0000${identities.join('\u0001')}`
  return `contribute-review:${contributionScopeHash(input)}`
}

// Every app-owned private task gets an immutable problem identity. Actions
// that already carry a narrower record/head scope keep it; project and mixed
// work use the complete task draft, so a repeated tap reuses the same running
// conversation while changed source or ledger facts naturally start a fresh
// one. This is deliberately not a permanent "Contribute agent" scope: the
// platform's scoped-start primitive is exactly-once for its whole lifetime.
export function contributionActionScope(action) {
  if (typeof action?.scope === 'string' && action.scope.trim()) {
    return action.scope.trim()
  }
  const identity = [action?.event, action?.title, action?.revision, action?.draft]
    .map((value) => String(value || '').trim())
    .join('\u0000')
  if (!identity.replaceAll('\u0000', '')) return ''
  return `contribute-task:${contributionScopeHash(identity)}`
}

// Review and Prepare are two views of the same private work. Merge is the
// owner's desired end state, not a wider GitHub grant: it gets a distinct
// helper scope so a completed preparation can be resumed as one full-cycle
// workflow, while the exact publication and final merge approvals stay on the
// existing guarded surfaces.
export function contributionOutcomeAction(action, outcome = 'prepare') {
  if (!action || outcome !== 'merge') return action || null
  const sourceScope = contributionActionScope(action)
  return {
    ...action,
    event: 'prepare_contribution_merge_cycle',
    title: 'Prepare the full merge cycle',
    label: 'Merge',
    scope: `contribute-merge:${contributionScopeHash(`${sourceScope}\u0000${action.revision || ''}`)}`,
    scopeLabel: 'Prepare the full merge cycle',
    draft: [
      action.draft,
      '',
      'The owner chose Merge as the desired outcome for this exact scope. Carry the private alignment, grouping, and review through to the existing approval checkpoints instead of inventing a parallel queue.',
      'After preparation, leave the exact reviewed publication controls ready. Every push, pull-request creation or update, comment, and final merge still requires its own current explicit approval; this choice does not pre-authorize any public action.',
      'Once approved public work exists, keep it attached to its source chats and Contribute records so checks, review feedback, final merge approval, and local reconciliation remain one visible cycle.',
    ].join('\n'),
  }
}

// Public-only work still has a full cycle: review feedback, acceptance, and
// local reconciliation do not disappear when there is nothing left to prepare.
export function contributionCycleAction(run, projects) {
  if (run?.privateAction) return contributionOutcomeAction(run.privateAction, 'merge')
  const active = [...(run?.decisions || []), ...(run?.working || [])]
  if (!active.length) return null
  return contributionOutcomeAction({
    title: 'Finish the contribution cycle',
    revision: run?.revision || '',
    count: active.length,
    draft: [
      'Read Contribute’s Finish the contribution cycle workflow and carry it through for only these projects:',
      ...(projects || []).map(project => `- ${project.name}: ${project.key}; repository ${project.canonical_repo || 'not yet shared'}`),
      'Refresh the exact current records and shared source. Review and repair privately; group coherent changes within each repository before submission, never one PR per chat. Do not combine unrelated work just to make a batch.',
      'Keep working in place. Present the exact ready batch for approval; notify the owner of real blockers with a direct link to the conversation. Preserve local work through the reviewed update path.',
    ].join('\n'),
  }, 'merge')
}

// A quality verdict belongs to one immutable prepared head. Source freshness
// and agent review are separate claims: the platform proves the former, while
// the agent records the latter after its correctness/maintenance review.
export function qualityReviewFor(rec) {
  const raw = rec?.quality_review
  const currentHead = String(rec?.plan?.head_sha || '')
  if (!raw || typeof raw !== 'object' || !QUALITY_REVIEW_STATES.has(raw.state)) {
    return { state: 'needed', label: 'Review needed' }
  }
  if (raw.state === 'all_clear' && (!currentHead || raw.reviewed_head_sha !== currentHead)) {
    return { ...raw, state: 'needed', label: 'Review needed', stale: true }
  }
  const labels = {
    queued: 'Queued',
    reviewing: 'Reviewing',
    changes_needed: 'Changes needed',
    all_clear: 'All clear',
  }
  return { ...raw, label: labels[raw.state] }
}

export function isAllClear(rec, reviewStatus) {
  return rec?.status === 'prepared' &&
    qualityReviewFor(rec).state === 'all_clear' &&
    reviewStateFor(rec, reviewStatus)?.state === 'ready'
}

function reviewAction(records, mode = 'review') {
  const candidates = (Array.isArray(records) ? records : []).filter((rec) => {
    if (rec?.type !== 'pr' || rec.status !== 'prepared') return false
    const state = qualityReviewFor(rec).state
    return mode === 'fix' ? state === 'changes_needed' : state !== 'all_clear'
  })
  if (candidates.length === 0) return null
  const ids = candidates.map((rec) => rec.id)
  const fixing = mode === 'fix'
  return {
    event: fixing ? 'fix_and_review_contributions' : 'review_contributions',
    title: fixing ? 'Fix and review contributions' : 'Review contributions',
    label: fixing
      ? (candidates.length === 1 ? 'Fix' : 'Fix all')
      : (candidates.length === 1 ? 'Review' : 'Review all'),
    busyLabel: 'Starting…',
    startedLabel: fixing ? 'Fixing and reviewing' : 'Reviewing contributions',
    startedMessage: 'Stay in Contribute. Review verdicts will update here.',
    count: candidates.length,
    scope: contributionReviewScope(candidates, mode),
    scopeLabel: fixing ? 'Fix and review contributions' : 'Review contributions',
    draft: [
      fixing
        ? 'Fix and thoroughly re-review the prepared contributions listed below.'
        : 'Thoroughly review the prepared contributions listed below.',
      '',
      ...ids.map((id) => `- ${id}`),
      '',
      'Refresh each record and inspect its complete diff. Review correctness, maintainability, simplicity, tests, security/privacy, and avoidable technical debt with expanding scope where ownership requires it.',
      fixing
        ? 'For owner-authored work, fix every sound finding privately, commit it on the review branch, restage the record through the Contribute stage call, and repeat the full review on the new head. For work owned by someone else, prepare concrete suggestions instead of changing their branch.'
        : 'If a sound issue is found in owner-authored work, fix it privately and repeat the full review on the new head. For work owned by someone else, prepare concrete suggestions instead of changing their branch.',
      'After every pass, record the verdict through Contribute\'s review call for the exact staged head and diff (see the contributing skill\'s ledger file). Use state reviewing while active, changes_needed when a sound finding remains, and all_clear only when the complete current head passes, with a concise summary.',
      'Do not push, publish, comment, merge, or otherwise change GitHub. Stop once every listed record is either all_clear on its exact current head or has a precise remaining blocker.',
    ].join('\n'),
  }
}

export function reviewAllAction(records) { return reviewAction(records, 'review') }

// A failed publication is not another GitHub mutation. One app-owned recovery
// conversation refreshes the recorded branch, reconciles a response that may
// have been lost after GitHub accepted it, and leaves any public retry on the
// existing approval surface. The exact record+head scope matches the compact
// chat card so either doorway resumes the same work.
export function recoveryReviewAction(rec) {
  if (!rec?.id) return null
  return {
    event: 'recover_contribution_review',
    title: `Fix and review ${rec.title || 'contribution'}`,
    label: 'Fix in chat',
    busyLabel: 'Starting…',
    startedLabel: 'Fixing and reviewing',
    reusedLabel: 'Review already running',
    startedMessage: 'Stay in Contribute. This exact review will update here.',
    count: 1,
    scope: contributionReviewScope([rec], 'recovery'),
    scopeLabel: 'Fix and review contribution',
    draft: [
      `Fix and review contribution ${rec.id} ("${rec.title || 'untitled'}").`,
      '',
      'Refresh the recorded pull request and branch first. If the exact reviewed head already reached the pull request, reconcile the contribution record and inspect its current checks. If the branch moved, rebuild the private review on its current head and run the relevant checks.',
      '',
      'Keep any further public update behind the existing approval button.',
    ].join('\n'),
  }
}

// The Needs action queue can contain three different private jobs: a fresh
// quality review, fixes after a review, or a stale/conflicted prepared head.
// One contextual tray should own that exact mixed scope rather than choosing
// one job and silently leaving the other visible rows behind.
export function contributionsNeedingReviewAction(records, reviewStatus) {
  return (Array.isArray(records) ? records : []).filter((rec) => {
    if (rec?.type !== 'pr' || rec.status !== 'prepared') return false
    return !isAllClear(rec, reviewStatus)
  })
}

export function progressReviewAction(records, reviewStatus) {
  const candidates = contributionsNeedingReviewAction(records, reviewStatus)
  if (candidates.length === 0) return null
  const list = candidates.map((rec) => {
    const title = rec.plan?.title || rec.title || rec.summary || 'Untitled pull request'
    const repo = rec.plan?.repo || rec.repo || 'project'
    const quality = qualityReviewFor(rec).state
    const state = reviewStateFor(rec, reviewStatus)?.state
    const step = state === 'needs_refresh'
      ? 'refresh the prepared head'
      : quality === 'changes_needed'
        ? 'fix findings and review again'
        : 'complete the quality review'
    return `- ${title} — ${repo} — ${step} (${rec.id})`
  })
  const first = candidates[0]
  const firstQuality = qualityReviewFor(first).state
  const singleLabel = reviewStateFor(first, reviewStatus)?.state === 'needs_refresh'
    ? 'Fix in chat'
    : firstQuality === 'changes_needed'
      ? 'Fix'
      : firstQuality === 'reviewing' || firstQuality === 'queued'
        ? 'Open chat'
        : 'Review'
  return {
    event: 'progress_contribution_reviews',
    title: 'Work through contribution reviews',
    label: candidates.length === 1 ? singleLabel : 'Review all',
    busyLabel: 'Starting…',
    startedLabel: 'Working through reviews',
    startedMessage: 'Stay in Contribute. Each item will move as its current head is resolved and reviewed.',
    count: candidates.length,
    scope: contributionReviewScope(candidates, 'progress'),
    scopeLabel: 'Work through contribution reviews',
    draft: [
      'Work through the exact Contribute review queue listed below.',
      '',
      ...list,
      '',
      'Refresh every record first. Resolve stale prepared heads, then thoroughly review correctness, maintainability, simplicity, tests, security/privacy, and avoidable technical debt.',
      'For owner-authored work, fix every sound finding privately and repeat the full review on the new head. For work owned by someone else, prepare concrete suggestions instead of changing their branch.',
      'Restage every fix through Contribute\'s stage call and record each verdict through its review call for the exact staged head. Mark all_clear only after the complete current head passes.',
      'Do not push, publish, comment, merge, or otherwise change GitHub. Stop with every listed item either all clear on its exact head or carrying one precise blocker.',
    ].join('\n'),
  }
}

const ACTIVE_PR_STATUSES = new Set([
  'prepared',
  'submitting',
  'landing',
  'draft',
  'open',
])

export function hasAttentionSignal(rec) {
  return rec?.needs_attention === true ||
    (typeof rec?.attention?.title === 'string' && !!rec.attention.title.trim()) ||
    (typeof rec?.attention?.message === 'string' && !!rec.attention.message.trim())
}

export function attentionReason(rec, reviewStatus) {
  const attention = rec?.attention || {}
  const review = reviewStateFor(rec, reviewStatus)
  const details = [
    typeof attention.title === 'string' ? attention.title.trim() : '',
    typeof attention.message === 'string' ? attention.message.trim() : '',
  ].filter(Boolean)
  if (details.length > 0) return details.join(' — ')
  if (review?.state === 'needs_refresh') {
    return review.message || 'This changed after it was reviewed and needs to be refreshed.'
  }
  if (typeof rec?.last_submit_error === 'string' && rec.last_submit_error.trim()) {
    return rec.last_submit_error.trim()
  }
  return 'This contribution needs another look.'
}

// The batch handoff deliberately covers only active pull requests. A stale
// attention flag on a merged, closed, superseded, or dropped record belongs in
// History and must never bring settled work back into the action queue.
export function contributionsNeedingAttention(records, reviewStatus) {
  return (Array.isArray(records) ? records : []).filter((rec) => {
    if (rec?.type !== 'pr' || !ACTIVE_PR_STATUSES.has(rec.status)) return false
    return hasAttentionSignal(rec) ||
      reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh'
  })
}

export function addressAllAction(records, reviewStatus) {
  const attentionRecords = contributionsNeedingAttention(records, reviewStatus)
  if (attentionRecords.length === 0) return null
  const list = attentionRecords.map((rec) => {
    const title = rec.plan?.title || rec.title || rec.summary || 'Untitled pull request'
    const repo = rec.repo ? ` — ${rec.repo}` : ''
    const url = rec.attention?.url || rec.url || ''
    return [
      `- ${title}${repo}`,
      `  ${attentionReason(rec, reviewStatus)}`,
      url ? `  ${url}` : '',
    ].filter(Boolean).join('\n')
  })
  return {
    event: 'address_all_contributions',
    title: 'Address contribution follow-up',
    label: attentionRecords.length === 1 ? 'Fix' : `Address all ${attentionRecords.length}`,
    busyLabel: 'Starting…',
    startedLabel: 'Agent is handling follow-up',
    startedMessage: 'Stay in Contribute. Refreshed reviews and any decisions will appear here.',
    count: attentionRecords.length,
    draft: [
      'Address every active Contribute pull request that needs attention:',
      '',
      ...list,
      '',
      'Inspect each blocker, explain what can be fixed privately, and prepare the required updates.',
      'Do not push, reply, publish, merge, or otherwise change GitHub without the approval required for that exact public action.',
      'If a merge conflict or owner decision is required, leave it flagged and explain the next choice.',
    ].join('\n'),
  }
}

export function organizePrivateWorkAction(records, reviewStatus, projects = []) {
  const safe = Array.isArray(records) ? records : []
  const projectList = Array.isArray(projects) ? projects : []
  const candidates = new Map()
  for (const rec of [
    ...contributionsNeedingReviewAction(safe, reviewStatus),
    ...contributionsNeedingAttention(safe, reviewStatus),
  ]) candidates.set(rec.id, rec)
  const contributionList = [...candidates.values()]
  if (contributionList.length === 0 && projectList.length === 0) return null

  const contributionRows = contributionList.map((rec) => {
    const title = rec.plan?.title || rec.title || rec.summary || 'Untitled pull request'
    const reason = rec?.attention?.message || rec?.last_submit_error || ''
    return [
      `- ${title} — ${rec.repo || rec.plan?.repo || 'project'} (${rec.id})`,
      reason ? `  ${reason}` : '',
    ].filter(Boolean).join('\n')
  })
  const projectRows = projectList.map((project) => (
    `- ${project.name || 'Local project'} [${project.key || 'unavailable'}; ${project.canonical_repo || 'local-only project'}]`
  ))
  const count = contributionList.length + projectList.length
  const includesPublicAttention = contributionList.some((rec) => rec.status !== 'prepared')
  const includesAttention = contributionsNeedingAttention(
    contributionList, reviewStatus,
  ).length > 0
  const singleReview = contributionList.length === 1
    ? progressReviewAction(contributionList, reviewStatus)
    : null
  const label = projectList.length > 0
    ? (count === 1 ? 'Organize' : 'Organize all')
    : contributionList.length === 1
      ? (includesAttention && singleReview
          ? 'Fix and review'
          : singleReview?.label || 'Fix')
      : includesPublicAttention ? 'Organize all' : 'Review all'
  const contributionRevision = contributionList.map((rec) => {
    const review = reviewStateFor(rec, reviewStatus) || {}
    return [
      rec.id,
      rec.status,
      rec.plan?.head_sha,
      rec.updated_at,
      rec.attention?.key,
      rec.attention?.message,
      review.state,
      review.code,
    ].map((value) => String(value || '')).join('\u0000')
  })
  const projectRevision = projectList.map(projectWorkRevision)
  return {
    event: 'organize_private_contributions',
    title: 'Organize private contribution work',
    label,
    busyLabel: 'Starting…',
    startedLabel: 'Private work is running',
    reusedLabel: 'This private work is already running',
    startedMessage: 'Keep working here. Reviews and approval buttons update in Contribute.',
    count,
    scopeLabel: 'Private contribution work',
    revision: [...contributionRevision, ...projectRevision].sort().join('\u0001'),
    draft: [
      'Organize the current private contribution work listed below.',
      '',
      projectRows.length ? 'Projects with local work:' : '',
      ...projectRows,
      contributionRows.length ? 'Contributions needing judgment or repair:' : '',
      ...contributionRows,
      '',
      'Start with Contribute’s current snapshot and deterministic reconciliation helpers. Accept their proven status, landing, duplicate, and lost-response outcomes instead of recreating that work by hand.',
      'Before preparing any branch, fetch its canonical upstream read-only. Never pull, rebase, reset, switch, or otherwise move a shared live checkout. Build the review checkout from the freshly fetched accepted base, then replay only the attributable local commits and working diff in isolation. Do not copy an older whole tree over newer upstream changes. If a three-way replay is ambiguous, stop with the exact conflict.',
      'Inspect untracked and generated-looking paths before staging. When a path is clearly repository-wide generated state, add the smallest reusable ignore rule to the owning .gitignore and settle the generated path locally. Do not silently ignore ambiguous files; leave one concrete owner decision instead.',
      'Use agent judgment only where it is actually required: classifying local intent, grouping and deduplicating reusable changes, reviewing complete diffs, or fixing a real code/review problem.',
      'Group cohesive changes within each repository before publication, not one pull request per chat. Keep unrelated work independent; use stacks only for genuine dependencies. Preserve all source-chat links when work is consolidated. A blocked group must not hold up unrelated ready work.',
      'Privately prepare every worthwhile change in scope and thoroughly review each exact head. Stage each exact head through Contribute\'s stage call and record verdicts through its review call; all_clear is valid only for the complete current staged head.',
      'Record intentionally excluded chat paths through their exact reviewed timestamps when this work came from a source chat.',
      'Do not push, publish, update a pull request, comment, merge, or otherwise change GitHub. Stop at direct approval buttons and summarize what is ready, automatic, blocked, and intentionally local.',
    ].filter(Boolean).join('\n'),
  }
}

const OWNER_FAILURE_CODES = new Set([
  'github_not_connected', 'missing_github_token', 'forbidden',
  'insufficient_permission', 'permission_denied',
])

// A public-action failure should summon private repair only when code or review
// work can help. Connection/permission choices stay with the owner; ambiguous
// responses stay on the deterministic ledger-refresh path instead of paying
// for an agent that can learn nothing new.
export function contributionFailureOwner(outcome) {
  const failure = outcome?.failure || {}
  if (failure.owner === 'owner' || failure.owner === 'automatic') return failure.owner
  const status = Number(failure.status)
  const code = String(failure.code || '').toLowerCase()
  if (status === 401 || status === 403 || OWNER_FAILURE_CODES.has(code)) return 'owner'
  return 'agent'
}

export function isContributionCycleChat(chat) {
  const scope = typeof chat?.scope === 'string' ? chat.scope : ''
  return scope === 'contribute-cycle' || scope.startsWith('contribute-task:')
}

export function contributionCycleProgress(runtime) {
  const plan = runtime?.goal_plan
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : []
  const summary = plan?.summary || {}
  const completed = Number.isInteger(summary.completed)
    ? summary.completed
    : tasks.filter((task) => task?.status === 'completed').length
  const total = Number.isInteger(summary.total) ? summary.total : tasks.length
  const current = tasks.find((task) => task?.status === 'running')
    || tasks.find((task) => task?.ready === true)
  const label = current?.title
    || runtime?.active_goal_objective
    || (runtime?.pending_question_id ? 'Waiting for your decision' : 'Working through the cycle')
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : null,
    label,
  }
}

export function partitionReviewUnits(units, reviewStatus) {
  const needsAttention = []
  const readyToSend = []
  const needsReview = []
  const reviewing = []
  for (const unit of units || []) {
    const records = unit.records || (unit.record ? [unit.record] : [])
    // A prepared child can remain grouped with already-public or merged stack
    // parents. Only the still-private layers need an exact-head quality verdict;
    // requiring an open parent to become `prepared` again makes the child
    // permanently impossible to review or send.
    const privateRecords = records.filter((rec) => rec.status === 'prepared')
    const reviewRecords = privateRecords.length > 0 ? privateRecords : records
    if (reviewRecords.some((rec) => hasAttentionSignal(rec)) || reviewRecords.some(
      (rec) => reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh',
    ) || reviewRecords.some((rec) => qualityReviewFor(rec).state === 'changes_needed')) {
      needsAttention.push(unit)
    } else if (reviewRecords.some((rec) => ['queued', 'reviewing'].includes(qualityReviewFor(rec).state))) {
      reviewing.push(unit)
    } else if (!reviewRecords.every((rec) => isAllClear(rec, reviewStatus))) {
      needsReview.push(unit)
    } else {
      readyToSend.push(unit)
    }
  }
  return { needsAttention, needsReview, reviewing, readyToSend }
}

const REVIEW_INTENT = /^review:([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/
const REVIEW_QUEUE_INTENT = 'reviews:queue'

// Shell cards address one immutable ledger identity. The record's current
// stage and stack membership remain Contribute's decision, so a stale card can
// still open the truthful current review instead of encoding a tab/filter that
// may have changed since the card rendered.
export function contributionReviewTargetFromIntent(intent) {
  if (typeof intent !== 'string') return null
  const normalized = intent.trim()
  if (normalized === REVIEW_QUEUE_INTENT) return { queue: true }
  const match = REVIEW_INTENT.exec(normalized)
  return match ? { recordId: match[1] } : null
}

function focusedStackMeta(record) {
  const raw = record?.plan?.stack || record?.stack
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const total = Number(raw.total)
  const position = Number(raw.position)
  if (!id || !Number.isInteger(total) || total < 1) return null
  return {
    id,
    repo: String(record?.plan?.repo || record?.repo || ''),
    total,
    position: Number.isInteger(position) ? position : 0,
  }
}

// A shell handoff may arrive while the authoritative ledger is still paging.
// The cached snapshot deliberately contains every active record, so a complete
// stack there is enough to render immediately. Publication still fresh-reads
// every exact record; this only removes an avoidable navigation wait.
export function focusedContributionReady(records, recordId) {
  const list = Array.isArray(records) ? records : []
  const focused = list.find((record) => record?.id === recordId)
  if (!focused) return false
  const stack = focusedStackMeta(focused)
  if (!stack) return true
  const positions = new Set(list.flatMap((record) => {
    const candidate = focusedStackMeta(record)
    return candidate
      && candidate.id === stack.id
      && candidate.repo === stack.repo
      && candidate.total === stack.total
      && candidate.position >= 1
      && candidate.position <= stack.total
      ? [candidate.position]
      : []
  }))
  return positions.size === stack.total
}

// Opening the same record twice can reuse a previously settled lookup, while
// an already-mounted app can have a globally complete but now-stale ledger.
// Bind readiness to the exact intent nonce, then let a later ledger refresh
// satisfy an incomplete stack without ever treating global ledger readiness
// as proof that this named review is absent.
export function focusedContributionNavigationReady(focusTarget, lookup, records) {
  if (!focusTarget) return true
  if (focusTarget.queue) {
    return lookup?.nonce === focusTarget.nonce
      && lookup?.queue === true
      && lookup?.ready === true
  }
  const recordId = typeof focusTarget.recordId === 'string'
    ? focusTarget.recordId
    : ''
  if (
    !recordId
    || lookup?.nonce !== focusTarget.nonce
    || lookup?.recordId !== recordId
  ) {
    return false
  }
  return lookup.ready === true || focusedContributionReady(records, recordId)
}

export function locateContributionReview(phaseUnits, recordId) {
  const wanted = typeof recordId === 'string' ? recordId : ''
  if (!wanted) return null
  for (const [phase, units] of Object.entries(phaseUnits || {})) {
    for (const unit of units || []) {
      const records = unit?.records || (unit?.record ? [unit.record] : [])
      if (records.some((record) => record?.id === wanted)) {
        return { phase, unit }
      }
    }
  }
  return null
}
