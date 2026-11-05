import { useState } from 'react'
import { Envelope, EmptyView } from './Envelope.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { Icon } from './Icons.jsx'
import { NAMES } from '../names.js'

// Waiting on you leads, then agents at work, then anything that stopped short or could not be read.
const ORDER = { waiting: 0, stalled: 1, unknown: 2, done: 3, checking: 4 }
const SHOWN_AT_FIRST = 8
// A chip's tone on the desk's own chip styles: yours is amber, a clear or merged review green.
const CHIP_CLASS = { owner: 'is-waiting', running: 'is-you', good: 'is-ready', blocker: 'is-blocker', quiet: '' }
const EMPTY = {
  running: { title: 'No agent is running', hint: 'Start one from a PR’s Actions menu. It shows here while it works.' },
  finished: { title: 'No finished agent runs yet', hint: 'Runs that finished, stopped or are waiting on you collect here, with saved agent work.' },
}

const lowerRepo = value => String(value || '').toLowerCase()
const matches = (query, ...parts) => !query.trim() || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

export function ReviewRow({ entry, project, onOpenPull }) {
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
    {rows.length > shown.length ? <button type="button" className="co-btn co-comments-toggle" onClick={() => setAll(true)}>{`Show ${rows.length - shown.length} earlier`}</button> : null}
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

// Agent runs: every review the owner started plus the saved agent work, by project, in two
// tabs named for what they hold (finding 5). Running is what an agent is doing now; Finished is
// everything else, and a finished run keeps its own pill ("Ready to merge", "Agent stopped").
export function AgentRunsView({ reviews, projects, query, decisionsFor, renderWork, onOpenProject, onOpenPull }) {
  const entries = reviews?.entries || []
  const running = entries.filter(entry => entry.bucket === 'running').sort((a, b) => b.at - a.at)
  // A run whose PR is still being read ('checking') waits on neither tab until GitHub answers.
  const finished = entries.filter(entry => entry.bucket in ORDER && entry.bucket !== 'checking').sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || b.at - a.at)
  const [picked, setPicked] = useState(null)
  const tab = picked || (running.length ? 'running' : 'finished')
  // Each tab's number is the rows it opens, searched or not: saved agent work is a row of Finished too.
  const searched = list => list.filter(entry => matches(query, entry.item.title, String(entry.item.number), entry.item.repo))
  const runningRows = searched(running), finishedRows = searched(finished)
  const shown = tab === 'running' ? runningRows : finishedRows
  const groups = groupByProject(shown, projects)
  const savedWork = projects.map(project => ({ project, rows: renderWork(project) })).filter(group => group.rows.length)
  const work = tab === 'finished' ? savedWork : []
  const tabs = [['running', 'Running', runningRows.length], ['finished', 'Finished', finishedRows.length + savedWork.reduce((total, group) => total + group.rows.length, 0)]]
  const empty = !groups.length && !work.length
  return <>
    <div className="co-pr-filters" role="group" aria-label="Agent runs">
      {tabs.map(([key, label, count]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setPicked(key)}>{label}<span className="co-pr-filter-count">{count}</span></button>)}
    </div>
    {reviews?.checking && !shown.length ? <p className="co-pr-note" role="status">Checking which of these pull requests are still open…</p> : null}
    {reviews?.counts?.unknown && tab === 'finished' ? <p className="co-pr-note" role="status">{reviews.counts.unknown === 1 ? 'One pull request' : `${reviews.counts.unknown} pull requests`} could not be read from GitHub, so where {reviews.counts.unknown === 1 ? 'it stands' : 'they stand'} is unknown. {reviews.retry ? <button type="button" className="co-btn co-btn-quiet" onClick={reviews.retry}>Try again</button> : null}</p> : null}
    {empty && !reviews?.checking
      ? <EmptyView icon="cycle" title={query.trim() ? 'Nothing matches your search' : EMPTY[tab].title} hint={query.trim() ? 'Try a PR number, a title word or a repository.' : EMPTY[tab].hint} />
      : <div className="co-desk-envelopes">
        {groups.map(({ project, rows }) => (
          <Envelope key={project.key} project={project} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>
            <ProjectRows rows={rows} project={project} onOpenPull={onOpenPull} />
          </Envelope>))}
        {work.map(({ project, rows }) => (
          <Envelope key={`work:${project.key}`} project={project} group={NAMES.preparedWork} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>{rows}</Envelope>))}
      </div>}
  </>
}
