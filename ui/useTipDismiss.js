import { useEffect, useState } from 'react'

// A tooltip that appears on hover or focus can be hidden with Escape without moving the pointer
// (WCAG 1.4.13). Escape hides the tooltips in the row; leaving the button it was showing on, by
// pointer or by focus, brings them back for the next one.
export function useTipDismiss() {
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (dismissed) return undefined
    const hideOnEscape = event => { if (event.key === 'Escape') setDismissed(true) }
    document.addEventListener('keydown', hideOnEscape)
    return () => document.removeEventListener('keydown', hideOnEscape)
  }, [dismissed])
  const rearm = () => setDismissed(false)
  return {
    className: dismissed ? ' is-tips-off' : '',
    // Moving between an icon and the button around it is not leaving the button.
    onPointerOut: event => {
      const from = event.target.closest('.co-tip') || null
      const to = event.relatedTarget?.closest?.('.co-tip') || null
      if (from !== to) rearm()
    },
    onBlur: rearm,
  }
}
