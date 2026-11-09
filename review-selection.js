import { fetchLiveStates } from './api.js'
import { mayMerge, requestOptions, takeoverBlocker, TAKEOVER_SCOPE } from './collaboration.js'
import { workflowAgent } from './review-prompts.js'

// An older saved link may still name the draft-ready scope. It still opens, and its start
// sends only the one repair scope (reviewRunRequest): a takeover never readies a draft now.
const OLDER_DRAFT_SCOPE = 'named_pr_repairs_ready_and_reviewed_successors'

const ID = /^[A-Za-z0-9_-]{8,64}$/
const SHA = /^[a-f0-9]{40}$/
export function reviewSelectionIdFromIntent(intent) {
  const match = /^review-selection:([A-Za-z0-9_-]{8,64})$/.exec(String(intent || ''))
  return match?.[1] || null
}

// Saved selection data is a proposal. It contains neither consent nor a grant.
export function selectedReviewRequest(value, id) {
  if (!ID.test(id) || value?.request_id !== id || !['review', 'review_merge', 'review_fix_merge'].includes(value?.mode)
      || !Array.isArray(value.items) || !value.items.length || value.items.length > 20) throw new Error('This review link is invalid. Ask the agent to prepare it again.')
  const items = value.items.map(item => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(item.repo) || !Number.isInteger(item.number) || item.number < 1
        || !SHA.test(item.head_sha) || !SHA.test(item.base_sha) || typeof item.base_ref !== 'string' || !item.base_ref || item.base_ref.length > 256) throw new Error('This review link is incomplete. Ask the agent to prepare it again.')
    return { repo: item.repo.toLowerCase(), number: item.number, head_sha: item.head_sha, base_ref: item.base_ref, base_sha: item.base_sha }
  }).sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number)
  if (new Set(items.map(item => `${item.repo}#${item.number}`)).size !== items.length) throw new Error('This review link repeats a pull request.')
  const proposed = { request_id: id, mode: value.mode, items }
  if (value.confirmation_scope) {
    if (value.mode !== 'review_fix_merge' || ![TAKEOVER_SCOPE, OLDER_DRAFT_SCOPE].includes(value.confirmation_scope)) throw new Error('This review link has an invalid permission scope.')
    proposed.confirmation_scope = value.confirmation_scope
  }
  // Only what this mode's frozen preview can carry; anything else is dropped. A link never
  // carries "Agent posts": that is the owner's own choice in the review window.
  if (value.options) {
    const { agent_submits_verdict: ignored, ...options } = requestOptions(value.options, value.mode)
    proposed.options = options
  }
  if (value.agent) proposed.agent = workflowAgent(value.agent)
  if (value.preview_sha256) {
    if (!/^[a-f0-9]{64}$/.test(value.preview_sha256)) throw new Error('This review link has an incomplete prompt snapshot. Ask the agent to prepare it again.')
    proposed.preview_sha256 = value.preview_sha256
  }
  return proposed
}

export async function loadReviewSelection(id) {
  if (!ID.test(id)) throw new Error('Invalid review link.')
  const { value } = await window.mobius.storage.getWithVersion(`review-selections/${id}.json`)
  return selectedReviewRequest(value, id)
}

export async function inspectReviewSelection(token, request) {
  const fields = request.items.map((item, index) => {
    const [owner, name] = item.repo.split('/')
    return `p${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { nameWithOwner viewerPermission isArchived pullRequest(number:${item.number}) { number title url state isDraft headRefOid baseRefName baseRefOid baseRef { target { oid } } headRepository { nameWithOwner viewerPermission isArchived } } }`
  }).join('\n')
  const data = await fetchLiveStates(token, `query ContributeReviewSelection { ${fields} }`)
  if (!data) throw new Error('Could not check these contributions. Retry when GitHub is available.')
  const pulls = request.items.map((item, index) => {
    const repository = data[`p${index}`]
    const pr = repository?.pullRequest
    if (!pr || repository.nameWithOwner?.toLowerCase() !== item.repo || pr.number !== item.number
        || pr.state !== 'OPEN' || pr.headRefOid !== item.head_sha || pr.baseRef?.target?.oid !== item.base_sha || pr.baseRefName !== item.base_ref) throw new Error('A selected contribution changed or closed. Ask the agent for a fresh review link; nothing was approved.')
    return { ...pr, repository: { nameWithOwner: repository.nameWithOwner, viewerPermission: repository.isArchived ? null : repository.viewerPermission } }
  })
  return { ...request, pulls, canMerge: request.mode === 'review_fix_merge' ? !takeoverBlocker(pulls) : pulls.every(pr => !pr.isDraft && mayMerge(pr.repository.viewerPermission)) }
}
