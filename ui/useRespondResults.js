import { useCallback, useEffect, useState } from 'react'
import { SYNC_POLICY } from '../refresh.js'
import { postingSoon } from '../respond-result.js'
import { loadResponses } from '../respond-store.js'

// The saved Respond-to-feedback answers and what the owner decided about them, kept on the app's one sync hub like the review runs:
// read at once, again on the hub's cadence (faster while a post is under way), and on `refresh` after Post or Discard.
// A failed read keeps what is shown. These are reads of the app's own storage, not of GitHub.
export function useRespondResults({ hub, enabled }) {
  const [responses, setResponses] = useState([])
  useEffect(() => {
    if (!enabled) return undefined
    return hub.fact('responses', {
      read: () => loadResponses(),
      apply: setResponses,
      failed: () => {},
      every: { live: SYNC_POLICY.runsLiveMs, idle: SYNC_POLICY.runsIdleMs },
      live: list => !!list && list.some(postingSoon),
    })
  }, [hub, enabled])
  const refresh = useCallback(() => hub.refresh('responses'), [hub])
  // A fact is read once by whoever registers it; the hub keeps it fresh from then on.
  useEffect(() => { if (enabled) void refresh() }, [enabled, refresh])
  return { responses, refresh }
}
