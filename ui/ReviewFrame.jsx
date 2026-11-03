import { useLayoutEffect, useRef, useState } from 'react'
import { cometLayers, cometSeconds, roundedRectPerimeter } from '../review-frame.js'

// A frame around whatever is being reviewed. While an agent works, one comet
// with a soft tail travels along a faint base frame; when the review waits on
// the owner the frame holds still and amber. `state` is 'reviewing', 'verdict'
// or 'idle' (no frame). The outline is measured, so the comet follows any size
// of card around its rounded corners. Motion is CSS only.
export function ReviewFrame({ state = 'idle', inset = 0, radius = 12, className = '', children }) {
  const box = useRef(null)
  const [size, setSize] = useState(null)
  useLayoutEffect(() => {
    const node = box.current
    if (!node || state === 'idle') return undefined
    const measure = () => setSize(old => old && old.width === node.clientWidth && old.height === node.clientHeight
      ? old : { width: node.clientWidth, height: node.clientHeight })
    measure()
    if (!window.ResizeObserver) return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [state])
  const live = state !== 'idle' && size && size.width > 2 * inset && size.height > 2 * inset
  return <div ref={box} className={'co-frame ' + className} data-frame={state} style={{ '--frame-radius': radius + 'px' }}>
    {live ? <FrameRing state={state} width={size.width - 2 * inset} height={size.height - 2 * inset} inset={inset} radius={radius} /> : null}
    {children}
  </div>
}

function FrameRing({ state, width, height, inset, radius }) {
  const stroke = state === 'reviewing' ? 3 : 2
  const r = Math.max(0, radius - inset - stroke / 2)
  const w = width - stroke, h = height - stroke
  const outline = { x: inset + stroke / 2, y: inset + stroke / 2, width: w, height: h, rx: r, strokeWidth: stroke }
  const perimeter = roundedRectPerimeter(w, h, r)
  return <svg className="co-frame-svg" viewBox={`0 0 ${width + 2 * inset} ${height + 2 * inset}`} aria-hidden="true" focusable="false">
    <rect className="co-frame-track" {...outline} />
    {state === 'reviewing' ? cometLayers(perimeter).map((layer, index) => <rect key={index} className="co-frame-comet" {...outline}
      strokeOpacity={layer.opacity} strokeDasharray={`${layer.length} ${layer.gap}`}
      style={{ '--L': layer.length + 'px', '--lap': perimeter + 'px', animationDuration: cometSeconds(perimeter) + 's' }} />) : null}
  </svg>
}
