import { useEffect, useRef, useState } from 'react'
import { agentMenuModel } from '../agent-menu.js'
import { Icon } from './Icons.jsx'

// "Agent ▾": choose what an agent should do with the PRs. Choosing only opens
// the review window; nothing starts until the owner confirms there. `align`
// names the trigger edge the menu lines up with: 'end' for a trigger at the
// right of its row, 'start' for one at the left, so the menu opens inward.
export function AgentMenu({ onChoose, pulls = [], disabled = false, variant = 'ghost', label = 'Agent', ariaLabel, align = 'end' }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const model = agentMenuModel(pulls)
  useEffect(() => {
    if (!open) return undefined
    const closeOutside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      root.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    root.current?.addEventListener('keydown', closeOnEscape)
    const node = root.current
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      node?.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  useEffect(() => { if (open) root.current?.querySelector('[role=menuitem]:not([aria-disabled=true])')?.focus() }, [open])
  // The trigger takes focus back first, so whatever opens next returns there.
  function choose(intent) {
    setOpen(false)
    root.current?.querySelector('button')?.focus({ preventScroll: true })
    onChoose(intent)
  }
  return <div className={`co-agent-menu is-align-${align}`} ref={root}>
    <button type="button" className={`co-agent-menu-button is-${variant}`} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <Icon name="prepare" size={15} /><span>{label}</span><Icon name="chevron" size={14} />
    </button>
    {open ? <div className="co-agent-menu-list" role="menu" aria-label="What should the agent do?">
      {model.header ? <p className="co-agent-menu-head"><b>{model.header.label}</b>{model.header.text ? ` · ${model.header.text}` : ''}</p> : null}
      {model.items.map(item => <button type="button" role="menuitem" key={item.intent} aria-disabled={item.off || undefined} className={(item.rec ? 'is-rec ' : '') + (item.off ? 'is-off' : '')} onClick={() => { if (!item.off) choose(item.intent) }}>
        <span className="co-agent-menu-tile"><Icon name={item.icon} size={17} /></span><span><strong>{item.title}</strong><small>{item.off ? item.reason : item.detail}</small></span>
      </button>)}
    </div> : null}
  </div>
}
