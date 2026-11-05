import { useEffect, useRef, useState } from 'react'
import { MarkdownView } from './MarkdownView.jsx'

// Roughly ten text lines stay visible; anything longer waits behind Show
// more. Measured while clamped, so the control appears only when needed.
export function ClampedMarkdown({ markdown }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const body = useRef(null)
  useEffect(() => {
    if (!expanded && body.current) setOverflows(body.current.scrollHeight > body.current.clientHeight + 1)
  }, [markdown, expanded])
  return <>
    <div ref={body} className={'co-desc-body' + (expanded ? ' is-open' : '')}><MarkdownView markdown={markdown} /></div>
    {overflows || expanded ? <button type="button" className="co-btn co-btn-quiet" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show more'}</button> : null}
  </>
}
