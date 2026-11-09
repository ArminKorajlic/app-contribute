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
import UnifiedDiff from './diff/UnifiedDiff.jsx'
import { parseUnifiedDiff } from './diff/parseUnifiedDiff.js'
import { TaskContext, TaskPane } from './TaskPane.jsx'
import { openGithubSettings } from '../github-connection.js'

const FILTERS = [
  ['all', 'All'],
  ['local', 'Changes'],
  ['updates', 'Updates'],
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

function ProjectFileChanges({ project, loadProjectDiff, onRefresh }) {
  const [state, setState] = useState({ phase: 'loading', data: null })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading', data: null })
    Promise.resolve(loadProjectDiff?.(project))
      .then((result) => {
        if (cancelled) return
        if (result?.ok) setState({ phase: 'ready', data: result.data })
        else setState({ phase: result?.stale ? 'stale' : 'error', data: null })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error', data: null })
      })
    return () => { cancelled = true }
  }, [project.key, project.head_sha, project.comparison_sha, project.base_sha, loadProjectDiff, retry])

  const files = state.phase === 'ready' ? parseUnifiedDiff(state.data?.diff) : []
  const countLabel = state.phase === 'ready'
    ? `${files.length} ${files.length === 1 ? 'file' : 'files'}${state.data?.diff_truncated ? ' shown' : ''}`
    : null

  return (
    <section className="co-project-files">
      <header><span>Changed files</span>{countLabel ? <small>{countLabel}</small> : null}</header>
      {state.phase === 'ready' ? (
        files.length ? <>
          {state.data?.diff_truncated ? (
            <p className="co-project-diff-note">This is a large change, so only the available part of the diff is shown.</p>
          ) : null}
          <UnifiedDiff
            diff={state.data?.diff}
            diffTruncated={state.data?.diff_truncated === true}
            initiallyOpenFirst
          />
        </> : <p className="co-project-diff-empty">No changed files in this comparison.</p>
      ) : state.phase === 'loading' ? (
        <div className="co-project-diff-loading" role="status"><span className="ma-spinner is-compact" aria-hidden="true" /> Loading file diffs…</div>
      ) : (
        <button
          type="button"
          className="co-project-files-toggle"
          onClick={state.phase === 'stale' ? onRefresh : () => setRetry(value => value + 1)}
        >
          {state.phase === 'stale' ? 'Project changed · check again' : 'Could not load diffs · try again'}
          <Icon name="refresh" size={15} />
        </button>
      )}
    </section>
  )
}

function ProjectDetail({
  project,
  loadProjectDiff,
  onRefresh,
  renderActivity,
  navigation,
  sourceRevision,
  refreshing,
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
            <div className="co-workspace-name-row"><h2>{project.name}</h2>
              <button className="co-icon-action" aria-label="Refresh project status" title="Refresh project status" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}><Icon name="refresh" size={17} /></button>
            </div>
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
          <h3>Files, branch and versions</h3>
          <p>See changed files and the exact versions being compared. Most work doesn’t need this view.</p>
          <ProjectFileChanges key={sourceRevision} project={project} loadProjectDiff={loadProjectDiff} onRefresh={onRefresh} />
          <ProjectPosition project={project} />
          {!project.available ? <p>No inspectable local source is available.</p> : null}
        </TaskPane>
      </article>
    </TaskContext.Provider>
  )
}

function ProjectRow({ project, selected, onSelect, quiet = false }) {
  const facts = projectBoardFacts(project)
  const next = `${facts.work}; ${facts.shared}`
  const reviewRequests = project.reviewRequests?.length || 0
  const visibleWork = reviewRequests ? facts.work.replace(/(?: · )?\d+ in review$/, '') : facts.work
  const showShared = !!(
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
        <span className="co-source-row-id"><strong>{project.name}</strong></span>
        <span className="co-source-row-facts">
          {quiet ? <span>{showShared ? facts.shared : 'No local changes'}</span> : <>
            {visibleWork ? <span>{visibleWork}</span> : null}
            {showShared ? <span className="co-source-shared">{facts.shared}</span> : null}
            {reviewRequests ? <span className="co-source-attention">{reviewRequests} review {reviewRequests === 1 ? 'request' : 'requests'}</span> : null}
          </>}
        </span>
        <span className="co-source-row-cue" aria-hidden="true">

          <Icon name="right" size={15} />
        </span>
      </button>
    </div>
  )
}

function ProjectGroup({ label, projects, selectedKey, onSelect, quiet = false }) {
  if (!projects.length) return null
  return (
    <div className="co-source-group">
      {label ? <div className="co-source-group-label">{label}</div> : null}
      {projects.map((project) => <ProjectRow key={project.key} project={project} selected={project.key === selectedKey} onSelect={onSelect} quiet={quiet} />)}
    </div>
  )
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
}) {
  const [manualRefresh, setManualRefresh] = useState('idle')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
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

  async function refreshProjects() {
    if (loading || manualRefresh === 'running') return
    setManualRefresh('running')
    try {
      const ok = await onRetry?.()
      setManualRefresh(ok ? 'done' : 'failed')
    } catch {
      setManualRefresh('failed')
    }
  }

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
  const trackedActive = tracked.filter((project) => !projectIsQuiet(project))
  const trackedQuiet = tracked.filter(projectIsQuiet)
  const external = filtered.filter((project) => project.kind === 'external')
  const externalQuestions = external.reduce((count, project) => count + (project.reviewRequests?.length || 0), 0)
  if (loading && !snapshot && !projects.length) return <LoadingState />
  return (
    <section className={'co-projects-view' + (selectedProject ? ' is-focus' : '')} aria-label="Project details">
      {selectedProject ? <h2 className="co-visually-hidden">Project detail</h2> : (
        <header className="co-view-heading">
          <div>
            <h2>Your projects</h2>
          </div>
          <div className="co-project-view-actions">
            {repositoryPicker}
            <button
              type="button"
              className="co-icon-action"
              aria-label={loading || manualRefresh === 'running' ? 'Refreshing projects' : manualRefresh === 'done' ? 'Projects updated just now' : manualRefresh === 'failed' ? 'Try refreshing projects again' : 'Refresh projects'}
              title={manualRefresh === 'failed' ? 'Try refreshing projects again' : 'Refresh projects'}
              onClick={refreshProjects}
              disabled={loading || manualRefresh === 'running'}
            >
              <Icon name={manualRefresh === 'done' ? 'check' : 'refresh'} size={15} />
              <span className="co-visually-hidden">{loading || manualRefresh === 'running' ? 'Refreshing…' : manualRefresh === 'done' ? 'Updated just now' : manualRefresh === 'failed' ? 'Try refresh again' : 'Refresh projects'}</span>
            </button>
          </div>
        </header>
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
        <>
          {renderActivity?.(null, activityNavigation)}
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
              <strong>{query.trim() ? 'No matching project' : filter === 'updates' ? 'No shared updates found' : 'No local work to prepare'}</strong>
              <span>{query.trim() ? 'Try a project name or repository.' : filter === 'all' ? 'No projects are available.' : 'All projects includes work already prepared or shared.'}</span>
            </div>
          ) : (
            <div className="co-project-index">
              <ProjectGroup
                label=""
                projects={trackedActive}
                selectedKey=""
                onSelect={openProject}
              />
              <ProjectGroup
                label={trackedActive.length ? 'Everything else' : ''}
                projects={trackedQuiet}
                selectedKey=""
                onSelect={openProject}
                quiet
              />
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
      ) : (
        <div className="co-project-layout">
          <ProjectDetail
            key={selectedProject.key}
            project={selectedProject}
            loadProjectDiff={loadProjectDiff}
            onRefresh={refreshProjects}
            refreshing={manualRefresh === 'running'}
            renderActivity={renderActivity}
            navigation={activityNavigation}
            sourceRevision={snapshot?.generated_at}
          />
        </div>
      )}
    </section>
  )
}
