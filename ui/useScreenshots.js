import { createContext, useContext, useEffect, useState } from 'react'
import { planScreenshots } from '../domain.js'

// The workspace supplies how a staged screenshot is read:
// (recordId, shot) => Promise<data URL | null>, resolving only to bytes whose
// SHA-256 is shot.sha256 (the cache below trusts that). Without it no image is
// fetched and the description shows its neutral placeholders.
export const ScreenshotLoaderContext = createContext(null)

// Successful reads only, keyed by record + content hash, so re-renders and
// reopening a card never refetch the same bytes; a failed read retries the next
// time the description is shown. Bounded, oldest first.
const MAX_CACHED = 8
const cache = new Map()
const inflight = new Map()
const keyFor = (recordId, shot) => `${recordId}\n${shot.sha256}\n${shot.name}`

function cached(recordId, shots) {
  const images = {}
  for (const shot of shots) {
    const url = cache.get(keyFor(recordId, shot))
    if (url) images[shot.name] = url
  }
  return images
}

function loadOnce(load, recordId, shot) {
  const key = keyFor(recordId, shot)
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  if (!inflight.has(key)) {
    inflight.set(key, Promise.resolve().then(() => load(recordId, shot)).catch(() => null).then(url => {
      inflight.delete(key)
      if (typeof url === 'string' && url) {
        cache.set(key, url)
        while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value)
      }
      return url || null
    }))
  }
  return inflight.get(key)
}

// name → data URL for the record's staged screenshots, read only while
// `active` (the description is on screen).
export function useScreenshots(rec, active) {
  const load = useContext(ScreenshotLoaderContext)
  const shots = planScreenshots(rec?.plan)
  const recordId = rec?.id || ''
  const identity = recordId + '|' + shots.map(shot => shot.sha256 + ':' + shot.name).join(',')
  const [state, setState] = useState(() => ({ identity, images: cached(recordId, shots) }))
  // A different record or screenshot set starts from its own cached images.
  let current = state
  if (state.identity !== identity) {
    current = { identity, images: cached(recordId, shots) }
    setState(current)
  }

  useEffect(() => {
    if (!active || !shots.length || typeof load !== 'function') return undefined
    let cancelled = false
    for (const shot of shots) {
      loadOnce(load, recordId, shot).then(url => {
        if (cancelled || !url) return
        setState(previous => previous.identity !== identity || previous.images[shot.name] === url ? previous
          : { identity, images: { ...previous.images, [shot.name]: url } })
      })
    }
    return () => { cancelled = true }
  }, [active, load, identity])

  return { count: shots.length, images: shots.length ? current.images : null }
}
