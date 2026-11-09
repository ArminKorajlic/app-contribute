import { collaborationRequest, requestOptions } from './collaboration.js'

// The owner's editable workflow settings. Older builds also saved
// `max_rounds` and `autopilot`; neither is offered any more (automatic
// continuation is unsupported, and a round cap belongs to one takeover launch).
const KEYS = ['review_prompt', 'fix_prompt', 'merge_prompt', 'post_review', 'propose_verdict']
export function reviewOptions(value, defaults) {
  return Object.fromEntries(KEYS.map(key => [key, value?.[key] ?? defaults?.[key]]).filter(([,value]) => value !== undefined))
}
// The exact saved prompts must back every launch, so this never falls back to
// defaults. The runtime bounds each read to a few seconds; a slow but healthy
// server gets one more attempt before the owner sees a plain retry message.
export async function workflowSettings() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await window.mobius.storage.getWithVersion('review-workflow.json')
      if (result.offline) throw new Error('Go online to check the saved workflow settings.')
      return result
    } catch (error) {
      // The storage bridge may forward only the message of the runtime's abort.
      if (error?.name !== 'AbortError' && !/\babort/i.test(error?.message || '')) throw error
      if (attempt >= 1) throw new Error('Möbius is busy and didn’t answer in time. Try again in a moment.')
    }
  }
}
// The platform refuses a prompt over 16,384 UTF-8 bytes (not characters).
export const PROMPT_BYTE_LIMIT = 16384
export const promptBytes = text => new TextEncoder().encode(String(text ?? '')).length
export function oversizedPrompt(options) {
  return ['review_prompt', 'fix_prompt', 'merge_prompt'].find(key => promptBytes(options?.[key]) > PROMPT_BYTE_LIMIT) || ''
}

// Only prompts the owner actually changed are saved, so later improvements to
// the platform's presets still reach every prompt left at its default, and
// restoring a prompt removes its override.
const PROMPT_KEYS = ['review_prompt', 'fix_prompt', 'merge_prompt']
export function promptOverrides(value, defaults) {
  const options = reviewOptions(value)
  if (!defaults) return options
  return Object.fromEntries(Object.entries(options).filter(([key, text]) => !PROMPT_KEYS.includes(key) || text !== defaults[key]))
}
export async function saveWorkflowOptions(value, version, defaults = null) {
  if (oversizedPrompt(value)) throw new Error(`A prompt is longer than ${PROMPT_BYTE_LIMIT.toLocaleString('en-US')} bytes. Shorten it before saving.`)
  const receipt = await window.mobius.storage.durableWrite('review-workflow.json', promptOverrides(value, defaults), version ? { ifMatch:version } : { ifNoneMatch:true })
  if (receipt.durability !== 'synced') throw new Error('Settings are not confirmed saved. Go online and try again.')
  return receipt
}
export async function loadWorkflowOptions(token, appId) {
  const [presets, saved] = await Promise.all([
    collaborationRequest(token, appId, 'review-presets'), workflowSettings(),
  ])
  const defaults = presets.presets || presets
  // Settings apply to new work; retired keys in an older saved copy are ignored.
  return { defaults, capabilities:presets.capabilities || {}, version:saved.version, options:reviewOptions(saved.value, defaults) }
}
export function workflowAgent(choice) {
  if (!choice?.provider || !choice?.model) return undefined
  return { provider:choice.provider, model:choice.model, ...(choice.effort ? { effort:choice.effort } : {}) }
}
// The preview is mode-aware: repair options are frozen only for Review, fix
// & merge, so the request names the mode and carries only that mode's options.
export function previewWorkflow(token, appId, options, agent, mode = 'review') {
  return collaborationRequest(token, appId, 'review-preview', { mode, options:requestOptions(options, mode), ...(agent ? {agent} : {}) })
}
