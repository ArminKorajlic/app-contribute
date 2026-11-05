import test from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../pr-machine.js'
import { nextStepModel, pillTone, stateLine } from '../next-step.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const facts = (extra = {}) => ({ author: 'sam', head: 'h', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'WRITE', reviews: [],
  openThreads: 0, myReview: null, job: null, result: null, outbox: null, readComplete: true, role: 'author', ...extra })
const capabilities = { merge_now: true, mark_ready_now: true, back_to_draft_now: true, close_now: true, request_rereview_now: true }
const step = (extra, options = { capabilities }) => nextStepModel(decide(facts(extra)), options)

// The eight states of the critique's gallery, each with its pill, the machine's sentence and its button.
const GALLERY = [
  ['your draft', { lifecycle: 'draft' }, 'Draft', 'you', 'Review', 'menu'],
  ['your draft, clean', { lifecycle: 'draft', result: { head: 'h', outcome: 'clear' } }, 'Ready to open', 'ready', 'Open for review', 'menu'],
  ['your PR, checks fail', { checks: 'fail' }, 'Checks or conflicts', 'blocker', 'Respond to feedback', 'menu'],
  ['their PR, asks for you', { role: 'reviewer' }, 'To review', 'you', 'Review', 'menu'],
  ['their PR, new commits', { role: 'reviewer', myReview: { state: 'COMMENTED', commit: 'old' } }, 'New commits · review again', 'waiting', 'Review again', 'menu'],
  ['your PR, approved', { reviews: [{ by: 'kim', state: 'APPROVED', commit: 'h' }] }, 'Ready to merge', 'ready', 'Merge', 'menu'],
  ['agent stopped', { job: { kind: 'review', state: 'stalled' } }, 'Agent stopped', 'waiting', 'Review again', 'menu'],
  ['waiting on others', {}, 'Waiting on reviewers', 'quiet', null, null],
]
for (const [name, extra, pill, tone, button, route] of GALLERY) {
  test(`next step, ${name}: pill, the machine's own hint, and the one button`, () => {
    const decision = decide(facts(extra))
    const model = nextStepModel(decision, { capabilities })
    assert.equal(model.pill.label, pill)
    assert.equal(model.pill.tone, tone)
    assert.equal(model.hint, decision.headline)
    assert.equal(model.primary?.title ?? null, button)
    assert.equal(model.primary?.route ?? null, route)
  })
}

test('a next step this Möbius cannot run for you has no button, and a refused one never gets it', () => {
  assert.equal(step({ reviews: [{ by: 'kim', state: 'APPROVED', commit: 'h' }] }, { capabilities: {} }).primary, null)
  assert.equal(step({ lifecycle: 'draft', result: { head: 'h', outcome: 'clear' } }, { capabilities: {} }).primary, null)
  // Merge needs write rights: without them the machine does not name it, nothing to offer.
  assert.equal(step({ reviews: [{ by: 'kim', state: 'APPROVED', commit: 'h' }], permission: 'READ' }).primary, null)
  assert.equal(nextStepModel(null), null)
})

test('the pill colour keeps one meaning per colour', () => {
  assert.equal(pillTone(decide(facts({ job: { kind: 'respond', state: 'stalled' } }))), 'waiting')
  assert.equal(pillTone(decide(facts({ checks: 'fail' }))), 'blocker')
  assert.equal(pillTone(decide(facts({ lifecycle: 'merged' }))), 'quiet')
})

test('the state line is Draft, In review, Approved, Merged from the PR itself, and a closed PR has none', () => {
  const at = (pr, extra = {}) => stateLine(pr, decide(facts(extra))).current
  assert.equal(at({ isDraft: true }, { lifecycle: 'draft' }), 'Draft')
  assert.equal(at({ isDraft: false }), 'In review')
  assert.equal(at({ isDraft: false }, { reviews: [{ by: 'kim', state: 'APPROVED', commit: 'h' }] }), 'Approved')
  // An approval of an older version is not an approval of this one.
  assert.equal(at({ isDraft: false }, { reviews: [{ by: 'kim', state: 'APPROVED', commit: 'old' }] }), 'In review')
  assert.equal(at({ state: 'MERGED', mergedAt: '2026-11-01T00:00:00Z' }), 'Merged')
  assert.equal(stateLine({ state: 'CLOSED' }, decide(facts({ lifecycle: 'closed' }))), null)
  const done = stateLine({ isDraft: false }, decide(facts({ reviews: [{ by: 'kim', state: 'APPROVED', commit: 'h' }] }))).steps
  assert.deepEqual(done.map(item => [item.label, item.done, item.current]), [['Draft', true, false], ['In review', true, false], ['Approved', false, true], ['Merged', false, false]])
})

test('the panel shows the pill, the hint and a filled button that runs the next step', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { NextStep, StateLine } from './ui/NextStep.jsx'
    export const render = props => renderToStaticMarkup(React.createElement('div', null, React.createElement(StateLine, { pr: { isDraft: false }, decision: props.decision }), React.createElement(NextStep, props)))
  `)
  const html = render({ decision: decide(facts({ reviews: [{ by: 'kim', state: 'APPROVED', commit: 'h' }] })), capabilities })
  assert.match(html, /class="co-next-step"/)
  assert.match(html, /co-desk-chip is-ready">Ready to merge/)
  assert.match(html, /Your PR · approved by kim at this version, checks green\. Merge it/)
  assert.match(html, /<button type="button" class="co-btn co-btn-primary">Merge<\/button>/)
  assert.match(html, /<li class="is-current" aria-current="step">Approved<\/li>/)
  const waiting = render({ decision: decide(facts()), capabilities })
  assert.doesNotMatch(waiting, /co-btn-primary/)
})

test('a stopped job starts over as the same job, through the menu action it came from', () => {
  const again = extra => nextStepModel(decide(facts({ job: { state: 'stalled' }, ...extra })), { capabilities }).primary
  const cases = [
    [{ role: 'author', job: { kind: 'review', state: 'stalled' } }, 'check_my_pr', 'Review again'],
    [{ role: 'reviewer', job: { kind: 'review', state: 'stalled' } }, 'review', 'Review again'],
    [{ role: 'author', openThreads: 1, job: { kind: 'respond', state: 'stalled' } }, 'respond', 'Run it again'],
    [{ role: 'author', job: { kind: 'review_fix_merge', state: 'stalled' } }, 'finish_it', 'Run it again'],
    [{ role: 'reviewer', permission: 'ADMIN', job: { kind: 'review_fix_merge', state: 'stalled' } }, 'take_over', 'Run it again'],
  ]
  for (const [extra, intent, title] of cases) assert.deepEqual([again(extra).route, again(extra).intent, again(extra).title], ['menu', intent, title], intent)
  // Someone else's take over needs maintainer rights: without them there is no button to press.
  assert.equal(again({ role: 'reviewer', permission: 'WRITE', job: { kind: 'review_fix_merge', state: 'stalled' } }), null)
})
