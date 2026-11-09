import { useState } from 'react'
import { authoredPullState, authoredPulls, chainPulls, editProjects, feedbackPull, mergedRecently, needsPulls, newSince } from '../desk.js'
import { attentionListItems } from '../run.js'
import { conversationCount, reviewForPull } from '../collaboration.js'
import { frameState, reviewForRecord } from '../review-frame.js'
import { ReviewFrame } from './ReviewFrame.jsx'
import { reviewStateTone } from './ReviewTab.jsx'
import { deskEditsSentence, recordsForProject } from '../source-map.js'
import { STATUS_LABELS } from '../domain.js'
import { groupNote, lookAtReason } from './AttentionList.jsx'
import { ChecksBadge, PullStateIcon, QuietLabels, TimeAgo } from './GithubParts.jsx'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'

const PROJECT_TAGS = { platform: 'Platform', app: 'App', external: 'On GitHub' }

const matches = (query, ...parts) => !query.trim()
  || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

function NewDot({ value, lastLooked }) {
  if (!newSince(value, lastLooked)) return null
  return <span className="co-newdot" title="Changed since you last looked" />
}

// One PR under its project's card. The whole row opens the PR on its own page;
// a PR with a review running or waiting wears the comet frame, says so in a chip,
// and opens on its Review tab.
function DeskPullRow({ project, pr, chip, order, lastLooked, runs, onOpenPull }) {
  const comments = conversationCount(pr)
  const status = reviewForPull(runs || [], pr)
  const framed = frameState(status)
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
          {framed === 'verdict' ? <span className="co-desk-chip is-waiting">{reviewStateTone(status).title}</span> : null}
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
function DeskAttentionRow({ item, onSelect }) {
  const reason = lookAtReason(item)
  const detectedAt = item.record?.attention?.detected_at
  const group = groupNote(item)
  return (
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
}

// The card that keeps one app's work together: its icon and name on top, the
// rows inside, and Open to the project page itself.
function Envelope({ project, count, foldable, children, onOpenProject }) {
  const [open, setOpen] = useState(true)
  return (
    <section className={'co-envelope' + (open ? '' : ' is-folded')} aria-label={project.name}>
      <header className="co-envelope-head">
        <ProjectIcon project={project} className="co-envelope-glyph" />
        <strong>{project.name}</strong>
        {PROJECT_TAGS[project.kind] ? <span className="co-source-tag">{PROJECT_TAGS[project.kind]}</span> : null}
        {count ? <b className="co-rail-count">{count}</b> : null}
        <button type="button" className="co-quiet-action" onClick={() => onOpenProject(project.key)}>Open<Icon name="right" size={14} /></button>
        {foldable ? <button type="button" className="co-envelope-toggle" aria-expanded={open} aria-label={(open ? 'Collapse ' : 'Expand ') + project.name} onClick={() => setOpen(!open)}><Icon name="chevron" size={16} /></button> : null}
      </header>
      <div className="co-envelope-body">{children}</div>
    </section>
  )
}

function EmptyView({ icon = 'check', title, hint }) {
  return <div className="co-stage-empty"><Icon name={icon} size={20} /><strong>{title}</strong>{hint ? <span>{hint}</span> : null}</div>
}

const requestChip = { label: 'Asks for your review', tone: 'you' }

// Rows per project and view. Review requests come first in Needs you; the
// owner's saved-work decisions follow; then their own actionable PRs.
function projectRows(view, project, { login, decisionsFor, lastLooked, query, runs, onOpenPull, onOpenRecord }) {
  const rows = []
  // The search finds a project by its name too: a name match keeps all of its rows.
  const keep = (...parts) => matches(query, project.name, ...parts)
  const pull = (pr, chip, order) => rows.push(
    <DeskPullRow key={`pr:${pr.number}`} project={project} pr={pr} chip={chip} order={order} lastLooked={lastLooked} runs={runs} onOpenPull={onOpenPull} />,
  )
  const requests = view === 'work' ? [] : (project.reviewRequests || []).filter(pr => keep(pr.title, String(pr.number), pr.author?.login))
  const all = decisionsFor(project)
  const decisions = (view === 'work' ? all : view === 'needs' ? attentionListItems(all) : [])
    .filter(item => keep(item.label, String(item.record?.number || '')))
  const mine = view === 'needs' || view === 'mine'
    ? authoredPulls(project.incomingReviews, login).filter(pr => keep(pr.title, String(pr.number), pr.author?.login))
    : []
  const decisionRow = item => (
    <ReviewFrame key={`decision:${item.id}`} state={frameState(reviewForRecord(runs, item.record))} inset={3} radius={10}>
      <DeskAttentionRow item={item} onSelect={openDecision} />
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
export function DeskView({ view, projects, records, login, decisionsFor, lastLooked, query, runs = [], onOpenProject, onOpenPull, onOpenRecord }) {
  const context = { login, decisionsFor, lastLooked, query, runs, onOpenPull, onOpenRecord }
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
