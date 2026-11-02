import { useState } from 'react'
import { authoredPullState, authoredPulls, chainPulls, editProjects, mergedRecently, newSince } from '../desk.js'
import { attentionListItems } from '../run.js'
import { localChangeSentence, recordsForProject } from '../source-map.js'
import { STATUS_LABELS } from '../domain.js'
import { AttentionRow } from './AttentionList.jsx'
import { ChecksBadge, GithubLabel, PullStateIcon, TimeAgo } from './GithubParts.jsx'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'

const PROJECT_TAGS = { platform: 'Platform', app: 'App', external: 'On GitHub' }

const matches = (query, ...parts) => !query.trim()
  || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

function NewDot({ value, lastLooked }) {
  if (!newSince(value, lastLooked)) return null
  return <span className="co-newdot" title="Changed since you last looked" />
}

// One PR under its project's card. The whole row opens the PR in its project,
// where review, assignment and agent actions live; the chip says why it is here.
function DeskPullRow({ project, pr, chip, order, lastLooked, onOpenPull }) {
  const comments = pr.comments?.totalCount || 0
  return (
    <button type="button" className="co-desk-row" onClick={() => onOpenPull(project, pr)}>
      <PullStateIcon pr={pr} />
      <span className="co-desk-row-main">
        <span className="co-desk-row-title"><NewDot value={pr.updatedAt} lastLooked={lastLooked} />{pr.title}</span>
        {pr.labels?.nodes?.length ? <span className="co-desk-row-labels">{pr.labels.nodes.map(label => <GithubLabel key={label.name} name={label.name} color={label.color} />)}</span> : null}
        <span className="co-desk-row-meta">
          {order ? <span className="co-desk-order">{order}</span> : null}
          <span>#{pr.number} · {pr.author?.login || 'Contributor'}{pr.updatedAt ? <TimeAgo prefix=", updated " value={pr.updatedAt} /> : null}</span>
          {pr.isDraft ? <span>Draft</span> : null}
          <ChecksBadge pr={pr} />
          {Number.isInteger(pr.additions) ? <span className="co-change-total"><b>+{pr.additions}</b><em>−{pr.deletions}</em></span> : null}
          {chip ? <span className={'co-desk-chip is-' + chip.tone}>{chip.label}</span> : null}
        </span>
      </span>
      {comments ? <span className="co-pr-comments"><Icon name="comment" size={15} />{comments}</span> : null}
    </button>
  )
}

// The card that keeps one app's work together: its icon and name on top, the
// rows inside, and Open to the project page itself.
function Envelope({ project, count, children, onOpenProject }) {
  return (
    <section className="co-envelope" aria-label={project.name}>
      <header className="co-envelope-head">
        <ProjectIcon project={project} className="co-envelope-glyph" />
        <strong>{project.name}</strong>
        {PROJECT_TAGS[project.kind] ? <span className="co-source-tag">{PROJECT_TAGS[project.kind]}</span> : null}
        {count ? <b className="co-rail-count">{count}</b> : null}
        <button type="button" className="co-quiet-action" onClick={() => onOpenProject(project.key)}>Open<Icon name="right" size={14} /></button>
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
function projectRows(view, project, { login, decisionsFor, lastLooked, query, onOpenPull, onOpenRecord }) {
  const rows = []
  const pull = (pr, chip, order) => rows.push(
    <DeskPullRow key={`pr:${pr.number}`} project={project} pr={pr} chip={chip} order={order} lastLooked={lastLooked} onOpenPull={onOpenPull} />,
  )
  const requests = (project.reviewRequests || []).filter(pr => matches(query, pr.title, String(pr.number), pr.author?.login))
  const decisions = view === 'needs'
    ? attentionListItems(decisionsFor(project)).filter(item => matches(query, item.label, String(item.record?.number || '')))
    : []
  const mine = view === 'needs' || view === 'mine'
    ? authoredPulls(project.incomingReviews, login).filter(pr => matches(query, pr.title, String(pr.number)))
    : []
  if (view !== 'mine') requests.forEach(pr => pull(pr, requestChip))
  decisions.forEach(item => rows.push(
    <AttentionRow key={`decision:${item.id}`} item={item} heading={() => item.label} onSelect={() => onOpenRecord(project, item)} />,
  ))
  if (view === 'needs') {
    mine.map(pr => [pr, authoredPullState(pr)])
      .filter(([, state]) => state.tone !== 'quiet' && state.key !== 'approved_draft')
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
    .filter(record => matches(query, record.title, String(record.number || '')))
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

function EditsRow({ project, onOpenProject }) {
  const sentence = localChangeSentence(project)
  return (
    <button type="button" className="co-desk-row" onClick={() => onOpenProject(project.key)}>
      <Icon name="edit" size={16} className="co-desk-merged-icon" />
      <span className="co-desk-row-main">
        <span className="co-desk-row-title"><strong>{sentence.strong}</strong>{sentence.text}</span>
        {sentence.sub ? <span className="co-desk-row-meta"><span>{sentence.sub}</span></span> : null}
      </span>
      <span className="co-quiet-action">Open<Icon name="right" size={14} /></span>
    </button>
  )
}

const EMPTY = {
  needs: { title: 'Nothing needs you right now', hint: 'Review requests, approved work and failing checks land here.' },
  requests: { icon: 'review', title: 'No review requests', hint: 'When someone asks for your review, the PR appears here.' },
  mine: { icon: 'github', title: 'No open PRs of yours', hint: 'PRs you open on GitHub appear here with their next step.' },
  edits: { title: 'No edits waiting', hint: 'When a chat edits a project, the files to publish appear here.' },
  merged: { title: 'Nothing merged this week', hint: 'Contributions that land stay here for a week.' },
}

// The selected side view: one card per app, in the projects list's own order.
export function DeskView({ view, projects, records, login, decisionsFor, lastLooked, query, onOpenProject, onOpenPull, onOpenRecord }) {
  const context = { login, decisionsFor, lastLooked, query, onOpenPull, onOpenRecord }
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
      <Envelope key={project.key} project={project} count={count} onOpenProject={onOpenProject}>{rows}</Envelope>,
    )
  }
  if (!envelopes.length) {
    const empty = EMPTY[view] || EMPTY.needs
    return <EmptyView icon={empty.icon} title={query.trim() ? 'Nothing matches your search' : empty.title} hint={query.trim() ? 'Try a PR number, a title word or a name.' : empty.hint} />
  }
  return <div className="co-desk-envelopes">{envelopes}</div>
}
