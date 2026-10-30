import { useState } from 'react'
import { runUnitRecords } from '../run.js'
import { Icon } from './Icons.jsx'
import { TimeAgo } from './GithubParts.jsx'

// Why a contribution is in To look at. A blocker stops the PR from merging;
// news is feedback to read. Every button only opens the saved detail, so its
// label says what it opens, never that it fixes anything.
const ATTENTION_REASONS = {
  merge_conflict: { label: 'Merge blocked', tone: 'blocker', icon: 'fix', action: 'Review conflict' },
  checks_failed: { label: 'Checks failing', tone: 'blocker', icon: 'fix', action: 'Review checks' },
  changes_requested: { label: 'Changes requested', tone: 'blocker', icon: 'feedback', action: 'Read feedback' },
  github_activity: { label: 'New feedback', tone: 'news', icon: 'feedback', action: 'Read feedback' },
}
// Decisions about publishing itself, whatever the record's GitHub attention.
const KIND_REASONS = {
  ready_attention: { label: 'Not marked ready', tone: 'blocker', icon: 'info', action: 'Review' },
  route_attention: { label: 'Choose where to send', tone: 'blocker', icon: 'send', action: 'Choose' },
}
const FEEDBACK = ATTENTION_REASONS.github_activity
const DECISION = { label: 'Needs your decision', tone: 'blocker', icon: 'info', action: 'Open' }

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

function AttentionRow({ item, heading, onSelect }) {
  const reason = lookAtReason(item)
  const detectedAt = item.record?.attention?.detected_at
  const group = groupNote(item)
  return (
    <article className={'co-attention-row is-' + reason.tone}>
      <Icon name={reason.icon} size={18} />
      <button type="button" className="co-attention-main" onClick={() => onSelect?.(item)}>
        <span className="co-attention-reason">{reason.label}</span>
        <strong>{heading(item)}</strong>
        {item.detail ? <small>{item.detail}</small> : null}
        {group || detectedAt ? <small className="co-attention-meta">
          {group}{group && detectedAt ? ' · ' : ''}{detectedAt ? <TimeAgo prefix="Detected " value={detectedAt} /> : null}
        </small> : null}
      </button>
      <button type="button" className="co-run-row-action" onClick={() => onSelect?.(item)}>{reason.action}</button>
    </article>
  )
}

const VISIBLE_ROWS = 3

// What on the owner's tracked contributions needs them, blockers first. Review
// requests and agent questions keep their own places below.
export function AttentionList({ items = [], heading, onSelect }) {
  const [showAll, setShowAll] = useState(false)
  if (!items.length) return null
  const ordered = byUrgency(items)
  const shown = showAll ? ordered : ordered.slice(0, VISIBLE_ROWS)
  return (
    <details className="co-run-fold co-look-at" aria-label="To look at" open>
      <summary><span>To look at</span><b>{items.length}</b><Icon name="chevron" size={14} /></summary>
      <p className="co-attention-scope">On your tracked contributions. Review requests have their own tab below.</p>
      <div className="co-run-list">{shown.map(item => <AttentionRow key={item.id} item={item} heading={heading} onSelect={onSelect} />)}</div>
      {items.length > VISIBLE_ROWS ? <button type="button" className="co-quiet-action" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${items.length}`}</button> : null}
    </details>
  )
}
