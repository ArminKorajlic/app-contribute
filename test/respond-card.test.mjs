import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { frontendModules, renderModule } from './render-harness.mjs'
import { normalizeDecision, normalizeResult, responseView } from '../respond-result.js'
import { standingFor } from '../pr-standing.js'
import { NAMES } from '../names.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const TIP = '2'.repeat(40)
const pr = { number: 7, title: 'Add the thing', headRefOid: HEAD, baseRefOid: 'c'.repeat(40), baseRefName: 'main', url: 'https://github.com/owner/repo/pull/7', repository: { nameWithOwner: 'owner/repo' } }
const livePr = { ...pr, state: 'OPEN', author: { login: 'me' }, mergeable: 'MERGEABLE', repository: { nameWithOwner: 'owner/repo', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'alex', __typename: 'User' }, commit: { oid: HEAD } }] }, reviewDecision: 'CHANGES_REQUESTED',
  viewerLatestReview: null, reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }

let renderer
async function render(t, name, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ReviewTab } from './ui/ReviewTab.jsx'
    import { ResponseCard } from './ui/ResponseCard.jsx'
    const components = { ReviewTab, ResponseCard }
    export function render(name, props) { return renderToStaticMarkup(React.createElement(components[name], props)) }
  `)
  return (await renderer).render(name, props)
}
const approval = decision => normalizeDecision({ version: 1, result_id: example().id, digest: example().digest, decision, at: '2026-11-06T09:30:00Z' })
const response = (state = 'ready', patch = {}, decision = null, prPatch = {}) => {
  const entry = { slug: 'owner__repo__7', result: normalizeResult({ ...example(), state, ...patch }), decision }
  return responseView([entry], { ...pr, ...prPatch })
}
const card = (t, view, props = {}) => render(t, 'ResponseCard', { pr: { ...pr, ...(props.prPatch || {}) }, response: view, onPost() {}, onDiscard() {}, onRespondAgain() {}, ...props })
const texts = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const buttons = html => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(match => texts(match[1])).filter(Boolean)
// The steps once Post has started: each one's state and its words, including what a screen reader hears.
const steps = html => [...html.matchAll(/<li class="is-(done|todo)">(.*?)<\/li>/gs)].map(([, state, inner]) => [state, texts(inner)])

test('a ready answer shows each point and how it ended, the replies word for word, the changes and the tests', async t => {
  const html = await card(t, response())
  if (!html) return
  const text = texts(html)
  assert.match(text, /Replies ready/)
  assert.match(text, /4 points answered · built on bbbbbbb/)
  assert.match(text, /The PR has not changed since this answer/)
  for (const point of example().points) assert.ok(text.includes(point.title), point.title)
  assert.equal((html.match(/data-ending="fixed"/g) || []).length, 2)
  assert.match(html, /data-ending="not_valid"/)
  assert.match(html, /data-ending="out_of_scope"/)
  assert.match(text, /Fixed.*Not valid.*Out of scope/)
  assert.ok(text.includes('@alex both findings were real and are fixed in new commits on this branch.'), 'the reply, word for word')
  assert.ok(text.includes('the helper keeps its name (it matches its sibling files).'))
  assert.match(text, /Adds one shared write path\./, 'the new description')
  assert.match(text, /Public writes: a lost answer is unresolved/)
  assert.match(text, /Sync reads the live state again/)
  assert.match(text, /write\.js/)
  assert.match(text, /803 pass, 0 fail \(node\)/)
})

test('the card says in order what Post will do, and offers Post, Reply in chat and Discard', async t => {
  const html = await card(t, response())
  if (!html) return
  assert.match(texts(html), /What Post will do, in this order\s+Push 2 commits to the PR’s branch, on top of bbbbbbb\s+Post 2 replies, as you\s+Update the description\s+Ask alex to review again/)
  assert.deepEqual(buttons(html).filter(label => [NAMES.postAnswer, NAMES.replyInChat, NAMES.discard].includes(label)), [NAMES.postAnswer, NAMES.replyInChat, NAMES.discard])
  assert.match(html, new RegExp(`<button type="button" class="co-btn co-btn-primary">${NAMES.postAnswer}</button>`))
})

test('Post stays off, with the reason in words, while the chat works or waits on a card of its own', async t => {
  const working = await card(t, response(), { chat: { state: 'running', chat_id: 'respond-chat-1' } })
  if (!working) return
  assert.match(working, new RegExp(`<button type="button" class="co-btn co-btn-primary" disabled="">${NAMES.postAnswer}</button>`))
  assert.match(texts(working), /The agent is working on this PR right now/)
  const waiting = await card(t, response(), { chat: { state: 'needs_answer', chat_id: 'respond-chat-1' } })
  assert.match(waiting, new RegExp(`disabled="">${NAMES.postAnswer}<`))
  assert.match(texts(waiting), /waiting for your answer to its own card\. Answer it in the chat first/)
  assert.match(waiting, new RegExp(`>${NAMES.replyInChat}<`), 'the way to that card')
  assert.doesNotMatch(waiting, /data-frame="verdict"/, 'the chat’s own box asks for you; this one waits behind it')
  assert.match(await card(t, response()), /data-frame="verdict"/, 'on its own it is the box that asks for you')
  const busy = await card(t, response(), { busy: true })
  assert.match(busy, /disabled="">(Post|Working…)</)
})

test('a closed PR shows the answer but offers nothing to do with it', async t => {
  const html = await card(t, response(), { readOnly: true })
  if (!html) return
  assert.match(texts(html), /Replies ready/)
  assert.deepEqual(buttons(html).filter(label => [NAMES.postAnswer, NAMES.discard, NAMES.replyInChat].includes(label)), [])
})

test('an answer the PR has moved past is out of date: nothing to Post, a second pass or Discard instead', async t => {
  const html = await card(t, response('ready', {}, null, { headRefOid: 'c'.repeat(40) }), { prPatch: { headRefOid: 'c'.repeat(40) } })
  if (!html) return
  assert.match(texts(html), /Out of date/)
  assert.match(texts(html), /The PR changed after this answer \(bbbbbbb → ccccccc\)\. Nothing was posted\./)
  const labels = buttons(html)
  assert.equal(labels.includes(NAMES.postAnswer), false)
  assert.ok(labels.includes(NAMES.respondAgain) && labels.includes(NAMES.discard))
})

test('an approved answer waits for the chat to start, and can be sent again', async t => {
  const html = await card(t, response('ready', {}, approval('approved')))
  if (!html) return
  assert.match(texts(html), /Approved\. Waiting for the chat to post it/)
  assert.deepEqual(buttons(html).filter(label => [NAMES.postAnswer, NAMES.sendAgain, NAMES.openChat, NAMES.discard].includes(label)), [NAMES.sendAgain, NAMES.openChat])
})

test('while posting the card shows the steps and which are done, and nothing to press but the chat', async t => {
  const receipts = { push: { sha: TIP, at: '2026-11-06T09:31:00Z' }, replies: [{ index: 0, url: 'https://example.test/c/1', at: '2026-11-06T09:31:05Z' }], description: null, rerequest: null }
  const html = await card(t, response('posting', { receipts }, approval('approved'), { headRefOid: TIP }), { prPatch: { headRefOid: TIP } })
  if (!html) return
  assert.match(texts(html), /Posting/)
  assert.deepEqual(steps(html), [
    ['done', 'Push 2 commits to the PR’s branch, on top of bbbbbbb — done'],
    ['todo', 'Post 2 replies, as you — not done yet'], // one of the two replies is out
    ['todo', 'Update the description — not done yet'],
    ['todo', 'Ask alex to review again — not done yet'],
  ])
  assert.deepEqual(buttons(html).filter(label => [NAMES.postAnswer, NAMES.discard, NAMES.openChat].includes(label)), [NAMES.openChat])
})

test('a post that stopped part-way says where, keeps what went out, and can be tried again', async t => {
  const receipts = { push: { sha: TIP, at: '2026-11-06T09:31:00Z' }, replies: [], description: null, rerequest: null }
  const html = await card(t, response('failed', { receipts, error: { step: 'replies', message: 'GitHub refused the comment.' } }, approval('approved'), { headRefOid: TIP }), { prPatch: { headRefOid: TIP } })
  if (!html) return
  assert.match(texts(html), /Posting stopped/)
  assert.match(texts(html), /Stopped at replies: GitHub refused the comment\. The ticked steps went out and a second try skips them\. The step it stopped at may or may not have reached GitHub/)
  assert.doesNotMatch(texts(html), /\.\./, 'a message that already ends in a full stop gets no second one')
  assert.deepEqual(steps(html).map(([state]) => state), ['done', 'todo', 'todo', 'todo'], 'only the push went out')
  assert.deepEqual(buttons(html).filter(label => [NAMES.postAnswer, NAMES.tryAgain, NAMES.openChat, NAMES.discard].includes(label)), [NAMES.tryAgain, NAMES.openChat])
})

test('a posted answer is a quiet summary with links to what went out', async t => {
  const receipts = { push: { sha: TIP, at: '2026-11-06T09:31:00Z' }, replies: [{ index: 0, url: 'https://example.test/c/1', at: 'x' }, { index: 1, url: 'https://example.test/c/2', at: 'x' }], description: { at: 'x' }, rerequest: { at: 'x', reviewers: ['alex'] } }
  const html = await card(t, response('posted', { receipts }, approval('approved'), { headRefOid: TIP }), { prPatch: { headRefOid: TIP } })
  if (!html) return
  assert.match(texts(html), /Posted/)
  assert.match(html, /href="https:\/\/example\.test\/c\/1"/)
  assert.match(html, /href="https:\/\/example\.test\/c\/2"/)
  assert.deepEqual(steps(html).map(([state]) => state), ['done', 'done', 'done', 'done'], 'everything went out')
  assert.deepEqual(buttons(html).filter(label => [NAMES.postAnswer, NAMES.discard, NAMES.sendAgain].includes(label)), [])
  assert.doesNotMatch(html, /data-frame="verdict"/, 'nothing is waiting on you any more')
})

test('an error from Post is shown as an alert on the card', async t => {
  const html = await card(t, response(), { error: 'The PR changed after this answer was written.' })
  if (!html) return
  assert.match(html, /role="alert"[^>]*>The PR changed after this answer was written\.</)
})

// ---- in the Review tab
const standingWith = (view, extra = {}) => standingFor({ pr: { ...livePr, ...extra }, login: 'me', responses: view ? [{ slug: 'owner__repo__7', result: view.result, decision: view.decision }] : [] })

test('the Review tab puts the answer first, then the live conversation, then an older review, and never says "No review yet" over them', async t => {
  const view = response()
  const html = await render(t, 'ReviewTab', { pr, status: null, own: true, standing: standingWith(view), response: view, onPostResponse() {}, onDiscardResponse() {} })
  if (!html) return
  assert.match(texts(html), /Replies ready/)
  assert.doesNotMatch(html, /No review yet|Use Agent above/)
  assert.match(html, /data-frame="verdict"/, 'the Desk’s amber frame for a draft to send')
  const older = { run: { id: 'r1', state: 'complete', execution_state: 'completed', mode: 'review', chat_id: 'chat-1', created_at: new Date().toISOString() }, item: { repo: 'owner/repo', number: 7, head_sha: HEAD, base_ref: 'main', state: 'all_clear' } }
  const stacked = await render(t, 'ReviewTab', { pr, status: older, own: true, standing: standingWith(view), response: view, onPostResponse() {}, onDiscardResponse() {} })
  assert.ok(stacked.indexOf('Replies ready') > -1 && stacked.indexOf('Replies ready') < stacked.indexOf('Review clear'), 'the answer comes first')
  assert.equal((stacked.match(/data-frame="verdict"/g) || []).length, 1, 'one box asks for you; the finished review stays plain')
})

test('with no saved answer the Review tab is exactly what it was', async t => {
  const html = await render(t, 'ReviewTab', { pr, status: null, own: true, standing: standingWith(null), response: null })
  if (!html) return
  assert.match(html, /No review yet/)
  assert.doesNotMatch(html, /Replies ready|co-response/)
})

test('a running conversation shows its own box above a card that cannot be posted until it finishes', async t => {
  const view = response()
  const chat = { repo: 'owner/repo', number: 7, state: 'running', chat_id: 'respond-chat-1' }
  const standing = standingFor({ pr: livePr, login: 'me', chats: [chat], responses: [{ slug: 'owner__repo__7', result: view.result, decision: view.decision }] })
  const html = await render(t, 'ReviewTab', { pr, status: null, own: true, standing, respondChat: chat, response: view, onPostResponse() {} })
  if (!html) return
  assert.ok(html.indexOf('Working on feedback') > -1 && html.indexOf('Working on feedback') < html.indexOf('Replies ready'))
  assert.match(html, new RegExp(`disabled="">${NAMES.postAnswer}<`))
})
