import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { AttentionList, byUrgency, groupNote, lookAtReason } from './ui/AttentionList.jsx'
    export { byUrgency, groupNote, lookAtReason }
    export const render = props => renderToStaticMarkup(React.createElement(AttentionList, props))
  `)
  return renderer
}

const pr = (number, attention, extra = {}) => ({ id: `r${number}`, type: 'pr', status: 'open', number, needs_attention: !!attention, attention, ...extra })
const item = (id, kind, record, records = [record]) => ({ id, kind, record, unit: { type: records.length > 1 ? 'stack' : 'record', records }, detail: record?.attention?.message || '' })
const heading = entry => `#${entry.record.number}`

test('each To look at reason names what it is and what its button opens', async t => {
  const { lookAtReason } = await ui(t) || {}
  if (!lookAtReason) return
  const conflict = lookAtReason(item('a', 'public_attention', pr(1, { type: 'merge_conflict' })))
  assert.deepEqual([conflict.label, conflict.tone, conflict.action], ['Merge blocked', 'blocker', 'Review conflict'])
  // One general icon, a colour per reason: each reason carries the key that names its colour.
  assert.deepEqual(['conflict', 'checks', 'changes', 'feedback'].map(key => key), [conflict.key, lookAtReason(item('b2', 'public_attention', pr(2, { type: 'checks_failed' }))).key, lookAtReason(item('c2', 'public_attention', pr(3, { type: 'changes_requested' }))).key, lookAtReason(item('d2', 'private_review', pr(4, { type: 'github_activity' }))).key])
  // Failing checks on a published PR are a blocker, never called feedback.
  const checks = lookAtReason(item('b', 'private_review', pr(2, { type: 'checks_failed' })))
  assert.deepEqual([checks.label, checks.action], ['Checks failing', 'Review checks'])
  const news = lookAtReason(item('c', 'private_review', pr(3, { type: 'github_activity' })))
  assert.deepEqual([news.label, news.tone, news.action], ['New feedback', 'news', 'View PR'])
  assert.equal(lookAtReason(item('d', 'route_attention', pr(4, { type: 'merge_conflict' }))).label, 'Choose where to send')
  assert.equal(lookAtReason(item('e', 'public_attention', pr(5, { type: 'something_new' }))).label, 'Needs your decision')
})

test('an older merge blocker stays visible ahead of three newer comments', async t => {
  const { render, byUrgency } = await ui(t) || {}
  if (!render) return
  const comments = [10, 11, 12].map(number => item(`c${number}`, 'private_review', pr(number, { type: 'github_activity', message: 'New comment.' })))
  const conflict = item('old', 'public_attention', pr(9, { type: 'merge_conflict', message: 'Conflicts with main.' }))
  const items = [...comments, conflict]
  assert.deepEqual(byUrgency(items).map(entry => entry.id), ['old', 'c10', 'c11', 'c12'])
  const html = render({ items, heading })
  assert.match(html, /aria-label="To look at"/)
  // Folded on open: the count is enough until the owner expands it.
  assert.doesNotMatch(html, /aria-label="To look at" open/)
  assert.match(html, /<b class="co-attn-count">4<\/b>/)
  assert.match(html, /4 things need you/)
  // The folded bar counts by reason, most urgent first, and picks no single PR; its toggle has words.
  assert.match(html, /co-attn-rs is-conflict"><i aria-hidden="true"><\/i><b>1<\/b> merge blocked[\s\S]*co-attn-rs is-feedback"><i aria-hidden="true"><\/i><b>3<\/b> new feedback/)
  assert.match(html, /<span class="co-attn-show">Show 4<\/span><span class="co-attn-hide">Hide<\/span>/)
  assert.doesNotMatch(html, /co-attn-go/)
  assert.match(html, /#9[\s\S]*Merge blocked[\s\S]*Review conflict/)
  assert.doesNotMatch(html, /#12/)
  assert.match(html, /Show the other one/)
  assert.doesNotMatch(html, /own tab below/)
})

test('a related group is one row that names the affected PR and its group', async t => {
  const { render, groupNote } = await ui(t) || {}
  if (!render) return
  const affected = pr(117, { type: 'github_activity', message: 'New review from a reviewer.', detected_at: new Date().toISOString() })
  const group = item('g', 'private_review', affected, [affected, pr(118, null), pr(119, null)])
  assert.equal(groupNote(group), 'On #117 · 3 related PRs: #117, #118, #119')
  assert.equal(groupNote(item('s', 'private_review', affected)), '')
  const html = render({ items: [group], heading })
  assert.match(html, /On #117 · 3 related PRs/)
  assert.match(html, /just now/)
  assert.doesNotMatch(html, /Show the other/)
})

test('nothing to look at renders nothing rather than an all-clear', async t => {
  const { render } = await ui(t) || {}
  if (!render) return
  assert.equal(render({ items: [], heading }), '')
})
