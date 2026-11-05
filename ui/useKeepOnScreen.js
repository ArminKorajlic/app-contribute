import { useLayoutEffect } from 'react'

// A popup hangs from its button, but a button can sit nearer a screen edge than the popup is wide.
// On a phone a row's Actions button is indented under the title, so a menu lined up with its right
// edge ran off the left of the screen; a chat list lined up with its left edge ran off the right,
// and the page then scrolled sideways to reach it. Once open, slide the popup sideways by just
// enough to fit. The gap matches the 32px the popups' widths leave in the CSS (`100vw - 32px`), so
// there is always room. `popup` is a ref to the popup's own element, which exists only while open.
const SCREEN_GAP = 16

export function useKeepOnScreen(popup, open) {
  useLayoutEffect(() => {
    if (!open) return undefined
    const fit = () => {
      const node = popup.current
      if (!node) return
      node.style.transform = ''
      const { left, right } = node.getBoundingClientRect()
      const screenWidth = document.documentElement.clientWidth
      let shift = 0
      if (left < SCREEN_GAP) shift = SCREEN_GAP - left
      else if (right > screenWidth - SCREEN_GAP) shift = screenWidth - SCREEN_GAP - right
      if (shift) node.style.transform = `translateX(${shift}px)`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [popup, open])
}
