import { useEffect, useState } from 'react'
import { deskEditsSentence } from '../source-map.js'
import { Icon } from './Icons.jsx'
import UnifiedDiff from './diff/UnifiedDiff.jsx'
import { parseUnifiedDiff } from './diff/parseUnifiedDiff.js'
import { useProjectTask } from './TaskPane.jsx'

export function ProjectFileChanges({ project, loadProjectDiff, onRefresh }) {
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

// The Edits tab: what differs from GitHub here, with the way to turn it into PRs.
export function ProjectEdits({ project, run, loadProjectDiff, onRefresh }) {
  const task = useProjectTask()
  const sentence = deskEditsSentence(project)
  return <section className="co-project-edits" aria-label="Your edits">
    <div className="co-edits-head">
      <p><strong>{sentence.strong}</strong>{sentence.text}{sentence.sub ? <small>{sentence.sub}</small> : null}</p>
      <button type="button" className="co-btn" disabled={!run?.privateAction} onClick={() => task?.open('task:prepare')}><Icon name="prepare" size={15} />Make PRs from my edits</button>
    </div>
    <ProjectFileChanges project={project} loadProjectDiff={loadProjectDiff} onRefresh={onRefresh} />
  </section>
}
