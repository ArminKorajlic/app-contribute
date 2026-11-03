import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

test('settings bundle keeps one prompt surface without model or automation clutter', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { css, render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { SETTINGS_CSS } from './ui/ConnectionCard.jsx'
    import { ResolvedPrompt } from './ui/ReviewPromptSettings.jsx'
    import { ConnectionSettings } from './ui/ConnectionCard.jsx'
    export const css = SETTINGS_CSS
    export const render = value => renderToStaticMarkup(React.createElement(ResolvedPrompt, { snapshot: value, preview: true }))
    export const settings = () => renderToStaticMarkup(React.createElement(ConnectionSettings, { conn: { state: 'connected', login: 'owner' } }))
  `)
  assert.match(css, /co-prompt-editor-group/)
  assert.match(css, /co-settings-skeleton/)
  assert.match(css, /box-sizing:border-box/)
  assert.match(css, /position:fixed; inset:68px 16px auto; width:auto/)
  const html = render({ options: { provider: 'codex', model: 'current', max_rounds: null, mandatory_instructions: 'Scope gate', review_prompt: 'Review guidance', fix_prompt: 'Fix guidance', merge_prompt: 'Merge guidance' } })
  assert.match(html, /Review guidance/)
  assert.match(html, /Prompt to inspect/)
  assert.doesNotMatch(html, /repair-round|Scope gate/)

})

test('the Settings panel keeps its size and gives the saved room to the prompt text box', async t => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(new URL('../ui/ConnectionCard.jsx', import.meta.url), 'utf8')
  const prompts = readFileSync(new URL('../ui/ReviewPromptSettings.jsx', import.meta.url), 'utf8')
  // Same width as before; a fixed height with the text box taking what the other rows leave.
  assert.match(css, /width:min\(820px,calc\(100vw - 32px\)\); height:min\(947px,calc\(100dvh - 110px\)\)/)
  assert.match(css, /\.co-settings-content \.co-prompt-settings textarea \{ flex:1; min-height:150px;/)
  // The tabs become a segmented control on the heading's line; one footer row holds bytes, restore and save.
  assert.match(prompts, /<div className="co-prompt-head"><h3>Agent prompts<\/h3>\{data \? <PromptChoices/)
  assert.match(prompts, /<div className="co-prompt-foot">[\s\S]*Restore this prompt[\s\S]*Save defaults/)
  assert.doesNotMatch(prompts, /Edit guidance for new runs\. Existing runs stay unchanged\.<\/p>/)
})
