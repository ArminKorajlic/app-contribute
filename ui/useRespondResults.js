import { useCallback, useEffect, useState } from 'react'
import { respondFact } from '../respond-store.js'

// The saved Respond-to-feedback answers and what the owner decided about them, kept on the app's one sync hub like the review runs:
// read at once, again on the hub's cadence (closely while a post is under way, see respondFact), and on `refresh` after Post or Discard.
export function useRespondResults({ hub, enabled }) {
  const [responses, setResponses] = useState([])
  useEffect(() => {
    if (!enabled) return undefined
    return hub.fact('responses', respondFact(setResponses))
  }, [hub, enabled])
  const refresh = useCallback(() => hub.refresh('responses'), [hub])
  // A fact is read once by whoever registers it; the hub keeps it fresh from then on.
  useEffect(() => { if (enabled) void refresh() }, [enabled, refresh])
  return { responses, refresh }
}
