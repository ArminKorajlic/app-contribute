// Check GitHub on request: has a project's shared repository moved past the
// commit this Möbius last compared with?
//
// Source status is fetch-free by design (it only reads refs already on disk),
// so it cannot say whether GitHub moved since the last fetch. This module asks
// GitHub directly, read-only, through the existing /api/github/graphql proxy.
// It reports commits, never files: whether those commits change this
// installation is still the reconciliation answer, and Settings or the App
// Store own the actual update.
import { fetchLiveStates } from './api.js'

const COMMIT = /^[0-9a-f]{40}$/

function repoParts(slug) {
  const [owner, name, extra] = String(slug || '').split('/')
  return owner && name && !extra ? { owner, name } : null
}

// Installed, GitHub-backed projects with a known compared commit.
export function upstreamCheckTargets(projects) {
  return (projects || [])
    .filter(project => project?.available && project.kind !== 'external' && !project.builtHere)
    .filter(project => repoParts(project.canonical_repo) && COMMIT.test(project.base_sha || ''))
    .map(project => ({ key: project.key, repo: project.canonical_repo, base: project.base_sha }))
}

// One aliased GraphQL document. JSON.stringify gives exactly the GraphQL
// string escaping each value needs (the same idiom as buildRefreshQuery).
export function upstreamCheckQuery(targets) {
  if (!targets.length) return null
  const parts = targets.map((target, index) => {
    const { owner, name } = repoParts(target.repo)
    return `p${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) `
      + `{ defaultBranchRef { compare(headRef: ${JSON.stringify(target.base)}) { behindBy status } } }`
  })
  return 'query { ' + parts.join(' ') + ' }'
}

// key -> { newCommits, checkedAt } for every answered project. A missing,
// private or diverged answer is left out: no answer is not "up to date".
export function readUpstreamCheck(targets, data, checkedAt) {
  const results = {}
  targets.forEach((target, index) => {
    const compare = data?.[`p${index}`]?.defaultBranchRef?.compare
    if (!compare || !Number.isInteger(compare.behindBy)) return
    results[target.key] = { newCommits: compare.behindBy, checkedAt }
  })
  return results
}

// The whole online check. Returns { ok, results }; ok is false only when
// GitHub could not be asked at all.
export async function checkUpstream(token, projects, now = new Date().toISOString()) {
  const targets = upstreamCheckTargets(projects)
  const query = upstreamCheckQuery(targets)
  if (!query) return { ok: true, results: {} }
  const data = await fetchLiveStates(token, query)
  if (!data) return { ok: false, results: {} }
  return { ok: true, results: readUpstreamCheck(targets, data, now) }
}

// One sentence for the result of Check GitHub. `outcome` is what the screen's
// check returned: { ok } for the local reload plus `upstream` when GitHub was
// asked (null when GitHub is not connected).
export function upstreamCheckSummary(outcome, projects) {
  if (!outcome?.ok) return 'Could not reload this Möbius. Try again.'
  const upstream = outcome.upstream
  if (!upstream) return 'Reloaded. Connect GitHub to check it for new changes.'
  if (!upstream.ok) return 'Reloaded, but GitHub could not be reached.'
  const moved = (projects || [])
    .filter(project => upstream.results?.[project.key]?.newCommits > 0)
    .map(project => project.name)
  if (!moved.length) return 'Nothing new on GitHub.'
  const names = moved.length <= 2 ? moved.join(' and ') : `${moved.slice(0, 2).join(', ')} and ${moved.length - 2} more`
  return `New on GitHub: ${names}.`
}
