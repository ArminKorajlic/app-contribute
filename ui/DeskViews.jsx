import { useState } from 'react'
import { authoredPullState, authoredPulls, chainPulls, feedbackPull, mergedRecently, needsPulls, newSince, projectAgentRuns } from '../desk.js'
import { attentionListItems } from '../run.js'
import { conversationCount, prKey, reviewForPull } from '../collaboration.js'
import { savedFindings } from '../address-feedback.js'
import { frameState, reviewForRecord } from '../review-frame.js'
import { ReviewFrame } from './ReviewFrame.jsx'
import { chipOf, frameOf, standingFor } from '../pr-standing.js'
import { actionOf } from '../pr-machine.js'
import { recordsForProject } from '../source-map.js'
import { STATUS_LABELS } from '../domain.js'
import { groupNote, lookAtReason } from './AttentionList.jsx'
import { ChecksBadge, PullLabels, PullStateIcon, TimeAgo } from './GithubParts.jsx'
import { Icon } from './Icons.jsx'
import { Envelope, EmptyView } from './Envelope.jsx'
import { AgentRunsView, ReviewRow } from './ReviewsView.jsx'
import { NAMES } from '../names.js'

const matches = (query, ...parts) => !query.trim()
  || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

function NewDot({ value, lastLooked }) {
  if (!newSince(value, lastLooked)) return null
  return <span className="co-newdot" title="Changed since you last looked" />
}

// One PR under its project's card. The whole row opens the PR on its own page;
// a PR with a review running or waiting wears the comet frame, says so in a chip,
// and opens on its Review tab.
function DeskPullRow({ project, pr, chip, order, lastLooked, runs, chats, responses, onOpenPull, login, ignored }) {
  const comments = conversationCount(pr)
  const standing = standingFor({ pr, login, runs: runs || [], chats: chats || [], responses: responses || [], ignored })
  const framed = frameOf(standing)
  // While an agent works the travelling frame says it; a move of yours also gets its words.
  const standingChip = framed === 'verdict' ? chipOf(standing) : null
  return (
    <ReviewFrame state={framed} inset={3} radius={10}>
    <button type="button" className="co-desk-row" onClick={() => onOpenPull(project, pr, framed === 'idle' ? 'conversation' : 'review')}>
      <PullStateIcon pr={pr} />
      <span className="co-desk-row-main">
        <span className="co-desk-row-title"><NewDot value={pr.updatedAt} lastLooked={lastLooked} />{pr.title}</span>
        <span className="co-desk-row-meta">
          {order ? <span className="co-desk-order">{order}</span> : null}
          <span>#{pr.number} · {pr.author?.login || 'Contributor'}{pr.updatedAt ? <TimeAgo prefix=", updated " value={pr.updatedAt} /> : null}</span>
          {pr.isDraft ? <span>Draft</span> : null}
          <ChecksBadge pr={pr} />
          {Number.isInteger(pr.additions) ? <span className="co-change-total"><b>+{pr.additions}</b><em>−{pr.deletions}</em></span> : null}
        </span>
        <span className="co-pr-labels"><PullLabels pr={pr} /></span>
        {chip || standingChip ? <span className="co-row-pills">
          {chip ? <span className={'co-desk-chip is-' + chip.tone}>{chip.label}</span> : null}
          {standingChip ? <span className="co-desk-chip is-waiting">{standingChip.label}</span> : null}
        </span> : null}
      </span>
      {comments ? <span className="co-pr-comments" title={`${comments} in the conversation: comments and reviews`}><Icon name="comment" size={15} />{comments}</span> : null}
    </button>
    </ReviewFrame>
  )
}

// A saved-work card (review feedback, a decision) in the same shape as a PR
// row: icon, title, one muted line on why it is here, then its state chip on a line of its own.
function DeskAttentionRow({ item, onSelect, action = null }) {
  const reason = lookAtReason(item)
  const detectedAt = item.record?.attention?.detected_at
  const group = groupNote(item)
  const row = (
    <button type="button" className={'co-desk-row is-' + reason.key} onClick={() => onSelect(item)}>
      <Icon name="info" size={16} className="co-desk-attention-icon" />
      <span className="co-desk-row-main">
        <span className="co-desk-row-title">{item.label}</span>
        {item.detail ? <span className="co-desk-row-why">{item.detail}</span> : null}
        <span className="co-desk-row-meta">
          {group ? <span>{group}</span> : null}
          {detectedAt ? <TimeAgo prefix="Detected " value={detectedAt} /> : null}
        </span>
        <span className="co-row-pills"><span className="co-desk-chip is-tone">{reason.label}</span></span>
      </span>
    </button>
  )
  // The row's own answer sits beside it, never inside the button that opens the PR.
  return action ? <div className="co-desk-row-split">{row}<button type="button" className="co-btn co-btn-primary co-desk-row-action" onClick={action.run}>{action.label}</button></div> : row
}

const requestChip = { label: 'Asks for your review', tone: 'you' }

// Rows per project and view, each tagged with the Needs you chip that counts it
// (desk.js NEEDS_CHIPS): review requests first, then the owner's saved-work
// decisions, their own PRs with a step, and agent runs that wait on them.
function projectRows(view, project, { login, decisionsFor, lastLooked, query, runs, chats, responses, ignored, reviewEntries, onOpenPull, onOpenRecord }) {
  const rows = []
  const pull = (pr, chip, order, chipKey = '') => {
    rows.push({ chip: chipKey, el: <DeskPullRow key={`pr:${pr.number}`} project={project} pr={pr} chip={chip} order={order} lastLooked={lastLooked} runs={runs} chats={chats} responses={responses} onOpenPull={onOpenPull} login={login} ignored={ignored} /> })
  }
  const requests = view === 'needs' || view === 'requests'
    ? (project.reviewRequests || []).filter(pr => matches(query, pr.title, String(pr.number), pr.author?.login)) : []
  const all = decisionsFor(project)
  const decisions = (view === 'work' ? all : view === 'needs' ? attentionListItems(all) : [])
    .filter(item => matches(query, item.label, String(item.record?.number || '')))
  // Your own agent review of your own PR found problems at its current version:
  // the row offers the fix itself, and opens the PR straight into it.
  const fixAction = item => {
    const target = feedbackPull(item)
    const pr = target && authoredPulls(project.incomingReviews, login).find(candidate => prKey(candidate) === prKey(target))
    if (!pr || !savedFindings(reviewForPull(runs, pr), ignored)) return null
    // The machine decides whether Respond may start; a draft that already deals with the findings turns it off.
    if (!actionOf(standingFor({ pr, login, runs: runs || [], chats: chats || [], responses: responses || [], ignored }), 'respond')?.enabled) return null
    return { label: NAMES.fixFindings, run: () => onOpenPull(project, target, 'review', 'fix') }
  }
  const openDecision = item => {
    const target = feedbackPull(item)
    if (target) onOpenPull(project, target)
    else onOpenRecord(project, item)
  }
  const decisionRow = item => {
    const target = feedbackPull(item)
    return { chip: 'look', el: (
      <ReviewFrame key={`decision:${item.id}`} state={frameState(reviewForRecord(runs, item.record), { own: true, ignored })} inset={3} radius={10}>
        <DeskAttentionRow item={item} onSelect={openDecision} action={fixAction(item)} />
      </ReviewFrame>
    ) }
  }
  requests.forEach(pr => pull(pr, requestChip, '', 'review'))
  decisions.forEach(item => rows.push(decisionRow(item)))
  if (view === 'needs') {
    // A PR that already has its feedback card above is listed once, there.
    needsPulls(project, attentionListItems(all), login)
      .filter(([pr]) => matches(query, pr.title, String(pr.number)))
      .forEach(([pr, state]) => pull(pr, state, '', state.key === 'ready' ? 'merge' : 'fix'))
    projectAgentRuns(project, reviewEntries, attentionListItems(all), login)
      .filter(entry => matches(query, entry.item.title, String(entry.item.number)))
      .forEach(entry => rows.push({ chip: 'agent', el: <ReviewRow key={`run:${entry.id}`} entry={entry} project={project} onOpenPull={onOpenPull} /> }))
  }
  if (view === 'mine') {
    const mine = authoredPulls(project.incomingReviews, login).filter(pr => matches(query, pr.title, String(pr.number)))
    chainPulls(mine).forEach(chain => chain.forEach((pr, index) => pull(
      pr, authoredPullState(pr), chain.length > 1 ? `${index + 1} of ${chain.length}` : '',
    )))
  }
  return rows
}

function MergedRows({ project, records, query, lastLooked }) {
  return records
    .filter(record => matches(query, record.title, String(record.number || '')))
    .map(record => (
      <div key={record.id} className="co-desk-row is-static">
        <Icon name="merge" size={16} className="co-desk-merged-icon" />
        <span className="co-desk-row-main">
          <span className="co-desk-row-title"><NewDot value={record.updated_at} lastLooked={lastLooked} />{record.title || 'Untitled contribution'}</span>
          <span className="co-desk-row-meta">
            {record.number ? <span>#{record.number}</span> : null}
            <span>{STATUS_LABELS[record.status] || record.status}</span>
            <TimeAgo value={record.updated_at || record.created_at} />
          </span>
        </span>
      </div>
    ))
}

const EMPTY = {
  needs: { title: 'Nothing needs you right now', hint: 'Review requests, approved work, failing checks and agent runs that wait on you land here.' },
  filtered: { title: 'Nothing left for this step', hint: 'Tap the step again to see everything that needs you.' },
  requests: { icon: 'feedback', title: 'No review requests', hint: 'When someone asks for your review, the PR appears here.' },
  mine: { icon: 'pull', title: 'No open PRs of yours', hint: 'PRs you open on GitHub appear here with their next step.' },
  merged: { icon: 'check', title: 'Nothing merged this week', hint: 'Your PRs that land stay here for a week.' },
}

// My PRs holds what is open and, as a filter, what merged this week (finding 2).
const MINE_FILTERS = [['open', 'Open'], ['merged', 'Merged']]
function MineFilter({ value, counts, onChange }) {
  return <div className="co-pr-filters" role="group" aria-label="Show my PRs">
    {MINE_FILTERS.map(([key, label]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{label}<span className="co-pr-filter-count">{key === 'open' ? counts.mine || 0 : counts.merged || 0}</span></button>)}
  </div>
}

function viewEnvelopes(view, projects, { records, query, lastLooked, needsFilter, context, onOpenProject }) {
  const envelopes = []
  for (const project of projects) {
    const rows = view === 'merged'
      ? MergedRows({ project, records: mergedRecently(recordsForProject(records, project)), query, lastLooked })
      : projectRows(view, project, context).filter(row => !needsFilter || row.chip === needsFilter).map(row => row.el)
    if (rows.length) envelopes.push(
      <Envelope key={project.key} project={project} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>{rows}</Envelope>,
    )
  }
  return envelopes
}

// The selected side view: one card per app, in the projects list's own order.
export function DeskView({ view, projects, records, login, decisionsFor, lastLooked, query, runs = [], chats = [], responses = [], ignored = null, reviews = null, counts = {}, needsFilter = '', onOpenProject, onOpenPull, onOpenRecord }) {
  const [mineFilter, setMineFilter] = useState('open')
  const context = { login, decisionsFor, lastLooked, query, runs, chats, responses, ignored, reviewEntries: reviews?.entries || [], onOpenPull, onOpenRecord }
  if (view === 'runs') return <AgentRunsView reviews={reviews} projects={projects} query={query} decisionsFor={decisionsFor} renderWork={project => projectRows('work', project, context).map(row => row.el)} onOpenProject={onOpenProject} onOpenPull={onOpenPull} />
  const shownView = view === 'mine' && mineFilter === 'merged' ? 'merged' : view
  const envelopes = viewEnvelopes(shownView, projects, { records, query, lastLooked, needsFilter: view === 'needs' ? needsFilter : '', context, onOpenProject })
  const filter = view === 'mine' ? <MineFilter value={mineFilter} counts={counts} onChange={setMineFilter} /> : null
  if (!envelopes.length) {
    const empty = view === 'needs' && needsFilter ? EMPTY.filtered : EMPTY[shownView] || EMPTY.needs
    return <>{filter}<EmptyView icon={empty.icon} title={query.trim() ? 'Nothing matches your search' : empty.title} hint={query.trim() ? 'Try a PR number, a title word or a name.' : empty.hint} /></>
  }
  return <>{filter}<div className="co-desk-envelopes">{envelopes}</div></>
}
