import { useRef, useState } from 'react'
import { otherStage, stageWords } from '../publication-stage.js'
import { Icon } from './Icons.jsx'
import { useDismissableMenu } from './useDismissableMenu.js'

// "Open as draft ▾" / "Open for review ▾": the main button opens the exact
// sheet with the owner's default stage; the arrow offers the other one for this
// time. Each choice only opens the confirm pane: nothing is sent from here.
export function OpenSplitButton({ stage, count, disabled = false, onOpen }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  useDismissableMenu(root, open, setOpen)
  const choose = next => { setOpen(false); onOpen(next) }
  return <div className="co-split" ref={root}>
    <button type="button" className="co-btn co-btn-primary co-split-main" disabled={disabled} onClick={() => onOpen(stage)}>{stageWords(stage).action(count)}</button>
    <button type="button" className="co-btn co-btn-primary co-split-more" aria-haspopup="menu" aria-expanded={open} aria-label="More ways to open" disabled={disabled} onClick={() => setOpen(value => !value)}><Icon name="chevron" size={14} /></button>
    {open ? <div className="co-agent-menu-list co-split-list" role="menu" aria-label="How to open">
      {[stage, otherStage(stage)].map((key, index) => <button type="button" role="menuitem" key={key} className={index === 0 ? 'is-rec' : ''} onClick={() => choose(key)}>
        <span className="co-agent-menu-tile"><Icon name={stageWords(key).icon} size={17} /></span>
        <span><strong>{stageWords(key).action(count)}</strong><small>{stageWords(key).menu}{index === 0 ? ' Your default.' : ''}</small></span>
      </button>)}
    </div> : null}
  </div>
}
