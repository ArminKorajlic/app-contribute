import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function render(t, name, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ReviewTab } from './ui/ReviewTab.jsx'
    import { PullRequestDetail } from './ui/PullRequestDetail.jsx'
    const components = { ReviewTab, PullRequestDetail }
    export function render(name, props) { return renderToStaticMarkup(React.createElement(components[name], props)) }
  `)
  return (await renderer).render(name, props)
}
const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
const status = (state, item = {}, run = {}) => ({ run: { id: 'r1', state: 'running', execution_state: 'running', mode: 'review', chat_id: 'chat-1', can_stop: true, created_at: new Date().toISOString(), ...run }, item: { repo: 'team/repo', number: 9, head_sha: 'a'.repeat(40), base_ref: 'main', state, ...item } })

test('a PR nobody reviewed still has its Review tab and says so, without start buttons', async t => {
  const html = await render(t, 'ReviewTab', { pr, status: null, onStart: () => {} })
  if (!html) return
  assert.match(html, /No review yet/)
  assert.match(html, /You haven’t made a review for this PR/)
  assert.match(html, /Use Agent above to start one/)
  // The Agent button above starts a review; the empty tab adds no second set of buttons.
  assert.doesNotMatch(html, /<button/)
  const closed = await render(t, 'ReviewTab', { pr, status: null, readOnly: true })
  assert.doesNotMatch(closed, /Use Agent above/, 'a closed PR offers no review')
})

test('a running review shows a smooth spinner, the clock, the version and Stop inside the comet frame', async t => {
  const html = await render(t, 'ReviewTab', { pr, status: status('reviewing'), onStop: () => {} })
  if (!html) return
  assert.match(html, /co-arc/)
  assert.match(html, /<h4>Reviewing<\/h4>/)
  assert.match(html, /co-review-elapsed/)
  assert.match(html, /aaaaaaa → main/)
  assert.match(html, /Stop review/)
  assert.match(html, /Open review conversation/)
  assert.match(html, /data-frame="reviewing"/)
})

test('a verdict waiting for you offers Submit; on your own PR GitHub refuses it, so only Discard remains', async t => {
  const proposal = { id: 'p1', state: 'proposed', event: 'APPROVE', body: 'Looks right.' }
  const waiting = status('verdict_pending', { summary: 'No blockers.', verdict_proposal: proposal })
  const others = await render(t, 'ReviewTab', { pr, status: waiting, onVerdict: () => {} })
  if (!others) return
  assert.match(others, /Verdict waiting for you/)
  assert.match(others, /Approve on GitHub/)
  assert.match(others, /data-frame="verdict"/)
  const own = await render(t, 'ReviewTab', { pr, status: waiting, own: true, onVerdict: () => {} })
  assert.doesNotMatch(own, /Approve on GitHub/)
  assert.match(own, /does not let you approve or request changes on your own PR/)
  assert.match(own, />Discard</)
})

test('a clear review is green with its copyable id; blockers and halted runs read as changes', async t => {
  const clear = await render(t, 'ReviewTab', { pr, status: status('all_clear', { summary: 'No blocking problems.', verdict_proposal: { state: 'posted', event: 'APPROVE', review_id: 5681065396, url: 'https://github.com/team/repo/pull/9#pullrequestreview-5681065396' } }, { state: 'complete', execution_state: 'completed' }) })
  if (!clear) return
  assert.match(clear, /co-review-box is-clear/)
  assert.match(clear, /Review clear/)
  assert.match(clear, /Copy review id 5681065396/)
  assert.doesNotMatch(clear, /data-frame="reviewing"|data-frame="verdict"/, 'finished work keeps no frame')
  const changes = await render(t, 'ReviewTab', { pr, status: status('needs_you', { summary: 'P1 problem', verdict_proposal: { state: 'discarded', event: 'REQUEST_CHANGES' } }) })
  assert.match(changes, /Changes found/)
  assert.match(changes, /is-changes/)
  const halted = await render(t, 'ReviewTab', { pr, status: status('reviewing', {}, { execution_state: 'stopped' }), onRetry: () => {} })
  assert.match(halted, /Not finished/)
  assert.match(halted, /Start again/)
})

test('the PR page carries a fourth Review tab with its state, and opens on it when asked', async t => {
  const plain = await render(t, 'PullRequestDetail', { pr, status: null, cacheStore: { entries: {} } })
  if (!plain) return
  assert.match(plain, />Review<\/button>/)
  const running = await render(t, 'PullRequestDetail', { pr, status: status('reviewing'), initialTab: 'review', cacheStore: { entries: {} }, review: { onStop: () => {} } })
  assert.match(running, /aria-pressed="true">Review<span class="co-arc"/)
  assert.match(running, /Reviewing/)
  const clear = await render(t, 'PullRequestDetail', { pr, status: status('all_clear', {}, { state: 'complete', execution_state: 'completed' }), cacheStore: { entries: {} } })
  assert.match(clear, /Review<span class="co-tab-dot is-success"/)
})

test('a PR that changed after its review says so, shows the old findings and offers to review this version', async t => {
  const earlier = status('all_clear', { head_sha: 'b'.repeat(40), summary: 'No blockers at the old commit.' }, { state: 'complete', execution_state: 'completed' })
  const html = await render(t, 'ReviewTab', { pr, status: null, earlier, onStart: () => {} })
  if (!html) return
  assert.match(html, /Reviewed an earlier version/)
  assert.match(html, /bbbbbbb/)
  assert.match(html, /may no longer apply/)
  assert.match(html, /No blockers at the old commit/)
  assert.match(html, />Review this version</)
  assert.doesNotMatch(html, /You haven’t made a review/, 'an earlier review exists, so it was reviewed')
  const closed = await render(t, 'ReviewTab', { pr, status: null, earlier, readOnly: true })
  assert.doesNotMatch(closed, />Review this version</)
})
