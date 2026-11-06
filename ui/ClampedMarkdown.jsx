import { useEffect, useRef, useState } from 'react'
import { MarkdownView } from './MarkdownView.jsx'
import { watchOverflow } from './watchOverflow.js'

// Roughly ten text lines stay visible; anything longer waits behind Show
// more. Measured while clamped, and again when the width changes, so the
// control appears exactly when text is hidden.
export function ClampedMarkdown({ markdown }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const body = useRef(null)
  useEffect(() => (!expanded && body.current ? watchOverflow(body.current, setOverflows) : undefined), [markdown, expanded])
  return <>
    <div ref={body} className={'co-desc-body' + (expanded ? ' is-open' : '')}><MarkdownView markdown={markdown} /></div>
    {overflows || expanded ? <button type="button" className="co-quiet-action" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show more'}</button> : null}
  </>
}
