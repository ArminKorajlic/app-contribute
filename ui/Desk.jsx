import { DESK_VIEWS, needsCount, railBadge, splitProjects } from '../desk.js'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'

// The count a project's rail row shows: how many things in it wait on the
// owner. `attention` already holds exactly what its Needs you card lists
// (desk.js projectNeedsCount); it is not the number of open PRs.
export function projectRailCount(project, attention) {
  return attention?.[project.key] || 0
}

// Only these views are things waiting on the owner; the rest are information
// and show a quiet number, so a badge always means "do something".
const WAITING_ON_YOU = ['needs', 'confirm', 'requests', 'work', 'reviews']

function RailViewButton({ view, current, counts, onView }) {
  const badge = railBadge(view.key, counts)
  return (
    <button
      type="button" className="co-rail-item" aria-current={current === view.key ? 'page' : undefined}
      onClick={() => onView(view.key)}
    >
      <Icon name={view.icon} size={16} />
      <span className="co-rail-label">{view.label}</span>
      {view.key === 'reviews' && counts.reviewsRunning ? <span className="co-arc" role="status" aria-label={`${counts.reviewsRunning} ${counts.reviewsRunning === 1 ? 'review' : 'reviews'} running`} /> : null}
      {badge ? (WAITING_ON_YOU.includes(view.key)
        ? <b className="co-rail-count is-you">{badge}</b>
        : <span className="co-rail-quiet" title={view.key === 'edits' ? `${badge} edited ${badge === 1 ? 'file' : 'files'}` : undefined}>{badge}</span>) : null}
    </button>
  )
}

function RailProjectButton({ project, attention, selectedKey, onOpenProject }) {
  const count = projectRailCount(project, attention)
  return (
    <button
      type="button" className="co-rail-item is-project" aria-current={selectedKey === project.key ? 'page' : undefined}
      onClick={() => onOpenProject(project.key)}
    >
      <ProjectIcon project={project} className="co-rail-glyph" />
      <span className="co-rail-label">{project.name}</span>
      {count ? <b className="co-rail-count is-you" title={`${count} waiting on you in ${project.name}`}>{count}</b> : null}
    </button>
  )
}

// The desktop side list: one place that answers "what should I look at" and
// "which project". On narrow screens CSS hides it; DeskChips takes over.
export function DeskRail({ view, counts, projects, attention, selectedKey, onView, onOpenProject, repositoryPicker }) {
  const groups = splitProjects(projects, attention)
  return (
    <nav className="co-rail" aria-label="Contribute views">
      {DESK_VIEWS.map(item => <RailViewButton key={item.key} view={item} current={selectedKey ? '' : view} counts={counts} onView={onView} />)}
      <div className="co-rail-head">Projects</div>
      {[...groups.active, ...groups.builtHere].map(project => (
        <RailProjectButton key={project.key} project={project} attention={attention} selectedKey={selectedKey} onOpenProject={onOpenProject} />
      ))}
      {groups.quiet.length ? (
        <details className="co-rail-quiet">
          <summary><span>Apps with nothing to do</span><b>{groups.quiet.length}</b><Icon name="chevron" size={13} /></summary>
          {groups.quiet.map(project => <RailProjectButton key={project.key} project={project} attention={attention} selectedKey={selectedKey} onOpenProject={onOpenProject} />)}
        </details>
      ) : null}
      {groups.external.length ? (
        <details className="co-rail-quiet">
          <summary><span>On GitHub, not installed</span><b>{groups.external.length}</b><Icon name="chevron" size={13} /></summary>
          {groups.external.map(project => <RailProjectButton key={project.key} project={project} attention={attention} selectedKey={selectedKey} onOpenProject={onOpenProject} />)}
        </details>
      ) : null}
      <button type="button" className="co-rail-item is-all" onClick={() => onView('projects')} aria-current={!selectedKey && view === 'projects' ? 'page' : undefined}>
        <Icon name="search" size={15} />
        <span className="co-rail-label">All projects</span>
      </button>
      {repositoryPicker ? <div className="co-rail-picker">{repositoryPicker}</div> : null}
    </nav>
  )
}

// The same destinations as the rail, as one scrollable chip row for phones.
export function DeskChips({ view, counts, onView }) {
  return (
    <div className="co-desk-chips" role="group" aria-label="Contribute views">
      {[...DESK_VIEWS, { key: 'projects', label: 'All projects', icon: 'search' }].map(item => {
        const badge = item.key === 'projects' ? 0 : railBadge(item.key, counts)
        return (
          <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => onView(item.key)}>
            {item.label}{badge ? <b>{badge}</b> : null}
          </button>
        )
      })}
    </div>
  )
}

// Clickable counts under the heading: each one names the next step and jumps
// to the view that holds it.
export function DeskCounts({ counts, onView }) {
  const chips = [
    counts.questions ? { label: 'To look at', count: counts.questions, view: 'work', you: true } : null,
    { label: 'Review', count: counts.requests, view: 'requests', you: true },
    { label: 'Merge', count: counts.merge, view: 'mine' },
    { label: 'Fix', count: counts.fix, view: 'mine' },
    counts.drafts ? { label: 'Mark ready', count: counts.drafts, view: 'mine' } : null,
    counts.editedFiles ? { label: 'Edits', count: `${counts.editedFiles} files`, view: 'edits' } : null,
  ].filter(chip => chip && (chip.count === undefined || chip.count !== 0))
  if (!chips.length) return null
  return (
    <div className="co-desk-counts" role="group" aria-label="What needs you, by next step">
      {chips.map(chip => (
        <button key={chip.label + chip.view} type="button" onClick={() => onView(chip.view)}>
          <b>{chip.count}</b>{chip.label}
        </button>
      ))}
    </div>
  )
}
