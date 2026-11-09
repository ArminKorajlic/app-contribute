import { useRef, useState } from 'react'
import { actionsMenuModel } from '../actions-menu.js'
import { Icon } from './Icons.jsx'
import { useDismissableMenu } from './useDismissableMenu.js'

// "Actions ▾": what you can do yourself with a PR, and what an agent can do for
// it. Choosing only opens the confirm sheet or review window; nothing starts
// until the owner confirms there. `align` names the trigger edge the menu lines
// up with: 'end' for a trigger at the right of its row, 'start' for one at the
// left, so the menu opens inward.
function Choice({ item, onPick }) {
  return <button type="button" role="menuitem" aria-disabled={item.off || undefined} className={(item.rec ? 'is-rec ' : '') + (item.off ? 'is-off' : '')} onClick={() => { if (!item.off) onPick(item.intent) }}>
    <span className="co-agent-menu-tile"><Icon name={item.icon} size={17} /></span><span><strong>{item.title}</strong><small>{item.off ? item.reason : item.detail}</small></span>
  </button>
}

// With only one group the menu is a plain list; with two, each is named.
function Group({ title, items, onPick, named }) {
  if (!items.length) return null
  return <div role="group" aria-label={title}>
    {named ? <p className="co-agent-menu-group">{title}</p> : null}
    {items.map(item => <Choice key={item.intent} item={item} onPick={onPick} />)}
  </div>
}

// `defaultOpen` shows the list on first render, which is how the menu's own words are tested.
export function ActionsMenu({ onChoose, pulls = [], record = null, capabilities = null, own = false, disabled = false, variant = 'ghost', label = 'Actions', ariaLabel, align = 'end', defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const root = useRef(null)
  const model = actionsMenuModel(pulls, { record, capabilities, own })
  useDismissableMenu(root, open, setOpen)
  // The trigger takes focus back first, so whatever opens next returns there.
  function choose(intent) {
    setOpen(false)
    root.current?.querySelector('button')?.focus({ preventScroll: true })
    onChoose(intent)
  }
  const named = model.you.length > 0
  return <div className={`co-agent-menu is-align-${align}`} ref={root}>
    <button type="button" className={`co-agent-menu-button is-${variant}`} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <Icon name="prepare" size={15} /><span>{label}</span><Icon name="chevron" size={14} />
    </button>
    {open ? <div className="co-agent-menu-list" role="menu" aria-label="Actions">
      {model.header ? <p className="co-agent-menu-head"><b>{model.header.label}</b>{model.header.text ? ` · ${model.header.text}` : ''}</p> : null}
      <Group title="You" items={model.you} onPick={choose} named={named} />
      <Group title="Agent" items={model.agent} onPick={choose} named={named} />
    </div> : null}
  </div>
}
