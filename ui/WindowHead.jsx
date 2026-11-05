import { prKey } from '../collaboration.js'
import { Icon } from './Icons.jsx'

// The top of every agent and confirm window, always the same three lines: the
// job, then "#123 PR name", then the repository. A window over several PRs
// says "N PRs" and lists each one. `tools` sit at the right (the "Seen on
// GitHub" icon, the close X); `done` turns the icon tile green.
export function WindowHead({ icon, title, titleId, pulls, tools = null, done = false }) {
  const [only] = pulls
  return <header className={'co-rw-head' + (done ? ' is-done' : '')}>
    <span className="co-rw-icon"><Icon name={icon} size={22} /></span>
    <div>
      <h3 id={titleId}>{title}</h3>
      {pulls.length === 1
        ? <p className="co-rw-pr"><strong>#{only.number} {only.title}</strong><span>{only.repository.nameWithOwner}</span></p>
        : <><p className="co-rw-pr"><strong>{pulls.length} PRs</strong></p><ul className="co-rw-list">{pulls.map(pr => <li key={prKey(pr)}><strong>#{pr.number}</strong> {pr.title}<span>{pr.repository.nameWithOwner}</span></li>)}</ul></>}
    </div>
    {tools ? <div className="co-rw-tools">{tools}</div> : null}
  </header>
}

export function CloseWindowButton({ onClick, disabled = false }) {
  return <button type="button" className="co-btn co-btn-quiet co-btn-icon co-rw-close" aria-label="Close" disabled={disabled} onClick={onClick}><Icon name="close" size={18} /></button>
}
