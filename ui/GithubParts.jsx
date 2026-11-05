/** GitHub-style pieces shared by the PR list, detail and launch views.
 *  Labels and state pills use GitHub's own colours, softened (see labelColors),
 *  so a PR is recognisable here and on github.com in both shell themes. */
import { Icon } from './Icons.jsx'
import { checkSummary, isBotAuthor } from '../collaboration.js'

// Labels and state pills are filled with their GitHub colour, 30% less intense:
// 70% of the colour mixed into the page surface, then black or white text,
// whichever reads better. Dark and light get their own mix because the surface
// differs; the shell's default surfaces are the two constants below.
const COLOR_SHARE = 0.7
const SURFACE = { dark: [23, 23, 23], light: [255, 255, 255] }
// White first, then GitHub's dark ink, then pure black: for the middle shades neither of the first two reaches 4.5:1.
const TEXT_CHOICES = [[255, 255, 255], [31, 35, 40], [0, 0, 0]]

function relativeLuminance([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(channel => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

export function contrastRatio(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

function softFill(color, theme) {
  const fill = color.map((channel, at) => Math.round(channel * COLOR_SHARE + SURFACE[theme][at] * (1 - COLOR_SHARE)))
  const text = TEXT_CHOICES.find(choice => contrastRatio(choice, fill) >= 4.5)
  // A fill close to the page itself (a near-black label on dark, a near-white one on light) keeps a hairline.
  const luminance = relativeLuminance(fill)
  const edge = luminance < 0.02 ? 'rgba(255,255,255,0.28)' : luminance > 0.85 ? 'rgba(0,0,0,0.28)' : 'transparent'
  return { fill, text, edge }
}

/** The CSS variables for one GitHub colour ("d73a4a"), for both shell themes. */
export function labelColors(hex) {
  if (!/^[0-9a-f]{6}$/i.test(hex || '')) return null
  const color = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16))
  const vars = {}
  for (const theme of ['dark', 'light']) {
    const { fill, text, edge } = softFill(color, theme)
    vars[`--co-label-${theme}-bg`] = `rgb(${fill.join(',')})`
    vars[`--co-label-${theme}-fg`] = `rgb(${text.join(',')})`
    vars[`--co-label-${theme}-edge`] = edge
  }
  return vars
}

// What the header's sync last did, beside its button: when it finished, or that it failed.
export function SyncNote({ note }) {
  if (!note) return null
  return <span className="co-sync-note" role="status">{note.outcome?.ok ? <TimeAgo prefix="Checked " value={note.at} /> : 'Couldn’t reach GitHub'}</span>
}

// Labels in a list are the same filled pills as on the PR page, "area: " dropped,
// two at most. A bot's PR says "bot" instead (its labels say nothing a person
// would use). Every PR has them, so they always get their own line.
export function PullLabels({ pr }) {
  if (isBotAuthor(pr?.author?.login)) return <span className="co-gh-label is-plain">bot</span>
  const labels = pr?.labels?.nodes || []
  const shown = labels.slice(0, 2)
  const more = labels.length - shown.length
  return <>
    {shown.map(label => <GithubLabel key={label.name} name={label.name.replace(/^area:\s*/i, '')} color={label.color} />)}
    {more > 0 ? <span className="co-label-more" title={labels.slice(2).map(label => label.name).join(', ')}>+{more}</span> : null}
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

// GitHub's own state colours: open green, draft grey, merged purple, closed red.
const STATE_COLOR = { open: '238636', draft: '6e7781', merged: '8957e5', closed: 'da3633' }

export function PullStateBadge({ pr }) {
  const state = pullState(pr)
  return <span className={`co-gh-badge is-${state}`} style={labelColors(STATE_COLOR[state])}><Icon name={state === 'draft' ? 'draft' : state === 'merged' ? 'merge' : 'pull'} size={14} />{STATE_TEXT[state]}</span>
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
