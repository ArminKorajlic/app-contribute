import { useState } from 'react'
import { contributionCycleAction, projectUpdateAction } from '../review.js'
import { mayMerge } from '../collaboration.js'
import { incomingCount, localChangeLabel, localChangeSummary, projectBoardFacts, projectCycleIdentity } from '../source-map.js'
import { Icon } from './Icons.jsx'
import { SourceConversations } from './SourceConversations.jsx'
import { useProjectCycle } from './useProjectCycle.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'
import { DateLabel } from './PullRequestDetail.jsx'
import { AgentModelSettings } from './AgentModelSettings.jsx'

const CYCLE_CSS = `
.co-cycle-outlet{margin:12px 0 20px;border-bottom:1px solid var(--border)}
.co-cycle-outlet .co-work-progress-row{margin:0}
.co-cycle-outlet .co-task-content{margin:12px 0 16px}
.co-work-route{display:flex;align-items:center;gap:10px;margin:16px 0;padding:12px 14px;border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:14px}
.co-work-route strong{font-weight:650}
.co-work-route .co-icon{color:var(--accent);flex:none}
.co-cycle-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.co-cycle-history{padding-left:20px}
.co-cycle-history li{margin:4px 0}
.co-task-progress{margin:16px 0;padding:14px 16px;border:1px solid var(--border);border-radius:10px;background:var(--bg)}
.co-task-progress>strong{display:block;font-size:15px;font-weight:600;color:var(--text)}
.co-task-content .co-task-progress p{margin:4px 0 0;font-size:14px}
.co-task-progress .co-cycle-actions{margin:12px 0 0}
`

function WorkRoute({ pull = false }) {
  return <div className="co-work-route" role="img" aria-label={pull ? 'Accepted GitHub work moves into your local project' : 'Local work becomes a GitHub proposal only after your approval'}>
    <strong>{pull ? 'GitHub' : 'Local work'}</strong><Icon name="right" size={18} /><strong>{pull ? 'Local project' : 'GitHub proposal'}</strong>
  </div>
}

const STATUS_LABELS = {
  restoring: 'Checking saved work', checking: 'Checking work status', starting: 'Starting agent', stopping: 'Stopping work',
  waiting: 'Your agent has a question', paused: 'Work paused', failed: 'Work failed', stopped: 'Work stopped',
  inactive: 'Agent not running', complete: 'Run completed', unknown: 'Status unknown',
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

export function ProjectControls({ appId, token, project, run, onStart, loading, children }) {
  const task = useProjectTask()
  const workflow = useProjectCycle(projectCycleIdentity(project), onStart)
  const { cycle } = workflow
  const [error, setError] = useState('')
  const [follow, setFollow] = useState(false)
  const [prepareAgent, setPrepareAgent] = useState(DEFAULT_AGENT)
  const [pullAgent, setPullAgent] = useState(DEFAULT_AGENT)
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
  const canUpdate = project.available && project.canonical_repo && project.kind !== 'external'
  const local = project.kind !== 'external'
  const changedFiles = localChangeSummary(project).changed
  // Plain upstream position, like the local file count beside it. Counting
  // merged records that touch incoming files overstated pending updates.
  const incoming = project.incomingFiles > 0 || (!project.semanticAvailable && project.originBehind > 0) ? incomingCount(project) : ''
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
      <span><strong>{cycle.unsent && !moving ? 'A start needs sending' : !cycle.chatId ? 'Project work' : waiting ? 'Your agent has a question' : moving ? 'Agent working' : statusLabel}</strong><small>{cycle.chatId ? cycle.title || 'Current work' : 'Previous cycles and conversations'}</small></span><Icon name="right" size={16} />
    </button>
    <TaskPane id="task:cycle" dock={false}>
      <h3>Project work</h3>
      {cycle.chatId ? <p><strong>Current:</strong> {cycle.title || 'Project work'} · {statusLabel}{cycle.startedAt ? <> · <DateLabel value={cycle.startedAt} prefix="Started " /></> : null}</p> : <p>No current cycle.</p>}
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
      {cycle.history?.length ? <details><summary>Previous cycles ({cycle.history.length})</summary><ul className="co-cycle-history">{cycle.history.map((item, index) => <li key={`${index}:${item.started_at || item.chat_id}`}><button type="button" className="co-quiet-action" onClick={() => workflow.open(item.chat_id)}>{item.title || 'Previous project work'}{item.started_at ? <> · <DateLabel value={item.started_at} prefix="Started " /></> : null}</button></li>)}</ul></details> : null}
    </TaskPane>
  </section> : null
  const progress = cycle.chatId && (active || waiting || ['paused', 'failed'].includes(cycle.phase))
    ? <CycleNotice cycle={cycle} label={statusLabel} waiting={waiting} workflow={workflow} /> : null
  // Work in progress replaces Start; paused or failed work only sits above it.
  const startHeld = Boolean(progress) && (active || waiting)
  const alert = error || cycle.error ? <div className="co-alert" role="alert"><strong>{cycle.phase === 'unknown' ? 'Couldn’t check work status' : 'Work needs attention'}</strong><p className="co-alert-text">{error || cycle.error}</p>{pendingRecovery}</div> : null
  const controls = <section className="co-local-work" aria-label={`Actions for ${project.name}`}>
    <style>{CYCLE_CSS}</style>
    {local ? <div className="co-project-position" aria-label="Local and upstream changes">
      <div className="co-position-line">
        <Icon name="prepare" size={18} />
        <button type="button" className="co-position-inspect" onClick={() => task?.open('task:files')}><span>Local</span><strong>{project.builtHere ? 'Only on your Möbius' : localChangeLabel(project)}</strong></button>
        <button className="co-btn" disabled={!run?.privateAction} onClick={() => task?.open('task:prepare')}>Prepare changes</button>
      </div>
      {canUpdate ? <div className="co-position-line">
        <Icon name="refresh" size={18} />
        <button type="button" className="co-position-inspect" onClick={() => task?.open('task:update')}><span>Upstream</span><strong>{incoming ? `${incoming} incoming` : projectBoardFacts(project).shared}</strong></button>
        <button type="button" className="co-btn" onClick={() => task?.open('task:update')}>Pull updates</button>
      </div> : null}
    </div> : null}
    {local ? <SourceConversations project={project} appId={appId} token={token} /> : null}
    <TaskPane id="task:prepare" dock={false}>
      <h3>Prepare changes</h3>
      <p>Turn your local work into a clear proposal for private review.</p>
      <WorkRoute />
      {cycle.phase === 'restoring' ? <p role="status">Checking existing work…</p> : null}
      {local ? <button type="button" className="co-prepare-scope" onClick={() => task?.open('task:scope')}><span><small>Includes</small><strong>{changedFiles ? `${changedFiles} local ${changedFiles === 1 ? 'file' : 'files'}` : 'All local changes'}</strong></span><Icon name="right" size={16} /></button> : null}
      {fullCycleAction ? <label className="co-workflow-option co-follow-merge"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /><span><strong>Follow through to merge</strong><small>Keep the agent with this change through review. You still approve sharing and merging.</small></span></label> : null}
      {progress}{startHeld ? null : <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={prepareAgent} onChange={next => { setPrepareAgent(next); return true }} />
        <button type="button" className="co-btn co-btn-primary co-task-primary" disabled={!canStart || !run?.privateAction} onClick={() => follow && fullCycleAction ? start(fullCycleAction, prepareAgent) : start(run.privateAction, prepareAgent)}><Icon name="prepare" size={18} /> {follow && fullCycleAction ? 'Prepare and follow' : 'Start preparation'}</button>
        <p className="co-task-footnote">{blockedReason || 'Private until you approve sharing.'}</p>
      </>}
      <details className="co-task-details"><summary>How preparation works</summary>
        <p>Group related changes into the smallest sensible set of PRs. Compare with upstream, preserve unfinished work, and review thoroughly.</p>
      </details>
      {alert}
    </TaskPane>
    {canUpdate ? <TaskPane id="task:update" dock={false}>
      <h3>Pull updates</h3>
      <p>Check {project.name} against the newest shared version first, then bring the accepted work in. Unfinished local work stays safe.</p>
      <WorkRoute pull />
      <div className="co-task-scope"><strong>{projectBoardFacts(project).shared}</strong><span>Previous check</span></div>
      {progress}{startHeld ? null : <>
        <AgentModelSettings token={token} defaultHint="Your chat default" choice={pullAgent} onChange={next => { setPullAgent(next); return true }} />
        <button className="co-btn co-btn-primary co-task-primary" disabled={!canStart} onClick={() => start(projectUpdateAction([project], Date.now()), pullAgent)}>Start pull</button>
        {blockedReason ? <p className="co-task-footnote">{blockedReason}</p> : null}
      </>}
      <details className="co-task-details"><summary>How it works</summary>
        <ul className="co-task-steps"><li>Check the latest shared version.</li><li>Test the combined result away from your live installation.</li><li>Bring conflicts back to you.</li></ul>
        <p className="co-task-footnote">A merged PR does not update this installation automatically.</p>
      </details>
      {alert}
    </TaskPane> : null}
  </section>
  return children ? children({ controls, progress: progressRow }) : <>{controls}{progressRow}</>
}
