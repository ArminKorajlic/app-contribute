import { authoredPullState, authoredPulls, chainPulls, editProjects, feedbackPull, mergedRecently, needsPulls, newSince } from '../desk.js'
import { attentionListItems } from '../run.js'
import { conversationCount, prKey, reviewForPull } from '../collaboration.js'
import { savedFindings } from '../address-feedback.js'
import { frameState, reviewForRecord } from '../review-frame.js'
import { ReviewFrame } from './ReviewFrame.jsx'
import { chipOf, frameOf, standingFor } from '../pr-standing.js'
import { deskEditsSentence, recordsForProject } from '../source-map.js'
import { STATUS_LABELS } from '../domain.js'
import { groupNote, lookAtReason } from './AttentionList.jsx'
import { ChecksBadge, PullStateIcon, QuietLabels, TimeAgo } from './GithubParts.jsx'
import { Icon } from './Icons.jsx'
import { Envelope, EmptyView } from './Envelope.jsx'
import { ConfirmView, ReviewsView } from './ReviewsView.jsx'

const matches = (query, ...parts) => !query.trim()
  || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

function NewDot({ value, lastLooked }) {
  if (!newSince(value, lastLooked)) return null
  return <span className="co-newdot" title="Changed since you last looked" />
}

// One PR under its project's card. The whole row opens the PR on its own page;
// a PR with a review running or waiting wears the comet frame, says so in a chip,
// and opens on its Review tab.
function DeskPullRow({ project, pr, chip, order, lastLooked, runs, chats, onOpenPull, login, ignored }) {
  const comments = conversationCount(pr)
  const standing = standingFor({ pr, login, runs: runs || [], chats: chats || [], ignored })
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
          {chip ? <span className={'co-desk-chip is-' + chip.tone}>{chip.label}</span> : null}
          {standingChip ? <span className="co-desk-chip is-waiting">{standingChip.label}</span> : null}
        </span>
        <span className="co-pr-labels"><QuietLabels pr={pr} /></span>
      </span>
      {comments ? <span className="co-pr-comments" title={`${comments} in the conversation: comments and reviews`}><Icon name="comment" size={15} />{comments}</span> : null}
    </button>
    </ReviewFrame>
  )
}

// A saved-work card (review feedback, a decision) in the same shape as a PR
// row: icon, title, one muted line on why it is here, and a state chip.
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
          <span className="co-desk-chip is-tone">{reason.label}</span>
        </span>
      </span>
    </button>
  )
  // The row's own answer sits beside it, never inside the button that opens the PR.
  return action ? <div className="co-desk-row-split">{row}<button type="button" className="co-btn co-btn-primary co-desk-row-action" onClick={action.run}>{action.label}</button></div> : row
}

const requestChip = { label: 'Asks for your review', tone: 'you' }

// Rows per project and view. Review requests come first in Needs you; the
// owner's saved-work decisions follow; then their own actionable PRs.
function projectRows(view, project, { login, decisionsFor, lastLooked, query, runs, chats, ignored, onOpenPull, onOpenRecord }) {
  const rows = []
  // The search finds a project by its name too: a name match keeps all of its rows.
  const keep = (...parts) => matches(query, project.name, ...parts)
  const pull = (pr, chip, order) => rows.push(
    <DeskPullRow key={`pr:${pr.number}`} project={project} pr={pr} chip={chip} order={order} lastLooked={lastLooked} runs={runs} chats={chats} onOpenPull={onOpenPull} login={login} ignored={ignored} />,
  )
  const requests = view === 'work' ? [] : (project.reviewRequests || []).filter(pr => keep(pr.title, String(pr.number), pr.author?.login))
  const all = decisionsFor(project)
  const decisions = (view === 'work' ? all : view === 'needs' ? attentionListItems(all) : [])
    .filter(item => keep(item.label, String(item.record?.number || '')))
  const mine = view === 'needs' || view === 'mine'
    ? authoredPulls(project.incomingReviews, login).filter(pr => keep(pr.title, String(pr.number), pr.author?.login))
    : []
  // Your own agent review of your own PR found problems at its current version:
  // the row offers the fix itself, and opens the PR straight into it.
  const fixAction = item => {
    const target = feedbackPull(item)
    const pr = target && authoredPulls(project.incomingReviews, login).find(candidate => prKey(candidate) === prKey(target))
    if (!pr || !savedFindings(reviewForPull(runs, pr), ignored)) return null
    return { label: 'Fix these findings', run: () => onOpenPull(project, target, 'review', 'fix') }
  }
  const decisionRow = item => (
    <ReviewFrame key={`decision:${item.id}`} state={frameState(reviewForRecord(runs, item.record), { own: true, ignored })} inset={3} radius={10}>
      <DeskAttentionRow item={item} onSelect={openDecision} action={fixAction(item)} />
    </ReviewFrame>
  )
  const openDecision = item => {
    const target = feedbackPull(item)
    if (target) onOpenPull(project, target)
    else onOpenRecord(project, item)
  }
  if (view === 'work') {
    decisions.forEach(item => rows.push(decisionRow(item)))
    return rows
  }
  if (view !== 'mine') requests.forEach(pr => pull(pr, requestChip))
  decisions.forEach(item => rows.push(decisionRow(item)))
  if (view === 'needs') {
    // A PR that already has its feedback card above is listed once, there.
    needsPulls(project, attentionListItems(all), login)
      .filter(([pr]) => keep(pr.title, String(pr.number), pr.author?.login))
      .forEach(([pr, state]) => pull(pr, state))
  }
  if (view === 'mine') {
    chainPulls(mine).forEach(chain => chain.forEach((pr, index) => pull(
      pr, authoredPullState(pr), chain.length > 1 ? `${index + 1} of ${chain.length}` : '',
    )))
  }
  return rows
}

function MergedRows({ project, records, query, lastLooked }) {
  return records
    .filter(record => matches(query, project.name, record.title, String(record.number || '')))
    .map(record => (
      <div key={record.id} className="co-desk-row is-static">
        <Icon name="check" size={16} className="co-desk-merged-icon" />
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

// The card's own Open already goes to the project, so this row is only the
// fact. "Differ from GitHub" is what the files are known to do; they may
// already be in an open PR.
function EditsRow({ project, onOpenProject }) {
  const sentence = deskEditsSentence(project)
  return (
    <button type="button" className="co-desk-row" onClick={() => onOpenProject(project.key)}>
      <Icon name="edit" size={16} className="co-desk-merged-icon" />
      <span className="co-desk-row-main">
        <span className="co-desk-row-title"><strong>{sentence.strong}</strong>{sentence.text}</span>
        {sentence.sub ? <span className="co-desk-row-meta"><span>{sentence.sub}</span></span> : null}
      </span>
    </button>
  )
}

const EMPTY = {
  needs: { title: 'Nothing needs you right now', hint: 'Review requests, approved work and failing checks land here.' },
  work: { icon: 'prepare', title: 'No saved work waiting', hint: 'Prepared PRs, agent questions and feedback on your contributions land here.' },
  requests: { icon: 'review', title: 'No review requests', hint: 'When someone asks for your review, the PR appears here.' },
  mine: { icon: 'github', title: 'No open PRs of yours', hint: 'PRs you open on GitHub appear here with their next step.' },
  edits: { title: 'No edits waiting', hint: 'When a chat edits a project, the files to publish appear here.' },
  merged: { title: 'Nothing merged this week', hint: 'Contributions that land stay here for a week.' },
}

// The selected side view: one card per app, in the projects list's own order.
export function DeskView({ view, projects, records, login, decisionsFor, lastLooked, query, runs = [], chats = [], ignored = null, reviews = null, onOpenProject, onOpenPull, onOpenRecord }) {
  if (view === 'confirm' && reviews) return <ConfirmView reviews={reviews} projects={projects} query={query} onOpenProject={onOpenProject} onOpenPull={onOpenPull} />
  if (view === 'reviews' && reviews) return <ReviewsView reviews={reviews} projects={projects} query={query} onOpenProject={onOpenProject} onOpenPull={onOpenPull} />
  const context = { login, decisionsFor, lastLooked, query, runs, chats, ignored, onOpenPull, onOpenRecord }
  const envelopes = []
  for (const project of projects) {
    let rows = []
    let count = 0
    if (view === 'edits') {
      if (editProjects([project]).length && matches(query, project.name)) rows = [<EditsRow key="edits" project={project} onOpenProject={onOpenProject} />]
    } else if (view === 'merged') {
      const merged = mergedRecently(recordsForProject(records, project))
      rows = MergedRows({ project, records: merged, query, lastLooked })
      count = rows.length
    } else {
      rows = projectRows(view, project, context)
      count = rows.length
    }
    if (rows.length) envelopes.push(
      <Envelope key={project.key} project={project} count={count} foldable={rows.length > 1} onOpenProject={onOpenProject}>{rows}</Envelope>,
    )
  }
  if (!envelopes.length) {
    const empty = EMPTY[view] || EMPTY.needs
    return <EmptyView icon={empty.icon} title={query.trim() ? 'Nothing matches your search' : empty.title} hint={query.trim() ? 'Try a PR number, a title word or a name.' : empty.hint} />
  }
  return <div className="co-desk-envelopes">{envelopes}</div>
}
