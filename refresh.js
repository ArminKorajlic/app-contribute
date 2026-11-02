export function createRefreshCoordinator(refresh) {
  let active = null
  let rerun = false

  return function requestRefresh() {
    if (active) {
      rerun = true
      return active
    }
    active = (async () => {
      do {
        rerun = false
        await refresh()
      } while (rerun)
    })().finally(() => { active = null })
    return active
  }
}
