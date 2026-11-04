import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTION_COPY, openForReviewCopy } from '../action-copy.js'
import { isPersonalDraft } from '../domain.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const rollup = (state, count) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: count, checkRunCountsByState: [{ state, count }], statusContextCountsByState: [] } } } }] } })
const pr = (extra = {}) => ({ number: 9, title: 'Fix the thing', baseRefName: 'main', headRefOid: 'abcdef0123456789', mergeable: 'MERGEABLE', repository: { nameWithOwner: 'team/repo' }, ...rollup('SUCCESS', 21), ...extra })

test('opening for review says what happens, what GitHub shows now, and what it cannot undo', () => {
  const copy = openForReviewCopy(pr())
  assert.equal(copy.title, 'Open #9 for review?')
  assert.deepEqual(copy.facts.map(fact => `${fact.tone}:${fact.text}`), [
    'ok:Reviewers are asked to look at it',
    'ok:21 checks passed',
    'ok:No conflicts with main',
    'warn:Contribute cannot turn it back into a draft yet',
  ])
  assert.match(copy.footnote, /abcdef0/)
  assert.match(copy.footnote, /Nothing merges/)
  assert.equal(ACTION_COPY.open_review, openForReviewCopy)
})

test('failing, running or conflicting PRs warn but still may be opened for review', () => {
  const tones = extra => openForReviewCopy(pr(extra)).facts.filter(fact => fact.tone !== 'ok').map(fact => `${fact.tone}:${fact.text}`)
  assert.ok(tones({ ...rollup('FAILURE', 2) }).includes('warn:2 checks are failing'))
  assert.ok(tones({ ...rollup('PENDING', 3) }).includes('warn:Checks are still running'))
  assert.ok(tones({ mergeable: 'CONFLICTING' }).includes('bad:It conflicts with main'))
  assert.ok(!openForReviewCopy(pr({ commits: { nodes: [] } })).facts.some(fact => /check/i.test(fact.text)), 'no checks reported, no check line')
})

test('only a draft the owner opened with their own GitHub account can be opened for review', () => {
  assert.equal(isPersonalDraft({ status: 'draft', submission_mode: 'github' }), true)
  assert.equal(isPersonalDraft({ status: 'draft' }), true)
  assert.equal(isPersonalDraft({ status: 'draft', submission_mode: 'mobius-bot' }), false)
  assert.equal(isPersonalDraft({ status: 'open' }), false)
  assert.equal(isPersonalDraft(null), false)
})

test('the confirm sheet has one close affordance and one button that names the result', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ActionConfirm, props))
  `)
  const html = render({ pr: pr(), copy: openForReviewCopy(pr()), onConfirm: () => {}, onClose: () => {} })
  assert.match(html, /<h3[^>]*>Open #9 for review\?<\/h3>/)
  assert.match(html, /#9 Fix the thing/)
  assert.match(html, />Open for review<\/button>/)
  assert.match(html, /aria-label="Close"/)
  assert.doesNotMatch(html, />Cancel</, 'the X is the only way out')
  assert.match(html, /Contribute cannot turn it back into a draft yet/)
})
