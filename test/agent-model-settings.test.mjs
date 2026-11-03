import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { frontendModules, renderModule } from './render-harness.mjs'

async function helpers(t) {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
    return null
  }
  return renderModule(`
    import { modelEfforts, preferredEffort, visibleRunModels } from './ui/AgentModelSettings.jsx'
    export { modelEfforts, preferredEffort, visibleRunModels }
  `)
}

test('models without their own effort list use the provider scale, like the composer', async t => {
  const api = await helpers(t)
  if (!api) return
  const claude = api.modelEfforts('claude', { id: 'claude-opus-5-5', effort_levels: null })
  assert.deepEqual(claude.map(effort => effort.value), ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'])
  assert.deepEqual(api.modelEfforts('codex', { id: 'plain', effort_levels: [] }), [], 'an empty list means no effort control')
  const narrowed = api.modelEfforts('codex', { id: 'future', effort_levels: ['low', 'high', 'high', 'turbo'] })
  assert.deepEqual(narrowed.map(effort => [effort.value, effort.label]), [['low', 'Low'], ['high', 'High'], ['turbo', 'Turbo']])
})

test('effort choice keeps a valid remembered level, else the model default, else medium', async t => {
  const api = await helpers(t)
  if (!api) return
  const efforts = api.modelEfforts('claude', {})
  assert.equal(api.preferredEffort(efforts, 'max', {}), 'max')
  assert.equal(api.preferredEffort(efforts, 'none', { default_effort: 'high' }), 'high')
  assert.equal(api.preferredEffort(efforts, 'none', {}), 'medium')
})

test('run picker lists connected visible models in composer order and keeps a hidden or offline selection', async t => {
  const api = await helpers(t)
  if (!api) return
  const registry = { providers: {
    local_runtime: [{ id: 'small', label: 'Small' }],
    claude: [{ id: 'selected-offline', label: 'Selected offline' }, { id: 'other', label: 'Other' }],
    codex: [{ id: 'shown', label: 'Shown' }, { id: 'hidden', label: 'Hidden' }],
  }, hidden_ids: ['hidden'] }
  const status = { codex: { configured: true }, claude: { configured: false }, local_runtime: { configured: true } }
  const rows = api.visibleRunModels(registry, status, { provider: 'claude', model: 'selected-offline' })
  assert.deepEqual(rows.map(row => [row.provider, row.model.id, row.configured]), [
    ['codex', 'shown', true], ['claude', 'selected-offline', false], ['local_runtime', 'small', true],
  ])
})

test('the picker is app-owned: no shell runtime selector, monochrome marks, composer-sized effort stops', async () => {
  const source = await readFile(new URL('../ui/AgentModelSettings.jsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /createModelSelector/)
  assert.doesNotMatch(css, /#d97757/i, 'provider marks follow the text color, as in the composer')
  // A 44px target per stop; the 13px dot is only the visible mark.
  assert.match(css, /\.co-effort-stop \{[^}]*width:44px; height:44px;/)
  assert.match(css, /\.co-effort-stop::before \{[^}]*width:13px; height:13px;/)
})

test('the default row carries its own effort track, and choosing a level keeps the default row selected', () => {
  const source = readFileSync(new URL('../ui/AgentModelSettings.jsx', import.meta.url), 'utf8')
  assert.match(source, /const matchesDefault = !!\(choice\?\.model && defaultChoice\?\.model && choice\.provider === defaultChoice\.provider && choice\.model === defaultChoice\.model\)/)
  assert.match(source, /defaultSelected && defaultEfforts\.length \? <div className="co-effort-indent"><EffortTrack efforts=\{defaultEfforts\}/)
  assert.match(source, /onChange\?\.\(\{ provider: defaultChoice\.provider, model: defaultChoice\.model, effort \}\)/)
  // The explicit row for the same model is not drawn as a second selection.
  assert.match(source, /choice\?\.model === model\.id && !matchesDefault/)
})
