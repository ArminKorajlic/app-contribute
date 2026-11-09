import { useCallback, useEffect, useMemo, useState } from 'react'
import { classifyReview, loadReviewPulls, reviewCounts, reviewEntries } from '../review-list.js'

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
