import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { fetchContributionScreenshot } from '../api.js'
import { planScreenshots } from '../domain.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
const DATA_URL = 'data:image/png;base64,' + PNG.toString('base64')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

const markdownModule = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { markdownHtml } from './ui/MarkdownView.jsx'
  import { ReviewPlan } from './ui/ContributionCard.jsx'
  export { markdownHtml }
  export function renderReview(rec) {
    return renderToStaticMarkup(React.createElement(ReviewPlan, { rec }))
  }
`)

test('the card reads a staged screenshot through the contribution route as a PNG data URL', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls = []
  let body = PNG, status = 200
  globalThis.fetch = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization })
    return { ok: status === 200, status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
  }
  const shot = name => ({ name, sha256: sha256(PNG) })
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec 1', shot('before.png')), DATA_URL)
  assert.deepEqual(calls[0], { url: '/api/github/contributions/7/rec%201/screenshots/before.png', auth: 'Bearer tok' })
  status = 404
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec', shot('gone.png')), null, 'missing')
  globalThis.fetch = async () => { throw new TypeError('offline') }
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec', shot('before.png')), null, 'offline')
})

test('a screenshot is shown only when its bytes hash to the digest its plan approved', async (t) => {
  // Two real images under one name: a restage replaces A with B on the
  // name-keyed route while a card still shows the plan that approved A.
  const A = Buffer.concat([PNG, Buffer.from('approved')]), B = Buffer.concat([PNG, Buffer.from('restaged')])
  const planA = { name: 'before.png', sha256: sha256(A) }, planB = { name: 'before.png', sha256: sha256(B) }
  const dataUrl = bytes => 'data:image/png;base64,' + bytes.toString('base64')
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let served = B
  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => served.buffer.slice(served.byteOffset, served.byteOffset + served.byteLength) })
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec', planA), null, 'restaged bytes never appear under the approved digest')
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec', planB), dataUrl(B), 'the restaged plan shows its own bytes')
  served = A
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec', planA), dataUrl(A), 'restoring A shows A')
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec', planB), null, 'and B is no longer shown for the restaged plan')
  served = Buffer.alloc(0)
  assert.equal(await fetchContributionScreenshot('tok', 7, 'rec', { name: 'empty.png', sha256: 'a'.repeat(64) }), null, 'an empty body is not a match')
})

test('only well-formed screenshot entries count', () => {
  const ok = { name: 'after-phone.png', sha256: 'a'.repeat(64), size: 10, alt: 'After' }
  assert.deepEqual(planScreenshots({ screenshots: [ok, { name: 'After.PNG', sha256: 'a'.repeat(64) }, { name: 'x.png' }, null] }), [ok])
  assert.deepEqual(planScreenshots({}), [])
  assert.deepEqual(planScreenshots({ screenshots: 'x' }), [])
})

test('Markdown renders resolved screenshot refs as data images and never emits a screenshot: URL', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { markdownHtml } = await markdownModule()
  const body = '| Before | After |\n| --- | --- |\n| ![Before, desktop](screenshot:before.png) | ![After "quoted" <b>](screenshot:after.png) |\n\n![](screenshot:bare.png) ![Logo](https://example.test/logo.png)'
  const resolved = markdownHtml(body, { 'before.png': DATA_URL, 'after.png': 'javascript:alert(1)' })
  assert.match(resolved, new RegExp(`<img class="co-markdown-shot" src="${DATA_URL.replace(/[+/]/g, '\\$&')}" alt="Before, desktop">`))
  assert.match(resolved, /<span class="co-markdown-shot-pending">Screenshot: After &quot;quoted&quot; &lt;b&gt;<\/span>/, 'a non-PNG data value is a placeholder, with escaped alt text')
  assert.match(resolved, /<span class="co-markdown-shot-pending">Screenshot<\/span>/)
  assert.match(resolved, /<img src="https:\/\/example\.test\/logo\.png" alt="Logo">/, 'ordinary images keep the default renderer')
  assert.doesNotMatch(resolved, /screenshot:/)
  const unresolved = markdownHtml(body)
  assert.doesNotMatch(unresolved, /screenshot:|data:image/)
  assert.equal((unresolved.match(/co-markdown-shot-pending/g) || []).length, 3)
  assert.match(markdownHtml('![a &amp; b \\_x\\_](screenshot:a.png)'), /Screenshot: a &amp; b _x_</, 'alt text is the rendered text, escaped once')
  assert.match(markdownHtml('![x](SCREENSHOT:before.png)'), /^<p><span class="co-markdown-shot-pending">Screenshot: x<\/span><\/p>/, 'the scheme is case-insensitive')
})

test('a prepared card tells the owner its screenshots are uploaded on Send', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderReview } = await markdownModule()
  const shot = name => ({ name, sha256: 'a'.repeat(64), size: 10, alt: name })
  const rec = status => ({ id: 'r', type: 'pr', status, repo: 'o/r', plan: { action: 'pr', title: 'T', body_draft: 'Fix\n\n![Before](screenshot:a.png)', screenshots: [shot('a.png'), shot('b.png')] } })
  assert.match(renderReview(rec('prepared')), /2 screenshots will be uploaded to your GitHub account when you send \(your fork, or this repository if you own it\)/)
  assert.doesNotMatch(renderReview(rec('open')), /will be uploaded/)
  assert.doesNotMatch(renderReview({ ...rec('prepared'), plan: { ...rec('prepared').plan, screenshots: [] } }), /will be uploaded/)
})
