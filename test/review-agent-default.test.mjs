import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeAppSettings } from '../storage.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const pr = { number: 42, title: 'Keep PR actions stable', repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/42', author: { login: 'maker' } }
const saved = { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'high' }
const posting = { post_review: true, propose_verdict: true, agent_submits_verdict: true }
const caps = { post_review: true, propose_verdict: true, agent_submits_verdict: true }

test('the saved review agent is kept when it names a model and fits the platform limits', () => {
  assert.deepEqual(normalizeAppSettings({ review_agent: saved }).review_agent, saved)
  assert.deepEqual(normalizeAppSettings({ review_agent: { provider: 'codex', model: 'gpt-x' } }).review_agent, { provider: 'codex', model: 'gpt-x' })
})

test('a saved review agent that names no model or is too long is dropped, not repaired', () => {
  for (const bad of [{ provider: 'claude' }, { model: 'm' }, 'claude', 7, { ...saved, model: 'm'.repeat(257) }, { ...saved, effort: 'e'.repeat(33) }]) {
    assert.equal('review_agent' in normalizeAppSettings({ review_agent: bad }), false, JSON.stringify(bad))
  }
  assert.equal('review_agent' in normalizeAppSettings(null), false)
})

test('the retired app-wide model keys stay retired and never become the review agent', () => {
  const settings = normalizeAppSettings({ agent_provider: 'claude', agent_model: 'old', agent_effort: 'low' })
  assert.equal('review_agent' in settings, false)
  assert.equal('agent_model' in settings, false)
})

test('picking the Default row sends the saved agent, so the row never names one model while another runs', async t => {
  const api = await windows(t)
  if (!api) return
  const { defaultRowChoice } = api
  assert.deepEqual(defaultRowChoice(saved, true, 'max'), { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'max' })
  assert.deepEqual(defaultRowChoice(saved, true, ''), saved)
  // The server's own default is resolved when the work starts, so nothing is sent.
  assert.deepEqual(defaultRowChoice(saved, false, 'max'), { provider: '', model: '', effort: '' })
  assert.deepEqual(defaultRowChoice(null, true, 'max'), { provider: '', model: '', effort: '' })
})

async function windows(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  return renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ReviewConfirmation } from './ui/ReviewConfirmation.jsx'
    import { AddressFeedbackWindow } from './ui/AddressFeedback.jsx'
    import { DefaultAgentSettings } from './ui/DefaultAgentSettings.jsx'
    import { defaultRowChoice } from './ui/AgentModelSettings.jsx'
    const views = { ReviewConfirmation, AddressFeedbackWindow, DefaultAgentSettings }
    export { defaultRowChoice }
    export const render = (name, props) => renderToStaticMarkup(React.createElement(views[name], props))
  `)
}

test('a Review window starts on the saved agent and names it as the default', async t => {
  const api = await windows(t)
  if (!api) return
  const withDefault = api.render('ReviewConfirmation', { choice: { pulls: [pr], mode: 'review', agent: saved }, defaultAgent: saved, token: 't', onAgentChange() {}, onModeChange() {} })
  assert.match(withDefault, /Default \(claude-sonnet-5-5\)/)
  assert.match(withDefault, /<small>High<\/small>/)
  const without = api.render('ReviewConfirmation', { choice: { pulls: [pr], mode: 'review' }, token: 't', onAgentChange() {}, onModeChange() {} })
  assert.match(without, /Default model/)
  assert.match(without, /Your background agent setting/)
})

test('a Respond to feedback window starts on the saved agent too', async t => {
  const api = await windows(t)
  if (!api) return
  const html = api.render('AddressFeedbackWindow', { pr, token: 't', appId: 1, defaultAgent: saved, onStart() {}, onClose() {} })
  assert.match(html, /Default \(claude-sonnet-5-5\)/)
})

test('Settings offers one default agent for reviews and fixes, with a plain sentence about what it does', async t => {
  const api = await windows(t)
  if (!api) return
  const html = api.render('DefaultAgentSettings', { token: 't', agent: saved, onChange() {} })
  assert.match(html, /<h3>Default agent<\/h3>/)
  assert.match(html, /Suggested each time you review, re-review or fix\. Each window still lets you pick a different agent for that run\./)
  assert.match(html, /claude-sonnet-5-5/)
  const unset = api.render('DefaultAgentSettings', { token: 't', agent: null, onChange() {} })
  assert.match(unset, /Default model/)
  assert.equal(api.render('DefaultAgentSettings', { token: 't', agent: saved }), '', 'nothing to save to, nothing shown')
})

test('what GitHub will see is one icon beside Close, and the words stay in the page for a screen reader', async t => {
  const api = await windows(t)
  if (!api) return
  const html = api.render('ReviewConfirmation', { choice: { pulls: [pr], mode: 'review', intent: 'review', options: posting }, capabilities: caps, onModeChange() {}, onOptionsChange() {}, onCancel() {} })
  assert.match(html, /class="co-rw-tools"><span class="co-rw-seen is-public">/)
  assert.match(html, /role="tooltip"[^>]*><strong>Seen on GitHub:<\/strong> one approve, request changes or comment, posted by the agent from your account as you allowed/)
  assert.doesNotMatch(html, /co-rw-public/, 'the full-width box is gone')
  const quiet = api.render('ReviewConfirmation', { choice: { pulls: [pr], mode: 'review' }, onModeChange() {}, onCancel() {} })
  assert.match(quiet, /co-rw-seen is-private/)
  assert.match(quiet, /<strong>Seen on GitHub:<\/strong> nothing\. Only you see the review\./)
  // The fix window says the same thing the same way.
  const fix = api.render('AddressFeedbackWindow', { pr, token: 't', appId: 1, onStart() {}, onClose() {} })
  assert.match(fix, /co-rw-seen is-private/)
  assert.equal((fix.match(/aria-label="Close"/g) || []).length, 1)
})

test('Who sees the result sits on one row: the question on the left, the three choices on the right', async t => {
  const api = await windows(t)
  if (!api) return
  const html = api.render('ReviewConfirmation', { choice: { pulls: [pr], mode: 'review', intent: 'review', options: posting }, capabilities: caps, onModeChange() {}, onOptionsChange() {} })
  assert.match(html, /<div class="co-rw-who-row"><h4 class="co-rw-label">Who sees the result\?<\/h4><div class="co-seg" role="radiogroup"/)
  assert.match(html, /<\/div><\/div><p class="co-rw-note">It posts its verdict/, 'the explanation is below the row, not beside it')
})

test('the dialog styles give the row, the steps and the hover card their room', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-rw-who \{ display:flex; flex-direction:column; gap:12px; \}/)
  assert.match(css, /\.co-rw-who-row \{ display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;/)
  assert.match(css, /\.co-rw-who \.co-rw-label \{ margin:0; \}/, 'the label no longer pulls up into the choices')
  assert.match(css, /\.co-rw-steps li \{[^}]*padding:0 0 18px;/)
  assert.match(css, /\.co-rw-seen-card \{[^}]*background:var\(--surface-2,var\(--surface\)\)/, 'the card is drawn in the theme, not the browser default')
  assert.match(css, /\.co-rw-seen-btn:focus-visible \+ \.co-rw-seen-card/, 'keyboard focus opens it too')
  assert.match(css, /@media \(hover:hover\) and \(pointer:fine\) \{ \.co-rw-seen-btn:hover \+ \.co-rw-seen-card/, 'hover only where there is a hover')
})

test('a new Review or Fix window is started from the saved agent, and only when there is one', () => {
  const list = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  assert.match(list, /\.\.\.\(defaultAgent\?\.model \? \{ agent: defaultAgent \} : \{\}\)/)
  assert.match(list, /<ReviewConfirmation [^>]*defaultAgent=\{defaultAgent\}/)
  assert.match(list, /<AddressFeedbackWindow [^>]*defaultAgent=\{defaultAgent\}/)
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.equal((app.match(/defaultAgent=\{reviewAgent\}/g) || []).length, 2, 'the page and the list both receive it')
  assert.match(app, /reviewAgent=\{reviewAgent\} onChangeReviewAgent=\{onChangeReviewAgent\}/)
})

// The owner never wants a scrollbar beside the agent dropdown: not on the list,
// not on the Settings panel that holds it, not on a dialog it makes taller.
test('the agent dropdown, the Settings panel and the dialog scroll without ever showing a scrollbar', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('../ui/ConnectionCard.jsx', import.meta.url), 'utf8')
  assert.match(css, /\.co-model-list \{[^}]*overflow:auto;[^}]*scrollbar-width:none;/)
  assert.match(css, /\.co-model-list::-webkit-scrollbar \{ display:none; \}/)
  assert.match(css, /\.co-dialog \{[^}]*overflow:auto;[^}]*scrollbar-width:none;/)
  assert.match(css, /\.co-dialog::-webkit-scrollbar \{ display:none; \}/)
  assert.match(settings, /\.co-settings-content \{[^}]*overflow-y:auto; scrollbar-width:none;/)
  assert.match(settings, /\.co-settings-workspace \{[^}]*scrollbar-width:none;/)
  assert.match(settings, /\.co-settings-workspace::-webkit-scrollbar,\.co-settings-content::-webkit-scrollbar \{ display:none; \}/)
})
