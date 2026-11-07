// "Fix in chat": which held or failed contribution a chat card asks this
// chat's agent to fix, and why (building-apps.md "Passive block sessions",
// `ask`). The card reports only `{id, code}`; the host writes the whole owner
// message itself, one `contribute · <record id> · <code>` line per ref, and
// the contributing skill's card-asks.md says what the agent does for each
// code. Problems only the owner can fix (the GitHub connection) are not asks.
import { qualityReviewFor } from './review.js'

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

// The ask for one held record, or null when the code is not an ask.
export const cardAsk = (id, code) => ASKABLE.has(code) ? { refs: [{ id, code }] } : null

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
