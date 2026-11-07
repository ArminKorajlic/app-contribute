import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { observeContributionPublication, submitContribution, submitContributionStack, updateContribution, updateContributionStack } from '../api.js'
import { publicationVersion, resolveUncertainSubmission, uncertainPublication } from '../domain.js'
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
  assert.deepEqual([pending.result.outcome, pending.result.effect], ['pending', 'branch_published'])
  // The platform's Autopilot refusal as it is sent: no attempt context.
  const autopilot = await withFetch(json({ outcome: 'not_eligible', records: [{ id: 'one' }], message: 'Autopilot recovers its own update; checking never settles or retires it.' }),
    () => observeContributionPublication({ appId: 80, token: 't', recordId: 'one' }))
  assert.equal(autopilot.result.outcome, 'not_eligible')
  assert.equal('action' in autopilot.result, false, 'nothing is inferred from the answer\'s attempt or wording')
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
  assert.equal((await first).outcome, 'changed')
  assert.equal((await second).version, publicationVersion(record), 'every answer names the version it is about')
  c.advance(60 * 60 * 1000)
  assert.equal((await observer.check(record)).outcome, 'changed')
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
  await observer.sweep(records, record => settled.push(record.id), id => records.find(record => record.id === id))
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

// ---- Review regressions (app-observer-wiring.md B1, B2, B4, B5).
const routes = {
  submit: () => submitContribution({ appId: 80, token: 't', rec: { id: 'one' } }),
  update: () => updateContribution({ appId: 80, token: 't', rec: { id: 'one' } }),
  submitStack: () => submitContributionStack({ appId: 80, token: 't', recordIds: ['one', 'two'] }),
  updateStack: () => updateContributionStack({ appId: 80, token: 't', recordIds: ['one', 'two'] }),
}

test('B1: every 5xx without a certified refusal is uncertain on all four Send routes, whatever its body', async () => {
  const bodies = {
    jsonString: () => json({ detail: 'Internal Server Error' }, 500),
    jsonObject: () => json({ detail: { message: 'upstream timed out' } }, 503),
    otherCode: () => json({ detail: { message: 'GitHub is unavailable.', code: 'github_unavailable' } }, 503),
    malformed: () => new Response('{"detail": ', { status: 502 }),
    missing: () => new Response(null, { status: 504 }),
  }
  for (const [route, call] of Object.entries(routes)) {
    for (const [shape, body] of Object.entries(bodies)) {
      const { result } = await withFetch(body, call)
      assert.equal(result.uncertain, true, `${route} ${shape}`)
      assert.equal(result.failure.owner, 'automatic', `${route} ${shape}`)
    }
    // Certified answers stay definite.
    const refused = await withFetch(json({ detail: { message: 'Nothing was published.', code: 'publication_failed' } }, 500), call)
    assert.equal(refused.result.uncertain, undefined, `${route} publication_failed`)
    const notAttempted = await withFetch(json({ detail: { message: 'changed', code: 'approval_changed', not_attempted: true } }, 409), call)
    assert.equal(notAttempted.result.notAttempted, true, `${route} certified non-attempt`)
  }
})

// The record a known post-push error saves: the branch was pushed, its PR
// create failed, and the platform answers a truthful 409 with an empty code.
const pushedRecord = (id = 'one') => ({ id, type: 'pr', status: 'prepared', plan: { action: 'pr', head_sha: 'a'.repeat(40) },
  last_submit_stage: 'pushed', last_submit_push_sha: 'a'.repeat(40), last_pushed_branch: 'owner:fix/one',
  last_submit_error: 'GitHub command failed. The branch was pushed to https://github.com/owner/repo/tree/fix/one.', updated_at: '2026-10-20T11:00:00Z' })

test('B2: a 409 after the branch push is possibly public, never "nothing was sent"', async () => {
  const body = () => json({ detail: { message: pushedRecord().last_submit_error, code: '', record: pushedRecord() } }, 409)
  for (const route of ['submit', 'update']) {
    const { result } = await withFetch(body, routes[route])
    assert.equal(result.uncertain, true, route)
    assert.equal(result.failure.code, 'possibly_public', route)
  }
  const stack = await withFetch(json({ detail: { message: 'm', code: '', records: [pushedRecord('one'), { id: 'two', type: 'pr', status: 'prepared' }] } }, 409), routes.submitStack)
  assert.equal(stack.result.uncertain, true)
  assert.equal(uncertainPublication(pushedRecord()), true)
  assert.equal(resolveUncertainSubmission({ id: 'one' }, { records: [pushedRecord()] }).state, 'publishing')
  // A preflight refusal before any push stays a definite refusal.
  const preflight = await withFetch(json({ detail: { message: 'The reviewed source changed.', code: 'review_refresh_needed',
    record: { id: 'one', type: 'pr', status: 'prepared', last_submit_error: 'The reviewed source changed.' } } }, 409), routes.submit)
  assert.equal(preflight.result.uncertain, undefined)
  assert.equal(uncertainPublication({ ...pushedRecord(), last_submit_error: undefined }), false, 'a restage clears the error')
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /'Nothing was sent\. Th/, 'a ledger read never certifies that nothing was sent')
})

test('B4: a settled answer for an older record version is never handed to the workspace', async () => {
  const c = clockAt()
  let release
  const observer = createPublicationObserver({ now: c.now, observe: () => new Promise(resolve => { release = resolve }) })
  const older = uncertainRecord('one')
  let current = older
  const settled = []
  const sweep = observer.sweep([older], record => settled.push(record), () => current)
  await new Promise(resolve => setTimeout(resolve, 0))
  current = { ...older, updated_at: '2026-10-20T10:20:00Z', plan: { head_sha: 'b'.repeat(40) } }
  release({ outcome: 'settled', record: { ...older, status: 'open' } })
  await sweep
  assert.deepEqual(settled, [], 'the row moved on while it was observed')
})

test('B5: final, backed-off and recently answered records never take the per-pass budget, and asks rotate', async () => {
  const c = clockAt()
  const asked = []
  const answers = { r0: 'changed', r1: 'changed', r2: 'not_eligible', r3: 'changed' }
  const observer = createPublicationObserver({ now: c.now, observe: async record => {
    asked.push(record.id)
    if (record.id === 'r4') return { outcome: 'settled', record: { ...record, status: 'open' } }
    if (record.id === 'r5') throw new Error('offline')
    return { outcome: answers[record.id] || 'pending' }
  } })
  const records = Array.from({ length: 8 }, (_, n) => uncertainRecord(`r${n}`, { updated_at: `2026-10-20T10:0${n}:00Z` }))
  const settled = []
  const pass = () => observer.sweep(records, record => settled.push(record.id), id => records.find(record => record.id === id))
  await pass()
  assert.deepEqual(asked, ['r0', 'r1', 'r2', 'r3'])
  c.advance(ANSWER_REUSE_MS)
  await pass()
  assert.deepEqual(asked.slice(4), ['r4', 'r5', 'r6', 'r7'], 'the four final answers no longer starve the rest')
  assert.deepEqual(settled, ['r4'])
  c.advance(ANSWER_REUSE_MS)
  await pass()
  // r5 is backing off; the pending records are asked, least recently first.
  assert.deepEqual(asked.slice(8), ['r6', 'r7'])
  c.advance(TRANSPORT_BACKOFF_MS[0])
  await pass()
  assert.equal(asked.slice(10)[0], 'r5', 'the longest-waiting record goes first once its backoff passes')
})

test('the observe timeout covers a stalled answer body', async t => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, { signal }) => ({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) })
  t.after(() => { globalThis.fetch = original })
  const result = await observeContributionPublication({ appId: 80, token: 't', recordId: 'one', timeoutMs: 20 })
  assert.equal(result.outcome, 'transport')
})
