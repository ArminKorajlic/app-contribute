import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

// A modal for a consent that needs protected focus: the page behind stays put,
// Tab stays inside, Escape or a click outside closes it, and focus returns to
// whatever opened it.
export function ReviewDialog({ onClose, children }) {
  const panel = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  function keepFocusInside(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const items = [...(panel.current?.querySelectorAll(FOCUSABLE) || [])]
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault() }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault() }
  }
  return <div className="co-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} className="co-dialog" role="dialog" aria-modal="true" aria-label="Agent workflow" onKeyDown={keepFocusInside}>{children}</div>
  </div>
}
