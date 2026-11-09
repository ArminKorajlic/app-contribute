import { useState } from 'react'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'

const PROJECT_TAGS = { platform: 'Platform', app: 'App', external: 'On GitHub' }

// The card that keeps one app's work together: its icon and name on top, the
// rows inside, and Open to the project page itself.
// `group` names a second card of the same app on one page (Agent runs lists its PRs, then its prepared work).
export function Envelope({ project, count, foldable, group = '', children, onOpenProject }) {
  const [open, setOpen] = useState(true)
  return (
    <section className={'co-envelope' + (open ? '' : ' is-folded')} aria-label={project.name}>
      <header className="co-envelope-head">
        <ProjectIcon project={project} className="co-envelope-glyph" />
        <strong>{project.name}</strong>
        {group ? <span className="co-source-tag is-group">{group}</span> : null}
        {PROJECT_TAGS[project.kind] ? <span className="co-source-tag">{PROJECT_TAGS[project.kind]}</span> : null}
        {count ? <b className="co-rail-count">{count}</b> : null}
        <button type="button" className="co-btn co-btn-quiet" onClick={() => onOpenProject(project.key)}>Open<Icon name="right" size={14} /></button>
        {foldable ? <button type="button" className="co-btn co-btn-quiet co-btn-icon co-envelope-toggle" aria-expanded={open} aria-label={(open ? 'Collapse ' : 'Expand ') + project.name} onClick={() => setOpen(!open)}><Icon name="chevron" size={16} /></button> : null}
      </header>
      <div className="co-envelope-body">{children}</div>
    </section>
  )
}

export function EmptyView({ icon = 'check', title, hint }) {
  return <div className="co-stage-empty"><Icon name={icon} size={20} /><strong>{title}</strong>{hint ? <span>{hint}</span> : null}</div>
}
