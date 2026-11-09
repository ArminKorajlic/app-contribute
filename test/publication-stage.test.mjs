import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_STAGE, otherStage, stageApplies, stageOf, stageWords } from '../publication-stage.js'
import { normalizeAppSettings } from '../storage.js'

test('a new PR opens ready for review unless the owner chose draft: the documented normal stays the default', () => {
  assert.equal(DEFAULT_STAGE, 'ready')
  assert.equal(stageOf('draft'), 'draft')
  for (const value of ['ready', '', null, undefined, 'published', 7]) assert.equal(stageOf(value), 'ready', String(value))
  assert.equal(otherStage('draft'), 'ready')
  assert.equal(otherStage('ready'), 'draft')
  assert.equal(normalizeAppSettings(null).new_pr_stage, 'ready')
  assert.equal(normalizeAppSettings({ new_pr_stage: 'draft' }).new_pr_stage, 'draft')
  assert.equal(normalizeAppSettings({ new_pr_stage: 'whatever' }).new_pr_stage, 'ready', 'a damaged setting never opens a draft by accident')
})

test('the words name the result and keep the count, for one PR and for several', () => {
  const draft = stageWords('draft'), ready = stageWords('ready')
  assert.equal(draft.action(1), 'Open as draft')
  assert.equal(draft.action(3), 'Open 3 as drafts')
  assert.equal(ready.action(1), 'Open for review')
  assert.equal(ready.action(3), 'Open 3 for review')
  assert.equal(draft.onGithub(1), 'Open as draft on GitHub')
  assert.equal(ready.onGithub(2), 'Open 2 for review on GitHub')
  assert.equal(draft.heading(1), 'Open 1 reviewed pull request as a draft?')
  assert.equal(ready.heading(2), 'Send 2 reviewed pull requests?')
  assert.match(draft.description, /open as drafts: nobody is asked to review them until you open them for review/)
  assert.match(ready.description, /open ready for review/)
  assert.equal(stageWords('nonsense').line, ready.line)
})

test('one stage describes a batch only when every action opens a new PR on the personal path', () => {
  const fresh = { plan: { action: 'pr', repo: 'mobius-os/mobius' } }
  const update = { plan: { action: 'pr_update', repo: 'mobius-os/mobius' } }
  const relay = { submission_mode: 'mobius-bot', plan: { action: 'pr' } }
  assert.equal(stageApplies([fresh, fresh], 'github', 'connected'), true)
  assert.equal(stageApplies([fresh, update], 'github', 'connected'), false, 'an update edits an existing PR')
  assert.equal(stageApplies([fresh, relay], 'github', 'connected'), false, 'a relay draft is always a draft')
  assert.equal(stageApplies([], 'github', 'connected'), false)
})
