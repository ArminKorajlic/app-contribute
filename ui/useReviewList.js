import { useEffect, useMemo, useState } from 'react'
import { classifyReview, loadReviewPulls, needsLiveRead, reviewCounts, reviewEntries } from '../review-list.js'

// The owner's reviews for the PR reviews page and the rail's badge. The PRs a
// review could still be waiting on are read live when the set changes and again
// on every explicit refresh (`refreshKey`, bumped by Sync with GitHub): the same
// PRs can be pushed, closed or merged without the saved reviews changing at all.
// Until a read has answered (or failed) they are "checking", so a stale finding
// never flashes up as waiting on you. A read a newer one replaced is dropped.
export function useReviewList({ token, runs, ignored, login, refreshKey = 0 }) {
  const raw = useMemo(() => reviewEntries(runs), [runs])
  const refs = useMemo(() => raw.filter(needsLiveRead).map(entry => ({ repo: entry.item.repo, number: entry.item.number })), [raw])
  const refsKey = refs.map(ref => `${ref.repo}#${ref.number}`.toLowerCase()).sort().join('|')
  const [live, setLive] = useState({ answered: '', pulls: new Map() })
  useEffect(() => {
    if (!refsKey || !token) return undefined
    let alive = true
    loadReviewPulls(token, refs).then(
      pulls => { if (alive) setLive({ answered: refsKey, pulls }) },
      // A refresh that cannot read GitHub keeps what the last read said about these same PRs.
      () => { if (alive) setLive(old => ({ answered: refsKey, pulls: old.answered === refsKey ? old.pulls : new Map() })) },
    )
    return () => { alive = false }
  }, [refsKey, refreshKey, token])
  return useMemo(() => {
    const entries = raw.map(entry => {
      if (needsLiveRead(entry) && live.answered !== refsKey) return { ...entry, bucket: 'checking', chips: [] }
      return { ...entry, ...classifyReview(entry, { login, ignored, live: live.pulls.get(entry.id) }) }
    })
    return { entries, counts: reviewCounts(entries), checking: entries.some(entry => entry.bucket === 'checking') }
  }, [raw, live, refsKey, login, ignored])
}
