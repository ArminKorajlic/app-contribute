/** GitHub-style pieces shared by the PR list, detail and launch views.
 *  Colors follow GitHub's own label and state treatment so a PR reads the same
 *  here as on github.com, in both shell themes. */
import { Icon } from './Icons.jsx'
import { checkSummary, isBotAuthor } from '../collaboration.js'

function rgbToHsl(r, g, b) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h * 60, s * 100, l * 100]
}

/** GitHub's label math: dark mode tints the label color and lightens dark
 *  text; light mode fills with the color and picks black or white text. */
export function labelColors(hex) {
  if (!/^[0-9a-f]{6}$/i.test(hex || '')) return null
  const [r, g, b] = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16))
  const [h, s, l] = rgbToHsl(r, g, b)
  const perceived = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
  const lifted = Math.min(100, l + Math.max(0, (0.6 - perceived) * 100))
  const hsl = (light, alpha = 1) => `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${light.toFixed(1)}%,${alpha})`
  return {
    '--co-label-dark-bg': `rgba(${r},${g},${b},0.18)`,
    '--co-label-dark-fg': hsl(lifted),
    '--co-label-dark-border': hsl(lifted, 0.3),
    '--co-label-light-bg': `rgb(${r},${g},${b})`,
    '--co-label-light-fg': perceived > 0.453 ? '#1f2328' : '#ffffff',
    '--co-label-light-border': perceived > 0.96 ? hsl(Math.max(0, l - 25)) : 'transparent',
  }
}

// What the header's sync last did, beside its button: when it finished, or that it failed.
export function SyncNote({ note }) {
  if (!note) return null
  return <span className="co-sync-note" role="status">{note.outcome?.ok ? <TimeAgo prefix="Checked " value={note.at} /> : 'Couldn’t reach GitHub'}</span>
}

// Labels in a list keep their meaning and lose the loud fill: a dot in the
// label's own colour and plain text, "area: " dropped, two at most, and a
// bot's PR says "bot" instead (its labels say nothing a person would use).
// The PR page keeps GitHub's exact, filled labels.
export function QuietLabels({ pr }) {
  if (isBotAuthor(pr?.author?.login)) return <span className="co-quiet-label is-bot">bot</span>
  const labels = pr?.labels?.nodes || []
  const shown = labels.slice(0, 2)
  const more = labels.length - shown.length
  return <>
    {shown.map(label => <span key={label.name} className="co-quiet-label" style={labelColors(label.color) || undefined}><i aria-hidden="true" />{label.name.replace(/^area:\s*/i, '')}</span>)}
    {more > 0 ? <span className="co-quiet-label is-more" title={labels.slice(2).map(label => label.name).join(', ')}>+{more}</span> : null}
  </>
}

// Where the PR stands, at the right of its row: draft, and the review decision.
export function PullStateChips({ pr }) {
  const decision = { CHANGES_REQUESTED: ['is-blocker', 'Changes requested'], APPROVED: ['is-ready', 'Approved'] }[pr?.reviewDecision]
  return <>
    {pr?.isDraft ? <span className="co-desk-chip">Draft</span> : null}
    {decision ? <span className={'co-desk-chip ' + decision[0]}>{decision[1]}</span> : null}
  </>
}

export function GithubLabel({ name, color }) {
  const style = labelColors(color)
  return <span className={'co-gh-label' + (style ? '' : ' is-plain')} style={style || undefined}>{name}</span>
}

export function pullState(pr) {
  if (pr?.mergedAt || pr?.state === 'MERGED') return 'merged'
  if (pr?.state === 'CLOSED') return 'closed'
  return pr?.isDraft ? 'draft' : 'open'
}
const STATE_TEXT = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }

export function PullStateIcon({ pr, size = 16 }) {
  const state = pullState(pr)
  return <span className={`co-gh-state is-${state}`} title={STATE_TEXT[state]}>
    <Icon name={state === 'draft' ? 'draft' : state === 'merged' ? 'merge' : 'pull'} size={size} />
    <span className="co-visually-hidden">{STATE_TEXT[state]}</span>
  </span>
}

export function PullStateBadge({ pr }) {
  const state = pullState(pr)
  return <span className={`co-gh-badge is-${state}`}><Icon name={state === 'draft' ? 'draft' : state === 'merged' ? 'merge' : 'pull'} size={14} />{STATE_TEXT[state]}</span>
}

/** "✓ 18/18" as on GitHub's PR list. Counts are GitHub's rollup, not a review. */
export function ChecksBadge({ pr }) {
  const checks = checkSummary(pr)
  if (!checks?.total) return null
  const icon = { success: 'check', failure: 'x', pending: 'dot' }[checks.state]
  const words = { success: 'checks passed', failure: `${checks.failed} failing`, pending: 'checks running' }[checks.state]
  return <span className={`co-gh-checks is-${checks.state}`} title={`${checks.passed} of ${checks.total} checks passed or skipped${checks.failed ? `, ${checks.failed} failing` : ''}`}>
    <Icon name={icon} size={14} />{checks.passed}/{checks.total}<span className="co-visually-hidden"> {words}</span>
  </span>
}

export function Avatar({ login, size = 20 }) {
  return <span className="co-gh-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden="true">{(login || '?').charAt(0).toUpperCase()}</span>
}

export const REVIEW_DECISION = { CHANGES_REQUESTED: 'Changes requested', APPROVED: 'Approved', REVIEW_REQUIRED: 'Review required' }

/** GitHub's relative time: "3 hours ago", "yesterday", "last week", then a date. */
export function TimeAgo({ value, prefix = '' }) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  const seconds = Math.max(0, (Date.now() - time) / 1000)
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const text = seconds < 60 ? 'just now'
    : seconds < 3600 ? relative.format(-Math.round(seconds / 60), 'minute')
      : seconds < 86400 ? relative.format(-Math.round(seconds / 3600), 'hour')
        : seconds < 7 * 86400 ? relative.format(-Math.round(seconds / 86400), 'day')
          : seconds < 30 * 86400 ? relative.format(-Math.round(seconds / (7 * 86400)), 'week')
            : `on ${new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(seconds > 300 * 86400 ? { year: 'numeric' } : {}) })}`
  return <time dateTime={value} title={new Date(time).toLocaleString(undefined, { hourCycle: 'h23' })}>{prefix}{text}</time>
}
