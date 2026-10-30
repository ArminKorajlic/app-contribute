import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icons.jsx'

const CHOICES = [
  { mode: 'review', icon: 'review', title: 'Review only', detail: 'Reads the PR and gives you private notes. Changes no code.' },
  { mode: 'review_fix_merge', icon: 'fix', title: 'Review, fix and merge', detail: 'Pushes fixes, gets a second review, then merges when checks pass. You confirm first.' },
]

// "Agent ▾": choose what an agent should do with the PRs. Choosing only opens
// the review window; nothing starts until the owner confirms there. `align`
// names the trigger edge the menu lines up with: 'end' for a trigger at the
// right of its row, 'start' for one at the left, so the menu opens inward.
export function AgentMenu({ onChoose, disabled = false, active = false, variant = 'ghost', label = 'Agent', ariaLabel, align = 'end' }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
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
  useEffect(() => { if (open) root.current?.querySelector('[role=menuitem]')?.focus() }, [open])
  // The trigger takes focus back first, so whatever opens next returns there.
  function choose(mode) {
    setOpen(false)
    root.current?.querySelector('button')?.focus({ preventScroll: true })
    onChoose(mode)
  }
  return <div className={`co-agent-menu is-align-${align}`} ref={root}>
    <button type="button" className={`co-agent-menu-button is-${variant}` + (active ? ' is-active' : '')} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <Icon name="prepare" size={15} /><span>{label}</span><Icon name="chevron" size={14} />
    </button>
    {open ? <div className="co-agent-menu-list" role="menu" aria-label="What should the agent do?">
      {CHOICES.map(choice => <button type="button" role="menuitem" key={choice.mode} onClick={() => choose(choice.mode)}>
        <Icon name={choice.icon} size={18} /><span><strong>{choice.title}</strong><small>{choice.detail}</small></span>
      </button>)}
    </div> : null}
  </div>
}
