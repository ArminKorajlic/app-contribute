// GitHub owns people, permissions and assignments. Contribute owns the private
// review journey; a repository role never becomes an automatic merge grant.
import { fetchLiveStates } from './api.js'

export const PR_FIELDS = `id number title url headRefOid headRefName baseRefName baseRefOid baseRef { target { oid } } isDraft
  additions deletions changedFiles createdAt updatedAt
  author { login } assignees(first:100) { nodes { login } }
  repository { nameWithOwner viewerPermission }
  headRepository { nameWithOwner viewerPermission isArchived }
  labels(first:20) { nodes { name color } totalCount }
  comments { totalCount }
  commits(last:1) { nodes { commit { statusCheckRollup { state contexts {
    totalCount checkRunCountsByState { state count } statusContextCountsByState { state count }
  } } } } }
  reviewDecision mergeable`
export const mayAssign = permission => ['TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].includes(permission)
export const mayMerge = permission => ['WRITE', 'MAINTAIN', 'ADMIN'].includes(permission)
// This is discovery, not authority: the server rechecks exact repositories at
// admission and before publication. Older snapshots still need that preflight.
export const TAKEOVER_SCOPE = 'named_pr_repairs_and_reviewed_successors'
export const DRAFT_TAKEOVER_SCOPE = 'named_pr_repairs_ready_and_reviewed_successors'
// One draft-scope decision for the chooser, its labels and the start body.
export const takeoverScope = pulls => pulls.some(pr => pr.isDraft) ? DRAFT_TAKEOVER_SCOPE : TAKEOVER_SCOPE
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
export const prKey = pr => `${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`
export const mergeSelection = (old, next) => [...new Map([...old, ...next].map(pr => [prKey(pr), pr])).values()]
export function matchingPulls(pulls, filter, login) {
  const same = value => value?.toLowerCase() === login?.toLowerCase()
  return pulls.filter(pr => filter === 'unassigned' ? !pr.assignees?.nodes?.length
    : filter === 'assigned' ? pr.assignees?.nodes?.some(user => same(user.login))
      : filter === 'authored' ? same(pr.author?.login) : true)
}

async function graph(token, query) {
  const result = await fetchLiveStates(token, query)
  if (!result) throw new Error('Could not check GitHub. Refresh to try again.')
  return result
}
export async function discoverRepositories(token, cursor = null) {
  const data = await graph(token, `query ContributeRepositories { viewer { repositories(first:100,
    affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER], orderBy:{field:UPDATED_AT,direction:DESC},
    after:${JSON.stringify(cursor)}) { nodes { nameWithOwner viewerPermission isArchived pullRequests(states:OPEN) { totalCount } }
    pageInfo { hasNextPage endCursor } } } }`)
  if (!data.viewer?.repositories) throw new Error('GitHub did not return repository access. Refresh to try again.')
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
  if (!data.search) throw new Error('GitHub did not return pull requests. Refresh to try again.')
  return { pulls: data.search.nodes.filter(pr => pr?.repository?.nameWithOwner && pr.headRefOid),
    total: data.search.issueCount, ...data.search.pageInfo }
}
// Re-read one exact PR identity without scanning all open PR pages.
export async function discoverPull(token, repo, number) {
  const name = repositoryName(repo)
  if (!name || !Number.isSafeInteger(number) || number < 1) throw new Error('Choose a valid pull request.')
  const [owner, project] = name.split('/')
  const data = await graph(token, `query ContributeExactPull { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(project)}) { pullRequest(number:${number}) { ${PR_FIELDS} state mergedAt } } }`)
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
  if (!response.ok) throw Object.assign(new Error(response.status === 404
    ? 'These controls need the companion Möbius update to be activated.'
    : typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Could not complete this action. Refresh before retrying.'),
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

export const REVIEW_STATE_NAMES = { reviewing: 'Reviewing', repairing:'Fixing review findings', pushing:'Sending scoped fix', marking_ready:'Marking ready for review', ready_unknown:'Readiness outcome needs checking', push_unknown:'Fix outcome needs checking', pending: 'Waiting to review', all_clear: 'Review clear', needs_you: 'Needs you', merged: 'Merged', queued: 'In merge queue', failed: 'Failed', starting: 'Starting', merging: 'Merging', merge_unknown: 'Outcome needs checking', complete: 'Complete', stopped: 'Stopped', interrupted:'Interrupted', paused: 'Paused', awaiting_owner: 'Waiting for your answer' }

// One derivation of run and item progress for every run view. Execution
// belongs to the conversation; saved verdicts and public receipts survive it.
const SETTLED_ITEMS = new Set(['all_clear', 'merged', 'queued', 'complete'])
const HALTED_RUNS = new Set(['stopped', 'failed', 'interrupted'])
export const reviewRunStateLabel = run => REVIEW_STATE_NAMES[run.execution_state] || REVIEW_STATE_NAMES[run.state] || run.state
export function reviewItemProgress(run, item) {
  const settled = SETTLED_ITEMS.has(item.state)
  const halted = !settled && HALTED_RUNS.has(run.execution_state)
  const waiting = !settled && run.execution_state === 'awaiting_owner'
  return { label: halted ? 'Not finished' : REVIEW_STATE_NAMES[item.state] || item.state, halted, waiting, settled }
}
export const reviewRunHalted = run => run.state !== 'complete' && HALTED_RUNS.has(run.execution_state)

// Public outcomes a run saved before GitHub settled them. The server's observe
// step is read-only reconciliation, so the view settles them itself: a queued
// PR reads as merged even while its conversation waits on the owner or stopped.
const UNSETTLED = new Set(['queued', 'merging', 'merge_unknown', 'pushing', 'push_unknown', 'marking_ready', 'ready_unknown'])
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
// takeover enforces them; the post-review grant only for Review, and only when
// chosen. Automatic continuation is not supported, so it is never sent.
export function requestOptions(options, mode) {
  const value = options || {}
  const prompt = key => typeof value[key] === 'string' && value[key].trim() ? { [key]: value[key] } : {}
  return {
    ...prompt('review_prompt'), ...prompt('merge_prompt'),
    ...(mode === 'review_fix_merge' ? {
      ...prompt('fix_prompt'),
      ...(Number.isSafeInteger(value.max_rounds) && value.max_rounds >= 1 ? { max_rounds: value.max_rounds } : {}),
    } : {}),
    ...(mode === 'review' && value.post_review === true ? { post_review: true } : {}),
  }
}

export function reviewRunRequest(choice) {
  return {
    request_id: choice.request_id, mode: choice.mode,
    // A legacy selection without a scope never acquires draft readiness.
    ...(choice.mode === 'review_fix_merge' ? { confirmation_scope:choice.confirmation_scope || TAKEOVER_SCOPE } : {}),
    ...(choice.options ? { options:requestOptions(choice.options, choice.mode) } : {}),
    ...(choice.preview_sha256 ? { preview_sha256:choice.preview_sha256 } : {}),
    ...(choice.agent ? { agent:choice.agent } : {}),
    items: choice.pulls.map(pr => {
      if (!baseTip(pr)) throw new Error(`Couldn’t read the target branch of #${pr.number}. Refresh and try again.`)
      return { repo: pr.repository.nameWithOwner, number: pr.number,
        head_sha: pr.headRefOid, base_ref: pr.baseRefName, base_sha: baseTip(pr) }
    }),
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
