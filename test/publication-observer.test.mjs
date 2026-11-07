import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { observeContributionPublication, submitContribution, submitContributionStack, updateContribution } from '../api.js'
import { resolveUncertainSubmission, uncertainPublication } from '../domain.js'
import { sendBlocker } from '../send-readiness.js'
import { ANSWER_REUSE_MS, MAX_PER_PASS, SUBMITTING_GRACE_MS, TRANSPORT_BACKOFF_MS, createPublicationObserver } from '../publication-observer.js'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Every request the client makes, and the answer it gets.
async function withFetch(answer, run) {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body })
    return typeof answer === 'function' ? answer(url, options) : answer
  }
  try { return { result: await run(), requests } } finally { globalThis.fetch = original }
}

const settledRecord = { id: 'one', type: 'pr', status: 'open', number: 5, url: 'https://github.com/o/r/pull/5' }

// ---- The API call.
test('observe is one empty POST to the record\'s observe route and returns the settled record', async () => {
  const { result, requests } = await withFetch(json({ outcome: 'settled', records: [settledRecord], message: 'saved' }),
    () => observeContributionPublication({ appId: 80, token: 't', recordId: 'one' }))
  assert.deepEqual(requests, [{ url: '/api/github/contributions/80/one/observe', method: 'POST', body: '{}' }])
  assert.equal(result.outcome, 'settled')
  assert.deepEqual(result.record, settledRecord)
})

test('observe keeps pending, changed and not_eligible with their content-free context', async () => {
  const pending = await withFetch(json({ outcome: 'pending', effect: 'branch_published', records: [{ id: 'one' }], message: 'm',
    attempt: { action: 'submit', phase: 'branch_published', effect: 'push' } }), () => observeContributionPublication({ appId: 80, token: 't', recordId: 'one' }))
  assert.deepEqual([pending.result.outcome, pending.result.effect, pending.result.action], ['pending', 'branch_published', 'submit'])
  const autopilot = await withFetch(json({ outcome: 'not_eligible', records: [{ id: 'one' }], message: 'm', attempt: { action: 'autopilot_update' } }),
    () => observeContributionPublication({ appId: 80, token: 't', recordId: 'one' }))
  assert.deepEqual([autopilot.result.outcome, autopilot.result.action], ['not_eligible', 'autopilot_update'])
  const changed = await withFetch(json({ outcome: 'changed', records: [{ id: 'one' }], message: 'm' }),
    () => observeContributionPublication({ appId: 80, token: 't', recordId: 'one' }))
  assert.equal(changed.result.outcome, 'changed')
})

test('an older Möbius without the route is unsupported; lost, failed or malformed answers are transport, never an outcome', async () => {
  const call = () => observeContributionPublication({ appId: 80, token: 't', recordId: 'one' })
  assert.equal((await withFetch(json({ detail: 'Not Found' }, 404), call)).result.outcome, 'unsupported')
  assert.equal((await withFetch(json({ detail: 'Contribution not found.' }, 404), call)).result.outcome, 'transport', 'a missing record is no answer, not an older host')
  assert.equal((await withFetch(json({ detail: 'Method Not Allowed' }, 405), call)).result.outcome, 'unsupported')
  assert.equal((await withFetch(() => { throw new TypeError('network') }, call)).result.outcome, 'transport')
  assert.equal((await withFetch(new Response('oops', { status: 502 }), call)).result.outcome, 'transport')
  assert.equal((await withFetch(json({ outcome: 'nothing_happened' }), call)).result.outcome, 'transport')
  assert.equal((await withFetch(json({ outcome: 'settled', records: [] }), call)).result.outcome, 'transport', 'a settlement without its record is asked again')
  assert.equal((await withFetch(json({ outcome: 'settled', records: [{ id: 'other' }] }), call)).result.outcome, 'transport')
})

// ---- Send answers that may already be public stay uncertain.
test('a 503 publication_unconfirmed, a 5xx without an answer and an accepted update without its record are uncertain', async () => {
  const rec = { id: 'one' }
  const unconfirmed = json({ detail: { message: 'GitHub may have accepted this.', code: 'publication_unconfirmed', record: null, url: 'u', number: 3 } }, 503)
  const submit = await withFetch(unconfirmed, () => submitContribution({ appId: 80, token: 't', rec }))
  assert.equal(submit.result.uncertain, true)
  assert.deepEqual(submit.result.failure, { owner: 'automatic', status: 503, code: 'publication_unconfirmed' })
  const update = await withFetch(json({ detail: { message: 'm', code: 'update_unconfirmed' } }, 503), () => updateContribution({ appId: 80, token: 't', rec }))
  assert.equal(update.result.uncertain, true)
  const stack = await withFetch(json({ detail: { message: 'm', code: 'publication_unconfirmed', records: [{ id: 'one' }], submitted: ['one'] } }, 503),
    () => submitContributionStack({ appId: 80, token: 't', recordIds: ['one', 'two'] }))
  assert.deepEqual([stack.result.uncertain, stack.result.records.length, stack.result.submitted], [true, 1, ['one']])
  const crashed = await withFetch(new Response('Internal Server Error', { status: 500 }), () => submitContribution({ appId: 80, token: 't', rec }))
  assert.equal(crashed.result.uncertain, true)
  const accepted = await withFetch(json({ ok: true }), () => updateContribution({ appId: 80, token: 't', rec }))
  assert.equal(accepted.result.uncertain, true)
  // A definite refusal stays one.
  const refused = await withFetch(json({ detail: { message: 'Nothing was published.', code: 'publication_failed' } }, 500), () => submitContribution({ appId: 80, token: 't', rec }))
  assert.deepEqual([refused.result.uncertain, refused.result.failure.code], [undefined, 'publication_failed'])
})

test('a record the platform left unconfirmed is checking, not a failed or sendable send', () => {
  const base = { id: 'one', type: 'pr', status: 'prepared', plan: { action: 'pr' }, quality_review: { state: 'all_clear' } }
  for (const fields of [{ status: 'submitting' }, { last_submit_stage: 'push_ambiguous' }, { last_submit_stage: 'push_pending' },
    { last_submit_error: 'x', last_submit_error_code: 'publication_unconfirmed' }, { last_submit_error: 'x', last_submit_error_code: 'create_unconfirmed' }]) {
    assert.equal(uncertainPublication({ ...base, ...fields }), true, JSON.stringify(fields))
  }
  assert.equal(uncertainPublication({ ...base, last_submit_error: 'x', last_submit_error_code: 'upstream_conflict' }), false)
  assert.equal(uncertainPublication({ ...base, submission_mode: 'mobius-bot', status: 'submitting' }), false)
  const unconfirmed = { ...base, last_submit_error: 'x', last_submit_error_code: 'publication_unconfirmed' }
  assert.match(sendBlocker(unconfirmed, { state: 'ready' }), /confirmed the last send/)
  assert.equal(resolveUncertainSubmission({ id: 'one' }, { records: [unconfirmed] }).state, 'publishing')
  assert.equal(resolveUncertainSubmission({ id: 'one' }, { records: [{ ...base, last_submit_error: 'x' }] }).state, 'blocked')
})

// ---- The shared observer.
function clockAt(start = Date.parse('2026-10-20T10:30:00Z')) {
  let at = start
  return { now: () => at, advance: ms => { at += ms } }
}
const uncertainRecord = (id, extra = {}) => ({ id, type: 'pr', status: 'prepared', last_submit_stage: 'push_ambiguous', updated_at: '2026-10-20T10:00:00Z', ...extra })

test('concurrent checks of one record share one request; final answers are never asked again', async () => {
  const c = clockAt()
  let calls = 0, release
  const observer = createPublicationObserver({ now: c.now, observe: () => { calls += 1; return calls > 1 ? { outcome: 'pending' } : new Promise(resolve => { release = resolve }) } })
  const record = uncertainRecord('one')
  const first = observer.check(record), second = observer.check(record)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls, 1)
  release({ outcome: 'changed' })
  assert.deepEqual(await first, { outcome: 'changed' })
  assert.deepEqual(await second, { outcome: 'changed' })
  c.advance(60 * 60 * 1000)
  assert.deepEqual(await observer.check(record), { outcome: 'changed' })
  assert.equal(calls, 1, 'final for this version')
  // A new write is a new question.
  await observer.check({ ...record, updated_at: '2026-10-20T11:00:00Z' })
  assert.equal(calls, 2)
})

test('pending is reused briefly, then asked again', async () => {
  const c = clockAt()
  let calls = 0
  const observer = createPublicationObserver({ now: c.now, observe: async () => { calls += 1; return { outcome: 'pending' } } })
  const record = uncertainRecord('one')
  await observer.check(record); await observer.check(record)
  assert.equal(calls, 1)
  c.advance(ANSWER_REUSE_MS)
  await observer.check(record)
  assert.equal(calls, 2)
})

test('no answer backs off with growing waits and is never an outcome', async () => {
  const c = clockAt()
  let calls = 0
  const observer = createPublicationObserver({ now: c.now, observe: async () => { calls += 1; throw new Error('timeout') } })
  const record = uncertainRecord('one')
  assert.equal(await observer.check(record), null)
  assert.equal(await observer.check(record), null)
  assert.equal(calls, 1)
  c.advance(TRANSPORT_BACKOFF_MS[0]); await observer.check(record)
  assert.equal(calls, 2)
  c.advance(TRANSPORT_BACKOFF_MS[0]); await observer.check(record)
  assert.equal(calls, 2, 'the second wait is longer')
  c.advance(TRANSPORT_BACKOFF_MS[1]); await observer.check(record)
  assert.equal(calls, 3)
})

test('an older Möbius turns the observer off for the frame', async () => {
  let calls = 0
  const observer = createPublicationObserver({ observe: async () => { calls += 1; return { outcome: 'unsupported' } } })
  await observer.check(uncertainRecord('one'))
  assert.deepEqual(await observer.check(uncertainRecord('two')), { outcome: 'unsupported' })
  await observer.sweep([uncertainRecord('three')])
  assert.equal(calls, 1)
  assert.equal(observer.unsupported, true)
})

test('the refresh sweep observes only uncertain records, a bounded few, and hands back settled ones', async () => {
  const c = clockAt()
  const asked = []
  const observer = createPublicationObserver({ now: c.now, observe: async record => {
    asked.push(record.id)
    return record.id === 'a' ? { outcome: 'settled', record: { ...record, status: 'open' } } : { outcome: 'unavailable' }
  } })
  const records = [
    uncertainRecord('a'),
    ...Array.from({ length: MAX_PER_PASS + 2 }, (_, n) => uncertainRecord(`u${n}`, { updated_at: `2026-10-20T10:0${n + 1}:00Z` })),
    { id: 'plain', type: 'pr', status: 'prepared', updated_at: '2026-10-20T09:00:00Z' },
    { id: 'fresh', type: 'pr', status: 'submitting', updated_at: new Date(c.now() - SUBMITTING_GRACE_MS / 2).toISOString() },
    { id: 'issue', type: 'issue', status: 'submitting', updated_at: '2026-10-20T09:00:00Z' },
  ]
  const settled = []
  await observer.sweep(records, record => settled.push(record.id))
  assert.equal(asked.length, MAX_PER_PASS)
  assert.deepEqual(asked.sort(), ['a', 'u0', 'u1', 'u2'], 'oldest first, only uncertain personal PRs')
  assert.deepEqual(settled, ['a'])
})

test('refresh and observation never call a publication route', () => {
  for (const file of ['../publication-observer.js', '../inline-session.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\/submit|update-existing|submit-stack|update-stack|\/ready\b/, file)
  }
})
