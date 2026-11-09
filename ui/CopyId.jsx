import { useState } from 'react'
import { Icon } from './Icons.jsx'
import { copyToClipboard } from './clipboard.js'

// What a GitHub event url points at: the numeric id of the review or comment.
// The owner copies it to name the exact event in a reply or an agent task.
export function commentReference(url) {
  const match = /#(?:pullrequestreview-|issuecomment-|discussion_r)(\d+)/.exec(url || '')
  return match ? match[1] : ''
}

export function CopyId({ id, label = 'id' }) {
  const [copied, setCopied] = useState(false)
  if (!id) return null
  return <button type="button" className="co-copy-id" title={`Copy ${label} ${id}`} aria-label={copied ? 'Copied' : `Copy ${label}`}
    onClick={async () => {
      // A refused copy shows no tick; the title still shows the id to copy by hand.
      if (!await copyToClipboard(String(id))) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }}><Icon name={copied ? 'check' : 'copy'} size={16} /></button>
}
