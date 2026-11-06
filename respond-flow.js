// What Post and Discard do. Neither posts anything: Post writes the owner's approval and tells the chat to run the helper, which
// checks the approval itself; Discard writes the decision that takes the answer off the PR.
import { respondScope } from './address-feedback.js'
import { clearDecision, readFreshResult, writeDecision } from './respond-store.js'
import { postMessage } from './respond-result.js'
import { deliverCycleMessage } from './cycle-delivery.js'
import { NAMES } from './names.js'

const here = () => new Date().toISOString()

// The answer on the server, only if it is the one on screen (`digest`). `ok: false` says what to tell the owner.
async function currentAnswer(slug, digest, storage) {
  const result = await readFreshResult(slug, storage)
  if (!result) return { ok: false, error: 'This answer is no longer saved.' }
  if (result.digest !== digest) return { ok: false, error: 'This answer changed while you were reading it. Read it again.' }
  return { ok: true, result }
}

// Where the PR may be for this answer to go out: where it was built, or (after a stopped post) where the push left it.
const placedFor = (result, pr) => (result.state === 'ready' ? [result.pr.head_sha] : [result.pr.head_sha, result.tip_sha]).includes(pr?.headRefOid)

// Why Post cannot start right now, or ''. A stopped post can be tried again; one that is running or done cannot.
function blocker(result, pr, chat) {
  if (!['ready', 'failed'].includes(result.state)) return result.state === 'posted' ? 'This answer was already posted.' : 'This answer is already being posted.'
  if (!placedFor(result, pr)) return `The PR changed after this answer was written. ${NAMES.respondAgain}.`
  if (chat?.state === 'running') return 'The agent is working on this PR right now. Wait for it to finish.'
  if (chat?.state === 'needs_answer') return `The conversation is waiting for your answer to its own card. Answer it in the chat first, then press ${NAMES.postAnswer}.`
  return ''
}

// A refusal that says the chat did not take the message at all (a status, or a deleted conversation), as against a lost connection.
const refused = delivery => Boolean(delivery.status || delivery.gone)

// `again`: the first message may not have woken the chat, or the post stopped; a new message id, because the same id is a duplicate
// the platform drops. The helper never posts a step twice, so a second message is harmless.
export async function approveResponse({ slug, digest, pr, chat = null, token, storage, again = false, deliver = deliverCycleMessage, now = here }) {
  const current = await currentAnswer(slug, digest, storage)
  if (!current.ok) return current
  const { result } = current
  const reason = blocker(result, pr, chat)
  if (reason) return { ok: false, error: reason }
  const written = await writeDecision(slug, { result_id: result.id, digest: result.digest, decision: 'approved', at: now() }, storage)
  if (!written.ok) return written
  const delivery = await deliver(token, { scope: respondScope(result.repo, result.number), cid: again ? `respond-retry-${result.id}-${Date.now()}` : `respond-post-${result.id}`, title: `Respond to feedback on #${result.number}`,
    scopeLabel: `Respond to feedback on ${result.repo} #${result.number}`, draft: postMessage(result), chatId: result.chat_id, applyModel: false })
  if (delivery.ok) return { ok: true }
  // The chat definitely did not take it: nothing may stay approved. If it may have, the approval stays so Send again can finish it.
  if (refused(delivery)) { await clearDecision(slug, storage); return { ok: false, error: delivery.error } }
  return { ok: false, unsure: true, error: delivery.error }
}

export async function discardResponse({ slug, digest, storage, now = here }) {
  const current = await currentAnswer(slug, digest, storage)
  if (!current.ok) return current
  if (current.result.state !== 'ready') return { ok: false, error: 'This answer is being posted, so it cannot be discarded.' }
  return writeDecision(slug, { result_id: current.result.id, digest: current.result.digest, decision: 'discarded', at: now() }, storage)
}
