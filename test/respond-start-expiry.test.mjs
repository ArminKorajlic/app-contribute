import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { respondStartsExpireIn } from '../review-list.js'
import { SYNC_POLICY } from '../refresh.js'
import { frontendModules } from './render-harness.mjs'

const GRACE = SYNC_POLICY.respondStartGraceMs
const chat = (at, number = 7) => ({ repo: 'mobius-os/mobius', number, chat_id: `c${number}`, state: 'running', at })

test('the deadline of started Respond conversations is the earliest one, never negative', () => {
  assert.equal(respondStartsExpireIn([], 5000, GRACE), null)
  assert.equal(respondStartsExpireIn(undefined, 5000, GRACE), null)
  assert.equal(respondStartsExpireIn([chat(1000), chat(4000, 8)], 5000, GRACE), 1000 + GRACE - 5000)
  assert.equal(respondStartsExpireIn([chat(1000)], 1000 + GRACE + 5, GRACE), 0, 'already past: due at once')
})

// A stand-in for React with just the hooks useDeskReviewRuns uses, so the real hook
// runs against a mocked clock and its own timers are the ones under test.
const STUB_REACT = `
let slots = [], at = 0, effects = [], render = () => {}
export const createContext = () => ({})
export const useContext = () => null
const next = init => (slots[at] ??= { value: init(), deps: undefined })
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
export const useRef = initial => { const s = next(() => ({ current: initial })); at++; return s.value }
export function useState(initial) {
  const s = next(() => ({ v: initial })); const i = at++
  return [s.value.v, update => {
    const v = typeof update === 'function' ? update(slots[i].value.v) : update
    if (!Object.is(v, slots[i].value.v)) { slots[i].value = { v }; render() }
  }]
}
export function useMemo(make, deps) {
  const s = next(() => null); at++
  if (!same(s.deps, deps)) { s.value = { v: make() }; s.deps = deps }
  return s.value.v
}
export const useCallback = (fn, deps) => useMemo(() => fn, deps)
export function useEffect(run, deps) {
  const s = next(() => ({})); at++
  if (same(s.deps, deps)) return
  s.deps = deps; s.run = run; effects.push(s)
}
export function mount(hook) {
  let out
  render = () => {
    at = 0; effects = []
    out = hook()
    for (const s of effects) { s.cleanup?.(); s.cleanup = s.run() }
  }
  render()
  return () => out
}
`

async function loadHook() {
  const requireFromFrontend = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(requireFromFrontend.resolve('rolldown')).href)
  const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
  const build = await rolldown({
    input: '\0entry',
    platform: 'node',
    tsconfig: false,
    plugins: [{
      name: 'stub-react',
      resolveId(id) {
        if (id === '\0entry' || id === 'react') return id
        return id === './ui/useReviewList.js' ? join(root, 'ui/useReviewList.js') : null
      },
      load(id) {
        if (id === 'react') return { code: STUB_REACT, moduleType: 'js' }
        return id === '\0entry' ? { code: "export { useDeskReviewRuns } from './ui/useReviewList.js'\nexport { mount } from 'react'", moduleType: 'js' } : null
      },
    }],
  })
  const { output } = await build.generate({ format: 'cjs' })
  await build.close()
  const bundled = { exports: {} }
  new Function('module', 'exports', 'require', output[0].code)(bundled, bundled.exports, createRequire(import.meta.url))
  return bundled.exports
}

// One Contribute desk whose run-list reads succeed or fail on demand.
async function openDesk(t) {
  const { useDeskReviewRuns, mount } = await loadHook()
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  let reading = 'ok'
  let listed = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => {
    if (reading === 'fail') throw new Error('offline')
    return { ok: true, status: 200, json: async () => ({ runs: [], respond_chats: listed }) }
  }
  t.after(() => { mock.timers.reset(); globalThis.fetch = realFetch })
  let spec
  const hub = {
    fact: (name, given) => { spec = given; return () => {} },
    refresh: async () => { try { spec.apply(await spec.read()) } catch (error) { spec.failed(error) } },
    supersede() {},
  }
  const desk = mount(() => useDeskReviewRuns({ hub, token: 't', appId: '10', connState: 'connected', sendOnly: false, pullPageOpen: false }))
  await desk().refresh()
  return {
    desk,
    setReading: value => { reading = value },
    setListed: value => { listed = value },
    // Time passes: timers fire, then pending reads settle.
    pass: async ms => { mock.timers.tick(ms); await Promise.resolve() },
  }
}

const start = desk => desk().respondStarted({ repo: 'mobius-os/mobius', number: 7, chat_id: 'c7' })

test('a started Respond conversation stops looking busy at its deadline when every read fails', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const room = await openDesk(t)
  start(room.desk)
  await room.pass(0)
  room.setReading('fail')
  for (let i = 0; i < 3; i += 1) { await room.desk().refresh(); await room.pass(15_000) }
  assert.equal(room.desk().respondChats.length, 1, 'inside the grace it still stands in for the conversation')
  await room.pass(GRACE)
  assert.equal(room.desk().respondChats.length, 0, 'at its deadline it is gone, with reads still failing')
})

test('a started Respond conversation also ends at its deadline when no read has run since', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const room = await openDesk(t)
  start(room.desk)
  await room.pass(GRACE - 1)
  assert.equal(room.desk().respondChats.length, 1)
  await room.pass(1)
  assert.equal(room.desk().respondChats.length, 0)
})

test('a started Respond conversation still gives way early when a read lists it', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const room = await openDesk(t)
  start(room.desk)
  room.setListed([{ repo: 'mobius-os/mobius', number: 7, chat_id: 'c7', state: 'running' }])
  await room.desk().refresh()
  assert.deepEqual(room.desk().respondChats.map(item => item.chat_id), ['c7'], 'the platform answer replaces the start, never doubles it')
})
