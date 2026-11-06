// GitHub owns people, permissions and assignments. Contribute owns the private
// review journey; a repository role never becomes an automatic merge grant.
import { PR_FIELDS, fetchLiveStates } from './api.js'

export { PR_FIELDS } from './api.js'
export const mayAssign = permission => ['TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].includes(permission)
export const mayMerge = permission => ['WRITE', 'MAINTAIN', 'ADMIN'].includes(permission)
// This is discovery, not authority: the server rechecks exact repositories at
// admission and before publication. Older snapshots still need that preflight.
// A takeover never marks a draft ready (the owner does), so there is one scope.
export const TAKEOVER_SCOPE = 'named_pr_repairs_and_reviewed_successors'
export function takeoverBlocker(pulls, { allowDraft = false } = {}) {
  if (!allowDraft && pulls.some(pr => pr.isDraft)) return 'Draft PRs must be marked ready first.'
  if (pulls.some(pr => !mayMerge(pr.repository?.viewerPermission))) return 'Requires merge access to every selected PR.'
  // GitHub returns `headRepository: null` when the source fork was deleted:
  // no fix can be pushed there. Only an absent field (older snapshot) defers
  // to the server's push-rights preflight.
  if (pulls.some(pr => pr.headRepository === null)) return 'The PR’s source repository was deleted, so fixes cannot be sent.'
  if (pulls.some(pr => pr.headRepository && (pr.headRepository.isArchived || !mayMerge(pr.headRepository.viewerPermission)))) return 'Requires push access to the PR’s source repository to send fixes.'
  return ''
}
// GitHub's rollup counts include check runs and commit statuses. Like GitHub's
// own "18/18", skipped and neutral runs count as passing; anything failed or
// cancelled is a failure; the rest is still pending. A green rollup is not a
// review verdict or proof that branch-required checks passed.
const PASSING_CHECKS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])
const FAILING_CHECKS = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'STALE'])
export function checkSummary(pr) {
  const counts = pr?.commits?.nodes?.at(-1)?.commit?.statusCheckRollup?.contexts
  if (!Number.isInteger(counts?.totalCount) || counts.totalCount < 0) return null
  const groups = [counts.checkRunCountsByState, counts.statusContextCountsByState]
  if (groups.some(group => !Array.isArray(group))) return null
  const states = groups.flat()
  if (states.some(item => !item?.state || !Number.isInteger(item.count) || item.count < 0)) return null
  const sum = test => states.filter(item => test(item.state)).reduce((total, item) => total + item.count, 0)
  const passed = sum(state => PASSING_CHECKS.has(state))
  const failed = sum(state => FAILING_CHECKS.has(state))
  const total = counts.totalCount
  if (passed + failed > total) return null
  return { passed, failed, total, state: failed ? 'failure' : passed === total ? 'success' : 'pending' }
}
// Two different "bases": GitHub's baseRefOid is the PR's comparison base,
// while a run is bound to the target branch's live tip when the owner
// consents (the server checks exactly that). Runs and review links use the tip.
export const baseTip = pr => pr?.baseRef?.target?.oid || null
// The conversation count a row shows: issue-style comments plus review
// submissions, the same two sources the PR page's Comments tab lists.
export const conversationCount = pr => (pr?.comments?.totalCount || 0) + (pr?.reviews?.totalCount || 0)
export const prKey = pr => `${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`
export const mergeSelection = (old, next) => [...new Map([...old, ...next].map(pr => [prKey(pr), pr])).values()]
const BOT_LOGINS = new Set(['dependabot', 'renovate', 'github-actions'])
// A GitHub App login ends in [bot]; a bot account by convention in -bot or _bot. A person
// named abbot or talbot is not one.
export const isBotAuthor = login => /\[bot\]$|[-_]bot$/i.test(login || '') || BOT_LOGINS.has((login || '').toLowerCase())

export function matchingPulls(pulls, filter, login) {
  const same = value => value?.toLowerCase() === login?.toLowerCase()
  const test = {
    unassigned: pr => !pr.assignees?.nodes?.length,
    assigned: pr => pr.assignees?.nodes?.some(user => same(user.login)),
    authored: pr => same(pr.author?.login),
    drafts: pr => pr.isDraft,
    failing: pr => checkSummary(pr)?.failed > 0,
    bots: pr => isBotAuthor(pr.author?.login),
  }[filter]
  return test ? pulls.filter(test) : pulls
}

async function graph(token, query) {
  const result = await fetchLiveStates(token, query)
  if (!result) throw new Error('Could not check GitHub. Sync to try again.')
  return result
}
export async function discoverRepositories(token, cursor = null) {
  const data = await graph(token, `query ContributeRepositories { viewer { repositories(first:100,
    affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER], orderBy:{field:UPDATED_AT,direction:DESC},
    after:${JSON.stringify(cursor)}) { nodes { nameWithOwner viewerPermission isArchived pullRequests(states:OPEN) { totalCount } }
    pageInfo { hasNextPage endCursor } } } }`)
  if (!data.viewer?.repositories) throw new Error('GitHub did not return repository access. Sync to try again.')
  const connection = data.viewer.repositories
  return { repositories: connection.nodes.filter(repo => mayAssign(repo.viewerPermission) && !repo.isArchived).map(repo => ({ ...repo, openPullRequestCount: repo.pullRequests?.totalCount || 0 })), ...connection.pageInfo }
}
export function repositoryName(value) {
  const name = String(value || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '')
  return /^[\w.-]+\/[\w.-]+$/.test(name) ? name.toLowerCase() : ''
}

export async function discoverRepository(token, value) {
  const name = repositoryName(value)
  if (!name) throw new Error('Enter a GitHub repository, such as owner/project.')
  const [owner, repo] = name.split('/')
  const data = await graph(token, `query ContributeRepository { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}) { nameWithOwner viewerPermission isArchived } }`)
  if (!data.repository) throw new Error('Repository not found, or your GitHub account cannot access it.')
  return data.repository
}
export async function discoverPulls(token, repo = '', cursor = null) {
  const queryText = repo ? `repo:${repo} is:pr is:open` : 'is:pr is:open involves:@me'
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Choose a valid repository.')
  const data = await graph(token, `query ContributePullRequests {
    search(query:${JSON.stringify(queryText)},type:ISSUE,first:50,after:${JSON.stringify(cursor)}) {
      nodes { ... on PullRequest { ${PR_FIELDS} } }
      issueCount pageInfo { hasNextPage endCursor }
    }
  }`)
  if (!data.search) throw new Error('GitHub did not return pull requests. Sync to try again.')
  return { pulls: data.search.nodes.filter(pr => pr?.repository?.nameWithOwner && pr.headRefOid),
    total: data.search.issueCount, ...data.search.pageInfo }
}
// Re-read one exact PR identity without scanning all open PR pages.
export async function discoverPull(token, repo, number) {
  const name = repositoryName(repo)
  if (!name || !Number.isSafeInteger(number) || number < 1) throw new Error('Choose a valid pull request.')
  const [owner, project] = name.split('/')
  const data = await graph(token, `query ContributeExactPull { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(project)}) { pullRequest(number:${number}) { ${PR_FIELDS} mergedAt } } }`)
  const pr = data.repository?.pullRequest
  if (!pr || pr.number !== number || pr.repository.nameWithOwner.toLowerCase() !== name) throw new Error('This PR is unavailable to your GitHub account.')
  return pr
}

// Owner consent covers each PR's exact code (its head). The target branch moves
// whenever anything merges, so a launch rebinds an unchanged PR to the current
// tip of the SAME target instead of failing on a stale list. Retargeting,
// changed code or draft state needs the owner to look again.
export async function liveSelection(token, pulls) {
  const fresh = await Promise.all(pulls.map(pr => discoverPull(token, pr.repository.nameWithOwner, pr.number)))
  const changed = fresh.filter((pr, index) => pr.headRefOid !== pulls[index].headRefOid || pr.baseRefName !== pulls[index].baseRefName || pr.isDraft !== pulls[index].isDraft || (pr.state && pr.state !== 'OPEN'))
  if (changed.length) {
    throw Object.assign(new Error(`${changed.map(pr => `#${pr.number}`).join(', ')} changed since this list loaded. Review the current version, then start again.`), { code: 'changed' })
  }
  return pulls.map((pr, index) => ({ ...pr, baseRefOid: fresh[index].baseRefOid, baseRefName: fresh[index].baseRefName, baseRef: fresh[index].baseRef }))
}

export async function collaborationRequest(token, appId, path, body) {
  const response = await fetch(`/api/github/contributions/${encodeURIComponent(appId)}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => ({}))
  // A route that does not exist answers a bare 404; a 404 that explains itself (a PR GitHub cannot show) is the platform's own word.
  const routeMissing = response.status === 404 && (!data.detail || data.detail === 'Not Found')
  if (!response.ok) throw Object.assign(new Error(routeMissing
    ? 'These controls need the companion Möbius update to be activated.'
    : typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Could not complete this action. Sync before retrying.'),
  { status: response.status, ...(typeof data.detail?.code === 'string' ? { code: data.detail.code } : {}) })
  return data
}

// A core review run Contribute did not start is read through G1's minimized
// projection: id, chat_id, state, execution_state, mode, created_at,
// `app_id: null`, `can_stop: false`, a top-level `post_review` boolean,
// `details_in_owning_chat: true`, and items with only repo, number, head_sha,
// base_ref, base_sha, state and an optional `public_review: {state, url}`.
// Prompts, findings and approval wording stay in the owning conversation.
export const runDetailsElsewhere = run => run?.details_in_owning_chat === true
// States where the owner, not the agent, holds the next step.
export const OWNER_ITEM_STATES = new Set(['needs_you', 'failed', 'merge_unknown', 'ready_unknown', 'verdict_pending', 'verdict_unknown'])
// Own runs carry their frozen options; minimized runs the top-level flag.
export const runPostsReview = run => runDetailsElsewhere(run) ? run.post_review === true : run?.options?.post_review === true
// Observe of a run this app does not own is refused with this code: the core
// owns its reconciliation, so it is "not ours", not an error.
export const NOT_OURS_TO_OBSERVE = 'details_in_owning_chat'
export const notOursToObserve = error => error?.status === 403 && error?.code === NOT_OURS_TO_OBSERVE

// A Review only run that posts on GitHub is not private, so its name says so.
// A run whose mode is not reported is not assumed to be private.
export const reviewRunTitle = run => run.mode === 'review_fix_merge' ? 'Review, fix & merge' : run.mode === 'review_merge' ? 'Review & merge'
  : runPostsReview(run) ? 'GitHub review' : run.mode === 'review' ? 'Private review' : 'Review run'

export const REVIEW_STATE_NAMES = { reviewing: 'Reviewing', repairing:'Fixing review findings', pushing:'Sending scoped fix', marking_ready:'Opening for review', ready_unknown:'Readiness outcome needs checking', push_unknown:'Fix outcome needs checking', pending: 'Waiting to review', all_clear: 'Review clear', needs_you: 'Needs you', merged: 'Merged', queued: 'In merge queue', failed: 'Failed', starting: 'Starting', merging: 'Merging', merge_unknown: 'Outcome needs checking', verdict_pending: 'Verdict waiting for you', verdict_posting: 'Submitting verdict', verdict_unknown: 'Verdict outcome needs checking', complete: 'Complete', stopped: 'Stopped', interrupted:'Interrupted', paused: 'Paused', awaiting_owner: 'Waiting for your answer' }

// One derivation of run and item progress for every run view. Execution
// belongs to the conversation; saved verdicts and public receipts survive it.
const SETTLED_ITEMS = new Set(['all_clear', 'merged', 'queued', 'complete'])
const HALTED_RUNS = new Set(['stopped', 'failed', 'interrupted'])
export const reviewRunStateLabel = run => REVIEW_STATE_NAMES[run.execution_state] || REVIEW_STATE_NAMES[run.state] || run.state
// `turn` says whose move the review leaves on its PR: 'agent' while it works,
// 'owner' while a decision, an answer or a fix waits on you, 'author' once your
// review is out and the PR's author is next, 'none' once it is settled. The
// saved word needs_you is what the review FOUND; the verdict receipts say what
// you already did about it, and only they can hand the move to the author.
// GitHub refuses "request changes" on your own PR, so a posted one is always on
// someone else's. A posted plain review hands a PR over only when `own` is
// known to be false; null (unknown) never does.
// `ignored` is the owner's notes of findings set aside (ignoreKey -> { reason }):
// a finding the owner ignored for this exact version no longer waits on them.
export function reviewItemProgress(run, item, { own = null, ignored = null } = {}) {
  const found = item.state === 'needs_you'
  const verdict = item.verdict_proposal
  const requested = found && verdict?.state === 'posted' && verdict.event === 'REQUEST_CHANGES'
  const handedOver = requested || (found && own === false && !verdict && item.public_review?.state === 'posted')
  const dropped = found && verdict?.state === 'discarded'
  const waived = !handedOver && !!ignoredNote(item, ignored)
  const settled = SETTLED_ITEMS.has(item.state) || handedOver || dropped || waived
  const halted = !settled && HALTED_RUNS.has(run.execution_state)
  const waiting = !settled && run.execution_state === 'awaiting_owner'
  const label = requested ? 'Changes requested' : handedOver ? 'Review posted' : dropped ? 'Verdict discarded' : waived ? 'Ignored'
    : halted ? 'Not finished' : REVIEW_STATE_NAMES[item.state] || item.state
  const turn = handedOver ? 'author' : settled ? 'none' : halted || waiting || OWNER_ITEM_STATES.has(item.state) ? 'owner' : 'agent'
  return { label, halted, waiting, settled, turn }
}

// One review of one PR at one exact version: what the owner's "ignore" note is
// filed under, so a new version of the PR is reviewed and judged afresh.
export const ignoreKey = item => `${String(item.repo).toLowerCase()}#${item.number}@${item.head_sha}`
// The notes are kept by exact version, so they stay few: only the newest few hundred are remembered.
const MAX_IGNORE_NOTES = 200
export function withIgnoreNote(notes, item, reason, now = new Date().toISOString()) {
  const next = { ...notes, [ignoreKey(item)]: { reason, at: now } }
  return Object.fromEntries(Object.entries(next).sort(([, a], [, b]) => String(b.at).localeCompare(String(a.at))).slice(0, MAX_IGNORE_NOTES))
}
export function withoutIgnoreNote(notes, item) {
  const { [ignoreKey(item)]: removed, ...rest } = notes || {}
  return rest
}
// The owner's note setting aside this review's findings, if there is one for them.
export const ignoredNote = (item, ignored) => (item.state === 'needs_you' ? ignored?.[ignoreKey(item)] || null : null)
// When the review now on screen began: a run that pushed a fix reviews the new version
// from the moment you pressed Push, not from when the run itself started.
export function reviewStartedAt(run, item) {
  const pushes = (item?.repair_attempts || []).filter(entry => entry.state === 'pushed').map(entry => entry.decided_at)
  return [run?.created_at, ...pushes].filter(Boolean).sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] || null
}
// The fix an agent prepared that waits for the owner's Push. The platform saves the
// fix's new commit as `head_sha` and the PR version it builds on as `from_sha`
// (contribution_reviews.py, propose repair), so `base` is the version it answers to.
export function waitingRepair(item) {
  const attempt = (item?.repair_attempts || []).find(entry => entry.state === 'proposed')
  if (!attempt) return null
  return { id: attempt.id, commit: attempt.head_sha || '', base: attempt.from_sha || '', files: Array.isArray(attempt.files) ? attempt.files : [], summary: attempt.summary || '' }
}
export const reviewRunHalted = run => run.state !== 'complete' && HALTED_RUNS.has(run.execution_state)

// Public outcomes a run saved before GitHub settled them. The server's observe
// step is read-only reconciliation, so the view settles them itself: a queued
// PR reads as merged even while its conversation waits on the owner or stopped.
const UNSETTLED = new Set(['queued', 'merging', 'merge_unknown', 'pushing', 'push_unknown', 'marking_ready', 'ready_unknown', 'verdict_posting', 'verdict_unknown'])
export const awaitsGithub = run => run.state !== 'complete' && (run.items || []).some(item => UNSETTLED.has(item.state))
export const OBSERVE_EVERY_MS = 60000
const observedAt = new Map()
const notOurs = new Set()

// Shows the saved list at once (onList), then re-reads it after any due
// GitHub reconciliation so a settled merge replaces "In merge queue".
export async function loadReviewRuns(token, appId, { onList, now = Date.now() } = {}) {
  const list = await collaborationRequest(token, appId, 'review-runs')
  onList?.(list)
  // Only Contribute's own runs can be observed through its app route; a
  // minimized run is reconciled by its owning conversation.
  const due = (list.runs || []).filter(run => !runDetailsElsewhere(run) && !notOurs.has(run.id) && awaitsGithub(run) && now - (observedAt.get(run.id) ?? -Infinity) >= OBSERVE_EVERY_MS)
  if (!due.length) return list
  due.forEach(run => observedAt.set(run.id, now))
  const settled = await Promise.allSettled(due.map(run => collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}/observe`, {})))
  // A refusal that names the run as not ours stops its polling for good.
  settled.forEach((result, index) => { if (result.status === 'rejected' && notOursToObserve(result.reason)) notOurs.add(due[index].id) })
  return settled.some(result => result.status === 'fulfilled') ? collaborationRequest(token, appId, 'review-runs') : list
}

// What the platform accepts for each mode, and nothing else (unknown or
// unenforced options are refused): editable review and merge prompts for every
// mode; fix guidance and a round cap only for Review, fix & merge, where
// takeover enforces them; the post-review grant (and its verdict form) only for
// Review only, with or without merge, and only when chosen. Automatic
// continuation is not supported, so it is never sent.
const PUBLISHING_MODES = new Set(['review', 'review_merge'])
export function requestOptions(options, mode) {
  const value = options || {}
  const prompt = key => typeof value[key] === 'string' && value[key].trim() ? { [key]: value[key] } : {}
  return {
    ...prompt('review_prompt'), ...prompt('merge_prompt'),
    ...(mode === 'review_fix_merge' ? {
      ...prompt('fix_prompt'),
      ...(Number.isSafeInteger(value.max_rounds) && value.max_rounds >= 1 ? { max_rounds: value.max_rounds } : {}),
    } : {}),
    ...(PUBLISHING_MODES.has(mode) && value.post_review === true ? {
      post_review: true, ...(value.propose_verdict === true ? { propose_verdict: true } : {}),
      ...(mode === 'review' && value.propose_verdict === true && value.agent_submits_verdict === true ? { agent_submits_verdict: true } : {}),
    } : {}),
  }
}

export function reviewRunRequest(choice) {
  return {
    request_id: choice.request_id, mode: choice.mode,
    ...(choice.mode === 'review_fix_merge' ? { confirmation_scope: TAKEOVER_SCOPE } : {}),
    ...(choice.mode === 'review_fix_merge' && String(choice.takeover_reason || '').trim() ? { takeover_reason: choice.takeover_reason.trim() } : {}),
    ...(choice.options ? { options:requestOptions(choice.options, choice.mode) } : {}),
    ...(choice.preview_sha256 ? { preview_sha256:choice.preview_sha256 } : {}),
    ...(choice.agent ? { agent:choice.agent } : {}),
    items: choice.pulls.map(pr => {
      if (!baseTip(pr)) throw new Error(`Couldn’t read the target branch of #${pr.number}. Sync and try again.`)
      return { repo: pr.repository.nameWithOwner, number: pr.number,
        head_sha: pr.headRefOid, base_ref: pr.baseRefName, base_sha: baseTip(pr) }
    }),
  }
}

// The owner's own Merge: this exact version, by the repository's allowed method.
// Returns the outcome shape the confirm sheet already reads: { ok } | { pending }
// (GitHub may have merged; read it back, never repeat) | { error }. The platform
// re-checks everything at the moment of merging and refuses what GitHub refuses.
export async function mergePull(token, appId, pr, { method = '' } = {}) {
  try {
    const result = await collaborationRequest(token, appId, 'pulls/merge', {
      repo: pr.repository.nameWithOwner, number: pr.number, head_sha: pr.headRefOid, ...(method ? { method } : {}),
    })
    return { ok: true, state: result.state, mergeSha: result.merge_sha || '' }
  } catch (error) {
    return error.code === 'merge_unconfirmed' ? { pending: true, error: error.message } : { error: error.message }
  }
}

// The owner's own status change on one PR, at this exact version, once: `ready` (open a draft for
// review), `draft` (back to draft), `close`, or `request-reviewers` (ask for re-review). Same outcome
// shapes as mergePull: { ok } | { pending } (GitHub may have done it; read it back, never repeat) |
// { error }. GitHub cannot pin a version on these writes, so the platform reports the head it saw
// afterwards (observedHead) and the sheet says so if it moved.
const UNCONFIRMED = { ready: 'ready_unconfirmed', draft: 'draft_unconfirmed', close: 'close_unconfirmed', 'request-reviewers': 'reviewers_unconfirmed' }
export async function pullAction(token, appId, pr, action, extra = {}) {
  try {
    const result = await collaborationRequest(token, appId, `pulls/${action}`, {
      repo: pr.repository.nameWithOwner, number: pr.number, head_sha: pr.headRefOid, ...extra,
    })
    return { ok: true, state: result.state, observedHead: result.observed_head_sha || '' }
  } catch (error) {
    return error.code === UNCONFIRMED[action] ? { pending: true, error: error.message } : { error: error.message }
  }
}

// What a finished private review would say on GitHub, word for word, with the hash that binds the
// post to it. Read-only: the platform writes nothing here.
export const previewPostedFindings = (token, appId, run, item) =>
  collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}/post-preview`,
    { repo: item.repo, number: item.number, head_sha: item.head_sha })

// Post exactly the previewed words, once, as a plain comment review at the reviewed version. Same
// outcome shapes as mergePull.
export async function postFindings(token, appId, run, item, preview) {
  try {
    const result = await collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}/post`,
      { repo: item.repo, number: item.number, head_sha: item.head_sha, preview_sha256: preview.preview_sha256 })
    return { ok: true, state: result.state, url: result.url || '' }
  } catch (error) {
    return error.code === 'post_unconfirmed' ? { pending: true, error: error.message } : { error: error.message }
  }
}

// Assignment is additive on GitHub. Return each outcome so partial batches
// never look like an all-or-nothing success or silently retry failed requests.
export async function assignPulls(token, appId, pulls, login) {
  const outcomes = []
  for (const pr of pulls) {
    try {
      await collaborationRequest(token, appId, 'assign-review', {
        repo: pr.repository.nameWithOwner, number: pr.number,
        expected_head_sha: pr.headRefOid, assignee: login,
      })
      outcomes.push({ key: prKey(pr), ok: true })
    } catch (error) { outcomes.push({ key: prKey(pr), ok: false, error: error.message }) }
  }
  return outcomes
}

// A run belongs to the PR's exact code (repo, number, head) and target branch,
// never a lookalike PR. The branch tip keeps moving as other work merges, so
// `exactBase` says whether the run saw the current tip instead of hiding it.
export function reviewForPull(runs, pr) {
  if (!pr.headRefOid || !pr.baseRefName) return null
  const matches = runs.flatMap(run => {
    const item = run.items?.find(item => item.repo.toLowerCase() === pr.repository.nameWithOwner.toLowerCase()
      && item.number === pr.number && item.head_sha === pr.headRefOid && item.base_ref === pr.baseRefName)
    return item ? [{ run, item, exactBase: !!baseTip(pr) && item.base_sha === baseTip(pr) }] : []
  })
  // Prefer the run on the current branch tip; otherwise the newest for this code.
  return matches.find(match => match.exactBase) || matches[0] || null
}

// The newest review of this PR at some other version, for when the PR has
// changed since it was reviewed: reviewForPull only matches the current head, and
// "never reviewed" would be wrong.
export function earlierReviewForPull(runs, pr) {
  const key = `${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`
  const matches = (runs || []).flatMap(run => (run.items || [])
    .filter(item => `${item.repo.toLowerCase()}#${item.number}` === key && item.head_sha !== pr.headRefOid)
    .map(item => ({ run, item })))
  return matches.sort((a, b) => Date.parse(b.run.created_at || '') - Date.parse(a.run.created_at || ''))[0] || null
}

// The PR machine's agent jobs (pr-machine.js) as the platform runs them. On your
// own PR a review is only ever a private check; Finish it for me and Take over
// are the same platform mode, told apart by whose PR it is (and Take over's reason).
// A raw mode (a retry, a saved link) passes through with its own defaults.
const PRIVATE = { post_review: false, propose_verdict: false, agent_submits_verdict: false }
const REVIEW_INTENTS = {
  review: { mode: 'review', options: PRIVATE },
  check_my_pr: { mode: 'review', options: PRIVATE },
  finish_it: { mode: 'review_fix_merge' },
  take_over: { mode: 'review_fix_merge' },
}
export function reviewIntent(choice) {
  const known = REVIEW_INTENTS[choice]
  return known ? { intent: choice, ...known } : { mode: choice }
}
