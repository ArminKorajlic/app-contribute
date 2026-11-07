// "Fix in chat": what a chat card asks this chat's agent to do for a held or
// failed contribution (building-apps.md "Passive block sessions", `ask`). The
// host sends `text` as the owner's own message and adds one line per ref,
// `contribute · <record id> · <code>`; the contributing skill's "Card asks"
// says what the agent does for each code. The text is built only from these
// fixed templates and the record's own title, never from a GitHub error or
// other outside text, and the host refuses anything that is not one plain
// line. Problems only the owner can fix (the GitHub connection) are not asks.
import { qualityReviewFor } from './review.js'

export const ASK_LABEL = 'Fix in chat'

// code -> the request, given the contribution's title (already quoted).
const TEMPLATES = Object.freeze({
  commit_identity_mismatch: t => `Fix ${t}: its commit is not by the connected GitHub account. Recommit it with that identity and stage it again.`,
  invalid_pr_text: t => `Fix ${t}: GitHub cannot publish its title or description exactly as written. Correct them and stage it again.`,
  publication_destination_unavailable: t => `Check ${t}: GitHub could not confirm where it would be published.`,
  needs_review: t => `Review ${t}: this exact version has no all clear review yet.`,
  changes_needed: t => `Fix ${t}: its review asked for changes.`,
  upstream_conflict: t => `Fix ${t}: upstream moved and it no longer applies cleanly.`,
  upstream_base_moved: t => `Update ${t}: upstream moved since it was reviewed.`,
  source_changed: t => `Refresh ${t}: its reviewed source changed.`,
  send_failed: t => `Fix ${t}: its last send did not go through.`,
  needs_attention: t => `Check ${t}: it needs attention before it can be sent.`,
  not_in_contribute: t => `Find ${t}: this card names it, but it is no longer in Contribute.`,
  couldnt_check: t => `Check ${t}: this card could not read it.`,
  restage: t => `Stage ${t} again: its saved size or version is incomplete.`,
  stack_incomplete: t => `Fix ${t}: this card does not list every layer of its stack.`,
  result_unknown: t => `Check ${t}: GitHub has not confirmed whether its send went through.`,
})
export const ASK_CODES = Object.freeze(Object.keys(TEMPLATES))

// Connection codes are the owner's: the card offers the account, not an ask.
export const ACCOUNT_CODES = new Set(['github_reconnect'])

// Review-status and send-failure codes (mobius #2076) the card names as they
// are. Any other "needs refresh" means the reviewed source changed.
const NAMED = new Set(['commit_identity_mismatch', 'invalid_pr_text', 'publication_destination_unavailable',
  'upstream_conflict', 'upstream_base_moved'])

// A title as one plain line the host accepts: nothing a chat message would
// render as markup, a link or a mention, and no control characters.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff<>[\]{}`*_~#|\\@]/g
export function askTitle(value) {
  const plain = String(value ?? '').replace(UNSAFE, ' ').replace(/:\/\//g, ' ').replace(/www\./gi, 'www ')
    .replace(/\s+/g, ' ').trim().slice(0, 120).trim()
  return plain ? `“${plain}”` : 'this contribution'
}

// The ask for one held record, or null when the code is not an ask.
export function cardAsk(id, code, title) {
  const template = TEMPLATES[code]
  if (!template) return null
  return { label: ASK_LABEL, text: template(askTitle(title)), refs: [{ id, code }] }
}

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
