import { useState } from 'react'
import { Envelope, EmptyView } from './Envelope.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { Icon } from './Icons.jsx'

const IN_PROGRESS = ['waiting', 'running', 'stalled', 'unknown']
// Waiting on you leads, then agents at work, then anything that stopped short or could not be read.
const ORDER = { waiting: 0, running: 1, stalled: 2, unknown: 3, done: 4 }
const SHOWN_AT_FIRST = 8
// A chip's tone on the desk's own chip styles: yours is amber, a clear or merged review green.
const CHIP_CLASS = { owner: 'is-waiting', running: 'is-you', good: 'is-ready', blocker: 'is-blocker', quiet: '' }
const EMPTY = {
  progress: { title: 'No reviews in progress', hint: 'Start one from a PR’s Actions menu. It shows here while an agent works and until you have dealt with what it found.' },
  done: { title: 'No finished reviews yet', hint: 'Reviews you have dealt with, approved or handed back to the author collect here.' },
}

const lowerRepo = value => String(value || '').toLowerCase()
const matches = (query, ...parts) => !query.trim() || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

function ReviewRow({ entry, project, onOpenPull }) {
  const { item, run, chips } = entry
  const open = () => onOpenPull(project, { number: item.number, repository: { nameWithOwner: item.repo } }, 'review')
  return (
    <button type="button" className="co-desk-row" onClick={open}>
      <Icon name="review" size={16} />
      <span className="co-desk-row-main">
        <span className="co-desk-row-title">{item.title || `Pull request #${item.number}`}</span>
        <span className="co-desk-row-meta">
          <span>#{item.number} · <TimeAgo prefix="reviewed " value={run.created_at} /></span>
          {chips.map(chip => <span key={chip.label} className={'co-desk-chip ' + CHIP_CLASS[chip.tone]}>{chip.label}</span>)}
        </span>
      </span>
    </button>
  )
}

// One project's rows; a long history folds behind "Show earlier".
function ProjectRows({ rows, project, onOpenPull }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, SHOWN_AT_FIRST)
  return <>
    {shown.map(entry => <ReviewRow key={entry.id} entry={entry} project={project} onOpenPull={onOpenPull} />)}
    {rows.length > shown.length ? <button type="button" className="co-comments-toggle" onClick={() => setAll(true)}>{`Show ${rows.length - shown.length} earlier`}</button> : null}
  </>
}

// Projects in the desk's order first; a repository the desk does not know gets
// a card of its own so no review is ever left out.
function groupByProject(entries, projects) {
  const known = new Set(projects.map(project => lowerRepo(project.canonical_repo)))
  const groups = projects.map(project => ({ project, rows: entries.filter(entry => lowerRepo(entry.item.repo) === lowerRepo(project.canonical_repo)) }))
  const strays = [...new Set(entries.map(entry => lowerRepo(entry.item.repo)).filter(repo => !known.has(repo)))]
  return [...groups, ...strays.map(repo => ({ project: { key: `external:${repo}`, name: repo, kind: 'external' }, rows: entries.filter(entry => lowerRepo(entry.item.repo) === repo) }))]
    .filter(group => group.rows.length)
}

// Reviews an agent has drafted and only the owner can send. Agents never post, approve
// or ask for changes by themselves, so this is the one place they all wait.
const CONFIRM_EMPTY = { title: 'Nothing is waiting for your confirmation', hint: 'When an agent drafts a review for you to send, it waits here. An agent posts by itself only when you allowed it for that review.' }

export function ConfirmView({ reviews, projects, query, onOpenProject, onOpenPull }) {
  const shown = reviews.entries.filter(entry => entry.confirm && matches(query, entry.item.title, String(entry.item.number), entry.item.repo))
  const groups = groupByProject(shown, projects)
  if (!groups.length) return reviews.checking
    ? <p className="co-pr-note" role="status">Checking which of these pull requests are still open…</p>
    : <EmptyView icon="send" title={query.trim() ? 'Nothing matches your search' : CONFIRM_EMPTY.title} hint={query.trim() ? 'Try a PR number, a title word or a repository.' : CONFIRM_EMPTY.hint} />
  return <>
    <p className="co-pr-note">Each one is drafted and ready. Open it to read exactly what would be posted, then confirm or discard it.</p>
    <div className="co-desk-envelopes">{groups.map(({ project, rows }) => (
      <Envelope key={project.key} project={project} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>
        <ProjectRows rows={rows} project={project} onOpenPull={onOpenPull} />
      </Envelope>))}</div>
  </>
}

// PR reviews: the reviews the owner started, by project, in two tabs. A review
// waiting on the owner stays in In progress until it is dealt with.
export function ReviewsView({ reviews, projects, query, onOpenProject, onOpenPull }) {
  const progress = reviews.entries.filter(entry => IN_PROGRESS.includes(entry.bucket)).sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || b.at - a.at)
  const finished = reviews.entries.filter(entry => entry.bucket === 'done')
  const [picked, setPicked] = useState(null)
  const tab = picked || (progress.length ? 'progress' : 'done')
  const shown = (tab === 'progress' ? progress : finished).filter(entry => matches(query, entry.item.title, String(entry.item.number), entry.item.repo))
  const groups = groupByProject(shown, projects)
  const tabs = [['progress', 'In progress', progress.length], ['done', 'Done', finished.length]]
  return <>
    <div className="co-pr-filters" role="group" aria-label="PR reviews">
      {tabs.map(([key, label, count]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setPicked(key)}>{label}<span className="co-pr-filter-count">{count}</span></button>)}
    </div>
    {reviews.checking && !shown.length ? <p className="co-pr-note" role="status">Checking which of these pull requests are still open…</p> : null}
    {reviews.counts?.unknown && tab === 'progress' ? <p className="co-pr-note" role="status">{reviews.counts.unknown === 1 ? 'One pull request' : `${reviews.counts.unknown} pull requests`} could not be read from GitHub, so where {reviews.counts.unknown === 1 ? 'it stands' : 'they stand'} is unknown. {reviews.retry ? <button type="button" className="co-quiet-action" onClick={reviews.retry}>Try again</button> : null}</p> : null}
    {!groups.length && !reviews.checking
      ? <EmptyView icon="review" title={query.trim() ? 'Nothing matches your search' : EMPTY[tab].title} hint={query.trim() ? 'Try a PR number, a title word or a repository.' : EMPTY[tab].hint} />
      : <div className="co-desk-envelopes">{groups.map(({ project, rows }) => (
        <Envelope key={project.key} project={project} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>
          <ProjectRows rows={rows} project={project} onOpenPull={onOpenPull} />
        </Envelope>))}</div>}
  </>
}
