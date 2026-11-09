import { useEffect, useLayoutEffect, useRef } from 'react'
import { connectInlineSession } from '../block-protocol.js'
import { loadFreshContributionRecord } from '../storage.js'
import { sharedPublicationObserver } from '../publication-observer.js'

// Headless: the chat host renders every control. This only connects the
// host's session to the inline Send model and the app's publication runtime
// (block-protocol.js connectInlineSession, which the tests drive directly).
// `onNeedRuntime(ids)` asks for the send runtime, checking exactly `ids`. An
// unknown send is observed through the frame's shared publication observer,
// which the app's refresh uses too, so the two never ask twice at once.
export function InlineBlockSession({ blockSession, runtime, onNeedRuntime, appId = null, token = '' }) {
  const connection = useRef(null)
  const latest = useRef({ runtime, onNeedRuntime })
  latest.current = { runtime, onNeedRuntime }
  useLayoutEffect(() => {
    const observer = appId ? sharedPublicationObserver(appId, token) : null
    connection.current = connectInlineSession({ blockSession,
      loadExact: id => loadFreshContributionRecord(id, { strict: true }), onNeedRuntime: ids => latest.current.onNeedRuntime?.(ids),
      observe: observer ? record => observer.check(record) : null })
    if (latest.current.runtime) connection.current.updateRuntime(latest.current.runtime)
    return () => { connection.current?.dispose(); connection.current = null }
  }, [])
  useEffect(() => { if (runtime) connection.current?.updateRuntime(runtime) }, [runtime])
  // The observer's next request uses the frame's current token.
  useEffect(() => { if (appId) sharedPublicationObserver(appId, token) }, [appId, token])
  return null
}
