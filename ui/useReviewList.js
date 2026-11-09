import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadReviewRuns } from '../collaboration.js'
import { hasActiveReview } from '../review-frame.js'
import { classifyReview, loadReviewPulls, reviewCounts, reviewEntries } from '../review-list.js'

const RUNS_POLL_MS = 15000

// The owner's reviews for the PR reviews page and the rail's badge. Every PR is read live when the
// set changes and again on every explicit refresh (`refreshKey`, bumped by Sync with GitHub) and on
// Try again (`retry`): the same PRs can be pushed, closed or merged without the saved reviews
// changing at all. Until the first read has answered they are "checking", so a stale finding never
// flashes up as waiting on you; a PR GitHub did not return is unknown ("Couldn’t read"). A refresh
// that cannot read GitHub keeps what the last read said about these same PRs, and a read a newer
// one replaced is dropped.
export function useReviewList({ token, runs, chats = [], ignored, login, refreshKey = 0 }) {
  const raw = useMemo(() => reviewEntries(runs), [runs])
  const refs = useMemo(() => raw.map(entry => ({ repo: entry.item.repo, number: entry.item.number })), [raw])
  const refsKey = refs.map(ref => `${ref.repo}#${ref.number}`.toLowerCase()).sort().join('|')
  const [attempt, setAttempt] = useState(0)
  const [live, setLive] = useState({ answered: '', pulls: new Map() })
  useEffect(() => {
    if (!refsKey || !token) return undefined
    let alive = true
    loadReviewPulls(token, refs).then(
      pulls => { if (alive) setLive({ answered: refsKey, pulls }) },
      () => { if (alive) setLive(old => ({ answered: refsKey, pulls: old.answered === refsKey ? old.pulls : new Map() })) },
    )
    return () => { alive = false }
  }, [refsKey, refreshKey, token, attempt])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return useMemo(() => {
    const done = live.answered === refsKey
    const entries = raw.map(entry => (done
      ? { ...entry, ...classifyReview(entry, { login, ignored, runs, chats, live: live.pulls.get(entry.id) }) }
      : { ...entry, bucket: 'checking', chips: [] }))
    return { entries, counts: reviewCounts(entries), checking: entries.some(entry => entry.bucket === 'checking'), retry }
  }, [raw, live, refsKey, login, ignored, runs, chats, retry])
}

// The review runs the Desk's rows wear their frames from, with the live
// Respond-to-feedback conversations that come in the same list (another agent
// job on a PR). Read at open, on Sync (the returned `refresh`), whenever a PR
// page or the review link starts, stops or re-reads a review (`onRunsChanged`
// in PullRequests and ReviewSelection), on leaving a PR page and on window
// focus; polled only while a review is running. These are reads of the
// platform's review list. They are not the GitHub sync that index.jsx keeps
// behind the header's Sync button, though loadReviewRuns may re-check GitHub for
// a run that still waits on it, at most once a minute per run.
export function useDeskReviewRuns({ token, appId, connState, sendOnly, pullPageOpen }) {
  const [runs, setRuns] = useState([])
  const [respondChats, setRespondChats] = useState([])
  const [ready, setReady] = useState(false)
  const issued = useRef(0)
  const landed = useRef(0)
  const refresh = useCallback(async () => {
    const read = ++issued.current
    try {
      const list = await loadReviewRuns(token, appId)
      // Reads start from several places. An answer older than one already shown
      // is dropped, so it never hides a review that was just started.
      if (read < landed.current) return
      landed.current = read
      setRuns(list.runs || [])
      setRespondChats(list.respond_chats || [])
    } catch { /* the rows simply show no frame */ }
  }, [token, appId])
  useEffect(() => {
    if (sendOnly || connState === 'checking') return
    if (connState !== 'connected') { setReady(true); return }
    void refresh().finally(() => setReady(true))
  }, [connState, refresh, sendOnly])
  const active = hasActiveReview(runs) || respondChats.length > 0
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => { void refresh() }, RUNS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, refresh])
  useEffect(() => {
    if (sendOnly || connState !== 'connected') return undefined
    const onFocus = () => { if (!document.hidden) void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [connState, refresh, sendOnly])
  const hadPullPage = useRef(false)
  useEffect(() => {
    if (pullPageOpen) { hadPullPage.current = true; return }
    if (!hadPullPage.current) return
    hadPullPage.current = false
    void refresh()
  }, [pullPageOpen, refresh])
  return { runs, respondChats, ready, refresh }
}
