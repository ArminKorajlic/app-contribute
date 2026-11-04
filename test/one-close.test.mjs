import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const pr = { number: 42, title: 'Keep PR actions stable', repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', headRefName: 'feature', url: 'https://github.com/team/repo/pull/42', author: { login: 'maker' } }

// One close control per window: the X in its header. A Cancel beside it is a second way out of
// the same panel, which is the owner's standing rule against.
test('the Review window and the Address feedback window close with their X alone', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ReviewConfirmation } from './ui/ReviewConfirmation.jsx'
    import { AddressFeedbackWindow } from './ui/AddressFeedback.jsx'
    const windows = { ReviewConfirmation, AddressFeedbackWindow }
    export const render = (name, props) => renderToStaticMarkup(React.createElement(windows[name], props))
  `)
  const review = render('ReviewConfirmation', { choice: { pulls: [pr], mode: 'review', request_id: 'fixed' }, onConfirm() {}, onCancel() {}, onModeChange() {} })
  const address = render('AddressFeedbackWindow', { pr, token: 't', appId: 1, onStart() {}, onClose() {} })
  for (const [name, html] of [['Review window', review], ['Address feedback window', address]]) {
    assert.equal((html.match(/aria-label="Close"/g) || []).length, 1, `${name} has exactly one close control`)
    assert.doesNotMatch(html, />Cancel</, `${name} has no Cancel beside the X`)
  }
  assert.match(review, />Start private review</, 'the primary button is still there')
})
