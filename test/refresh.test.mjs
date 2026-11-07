import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

import { SYNC_POLICY, createRefreshCoordinator, createSyncHub, onShownAgain, watchVisibility } from '../refresh.js'

test('refresh coordinator deduplicates overlap and preserves one trailing run', async () => {
  let runs = 0
  let release
  const firstGate = new Promise(resolve => { release = resolve })
  const refresh = createRefreshCoordinator(async () => {
    runs += 1
    if (runs === 1) await firstGate
  })

  const first = refresh()
  const second = refresh()
  const third = refresh()
  assert.equal(first, second)
  assert.equal(second, third)
  assert.equal(runs, 1)

  release()
  await first
  assert.equal(runs, 2)
})

test('refresh coordinator starts a new run after becoming idle', async () => {
  let runs = 0
  const refresh = createRefreshCoordinator(async () => { runs += 1 })
  await refresh()
  await refresh()
  assert.equal(runs, 2)
})

// --- The sync hub: one refresh path for what the app shows -----------------------------

afterEach(() => mock.timers.reset())

const settle = () => new Promise(resolve => setImmediate(resolve))
// One second at a time: a read re-arms its timer only after its answer lands.
async function elapse(ms) { for (let second = 0; second < ms / 1000; second++) { mock.timers.tick(1000); await settle() } }

// A hub on fake time with one fact per name: `reads` counts its reads, `shown` holds what it applied last.
function setup({ remaining = null } = {}) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const state = { remaining, visible: false, reads: {}, shown: {}, live: {}, changes: [], probes: 0, signature: new Map([['requests', 'a']]) }
  const host = { mobius: { onVisibilityChange: listener => { state.show = listener; listener(state.visible); return () => { state.show = null } } } }
  const hub = createSyncHub({ remainingPoints: () => state.remaining, host })
  const fact = (name, extra = {}) => hub.fact(name, {
    read: async () => { state.reads[name] = (state.reads[name] || 0) + 1; return state.reads[name] },
    apply: value => { state.shown[name] = value },
    live: () => !!state.live[name],
    ...extra,
  })
  const watch = () => hub.watch(async () => { state.probes += 1; return state.signature && new Map(state.signature) }, keys => state.changes.push([...keys]))
  const setVisible = async visible => { state.visible = visible; state.show?.(visible); await settle() }
  return { hub, state, fact, watch, setVisible }
}
const RUNS = { every: { live: SYNC_POLICY.runsLiveMs, idle: SYNC_POLICY.runsIdleMs } }

test('watchVisibility follows the shell signal and never window focus', () => {
  const seen = []
  const shell = { mobius: { onVisibilityChange: listener => { listener(true); return () => seen.push('unsubscribed') } } }
  const stop = watchVisibility(visible => seen.push(visible), shell)
  stop()
  assert.deepEqual(seen, [true, 'unsubscribed'])
})

test('watchVisibility falls back to the page visibility on a shell without the signal', () => {
  const listeners = new Set()
  const host = { document: { hidden: false, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) } }
  const seen = []
  const stop = watchVisibility(visible => seen.push(visible), host)
  host.document.hidden = true
  for (const listener of listeners) listener()
  stop()
  assert.deepEqual(seen, [true, false])
  assert.equal(listeners.size, 0)
})

test('onShownAgain fires on coming back, not on the state the frame starts in', () => {
  let visible = true, announce
  const host = { mobius: { onVisibilityChange: listener => { announce = listener; listener(visible); return () => {} } } }
  let comebacks = 0
  onShownAgain(() => { comebacks += 1 }, host)
  assert.equal(comebacks, 0)
  announce(false); announce(true); announce(true)
  assert.equal(comebacks, 1)
})

test('a hidden frame reads nothing and a shown one catches up at once', async () => {
  const { hub, state, fact, setVisible } = setup()
  const stop = hub.start()
  fact('runs', RUNS)
  await hub.refresh('runs')
  await elapse(10 * 60000)
  assert.equal(state.reads.runs, 1, 'a frame that is not shown made a read')
  await setVisible(true)
  assert.equal(state.reads.runs, 2, 'showing the frame did not read at once')
  assert.equal(state.shown.runs, 2)
  stop()
})

test('a fact reads every idle interval, and every live interval while something is happening', async () => {
  const { hub, state, fact, setVisible } = setup()
  hub.start(); fact('runs', RUNS)
  await setVisible(true)
  await hub.refresh('runs')
  await elapse(SYNC_POLICY.runsIdleMs)
  assert.equal(state.reads.runs, 2)
  state.live.runs = true
  await elapse(SYNC_POLICY.runsIdleMs)
  assert.equal(state.reads.runs, 3, 'the idle interval read once more before the live one began')
  await elapse(SYNC_POLICY.runsLiveMs * 3)
  assert.equal(state.reads.runs, 6, 'a live fact was not read every live interval')
})

test('overlapping requests share one read and trail with one more', async () => {
  const { hub, state, fact } = setup()
  let release
  hub.fact('slow', { read: () => new Promise(resolve => { state.reads.slow = (state.reads.slow || 0) + 1; release = resolve }), apply: value => { state.shown.slow = value } })
  const first = hub.refresh('slow'), second = hub.refresh('slow'), third = hub.refresh('slow')
  assert.equal(state.reads.slow, 1)
  release('one'); await settle(); release('two'); await Promise.all([first, second, third])
  assert.equal(state.reads.slow, 2)
  assert.equal(state.shown.slow, 'two')
})

test('a read begun before an action superseded it never lands over the action', async () => {
  const { hub, state } = setup()
  let release
  hub.fact('runs', { read: () => new Promise(resolve => { release = resolve }), apply: value => { state.shown.runs = value } })
  const slow = hub.refresh('runs')
  hub.supersede('runs')
  state.shown.runs = 'the action answer'
  release('older list'); await slow
  assert.equal(state.shown.runs, 'the action answer')
})

test('a failed read keeps what is shown and reports once', async () => {
  const { hub, state } = setup()
  const failures = []
  hub.fact('runs', { read: async () => { throw new Error('offline') }, apply: value => { state.shown.runs = value }, failed: error => failures.push(error.message) })
  state.shown.runs = 'earlier'
  await hub.refresh('runs')
  assert.equal(state.shown.runs, 'earlier')
  assert.deepEqual(failures, ['offline'])
})

test('an automatic GitHub read waits out the cooldown, then reads once', async () => {
  const { hub, state, fact, setVisible } = setup()
  hub.start(); fact('incoming', { github: true })
  await setVisible(true)
  await hub.refresh('incoming')
  await elapse(60000)
  void hub.automatic('incoming')
  await elapse(1000)
  assert.equal(state.reads.incoming, 1, 'the cooldown did not hold the read back')
  await elapse(SYNC_POLICY.githubCooldownMs)
  assert.equal(state.reads.incoming, 2, 'the wanted read did not happen when the cooldown ended')
  await elapse(SYNC_POLICY.githubCooldownMs * 2)
  assert.equal(state.reads.incoming, 2, 'a read nobody asked for ran')
})

// The review requests' failure mode: the probe saw a change once, the full read failed, and the probe
// never reports that signature again. The read must stay wanted, not wait for another outside change.
test('a GitHub read that failed stays wanted: read again after the cooldown though the probe sees nothing new', async () => {
  const { hub, state, fact, setVisible } = setup()
  let failing = false
  hub.start()
  fact('incoming', {
    github: true,
    read: async () => {
      state.reads.incoming = (state.reads.incoming || 0) + 1
      if (failing) throw new Error('GitHub did not answer')
      return state.reads.incoming
    },
    failed: () => {},
  })
  hub.watch(async () => new Map(state.signature), keys => { if (keys.has('requests')) void hub.automatic('incoming') })
  await setVisible(true)
  await hub.refresh('incoming')
  failing = true
  state.signature = new Map([['requests', 'b']]) // a new review request arrives
  await elapse(SYNC_POLICY.githubCooldownMs + 2000)
  assert.equal(state.reads.incoming, 2, 'the probe-triggered read did not run')
  failing = false
  await elapse(SYNC_POLICY.githubCooldownMs - 10000)
  assert.equal(state.reads.incoming, 2, 'the retry came before the cooldown ended')
  await elapse(12000)
  assert.equal(state.reads.incoming, 3, 'the failed read was never retried')
  assert.equal(state.shown.incoming, 3)
  await elapse(SYNC_POLICY.githubCooldownMs * 3)
  assert.equal(state.reads.incoming, 3, 'a read that succeeded was repeated')
})

test('a failed GitHub read is retried only while the frame is shown, after the cooldown and with points left; Sync reads it at once', async () => {
  const { hub, state, fact, setVisible } = setup()
  let failing = true
  hub.start()
  fact('incoming', {
    github: true,
    read: async () => {
      state.reads.incoming = (state.reads.incoming || 0) + 1
      if (failing) throw new Error('GitHub did not answer')
      return state.reads.incoming
    },
    failed: () => {},
  })
  await setVisible(true)
  await hub.refresh('incoming')
  await setVisible(false)
  await elapse(60000)
  await setVisible(true)
  assert.equal(state.reads.incoming, 1, 'the frame shown again retried inside the cooldown')
  await elapse(SYNC_POLICY.githubCooldownMs + 1000)
  assert.equal(state.reads.incoming, 2, 'the failed read was not retried once the cooldown ended')
  state.remaining = SYNC_POLICY.lowPoints - 1
  await elapse(SYNC_POLICY.githubCooldownMs * 2)
  assert.equal(state.reads.incoming, 2, 'a low account retried')
  failing = false
  await hub.refresh('incoming')
  assert.equal(state.reads.incoming, 3, 'Sync did not read')
  assert.equal(state.shown.incoming, 3)
  state.remaining = 4000
  await elapse(SYNC_POLICY.githubCooldownMs * 3)
  assert.equal(state.reads.incoming, 3, 'a read that succeeded was repeated')
})

test('the owner can always read GitHub: a forced refresh ignores the cooldown and a low budget', async () => {
  const { hub, state, fact } = setup({ remaining: 10 })
  fact('incoming', { github: true })
  await hub.refresh('incoming'); await hub.refresh('incoming')
  assert.equal(state.reads.incoming, 2)
})

test('low on points, automatic GitHub reads stop while the platform reads go on', async () => {
  const { hub, state, fact, watch, setVisible } = setup({ remaining: SYNC_POLICY.lowPoints - 1 })
  hub.start(); fact('runs', RUNS); fact('incoming', { github: true }); watch()
  await setVisible(true)
  await hub.refresh('runs')
  void hub.automatic('incoming')
  await elapse(10 * 60000)
  assert.equal(state.reads.incoming, undefined, 'a GitHub read ran on a low budget')
  assert.equal(state.probes, 0, 'the probe ran on a low budget')
  assert.ok(state.reads.runs >= 20, 'the platform reads stopped with the budget')
  state.remaining = 4000
  await hub.refresh('incoming')
  assert.equal(state.reads.incoming, 1)
})

test('the probe takes a baseline, then reports exactly the signatures that moved, once a minute', async () => {
  const { hub, state, watch, setVisible } = setup()
  hub.start(); watch()
  await setVisible(true)
  assert.equal(state.probes, 1)
  assert.deepEqual(state.changes, [], 'the first answer is a baseline, not a change')
  await elapse(SYNC_POLICY.probeMs)
  assert.equal(state.probes, 2); assert.deepEqual(state.changes, [])
  state.signature = new Map([['requests', 'b'], ['owner/repo#7', 'x']])
  await elapse(SYNC_POLICY.probeMs)
  assert.deepEqual(state.changes, [['requests']], 'a signature that appeared is new, not changed')
  state.signature = new Map([['requests', 'b'], ['owner/repo#7', 'y']])
  await elapse(SYNC_POLICY.probeMs)
  assert.deepEqual(state.changes, [['requests'], ['owner/repo#7']])
  state.signature = null
  await elapse(SYNC_POLICY.probeMs * 3)
  assert.equal(state.changes.length, 2, 'a probe GitHub did not answer counted as a change')
})

test('the probe is quiet while the frame is hidden', async () => {
  const { hub, state, watch, setVisible } = setup()
  hub.start(); watch()
  await elapse(10 * 60000)
  assert.equal(state.probes, 0)
  await setVisible(true)
  assert.equal(state.probes, 1)
  await setVisible(false)
  await elapse(10 * 60000)
  assert.equal(state.probes, 1)
})

test('an unregistered fact is never read again', async () => {
  const { hub, state, fact, setVisible } = setup()
  hub.start(); const stop = fact('runs', RUNS)
  await setVisible(true)
  await hub.refresh('runs')
  stop()
  await elapse(10 * 60000)
  assert.equal(state.reads.runs, 1)
})

test('a fact unregistered while its read is in flight is never re-armed, and its queued trailing read never runs', async () => {
  const { hub, state, setVisible } = setup()
  hub.start()
  let release
  const stop = hub.fact('runs', {
    ...RUNS,
    read: () => {
      state.reads.runs = (state.reads.runs || 0) + 1
      return state.reads.runs === 1 ? new Promise(resolve => { release = resolve }) : Promise.resolve('trailing answer')
    },
    apply: value => { state.shown.runs = value },
  })
  await setVisible(true)
  const running = hub.refresh('runs')
  void hub.refresh('runs') // the owner asks again while the first read is out: one trailing read is queued
  stop() // a connection or token change replaces the fact
  release('late answer')
  await running
  await elapse(10 * 60000)
  assert.equal(state.reads.runs, 1, 'the removed fact went on reading')
  assert.equal(state.shown.runs, undefined, 'the removed fact showed an answer')
})

test('a change the hub is told of reads GitHub at once, unless the account is low', async () => {
  const { hub, state, fact, setVisible } = setup()
  hub.start(); fact('incoming', { github: true })
  await setVisible(true)
  await hub.refresh('incoming')
  await hub.changed('incoming')
  assert.equal(state.reads.incoming, 2, 'a change waited out the cooldown')
  state.remaining = SYNC_POLICY.lowPoints - 1
  await hub.changed('incoming')
  assert.equal(state.reads.incoming, 2, 'a change read GitHub on a low budget')
  await hub.refresh('incoming')
  assert.equal(state.reads.incoming, 3, 'the owner\'s Sync did not read')
})

test('a view\'s own repeating read runs while shown, catches up when shown again, and stops when stopped', async () => {
  const { hub, state, setVisible } = setup()
  let reads = 0
  state.visible = true
  hub.start()
  const stop = hub.every(() => { reads += 1 }, 5000)
  assert.equal(reads, 0, 'the state the frame starts in is not a catch-up')
  await elapse(10000)
  assert.equal(reads, 2)
  await setVisible(false)
  await elapse(60000)
  assert.equal(reads, 2, 'a hidden frame kept reading')
  await setVisible(true)
  assert.equal(reads, 3, 'showing the frame again did not catch up at once')
  stop()
  await elapse(30000)
  assert.equal(reads, 3, 'a stopped read ran again')
})

test('no screen keeps a focus handler or a refresh timer of its own: reads belong to the hub', async () => {
  const { readFileSync } = await import('node:fs')
  for (const file of ['index.jsx', 'ui/PullRequests.jsx', 'ui/ReviewSelection.jsx', 'ui/useReviewList.js', 'ui/useProjectCycle.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /addEventListener\('(focus|visibilitychange)'/, `${file} listens to focus or visibility itself`)
    assert.doesNotMatch(source, /setInterval\(/, `${file} runs a refresh timer itself`)
    assert.doesNotMatch(source, /RUNS_POLL_MS|INCOMING_REREAD_MS/, `${file} keeps a cadence constant outside SYNC_POLICY`)
  }
})

test('a failed read rejects the owner\'s refresh when the fact does not handle failures itself, and never rejects a cadence', async () => {
  const { hub, state, setVisible } = setup()
  hub.start()
  hub.fact('ledger', { read: async () => { throw new Error('ledger scan failed') }, apply: value => { state.shown.ledger = value } })
  await assert.rejects(hub.refresh('ledger'), /ledger scan failed/)
  await setVisible(true)
  await hub.changed('ledger')
  await hub.automatic('ledger')
  assert.equal(state.shown.ledger, undefined, 'a failed read showed something')
})

test('a read that failed after it was superseded is not reported over the action that replaced it', async () => {
  const { hub } = setup()
  const failures = []
  let fail
  hub.fact('runs', { read: () => new Promise((_, reject) => { fail = reject }), apply() {}, failed: error => failures.push(error.message) })
  const slow = hub.refresh('runs')
  hub.supersede('runs')
  fail(new Error('timed out')); await slow
  assert.deepEqual(failures, [])
})

test('showing the frame again and again probes at most once a minute', async () => {
  const { hub, state, watch, setVisible } = setup()
  hub.start(); watch()
  await setVisible(true)
  for (let flip = 0; flip < 11; flip++) { await setVisible(false); await elapse(5000); await setVisible(true) }
  assert.equal(state.probes, 1, 'every showing probed GitHub')
  await elapse(SYNC_POLICY.probeMs)
  assert.equal(state.probes, 2)
})

test('a view\'s repeating read is never joined by another while one is still running', async () => {
  const { hub, state, setVisible } = setup()
  let started = 0, release
  state.visible = true
  hub.start()
  hub.every(() => { started += 1; return new Promise(resolve => { release = resolve }) }, 5000)
  await elapse(30000)
  assert.equal(started, 1, 'a second read started while the first was running')
  release(); await settle()
  await elapse(5000)
  assert.equal(started, 2)
})

test('a change told to a hidden frame is read when the frame is shown, not before', async () => {
  const { hub, state, fact, setVisible } = setup()
  hub.start(); fact('reviewPulls', { github: true })
  await hub.refresh('reviewPulls')
  await hub.changed('reviewPulls')
  assert.equal(state.reads.reviewPulls, 1, 'a hidden frame read for a change')
  await setVisible(true)
  assert.equal(state.reads.reviewPulls, 2, 'the change was lost')
})

test('a GitHub fact held back by a low account is read after the owner\'s Sync restores points, and a probe can no longer lift the guard', async () => {
  const { hub, state, fact, setVisible } = setup({ remaining: SYNC_POLICY.lowPoints - 1 })
  hub.start(); fact('reviewPulls', { github: true })
  await setVisible(true)
  await hub.changed('reviewPulls')
  assert.equal(state.reads.reviewPulls, undefined, 'a change read GitHub on a low budget')
  state.remaining = 4000
  await hub.refresh('reviewPulls')
  assert.equal(state.reads.reviewPulls, 1)
})

test('a view\'s repeating read that never settles does not silence the view for good', async () => {
  const { hub, state } = setup()
  let started = 0
  state.visible = true
  hub.start()
  hub.every(() => { started += 1; return new Promise(() => {}) }, 5000)
  await elapse(50000)
  assert.equal(started, 1, 'a read began while the first was still within its minute')
  await elapse(20000)
  assert.ok(started >= 2, 'the view never read again after a read that never settled')
})
