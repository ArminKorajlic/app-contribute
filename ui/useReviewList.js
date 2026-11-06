import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchChangeProbe } from '../api.js'
import { loadReviewRuns } from '../collaboration.js'
import { SYNC_POLICY } from '../refresh.js'
import { hasActiveReview } from '../review-frame.js'
import { changedReviewRuns, classifyReview, loadReviewPulls, reviewCounts, reviewEntries, reviewKey, withReviewRun } from '../review-list.js'

// The one sync hub of the open app (refresh.js createSyncHub): index.jsx provides
// it, and every screen asks it to read again instead of keeping a timer of its
// own. Without one (a screen rendered on its own) a screen simply never re-reads.
export const SyncHubContext = createContext(null)
export const useSyncHub = () => useContext(SyncHubContext)

const ALL_PULLS = '*'

// The live read of every PR a review belongs to. The whole set is read once per
// change of the set; afterwards only the PRs that moved. A review that changed
// state reads its PR at once (`want`); the probe seeing a PR move waits out the
// GitHub cooldown (`wantLater`), so a busy PR costs at most one read per five
// minutes. The owner's Sync and Retry (`readAll`) always read, whatever the budget.
function useReviewPulls({ hub, enabled, token, refs, refsKey, attempt }) {
  const [live, setLive] = useState({ answered: '', pulls: new Map() })
  const latest = useRef({ refs, answered: '' })
  latest.current = { refs, answered: `${refsKey}@${attempt}` }
  const wanted = useRef(new Set())
  const mark = useCallback(keys => keys.forEach(key => wanted.current.add(key)), [])
  const want = useCallback(keys => { mark(keys); return hub.changed('reviewPulls') }, [hub, mark])
  const wantLater = useCallback(keys => { mark(keys); return hub.automatic('reviewPulls') }, [hub, mark])
  const readAll = useCallback(() => { mark([ALL_PULLS]); return hub.refresh('reviewPulls') }, [hub, mark])
  useEffect(() => {
    if (!enabled || !token) return undefined
    return hub.fact('reviewPulls', {
      github: true,
      read: async () => {
        const keys = wanted.current
        if (!keys.size) return null
        wanted.current = new Set()
        const { refs: all, answered } = latest.current
        const everything = keys.has(ALL_PULLS)
        const pulls = await loadReviewPulls(token, everything ? all : all.filter(ref => keys.has(reviewKey(ref.repo, ref.number))))
        return { everything, pulls, answered }
      },
      apply: result => { if (result) setLive(old => mergePulls(old, result)) },
      failed: () => setLive(old => (old.answered === latest.current.answered ? old : { answered: latest.current.answered, pulls: new Map() })),
    })
  }, [hub, enabled, token])
  const seenAttempt = useRef(attempt)
  useEffect(() => {
    const retried = attempt !== seenAttempt.current
    seenAttempt.current = attempt
    if (retried) void readAll()
    else if (refsKey) void want([ALL_PULLS])
  }, [refsKey, attempt, enabled, token, want, readAll])
  useEffect(() => {
    if (!enabled || !token) return undefined
    return hub.watch(
      () => fetchChangeProbe(token, latest.current.refs.map(ref => ({ ...ref, key: reviewKey(ref.repo, ref.number) }))),
      keys => {
        if (keys.has('requests')) void hub.automatic('incoming')
        const moved = latest.current.refs.map(ref => reviewKey(ref.repo, ref.number)).filter(key => keys.has(key))
        if (moved.length) void wantLater(moved)
      },
    )
  }, [hub, enabled, token, wantLater])
  return { live, want, readAll }
}

// A full read replaces what is known; a partial one updates just the PRs it read.
const mergePulls = (old, { everything, pulls, answered }) => ({
  answered: everything ? answered : old.answered,
  pulls: everything ? pulls : new Map([...old.pulls, ...pulls]),
})

// The owner's reviews for the PR reviews page and the rail's badge. Until the
// first live read of the set has answered they are "checking", and a PR GitHub did
// not return is unknown, so a stale finding never shows up as waiting on you.
export function useReviewList({ hub, enabled = true, token, runs, chats = [], responses = [], ignored, login }) {
  const raw = useMemo(() => reviewEntries(runs), [runs])
  const refs = useMemo(() => raw.map(entry => ({ repo: entry.item.repo, number: entry.item.number })), [raw])
  const refsKey = refs.map(ref => reviewKey(ref.repo, ref.number)).sort().join('|')
  const [attempt, setAttempt] = useState(0)
  const { live, want, readAll } = useReviewPulls({ hub, enabled, token, refs, refsKey, attempt })
  const pullsMoved = useCallback(pulls => want(pulls.map(pull => reviewKey(pull.repo, pull.number))), [want])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return useMemo(() => {
    const done = live.answered === `${refsKey}@${attempt}`
    const entries = raw.map(entry => (done
      ? { ...entry, ...classifyReview(entry, { login, ignored, runs, chats, responses, live: live.pulls.get(entry.id) }) }
      : { ...entry, bucket: 'checking', chips: [] }))
    return { entries, counts: reviewCounts(entries), checking: entries.some(entry => entry.bucket === 'checking'), retry, pullsMoved, syncPulls: readAll }
  }, [raw, live, refsKey, attempt, login, ignored, runs, chats, responses, retry, pullsMoved, readAll])
}

// Leaving a PR page re-reads the runs: whatever happened there shows on the Desk at once.
function usePullPageExit(pullPageOpen, refresh) {
  const hadPullPage = useRef(false)
  useEffect(() => {
    if (pullPageOpen) { hadPullPage.current = true; return }
    if (!hadPullPage.current) return
    hadPullPage.current = false
    void refresh()
  }, [pullPageOpen, refresh])
}

// The review runs the Desk's rows wear their frames from, with the live
// Respond-to-feedback conversations that come in the same list (another agent
// job on a PR). The hub's `runs` fact reads them: every 10 s while a review or
// conversation is at work, every 30 s otherwise, at once when the frame is shown
// again, on Sync (the returned `refresh`), and whenever a PR page or the review
// link starts, stops or re-reads a review (`onRunsChanged` in PullRequests and
// ReviewSelection). This is the one copy of the runs: the PR page reads it too,
// and `patch` shows an action's own answer in it. These are reads of the
// platform's review list, not of GitHub, though loadReviewRuns may re-check
// GitHub for a run that still waits on it, at most once a minute per run.
export function useDeskReviewRuns({ hub, token, appId, connState, sendOnly, pullPageOpen, onReviewsMoved }) {
  const [runs, setRuns] = useState([])
  const [respondChats, setRespondChats] = useState([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const enabled = !sendOnly && connState === 'connected'
  // The runs last shown, to tell which review changed state since (a read of a
  // changed review hands it to onReviewsMoved; the owner's own action does not).
  const shown = useRef([])
  const show = useCallback(list => { shown.current = list; setRuns(list) }, [])
  const movedRef = useRef(onReviewsMoved)
  movedRef.current = onReviewsMoved
  useEffect(() => {
    if (!enabled) return undefined
    return hub.fact('runs', {
      read: () => loadReviewRuns(token, appId),
      apply: list => {
        const moved = changedReviewRuns(shown.current, list.runs || [])
        show(list.runs || [])
        setRespondChats(list.respond_chats || [])
        setError('')
        if (moved.length) movedRef.current?.(moved)
      },
      failed: failure => setError(failure.message),
      every: { live: SYNC_POLICY.runsLiveMs, idle: SYNC_POLICY.runsIdleMs },
      live: list => !!list && (hasActiveReview(list.runs) || (list.respond_chats || []).length > 0),
    })
  }, [hub, enabled, token, appId, show])
  const refresh = useCallback(() => hub.refresh('runs'), [hub])
  useEffect(() => {
    if (sendOnly || connState === 'checking') return
    if (connState !== 'connected') { setReady(true); return }
    void refresh().finally(() => setReady(true))
  }, [connState, refresh, sendOnly, token, appId])
  // An owner action's own answer replaces that run in the shared copy; reads begun before it must not land.
  const patch = useCallback(run => {
    hub.supersede('runs')
    show(withReviewRun(shown.current, run))
  }, [hub, show])
  usePullPageExit(pullPageOpen, refresh)
  return { runs, respondChats, error, ready, refresh, patch }
}
