import { useEffect } from 'react'

// What every popup menu shares: a press outside or Escape closes it (Escape
// hands focus back to the trigger), and opening moves focus to its first
// choice that can be taken. `root` wraps the trigger and the list.
export function useDismissableMenu(root, open, setOpen) {
  useEffect(() => {
    if (!open) return undefined
    const closeOutside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      root.current?.querySelector('button')?.focus()
    }
    const node = root.current
    document.addEventListener('pointerdown', closeOutside)
    node?.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      node?.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, root, setOpen])
  useEffect(() => { if (open) root.current?.querySelector('[role=menuitem]:not([aria-disabled=true])')?.focus() }, [open, root])
}
