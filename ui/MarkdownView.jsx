import React, { useMemo } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const SCREENSHOT_SCHEME = 'screenshot:'
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

// Like marked's own attribute escape: an entity the text already carries is
// kept, so marked's escaped alt text is not escaped twice.
function escapeHtml(value) {
  return String(value).replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)|[<>"']/gi, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

// A prepared PR description names staged screenshots with a screenshot:NAME
// pseudo-URL that only Send turns into a public link. Such an image renders
// from the caller's resolved data: URL, or as a neutral placeholder; it never
// becomes an <img> pointing at screenshot:, so nothing is fetched or broken.
function screenshotImage(token, alt, images) {
  const href = String(token.href || '').trim()
  if (!href.toLowerCase().startsWith(SCREENSHOT_SCHEME)) return false
  const name = href.slice(SCREENSHOT_SCHEME.length)
  const src = Object.hasOwn(images || {}, name) ? images[name] : null
  if (typeof src === 'string' && PNG_DATA_URL.test(src)) {
    return `<img class="co-markdown-shot" src="${src}" alt="${escapeHtml(alt || 'Screenshot')}">`
  }
  return `<span class="co-markdown-shot-pending">${escapeHtml(alt ? `Screenshot: ${alt}` : 'Screenshot')}</span>`
}

// Marked's HTML before sanitizing; exported for tests, which run without a DOM.
export function markdownHtml(markdown, images = null) {
  const parser = new Marked({
    breaks: false,
    gfm: true,
    renderer: {
      // Alt text as marked's own image renderer derives it (entities and
      // escapes resolved), then escaped once for the attribute.
      image(token) {
        const alt = this.parser.parseInline(token.tokens || [], this.parser.textRenderer).trim()
        return screenshotImage(token, alt, images)
      },
    },
  })
  return parser.parse(String(markdown || ''))
}

function renderMarkdown(markdown, images) {
  return DOMPurify.sanitize(markdownHtml(markdown, images), { USE_PROFILES: { html: true } })
}

// `images` optionally maps a screenshot name to its data:image/png URL.
export function MarkdownView({ markdown, images = null }) {
  const html = useMemo(() => {
    if (typeof DOMPurify.sanitize !== 'function') return null
    try {
      return renderMarkdown(markdown, images)
    } catch {
      return DOMPurify.sanitize(String(markdown || ''))
    }
  }, [markdown, images])

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
