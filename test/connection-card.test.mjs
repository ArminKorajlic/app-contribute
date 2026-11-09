import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const connectionRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ConnectionCard, ConnectionSettings } from './ui/ConnectionCard.jsx'
  export function renderSettings(conn) {
    return renderToStaticMarkup(React.createElement(ConnectionSettings, { conn }))
  }
  export function renderConnection(conn, props = {}) {
    return renderToStaticMarkup(React.createElement(ConnectionCard, {
      conn,
      token: 'app-token',
      onChanged: () => {},
      onChooseSubmissionMethod: () => {},
      ...props,
    }))
  }
`)

test('disconnected Contribute sends the owner to Settings instead of signing in itself', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderConnection, renderSettings } = await connectionRenderer()
  const conn = { state: 'disconnected', deviceFlowAvailable: true }
  const html = renderConnection(conn)
  assert.match(html, /Legacy Möbius drafts only. New contributions use GitHub/)
  assert.match(html, /Möbius Settings → Accounts → GitHub/)
  assert.equal((html.match(/>Go to Settings to connect</g) || []).length, 1)
  assert.doesNotMatch(html, /Connect with GitHub|device code|Private repositories|Disconnect/)
  const closed = renderSettings(conn)
  assert.match(closed, /Contribute settings/)
  assert.match(closed, /Connect GitHub/)
  assert.doesNotMatch(closed, /co-settings-panel/)
})

test('connected Contribute shows the account read-only with a Settings link', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderConnection } = await connectionRenderer()
  const html = renderConnection({ state: 'connected', login: 'octocat', scopes: ['repo', 'workflow'] })
  assert.match(html, /octocat/)
  assert.match(html, /This account is shared across Möbius apps/)
  assert.match(html, />Manage account</)
  assert.doesNotMatch(html, /Disconnect|Add access/)
})

test('the header shows the connected handle without claiming an unchecked connection', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderSettings } = await connectionRenderer()
  const connected = renderSettings({ state: 'connected', login: 'octocat' })
  assert.match(connected, /octocat[\s\S]*Contribute settings/)
  assert.match(connected, /<span>Settings<\/span>/)
  assert.match(connected, /GitHub connected as octocat — Contribute settings/)
  assert.doesNotMatch(connected, /Connect GitHub|co-settings-panel/)
  for (const state of ['checking', 'unknown', 'unsupported']) {
    const html = renderSettings({ state })
    assert.match(html, /<span>Settings<\/span>/)
    assert.doesNotMatch(html, /GitHub connected|Connect GitHub|co-settings-panel/)
  }
})
