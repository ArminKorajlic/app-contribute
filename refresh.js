export function createRefreshCoordinator(refresh) {
  let active = null
  let rerun = false

  return function requestRefresh() {
    if (active) {
      rerun = true
      return active
    }
    active = (async () => {
      do {
        rerun = false
        await refresh()
      } while (rerun)
    })().finally(() => { active = null })
    return active
  }
}

// Whether the shell shows this frame. A pane tiled beside a chat is shown without
// ever being focused, so window focus says nothing about it; the shell's own
// signal does. An older Möbius lacks it and falls back to the page's visibility.
// Calls `listener(visible)` at once and on every change; returns the unsubscribe.
export function watchVisibility(listener, host = globalThis.window) {
  if (typeof host?.mobius?.onVisibilityChange === 'function') return host.mobius.onVisibilityChange(listener)
  const report = () => listener(!host.document.hidden)
  host.document.addEventListener('visibilitychange', report)
  report()
  return () => host.document.removeEventListener('visibilitychange', report)
}

// Calls listener each time the frame is shown again after being hidden (never for
// the state it starts in): the moment to catch up on what moved while it was away.
export function onShownAgain(listener, host = globalThis.window) {
  let was = null
  return watchVisibility(visible => { if (visible && was === false) listener(); was = visible }, host)
}

// When the app re-reads what it shows. Reading costs: the platform's lists are
// cheap, GitHub's are measured in points (an account has 5,000 an hour; the
// full list of review requests costs 55 and takes seconds, a change probe 1).
export const SYNC_POLICY = Object.freeze({
  runsLiveMs: 10000, // a review or Respond conversation is at work
  runsIdleMs: 30000,
  responsesLiveMs: 2500, // a Respond answer is being posted: the card follows the posting script step by step
  probeMs: 60000, // the GitHub change probe
  githubCooldownMs: 300000, // between automatic reads of one GitHub fact
  lowPoints: 1000, // below this, automatic GitHub reads stop until the owner syncs
})

const STUCK_READ_MS = 60000

// A repeating read that belongs to one view (a project's conversation status):
// every `ms` while the frame is shown (none when `ms` is null) and once more when
// it is shown again. A read still running is never joined by another, unless it
// has not settled for a minute: a read that never settles must not silence the view for good.
function createTickers(isVisible) {
  const tickers = new Set()
  async function readOnce(ticker) {
    if (ticker.running && Date.now() - ticker.since < STUCK_READ_MS) return
    const mine = ticker.since = Date.now()
    ticker.running = true
    try { await ticker.read() } catch { /* the view shows what it last knew */ } finally { if (ticker.since === mine) ticker.running = false }
  }
  function arm(ticker) {
    clearTimeout(ticker.timer)
    ticker.timer = isVisible() && ticker.ms ? setTimeout(() => { void readOnce(ticker); arm(ticker) }, ticker.ms) : null
  }
  return {
    add(read, ms) {
      const ticker = { read, ms, timer: null, running: false, since: 0 }
      tickers.add(ticker)
      arm(ticker)
      return () => { tickers.delete(ticker); clearTimeout(ticker.timer) }
    },
    // The frame was shown or hidden; `catchUp` reads once more now.
    visibilityChanged(catchUp) {
      for (const ticker of tickers) {
        if (catchUp) void readOnce(ticker)
        arm(ticker)
      }
    },
  }
}

const movedKeys = (before, next) => new Set(before ? [...next].filter(([key, signature]) => before.has(key) && before.get(key) !== signature).map(([key]) => key) : [])

// GitHub watched through a cheap probe: probe() answers a Map of signatures (null
// when GitHub did not); changed(keys) hears which signatures moved since the last
// answer, the first answer being only the baseline. Probes run once a minute while
// the frame is shown, and never closer together however often it is shown again.
function createProbeWatcher({ policy, now, isVisible, isLow }) {
  let current = null

  async function probeOnce(watcher) {
    clearTimeout(watcher.timer)
    if (watcher.running) return
    watcher.running = true
    watcher.nextAt = now() + policy.probeMs
    try {
      if (!isVisible() || isLow()) return
      const next = await watcher.probe()
      if (!next || current !== watcher) return
      const moved = movedKeys(watcher.snapshot, next)
      watcher.snapshot = next
      if (moved.size) watcher.changed(moved)
    } finally {
      watcher.running = false
      if (current === watcher) arm(watcher)
    }
  }

  function arm(watcher) {
    clearTimeout(watcher.timer)
    watcher.timer = null
    if (!isVisible()) return
    const wait = watcher.nextAt - now()
    if (wait <= 0) void probeOnce(watcher)
    else watcher.timer = setTimeout(() => { void probeOnce(watcher) }, wait)
  }

  return {
    // Watching again keeps the last answer, so a re-render never forgets what changed.
    watch(probe, changed) {
      if (current) Object.assign(current, { probe, changed })
      else {
        current = { probe, changed, snapshot: null, timer: null, running: false, nextAt: -Infinity }
        arm(current)
      }
      const mine = current
      return () => { clearTimeout(mine.timer); if (current === mine) current = null }
    },
    visibilityChanged() { if (current) arm(current) },
  }
}

// A read nobody awaits: its failure is the fact's own business (`failed`).
const quiet = promise => promise.catch(() => {})

// One refresh path for every fact the app shows, so no screen keeps a timer or
// a focus handler of its own. A fact is registered with
//   read()    one read of its source; apply(value) shows it
//   failed(e) optional: a failed read keeps what is shown and is reported here;
//             without it the failure belongs to whoever called refresh()
//   every     { live, idle } ms cadence while shown, or none (read on events only)
//   live(v)   whether the last value read says something is happening (faster cadence)
//   github    true for reads that cost points: automatic reads of them wait out
//             the cooldown and stop when the account runs low
// Reads of one fact never overlap, and an answer older than an action that
// superseded it is dropped, so the newest state is the one shown. Hidden, the
// hub reads nothing; shown again, it catches up at once. `refresh(name)` is the
// owner's own action and always reads (and rejects when the read fails);
// `changed(name)` is a change known to matter and `automatic(name)` a cadence.
export function createSyncHub({ policy = SYNC_POLICY, remainingPoints = () => null, now = () => Date.now(), host = globalThis.window } = {}) {
  const facts = new Map()
  let visible = false
  let shownOnce = false
  let stopVisibility = null

  const isVisible = () => visible
  const lowOnPoints = () => (remainingPoints() ?? Infinity) < policy.lowPoints
  const githubDue = fact => now() - fact.lastRead >= policy.githubCooldownMs
  const tickers = createTickers(isVisible)
  const probes = createProbeWatcher({ policy, now, isVisible, isLow: lowOnPoints })
  const stillWanted = (fact, generation) => generation === fact.generation && facts.get(fact.name) === fact

  async function readFact(fact) {
    const generation = fact.generation
    fact.lastRead = now()
    fact.pending = false
    fact.urgent = false
    let value
    try { value = await fact.spec.read() } catch (error) {
      if (!fact.spec.failed) throw error
      if (stillWanted(fact, generation)) fact.spec.failed(error)
      return
    }
    if (!stillWanted(fact, generation)) return
    fact.value = value
    fact.spec.apply(value)
  }

  // The wait before the next automatic read of a fact, or null when none is due.
  // A fact nobody has read yet is left to whoever registered it (refresh): the
  // hub keeps fresh what was read, so a registration never reads twice.
  function nextWait(fact) {
    const { spec } = fact
    if (fact.lastRead === -Infinity) return null
    if (spec.github) return fact.pending && !lowOnPoints() ? Math.max(0, fact.lastRead + policy.githubCooldownMs - now()) : null
    const every = spec.every && (spec.live?.(fact.value) ? spec.every.live : spec.every.idle)
    return every ? Math.max(0, fact.lastRead + every - now()) : null
  }

  function arm(fact) {
    clearTimeout(fact.timer)
    fact.timer = null
    const wait = visible ? nextWait(fact) : null
    if (wait !== null) fact.timer = setTimeout(() => { fact.timer = null; void automatic(fact) }, wait)
  }

  function run(fact) {
    return fact.coordinator().finally(() => arm(fact))
  }

  // Held back, not dropped. A change known to matter (`urgent`) is read as soon as
  // the frame is shown and the account has points; a cadence also waits out the cooldown.
  function hold(fact, urgent = false) {
    fact.pending = true
    fact.urgent ||= urgent
    arm(fact)
    return Promise.resolve()
  }

  function automatic(fact) {
    if (!visible) return Promise.resolve()
    if (fact.spec.github && (lowOnPoints() || !githubDue(fact))) return hold(fact)
    return quiet(run(fact))
  }

  function showFact(fact) {
    if (!visible) { clearTimeout(fact.timer); fact.timer = null; return }
    if (fact.lastRead === -Infinity && !fact.pending) return
    if (fact.urgent && !lowOnPoints()) { void quiet(run(fact)); return }
    if (fact.spec.github) { if (fact.pending || githubDue(fact)) void automatic(fact); else arm(fact); return }
    if (fact.spec.every || fact.pending) void quiet(run(fact)); else arm(fact)
  }

  function show(next) {
    const first = !shownOnce
    shownOnce = true
    if (next === visible) return
    visible = next
    tickers.visibilityChanged(visible && !first)
    for (const fact of facts.values()) showFact(fact)
    probes.visibilityChanged()
  }

  return {
    // Start following the shell's visibility; returns the stop.
    start() {
      stopVisibility = watchVisibility(show, host)
      return () => { stopVisibility?.(); stopVisibility = null; show(false) }
    },
    // Register a fact (again: the newest spec is used). Returns its unregister.
    fact(name, spec) {
      const known = facts.get(name)
      const fact = known || { name, spec, generation: 0, lastRead: -Infinity, pending: false, urgent: false, timer: null, value: null }
      fact.spec = spec
      if (!known) {
        fact.coordinator = createRefreshCoordinator(() => readFact(fact))
        facts.set(name, fact)
      }
      return () => { if (facts.get(name) === fact) { clearTimeout(fact.timer); facts.delete(name) } }
    },
    // The owner's action: read now, whatever the cooldown, the budget or visibility.
    refresh(name) {
      const fact = facts.get(name)
      return fact ? run(fact) : Promise.resolve()
    },
    // Something this fact depends on changed (a review changed state): read now,
    // cooldown or not. Hidden, or with the account low, it waits (for the frame to
    // be shown, or for the owner's Sync).
    changed(name) {
      const fact = facts.get(name)
      if (!fact) return Promise.resolve()
      if (!visible || (fact.spec.github && lowOnPoints())) return hold(fact, true)
      return quiet(run(fact))
    },
    // An action's own answer is being shown: reads begun before it must not land.
    supersede(name) {
      const fact = facts.get(name)
      if (fact) fact.generation += 1
    },
    // A read a probe or a cadence asks for: held back while the GitHub fact's
    // cooldown runs or the account is low, and read once that allows it.
    automatic: name => (facts.has(name) ? automatic(facts.get(name)) : Promise.resolve()),
    every: (read, ms) => tickers.add(read, ms),
    watch: (probe, changed) => probes.watch(probe, changed),
  }
}
