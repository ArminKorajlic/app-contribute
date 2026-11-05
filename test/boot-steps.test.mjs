import test from 'node:test'
import assert from 'node:assert/strict'
import { bootSteps } from '../boot-steps.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const none = { ledgerReady: false, projectsReady: false, accountReady: false, accountConnected: false, pullsReady: false, runsReady: false }

test('the opening screen names five steps and counts the ones that finished', () => {
  const start = bootSteps(none)
  assert.deepEqual(start.steps.map(step => step.label), ['Prepared PRs', 'Repositories', 'GitHub account', 'Pull requests', 'Agent runs'])
  // Without a connected account there are no pull requests to read: that step is already done.
  assert.deepEqual([start.done, start.total, start.current], [1, 5, 'Prepared PRs'])
  const mid = bootSteps({ ...none, ledgerReady: true, projectsReady: true, accountReady: true, accountConnected: true, projectCount: 3 })
  assert.deepEqual([mid.done, mid.current], [3, 'Pull requests'])
  assert.equal(mid.steps[1].detail, '3 repositories')
  const done = bootSteps({ ...none, ledgerReady: true, projectsReady: true, accountReady: true, accountConnected: true, pullsReady: true, runsReady: true, projectCount: 1, pullCount: 14 })
  assert.deepEqual([done.done, done.current], [5, ''])
  assert.deepEqual([done.steps[1].detail, done.steps[3].detail], ['1 repository', '14 PRs'])
})

test('a step shows a count only after its read produced one, never while it is still waiting', () => {
  const waiting = bootSteps({ ...none, accountConnected: true, projectCount: 9, pullCount: 9 })
  assert.deepEqual(waiting.steps.map(step => step.detail || ''), ['', '', '', '', ''])
})

test('the screen shows the step it is on, a progress bar with its value, and every step', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { BootProgress } from './ui/BootProgress.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(BootProgress, props))
  `)
  const html = render({ ...none, ledgerReady: true, projectsReady: true, accountReady: true, accountConnected: true, projectCount: 4 })
  assert.match(html, /Opening Contribute…/)
  assert.match(html, /Reading pull requests from GitHub and your Möbius\./)
  assert.match(html, /role="progressbar"[^>]*aria-valuemax="5"[^>]*aria-valuenow="3"/)
  assert.match(html, /<li class="is-done"><span>Repositories<\/span><em>4 repositories<\/em>/)
  assert.match(html, /<li class="is-current"><span>Pull requests<\/span><em>reading<\/em>/)
  assert.match(html, /<li class=""><span>Agent runs<\/span><em>waiting<\/em>/)
})
