/** Run-level agent choice, drawn to match the chat composer's model picker.
 *
 * The composer (Brain) is the visual reference, not a dependency: this app
 * keeps its own copy of the row and effort-track design so restyling one
 * never changes the other. Keep the sizes, monochrome provider marks and
 * effort stops in step with the shell's ChatSettingsPanel/EffortStepper.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icons.jsx'

const PROVIDER_ORDER = ['codex', 'claude', 'mobius']
const effortRows = rows => rows.map(([value, label]) => ({ value, label }))
// Provider default effort scales, as published by the shell's provider
// registry. A model's `effort_levels` may narrow, reorder or extend them.
export const PROVIDERS = {
  codex: { label: 'OpenAI Codex', efforts: effortRows([['none', 'None'], ['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high']]) },
  claude: { label: 'Claude Code', efforts: effortRows([['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max'], ['ultracode', 'Ultracode']]) },
  mobius: { label: 'Möbius', efforts: effortRows([['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max']]) },
}
const titleCase = value => String(value).replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase())
export const providerLabel = (provider, status) => status?.[provider]?.name || PROVIDERS[provider]?.label || titleCase(provider)

/** Same contract as the shell's modelEfforts: null levels use the provider
 *  scale, an empty list means the model takes no effort setting. */
export function modelEfforts(provider, model) {
  const defaults = PROVIDERS[provider]?.efforts || effortRows([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])
  const levels = model?.effort_levels
  if (!Array.isArray(levels)) return defaults
  if (!levels.length) return []
  const known = new Map(defaults.map(effort => [effort.value, effort]))
  const seen = new Set()
  const resolved = []
  for (const entry of levels) {
    const value = typeof entry === 'string' ? entry : entry?.value
    if (!value || seen.has(value)) continue
    seen.add(value)
    resolved.push(known.get(value) || { value, label: entry?.label || titleCase(value) })
  }
  return resolved.length ? resolved : defaults
}

export function preferredEffort(efforts, current, model) {
  const values = efforts.map(effort => effort.value)
  if (values.includes(current)) return current
  if (values.includes(model?.default_effort)) return model.default_effort
  if (values.includes('medium')) return 'medium'
  return values[0] || ''
}

/** Connected providers' visible models, in the composer's provider order.
 *  A disconnected or hidden selection stays listed so it never vanishes. */
export function visibleRunModels(registry, status, choice) {
  const providers = Object.keys(registry?.providers || {})
  const ordered = [...PROVIDER_ORDER.filter(id => providers.includes(id)), ...providers.filter(id => !PROVIDER_ORDER.includes(id)).sort()]
  const hidden = new Set(registry?.hidden_ids || [])
  return ordered.flatMap(provider => {
    const configured = status?.[provider]?.configured === true && status?.[provider]?.available !== false
    return (registry.providers[provider] || []).filter(model => {
      const selected = choice?.provider === provider && choice?.model === model.id
      return selected || (configured && model.available !== false && !hidden.has(model.id))
    }).map(model => ({ provider, model, configured }))
  })
}

function ClaudeMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" /></svg>
}
function OpenAIMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>
}
// The shell's own monochrome badge; light mode inverts its off-white ink.
const MobiusMark = () => <img className="co-model-mark-mobius" src="/icons/notification-badge.svg" alt="" width="23" height="23" />

export function ProviderMark({ provider }) {
  if (provider === 'claude') return <ClaudeMark />
  if (provider === 'codex') return <OpenAIMark />
  if (provider === 'mobius') return <MobiusMark />
  if (!provider) return <Icon name="feedback" size={18} />
  return <span aria-hidden="true">{titleCase(provider).charAt(0)}</span>
}

/** Same interaction model as the shell EffortStepper: one radiogroup track,
 *  roving tabindex and arrow keys, the chosen level named to the right. */
export function EffortTrack({ efforts, value, onChange, disabled, label }) {
  if (!efforts?.length) return null
  const selectedIndex = Math.max(0, efforts.findIndex(effort => effort.value === value))
  return <div className={'co-effort' + (disabled ? ' is-disabled' : '')}>
    <div className="co-effort-track" role="radiogroup" aria-label={label}>
      {efforts.map((effort, index) => <button key={effort.value} type="button" role="radio" aria-checked={index === selectedIndex} aria-label={effort.label}
        disabled={disabled} tabIndex={index === selectedIndex ? 0 : -1}
        className={'co-effort-stop' + (index === selectedIndex ? ' is-on' : '') + (index < selectedIndex ? ' is-filled' : '')}
        onClick={() => onChange(effort.value)}
        onKeyDown={event => {
          const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: efforts.length - 1 }[event.key]
          if (next === undefined) return
          event.preventDefault()
          const bounded = Math.max(0, Math.min(efforts.length - 1, next))
          onChange(efforts[bounded].value)
          event.currentTarget.parentElement?.children[bounded]?.focus()
        }} />)}
    </div>
    <span className="co-effort-label">{efforts[selectedIndex].label}</span>
  </div>
}

function ModelRow({ provider, title, subtitle, selected, disabled, onClick }) {
  return <button type="button" className={'co-model-row' + (selected ? ' is-selected' : '')} aria-pressed={selected} disabled={disabled} onClick={onClick}>
    <span className="co-model-mark"><ProviderMark provider={provider} /></span>
    <span className="co-model-main"><span className="co-model-title">{title}</span><span className="co-model-sub">{subtitle}</span></span>
    <span className="co-model-dot" aria-hidden="true" />
  </button>
}

async function readJson(token, path) {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`${path} ${response.status}`)
  return response.json()
}

/** `choice` is `{provider, model, effort}`; an empty choice means the launch
 *  default, which the server resolves when the work starts. `defaultChoice`
 *  names that resolved model when the caller knows it, and `defaultHint` says
 *  which owner setting it comes from. Effort memory is per provider and local
 *  to this launch. */
export function AgentModelSettings({ token, choice, onChange, defaultChoice = null, defaultHint = 'Your default model' }) {
  const [registry, setRegistry] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [effortByProvider, setEffortByProvider] = useState({})

  useEffect(() => {
    let cancelled = false
    setError('')
    Promise.all([readJson(token, '/api/models'), readJson(token, '/api/owner/model-prefs'), readJson(token, '/api/auth/providers/status')])
      .then(([models, prefs, nextStatus]) => {
        if (cancelled) return
        setRegistry({ providers: models?.providers || {}, hidden_ids: prefs?.hidden_ids || [] })
        setStatus(nextStatus)
      })
      .catch(() => { if (!cancelled) setError('Couldn’t load models. The default will be used.') })
    return () => { cancelled = true }
  }, [token, attempt])

  const rows = useMemo(() => registry ? visibleRunModels(registry, status, choice) : [], [registry, status, choice])
  const list = useRef(null)
  // Choosing a model reveals its effort track, as the composer does; keep it
  // in view when the chosen row sits at the bottom of the scrolling list.
  useEffect(() => {
    if (open) list.current?.querySelector('.co-effort-indent')?.scrollIntoView({ block: 'nearest' })
  }, [open, choice?.provider, choice?.model])
  const modelFor = (provider, id) => (registry?.providers?.[provider] || []).find(model => model.id === id)
  const selected = choice?.model ? modelFor(choice.provider, choice.model) : null
  const selectedEfforts = choice?.model ? modelEfforts(choice.provider, selected) : []
  const selectedEffort = choice?.model ? preferredEffort(selectedEfforts, choice.effort, selected) : ''
  const defaultModel = defaultChoice?.model ? modelFor(defaultChoice.provider, defaultChoice.model) : null
  const defaultName = defaultModel?.label || defaultChoice?.model
  const defaultEffort = defaultChoice?.effort ? modelEfforts(defaultChoice.provider, defaultModel).find(effort => effort.value === defaultChoice.effort)?.label : ''
  const defaultTitle = defaultName ? `Default (${defaultName})` : 'Default model'
  // The default model with its own effort chosen is still the Default row: the
  // run names the model explicitly, but the list does not jump to another row.
  const matchesDefault = !!(choice?.model && defaultChoice?.model && choice.provider === defaultChoice.provider && choice.model === defaultChoice.model)
  const defaultSelected = !choice?.model || matchesDefault
  const defaultEfforts = defaultChoice?.model ? modelEfforts(defaultChoice.provider, defaultModel) : []
  const defaultEffortValue = defaultEfforts.length ? preferredEffort(defaultEfforts, matchesDefault ? choice.effort : defaultChoice.effort, defaultModel) : ''
  const defaultEffortLabel = defaultEfforts.find(effort => effort.value === defaultEffortValue)?.label || defaultEffort
  const summary = matchesDefault
    ? { provider: choice.provider, title: defaultTitle, detail: defaultEfforts.find(effort => effort.value === defaultEffortValue)?.label }
    : choice?.model
      ? { provider: choice.provider, title: selected?.label || choice.model, detail: selectedEfforts.find(effort => effort.value === selectedEffort)?.label }
      : { provider: defaultChoice?.provider || '', title: defaultTitle, detail: defaultEffort || defaultHint }

  function chooseModel(provider, model) {
    if (!model) return onChange?.({ provider: '', model: '', effort: '' })
    const efforts = modelEfforts(provider, model)
    const effort = preferredEffort(efforts, effortByProvider[provider] ?? (choice?.provider === provider ? choice.effort : ''), model)
    setEffortByProvider(old => ({ ...old, [provider]: effort }))
    onChange?.({ provider, model: model.id, effort })
  }
  function chooseDefaultEffort(effort) {
    setEffortByProvider(old => ({ ...old, [defaultChoice.provider]: effort }))
    onChange?.({ provider: defaultChoice.provider, model: defaultChoice.model, effort })
  }
  function chooseEffort(effort) {
    setEffortByProvider(old => ({ ...old, [choice.provider]: effort }))
    onChange?.({ ...choice, effort })
  }

  return <section className="co-agent-picker" aria-label="Agent">
    <button type="button" className="co-agent-trigger" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="co-agent-trigger-label">Agent</span>
      <span className="co-model-mark"><ProviderMark provider={summary.provider} /></span>
      <span className="co-agent-trigger-value"><strong>{summary.title}</strong>{summary.detail ? <small>{summary.detail}</small> : null}</span>
      <Icon name="chevron" size={16} className="co-icon co-agent-trigger-chevron" />
    </button>
    {open ? <div className="co-model-list" ref={list}>
      <ModelRow provider={defaultChoice?.provider || ''} title={defaultTitle} subtitle={defaultEffortLabel ? `${defaultEffortLabel} · ${defaultHint}` : defaultHint} selected={defaultSelected} onClick={() => chooseModel('', null)} />
      {defaultSelected && defaultEfforts.length ? <div className="co-effort-indent"><EffortTrack efforts={defaultEfforts} value={defaultEffortValue} onChange={chooseDefaultEffort} label="Reasoning effort for the default model" /></div> : null}
      {rows.map(({ provider, model, configured }) => {
        const isSelected = choice?.provider === provider && choice?.model === model.id && !matchesDefault
        return <div key={`${provider}:${model.id}`}>
          <ModelRow provider={provider} title={model.label || model.id} subtitle={configured ? providerLabel(provider, status) : `${providerLabel(provider, status)} · Not connected`}
            selected={isSelected} disabled={!configured} onClick={() => chooseModel(provider, model)} />
          {isSelected && selectedEfforts.length ? <div className="co-effort-indent"><EffortTrack efforts={selectedEfforts} value={selectedEffort} onChange={chooseEffort} disabled={!configured} label={`Reasoning effort for ${model.label || model.id}`} /></div> : null}
        </div>
      })}
      {!registry && !error ? <p className="co-model-note" role="status">Loading models…</p> : null}
      {error ? <p className="co-model-note" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></p> : null}
    </div> : null}
  </section>
}
