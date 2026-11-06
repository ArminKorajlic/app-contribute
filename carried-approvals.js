// Marks each approval of an older commit, in a GitHub answer, with whether the PR's own work is still the same
// (`sameWork`: true, false or null; see same-work.js). Every read of PRs passes through api.js fetchLiveStates, so
// every screen sees the same marks and decides alike. Marking is only ever an addition: an unmarked approval stays
// old, so a failure here must never fail the read it rides on.
import { githubRead } from './pull-details.js'
import { mayWrite } from './pr-machine.js'
import { sameWorkOf } from './same-work.js'

// An answer is about commits and cannot change, so it is asked once, even by two reads at the same time. A null (a
// failed or cut-off read) is asked again only after a while: some never succeed (a commit a force-push removed, a
// PR of hundreds of files), and every poll would repeat them.
const RETRY_NULL_AFTER_MS = 5 * 60 * 1000
const asked = new Map()
// A comparison that hangs reads as null instead of holding up the PR list it rides on, and one read starts only so
// many new ones (a few PRs is the usual; the rest are asked on the next read).
const COMPARE_TIMEOUT_MS = 12000
const MAX_NEW_LOOKUPS_PER_READ = 12

// The base's current tip, as the platform compares against it (collaboration.js baseTip, which this file cannot import).
const baseTipOf = pull => pull.baseRef?.target?.oid || pull.baseRefOid

const compareAgainst = (token, repo, base, commit) => githubRead(token, `repos/${repo}/compare/${base}...${commit}`, AbortSignal.timeout(COMPARE_TIMEOUT_MS))

async function lookup(token, pull, approvedCommit) {
  const repo = pull.repository.nameWithOwner
  try {
    const [approved, head] = await Promise.all([approvedCommit, pull.headRefOid].map(commit => compareAgainst(token, repo, baseTipOf(pull), commit)))
    return sameWorkOf(approved, head)
  } catch {
    return null
  }
}

function sameWorkFor(token, pull, approvedCommit) {
  const key = lookupKey(pull, approvedCommit)
  const known = asked.get(key)
  if (known && !(known.nullAt && Date.now() - known.nullAt >= RETRY_NULL_AFTER_MS)) return known.answer
  const entry = { answer: lookup(token, pull, approvedCommit).then(answer => { if (answer === null) entry.nullAt = Date.now(); return answer }), nullAt: 0 }
  asked.set(key, entry)
  return entry.answer
}

const isPull = value => value && typeof value === 'object' && typeof value.headRefOid === 'string' && Array.isArray(value.latestOpinionatedReviews?.nodes)
function pullsIn(value, found = [], depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return found
  if (isPull(value)) found.push(value)
  else Object.values(value).forEach(inner => pullsIn(inner, found, depth + 1))
  return found
}

// An approval the machine would count if it were of this version: someone else's, not a bot's.
const countable = (pull, node) => node?.state === 'APPROVED' && !!node.commit?.oid && node.author?.__typename !== 'Bot'
  && node.author?.login?.toLowerCase() !== pull.author?.login?.toLowerCase()
const atHead = (pull, node) => node.commit.oid === pull.headRefOid

// Only an open PR the viewer can merge, with no countable approval of this exact version, is in question; its
// countable approvals of older commits are what gets compared.
function approvalsToCompare(pull) {
  if (pull.state !== 'OPEN' || !baseTipOf(pull) || !pull.repository?.nameWithOwner || !mayWrite(pull.repository.viewerPermission)) return []
  const approvals = pull.latestOpinionatedReviews.nodes.filter(node => countable(pull, node))
  return approvals.some(node => atHead(pull, node)) ? [] : approvals
}

const lookupKey = (pull, commit) => `${pull.repository.nameWithOwner}|${baseTipOf(pull)}|${commit}|${pull.headRefOid}`.toLowerCase()

export async function markCarriedApprovals(token, data) {
  try {
    const pairs = pullsIn(data).flatMap(pull => approvalsToCompare(pull).map(node => ({ pull, node })))
    // What was asked already costs nothing; only new questions count against the cap.
    let fresh = 0
    const wanted = pairs.filter(({ pull, node }) => asked.has(lookupKey(pull, node.commit.oid)) || ++fresh <= MAX_NEW_LOOKUPS_PER_READ)
    await Promise.all(wanted.map(async ({ pull, node }) => { node.sameWork = await sameWorkFor(token, pull, node.commit.oid) }))
  } catch {
    // An approval left unmarked is read as old, which is safe.
  }
  return data
}

export const forgetSameWork = () => asked.clear()
