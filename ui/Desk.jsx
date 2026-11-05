import { DESK_VIEWS, NEEDS_CHIPS, railBadge, splitProjects } from '../desk.js'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import { NAMES } from '../names.js'

// The count a project's rail row shows: how many things in it wait on the
// owner. `attention` already holds exactly what its Needs you card lists
// (desk.js projectNeedsCount); it is not the number of open PRs.
export function projectRailCount(project, attention) {
  return attention?.[project.key] || 0
}

// Only Needs you and Review requests wait on the owner; the others show a quiet
// number, so a purple badge always means "do something".
const WAITING_ON_YOU = ['needs', 'requests']

function RailViewButton({ view, current, counts, onView }) {
  const badge = railBadge(view.key, counts)
  const running = view.key === 'runs' && badge
  return (
    <button
      type="button" className="co-rail-item" aria-current={current === view.key ? 'page' : undefined}
      onClick={() => onView(view.key)}
    >
      <Icon name={view.icon} size={16} />
      <span className="co-rail-label">{view.label}</span>
      {running ? <span className="co-arc" aria-hidden="true" /> : null}
      {badge ? (WAITING_ON_YOU.includes(view.key)
        ? <b className="co-rail-count is-you">{badge}</b>
        : <span className="co-rail-total">{running ? `${badge} running` : badge}</span>) : null}
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

// The desktop side list: four views, then the projects as a block of their own
// (finding 2). Quiet apps, local-only apps and repositories not installed here fold
// into one "More projects" row; Add project is the block's last row (finding 12).
// On narrow screens CSS hides it and DeskChips takes over.
export function DeskRail({ view, counts, projects, attention, selectedKey, onView, onOpenProject, addProject = null }) {
  const groups = splitProjects(projects, attention)
  const more = [...groups.quiet, ...groups.external]
  const moreOpen = more.some(project => project.key === selectedKey)
  return (
    <div className="co-rail">
      <nav className="co-rail-views" aria-label="Contribute views">
        {DESK_VIEWS.map(item => <RailViewButton key={item.key} view={item} current={selectedKey ? '' : view} counts={counts} onView={onView} />)}
      </nav>
      <nav className="co-rail-projects" aria-labelledby="co-rail-projects-head">
        <h2 className="co-rail-head" id="co-rail-projects-head">{NAMES.repositories}</h2>
        {[...groups.active, ...groups.builtHere].map(project => (
          <RailProjectButton key={project.key} project={project} attention={attention} selectedKey={selectedKey} onOpenProject={onOpenProject} />
        ))}
        {more.length ? (
          <details className="co-rail-quiet" open={moreOpen || undefined}>
            <summary><span>{NAMES.moreRepositories}</span><b>{more.length}</b><Icon name="chevron" size={13} /></summary>
            {more.map(project => <RailProjectButton key={project.key} project={project} attention={attention} selectedKey={selectedKey} onOpenProject={onOpenProject} />)}
          </details>
        ) : null}
        <button type="button" className="co-rail-item is-all" onClick={() => onView('projects')} aria-current={!selectedKey && view === 'projects' ? 'page' : undefined}>
          <Icon name="search" size={15} />
          <span className="co-rail-label">{NAMES.allRepositories}</span>
        </button>
        {addProject ? <div className="co-rail-add">{addProject}</div> : null}
      </nav>
    </div>
  )
}

// The same four views as the rail, as one four-segment bar for phones: every segment is on screen at
// once (nothing scrolls out of sight), the count above its word. The project list is one quiet link.
export function DeskChips({ view, counts, onView }) {
  return (
    <div className="co-desk-chips" role="group" aria-label="Contribute views">
      {DESK_VIEWS.map(item => {
        const badge = railBadge(item.key, counts)
        return (
          <button key={item.key} type="button" aria-pressed={view === item.key} aria-label={badge ? `${item.label}, ${badge}` : item.label} onClick={() => onView(item.key)}>
            <b>{badge || ''}</b><span>{item.short}</span>
          </button>
        )
      })}
      <button type="button" className="co-desk-chips-projects" aria-pressed={view === 'projects'} onClick={() => onView('projects')}><Icon name="search" size={15} />{NAMES.allRepositories}</button>
    </div>
  )
}

// The Needs you chips: one per next step, each filtering the list to its rows.
// Their sum is the rail badge. Drafts ready to open are not urgent, so they are a
// quiet line under the chips, not a number in them (finding 5).
export function DeskCounts({ counts, filter = '', onFilter, onView }) {
  const chips = NEEDS_CHIPS.map(chip => ({ ...chip, value: chip.count(counts) })).filter(chip => chip.value)
  return <>
    {chips.length ? (
      <div className="co-desk-counts" role="group" aria-label="What needs you, by next step">
        {chips.map(chip => (
          <button key={chip.key} type="button" aria-pressed={filter === chip.key} onClick={() => onFilter(filter === chip.key ? '' : chip.key)}>
            <b>{chip.value}</b>{chip.label}
          </button>
        ))}
      </div>
    ) : null}
    {counts.drafts ? (
      <p className="co-desk-quiet-line">
        {counts.drafts === 1 ? 'One draft is ready to open for review.' : `${counts.drafts} drafts are ready to open for review.`}
        <button type="button" className="co-btn co-btn-quiet" onClick={() => onView('mine')}>See drafts</button>
      </p>
    ) : null}
  </>
}
