import { useEffect, useRef } from 'react'

// Runs `run` once, as soon as `ready`, for the navigation named by `nonce`: how
// a row on the desk can open a PR straight into the window it asked for.
export function RunOnce({ ready, nonce, run }) {
  const done = useRef('')
  useEffect(() => {
    if (!ready || done.current === nonce) return
    done.current = nonce
    run()
  }, [ready, nonce])
  return null
}
