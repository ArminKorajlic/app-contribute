import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  projectHasSharedUpdates,
  projectIsQuiet,
  projectNeedsSorting,
  projectReadyToPrepare,
  projectBoardFacts,
} from '../source-map.js'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { ProjectFileChanges } from './ProjectEdits.jsx'
import { TaskContext, TaskPane } from './TaskPane.jsx'
import { DESK_VIEWS, splitProjects } from '../desk.js'
import { DeskChips, DeskCounts, DeskRail } from './Desk.jsx'
import { DeskView } from './DeskViews.jsx'
import { openGithubSettings } from '../github-connection.js'

const FILTERS = [
  ['all', 'All'],
  ['local', 'With your edits'],
  ['updates', 'Behind GitHub'],
]

function projectMatchesJourney(project, filter) {
  if (filter === 'local') return !!(
    projectReadyToPrepare(project)
    || projectNeedsSorting(project)
  )
  if (filter === 'updates') return projectHasSharedUpdates(project) || project.conflictFiles > 0
  return true
}

function shortCommit(value) {
  return typeof value === 'string' && value ? value.slice(0, 7) : 'Unavailable'
}

function ProjectPosition({ project }) {
  const installedRelease = project.kind === 'app' && project.base_ref === 'upstream'
  const comparisonRef = project.comparison_ref || project.base_ref
  const comparisonSha = project.comparison_sha || project.base_sha
  const comparesWithRelease = installedRelease && comparisonRef === project.base_ref
  return (
    <details className="co-position-details">
      <summary><span>Branch and version</span><Icon name="chevron" size={15} /></summary>
      <dl>
        <div><dt>Your branch</dt><dd><code>{project.detached ? 'Detached' : project.branch || 'Unknown'}</code></dd></div>
        <div><dt>Your commit</dt><dd><code>{shortCommit(project.head_sha)}</code></dd></div>
        {project.state !== 'local_only' ? (
          <>
            <div><dt>Compared with</dt><dd><code>{comparesWithRelease ? `installed release (${comparisonRef})` : comparisonRef || 'Not configured'}</code></dd></div>
            <div><dt>{comparesWithRelease ? 'Release commit' : 'Shared commit'}</dt><dd><code>{shortCommit(comparisonSha)}</code></dd></div>
          </>
        ) : null}
        {project.canonical_repo ? <div><dt>Repository</dt><dd><code>{project.canonical_repo}</code></dd></div> : null}
      </dl>
    </details>
  )
}

function ProjectGlyph({ project }) {
  return <ProjectIcon project={project} className="co-source-glyph" />
}

function ProjectDetail({
  project,
  loadProjectDiff,
  onRefresh,
  renderActivity,
  navigation,
  sourceRevision,
}) {
  const [publicKeys, setPublicKeys] = useState(new Set())
  const projectView = useRef(null)
  const pendingScroll = useRef(null)
  const activeId = navigation.selectedId || ''
  function preservingScroll(change) {
    const page = projectView.current?.closest('.co-page')
    if (page) pendingScroll.current = { page, top: page.scrollTop }
    change()
  }
  useLayoutEffect(() => {
    const saved = pendingScroll.current
    if (!saved) return
    saved.page.scrollTop = saved.top
    pendingScroll.current = null
  }, [activeId])
  const task = {
    publicKeys, setPublicKeys, activeId,
    explicit: !!navigation.selectedId,
    open: id => preservingScroll(() => navigation.onSelect(id)),
    close: () => preservingScroll(navigation.onBack),
  }
  return (
    <TaskContext.Provider value={task}>
      <article ref={projectView} className="co-workspace">
        <header className="co-workspace-head">
          <div className="co-workspace-title"><ProjectGlyph project={project} /><div>
            <div className="co-workspace-name-row"><h2>{project.name}</h2></div>
            <p>{project.canonical_repo ? <a href={`https://github.com/${project.canonical_repo}`} target="_blank" rel="noopener noreferrer">{project.canonical_repo}</a> : <span>Only on your Möbius</span>}
            </p>
          </div></div>
        </header>
        <div className="co-workspace-body">
          <div className="co-workspace-inventory">
            {renderActivity?.(project, navigation)}
          </div>
        </div>
        <TaskPane id="task:files" dock={false}>
          <h3>Your edited files</h3>
          <p>The files that differ from GitHub, and the exact versions being compared.</p>
          <ProjectFileChanges key={sourceRevision} project={project} loadProjectDiff={loadProjectDiff} onRefresh={onRefresh} />
          <ProjectPosition project={project} />
          {!project.available ? <p>No inspectable local source is available.</p> : null}
        </TaskPane>
      </article>
    </TaskContext.Provider>
  )
}

const PROJECT_TAGS = { platform: 'Platform', app: 'App' }

function attentionLine(reviewRequests, needs) {
  const parts = []
  if (reviewRequests) parts.push(`${reviewRequests} ${reviewRequests === 1 ? 'PR waits' : 'PRs wait'} for your review.`)
  if (needs) parts.push(`${needs} ${needs === 1 ? 'thing needs' : 'things need'} you.`)
  return parts.join(' ')
}

function ProjectRow({ project, selected, onSelect, check = null, needs = 0, quiet = false }) {
  const facts = projectBoardFacts(project)
  const reviewRequests = project.reviewRequests?.length || 0
  const attention = attentionLine(reviewRequests, needs)
  const tag = PROJECT_TAGS[project.kind]
  const newCommits = check?.newCommits || 0
  const shared = newCommits > 0 ? `${newCommits} new ${newCommits === 1 ? 'commit' : 'commits'} on GitHub since the last check.` : facts.shared
  const next = `${facts.work} ${shared}`
  const showShared = !!(
    newCommits > 0
    ||
    project.conflictFiles
    || project.state === 'conflict'
    || projectHasSharedUpdates(project)
    || project.sourceComparisonRequired
    || !project.available
    || (!project.builtHere && project.kind !== 'external' && project.canonical_repo && !project.origin?.sha && !project.base_sha)
  )
  return (
    <div className={'co-source-row-wrap' + (selected ? ' is-selected' : '') + (quiet ? ' is-quiet' : '')}>
      <button
        type="button"
        className="co-source-row"
        onClick={() => {
          if (window.getSelection?.()?.toString().trim()) return
          onSelect(project.key)
        }}
        aria-expanded={selected}
        aria-label={`Open ${project.name}: ${next}`}
      >
        <ProjectGlyph project={project} />
        <span className="co-source-row-id"><strong>{project.name}</strong>{tag ? <span className="co-source-tag">{tag}</span> : null}</span>
        <span className="co-source-row-facts">
          {quiet ? (showShared ? <span>{shared}</span> : null) : <>
            <span>{facts.work}</span>
            {showShared ? <span className="co-source-shared">{shared}</span> : null}
            {attention ? <span className="co-source-attention">{attention}</span> : null}
          </>}
        </span>
        <span className="co-source-row-cue" aria-hidden="true">

          <Icon name="right" size={15} />
        </span>
      </button>
    </div>
  )
}

function ProjectGroup({ label, projects, selectedKey, onSelect, checks = {}, attention = {}, quiet = false }) {
  if (!projects.length) return null
  return (
    <div className="co-source-group">
      {label ? <div className="co-source-group-label">{label}</div> : null}
      {projects.map((project) => <ProjectRow key={project.key} project={project} selected={project.key === selectedKey} onSelect={onSelect} check={checks[project.key]} needs={attention[project.key] || 0} quiet={quiet} />)}
    </div>
  )
}

// Apps with nothing for the owner fold away; a search opens them.
function QuietProjects({ projects, onSelect, checks, searching }) {
  if (!projects.length) return null
  return <details className="co-quiet-projects" open={searching ? true : undefined}>
    <summary><span>Apps with nothing to do</span><b>{projects.length}</b><Icon name="chevron" size={14} /></summary>
    <ProjectGroup label="" projects={projects} selectedKey="" onSelect={onSelect} checks={checks} quiet />
  </details>
}

// The PR page is its own task surface: the review window, assignment pane and
// agent panes need the same open/close plumbing a project page gives them.
// Without it, every pane renders bare, always, and with no way to close.
function PullPageTask({ children }) {
  const [publicKeys, setPublicKeys] = useState(new Set())
  const [activeId, setActiveId] = useState('')
  const task = {
    publicKeys, setPublicKeys, activeId, explicit: true,
    open: setActiveId, close: () => setActiveId(''),
  }
  return <TaskContext.Provider value={task}>{children}</TaskContext.Provider>
}

function LoadingState() {
  return <div className="co-source-loading" role="status"><span className="ma-spinner" aria-hidden="true" /><div><strong>Checking projects…</strong><span>Comparing local, shared, and prepared work.</span></div></div>
}

export function SourceMap({
  snapshot,
  projects,
  focusKey,
  conn,
  loading,
  error,
  onRetry,
  loadProjectDiff,
  renderActivity,
  repositoryPicker,
  onProjectOpenChange,
  checks = {},
  attention = {},
  desk = { view: 'projects', onView: () => {}, counts: {}, login: '', records: [], lastLooked: '', decisionsFor: () => [], onOpenPull: () => {}, pull: null, onClosePull: () => {}, renderPull: () => null },
}) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [deskQuery, setDeskQuery] = useState('')
  const filtered = useMemo(
    () => projects.filter((project) => (
      projectMatchesJourney(project, filter)
      && (!query.trim() || [project.name, project.key, project.canonical_repo]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query.trim().toLowerCase())))
    )),
    [projects, filter, query],
  )
  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map(([key]) => [
      key,
      projects.filter((project) => project.kind !== 'external' && projectMatchesJourney(project, key)).length,
    ])),
    [projects],
  )
  const [selected, setSelected] = useState('')
  const listScrollRef = useRef(0)
  const projectNavRef = useRef(null)
  const handledFocusRef = useRef('')
  const [selectedWorkId, setSelectedWorkId] = useState('')
  const workTriggerRef = useRef(null)
  const [navigationError, setNavigationError] = useState('')
  const pageScroller = () => document.querySelector('.co-page')

  function closeWork() {
    setSelectedWorkId('')
    requestAnimationFrame(() => workTriggerRef.current?.isConnected && workTriggerRef.current.focus({ preventScroll: true }))
  }

  function openWork(itemId) {
    if (!itemId || itemId === selectedWorkId) return
    if (!document.activeElement?.closest('.co-task-content')) workTriggerRef.current = document.activeElement
    setSelectedWorkId(itemId)
  }
  const activityNavigation = { selectedId: selectedWorkId, onSelect: openWork, onBack: closeWork }

  function showProject(key) {
    listScrollRef.current = pageScroller()?.scrollTop || 0
    setSelected(key)
    requestAnimationFrame(() => pageScroller()?.scrollTo({ top: 0, left: 0 }))
  }

  async function openProject(key) {
    if (!key || selected === key) return
    setNavigationError('')
    closeWork()
    if (projectNavRef.current) closeProject()
    if (!window.mobius?.nav?.open) {
      showProject(key)
      return
    }
    let handle = null
    handle = window.mobius.nav.open('contribute-project', {
      onBack: () => {
        if (projectNavRef.current !== handle) return
        projectNavRef.current = null
        setSelected('')
        requestAnimationFrame(() => pageScroller()?.scrollTo({
          top: listScrollRef.current,
          left: 0,
        }))
      },
      onForward: () => {
        projectNavRef.current = handle
        setSelected(key)
        requestAnimationFrame(() => pageScroller()?.scrollTo({ top: 0, left: 0 }))
      },
    })
    projectNavRef.current = handle
    const outcome = await handle.outcome
    if (projectNavRef.current !== handle) {
      handle.close()
      return
    }
    if (outcome?.status !== 'owned') {
      projectNavRef.current = null
      setNavigationError('Could not open this project. Try again.')
      return
    }
    showProject(key)
  }

  function closeProject() {
    closeWork()
    const handle = projectNavRef.current
    projectNavRef.current = null
    try { handle?.close?.() } catch {}
    setSelected('')
    requestAnimationFrame(() => pageScroller()?.scrollTo({
      top: listScrollRef.current,
      left: 0,
    }))
  }

  useEffect(() => () => {
    try { projectNavRef.current?.close?.() } catch {}
    projectNavRef.current = null
  }, [])

  useEffect(() => {
    if (!focusKey?.nonce || handledFocusRef.current === focusKey.nonce) return
    // A repository looked up before local discovery finished is deduplicated
    // into its local project, so match it by repository as well as by key.
    const linked = focusKey.repository?.nameWithOwner?.toLowerCase()
    const target = projects.find(project => project.key === focusKey.key)
      || (linked && projects.find(project => project.canonical_repo?.toLowerCase() === linked))
    if (focusKey.key && !target) return
    handledFocusRef.current = focusKey.nonce
    if (!focusKey.key) { closeProject(); return }
    setFilter('all')
    void openProject(target.key)
  }, [focusKey, projects])

  const selectedProject = selected
    ? projects.find((project) => project.key === selected) || null
    : null
  useEffect(() => { onProjectOpenChange?.(!!selectedProject) }, [selectedProject, onProjectOpenChange])
  const builtHere = filtered.filter((project) => project.builtHere)
  const tracked = filtered.filter((project) => !project.builtHere && project.kind !== 'external')
  // Projects with something going on lead; quiet ones follow, as in Kanban.
  const isQuiet = project => projectIsQuiet(project) && !attention[project.key]
  const trackedActive = tracked.filter((project) => !isQuiet(project))
  const trackedQuiet = tracked.filter(isQuiet)
  const external = filtered.filter((project) => project.kind === 'external')
  // The rail and the side views keep the directory's own order: active work
  // first, then local-only apps, quiet apps, and repositories on GitHub.
  const deskGroups = splitProjects(projects, attention)
  const orderedProjects = [...deskGroups.active, ...deskGroups.builtHere, ...deskGroups.quiet, ...deskGroups.external]
  const openView = key => { desk.onClosePull(); if (selected) closeProject(); desk.onView(key) }
  const openProjectFromRail = key => { desk.onClosePull(); void openProject(key) }
  function openRecordFromDesk(project, item) {
    void openProject(project.key)
    if (item?.id) openWork(item.id)
  }
  const externalQuestions = external.reduce((count, project) => count + (project.reviewRequests?.length || 0), 0)
  if (loading && !snapshot && !projects.length) return <LoadingState />
  const viewLabel = DESK_VIEWS.find(item => item.key === desk.view)?.label || 'Your projects'
  return (
    <section className={'co-projects-view' + (selectedProject ? ' is-focus' : '')} aria-label="Project details">
      <div className="co-desk">
      <DeskRail view={desk.view} counts={desk.counts} projects={projects} attention={attention} selectedKey={selected} onView={openView} onOpenProject={openProjectFromRail} />
      <div className="co-desk-pane">
      {desk.pull ? (
        <div className="co-pull-page">
          <button type="button" className="co-desk-back" onClick={desk.onClosePull}><Icon name="left" size={16} />Back to {selectedProject ? selectedProject.name : viewLabel}</button>
          <PullPageTask>{desk.renderPull()}</PullPageTask>
        </div>
      ) : (
      <>
      {selectedProject ? <h2 className="co-visually-hidden">Project detail</h2> : (
        <>
        <DeskChips view={desk.view} counts={desk.counts} onView={openView} />
        <header className="co-view-heading">
          <div>
            <h2>{viewLabel}</h2>
          </div>
          <div className="co-project-view-actions">
            {repositoryPicker}
          </div>
        </header>
        {desk.view === 'needs' ? <DeskCounts counts={desk.counts} onView={openView} /> : null}
        {desk.view !== 'projects' && desk.lastLooked ? <p className="co-desk-legend"><span className="co-newdot" /><TimeAgo prefix="marks what changed since you last looked, " value={desk.lastLooked} /></p> : null}
        </>
      )}

      {navigationError ? <p className="co-run-error" role="alert">{navigationError}</p> : null}
      {conn?.state === 'disconnected' ? (
        <div className="co-connect-banner" role="status">
          <div>
            <strong>Connect GitHub in Settings to contribute as yourself</strong>
            <p>Your projects and saved reviews stay here. When you’re ready to send or review work on GitHub, go to Möbius Settings → Accounts → GitHub and connect your account there.</p>
          </div>
          <button type="button" className="co-btn co-btn-primary" onClick={openGithubSettings}>Go to Settings</button>
        </div>
      ) : null}
      {conn?.state === 'unknown' ? (
        <div className="co-view-note">GitHub is unavailable. Local status and saved reviews remain visible.</div>
      ) : null}
      {error ? (
        <div className="co-view-warning" role="status">Project status could not refresh. Saved contributions remain available.</div>
      ) : null}

      {!selectedProject ? (
        desk.view !== 'projects' ? (
          <>
            <label className="co-desk-search">
              <Icon name="search" size={16} />
              <input type="search" placeholder="Find a PR, person or project" aria-label="Find a PR, person or project" value={deskQuery} onChange={event => setDeskQuery(event.target.value)} />
            </label>
            <DeskView view={desk.view} projects={orderedProjects} records={desk.records} login={desk.login} decisionsFor={desk.decisionsFor} lastLooked={desk.lastLooked} query={deskQuery} runs={desk.runs} onOpenProject={openProject} onOpenPull={desk.onOpenPull} onOpenRecord={openRecordFromDesk} />
          </>
        ) : (
        <>
          <div className="co-directory">
          <label className="co-project-search">
            <span className="co-visually-hidden">Find a project</span>
            <input
              type="search"
              value={query}
              placeholder="Find a project"
              onChange={(event) => {
                const value = event.target.value
                setQuery(value)
              }}
            />
          </label>
          <div className="co-directory-filters" role="group" aria-label="Filter projects">
            {FILTERS.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{key !== 'all' ? <span>{filterCounts[key]}</span> : null}</button>)}
          </div>

          {filtered.length === 0 ? (
            <div className="co-stage-empty">
              <Icon name={query.trim() ? 'review' : 'check'} size={20} />
              <strong>{query.trim() ? 'No matching project' : filter === 'updates' ? 'Nothing is behind GitHub' : 'No projects with edits'}</strong>
              <span>{query.trim() ? 'Try a project name or repository.' : filter === 'all' ? 'No projects are available.' : 'Choose All to see every project.'}</span>
            </div>
          ) : (
            <div className="co-project-index">
              <ProjectGroup
                label=""
                projects={trackedActive}
                selectedKey=""
                onSelect={openProject}
                checks={checks}
                attention={attention}
              />
              <QuietProjects projects={trackedQuiet} onSelect={openProject} checks={checks} searching={!!query.trim() || !trackedActive.length} />
              <ProjectGroup
                label="Only on your Möbius"
                projects={builtHere}
                selectedKey=""
                onSelect={openProject}
              />
            </div>
          )}
          {external.length ? <details className="co-other-repositories" open={query.trim() ? true : undefined}>
            <summary>On GitHub, not installed here <span>{external.length}{externalQuestions ? ` · ${externalQuestions} review requests` : ''}</span></summary>
            <p>Shown because Contribute has saved history here, you added the repository, or a pull request currently involves you. Other repositories stay on GitHub until you add or work on them.</p>
            <ProjectGroup label="" projects={external} selectedKey="" onSelect={openProject} />
          </details> : null}
          </div>
        </>
        )
      ) : (
        <div className="co-project-layout">
          <ProjectDetail
            key={selectedProject.key}
            project={selectedProject}
            loadProjectDiff={loadProjectDiff}
            onRefresh={onRetry}
            renderActivity={renderActivity}
            navigation={activityNavigation}
            sourceRevision={snapshot?.generated_at}
          />
        </div>
      )}
      </>
      )}
      </div>
      </div>
    </section>
  )
}
