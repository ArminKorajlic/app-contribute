import test from 'node:test'
import assert from 'node:assert/strict'

import { createRefreshCoordinator } from '../refresh.js'

test('refresh coordinator deduplicates overlap and preserves one trailing run', async () => {
  let runs = 0
  let release
  const firstGate = new Promise(resolve => { release = resolve })
  const refresh = createRefreshCoordinator(async () => {
    runs += 1
    if (runs === 1) await firstGate
  })

  const first = refresh()
  const second = refresh()
  const third = refresh()
  assert.equal(first, second)
  assert.equal(second, third)
  assert.equal(runs, 1)

  release()
  await first
  assert.equal(runs, 2)
})

test('refresh coordinator starts a new run after becoming idle', async () => {
  let runs = 0
  const refresh = createRefreshCoordinator(async () => { runs += 1 })
  await refresh()
  await refresh()
  assert.equal(runs, 2)
})
