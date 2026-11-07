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

// The state an ask is about, as a lower-case hex token: a digest of the code
// and exactly the fields that define that cause, never a record-wide
// timestamp. The host keys its message id on it, so an unchanged problem is
// asked about once, and a changed one (a restage, new text, a new review,
// another attention cause, another failed attempt) can be asked about again.
const HEX = /^[0-9a-f]{7,64}$/
const digest = parts => contributionScopeHash(JSON.stringify(parts))
const source = plan => [plan.head_sha || '', plan.base_sha || '', plan.diff_sha256 || '']
const text = plan => [plan.title || '', plan.body_draft || '']
const review = record => { const value = record.quality_review || {}; return [value.state || '', value.reviewed_head_sha || '', value.summary || ''] }
const CAUSE = {
  invalid_pr_text: record => [...source(record.plan || {}), ...text(record.plan || {})],
  needs_review: record => [...source(record.plan || {}), ...text(record.plan || {}), ...review(record)],
  changes_needed: record => [...source(record.plan || {}), ...text(record.plan || {}), ...review(record)],
  needs_attention: record => [...source(record.plan || {}), record.attention?.type || '', record.attention?.key || ''],
  restage: record => [...source(record.plan || {}), record.plan?.diff_stat || '', record.plan?.repo || record.repo || '', record.plan?.branch || record.branch || ''],
  stack_incomplete: record => [...source(record.plan || {}), record.plan?.stack?.id || '', record.plan?.stack?.position || 0, record.plan?.stack?.total || 0],
}
// A failed send is one attempt: the platform stamps `submit_started_at` and
// the attempt's input digest when it claims the record, and later unrelated
// writes keep them. A record from before those fields falls back to the
// failure's own head, code and message.
function failure(record) {
  const started = record.submit_started_at || ''
  return started
    ? ['attempt', started, record.personal_submit_input_sha256 || '', record.last_submit_error_code || '']
    : ['failure', record.plan?.head_sha || '', record.last_submit_error_code || '', record.last_submit_error || '']
}
export function askRev(id, code, record = null, attempt = null) {
  if (code === 'result_unknown') return digest([code, id, attempt?.id || '', attempt?.at || 0])
  if (!record) return digest([code, id])
  if (record.last_submit_error && (code === 'send_failed' || code === record.last_submit_error_code)) return digest([code, ...failure(record)])
  return digest([code, ...(CAUSE[code] || (value => source(value.plan || {})))(record)])
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
