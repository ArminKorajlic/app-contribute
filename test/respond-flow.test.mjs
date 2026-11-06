import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { approveResponse, discardResponse } from '../respond-flow.js'
import { clearDecision, loadResponses, readFreshResult, writeDecision } from '../respond-store.js'
import { normalizeResult, planSteps } from '../respond-result.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const SLUG = 'owner__repo__7'
const pull = (extra = {}) => ({ number: 7, headRefOid: HEAD, repository: { nameWithOwner: 'owner/repo' }, ...extra })

// The runtime's storage, as far as the response files use it: a listing with content, versioned reads, durable writes.
function fakeStorage(files = {}, options = {}) {
  const calls = []
  const storage = {
    calls,
    files,
    async listWithStatus(prefix) {
      calls.push(['list', prefix])
      const entries = Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, content]) => ({
        type: 'file', name: path.slice(prefix.length), path, ...(options.omit?.includes(path) ? {} : { content: structuredClone(content) }),
      }))
      return { entries, complete: options.complete !== false }
    },
    async get(path) { calls.push(['get', path]); return files[path] === undefined ? null : structuredClone(files[path]) },
    async getWithVersion(path) { calls.push(['read', path]); return { value: files[path] === undefined ? null : structuredClone(files[path]), version: 'v1', offline: options.offline === true } },
    async durableWrite(path, value) { calls.push(['write', path, structuredClone(value)]); if (options.writeFails) throw new Error('offline'); files[path] = structuredClone(value); return { durability: options.queued ? 'queued' : 'synced' } },
    async remove(path) { calls.push(['remove', path]); delete files[path] },
  }
  return storage
}
const saved = (patch = {}) => ({ [`respond-results/${SLUG}.json`]: { ...example(), ...patch } })

test('the saved responses are read from both folders and paired by PR', async () => {
  const decision = { version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: '2026-11-06T09:30:00Z' }
  const storage = fakeStorage({ ...saved(), [`respond-decisions/${SLUG}.json`]: decision, 'respond-results/readme.txt': 'x', 'respond-results/other__repo__9.json': { version: 9 } })
  const responses = await loadResponses(storage)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].slug, SLUG)
  assert.equal(responses[0].result.id, example().id)
  assert.equal(responses[0].decision.decision, 'approved')
})

test('a file whose name is not its PR’s slug is not a response, and a body left out of the listing is read on its own', async () => {
  const path = `respond-results/${SLUG}.json`
  const storage = fakeStorage({ ...saved(), 'respond-results/wrong-name.json': example() }, { omit: [path] })
  const responses = await loadResponses(storage)
  assert.deepEqual(responses.map(item => item.slug), [SLUG])
  assert.ok(storage.calls.some(call => call[0] === 'get' && call[1] === path), 'the omitted body was fetched')
})

test('a listing that is not complete is an error, so the screen keeps what it last knew', async () => {
  await assert.rejects(() => loadResponses(fakeStorage(saved(), { complete: false })), /could not be read completely/)
  assert.deepEqual(await loadResponses(fakeStorage({})), [])
})

test('the fresh read reaches the server and an offline answer is not trusted', async () => {
  assert.equal((await readFreshResult(SLUG, fakeStorage(saved()))).id, example().id)
  assert.equal(await readFreshResult(SLUG, fakeStorage(saved(), { offline: true })), null)
  assert.equal(await readFreshResult(SLUG, fakeStorage({})), null)
})

test('a decision is a durable write that only counts when the server accepted it', async () => {
  const storage = fakeStorage()
  const decision = { result_id: example().id, digest: example().digest, decision: 'approved', at: '2026-11-06T09:30:00Z' }
  assert.deepEqual(await writeDecision(SLUG, decision, storage), { ok: true })
  assert.deepEqual(storage.files[`respond-decisions/${SLUG}.json`], { version: 1, ...decision })
  const queued = await writeDecision(SLUG, decision, fakeStorage({}, { queued: true }))
  assert.equal(queued.ok, false)
  assert.match(queued.error, /not saved online/)
  assert.equal((await writeDecision(SLUG, decision, fakeStorage({}, { writeFails: true }))).ok, false)
  await clearDecision(SLUG, storage)
  assert.equal(storage.files[`respond-decisions/${SLUG}.json`], undefined)
})

// Post: re-read, check what is on screen is what is saved, write the approval, then tell the chat.
const view = patch => ({ digest: example().digest, pr: pull(), chat: null, ...patch })
const delivered = []
const deliverOk = async (token, request) => { delivered.push({ token, request }); return { ok: true, chatId: request.chatId, outcome: 'sent' } }
const reset = () => { delivered.length = 0 }

test('Post writes the approval first, then sends the chat the one message, bound to the result', async () => {
  reset()
  const storage = fakeStorage(saved())
  const approvedBefore = []
  const deliver = async (token, request) => { approvedBefore.push(storage.files[`respond-decisions/${SLUG}.json`]?.decision); return deliverOk(token, request) }
  const out = await approveResponse({ ...view(), slug: SLUG, token: 't', storage, deliver, now: () => '2026-11-06T09:30:00Z' })
  assert.deepEqual(out, { ok: true })
  assert.deepEqual(approvedBefore, ['approved'], 'the helper needs the approval on disk before the chat is told to run it')
  assert.deepEqual(storage.files[`respond-decisions/${SLUG}.json`], { version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: '2026-11-06T09:30:00Z' })
  assert.equal(delivered.length, 1)
  const { request } = delivered[0]
  assert.equal(request.chatId, 'respond-chat-1')
  assert.equal(request.cid, `respond-post-${example().id}`, 'a second press is a duplicate, not a second message')
  assert.equal(request.scope, 'contribute-address:owner/repo#7')
  assert.equal(request.title, 'Respond to feedback on #7')
  assert.equal(request.applyModel, false)
  assert.match(request.draft, /respond_result\.py post --pr owner\/repo#7 --id r-3f9a1c2b04d5/)
})

test('a post that stopped can be tried again, even though its own push moved the PR, and a resend is a new message', async () => {
  reset()
  const TIP = '2'.repeat(40)
  const stopped = fakeStorage(saved({ state: 'failed', error: { step: 'replies', message: 'x' } }))
  const retried = await approveResponse({ ...view({ pr: pull({ headRefOid: TIP }) }), slug: SLUG, token: 't', storage: stopped, again: true, deliver: deliverOk })
  assert.deepEqual(retried, { ok: true })
  assert.match(delivered[0].request.cid, /^respond-retry-r-3f9a1c2b04d5-\d+$/, 'the first message id would be dropped as a duplicate')
  const elsewhere = await approveResponse({ ...view({ pr: pull({ headRefOid: 'c'.repeat(40) }) }), slug: SLUG, token: 't', storage: fakeStorage(saved({ state: 'failed' })), again: true, deliver: deliverOk })
  assert.match(elsewhere.error, /PR changed after this answer/, 'the PR moved for another reason')
  reset()
  const resent = await approveResponse({ ...view(), slug: SLUG, token: 't', storage: fakeStorage(saved()), again: true, deliver: deliverOk })
  assert.equal(resent.ok, true)
  assert.match(delivered[0].request.cid, /^respond-retry-/)
})

test('Post refuses, and writes nothing, when what is on screen is no longer what is saved', async () => {
  reset()
  const cases = {
    'the answer was replaced while you read it': [saved({ digest: 'e'.repeat(64) }), /changed while you were reading it/],
    'the answer is gone': [{}, /no longer saved/],
    'it is already being posted': [saved({ state: 'posting' }), /already/],
    'it was already posted': [saved({ state: 'posted' }), /already/],
  }
  for (const [name, [files, message]] of Object.entries(cases)) {
    const storage = fakeStorage(files)
    const out = await approveResponse({ ...view(), slug: SLUG, token: 't', storage, deliver: deliverOk })
    assert.equal(out.ok, false, name)
    assert.match(out.error, message, name)
    assert.equal(storage.calls.some(call => call[0] === 'write'), false, `${name}: nothing was approved`)
  }
  assert.equal(delivered.length, 0)
})

test('Post refuses when the PR moved, the chat is busy, or the chat waits on a card of its own', async () => {
  reset()
  const refuse = async patch => {
    const storage = fakeStorage(saved())
    const out = await approveResponse({ ...view(patch), slug: SLUG, token: 't', storage, deliver: deliverOk })
    assert.equal(storage.calls.some(call => call[0] === 'write'), false)
    return out
  }
  assert.match((await refuse({ pr: pull({ headRefOid: 'c'.repeat(40) }) })).error, /PR changed after this answer/)
  assert.match((await refuse({ chat: { state: 'running' } })).error, /working on this PR right now/)
  assert.match((await refuse({ chat: { state: 'needs_answer' } })).error, /waiting for your answer to its own card/)
  assert.equal(delivered.length, 0)
})

test('an approval the server did not accept sends nothing', async () => {
  reset()
  const storage = fakeStorage(saved(), { queued: true })
  const out = await approveResponse({ ...view(), slug: SLUG, token: 't', storage, deliver: deliverOk })
  assert.equal(out.ok, false)
  assert.match(out.error, /not saved online/)
  assert.equal(delivered.length, 0)
})

test('a message the platform refuses takes the approval back; one that may have gone through keeps it, to send again', async () => {
  const refused = async () => ({ ok: false, error: 'This conversation is waiting for an answer.', status: 409 })
  const lost = async () => ({ ok: false, error: 'Could not reach Möbius. Send again.' })
  const refusedStorage = fakeStorage(saved())
  const out = await approveResponse({ ...view(), slug: SLUG, token: 't', storage: refusedStorage, deliver: refused })
  assert.equal(out.ok, false)
  assert.equal(refusedStorage.files[`respond-decisions/${SLUG}.json`], undefined, 'refused for certain: nothing stays approved')
  const lostStorage = fakeStorage(saved())
  const unsure = await approveResponse({ ...view(), slug: SLUG, token: 't', storage: lostStorage, deliver: lost })
  assert.equal(unsure.ok, false)
  assert.equal(unsure.unsure, true)
  assert.equal(lostStorage.files[`respond-decisions/${SLUG}.json`].decision, 'approved', 'it may have gone through: the helper still needs the approval')
})

test('a conversation that was deleted cannot post, and the approval is taken back', async () => {
  const gone = async () => ({ ok: false, error: 'This conversation was deleted.', gone: true })
  const storage = fakeStorage(saved())
  const out = await approveResponse({ ...view(), slug: SLUG, token: 't', storage, deliver: gone })
  assert.equal(out.ok, false)
  assert.equal(storage.files[`respond-decisions/${SLUG}.json`], undefined)
})

test('Discard writes the decision for exactly the answer on screen, and refuses once it is being posted', async () => {
  const storage = fakeStorage(saved())
  assert.deepEqual(await discardResponse({ slug: SLUG, digest: example().digest, storage, now: () => '2026-11-06T09:31:00Z' }), { ok: true })
  assert.deepEqual(storage.files[`respond-decisions/${SLUG}.json`], { version: 1, result_id: example().id, digest: example().digest, decision: 'discarded', at: '2026-11-06T09:31:00Z' })
  const posting = fakeStorage(saved({ state: 'posting' }))
  const out = await discardResponse({ slug: SLUG, digest: example().digest, storage: posting })
  assert.equal(out.ok, false)
  assert.equal(posting.calls.some(call => call[0] === 'write'), false)
  const replaced = fakeStorage(saved({ digest: 'e'.repeat(64) }))
  assert.equal((await discardResponse({ slug: SLUG, digest: example().digest, storage: replaced })).ok, false)
})

test('the steps Post lists are the ones the saved result has', () => {
  assert.equal(planSteps(normalizeResult(example())).length, 4)
})
