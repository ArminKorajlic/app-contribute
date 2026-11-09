// Reports whether a clamped box holds more than it shows: once now, and again
// whenever the box or its content changes size (the viewport narrowing wraps
// the same text onto more lines, an image finishes loading). Returns the
// cleanup. Without ResizeObserver it measures once.
export function watchOverflow(box, onChange, Observer = globalThis.ResizeObserver) {
  const measure = () => onChange(box.scrollHeight > box.clientHeight + 1)
  measure()
  if (typeof Observer !== 'function') return () => {}
  const watch = new Observer(measure)
  watch.observe(box)
  if (box.firstElementChild) watch.observe(box.firstElementChild)
  return () => watch.disconnect()
}
