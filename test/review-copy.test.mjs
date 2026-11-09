import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeWhenSafeBlocker, reviewSwitchHints, reviewWindowCopy, verdictCopy } from '../review-copy.js'

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

test('posting with merge says the review is posted first and only then merged', () => {
  const copy = reviewWindowCopy({ mode: 'review_merge', posting: true })
  assert.equal(copy.startLabel, 'Start review, post and merge when safe')
  assert.match(copy.publicEffect.text, /at most one review comment from your account.*, then the merge\./)
  assert.ok(copy.steps.some(step => step.added && /posts one comment/.test(step.text)))
  assert.ok(copy.steps.some(step => step.added && /posts it first\. Once GitHub shows that review/.test(step.text)))
})

test('a proposed verdict never posts or merges before the owner submits it', () => {
  const review = reviewWindowCopy({ mode: 'review', posting: true, verdict: true })
  assert.equal(review.startLabel, 'Start review, propose a verdict')
  assert.match(review.publicEffect.text, /only the approve or request-changes you submit/)
  assert.doesNotMatch(review.publicEffect.text, /comment/)
  assert.ok(review.steps.some(step => /You submit or discard it here; nothing is posted before that/.test(step.text)))
  const merge = reviewWindowCopy({ mode: 'review_merge', posting: true, verdict: true, count: 2 })
  assert.equal(merge.startLabel, 'Start review, merge after your approval')
  assert.ok(merge.steps.some(step => /Only after you submit an approval/.test(step.text)))
  assert.match(merge.publicEffect.text, /per PR you submit.*then the merge of each PR/)
  // The verdict needs posting; without it the window stays private.
  assert.equal(reviewWindowCopy({ mode: 'review', verdict: true }).publicEffect.tone, 'private')
})

test('verdict words name the action, the merge consequence and settled outcomes', () => {
  const approve = verdictCopy({ event: 'APPROVE', state: 'proposed' }, 'review_merge')
  assert.equal(approve.submit, 'Approve on GitHub')
  assert.match(approve.status, /Nothing is on GitHub yet/)
  assert.match(approve.note, /merges the PR only if all required checks pass/)
  const changes = verdictCopy({ event: 'REQUEST_CHANGES', state: 'proposed' }, 'review_merge')
  assert.equal(changes.submit, 'Request changes on GitHub')
  assert.doesNotMatch(changes.note, /merge/)
  assert.match(verdictCopy({ event: 'APPROVE', state: 'discarded' }, 'review_merge').status, /Nothing was posted or merged/)
  assert.match(verdictCopy({ event: 'APPROVE', state: 'unknown' }, 'review').status, /nothing will be sent again/)
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
  assert.equal(mergeWhenSafeBlocker({ drafts: true, mayMergeAll: true }), 'Not available for drafts.')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: false }), 'Needs merge rights on this repository.')
  // Only a Möbius that cannot post and merge in one run keeps them apart.
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: true, postingBlocks: true }), 'Posting and merging together needs a newer Möbius.')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: true }), '')
})

test('the switch hints say per PR for a batch and stay singular for one PR', () => {
  assert.match(reviewSwitchHints(1).posting, /^One comment from your account, only for a verdict the agent is sure about\./)
  assert.match(reviewSwitchHints(1).merge, /Merges or queues the PR after/)
  assert.match(reviewSwitchHints(2).posting, /^Up to one comment per PR from your account/)
  assert.match(reviewSwitchHints(2).merge, /Merges or queues each PR after/)
  assert.match(reviewSwitchHints(1).verdict, /You submit or discard it here\. On your own PR it comments instead\./)
  assert.match(reviewSwitchHints(2).verdict, /for each PR/)
})
