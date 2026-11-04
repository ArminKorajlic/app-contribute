import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeWhenSafeBlocker, reviewSwitchHints, reviewWindowCopy, verdictCopy } from '../review-copy.js'

test('a plain private review says nothing reaches GitHub and starts privately', () => {
  const copy = reviewWindowCopy({ mode: 'review', bindCurrentTarget: true })
  assert.equal(copy.title, 'Review')
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
  assert.equal(review.startLabel, 'Start review, draft a verdict for me')
  assert.match(review.publicEffect.text, /only the verdict you send, from your account/)
  assert.ok(review.steps.some(step => /You send it, change it to a comment, or throw it away; nothing is posted before that/.test(step.text)))
  const merge = reviewWindowCopy({ mode: 'review_merge', posting: true, verdict: true, count: 2 })
  assert.equal(merge.startLabel, 'Start review, merge after your approval')
  assert.ok(merge.steps.some(step => /Only after you submit an approval/.test(step.text)))
  assert.match(merge.publicEffect.text, /per PR you send.*then the merge of each PR/)
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

test('finish it and take over stop for your approval before every push, and never merge or ready a draft', () => {
  const finish = reviewWindowCopy({ mode: 'review_fix_merge', intent: 'finish_it', count: 2 })
  assert.equal(finish.title, 'Finish it for me')
  assert.equal(finish.startLabel, 'Start, ask me before each push')
  const steps = finish.steps.map(step => step.text).join(' ')
  assert.match(steps, /a second agent reviews every fix/)
  assert.match(steps, /Each push waits for your approval/)
  assert.match(steps, /You merge each PR yourself/)
  assert.doesNotMatch(steps, /marks the draft ready|it merges/)
  assert.match(finish.publicEffect.text, /only the fixes you approve, pushed to these PRs\. It never merges and never changes a draft\./)
  assert.match(finish.footnote, /You can stop it at any time/)
  const takeOver = reviewWindowCopy({ mode: 'review_fix_merge', intent: 'take_over' })
  assert.equal(takeOver.title, 'Take over')
  assert.match(takeOver.steps[0].text, /Your reason is posted on the PR/)
  assert.match(takeOver.publicEffect.text, /^your reason as a comment/)
})

test('an agent posts its verdict only when you chose it, and never together with merging', () => {
  const agent = reviewWindowCopy({ mode: 'review', intent: 'review', posting: true, verdict: true, agentPosts: true })
  assert.equal(agent.startLabel, 'Start review, agent posts its verdict')
  assert.match(agent.publicEffect.text, /posted by the agent from your account as you allowed/)
  const merging = reviewWindowCopy({ mode: 'review_merge', intent: 'review', posting: true, verdict: true, agentPosts: true })
  assert.equal(merging.startLabel, 'Start review, merge after your approval', 'merging always follows your own approval')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: true, notDrafting: true }), 'Merging follows your own approval: choose “Draft for me”.')
})

test('merge when safe explains why it is unavailable', () => {
  assert.equal(mergeWhenSafeBlocker({ drafts: true, mayMergeAll: true }), 'Not available for drafts.')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: false }), 'Needs merge rights on this repository.')
  // Only a Möbius that cannot post and merge in one run keeps them apart.
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: true, postingBlocks: true }), 'Posting and merging together needs a newer Möbius.')
  assert.equal(mergeWhenSafeBlocker({ drafts: false, mayMergeAll: true }), '')
})

test('the switch hints say per PR for a batch and stay singular for one PR', () => {
  assert.match(reviewSwitchHints(1).merge, /Once you send an approval .* merges or queues the PR\./)
  assert.match(reviewSwitchHints(2).merge, /merges or queues each PR\./)
  assert.deepEqual(Object.keys(reviewSwitchHints(1)), ['merge'])
})

test('each Agent menu job titles its own window', async () => {
  const { reviewWindowCopy } = await import('../review-copy.js')
  assert.equal(reviewWindowCopy({ mode: 'review', intent: 'review' }).title, 'Review')
  assert.equal(reviewWindowCopy({ mode: 'review', intent: 'review' }).publicEffect.tone, 'private')
  // The same window re-writes its steps, notice and button as the switches move.
  const priv = reviewWindowCopy({ mode: 'review', intent: 'review' })
  const github = reviewWindowCopy({ mode: 'review', intent: 'review', posting: true, verdict: true })
  const comment = reviewWindowCopy({ mode: 'review', intent: 'review', posting: true, verdict: false })
  assert.equal(priv.steps.length, 3)
  assert.equal(github.steps.length, 4)
  assert.match(github.steps[2].text, /drafts a verdict/)
  assert.match(comment.steps[2].text, /posts one comment/, 'an older saved comment grant still says what it does')
  assert.equal(github.startLabel, 'Start review, draft a verdict for me')
  assert.equal(comment.startLabel, 'Start review, allow comment')
  const merge = reviewWindowCopy({ mode: 'review_merge', intent: 'review', posting: true, verdict: true })
  assert.equal(merge.title, 'Review', 'merging is a switch inside Review, not its own job')
  assert.equal(merge.steps.length, 5)
  assert.equal(reviewWindowCopy({ mode: 'review', intent: 'check_my_pr' }).title, 'Check my PR')
  assert.equal(reviewWindowCopy({ mode: 'review' }).title, 'Review', 'a saved link or retry without a job')
})
