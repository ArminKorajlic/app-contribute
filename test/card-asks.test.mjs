import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACCOUNT_CODES, ASK_CODES, cardAsk, holdCode } from '../card-asks.js'

const HEAD = 'a'.repeat(40)
const record = (extra = {}) => ({ id: 'r-1', status: 'prepared', plan: { head_sha: HEAD, title: 'Title' },
  quality_review: { state: 'all_clear', reviewed_head_sha: HEAD }, ...extra })

test('an ask names exactly one record and its code, and no words of the card\'s own', () => {
  for (const code of ASK_CODES) {
    assert.deepEqual(cardAsk('r-1', code), { refs: [{ id: 'r-1', code }] })
    assert.match(code, /^[a-z][a-z0-9_]{1,47}$/, 'the host\'s code grammar')
  }
  assert.equal(cardAsk('r-1', 'github_reconnect'), null, 'the account is never an ask')
  assert.equal(cardAsk('r-1', 'anything_else'), null)
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
