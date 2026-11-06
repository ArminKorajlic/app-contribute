import { Fragment, useState } from 'react'
import { authorLine, authorNames, checkWords, commitGroups, madeWithAgent, reviewMarker } from '../pull-commits.js'
import { NAMES } from '../names.js'
import { safeDetailLink } from '../pull-details.js'
import { Icon } from './Icons.jsx'

// Copy a commit's short hash. The button says what it does; the icon only helps the eye.
function CopyHash({ oid }) {
  const [copied, setCopied] = useState(false)
  return <button type="button" className="co-btn co-btn-quiet" aria-label={`${NAMES.copyHash} ${oid.slice(0, 7)}`}
    onClick={() => {
      try { navigator.clipboard?.writeText(oid) } catch { /* the short hash is on screen to copy by hand */ }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }}><Icon name={copied ? 'check' : 'copy'} size={16} /><span>{copied ? 'Copied' : NAMES.copyHash}</span></button>
}

function CommitTime({ value }) {
  if (!Number.isFinite(Date.parse(value))) return null
  const at = new Date(value)
  return <time dateTime={value} title={at.toLocaleString(undefined, { hourCycle: 'h23' })}>{at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</time>
}

function CommitRow({ commit }) {
  const names = authorNames(commit)
  const checks = checkWords(commit)
  const link = safeDetailLink(commit.url)
  const body = String(commit.messageBody || '').trim()
  return <li className="co-commit">
    <div className="co-commit-main">
      {body ? (
        // The whole title row opens the rest of the message; the chevron box only says so. The message then
        // takes the card's full width below the title, never a box squeezed beside a button.
        <details className="co-commit-body">
          <summary><strong className="co-commit-title">{commit.messageHeadline}<span className="co-visually-hidden"> — {NAMES.showFullMessage}</span></strong><span className="co-commit-toggle" aria-hidden="true"><Icon name="chevron" size={16} /></span></summary>
          <div>{body}</div>
        </details>
      ) : <strong className="co-commit-title">{commit.messageHeadline}</strong>}
      <p className="co-commit-meta">
        {names.length ? <span>{authorLine(names)} committed </span> : null}<CommitTime value={commit.committedDate} />
        {madeWithAgent(commit) ? <span className="co-commit-agent" title="Written with the Möbius agent"><Icon name="prepare" size={14} />Agent</span> : null}
        {checks ? <span className={'co-commit-checks is-' + checks.tone}>{checks.text}</span> : null}
      </p>
    </div>
    <div className="co-commit-side">
      <code>{commit.abbreviatedOid || commit.oid.slice(0, 7)}</code>
      <CopyHash oid={commit.oid} />
      {link ? <a className="co-btn co-btn-quiet" href={link} target="_blank" rel="noopener noreferrer" aria-label={`${NAMES.viewOnGitHub}: commit ${commit.oid.slice(0, 7)}`}><Icon name="github" size={16} /><span>{NAMES.viewOnGitHub}</span></a> : null}
    </div>
  </li>
}

// The PR's commits, grouped by day like GitHub, plus two things only Contribute knows: where the
// last review stopped, and a Review again banner when the PR has commits it has not seen.
// `again` is the machine's own review action for this PR (null when it is not yours to run). `pinned` is true
// when the page's one filled button already offers the same step; on a phone the banner then leaves it to the foot bar.
export function PullCommits({ data, reviewedHead = '', again = null, pinned = false, onAgain }) {
  const commits = data?.commits || []
  if (!commits.length) return <p className="co-pr-note">No commits yet.</p>
  const marker = reviewMarker(commits, reviewedHead)
  const fresh = marker.newCount > 0
  return <section className="co-commits" aria-label="Commits">
    {fresh ? <div className="co-commits-banner" role="status">
      <span>{marker.newCount}{data.hasMore ? '+' : ''} new {marker.newCount === 1 && !data.hasMore ? 'commit' : 'commits'} since your last review</span>
      {again ? <button type="button" className={'co-btn co-commits-again' + (pinned ? ' is-pinned' : '')} onClick={() => onAgain?.(again.id)}>{NAMES.reviewAgain}</button> : null}
    </div> : null}
    {commitGroups(commits).map(group => <div key={group.day} className="co-commit-day">
      <h4>Commits on {group.day}</h4>
      <ul>{group.commits.map(commit => <Fragment key={commit.oid}>
        <CommitRow commit={commit} />
        {marker.at >= 0 && commit.oid === commits[marker.at].oid ? <li className="co-commit-seen" role="separator"><span>Last review covered up to here</span></li> : null}
      </Fragment>)}</ul>
    </div>)}
  </section>
}
