import { useEffect, useLayoutEffect, useRef } from 'react'
import { createInlineSession } from '../inline-session.js'
import { connectInlineSession } from '../block-protocol.js'
import { loadFreshContributionRecord } from '../storage.js'

// Headless: the chat host renders every control. This only connects the
// host's session to the inline Send model and the app's publication runtime
// (block-protocol.js connectInlineSession, which the tests drive directly).
// `onNeedRuntime(ids)` asks for the send runtime, checking exactly `ids`.
export function InlineBlockSession({ blockSession, runtime, onNeedRuntime }) {
  const connection = useRef(null)
  const latest = useRef({ runtime, onNeedRuntime })
  latest.current = { runtime, onNeedRuntime }
  useLayoutEffect(() => {
    connection.current = connectInlineSession({ blockSession, createSession: createInlineSession,
      loadExact: id => loadFreshContributionRecord(id, { strict: true }), onNeedRuntime: ids => latest.current.onNeedRuntime?.(ids) })
    if (latest.current.runtime) connection.current.updateRuntime(latest.current.runtime)
    return () => { connection.current?.dispose(); connection.current = null }
  }, [])
  useEffect(() => { if (runtime) connection.current?.updateRuntime(runtime) }, [runtime])
  return null
}
