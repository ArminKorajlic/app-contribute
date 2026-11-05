import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icons.jsx'

// What GitHub will see, as one small icon beside a window's close button: amber
// when something reaches GitHub, green when nothing does. Hovering or focusing it
// opens a themed card with the words; a tap pins the card open, because a touch
// screen has no hover. The words stay in the page, so a screen reader reads them
// as the button's description.
export function SeenOnGithub({ tone, text }) {
  const root = useRef(null)
  const cardId = useId()
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    if (!pinned) return undefined
    const away = event => { if (!root.current?.contains(event.target)) setPinned(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [pinned])
  const quiet = tone === 'private'
  // Escape closes a pinned card first; the window itself closes only on the next press.
  const dismiss = event => {
    if (event.key !== 'Escape' || !pinned) return
    event.stopPropagation()
    setPinned(false)
  }
  return <span ref={root} className={'co-rw-seen ' + (quiet ? 'is-private' : 'is-public') + (pinned ? ' is-pinned' : '')} onKeyDown={dismiss}>
    <button type="button" className="co-rw-seen-btn" aria-label="Seen on GitHub" aria-describedby={cardId} onClick={() => setPinned(value => !value)}>
      <Icon name={quiet ? 'lock' : 'globe'} size={20} />
    </button>
    <span id={cardId} role="tooltip" className="co-rw-seen-card"><strong>Seen on GitHub:</strong> {text}</span>
  </span>
}
