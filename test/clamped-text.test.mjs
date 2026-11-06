import assert from 'node:assert/strict'
import test from 'node:test'
import { copyToClipboard } from '../ui/clipboard.js'
import { watchOverflow } from '../ui/watchOverflow.js'

test('a clamped box is measured again when its width changes, so narrowing never hides text without Show more', () => {
  const box = { scrollHeight: 120, clientHeight: 256, firstElementChild: { content: true } }
  const seen = []
  let watcher
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.watched = []; this.stopped = false; watcher = this }
    observe(element) { this.watched.push(element) }
    disconnect() { this.stopped = true }
  }
  const stop = watchOverflow(box, value => seen.push(value), FakeObserver)
  assert.deepEqual(seen, [false])
  // The viewport narrows: the same text wraps onto more lines than the clamp shows.
  box.scrollHeight = 400
  watcher.callback()
  assert.deepEqual(seen, [false, true])
  assert.deepEqual(watcher.watched, [box, box.firstElementChild])
  stop()
  assert.equal(watcher.stopped, true)
})

test('without ResizeObserver the box is still measured once and cleanup is safe', () => {
  const seen = []
  const stop = watchOverflow({ scrollHeight: 300, clientHeight: 200 }, value => seen.push(value), undefined)
  assert.deepEqual(seen, [true])
  assert.doesNotThrow(stop)
})

test('a copy is reported as done only when the clipboard accepted it', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  t.after(() => Object.defineProperty(globalThis, 'navigator', original))
  const use = clipboard => Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true })
  const written = []
  use({ writeText: async text => { written.push(text) } })
  assert.equal(await copyToClipboard('777'), true)
  assert.deepEqual(written, ['777'])
  use({ writeText: async () => { throw new DOMException('denied', 'NotAllowedError') } })
  assert.equal(await copyToClipboard('777'), false)
  use(undefined)
  assert.equal(await copyToClipboard('777'), false)
})
