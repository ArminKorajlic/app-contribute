import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function render(t, name, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ReviewTab } from './ui/ReviewTab.jsx'
    import { PullRequestDetail } from './ui/PullRequestDetail.jsx'
    const components = { ReviewTab, PullRequestDetail }
    export function render(name, props) { return renderToStaticMarkup(React.createElement(components[name], props)) }
  `)
  return (await renderer).render(name, props)
}
const pr = { number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main', url: 'https://github.com/team/repo/pull/9' }
const status = (state, item = {}, run = {}) => ({ run: { id: 'r1', state: 'running', execution_state: 'running', mode: 'review', chat_id: 'chat-1', can_stop: true, created_at: new Date().toISOString(), ...run }, item: { repo: 'team/repo', number: 9, head_sha: 'a'.repeat(40), base_ref: 'main', state, ...item } })

test('a PR nobody reviewed still has its Review tab and says so, without start buttons', async t => {
  const html = await render(t, 'ReviewTab', { pr, status: null, onStart: () => {} })
  if (!html) return
  assert.match(html, /No review yet/)
  assert.match(html, /You haven’t made a review for this PR/)
  assert.match(html, /Use Agent above to start one/)
  // The Agent button above starts a review; the empty tab adds no second set of buttons.
  assert.doesNotMatch(html, /<button/)
  const closed = await render(t, 'ReviewTab', { pr, status: null, readOnly: true })
  assert.doesNotMatch(closed, /Use Agent above/, 'a closed PR offers no review')
})

test('a running review shows a smooth spinner, the clock, the version and Stop inside the comet frame', async t => {
  const html = await render(t, 'ReviewTab', { pr, status: status('reviewing'), onStop: () => {} })
  if (!html) return
  assert.match(html, /co-arc/)
  assert.match(html, /<h4>Reviewing<\/h4>/)
  assert.match(html, /co-review-elapsed/)
  assert.match(html, /aaaaaaa → main/)
  assert.match(html, /Stop review/)
  assert.match(html, /Open review conversation/)
  assert.match(html, /data-frame="reviewing"/)
})

test('a review whose own turn ended while a helper works still offers Stop', async t => {
  const html = await render(t, 'ReviewTab', { pr, status: status('reviewing', {}, { execution_state: 'completed' }), onStop: () => {} })
  if (!html) return
  assert.match(html, /<h4>Reviewing<\/h4>/)
  assert.match(html, /Stop review/)
})

test('a run nothing is working on says so and offers to start again instead of "Reviewing"', async t => {
  const summary = 'Nothing is working on this review any more: its reviewer stopped before it reported.'
  const html = await render(t, 'ReviewTab', { pr, status: status('reviewing', {}, { state: 'needs_you', execution_state: 'interrupted', summary }), onRetry: () => {}, onStop: () => {} })
  if (!html) return
  assert.match(html, /Not finished/)
  assert.doesNotMatch(html, /<h4>Reviewing<\/h4>/)
  assert.match(html, /Nothing is working on this review any more/)
  assert.match(html, /Start again/)
  assert.doesNotMatch(html, /Stop review/, 'a halted run has nothing left to stop')
})

test('a verdict GitHub never confirmed offers a read-only check on the card itself, not just the conversation', async t => {
  const unconfirmed = status('verdict_unknown', { summary: 'Changes needed.', verdict_proposal: { id: 'p1', state: 'unknown', event: 'REQUEST_CHANGES', body: 'Fix it.' } }, { state: 'needs_you', execution_state: 'completed' })
  const html = await render(t, 'ReviewTab', { pr, status: unconfirmed, onCheck: () => {} })
  if (!html) return
  assert.match(html, /Verdict outcome needs checking/)
  assert.match(html, /Check GitHub now/)
  assert.doesNotMatch(html, />Dismiss</, 'dismissing needs the owner decision handler')
  assert.match(html, /nothing will be sent again/)
  assert.match(html, /an hour after you submitted, it is dropped/)
  assert.doesNotMatch(html, /Request changes on GitHub|>Discard</, 'an unconfirmed verdict is never offered for sending again')
  assert.match(await render(t, 'ReviewTab', { pr, status: unconfirmed, onCheck: () => {}, onVerdict: () => {} }), />Dismiss</, 'with the owner decision handler it can be dismissed')
  assert.doesNotMatch(await render(t, 'ReviewTab', { pr, status: unconfirmed }), /Check GitHub now/, 'no handler, no button')
  const posted = status('verdict_pending', { verdict_proposal: { id: 'p1', state: 'posted', event: 'REQUEST_CHANGES', url: 'https://github.com/team/repo/pull/9#pullrequestreview-5' } })
  assert.doesNotMatch(await render(t, 'ReviewTab', { pr, status: posted, onCheck: () => {} }), /Check GitHub now/)
})

test('a verdict waiting for you offers Submit; on your own PR GitHub refuses it, so only Discard remains', async t => {
  const proposal = { id: 'p1', state: 'proposed', event: 'APPROVE', body: 'Looks right.' }
  const waiting = status('verdict_pending', { summary: 'No blockers.', verdict_proposal: proposal })
  const others = await render(t, 'ReviewTab', { pr, status: waiting, onVerdict: () => {} })
  if (!others) return
  assert.match(others, /Verdict waiting for you/)
  assert.match(others, /Approve on GitHub/)
  assert.match(others, /data-frame="verdict"/)
  const own = await render(t, 'ReviewTab', { pr, status: waiting, own: true, onVerdict: () => {} })
  assert.doesNotMatch(own, /Approve on GitHub/)
  assert.match(own, /This is your own PR, so it cannot be approved or sent back to yourself/)
  assert.match(own, />Discard</)
})

test('a clear review is green with its copyable id; blockers and halted runs read as changes', async t => {
  const clear = await render(t, 'ReviewTab', { pr, status: status('all_clear', { summary: 'No blocking problems.', verdict_proposal: { state: 'posted', event: 'APPROVE', review_id: 5681065396, url: 'https://github.com/team/repo/pull/9#pullrequestreview-5681065396' } }, { state: 'complete', execution_state: 'completed' }) })
  if (!clear) return
  assert.match(clear, /co-review-box is-clear/)
  assert.match(clear, /Review clear/)
  assert.match(clear, /Copy review id 5681065396/)
  assert.doesNotMatch(clear, /data-frame="reviewing"|data-frame="verdict"/, 'finished work keeps no frame')
  const changes = await render(t, 'ReviewTab', { pr, status: status('needs_you', { summary: 'P1 problem', verdict_proposal: { state: 'discarded', event: 'REQUEST_CHANGES' } }) })
  assert.match(changes, /Changes found/)
  assert.match(changes, /is-changes/)
  const halted = await render(t, 'ReviewTab', { pr, status: status('reviewing', {}, { execution_state: 'stopped' }), onRetry: () => {} })
  assert.match(halted, /Not finished/)
  assert.match(halted, /Start again/)
})

test('the PR page carries a fourth Review tab with its state, and opens on it when asked', async t => {
  const plain = await render(t, 'PullRequestDetail', { pr, status: null, cacheStore: { entries: {} } })
  if (!plain) return
  assert.match(plain, />Review<\/button>/)
  const running = await render(t, 'PullRequestDetail', { pr, status: status('reviewing'), initialTab: 'review', cacheStore: { entries: {} }, review: { onStop: () => {} } })
  assert.match(running, /aria-pressed="true">Review<span class="co-arc"/)
  assert.match(running, /Reviewing/)
  const clear = await render(t, 'PullRequestDetail', { pr, status: status('all_clear', {}, { state: 'complete', execution_state: 'completed' }), cacheStore: { entries: {} } })
  assert.match(clear, /Review<span class="co-tab-dot is-success"/)
})

test('a PR that changed after its review says so, shows the old findings and offers to review this version', async t => {
  const earlier = status('all_clear', { head_sha: 'b'.repeat(40), summary: 'No blockers at the old commit.' }, { state: 'complete', execution_state: 'completed' })
  const html = await render(t, 'ReviewTab', { pr, status: null, earlier, onStart: () => {} })
  if (!html) return
  assert.match(html, /Reviewed an earlier version/)
  assert.match(html, /bbbbbbb/)
  assert.match(html, /may no longer apply/)
  assert.match(html, /No blockers at the old commit/)
  assert.match(html, />Review this version</)
  assert.doesNotMatch(html, /You haven’t made a review/, 'an earlier review exists, so it was reviewed')
  const closed = await render(t, 'ReviewTab', { pr, status: null, earlier, readOnly: true })
  assert.doesNotMatch(closed, />Review this version</)
})

test('a review whose request-changes verdict is posted reads as handed to the author, not as waiting on you', async t => {
  const posted = status('needs_you', { summary: 'P1 problem', verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' } }, { state: 'complete', execution_state: 'completed' })
  const html = await render(t, 'ReviewTab', { pr, status: posted, onVerdict: () => {} })
  if (!html) return
  assert.match(html, /<h4>Changes requested<\/h4>/)
  assert.doesNotMatch(html, /Answer in review conversation|is-verdict|data-frame="verdict"/, 'nothing here waits on you')
  assert.match(html, />Ask the reviewer something</, 'the conversation stays one button away, as a button')
  // The run page says the same: a finding is not a question for the conversation.
  const answering = status('needs_you', {}, { state: 'running', execution_state: 'awaiting_owner' })
  const asked = await render(t, 'ReviewTab', { pr, status: answering })
  assert.match(asked, /Answer in review conversation/, 'a conversation that asked something still needs the answer')
})

test('a finished review that found problems offers what to do about them, never "answer" or "stop"', async t => {
  const found = status('needs_you', { summary: 'Three problems in the lost-reply path.', public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/9#issuecomment-1' } }, { state: 'needs_you', execution_state: 'completed', can_stop: true })
  const own = await render(t, 'ReviewTab', { pr, status: found, own: true, onStart: () => {}, onFix: () => {}, onIgnore: () => {} })
  if (!own) return
  assert.match(own, /<h4>Your check found problems<\/h4>/)
  for (const label of ['Fix these findings', 'Ignore…', 'Review again', 'Ask the reviewer something']) assert.match(own, new RegExp(`>${label}<`), label)
  assert.doesNotMatch(own, /Answer in review conversation|Stop review/)
  assert.match(own, /co-btn co-btn-primary">Fix these findings/, 'the fix is the one next step')
  // Someone else's PR has no fix to offer, and a closed PR offers nothing to start.
  const privateFound = status('needs_you', { summary: 'Three problems in the lost-reply path.' }, { state: 'needs_you', execution_state: 'completed', can_stop: true })
  const others = await render(t, 'ReviewTab', { pr, status: privateFound, own: false, onStart: () => {}, onFix: () => {}, onIgnore: () => {} })
  assert.doesNotMatch(others, /Fix these findings/)
  assert.match(others, />Ignore…</)
  // Once your review is posted on someone else's PR, the move is theirs: only the question stays.
  const handedOver = await render(t, 'ReviewTab', { pr, status: found, own: false, onStart: () => {}, onFix: () => {}, onIgnore: () => {} })
  assert.match(handedOver, /<h4>Review posted<\/h4>/)
  assert.doesNotMatch(handedOver, />Ignore…<|Fix these findings/)
  const closed = await render(t, 'ReviewTab', { pr, status: found, own: true, readOnly: true, onStart: () => {}, onFix: () => {}, onIgnore: () => {} })
  assert.doesNotMatch(closed, /Fix these findings|Ignore…|Review again/)
  assert.match(closed, />Ask the reviewer something</)
  // The tab dot is amber while it waits on you.
  const detail = await render(t, 'PullRequestDetail', { pr, status: found, cacheStore: { entries: {} }, review: { own: true } })
  assert.match(detail, /Review<span class="co-tab-dot is-waiting"/)
})

test('an ignored finding says so for this version, quietly, and can be taken back', async t => {
  const found = status('needs_you', { summary: 'Three problems.' }, { state: 'needs_you', execution_state: 'completed' })
  const ignored = { [`team/repo#9@${'a'.repeat(40)}`]: { reason: 'Not a problem', at: '2026-11-04T10:00:00Z' } }
  const html = await render(t, 'ReviewTab', { pr, status: found, own: true, ignored, onStart: () => {}, onFix: () => {}, onIgnore: () => {}, onUndoIgnore: () => {} })
  if (!html) return
  assert.match(html, /<h4>Ignored<\/h4>/)
  assert.match(html, /Ignored: Not a problem\. Only for this version/)
  assert.match(html, />Undo ignore</)
  assert.doesNotMatch(html, /Fix these findings|data-frame="verdict"/)
  const detail = await render(t, 'PullRequestDetail', { pr, status: found, cacheStore: { entries: {} }, review: { own: true, ignored } })
  assert.doesNotMatch(detail, /co-tab-dot is-waiting/)
})

test('a private finding offers Post to GitHub only when the platform can post it and nothing of it is on GitHub yet', async t => {
  const done = { state: 'needs_you', execution_state: 'completed', can_stop: true }
  const privateFound = status('needs_you', { summary: 'Three problems in the lost-reply path.' }, done)
  const common = { pr, status: privateFound, onStart: () => {}, onFix: () => {}, onIgnore: () => {}, onPost: () => {} }
  const others = await render(t, 'ReviewTab', { ...common, own: false, canPost: true })
  if (!others) return
  assert.match(others, /co-btn co-btn-primary">Post to GitHub</, 'on someone else\'s PR posting is the next step')
  const own = await render(t, 'ReviewTab', { ...common, own: true, canPost: true })
  assert.match(own, /co-btn co-btn-primary">Fix these findings</)
  assert.doesNotMatch(own, /Post to GitHub/, 'on your own PR nothing is posted as a review of yourself')
  assert.doesNotMatch(await render(t, 'ReviewTab', { ...common, own: false, canPost: false }), /Post to GitHub/, 'not until the platform offers it')
  assert.doesNotMatch(await render(t, 'ReviewTab', { ...common, own: false, canPost: true, onPost: undefined }), /Post to GitHub/)
  assert.doesNotMatch(await render(t, 'ReviewTab', { ...common, own: false, canPost: true, readOnly: true }), /Post to GitHub/, 'a closed PR posts nothing')
  const posted = status('needs_you', { summary: 'Three problems.', public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' } }, done)
  const afterwards = await render(t, 'ReviewTab', { ...common, status: posted, own: true, canPost: true })
  assert.doesNotMatch(afterwards, /Post to GitHub/, 'once it is on GitHub there is nothing left to post')
  assert.match(afterwards, /View the posted review on GitHub/)
})
