import { useEffect, useMemo, useState } from 'react'
import { classifyReview, loadReviewPulls, needsLiveRead, reviewCounts, reviewEntries } from '../review-list.js'

// The owner's reviews for the PR reviews page and the rail's badge. The PRs a
// review could still be waiting on are read live once per change of the set;
// until that read has answered (or failed) they are "checking", so a stale
// finding never flashes up as waiting on you.
export function useReviewList({ token, runs, ignored, login }) {
  const raw = useMemo(() => reviewEntries(runs), [runs])
  const refs = useMemo(() => raw.filter(needsLiveRead).map(entry => ({ repo: entry.item.repo, number: entry.item.number })), [raw])
  const refsKey = refs.map(ref => `${ref.repo}#${ref.number}`.toLowerCase()).sort().join('|')
  const [live, setLive] = useState({ answered: '', pulls: new Map() })
  useEffect(() => {
    if (!refsKey || !token) return undefined
    let alive = true
    loadReviewPulls(token, refs).then(
      pulls => { if (alive) setLive({ answered: refsKey, pulls }) },
      () => { if (alive) setLive({ answered: refsKey, pulls: new Map() }) },
    )
    return () => { alive = false }
  }, [refsKey, token])
  return useMemo(() => {
    const entries = raw.map(entry => {
      if (needsLiveRead(entry) && live.answered !== refsKey) return { ...entry, bucket: 'checking', chips: [] }
      return { ...entry, ...classifyReview(entry, { login, ignored, live: live.pulls.get(entry.id) }) }
    })
    return { entries, counts: reviewCounts(entries), checking: entries.some(entry => entry.bucket === 'checking') }
  }, [raw, live, refsKey, login, ignored])
}
