import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeDecision, normalizeResult, planSteps, POST_COMMAND, postMessage, resultSlug, responseFor, responseOutbox, responseStatus, responseView } from '../respond-result.js'

// The example the Python helper's own tests also pin the digest of: one file, both sides of the contract.
const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const TIP = '2'.repeat(40)
const pull = (extra = {}) => ({ number: 7, headRefOid: HEAD, repository: { nameWithOwner: 'owner/repo' }, ...extra })
const result = (patch = {}) => normalizeResult({ ...example(), ...patch })
const decision = (patch = {}) => normalizeDecision({ version: 1, result_id: 'r-3f9a1c2b04d5', digest: example().digest, decision: 'approved', at: '2026-11-06T09:30:00Z', ...patch })
const entry = (state = 'ready', pairedDecision = null, patch = {}) => ({ slug: 'owner__repo__7', result: result({ state, ...patch }), decision: pairedDecision })

test('the slug is lower case owner__repo__number, the name the helper writes', () => {
  assert.equal(resultSlug('Owner/Repo', 7), 'owner__repo__7')
  assert.equal(resultSlug('mobius-os/app-contribute', 123), 'mobius-os__app-contribute__123')
})

test('the example result is read as written', () => {
  const read = result()
  assert.equal(read.id, 'r-3f9a1c2b04d5')
  assert.equal(read.repo, 'owner/repo')
  assert.equal(read.number, 7)
  assert.equal(read.chat_id, 'respond-chat-1')
  assert.deepEqual(read.points.map(point => point.ending), ['fixed', 'fixed', 'not_valid', 'out_of_scope'])
  assert.deepEqual(read.commits.map(commit => commit.title), ['Public writes: a lost answer is unresolved', 'Sync reads the live state again'])
  assert.equal(read.files[0].patch.startsWith('@@'), true)
  assert.equal(read.files[2].binary, true)
  assert.equal(read.replies[1].reply_to, 4242)
  assert.equal(read.digest, example().digest)
})

test('a result in another format, or with a wrong shape, is not read at all, never half shown', () => {
  const broken = {
    'a newer version': { version: 2 },
    'no id': { id: '' },
    'no chat': { chat_id: '' },
    'a repository without an owner': { repo: 'repo' },
    'a number that is text': { number: '7' },
    'a state nobody sets': { state: 'sent' },
    'a head that is not a commit': { pr: { ...example().pr, head_sha: 'main' } },
    'a tip that is not a commit': { tip_sha: 'abc' },
    'an ending nobody sets': { points: [{ ...example().points[0], ending: 'maybe' }] },
    'a point that names no one': { points: [{ ...example().points[0], reviewer: '' }] },
    'a reply with no words': { replies: [{ body: '  ', reply_to: null }] },
    'a reply to something that is not a comment id': { replies: [{ body: 'x', reply_to: 'abc' }] },
    'a description that is a number': { description: 4 },
    'reviewers that are not a list': { rerequest: 'alex' },
    'commits that are not a list': { commits: 'none' },
    'a commit that is not a sha': { commits: [{ sha: 'x', title: 't' }] },
    'files that are not a list': { files: {} },
    'no digest': { digest: '' },
    'receipts that are text': { receipts: 'done' },
    'more points than the helper ever writes': { points: Array.from({ length: 31 }, () => example().points[0]) },
  }
  for (const [name, patch] of Object.entries(broken)) assert.equal(normalizeResult({ ...example(), ...patch }), null, name)
  for (const value of [null, undefined, 'text', 7, []]) assert.equal(normalizeResult(value), null)
})

test('a decision counts only in its own shape', () => {
  assert.deepEqual(decision(), { result_id: 'r-3f9a1c2b04d5', digest: example().digest, decision: 'approved', at: '2026-11-06T09:30:00Z' })
  assert.equal(normalizeDecision({ version: 1, result_id: 'r-1', digest: 'x', decision: 'approved' }), null, 'a digest is 64 hex characters')
  assert.equal(decision({ decision: 'maybe' }), null)
  assert.equal(decision({ version: 2 }), null)
  assert.equal(normalizeDecision(null), null)
})

test('the saved response of a PR is found by its exact repository (any case) and number, and by nothing else', () => {
  const list = [{ slug: 'a', result: result({ repo: 'other/repo' }) }, { slug: 'b', result: result({ number: 8 }) }, { slug: 'c', result: result({ repo: 'Owner/Repo' }) }]
  assert.equal(responseFor(list, pull()).slug, 'c')
  assert.equal(responseFor(list, pull({ number: 9 })), null)
  assert.equal(responseFor([], pull()), null)
  assert.equal(responseFor(undefined, pull()), null)
})

test('a response reads ready while the PR is where it was built, and stale once the PR moved', () => {
  assert.equal(responseStatus(entry(), pull()), 'ready')
  assert.equal(responseStatus(entry(), pull({ headRefOid: 'c'.repeat(40) })), 'stale')
  assert.equal(responseStatus(null, pull()), null)
})

test('Post is the owner’s decision for this exact result and digest; any other decision is ignored', () => {
  assert.equal(responseStatus(entry('ready', decision()), pull()), 'approved')
  assert.equal(responseStatus(entry('ready', decision({ result_id: 'r-0123456789ab' })), pull()), 'ready', 'another result’s approval')
  assert.equal(responseStatus(entry('ready', decision({ digest: 'f'.repeat(64) })), pull()), 'ready', 'the answer changed after the approval')
  assert.equal(responseStatus(entry('ready', decision({ decision: 'discarded' })), pull()), null, 'discarded is gone from the PR')
  assert.equal(responseStatus(entry('ready', decision()), pull({ headRefOid: 'c'.repeat(40) })), 'stale', 'approved, but the PR moved before anything was posted')
})

test('while and after posting the PR’s own head no longer matters, only what the helper recorded', () => {
  assert.equal(responseStatus(entry('posting', decision()), pull()), 'posting')
  assert.equal(responseStatus(entry('posting', decision()), pull({ headRefOid: TIP })), 'posting', 'the push moved the head to the tip')
  assert.equal(responseStatus(entry('failed', decision(), { error: { step: 'replies', message: 'x' } }), pull({ headRefOid: TIP })), 'failed')
  assert.equal(responseStatus(entry('posted', decision()), pull({ headRefOid: TIP })), 'posted')
  assert.equal(responseStatus(entry('posted', decision()), pull({ headRefOid: 'c'.repeat(40) })), null, 'the PR moved on: the old answer is history')
  assert.equal(responseStatus(entry('posted', decision(), { commits: [], tip_sha: HEAD }), pull()), 'posted', 'replies only: the head never moves')
})

test('the PR logic gets a draft, sending or unconfirmed fact from a response, and nothing from a stale or finished one', () => {
  assert.deepEqual(responseOutbox(entry(), pull()), { kind: 'push', head: HEAD, state: 'drafted' })
  assert.deepEqual(responseOutbox(entry('ready', decision()), pull()), { kind: 'push', head: HEAD, state: 'sending' })
  assert.deepEqual(responseOutbox(entry('posting', decision()), pull()), { kind: 'push', head: HEAD, state: 'sending' })
  assert.deepEqual(responseOutbox(entry('failed', decision()), pull({ headRefOid: TIP })), { kind: 'push', head: TIP, state: 'unconfirmed' }, 'about the PR as it stands, after the push moved it')
  for (const none of [entry('ready', null, {}), entry('posted', decision())]) {
    const moved = pull({ headRefOid: 'c'.repeat(40) })
    assert.equal(responseOutbox(none, moved), null)
  }
  assert.equal(responseOutbox(null, pull()), null)
})

test('the view of a response is its status with its result, or nothing', () => {
  const view = responseView([entry()], pull())
  assert.equal(view.status, 'ready')
  assert.equal(view.result.id, 'r-3f9a1c2b04d5')
  assert.equal(responseView([entry('ready', decision({ decision: 'discarded' }))], pull()), null)
  assert.equal(responseView([], pull()), null)
})

test('what Post will do is listed in the order the helper does it, and only what there is to do', () => {
  assert.deepEqual(planSteps(result()).map(step => step.key), ['push', 'replies', 'description', 'rerequest'])
  const [push, replies, description, rerequest] = planSteps(result())
  assert.equal(push.text, 'Push 2 commits to the PR’s branch, on top of bbbbbbb')
  assert.equal(replies.text, 'Post 2 replies, as you')
  assert.equal(description.text, 'Update the description')
  assert.equal(rerequest.text, 'Ask alex to review again')
  const quiet = planSteps(result({ commits: [], tip_sha: HEAD, description: null, rerequest: [], replies: [example().replies[0]] }))
  assert.deepEqual(quiet.map(step => step.text), ['Post 1 reply, as you'])
  assert.equal(planSteps(result({ rerequest: ['alex', 'sam'] })).at(-1).text, 'Ask alex and sam to review again')
  assert.equal(planSteps(result({ commits: [example().commits[0]] }))[0].text, 'Push 1 commit to the PR’s branch, on top of bbbbbbb')
})

test('the message that tells the chat to post is exact, names the one command, and forbids anything by hand', () => {
  const message = postMessage(result())
  assert.match(message, /^Approved in Contribute: post result r-3f9a1c2b04d5 for owner\/repo#7, built on bbbbbbb\./)
  assert.ok(message.includes('python3 /data/apps/contribute/respond_result.py post --pr owner/repo#7 --id r-3f9a1c2b04d5'))
  assert.equal(POST_COMMAND(result()), 'python3 /data/apps/contribute/respond_result.py post --pr owner/repo#7 --id r-3f9a1c2b04d5')
  assert.match(message, /Do not push, comment, reply or edit anything on GitHub by hand\. If it refuses, say why and stop\./)
  assert.match(message, /checks the approval and the PR head itself/)
})
