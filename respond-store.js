// Reading the saved Respond-to-feedback results and writing the owner's decision, through the app's storage.
// The helper writes `respond-results/`; the app writes `respond-decisions/`; neither writes the other's folder.
import { DECISION_FOLDER, RESULT_FOLDER, normalizeDecision, normalizeResult, resultSlug } from './respond-result.js'

const storageOf = () => window.mobius.storage

// Every .json file of a folder, by file name. A body the listing left out (too large for its page) is read on its own.
async function readFolder(storage, prefix) {
  const listing = await storage.listWithStatus(prefix, { includeContent: true })
  if (listing?.complete !== true) throw new Error('Responses could not be read completely')
  const files = new Map()
  for (const entry of listing.entries || []) {
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
    const content = Object.prototype.hasOwnProperty.call(entry, 'content') ? entry.content : await storage.get(entry.path || prefix + entry.name)
    files.set(entry.name, content)
  }
  return files
}

// Every saved response with the owner's decision about it: `{ slug, result, decision }`. Throws when the folders cannot be read
// completely, so a screen keeps what it last knew instead of showing nothing.
export async function loadResponses(storage = storageOf()) {
  const [results, decisions] = await Promise.all([readFolder(storage, RESULT_FOLDER), readFolder(storage, DECISION_FOLDER)])
  const responses = []
  for (const [name, raw] of results) {
    const result = normalizeResult(raw)
    // A file only counts under its own PR's name, so a stray or renamed file can never speak for another PR.
    if (!result || name !== `${resultSlug(result.repo, result.number)}.json`) continue
    responses.push({ slug: name.slice(0, -'.json'.length), result, decision: normalizeDecision(decisions.get(name)) })
  }
  return responses
}

// The result as the server holds it right now, for a decision that publishes. An offline answer is not trusted.
export async function readFreshResult(slug, storage = storageOf()) {
  const loaded = await storage.getWithVersion(`${RESULT_FOLDER}${slug}.json`)
  return loaded?.offline ? null : normalizeResult(loaded?.value)
}

// The owner's decision, accepted only when the server has it: the helper reads it from disk before it posts anything.
export async function writeDecision(slug, { result_id: resultId, digest, decision, at }, storage = storageOf()) {
  try {
    const receipt = await storage.durableWrite(`${DECISION_FOLDER}${slug}.json`, { version: 1, result_id: resultId, digest, decision, at })
    return receipt?.durability === 'synced' ? { ok: true } : { ok: false, error: 'This decision was not saved online. Sync before trying again.' }
  } catch {
    return { ok: false, error: 'This decision could not be saved. Sync and try again.' }
  }
}

export async function clearDecision(slug, storage = storageOf()) {
  try { await storage.remove(`${DECISION_FOLDER}${slug}.json`) } catch { /* the helper only ever acts on an approval for the exact answer, so a left-over one is harmless */ }
}
