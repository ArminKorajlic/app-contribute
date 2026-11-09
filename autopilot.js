// Pure logic for the autopilot mirror: reading the ledger's display-only
// `autopilot` block, classifying which attention events autopilot handles, and
// narrating round state for the card. No React, no I/O.
//
// The `autopilot` block on a record is a ONE-WAY MIRROR the platform writes
// after every lifecycle transition (the source of truth is a platform DB row
// the app can't see or write). The app reads it only to render state; every
// action (Send grant, Pause/Resume, Retry) goes through a platform endpoint.
// Shape:
//   { enabled, granted_at, state: 'idle'|'responding', rounds_used,
//     last_round?: { finished_at, outcome, summary }, rounds: [ ... ] }

// Attention types the background loop can handle on its own. Anything else
// (or a paused/ungranted record) falls back to the classic notify path.
// `outside_activity` (a comment or review from someone who is not a repository
// owner, member or collaborator) is deliberately absent: strangers cannot start
// a round. job.sh classifies authors through github_events.py.
export const ACTIONABLE_ATTENTION = new Set([
  'changes_requested',
  'checks_failed',
  'github_activity',
])

// The escalation flag the platform sets when the agent must hand back to a
// human. This is the ONLY attention type that still notifies for an autopilot
// record (alongside merged/closed).
export const HUMAN_REQUIRED = 'human_required'

export function autopilotState(rec) {
  if (!rec || typeof rec !== 'object') return null
  const block = rec.autopilot
  return block && typeof block === 'object' ? block : null
}

export function isAutopilotEnabled(rec) {
  const block = autopilotState(rec)
  return !!(block && block.enabled)
}

// True while a background round is actively working this record.
export function isAutopilotResponding(rec) {
  const block = autopilotState(rec)
  return !!(block && block.enabled && block.state === 'responding')
}

// Whether this kind of attention is work an agent can handle. This capability
// is deliberately independent from the current autopilot grant: an ungranted
// record still belongs to Contribute's one private run rather than becoming a
// misleading human decision.
export function canAgentHandleAttention(rec) {
  const attention = rec && rec.attention
  const type = attention && attention.type
  if (type === HUMAN_REQUIRED) return false
  return typeof type === 'string' && ACTIONABLE_ATTENTION.has(type)
}

// Whether autopilot owns this record's current attention right now. Used by
// the UI to decide whether to show "autopilot will handle this" vs private-run
// work; job.sh makes the same decision server-side to route to /respond.
export function isActionableAttention(rec) {
  const block = autopilotState(rec)
  return !!(block && block.enabled && canAgentHandleAttention(rec))
}

// True when the record is waiting on the human (escalated). Leads the card with
// the human_required callout even for a granted record.
export function needsHuman(rec) {
  const attention = rec && rec.attention
  return !!(rec && rec.needs_attention && attention &&
    attention.type === HUMAN_REQUIRED)
}

// One plain-language line describing what autopilot is doing / last did. Returns
// '' when there is nothing autopilot-specific to say (caller omits the line).
export function autopilotNarration(rec) {
  const block = autopilotState(rec)
  if (!block || !block.enabled) return ''
  if (needsHuman(rec)) {
    const msg = rec.attention && rec.attention.message
    return msg ? String(msg) : 'Autopilot needs your input to continue.'
  }
  if (block.state === 'responding') {
    return 'Autopilot is responding to a review — no action needed.'
  }
  const last = block.last_round
  if (last && last.outcome) {
    if (last.outcome === 'pushed') return 'Autopilot pushed a fix for the last review.'
    if (last.outcome === 'replied') return 'Autopilot replied to the last review.'
    if (last.outcome === 'stale' || last.outcome === 'failed') {
      return 'Autopilot will retry the last review shortly.'
    }
    if (last.outcome === 'escalated') return 'Autopilot handed this back to you.'
  }
  return 'Autopilot is on — it will handle new reviews for you.'
}

// The rounds timeline for the card detail view. Newest first, each entry a
// plain-text {when, label, summary} — summaries are rendered WITHOUT markdown
// (they may quote untrusted reviewer text).
export function autopilotRounds(rec) {
  const block = autopilotState(rec)
  const rounds = block && Array.isArray(block.rounds) ? block.rounds : []
  const labelFor = (outcome) => {
    switch (outcome) {
      case 'pushed': return 'Pushed a fix'
      case 'replied': return 'Replied to review'
      case 'stale': return 'Round timed out'
      case 'failed': return 'Round failed'
      case 'escalated': return 'Handed to you'
      default: return 'Round'
    }
  }
  return rounds
    .slice()
    .reverse()
    .map((round) => ({
      when: String(round.finished_at || round.started_at || ''),
      label: labelFor(round.outcome),
      summary: typeof round.summary === 'string' ? round.summary : '',
    }))
}

// Headlines for the autopilot-specific attention types (merged into the app's
// PROBLEM_HEADLINES surface in domain.js).
export const AUTOPILOT_HEADLINES = {
  human_required: 'Autopilot needs your input to continue',
  merge_conflict: 'This contribution needs a refresh to merge cleanly',
}
