import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// The app frame's sandbox lets only same-origin and data: images load, by
// design (an external image is also a tracking beacon). A GitHub screenshot
// or badge therefore becomes a labelled link instead of a broken icon.
function linkExternalImages(html) {
  if (typeof document === 'undefined') return html
  const box = document.createElement('div')
  box.innerHTML = html
  for (const img of [...box.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || ''
    if (src.startsWith('data:') || src.startsWith('/') || src.startsWith(window.location.origin + '/')) continue
    const link = document.createElement('a')
    link.setAttribute('href', src)
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
    link.className = 'co-md-image'
    link.textContent = `Image: ${img.getAttribute('alt') || 'open on GitHub'}`
    img.replaceWith(link)
  }
  return box.innerHTML
}

function renderMarkdown(markdown) {
  const raw = marked.parse(String(markdown || ''), {
    breaks: false,
    gfm: true,
  })
  return linkExternalImages(DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } }))
}

export function MarkdownView({ markdown }) {
  const html = useMemo(() => {
    if (typeof DOMPurify.sanitize !== 'function') return null
    try {
      return renderMarkdown(markdown)
    } catch {
      return DOMPurify.sanitize(String(markdown || ''))
    }
  }, [markdown])

  function handleClick(event) {
    const anchor = event.target?.closest?.('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    let url = null
    try {
      url = new URL(href, window.location.origin)
    } catch {
      event.preventDefault()
      return
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      event.preventDefault()
      window.open(url.href, '_blank', 'noopener,noreferrer')
      return
    }
    event.preventDefault()
  }

  if (html === null) return <div className="co-markdown">{String(markdown || '')}</div>

  return (
    <div
      className="co-markdown"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
