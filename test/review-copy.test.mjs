import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeWhenSafeBlocker, reviewSwitchHints, reviewWindowCopy } from '../review-copy.js'

test('a plain private review says nothing reaches GitHub and starts privately', () => {
  const copy = reviewWindowCopy({ mode: 'review', bindCurrentTarget: true })
  assert.equal(copy.title, 'Review only')
  assert.equal(copy.publicEffect.tone, 'private')
  assert.equal(copy.startLabel, 'Start private review')
  assert.ok(copy.steps.every(step => !step.added))
})

test('each allowed public effect adds its own step, summary and start label', () => {
  const posting = reviewWindowCopy({ mode: 'review', posting: true })
  assert.equal(posting.startLabel, 'Start review, allow comment')
  assert.match(posting.publicEffect.text, /at most one review comment from your account, only for a verdict the agent marks as public/)
  assert.ok(posting.steps.some(step => step.added && /posts one comment/.test(step.text)))
  const merge = reviewWindowCopy({ mode: 'review_merge', bindCurrentTarget: true })
  assert.equal(merge.startLabel, 'Start review, merge when safe')
  assert.match(merge.footnote, /merges into the newest version of the target branch/)
})

test('a batch discloses one possible comment and one merge on each selected PR', () => {
  const posting = reviewWindowCopy({ mode: 'review', posting: true, count: 3 })
  assert.match(posting.publicEffect.text, /at most one review comment per PR from your account/)
  assert.ok(posting.steps.some(step => step.added && /posts one comment on that PR/.test(step.text)))
  const merge = reviewWindowCopy({ mode: 'review_merge', count: 3 })
  assert.match(merge.publicEffect.text, /^the merge of each PR\./)
  const single = reviewWindowCopy({ mode: 'review', posting: true, count: 1 })
  assert.doesNotMatch(single.publicEffect.text, /per PR/)
})

test('posting never appears with merge, matching the platform rule that posting is review-only', () => {
  const copy = reviewWindowCopy({ mode: 'review_merge', posting: true })
  assert.equal(copy.startLabel, 'Start review, merge when safe')
  assert.doesNotMatch(copy.publicEffect.text, /comment from your account/)
})

test('review, fix and merge names pushes, independent review, checks and Stop', () => {
  const copy = reviewWindowCopy({ mode: 'review_fix_merge', draftScope: true, count: 2 })
  assert.equal(copy.title, 'Review, fix and merge')
  assert.equal(copy.startLabel, 'Allow fix and merge')
  const steps = copy.steps.map(step => step.text).join(' ')
  assert.match(steps, /pushes fixes/)
  assert.match(steps, /A second agent reviews every fix/)
  assert.match(steps, /It marks the draft ready for review/)
  assert.match(steps, /required checks/)
  assert.match(copy.publicEffect.text, /may notify reviewers/)
  assert.match(copy.publicEffect.text, /the merge of each PR\. No comments, and nothing outside these PRs/)
  assert.match(copy.footnote, /You can stop it at any time/)
  assert.match(copy.footnote, /these exact versions/)
})

test('merge when safe explains why it is unavailable', () => {
  assert.equal(mergeWhenSafeBlocker({ drafts: true, mayMergeAll: true, posting: false }), 'Not available for drafts.')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: false, posting: false }), 'Needs merge rights on this repository.')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: true, posting: true }), 'Turn off posting to merge when safe.')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: true, posting: false }), '')
})

test('the switch hints say per PR for a batch and stay singular for one PR', () => {
  assert.match(reviewSwitchHints(1).posting, /^One comment from your account, only for a verdict the agent is sure about\./)
  assert.match(reviewSwitchHints(1).merge, /Merges or queues the PR after/)
  assert.match(reviewSwitchHints(2).posting, /^Up to one comment per PR from your account/)
  assert.match(reviewSwitchHints(2).merge, /Merges or queues each PR after/)
})
