import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { freezeStartAction } from '../storage.js'
import { deliverCycleMessage } from '../cycle-delivery.js'

// The hook's effects observe only a fixture runtime/storage. No DOM, real
// conversation, saved partner record, or application transport is involved.
const source = readFileSync(new URL('../ui/useProjectCycle.js', import.meta.url), 'utf8')
function fixture({ saved = null, runtime = {}, statusError = false, stopResult = { stopped: true }, begin = async () => ({ ok: false, error: 'Fixture start refused' }), current, update = async () => true, list = async () => [], deliver = () => assert.fail('Observation must not start an agent') } = {}) {
  const slots = [], effects = [], calls = []
  let cursor = 0, planned = null
  const context = vm.createContext({
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], update => { slots[index] = typeof update === 'function' ? update(slots[index]) : update }]
    },
    useRef(initial) {
      const index = cursor++
      return slots[index] ||= { current: initial }
    },
    useCallback: callback => callback,
    useEffect: effect => { effects.push(effect) },
    loadCycleState: async key => { calls.push(['load', key]); return typeof saved === 'function' ? saved() : saved },
    beginProjectCycle: async (...args) => { calls.push(['begin', args[0]]); const result = await begin(...args); if (result?.ok) planned = result; return result },
    // By default the online record's current cycle is the one this fixture began.
    loadCurrentCycle: async key => { calls.push(['current', key]); if (current) return current(key); return planned ? { k: planned.k, cycle: { k: planned.k, cid: planned.cid, action: planned.action } } : { k: 0, cycle: null } },
    updateCurrentCycle: (...args) => { calls.push(['update', ...args]); return update(...args) },
    freezeStartAction,
    openAgentConversation: id => { calls.push(['open', id]); return { ok: true } },
    document: { hidden: false },
    window: { mobius: { chat: { status: async id => {
      calls.push(['status', id])
      if (typeof statusError === 'function' ? statusError(id) : statusError) throw Error('Fixture unavailable')
      return typeof runtime === 'function' ? runtime(id) : runtime
    }, list: async options => { calls.push(['list', options?.scope]); return list(options) }, stop: async id => { calls.push(['stop', id]); return stopResult } } }, addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {},
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export (function|const) /g, '$1 '), context)
  return {
    calls,
    phase: context.projectCyclePhase,
    render(projectKey = 'fixture-project') { cursor = 0; return context.useProjectCycle(projectKey, request => { calls.push(['deliver', request.cid]); return deliver(request) }) },
    setCycle(next) { slots[0] = next },
    get sending() { return slots[3]?.current },
    async restore() { effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)) },
  }
}

test('project runtime does not conflate unknown, non-running, paused, stopped, failed, and completed', () => {
  const { phase } = fixture()
  for (const runtime of [null, {}, { error: 'unavailable' }, { goal: { status: 'active' } }]) assert.equal(phase(runtime), 'unknown')
  assert.equal(phase({ running: false }), 'inactive')
  assert.equal(phase({ running: true, goal: { status: 'paused' } }), 'running')
  assert.equal(phase({ running: false, pending_question_id: 'fixture-question' }), 'waiting')
  for (const [status, expected] of [['paused', 'paused'], ['failed', 'failed'], ['stopped', 'stopped'], ['cancelled', 'stopped'], ['completed', 'complete']]) {
    assert.equal(phase({ running: false, goal: { status } }), expected)
  }
})

test('restoring a named paused cycle observes status without resuming, stopping, saving, or starting', async () => {
  const f = fixture({ saved: { chat_id: 'fixture-chat', title: 'Prepare the selected work', event: 'private', started_at: '2026-09-10T12:00:00Z' },
    runtime: { running: false, goal: { status: 'paused' }, title: 'Fixture preparation conversation' } })
  f.render()
  await f.restore()
  const observed = f.render()
  assert.equal(observed.cycle.phase, 'paused')
  assert.equal(observed.cycle.title, 'Prepare the selected work')
  assert.equal(observed.cycle.chatTitle, 'Fixture preparation conversation')
  assert.equal(observed.cycle.startedAt, '2026-09-10T12:00:00Z')
  assert.equal(typeof observed.stop, 'function')
  assert.deepEqual(f.calls, [['load', 'fixture-project'], ['status', 'fixture-chat']])
  observed.open()
  assert.deepEqual(f.calls.at(-1), ['open', 'fixture-chat'])
})

test('status failure retains named saved work as unknown, never paused or successful', async () => {
  const f = fixture({ saved: { chat_id: 'fixture-chat', title: 'Pull accepted work', event: 'update_source_projects', started_at: '2026-09-10T12:00:00Z' }, statusError: true })
  f.render()
  await f.restore()
  const { cycle } = f.render()
  assert.equal(cycle.phase, 'unknown')
  assert.equal(cycle.title, 'Pull accepted work')
  assert.equal(cycle.chatId, 'fixture-chat')
  assert.equal(cycle.startedAt, '2026-09-10T12:00:00Z')
  assert.match(cycle.error, /Progress is unavailable/)
  assert.equal(cycle.runtime, null)
  assert.deepEqual(f.calls, [['load', 'fixture-project'], ['status', 'fixture-chat']])
})

test('an unconfirmed Stop leaves the saved cycle unknown and does not restart it', async () => {
  const f = fixture({ saved: { chat_id: 'fixture-chat', title: 'Old work' }, runtime: { running: true }, stopResult: { stopped: false } })
  f.render(); await f.restore()
  await f.render().stop()
  const observed = f.render()
  assert.equal(observed.cycle.phase, 'unknown')
  assert.equal(observed.cycle.chatId, 'fixture-chat')
  assert.match(observed.cycle.error, /Could not confirm Stop/)
  assert.deepEqual(f.calls.at(-1), ['stop', 'fixture-chat'])
})

test('a thrown project-cycle start restores the prior phase and releases the local start latch', async () => {
  const f = fixture({ begin: async () => { throw Error('Storage unavailable') } })
  f.render()
  f.setCycle({ phase: 'idle', chatId: '', history: [], error: '' })
  const first = await f.render().start({ title: 'Fresh work', draft: 'Fresh draft' })
  assert.equal(first.ok, false)
  assert.equal(f.render().cycle.phase, 'idle')
  assert.equal(f.sending, false)
  await f.render().start({ title: 'Fresh work', draft: 'Fresh draft' })
  assert.equal(f.calls.filter(([kind]) => kind === 'begin').length, 2)
})

test('late Stop response cannot replace a different project or chat state', async () => {
  let resolveStop
  const stopResult = new Promise(resolve => { resolveStop = resolve })
  const f = fixture({ saved: { chat_id: 'old-chat', title: 'Old project' }, runtime: { running: true }, stopResult })
  f.render('old-project'); await f.restore()
  const pending = f.render('old-project').stop()
  f.setCycle({ phase: 'running', chatId: 'new-chat', title: 'New project', error: '' })
  f.render('new-project')
  resolveStop({ stopped: false })
  await pending
  assert.equal(f.render('new-project').cycle.chatId, 'new-chat')
  assert.equal(f.render('new-project').cycle.phase, 'running')
  assert.equal(f.calls.filter(([kind, id]) => kind === 'status' && id === 'new-chat').length, 0)
})

test('late post-Stop status cannot overwrite a newer chat in the same project', async () => {
  let resolveStatus
  const f = fixture({ saved: { chat_id: 'old-chat' }, runtime: id => id === 'old-chat' ? new Promise(resolve => { resolveStatus = resolve }) : { running: true } })
  f.render(); f.setCycle({ phase: 'running', chatId: 'old-chat', error: '' })
  const pending = f.render().stop()
  await new Promise(resolve => setImmediate(resolve))
  f.setCycle({ phase: 'running', chatId: 'new-chat', error: '' })
  resolveStatus({ running: false, goal: { status: 'stopped' } })
  await pending
  assert.equal(f.render().cycle.chatId, 'new-chat')
  assert.equal(f.render().cycle.phase, 'running')
})

test('working motion is opt-in and reduced-motion collapses it', () => {
  const theme = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  const controls = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
  assert.match(theme, /@media\(prefers-reduced-motion:reduce\) \{ \.co-working-icon \{ animation:none; \}/)
  assert.match(controls, /className=\{moving \? 'co-working-icon' : ''\}/)
  assert.match(controls, /workflow\.stop/); assert.match(controls, /Cancel active work/); assert.match(controls, /'paused' \? 'Cancel paused work'/); assert.match(controls, /Follow through to merge/)
  assert.match(controls, /DateLabel value=\{cycle.startedAt\} prefix="Started "/)
  assert.match(controls, /disabled=\{!canStart/)
  assert.match(controls, /Start fresh full merge cycle/)
  assert.match(controls, /TaskPane id="task:cycle"/)
  assert.match(controls, /start\(fullCycleAction, cycleAgent\)/)
  assert.match(controls, /mayMerge\(project\.viewerPermission\) && cycleAction \? \{ \.\.\.cycleAction, merge: true \}/)
  assert.match(controls, /workflow\.sendAgain\(\)/)
  assert.match(controls, /start\(run\.privateAction, prepareAgent\)/)
  // Updates belong to Settings and the App Store; Contribute starts no pull of its own.
  assert.doesNotMatch(controls, /projectUpdateAction|task:update|pullAgent/)
  assert.match(controls, /Nothing goes to GitHub until you press Send/)
})

test('pending continuations keep a cycle active; a terminal latest run (recovery_run_id) does not', () => {
  const { phase } = fixture()
  for (const runtime of [
    { running: false, goal: { status: 'open' }, waits: [{ status: 'armed' }] },
    { running: false, goal: { status: 'completed' }, waits: [{ status: 'fired' }] },
    { running: false, pending_messages: [{ content: 'queued' }] },
    { running: false, continuation_wait: { id: 'w' } },
    { running: false, background_helpers: { count: 1, items: [{}] } },
    { running: false, run_status: 'parked', recovery_run_id: 'run-1' },
    { running: false, run_status: 'resume_pending', recovery_run_id: 'run-1' },
  ]) assert.equal(phase(runtime), 'scheduled', JSON.stringify(runtime))
  assert.equal(phase({ running: false, pending_question_id: 'q', waits: [{}] }), 'waiting', 'an owner question is still a question')
  // G1 returns the latest run id for every idle chat; with a terminal run it is not pending work.
  const idle = { running: false, waits: [], pending_messages: [], background_helpers: { count: 0, items: [] }, continuation_wait: null, recovery_run_id: 'run-latest' }
  assert.equal(phase({ ...idle, run_status: 'completed', goal: { status: 'completed' } }), 'complete')
  assert.equal(phase({ ...idle, run_status: 'stopped', goal: { status: 'stopped' } }), 'stopped')
  assert.equal(phase({ ...idle, run_status: 'failed', goal: { status: 'failed' } }), 'failed')
  assert.equal(phase({ ...idle, run_status: 'completed' }), 'inactive')
})

test('a finished cycle with a completed recovery_run_id is idle and the next cycle may start', async () => {
  let runtime = { running: false, goal: { status: 'open' }, waits: [{ status: 'armed' }], recovery_run_id: 'run-1', run_status: 'completed' }
  const begun = []
  const f = fixture({ saved: { chat_id: 'project-chat', title: 'Work' }, runtime: () => runtime,
    begin: async (...args) => { begun.push(args); return { ok: false, error: 'Fixture start refused' } } })
  f.render(); await f.restore()
  assert.equal(f.render().cycle.phase, 'scheduled')
  assert.equal((await f.render().start(ACTION)).ok, false)
  assert.equal(begun.length, 0, 'no new cycle while the Wait is armed')
  runtime = { running: false, goal: { status: 'completed' }, waits: [], recovery_run_id: 'run-2', run_status: 'completed' }
  await f.render().recheck()
  assert.equal(f.render().cycle.phase, 'complete')
  await f.render().start(ACTION)
  assert.equal(begun.length, 1, 'a completed cycle never strands the project')
})

const ACTION = { title: 'Prepare', draft: 'Only record A', event: 'private', agent: { provider: 'codex', model: 'chosen-model', effort: 'high' } }

test('the frozen start keeps exact work and model fields only', () => {
  assert.equal(freezeStartAction({ title: 'x' }), null)
  assert.deepEqual(freezeStartAction({ ...ACTION, scope: 'ignored', cid: 'ignored', extra: 1, merge: true }),
    { title: 'Prepare', draft: 'Only record A', event: 'private', merge: true, agent: ACTION.agent })
})

// G1/main's platform contract for app-owned conversations, as a stand-in:
// - POST /api/app-chats/start, serialized per scope: reuse a started active
//   conversation without sending; else create (or retry an empty row in
//   place) and send `cid` as its first turn. Deleted rows are ignored.
// - POST /api/chats/{id}/messages: an already held cid is a duplicate.
// - PATCH /api/app-chats/{id}: a provider switch after the first turn is 409.
// `lose` makes the next N responses vanish after the server effect.
function platformStandIn() {
  const chats = []
  let lock = Promise.resolve()
  const serial = fn => { const run = lock.then(fn); lock = run.catch(() => {}); return run }
  const platform = { chats, lose: 0, hold: null, requests: [],
    active: () => chats.filter(chat => !chat.deleted),
    messages: () => chats.flatMap(chat => chat.messages) }
  const reply = (status, body) => {
    if (platform.lose > 0) { platform.lose--; throw new TypeError('Failed to fetch') }
    return { ok: status < 400, status, json: async () => body }
  }
  platform.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {}
    platform.requests.push([init.method, url, body.cid || ''])
    if (url === '/api/app-chats/start') {
      const result = await serial(async () => {
        let chat = chats.find(row => row.scope === body.scope && !row.deleted)
        if (chat?.messages.length) return [200, { chat_id: chat.id, outcome: 'reused' }]
        if (!chat) chats.push(chat = { id: 'chat-' + (chats.length + 1), scope: body.scope, provider: body.provider || 'claude', model: body.model, messages: [], deleted: false })
        if (platform.hold) await platform.hold
        if (platform.rejectFirstTurn > 0) { platform.rejectFirstTurn--; return [502, { detail: { code: 'first_turn_rejected', chat_id: chat.id } }] }
        chat.messages.push(body.cid)
        return [200, { chat_id: chat.id, outcome: 'started' }]
      })
      return reply(...result)
    }
    const patch = url.match(/^\/api\/app-chats\/([^/]+)$/)
    if (patch && init.method === 'PATCH') {
      const chat = chats.find(row => row.id === decodeURIComponent(patch[1]) && !row.deleted)
      if (!chat) return reply(404, {})
      if (body.provider && body.provider !== chat.provider && chat.messages.length) return reply(409, {})
      Object.assign(chat, body)
      return reply(200, {})
    }
    const send = url.match(/^\/api\/chats\/([^/]+)\/messages$/)
    if (send && platform.failSend > 0) { platform.failSend--; return reply(503, {}) }
    if (send) {
      const result = await serial(async () => {
        const chat = chats.find(row => row.id === decodeURIComponent(send[1]) && !row.deleted)
        if (!chat) return [404, {}]
        if (chat.messages.includes(body.cid)) return [200, { status: 'duplicate' }]
        chat.messages.push(body.cid)
        return [202, { status: 'queued' }]
      })
      return reply(...result)
    }
    throw new Error('Unexpected request ' + url)
  }
  return platform
}

// Real storage helpers over an online CAS fixture, the real delivery module,
// and the platform stand-in above.
async function realCycles(t) {
  const storage = await import('../storage.js')
  const stored = new Map(), versions = new Map()
  const previousWindow = globalThis.window
  globalThis.window = { mobius: { storage: {
    get: async key => structuredClone(stored.get(key) ?? null),
    getWithVersion: async key => ({ value: structuredClone(stored.get(key) ?? null), version: versions.get(key) || null }),
    durableWrite: async (key, value, options = {}) => {
      if ((options.ifNoneMatch && versions.has(key)) || (options.ifMatch && options.ifMatch !== versions.get(key))) throw Object.assign(Error('CAS'), { status: 412 })
      stored.set(key, structuredClone(value)); versions.set(key, String((Number(versions.get(key)) || 0) + 1)); return { durability: 'synced', version: versions.get(key) }
    },
  } } }
  t.after(() => { globalThis.window = previousWindow })
  const platform = platformStandIn()
  const until = async predicate => { for (let i = 0; i < 400 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5)) }
  const runtime = id => {
    const chat = platform.chats.find(row => row.id === id && !row.deleted)
    if (!chat) throw Error('Conversation not found')
    return { running: false, goal: { status: 'completed' }, waits: [], recovery_run_id: 'run-' + chat.messages.length, run_status: 'completed' }
  }
  const pane = () => {
    const f = fixture({ saved: () => storage.loadCycleState('fixture-project'), runtime, statusError: id => !platform.chats.some(row => row.id === id && !row.deleted),
      begin: (...args) => storage.beginProjectCycle(...args), current: (...args) => storage.loadCurrentCycle(...args), update: (...args) => storage.updateCurrentCycle(...args),
      list: async ({ scope }) => platform.active().filter(chat => chat.scope === scope).map(chat => ({ id: chat.id })),
      deliver: request => deliverCycleMessage('app-token', request, platform.fetch) })
    return f
  }
  const ready = async p => { p.render(); await p.restore(); await until(() => !['restoring', 'checking'].includes(p.render().cycle.phase)) }
  return { storage, platform, until, pane, ready }
}

test('a lost first response is retried into one conversation with one message', async t => {
  const { storage, platform, pane, ready } = await realCycles(t)
  const p = pane(); await ready(p)
  platform.lose = 1
  const first = await p.render().start(ACTION)
  assert.equal(first.ok, false)
  assert.ok(p.render().cycle.unsent, 'the cycle is offered for sending again')
  assert.equal(platform.active().length, 1, 'the platform did create the conversation')
  // Reload: Send again uses the saved cycle, not today's choices.
  const reloaded = pane(); await ready(reloaded)
  assert.equal(reloaded.render().cycle.unsent?.action.draft, ACTION.draft)
  const again = await reloaded.render().sendAgain()
  assert.equal(again.ok, true)
  assert.equal(platform.active().length, 1)
  assert.deepEqual(platform.messages(), [(await storage.projectCycleScope('fixture-project')) + ':1'])
  assert.equal(reloaded.render().cycle.chatId, 'chat-1')
  assert.equal(Boolean(reloaded.render().cycle.unsent), false)
  assert.equal((await storage.loadCycleState('fixture-project')).cycle.delivered, true)
})

test('two panes starting the same cycle concurrently produce one conversation and one message', async t => {
  const { platform, pane, ready } = await realCycles(t)
  const a = pane(), b = pane()
  await ready(a); await ready(b)
  const results = await Promise.all([a.render().start(ACTION), b.render().start(ACTION)])
  assert.equal(results.filter(result => result.ok).length, 1, 'the saved record admits one start')
  assert.equal(platform.active().length, 1)
  assert.equal(platform.messages().length, 1)
  // Without the record's help, the same cycle sent from both panes is still one message.
  const planned = { k: 1, cid: platform.messages()[0], scope: platform.chats[0].scope, action: freezeStartAction(ACTION) }
  a.setCycle({ ...a.render().cycle, unsent: planned }); b.setCycle({ ...b.render().cycle, unsent: planned })
  await Promise.all([a.render().sendAgain(), b.render().sendAgain()])
  assert.equal(platform.active().length, 1)
  assert.equal(platform.messages().length, 1, 'a repeated cycle id is never delivered twice')
})

test('a stale pane re-sending cycle k after k+1 started adds no message', async t => {
  const { storage, platform, until, pane, ready } = await realCycles(t)
  const a = pane(); await ready(a)
  platform.lose = 1
  await a.render().start(ACTION)
  assert.ok(a.render().cycle.unsent, 'pane A believes cycle 1 is unsent')
  const b = pane(); await ready(b)
  assert.equal((await b.render().sendAgain()).ok, true)
  await until(() => b.render().cycle.phase === 'running')
  b.setCycle({ ...b.render().cycle, phase: 'complete' })
  assert.equal((await b.render().start({ ...ACTION, title: 'Next', draft: 'Next work' })).ok, true)
  const scope = await storage.projectCycleScope('fixture-project')
  assert.deepEqual(platform.messages(), [scope + ':1', scope + ':2'])
  // The stale pane's Send again consults the record first: no request at all.
  const before = platform.requests.length
  const stale = await a.render().sendAgain()
  assert.equal(stale.superseded, true)
  assert.equal(platform.requests.length, before, 'no PATCH, start or send')
  assert.deepEqual(platform.messages(), [scope + ':1', scope + ':2'])
  assert.equal(platform.active().length, 1)
  assert.equal((await storage.loadCycleState('fixture-project')).k, 2, 'the stale delivery does not rewind the record')
})

test('later cycles are messages in the same conversation, and its provider stays fixed', async t => {
  const { storage, platform, pane, ready } = await realCycles(t)
  const p = pane(); await ready(p)
  await p.render().start(ACTION)
  p.setCycle({ ...p.render().cycle, phase: 'complete' })
  await p.render().start({ ...ACTION, title: 'Second', agent: { provider: 'codex', model: 'other-codex-model' } })
  assert.equal(platform.active().length, 1)
  assert.equal(platform.chats[0].model, 'other-codex-model', 'a model in the same provider is applied')
  assert.equal(platform.messages().length, 2)
  p.setCycle({ ...p.render().cycle, phase: 'complete' })
  const switched = await p.render().start({ ...ACTION, title: 'Third', agent: { provider: 'claude', model: 'claude-model' } })
  assert.equal(switched.ok, false)
  assert.match(p.render().cycle.error, /already uses another provider/)
  assert.equal(platform.messages().length, 2, 'nothing is sent with an unapplied model')
  const saved = await storage.loadCycleState('fixture-project')
  assert.equal(saved.k, 3)
  assert.equal(saved.history.length, 2, 'previous cycles are listed')
})

test('a deleted conversation is recreated by the next start, still one active conversation', async t => {
  const { platform, until, pane, ready } = await realCycles(t)
  const p = pane(); await ready(p)
  await p.render().start(ACTION)
  platform.chats[0].deleted = true
  await p.render().recheck()
  await until(() => p.render().cycle.phase === 'unknown')
  const next = await p.render().start({ ...ACTION, title: 'After deletion' })
  assert.equal(next.ok, true)
  assert.equal(platform.active().length, 1)
  assert.equal(platform.active()[0].id, 'chat-2')
  assert.equal(p.render().cycle.chatId, 'chat-2')
})

test('a start is bounded to the platform limits before it is saved or sent', async () => {
  const longTitle = `Prepare ${'A'.repeat(110)} tracker`
  const action = { ...ACTION, agent: undefined, title: longTitle, scopeLabel: longTitle }
  assert.ok(String(action.scopeLabel).length > 120, 'fixture: a valid long app name exceeds the platform label limit')
  let saved = null
  const sent = []
  const f = fixture({ begin: async (key, payload) => { saved = payload; return { ok: true, k: 1, cid: 'scope:1', scope: 'scope', action: payload } },
    deliver: async request => { sent.push(request); return { ok: true, chatId: 'long-chat' } } })
  f.render(); await f.restore()
  assert.equal((await f.render().start({ ...action, scopeLabel: action.scopeLabel + '\nwith a newline' })).ok, true)
  for (const payload of [saved, sent[0]]) {
    assert.ok(payload.scopeLabel.length <= 120 && !/[\u0000-\u001f]/.test(payload.scopeLabel), 'scope label within the platform limit')
    assert.ok(payload.title.length <= 200)
  }
  assert.equal(sent[0].draft, action.draft, 'the work text itself is never shortened')
  assert.equal(sent[0].cid, 'scope:1')
  const refused = fixture({ begin: async () => assert.fail('An unacceptable start was saved') })
  refused.render(); await refused.restore()
  assert.equal((await refused.render().start({ ...ACTION, agent: { provider: 'codex', model: 'm'.repeat(257) } })).ok, false)
})

test('a retry while the original request is still executing on the server delivers once', async () => {
  const platform = platformStandIn()
  let release
  platform.hold = new Promise(resolve => { release = resolve })
  const request = { ...freezeStartAction(ACTION), scope: 'contribute-cycle:p', cid: 'contribute-cycle:p:1' }
  // The client gave up on the first request; the server is still admitting it.
  const original = deliverCycleMessage('t', request, platform.fetch)
  await new Promise(resolve => setImmediate(resolve))
  const retry = deliverCycleMessage('t', request, platform.fetch)
  platform.hold = null; release()
  const outcomes = await Promise.all([original, retry])
  assert.deepEqual(outcomes.map(outcome => outcome.ok), [true, true])
  assert.equal(platform.active().length, 1)
  assert.deepEqual(platform.messages(), ['contribute-cycle:p:1'])
  assert.equal(outcomes[1].outcome, 'duplicate')
})

test('delivery reports refusals without claiming the cycle was sent', async () => {
  const request = { title: 'T', draft: 'D', scope: 's', cid: 's:1' }
  const response = (status, body) => ({ ok: status < 400, status, json: async () => body })
  assert.equal((await deliverCycleMessage('t', request, async () => response(422, {}))).ok, false)
  assert.equal((await deliverCycleMessage('t', request, async () => { throw new TypeError('offline') })).ok, false)
  const rejected = await deliverCycleMessage('t', request, async url => url.endsWith('/start') ? response(200, { chat_id: 'c', outcome: 'reused' }) : response(200, { status: 'rejected' }))
  assert.equal(rejected.ok, false)
  assert.equal(rejected.chatId, 'c')
  assert.equal((await deliverCycleMessage('t', { ...request, cid: '' }, async () => assert.fail('sent without a cycle id'))).ok, false)
  const seen = []
  await deliverCycleMessage('app-token', request, async (url, init) => { seen.push([url, init.headers.Authorization, JSON.parse(init.body)]); return response(200, { chat_id: 'c', outcome: 'started' }) })
  assert.equal(seen[0][1], 'Bearer app-token')
  assert.equal(seen[0][2].cid, 's:1')
  assert.equal(seen[0][2].scope, 's')
  assert.equal(seen[0][2].owner_visible, true)
})

test('Send again after a confirmed delivery is a no-op', async t => {
  const { platform, until, pane, ready } = await realCycles(t)
  const p = pane(); await ready(p)
  const planned = (await p.render().start(ACTION)) && p.render().cycle
  assert.equal(planned.chatId, 'chat-1')
  const scope = platform.chats[0].scope
  // A pane still showing the cycle as unsent (for example, it missed the confirmation).
  p.setCycle({ ...p.render().cycle, unsent: { k: 1, cid: scope + ':1', scope, action: freezeStartAction(ACTION) } })
  const before = platform.requests.length
  const result = await p.render().sendAgain()
  assert.equal(result.superseded, true)
  assert.equal(platform.requests.length, before, 'nothing is requested for a delivered cycle')
  await until(() => !p.render().cycle.unsent)
  assert.equal(Boolean(p.render().cycle.unsent), false, 'the pane shows the current state')
})

test('a delivered cycle is not replayed into the conversation that replaced its deleted one', async t => {
  const { storage, platform, pane, ready } = await realCycles(t)
  const stale = pane(); await ready(stale)
  await stale.render().start(ACTION)
  const scope = await storage.projectCycleScope('fixture-project')
  // The stale pane keeps an old view of cycle 1 as unsent.
  stale.setCycle({ ...stale.render().cycle, unsent: { k: 1, cid: scope + ':1', scope, action: freezeStartAction(ACTION) } })
  platform.chats[0].deleted = true
  const other = pane(); await ready(other)
  assert.equal((await other.render().start({ ...ACTION, title: 'Cycle two', draft: 'Second work' })).ok, true)
  assert.equal(platform.active()[0].id, 'chat-2')
  const before = platform.requests.length
  await stale.render().sendAgain()
  assert.equal(platform.requests.length, before)
  assert.deepEqual(platform.chats.map(chat => chat.messages), [[scope + ':1'], [scope + ':2']], 'cycle 1 was admitted exactly once')
})

test('an unconfirmed cycle whose conversation was deleted is not sent again into a new one', async t => {
  const { storage, platform, pane, ready } = await realCycles(t)
  const p = pane(); await ready(p)
  platform.lose = 1
  await p.render().start(ACTION)
  assert.ok(p.render().cycle.unsent, 'the acknowledgement was lost')
  const scope = await storage.projectCycleScope('fixture-project')
  platform.chats[0].deleted = true
  // The retry arrives before any cycle 2.
  const reloaded = pane(); await ready(reloaded)
  const before = platform.requests.length
  const again = await reloaded.render().sendAgain()
  assert.equal(again.closed, true)
  assert.match(reloaded.render().cycle.error, /Start it again/)
  assert.equal(platform.requests.length, before, 'no start or send was made')
  assert.deepEqual(platform.messages(), [scope + ':1'], 'cycle 1 was admitted exactly once')
  // After a reload it is not offered again; new work is an explicit new cycle.
  const later = pane(); await ready(later)
  assert.equal(Boolean(later.render().cycle.unsent), false)
  assert.equal((await later.render().start({ ...ACTION, title: 'New work' })).ok, true)
  assert.deepEqual(platform.active().map(chat => chat.messages), [[scope + ':2']])
})

test('a stale retry never rolls back a newer cycle\'s model, and a retry does not re-apply one', async t => {
  const { platform, until, pane, ready } = await realCycles(t)
  const a = pane(); await ready(a)
  await a.render().start(ACTION)
  a.setCycle({ ...a.render().cycle, phase: 'complete' })
  // Cycle 2 picks model X.
  const x = { ...ACTION, title: 'Cycle two', agent: { provider: 'codex', model: 'model-x' } }
  await a.render().start(x)
  assert.equal(platform.chats[0].model, 'model-x')
  // Pane B moves on to cycle 3 with model Y.
  const b = pane(); await ready(b)
  b.setCycle({ ...b.render().cycle, phase: 'complete' })
  assert.equal((await b.render().start({ ...ACTION, title: 'Cycle three', agent: { provider: 'codex', model: 'model-y' } })).ok, true)
  assert.equal(platform.chats[0].model, 'model-y')
  // Pane A's stale retry of cycle 2 changes nothing.
  const scope = platform.chats[0].scope
  a.setCycle({ ...a.render().cycle, unsent: { k: 2, cid: scope + ':2', scope, action: freezeStartAction(x) } })
  const before = platform.requests.length
  await a.render().sendAgain()
  assert.equal(platform.requests.length, before, 'no PATCH and no send')
  assert.equal(platform.chats[0].model, 'model-y', 'the newer selection is kept')
  // A retry of the current cycle after its model was applied does not PATCH again.
  b.setCycle({ ...b.render().cycle, phase: 'complete' })
  platform.failSend = 1
  const z = { ...ACTION, title: 'Cycle four', agent: { provider: 'codex', model: 'model-z' } }
  assert.equal((await b.render().start(z)).ok, false)
  assert.equal(platform.chats[0].model, 'model-z')
  platform.chats[0].model = 'owner-changed'
  const patches = () => platform.requests.filter(([method]) => method === 'PATCH').length
  const patched = patches()
  await until(() => b.render().cycle.unsent)
  assert.equal((await b.render().sendAgain()).ok, true)
  assert.equal(patches(), patched, 'the retry did not PATCH again')
  assert.equal(platform.messages().filter(cid => cid === scope + ':4').length, 1)
})

test('a retry that finds its rejected conversation deleted settles this mount so Start works without a reload', async t => {
  const { storage, platform, until, pane, ready } = await realCycles(t)
  const p = pane(); await ready(p)
  platform.rejectFirstTurn = 1
  assert.equal((await p.render().start(ACTION)).ok, false)
  const saved = await storage.loadCycleState('fixture-project')
  assert.equal(saved.cycle.chat_id, 'chat-1', 'the rejected first turn named its conversation')
  assert.equal(saved.chat_id, '', 'nothing was delivered')
  // Reload, then the owner deletes that conversation.
  const reloaded = pane(); await ready(reloaded)
  assert.ok(reloaded.render().cycle.unsent)
  platform.chats[0].deleted = true
  const again = await reloaded.render().sendAgain()
  assert.equal(again.closed, true)
  await until(() => reloaded.render().cycle.phase === 'idle')
  const cycle = reloaded.render().cycle
  assert.equal(cycle.phase, 'idle', 'the same mount reflects the closed cycle: ' + JSON.stringify(cycle))
  assert.equal(Boolean(cycle.unsent), false)
  assert.match(cycle.error, /not sent again/)
  // Same mount, no reload: an explicit Start succeeds.
  const next = await reloaded.render().start({ ...ACTION, title: 'Start over' })
  assert.equal(next.ok, true, JSON.stringify(next))
  assert.equal(reloaded.render().cycle.chatId, 'chat-2')
  assert.deepEqual(platform.active().map(chat => chat.messages), [[saved.cycle.cid.replace(/:1$/, ':2')]])
})

test('a first start in no conversation says so, not that a conversation was lost', async t => {
  const { platform, until, pane, ready } = await realCycles(t)
  const p = pane(); await ready(p)
  // fetch throws before the request reaches the server: nothing is created.
  const original = platform.fetch
  platform.fetch = async () => { throw new TypeError('Failed to fetch') }
  assert.equal((await p.render().start(ACTION)).ok, false)
  platform.fetch = original
  assert.equal(platform.chats.length, 0)
  const again = await p.render().sendAgain()
  assert.equal(again.closed, true)
  await until(() => p.render().cycle.phase === 'idle')
  assert.equal(p.render().cycle.error, 'This start isn’t in any conversation. Start it again.')
  assert.equal(platform.chats.length, 0, 'nothing was created by the retry')
})
