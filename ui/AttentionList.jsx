import { useState } from 'react'
import { runUnitRecords } from '../run.js'
import { Icon } from './Icons.jsx'
import { TimeAgo } from './GithubParts.jsx'

// Why a contribution is in To look at. A blocker stops the PR from merging;
// news is feedback to read. `key` names the colour (see .is-<key> in the
// stylesheet): one general icon, a different colour per reason. Every button
// only opens the saved detail, so its label says what it opens, never that it
// fixes anything.
const ATTENTION_REASONS = {
  merge_conflict: { key: 'conflict', label: 'Merge blocked', tone: 'blocker', action: 'Review conflict' },
  checks_failed: { key: 'checks', label: 'Checks failing', tone: 'blocker', action: 'Review checks' },
  changes_requested: { key: 'changes', label: 'Changes requested', tone: 'blocker', action: 'View PR' },
  github_activity: { key: 'feedback', label: 'New feedback', tone: 'news', action: 'View PR' },
}
// Decisions about publishing itself, whatever the record's GitHub attention.
const KIND_REASONS = {
  ready_attention: { key: 'ready', label: 'Not marked ready', tone: 'blocker', action: 'Review' },
  route_attention: { key: 'route', label: 'Choose where to send', tone: 'blocker', action: 'Choose' },
}
const FEEDBACK = ATTENTION_REASONS.github_activity
const DECISION = { key: 'decision', label: 'Needs your decision', tone: 'blocker', action: 'Open' }

export function lookAtReason(item) {
  return KIND_REASONS[item?.kind]
    || ATTENTION_REASONS[item?.record?.attention?.type]
    || (item?.kind === 'private_review' ? FEEDBACK : DECISION)
}

// Blockers before news, so newer comments never push an older conflict out
// of view. Within each tone the run's own (newest first) order is kept.
export function byUrgency(items) {
  const rank = item => lookAtReason(item).tone === 'blocker' ? 0 : 1
  return [...items].sort((a, b) => rank(a) - rank(b))
}

// A related group is one row; name the PR the reason is about and its group.
export function groupNote(item) {
  const records = runUnitRecords(item)
  if (records.length < 2) return ''
  const numbers = records.map(record => record?.number).filter(Boolean).map(number => `#${number}`)
  const affected = item?.record?.number ? `On #${item.record.number} · ` : ''
  return `${affected}${records.length} related PRs${numbers.length ? `: ${numbers.join(', ')}` : ''}`
}

// One thing that needs the owner: a colour-coded icon, the PR on one line, why
// on the second. The whole row opens it.
export function AttentionRow({ item, heading, onSelect }) {
  const reason = lookAtReason(item)
  const detectedAt = item.record?.attention?.detected_at
  const group = groupNote(item)
  const why = [group, item.detail].filter(Boolean).join(' · ')
  return (
    <button type="button" className={'co-attention-row is-' + reason.tone + ' is-' + reason.key} onClick={() => onSelect?.(item)}>
      <Icon name="info" size={18} />
      <span className="co-attention-main">
        <strong>{heading(item)}</strong>
        <small><span className="co-attention-reason">{reason.label}</span>{why ? <>{why}</> : null}{detectedAt ? <>{why ? ' · ' : ''}<TimeAgo value={detectedAt} /></> : null}</small>
      </span>
      <Icon name="right" size={16} className="co-attention-go" />
      <span className="co-visually-hidden">{reason.action}</span>
    </button>
  )
}

const VISIBLE_ROWS = 3

// What on the owner's tracked contributions needs them, blockers first. Review
// requests and agent questions keep their own places below.
// What is waiting, counted by reason and ordered by urgency, so the folded bar
// can say "1 changes requested, 4 new feedback" without picking a PR.
function reasonCounts(items) {
  const counts = new Map()
  for (const item of byUrgency(items)) {
    const reason = lookAtReason(item)
    counts.set(reason.key, { reason, count: (counts.get(reason.key)?.count || 0) + 1 })
  }
  return [...counts.values()]
}

// Nothing to look at renders nothing: an empty bar would read as an all-clear
// the app cannot prove (GitHub may be unreachable or partly loaded).
export function AttentionList({ items = [], heading, onSelect }) {
  const [showAll, setShowAll] = useState(false)
  if (!items.length) return null
  const ordered = byUrgency(items)
  const shown = showAll ? ordered : ordered.slice(0, VISIBLE_ROWS)
  const rest = items.length - VISIBLE_ROWS
  return (
    <details className="co-attn co-look-at" aria-label="To look at">
      <summary>
        <b className="co-attn-count">{items.length}</b>
        <span className="co-attn-text">
          <strong>{items.length === 1 ? '1 thing needs you' : `${items.length} things need you`}</strong>
          <span className="co-attn-sum">{reasonCounts(items).map(({ reason, count }) => <span key={reason.key} className={'co-attn-rs is-' + reason.key}><i aria-hidden="true" /><b>{count}</b> {reason.label.toLowerCase()}</span>)}</span>
        </span>
        <span className="co-attn-toggle"><span className="co-attn-show">{items.length === 1 ? 'Show' : `Show ${items.length}`}</span><span className="co-attn-hide">Hide</span><Icon name="chevron" size={14} /></span>
      </summary>
      <div className="co-run-list">{shown.map(item => <AttentionRow key={item.id} item={item} heading={heading} onSelect={onSelect} />)}</div>
      {rest > 0 ? <button type="button" className="co-attn-more" onClick={() => setShowAll(!showAll)}><Icon name="chevron" size={14} />{showAll ? 'Show fewer' : rest === 1 ? 'Show the other one' : `Show the other ${rest}`}</button> : null}
    </details>
  )
}
