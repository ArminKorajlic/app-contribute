import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACCOUNT_CODES, ASK_CODES, askRev, cardAsk, holdCode } from '../card-asks.js'

const HEAD = 'a'.repeat(40)
const record = (extra = {}) => ({ id: 'r-1', status: 'prepared', plan: { head_sha: HEAD, title: 'Title' },
  quality_review: { state: 'all_clear', reviewed_head_sha: HEAD }, ...extra })

test('an ask names exactly one record, its code and its state, and no words of the card\'s own', () => {
  for (const code of ASK_CODES) {
    assert.deepEqual(cardAsk('r-1', code, HEAD), { refs: [{ id: 'r-1', code, rev: HEAD }] })
    assert.match(code, /^[a-z][a-z0-9_]{1,47}$/, 'the host\'s code grammar')
  }
  assert.equal(cardAsk('r-1', 'github_reconnect', HEAD), null, 'the account is never an ask')
  assert.equal(cardAsk('r-1', 'anything_else', HEAD), null)
  assert.equal(cardAsk('r-1', 'needs_review', 'not-hex'), null, 'no ask without a valid state token')
  assert.ok(!ASK_CODES.some(code => ACCOUNT_CODES.has(code)))
})

test('a held record\'s code follows the order the send gate checks', () => {
  assert.equal(holdCode(null), 'not_in_contribute')
  assert.equal(holdCode(record({ status: 'submitting' })), '')
  assert.equal(holdCode(record()), '')
  assert.equal(holdCode(record(), { state: 'needs_refresh', code: 'upstream_conflict' }), 'upstream_conflict')
  assert.equal(holdCode(record(), { state: 'needs_refresh', code: 'missing_checkout' }), 'source_changed')
  assert.equal(holdCode(record({ last_submit_error: 'x' })), 'send_failed')
  assert.equal(holdCode(record({ last_submit_error: 'x', last_submit_error_code: 'push_ambiguous' })), 'send_failed')
  assert.equal(holdCode(record({ last_submit_error: 'x', last_submit_error_code: 'github_reconnect' })), 'github_reconnect')
  assert.equal(holdCode(record({ needs_attention: true })), 'needs_attention')
  assert.equal(holdCode(record({ quality_review: { state: 'reviewing' } })), 'needs_review')
  assert.equal(holdCode(record({ quality_review: { state: 'changes_needed' } })), 'changes_needed')
  assert.equal(holdCode(record(), { state: 'unavailable', code: 'github_reconnect' }), 'github_reconnect')
  assert.equal(holdCode(record(), { state: 'unavailable', code: 'publication_destination_unavailable' }), 'publication_destination_unavailable')
  assert.equal(holdCode(record(), { state: 'unavailable', code: 'review_unavailable' }), 'couldnt_check')
})

test('the contributing skill tells the agent what to do for every code', () => {
  const skill = readFileSync(new URL('../contributing/card-asks.md', import.meta.url), 'utf8')
  const section = skill.slice(skill.indexOf('## Card asks'))
  assert.ok(section.length > 0 && skill.includes('## Card asks'))
  for (const code of ASK_CODES) assert.match(section, new RegExp(`\`${code}\``), code)
  assert.match(section, /prepared_block\.py/)
})

test('the state token follows the cause, not the record\'s last write', () => {
  const token = /^[0-9a-f]{16}$/
  const base = record({ plan: { head_sha: HEAD, base_sha: 'b'.repeat(40), diff_sha256: 'd'.repeat(64), title: 'Title', body_draft: 'Body one' },
    updated_at: '2026-11-07T01:00:00Z' })
  const rev = (code, value, attempt) => askRev('r-1', code, value, attempt)
  // A metadata-only restage at the same head is a new state.
  const text = rev('invalid_pr_text', base)
  assert.match(text, token)
  assert.notEqual(rev('invalid_pr_text', { ...base, plan: { ...base.plan, body_draft: 'Body two' } }), text)
  assert.notEqual(rev('changes_needed', { ...base, quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD, summary: 'Second pass' } }),
    rev('changes_needed', { ...base, quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD, summary: 'First pass' } }))
  // A record-wide write alone is not.
  assert.equal(rev('invalid_pr_text', { ...base, updated_at: '2026-11-07T05:00:00Z', reconciliation_hint: { main_sha: 'e'.repeat(40) } }), text)
  // Another attention cause at the same head is a new state; the same cause seen again is not.
  const attention = (key, detected) => ({ ...base, needs_attention: true, attention: { type: 'merge_conflict', key, detected_at: detected } })
  const first = rev('needs_attention', attention('merge_conflict:aaa', '2026-11-07T01:00:00Z'))
  assert.equal(rev('needs_attention', attention('merge_conflict:aaa', '2026-11-07T04:00:00Z')), first)
  assert.notEqual(rev('needs_attention', attention('merge_conflict:bbb', '2026-11-07T04:00:00Z')), first)
  assert.notEqual(rev('needs_attention', { ...attention('merge_conflict:aaa'), attention: { type: 'checks_failed', key: 'merge_conflict:aaa' } }), first)
  // A failed send is its attempt.
  const failed = { ...base, last_submit_error: 'Push rejected', last_submit_error_code: 'commit_identity_mismatch',
    submit_started_at: '2026-11-07T01:00:00Z', personal_submit_input_sha256: 'f'.repeat(64) }
  const failure = rev('commit_identity_mismatch', failed)
  assert.equal(rev('commit_identity_mismatch', { ...failed, updated_at: '2026-11-07T06:00:00Z', reconciliation_hint: { main_sha: 'e'.repeat(40) } }), failure,
    'an unrelated update keeps the same failure')
  assert.notEqual(rev('commit_identity_mismatch', { ...failed, submit_started_at: '2026-11-07T02:00:00Z' }), failure, 'a new failed attempt')
  // Without an attempt stamp (older records) the failure itself is the identity.
  const legacy = { ...failed, submit_started_at: undefined, personal_submit_input_sha256: undefined }
  const old = rev('send_failed', { ...legacy, last_submit_error_code: undefined })
  assert.equal(rev('send_failed', { ...legacy, last_submit_error_code: undefined, updated_at: '2026-11-08T00:00:00Z' }), old)
  assert.notEqual(rev('send_failed', { ...legacy, last_submit_error_code: undefined, last_submit_error: 'Branch exists' }), old)
  // Codes, unknown attempts and missing records.
  assert.notEqual(rev('upstream_conflict', base), rev('upstream_base_moved', base))
  assert.equal(rev('upstream_conflict', { ...base, plan: { ...base.plan, title: 'Renamed' } }), rev('upstream_conflict', base), 'a source cause ignores the text')
  const unknown = rev('result_unknown', base, { id: 'att-1', at: 1 })
  assert.equal(rev('result_unknown', null, { id: 'att-1', at: 1 }), unknown)
  assert.notEqual(rev('result_unknown', base, { id: 'att-2', at: 2 }), unknown)
  assert.match(askRev('gone', 'not_in_contribute', null), token)
})

test('publication_changed is keyed on the attempt and source, never on a timestamp; a possibly-public send is not an ask', () => {
  const base = { id: 'one', type: 'pr', status: 'prepared', updated_at: '2026-10-20T10:00:00Z', submit_started_at: '2026-10-20T09:59:00Z',
    personal_submit_input_sha256: 'e'.repeat(64), last_submit_stage: 'pushed', last_submit_push_sha: 'a'.repeat(40),
    plan: { head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40), diff_sha256: 'd'.repeat(64) } }
  const rev = record => askRev('one', 'publication_changed', record)
  assert.equal(rev({ ...base, updated_at: '2026-10-20T12:00:00Z' }), rev(base))
  assert.notEqual(rev({ ...base, submit_started_at: '2026-10-20T13:00:00Z' }), rev(base), 'another attempt')
  assert.notEqual(rev({ ...base, plan: { ...base.plan, head_sha: 'c'.repeat(40) } }), rev(base), 'another source')
  assert.ok(cardAsk('one', 'publication_changed', rev(base)))
  assert.equal(holdCode({ ...base, last_submit_error: 'The branch was pushed.' }), '', 'checking, not send_failed')
  assert.equal(holdCode({ ...base, last_submit_stage: '', last_submit_error: 'Rejected.' }), 'send_failed')
})
