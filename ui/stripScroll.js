// A tab strip that scrolls sideways: when the open tab fits in view with the strip at its start, the strip
// starts at its first tab (nothing clipped on the left); otherwise it scrolls just enough to show the open one.
export function showOpenTab(strip, open) {
  if (!strip || !open) return
  const end = open.offsetLeft - strip.offsetLeft + open.offsetWidth
  if (end <= strip.clientWidth) strip.scrollLeft = 0
  else strip.scrollLeft = Math.max(0, end - strip.clientWidth)
}
