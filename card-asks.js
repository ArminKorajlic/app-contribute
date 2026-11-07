// "Fix in chat": which held or failed contribution a chat card asks this
// chat's agent to fix, and why (building-apps.md "Passive block sessions",
// `ask`). The card reports only `{id, code, rev}`; the host writes the whole
// owner message itself, one `contribute · <record id> · <code>` line per ref,
// and keys its message id on `rev`, the state being reported (askRev), and
// the contributing skill's card-asks.md says what the agent does for each
// code. Problems only the owner can fix (the GitHub connection) are not asks.
import { contributionScopeHash, qualityReviewFor } from './review.js'

export const ASK_CODES = Object.freeze(['commit_identity_mismatch', 'invalid_pr_text', 'publication_destination_unavailable',
  'needs_review', 'changes_needed', 'upstream_conflict', 'upstream_base_moved', 'source_changed', 'send_failed',
  'needs_attention', 'not_in_contribute', 'couldnt_check', 'restage', 'stack_incomplete', 'result_unknown'])
const ASKABLE = new Set(ASK_CODES)

// Connection codes are the owner's: the card offers the account, not an ask.
export const ACCOUNT_CODES = new Set(['github_reconnect'])

// Review-status and send-failure codes (mobius #2076) the card names as they
// are. Any other "needs refresh" means the reviewed source changed.
const NAMED = new Set(['commit_identity_mismatch', 'invalid_pr_text', 'publication_destination_unavailable',
  'upstream_conflict', 'upstream_base_moved'])

// The state an ask is about, as a lower-case hex token: the reviewed head for
// a held record, a digest of the last failure for a failed send (a new
// failure is a new state), a digest of the unconfirmed attempt for
// `result_unknown`, and of the id for a record that is gone. The same state
// always gives the same token, so the host posts its ask once; once the agent
// restages or the problem changes, the token changes and the owner can ask
// again.
const HEX = /^[0-9a-f]{7,64}$/
const digest = parts => contributionScopeHash(JSON.stringify(parts))
export function askRev(id, code, record = null, attempt = null) {
  if (code === 'result_unknown') return digest(['attempt', id, attempt?.id || '', attempt?.at || 0])
  if (!record) return digest(['missing', id])
  const head = String(record.plan?.head_sha || '')
  if (record.last_submit_error) {
    return digest(['failure', head, record.last_submit_error_code || '', record.last_submit_error, record.updated_at || ''])
  }
  return HEX.test(head) ? head : digest(['record', head, record.plan?.diff_sha256 || '', record.updated_at || ''])
}

// The ask for one held record, or null when the code is not an ask.
export const cardAsk = (id, code, rev) => ASKABLE.has(code) && HEX.test(String(rev)) ? { refs: [{ id, code, rev }] } : null

// Why one prepared record is held, as a stable code, from its own fields and
// its current source check (`reviewState`, null before a tap). The order
// follows send-readiness.js sendBlocker. '' when nothing here names a cause.
export function holdCode(record, reviewState = null) {
  if (!record) return 'not_in_contribute'
  if (record.status !== 'prepared') return ''
  if (reviewState?.state === 'needs_refresh') return NAMED.has(reviewState.code) ? reviewState.code : 'source_changed'
  if (record.last_submit_error) {
    const code = String(record.last_submit_error_code || '')
    return NAMED.has(code) || ACCOUNT_CODES.has(code) ? code : 'send_failed'
  }
  if (record.needs_attention === true) return 'needs_attention'
  const review = qualityReviewFor(record).state
  if (review !== 'all_clear') return review === 'changes_needed' ? 'changes_needed' : 'needs_review'
  if (reviewState?.state === 'unavailable') {
    return ACCOUNT_CODES.has(reviewState.code) || reviewState.code === 'publication_destination_unavailable' ? reviewState.code : 'couldnt_check'
  }
  return ''
}
