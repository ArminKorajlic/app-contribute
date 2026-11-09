import assert from 'node:assert/strict'
import test from 'node:test'
import * as collaboration from '../collaboration.js'

test('execution labels outrank aggregate progress without discarding unknown saved states', () => {
  const label = collaboration.reviewRunStateLabel
  assert.equal(typeof label, 'function')
  for (const [execution_state, expected] of [['stopped','Stopped'],['failed','Failed'],['interrupted','Interrupted'],['awaiting_owner','Waiting for your answer']]) {
    assert.equal(label({execution_state,state:'reviewing'}),expected)
  }
  assert.equal(label({execution_state:'running',state:'all_clear'}),'Review clear')
  assert.equal(label({state:'future_state'}),'future_state')
})

test('halted unfinished items are not active; saved settled and queued evidence survives', () => {
  const progress = collaboration.reviewItemProgress
  assert.equal(typeof progress, 'function')
  const facts = {all_clear:'Review clear',merged:'Merged',queued:'In merge queue',complete:'Complete'}
  for (const execution_state of ['stopped','failed','interrupted','awaiting_owner']) {
    for (const state of ['reviewing','repairing','merging','pending']) {
      const value = progress({execution_state},{state})
      assert.equal(value.halted, execution_state !== 'awaiting_owner')
      assert.equal(value.waiting, execution_state === 'awaiting_owner')
      assert.equal(value.label, execution_state === 'awaiting_owner' ? collaboration.REVIEW_STATE_NAMES[state] : 'Not finished')
    }
    for (const [state,label] of Object.entries(facts)) {
      assert.deepEqual(progress({execution_state},{state}), {label,halted:false,waiting:false,settled:true})
    }
  }
  assert.deepEqual(progress({state:'reviewing'},{state:'future_state'}),{label:'future_state',halted:false,waiting:false,settled:false})
})

test('one shared run detail keeps recorded versions, posted reviews and the owning conversation', async t => {
  const { frontendModules, renderModule } = await import('./render-harness.mjs')
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { RunDetail } from './ui/RunDetail.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(RunDetail, props))
  `)
  const item = { repo: 'owner/repo', number: 7, head_sha: 'a'.repeat(40), base_ref: 'main', base_sha: 'b'.repeat(40), state: 'all_clear',
    summary: 'Saved findings', public_review: { state: 'posted', url: 'https://github.com/owner/repo/pull/7#pullrequestreview-1' } }
  const pr = { number: 7, repository: { nameWithOwner: 'owner/repo' }, headRefOid: 'a'.repeat(40), baseRefName: 'main', baseRef: { target: { oid: 'c'.repeat(40) } } }
  const html = render({ run: { id: 'run-1', mode: 'review', state: 'complete', chat_id: 'chat-1', items: [item] }, pulls: [pr], listState: {} })
  assert.match(html, /Recorded status: Complete/)
  assert.match(html, /Older base version · Recorded version <code>aaaaaaa → main \(bbbbbbb\)<\/code>/)
  assert.match(html, /Saved findings are not a new approval/)
  assert.match(html, /href="https:\/\/github.com\/owner\/repo\/pull\/7#pullrequestreview-1"/)
  assert.match(html, /Open review conversation/)
  const stopped = render({ run: { id: 'run-2', mode: 'review', state: 'reviewing', execution_state: 'stopped', can_stop: true, chat_id: 'chat-2', items: [{ ...item, state: 'reviewing', public_review: null }] },
    pulls: [pr], listState: {}, retryPulls: [pr], onRetry: () => {}, onStop: () => {} })
  assert.match(stopped, /#7 · Not finished/)
  assert.match(stopped, /Start again/)
  assert.doesNotMatch(stopped, /Stop workflow/, 'a halted run cannot be stopped again')
})
