import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeResult } from '../respond-result.js'
import { frontendModules, renderModule } from './render-harness.mjs'
import { standingFor } from '../pr-standing.js'

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
  return (await renderer).render(name, withStanding(name, props))
}

// The PR list hands every Review tab the PR machine's decision for its PR. The harness
// does the same from the props a test gives (its status, whose PR, ignore notes).
function withStanding(name, props) {
  if (!['ReviewTab', 'PullRequestDetail'].includes(name) || props.standing || props.review?.standing) return props
  const own = name === 'ReviewTab' ? props.own : props.review?.own
  const ignored = name === 'ReviewTab' ? props.ignored : props.review?.ignored
  const live = { ...props.pr, state: props.readOnly ? 'CLOSED' : 'OPEN', author: { login: own ? 'me' : 'sam' }, mergeable: 'MERGEABLE',
    repository: { ...props.pr.repository, viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null,
    reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }
  const standing = standingFor({ pr: live, login: 'me', runs: props.status ? [{ ...props.status.run, items: [props.status.item] }] : [], ignored })
  return name === 'ReviewTab' ? { ...props, standing } : { ...props, review: { ...props.review, standing } }
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
  assert.match(html, /Open chat/)
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
  assert.match(html, /Review again/)
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
  assert.match(await render(t, 'ReviewTab', { pr, status: unconfirmed, onCheck: () => {}, onVerdict: () => {} }), />Discard</, 'with the owner decision handler it can be discarded')
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
  assert.match(halted, /Review again/)
})

test('the PR page carries a fourth Review tab with its state, and opens on it when asked', async t => {
  const plain = await render(t, 'PullRequestDetail', { pr, status: null, cacheStore: { entries: {} } })
  if (!plain) return
  assert.match(plain, />Review<\/button>/)
  const running = await render(t, 'PullRequestDetail', { pr, status: status('reviewing'), initialTab: 'review', cacheStore: { entries: {} }, review: { onStop: () => {} } })
  assert.match(running, /aria-pressed="true">Review<span class="co-arc"/)
  assert.match(running, /Reviewing/)
  const done = { state: 'complete', execution_state: 'completed' }
  const ownClear = await render(t, 'PullRequestDetail', { pr, status: status('all_clear', {}, done), cacheStore: { entries: {} }, review: { own: true } })
  assert.match(ownClear, /Review<span class="co-tab-dot is-success"/, 'your clear check is simply green')
  const theirClear = await render(t, 'PullRequestDetail', { pr, status: status('all_clear', {}, done), cacheStore: { entries: {} } })
  assert.match(theirClear, /Review<span class="co-tab-dot is-waiting"/, 'a clear review of their PR waits for your verdict')
})

test('a PR that changed after its review says so, shows the old findings and offers to review this version', async t => {
  const earlier = status('all_clear', { head_sha: 'b'.repeat(40), summary: 'No blockers at the old commit.' }, { state: 'complete', execution_state: 'completed' })
  const html = await render(t, 'ReviewTab', { pr, status: null, earlier, onStart: () => {} })
  if (!html) return
  assert.match(html, /Checked bbbbbbb/)
  assert.match(html, /before aaaaaaa/)
  assert.match(html, /Nobody answered them/)
  assert.match(html, /No blockers at the old commit/)
  assert.match(html, /<button type="button" class="co-btn">Review aaaaaaa<\/button>/, 'a secondary button naming the version it would review, so the page keeps one filled button')
  assert.doesNotMatch(html, /co-btn-primary/)
  assert.doesNotMatch(html, /You haven’t made a review/, 'an earlier review exists, so it was reviewed')
  const closed = await render(t, 'ReviewTab', { pr, status: null, earlier, readOnly: true })
  assert.doesNotMatch(closed, />Review again</)
})

test('a review whose request-changes verdict is posted reads as handed to the author, not as waiting on you', async t => {
  const posted = status('needs_you', { summary: 'P1 problem', verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' } }, { state: 'complete', execution_state: 'completed' })
  const html = await render(t, 'ReviewTab', { pr, status: posted, onVerdict: () => {} })
  if (!html) return
  assert.match(html, /<h4>Changes requested<\/h4>/)
  assert.doesNotMatch(html, /Answer in chat|is-verdict|data-frame="verdict"/, 'nothing here waits on you')
  assert.match(html, />Ask the reviewer something</, 'the conversation stays one button away, as a button')
  // The run page says the same: a finding is not a question for the conversation.
  const answering = status('needs_you', {}, { state: 'running', execution_state: 'awaiting_owner' })
  const asked = await render(t, 'ReviewTab', { pr, status: answering })
  assert.match(asked, /Answer in chat/, 'a conversation that asked something still needs the answer')
})

test('a finished review that found problems offers what to do about them, never "answer" or "stop"', async t => {
  const found = status('needs_you', { summary: 'Three problems in the lost-reply path.', public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/9#issuecomment-1' } }, { state: 'needs_you', execution_state: 'completed', can_stop: true })
  const own = await render(t, 'ReviewTab', { pr, status: found, own: true, onStart: () => {}, onFix: () => {}, onIgnore: () => {} })
  if (!own) return
  assert.match(own, /<h4>Your check found problems<\/h4>/)
  for (const label of ['Fix these findings', 'Ignore…', 'Review again', 'Ask the reviewer something']) assert.match(own, new RegExp(`>${label}<`), label)
  assert.doesNotMatch(own, /Answer in chat|Stop review/)
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

// ---- an agent that waits on you is answered here, whatever kind of job it is
const asking = (itemState, run = {}) => status(itemState, {}, { state: 'running', execution_state: 'awaiting_owner', ...run })

test('a review that asked you something says "Waiting for your answer" with Answer in chat, whatever it was doing', async t => {
  for (const itemState of ['reviewing', 'repairing', 'pushing', 'needs_you']) {
    const html = await render(t, 'ReviewTab', { pr, status: asking(itemState), onStop: () => {} })
    if (!html) return
    assert.match(html, /<h4>Waiting for your answer<\/h4>/, itemState)
    assert.match(html, /co-btn co-btn-primary">Answer in chat</, itemState)
    assert.match(html, />Stop review</, `${itemState}: a question can still be stopped`)
    assert.doesNotMatch(html, /Ask the reviewer something|<h4>Reviewing<\/h4>|<h4>Needs you<\/h4>/, itemState)
  }
  for (const mode of ['review_merge', 'review_fix_merge']) {
    assert.match(await render(t, 'ReviewTab', { pr, status: asking('reviewing', { mode }) }), /Answer in chat/, mode)
  }
})

test('a step whose outcome GitHub has not confirmed keeps saying so while a question also waits', async t => {
  const html = await render(t, 'ReviewTab', { pr, status: asking('merge_unknown') })
  if (!html) return
  assert.match(html, /<h4>Outcome needs checking<\/h4>/, 'the unconfirmed outcome is the more urgent thing to read')
  assert.match(html, /Answer in chat/)
})

test('a review that works, stopped or is settled reads as before, even if its conversation once asked', async t => {
  const working = await render(t, 'ReviewTab', { pr, status: status('reviewing') })
  if (!working) return
  assert.match(working, /<h4>Reviewing<\/h4>/)
  assert.match(working, />Open chat</)
  assert.doesNotMatch(working, /Waiting for your answer|Answer in chat/)
  const stopped = await render(t, 'ReviewTab', { pr, status: status('reviewing', {}, { state: 'reviewing', execution_state: 'interrupted' }), onRetry: () => {} })
  assert.match(stopped, /<h4>Not finished<\/h4>/)
  assert.doesNotMatch(stopped, /Waiting for your answer|Answer in chat/)
  const clear = await render(t, 'ReviewTab', { pr, status: status('all_clear', {}, { state: 'complete', execution_state: 'awaiting_owner' }) })
  assert.match(clear, /<h4>Review clear<\/h4>/, 'a settled review has nothing left to answer')
  assert.doesNotMatch(clear, /Waiting for your answer/)
})

// ---- a Respond-to-feedback conversation is no review run: the Review tab still has to say what the agent is doing
const livePr = { ...pr, state: 'OPEN', author: { login: 'me' }, mergeable: 'MERGEABLE', repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }
const respondChat = (state, extra = {}) => ({ repo: 'team/repo', number: 9, state, chat_id: 'respond-chat-1', ...extra })
const respondProps = (state, extra = {}) => {
  const chat = respondChat(state)
  const runs = extra.status ? [{ ...extra.status.run, items: [extra.status.item] }] : []
  return { pr, status: null, own: true, respondChat: chat, standing: standingFor({ pr: livePr, login: 'me', runs, chats: [chat] }), ...extra }
}

test('a Respond conversation that waits on you has its own box with Answer in chat, never "No review yet"', async t => {
  const html = await render(t, 'ReviewTab', respondProps('needs_answer'))
  if (!html) return
  assert.match(html, /<h4>Waiting for your answer<\/h4>/)
  assert.match(html, /Respond to feedback on #9/)
  assert.match(html, /co-btn co-btn-primary">Answer in chat</)
  assert.match(html, /data-frame="verdict"/, 'the same amber frame the Desk gives this state')
  assert.doesNotMatch(html, /No review yet|Use Agent above/, 'the Agent menu is off while an agent holds the PR, so this would be false')
})

test('a Respond conversation at work says so and offers its conversation', async t => {
  const html = await render(t, 'ReviewTab', respondProps('running'))
  if (!html) return
  assert.match(html, /<h4>Working on feedback<\/h4>/)
  assert.match(html, /co-btn co-btn-primary">Open chat</)
  assert.match(html, /data-frame="reviewing"/)
  assert.doesNotMatch(html, /No review yet|Answer in chat/)
})

test('an older saved review stays below the Respond box, and an earlier-version review does too', async t => {
  const older = status('all_clear', {}, { state: 'complete', execution_state: 'completed' })
  const html = await render(t, 'ReviewTab', respondProps('needs_answer', { status: older }))
  if (!html) return
  assert.ok(html.indexOf('Waiting for your answer') > -1 && html.indexOf('Waiting for your answer') < html.indexOf('Review clear'), 'the live job comes first')
  assert.equal((html.match(/data-frame="verdict"/g) || []).length, 1, 'one box asks for you; the finished review below it stays plain')
  const earlier = { run: { id: 'r0', created_at: '2026-11-01T10:00:00Z', chat_id: 'old-chat' }, item: { repo: 'team/repo', number: 9, head_sha: 'c'.repeat(40), base_ref: 'main', summary: 'No blockers at the old commit.' } }
  const withEarlier = await render(t, 'ReviewTab', respondProps('needs_answer', { earlier }))
  assert.ok(withEarlier.indexOf('Waiting for your answer') < withEarlier.indexOf('Checked ccccccc'))
})

test('the Respond box appears only while that conversation holds the PR', async t => {
  // No conversation: nothing changes.
  const none = await render(t, 'ReviewTab', { pr, status: null })
  if (!none) return
  assert.match(none, /No review yet/)
  // A conversation that is not on this PR never reaches the tab (the PR list only hands over its own).
  const elsewhere = await render(t, 'ReviewTab', { pr, status: null, respondChat: null })
  assert.match(elsewhere, /No review yet/)
  // A live review run holds the PR before a Respond conversation does: the run's box shows, not a second job.
  const running = status('reviewing')
  const chat = respondChat('needs_answer')
  const standing = standingFor({ pr: livePr, login: 'me', runs: [{ ...running.run, items: [running.item] }], chats: [chat] })
  const html = await render(t, 'ReviewTab', { pr, status: running, own: true, respondChat: chat, standing })
  assert.match(html, /<h4>Reviewing<\/h4>/)
  assert.doesNotMatch(html, /Working on feedback|Waiting for your answer/)
})

test('a fix waiting for Push is the one decision on the card, naming its commit on top of the PR version', async t => {
  const repair = { id: 'a1', state: 'proposed', head_sha: 'e'.repeat(40), from_sha: 'a'.repeat(40), files: ['api.js'], summary: 'Fixed two findings.' }
  const html = await render(t, 'ReviewTab', { pr, own: true, status: status('needs_you', { repair_attempts: [repair], summary: 'A repair is ready for you.' }, { state: 'needs_you', execution_state: 'completed', mode: 'review_fix_merge' }),
    onRepair: () => {}, onFix: () => {}, onIgnore: () => {}, onStart: () => {} })
  if (!html) return
  assert.match(html, /<h4>A fix is ready to push<\/h4>/)
  assert.match(html, /Pushes commit <code>eeeeeee<\/code> on top of <code>aaaaaaa<\/code>/)
  assert.match(html, /Push fix/)
  assert.match(html, /Don’t push/)
  for (const gone of ['Fix these findings', 'Ignore…', 'Review again', 'A repair is ready for you']) assert.doesNotMatch(html, new RegExp(gone), gone)
})

test('your PR’s Review tab starts with where it is in its cycle', async t => {
  const repair = { id: 'a1', state: 'proposed', head_sha: 'e'.repeat(40), from_sha: 'a'.repeat(40), files: [] }
  const html = await render(t, 'ReviewTab', { pr, own: true, status: status('needs_you', { repair_attempts: [repair] }, { state: 'needs_you', execution_state: 'completed', mode: 'review_fix_merge' }), onRepair: () => {} })
  if (!html) return
  assert.match(html, /<li class="is-current" aria-current="step">Fix ready: push\?<\/li>/)
  assert.ok(html.indexOf('co-review-steps') < html.indexOf('A fix is ready to push'), 'the strip comes first')
})

test('an earlier check shows Answered only when the answer above took its findings on', async t => {
  const HEAD = 'e'.repeat(40)
  const earlier = { run: { id: 'r0', created_at: '2026-11-06T08:00:00Z', mode: 'review_fix_merge', chat_id: 'old' }, item: { repo: 'team/repo', number: 9, head_sha: HEAD, base_ref: 'main', summary: 'Found things.' } }
  const example = JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
  const view = reviewer => ({ status: 'posted', slug: 's', decision: null, result: normalizeResult({ ...example, state: 'posted', pr: { ...example.pr, head_sha: HEAD }, points: [{ ...example.points[0], reviewer }] }) })
  const shown = async reviewer => (await render(t, 'ReviewTab', { pr, own: true, status: null, earlier, response: view(reviewer) }))
  const yes = await shown('Agent review'); if (!yes) return
  assert.match(yes, /Answered/); assert.match(yes, /Finish it for me ·/)
  assert.doesNotMatch(await shown('alex'), /Answered/)
})
