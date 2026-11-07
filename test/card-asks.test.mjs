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

test('the state token is the reviewed head, or a digest that changes with the failure or attempt', () => {
  const rev = (...args) => askRev(...args)
  assert.equal(rev('r-1', 'needs_review', record()), HEAD)
  const failed = record({ last_submit_error: 'x', last_submit_error_code: 'commit_identity_mismatch', updated_at: '2026-11-07T01:00:00Z' })
  const failure = rev('r-1', 'commit_identity_mismatch', failed)
  assert.match(failure, /^[0-9a-f]{16}$/)
  assert.equal(rev('r-1', 'commit_identity_mismatch', structuredClone(failed)), failure, 'the same failure, the same token')
  assert.notEqual(rev('r-1', 'commit_identity_mismatch', { ...failed, updated_at: '2026-11-07T02:00:00Z' }), failure, 'a new failure')
  assert.notEqual(rev('r-1', 'send_failed', { ...failed, plan: { ...failed.plan, head_sha: 'b'.repeat(40) } }), failure, 'restaged')
  const unknown = rev('r-1', 'result_unknown', record(), { id: 'att-1', at: 1 })
  assert.equal(rev('r-1', 'result_unknown', null, { id: 'att-1', at: 1 }), unknown)
  assert.notEqual(rev('r-1', 'result_unknown', record(), { id: 'att-2', at: 2 }), unknown)
  assert.match(rev('gone', 'not_in_contribute', null), /^[0-9a-f]{16}$/)
  assert.match(rev('r-1', 'restage', record({ plan: { title: 'No head' } })), /^[0-9a-f]{16}$/)
})
