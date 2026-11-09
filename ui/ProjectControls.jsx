import { useState } from 'react'
import { contributionCycleAction } from '../review.js'
import { mayMerge } from '../collaboration.js'
import { localChangeSentence, localChangeSummary, projectCycleIdentity, projectUpstreamLine } from '../source-map.js'
import { projectUpdater } from '../updates.js'
import { Icon } from './Icons.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { SourceConversations } from './SourceConversations.jsx'
import { useProjectCycle } from './useProjectCycle.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'
import { DateLabel } from './PullRequestDetail.jsx'
import { AgentModelSettings } from './AgentModelSettings.jsx'

const CYCLE_CSS = `
.co-cycle-outlet{margin:12px 0 20px;border-bottom:1px solid var(--border)}
.co-cycle-outlet .co-work-progress-row{margin:0}
.co-cycle-outlet .co-task-content{margin:12px 0 16px}
.co-cycle-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.co-cycle-history{padding-left:20px}
.co-cycle-history li{margin:4px 0}
.co-task-progress{margin:16px 0;padding:14px 16px;border:1px solid var(--border);border-radius:10px;background:var(--bg)}
.co-task-progress>strong{display:block;font-size:15px;font-weight:600;color:var(--text)}
.co-task-content .co-task-progress p{margin:4px 0 0;font-size:14px}
.co-task-progress .co-cycle-actions{margin:12px 0 0}
`

// One plain-language fact about the project, with its next step beside it.
function StatusLine({ icon, tone = 'plain', strong, text, sub, children }) {
  return <div className={'co-position-line is-' + tone}>
    <Icon name={icon} size={18} />
    <div className="co-position-text"><p><strong>{strong}</strong>{text}</p>{sub ? <small>{sub}</small> : null}</div>
    {children}
  </div>
}

const UPSTREAM_ICON = { ok: 'check', warn: 'refresh', muted: 'info' }

function LocalLine({ project, run, task }) {
  const local = localChangeSentence(project)
  const files = local.edits ? <>{local.sub ? `${local.sub} ` : ''}<button type="button" className="co-link-action" onClick={() => task?.open('task:files')}>See the files</button></> : null
  return <StatusLine icon="edit" strong={local.strong} text={local.text} sub={files}>
    {local.edits ? <button type="button" className="co-btn" disabled={!run?.privateAction} onClick={() => task?.open('task:prepare')}>Make PRs from my edits</button> : null}
  </StatusLine>
}

function UpstreamLine({ project, check }) {
  const line = projectUpstreamLine(project, check)
  if (!line) return null
  const updater = line.update ? projectUpdater(project) : null
  const checked = check?.checkedAt ? <TimeAgo prefix="Checked " value={check.checkedAt} /> : 'Use Check GitHub for the latest.'
  return <StatusLine icon={UPSTREAM_ICON[line.tone]} tone={line.tone} strong={line.strong} text={line.text} sub={updater ? updater.where : checked}>
    {updater ? <button type="button" className="co-btn" onClick={updater.open}>{updater.label}</button> : null}
  </StatusLine>
}

const STATUS_LABELS = {
  restoring: 'Checking saved work', checking: 'Checking work status', starting: 'Starting agent', stopping: 'Stopping work',
  waiting: 'Your agent has a question', paused: 'Paused', failed: 'Failed', stopped: 'Stopped',
  inactive: 'Not running', complete: 'Finished', unknown: 'Status unknown',
  scheduled: 'Waiting to continue', deleted: 'Conversation deleted',
}

// No model chosen: the launch uses the chat default.
const DEFAULT_AGENT = Object.freeze({ provider: '', model: '', effort: '' })

// Phases the project's conversation can be stopped from (as in Project work).
const CANCELLABLE_PHASES = ['running', 'waiting', 'scheduled', 'paused']
const cancelLabel = phase => phase === 'paused' ? 'Cancel paused work' : 'Cancel active work'
const NEXT_STEP = {
  paused: 'You can open it, cancel it, or start new work below.',
  failed: 'You can open it, or start new work below.',
}

// The project's current conversation, shown inside Prepare and Pull. Paused or
// failed work is not in progress, so it sits above Start rather than replacing
// it (only a running turn or a question holds new starts back).
function CycleNotice({ cycle, label, waiting, workflow }) {
  const nextStep = NEXT_STEP[cycle.phase]
  const started = cycle.startedAt ? <> · <DateLabel value={cycle.startedAt} prefix="started " /></> : null
  return <div className="co-task-progress" role="status">
    <strong>{waiting ? 'Your agent has a question' : label}</strong>
    <p>{cycle.title || 'Project work'}{started}.{nextStep ? ` ${nextStep}` : ''}</p>
    <div className="co-cycle-actions">
      <button type="button" className={'co-btn' + (nextStep ? '' : ' co-btn-primary')} onClick={() => workflow.open()}>{waiting ? 'Answer question' : 'Open conversation'}</button>
      {CANCELLABLE_PHASES.includes(cycle.phase) ? <button type="button" className="co-btn" onClick={workflow.stop}>{cancelLabel(cycle.phase)}</button> : null}
    </div>
  </div>
}

export function ProjectControls({ appId, token, project, run, onStart, loading, check = null, children }) {
  const task = useProjectTask()
  const workflow = useProjectCycle(projectCycleIdentity(project), onStart)
  const { cycle } = workflow
  const [error, setError] = useState('')
  const [follow, setFollow] = useState(false)
  const [prepareAgent, setPrepareAgent] = useState(DEFAULT_AGENT)
  const [cycleAgent, setCycleAgent] = useState(DEFAULT_AGENT)
  // Only positive platform evidence of work in progress blocks another cycle.
  // Every cycle is one message in the project's single conversation, so an
  // unknown status is not a second owner risk.
  const checking = ['restoring', 'checking'].includes(cycle.phase)
  const active = ['starting', 'running', 'scheduled', 'checking', 'stopping'].includes(cycle.phase)
  const moving = ['starting', 'running'].includes(cycle.phase)
  const waiting = cycle.phase === 'waiting'
  const statusLabel = cycle.phase === 'running'
    ? (cycle.event === 'update_source_projects' ? 'Pulling accepted changes' : 'Preparing changes')
    : STATUS_LABELS[cycle.phase] || 'Status unknown'
  const local = project.kind !== 'external'
  const changedFiles = localChangeSummary(project).changed
  // Starting a full merge cycle needs merge rights; seeing existing cycles never does.
  const cycleAction = contributionCycleAction(run, [project])
  const fullCycleAction = mayMerge(project.viewerPermission) && cycleAction ? { ...cycleAction, merge: true } : null
  async function start(action, agent) {
    setError('')
    try {
      const result = await workflow.start({ ...action, agent })
      if (!result?.ok && !result?.unsent) setError(result?.error || 'Could not start. Try again.')
    } catch { setError('Could not start. Try again.') }
  }
  const canStart = !loading && !checking && !active && !waiting
  const blockedReason = checking ? 'Checking saved work before another cycle can start.'
    : active || waiting ? 'Current work must finish or be cancelled before another cycle starts.'
    : loading ? 'Project status is still loading.' : ''
  // Cycle status and history appear once there is work to show; an idle
  // project configures new work from its Prepare action instead.
  const hasCycle = Boolean(cycle.chatId || cycle.unsent || cycle.history?.length || cycle.phase === 'unknown')
  const pendingRecovery = cycle.unsent ? <div className="co-cycle-actions">
    <button type="button" className="co-btn co-btn-primary" disabled={cycle.phase === 'starting'} onClick={() => workflow.sendAgain()}>Send again</button>
    <p className="co-task-footnote">Sends the same saved work and model. If it already arrived, it is not sent twice.</p>
  </div> : null
  const progressRow = hasCycle ? <section className="co-cycle-outlet" aria-label="Project work">
    <button type="button" className="co-work-progress-row" onClick={() => task?.open('task:cycle')} aria-expanded={task?.activeId === 'task:cycle'} aria-busy={active}>
      <span className={moving ? 'co-working-icon' : ''}><Icon name={waiting ? 'feedback' : 'prepare'} size={18} /></span>
      <span><strong>{cycle.chatId ? cycle.title || 'Agent job' : 'Agent jobs'}</strong><small>{cycle.unsent && !moving ? 'A start needs sending' : !cycle.chatId ? 'Past jobs and their conversations' : waiting ? 'Your agent has a question' : moving ? 'Agent working' : statusLabel}</small></span><Icon name="right" size={16} />
    </button>
    <TaskPane id="task:cycle" dock={false}>
      <h3>Agent jobs</h3>
      {cycle.chatId ? <p><strong>Current:</strong> {cycle.title || 'Project work'} · {statusLabel}{cycle.startedAt ? <> · <DateLabel value={cycle.startedAt} prefix="Started " /></> : null}</p> : <p>No agent job is running.</p>}
      <div className="co-cycle-actions">
        <button type="button" className="co-btn" disabled={['checking', 'restoring', 'starting', 'stopping'].includes(cycle.phase)} onClick={workflow.recheck}><Icon name="refresh" /> Check again</button>
        {cycle.chatId && cycle.phase !== 'deleted' ? <button type="button" className="co-btn" onClick={() => workflow.open()}>{waiting ? 'Answer question' : 'Open current conversation'}</button> : null}
        {CANCELLABLE_PHASES.includes(cycle.phase) ? <button type="button" className="co-btn" onClick={workflow.stop}>{cancelLabel(cycle.phase)}</button> : null}
      </div>
      {pendingRecovery}
      {fullCycleAction ? <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={cycleAgent} onChange={next => { setCycleAgent(next); return true }} />
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={!canStart} onClick={() => start(fullCycleAction, cycleAgent)}>Start fresh full merge cycle</button>
      </> : null}
      {blockedReason || cycle.error || error ? <p role="status">{blockedReason || cycle.error || error}</p> : null}
      {cycle.history?.length ? <details><summary>Past jobs ({cycle.history.length})</summary><ul className="co-cycle-history">{cycle.history.map((item, index) => <li key={`${index}:${item.started_at || item.chat_id}`}><button type="button" className="co-quiet-action" onClick={() => workflow.open(item.chat_id)}>{item.title || 'Previous project work'}{item.started_at ? <> · <DateLabel value={item.started_at} prefix="Started " /></> : null}</button></li>)}</ul></details> : null}
    </TaskPane>
  </section> : null
  const progress = cycle.chatId && (active || waiting || ['paused', 'failed'].includes(cycle.phase))
    ? <CycleNotice cycle={cycle} label={statusLabel} waiting={waiting} workflow={workflow} /> : null
  // Work in progress replaces Start; paused or failed work only sits above it.
  const startHeld = Boolean(progress) && (active || waiting)
  const alert = error || cycle.error ? <div className="co-alert" role="alert"><strong>{cycle.phase === 'unknown' ? 'Couldn’t check work status' : 'Work needs attention'}</strong><p className="co-alert-text">{error || cycle.error}</p>{pendingRecovery}</div> : null
  const controls = <section className="co-local-work" aria-label={`Actions for ${project.name}`}>
    <style>{CYCLE_CSS}</style>
    {local ? <div className="co-project-position" aria-label="Your edits and GitHub">
      <LocalLine project={project} run={run} task={task} />
      <UpstreamLine project={project} check={check} />
    </div> : null}
    {local ? <SourceConversations project={project} appId={appId} token={token} /> : null}
    <TaskPane id="task:prepare" dock={false}>
      <h3>Make PRs from your edits</h3>
      <p>An agent groups your edits into PRs and checks them. The PRs stay private on your Möbius. Nothing goes to GitHub until you press Send on each one.</p>
      {cycle.phase === 'restoring' ? <p role="status">Checking existing work…</p> : null}
      {local ? <button type="button" className="co-prepare-scope" onClick={() => task?.open('task:scope')}><span><small>Includes</small><strong>{changedFiles ? `${changedFiles} edited ${changedFiles === 1 ? 'file' : 'files'}` : 'All your edits'}</strong></span><Icon name="right" size={16} /></button> : null}
      {fullCycleAction ? <label className="co-workflow-option co-follow-merge"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /><span><strong>Follow through to merge</strong><small>Keep the agent with this change through review. You still approve sharing and merging.</small></span></label> : null}
      {progress}{startHeld ? null : <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={prepareAgent} onChange={next => { setPrepareAgent(next); return true }} />
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={!canStart || !run?.privateAction} onClick={() => follow && fullCycleAction ? start(fullCycleAction, prepareAgent) : start(run.privateAction, prepareAgent)}><Icon name="prepare" size={18} /> {follow && fullCycleAction ? 'Start and follow to merge' : 'Start'}</button>
        <p className="co-task-footnote">{blockedReason || 'Nothing goes to GitHub until you press Send.'}</p>
      </>}
      <details className="co-task-details"><summary>How it works</summary>
        <p>The agent groups related edits into the smallest sensible set of PRs, compares them with GitHub, keeps unfinished work safe, and reviews them.</p>
      </details>
      {alert}
    </TaskPane>
  </section>
  return children ? children({ controls, progress: progressRow }) : <>{controls}{progressRow}</>
}
