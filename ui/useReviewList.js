import { useCallback, useEffect, useMemo, useState } from 'react'
import { classifyReview, loadReviewPulls, reviewCounts, reviewEntries } from '../review-list.js'

// The owner's reviews for the PR reviews page and the rail's badge. Every PR is
// read live once per change of the set (and again on retry); until that read
// has answered they are "checking", and a PR GitHub did not return is unknown,
// so a stale finding never shows up as waiting on you.
export function useReviewList({ token, runs, ignored, login }) {
  const raw = useMemo(() => reviewEntries(runs), [runs])
  const refs = useMemo(() => raw.map(entry => ({ repo: entry.item.repo, number: entry.item.number })), [raw])
  const refsKey = refs.map(ref => `${ref.repo}#${ref.number}`.toLowerCase()).sort().join('|')
  const [attempt, setAttempt] = useState(0)
  const [live, setLive] = useState({ answered: '', pulls: new Map() })
  useEffect(() => {
    if (!refsKey || !token) return undefined
    let alive = true
    const answered = `${refsKey}@${attempt}`
    loadReviewPulls(token, refs).then(
      pulls => { if (alive) setLive({ answered, pulls }) },
      () => { if (alive) setLive({ answered, pulls: new Map() }) },
    )
    return () => { alive = false }
  }, [refsKey, token, attempt])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return useMemo(() => {
    const done = live.answered === `${refsKey}@${attempt}`
    const entries = raw.map(entry => (done
      ? { ...entry, ...classifyReview(entry, { login, ignored, runs, live: live.pulls.get(entry.id) }) }
      : { ...entry, bucket: 'checking', chips: [] }))
    return { entries, counts: reviewCounts(entries), checking: entries.some(entry => entry.bucket === 'checking'), retry }
  }, [raw, live, refsKey, attempt, login, ignored, runs, retry])
}
