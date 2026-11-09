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
      assert.deepEqual(progress({execution_state},{state}), {label,halted:false,waiting:false,settled:true,turn:'none'})
    }
  }
  assert.deepEqual(progress({state:'reviewing'},{state:'future_state'}),{label:'future_state',halted:false,waiting:false,settled:false,turn:'agent'})
})

const run = (extra = {}) => ({ state: 'complete', execution_state: 'completed', ...extra })
const found = (extra = {}) => ({ state: 'needs_you', ...extra })

test('once you have requested changes the move is the author\'s, and nothing is left to answer', () => {
  const requested = found({ verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES' } })
  for (const own of [null, false]) {
    const value = collaboration.reviewItemProgress(run(), requested, { own })
    assert.deepEqual(value, { label: 'Changes requested', halted: false, waiting: false, settled: true, turn: 'author' })
  }
  // A finished chat that is still "awaiting you" is not a question after the verdict is out.
  const waiting = collaboration.reviewItemProgress(run({ execution_state: 'awaiting_owner' }), requested)
  assert.equal(waiting.turn, 'author')
  assert.equal(waiting.waiting, false)
  // A review run that stopped after the verdict is still settled, never "Not finished".
  assert.equal(collaboration.reviewItemProgress(run({ state: 'running', execution_state: 'stopped' }), requested).halted, false)
})

test('a finding you have not acted on stays yours: private, proposed, or on your own PR', () => {
  const progress = (item, ctx) => collaboration.reviewItemProgress(run(), item, ctx)
  assert.equal(progress(found()).turn, 'owner', 'private findings wait for your decision')
  assert.equal(progress({ state: 'verdict_pending', verdict_proposal: { state: 'proposed', event: 'APPROVE' } }).turn, 'owner')
  // The review comment is already on GitHub, but on your own PR the fixing is yours.
  const posted = found({ public_review: { state: 'posted', url: 'https://github.com/o/r/pull/1#x' } })
  assert.equal(progress(posted, { own: true }).turn, 'owner')
  assert.equal(progress(posted, { own: null }).turn, 'owner', 'an unknown author never hands the PR over')
  assert.deepEqual(progress(posted, { own: false }), { label: 'Review posted', halted: false, waiting: false, settled: true, turn: 'author' })
  assert.equal(collaboration.reviewItemProgress(run({ execution_state: 'awaiting_owner' }), found()).turn, 'owner', 'a real question waits on you')
})

test('a discarded verdict is settled: you decided not to post it', () => {
  const value = collaboration.reviewItemProgress(run(), found({ verdict_proposal: { state: 'discarded', event: 'REQUEST_CHANGES' } }))
  assert.deepEqual(value, { label: 'Verdict discarded', halted: false, waiting: false, settled: true, turn: 'none' })
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
  assert.match(html, /Open chat/)
  const stopped = render({ run: { id: 'run-2', mode: 'review', state: 'reviewing', execution_state: 'stopped', can_stop: true, chat_id: 'chat-2', items: [{ ...item, state: 'reviewing', public_review: null }] },
    pulls: [pr], listState: {}, retryPulls: [pr], onRetry: () => {}, onStop: () => {} })
  assert.match(stopped, /#7 · Not finished/)
  assert.match(stopped, /Review again/)
  assert.doesNotMatch(stopped, /Stop workflow/, 'a halted run cannot be stopped again')
})

test('a finding you set aside stops waiting on you for that exact version, and only for it', () => {
  const item = { repo: 'Team/Repo', number: 9, head_sha: 'a'.repeat(40), state: 'needs_you', summary: 'P1' }
  const notes = collaboration.withIgnoreNote({}, item, 'Not a problem', '2026-11-04T10:00:00Z')
  assert.deepEqual(Object.keys(notes), [`team/repo#9@${'a'.repeat(40)}`])
  assert.deepEqual(collaboration.ignoredNote(item, notes), { reason: 'Not a problem', at: '2026-11-04T10:00:00Z' })
  const ignored = collaboration.reviewItemProgress(run(), item, { ignored: notes })
  assert.deepEqual(ignored, { label: 'Ignored', halted: false, waiting: false, settled: true, turn: 'none' })
  // A new version of the PR is reviewed and judged afresh.
  assert.equal(collaboration.ignoredNote({ ...item, head_sha: 'b'.repeat(40) }, notes), null)
  // Only findings can be set aside: a clear review has none, and Undo brings it back.
  assert.equal(collaboration.ignoredNote({ ...item, state: 'all_clear' }, notes), null)
  assert.equal(collaboration.ignoredNote(item, collaboration.withoutIgnoreNote(notes, item)), null)
  assert.deepEqual(collaboration.withoutIgnoreNote(null, item), {})
})

test('ignore notes stay few: the newest two hundred are remembered', () => {
  let notes = {}
  for (let number = 1; number <= 230; number += 1) notes = collaboration.withIgnoreNote(notes, { repo: 'o/r', number, head_sha: 'c'.repeat(40) }, 'Out of scope', new Date(Date.UTC(2026, 10, 1, 0, 0, number)).toISOString())
  assert.equal(Object.keys(notes).length, 200)
  assert.ok(notes[`o/r#230@${'c'.repeat(40)}`], 'the newest note is kept')
  assert.equal(notes[`o/r#1@${'c'.repeat(40)}`], undefined, 'the oldest fell away')
})
