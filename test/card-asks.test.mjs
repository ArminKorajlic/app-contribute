import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACCOUNT_CODES, ASK_CODES, askTitle, cardAsk, holdCode } from '../card-asks.js'

const HEAD = 'a'.repeat(40)
const record = (extra = {}) => ({ id: 'r-1', status: 'prepared', plan: { head_sha: HEAD, title: 'Title' },
  quality_review: { state: 'all_clear', reviewed_head_sha: HEAD }, ...extra })

test('a title becomes one quoted plain line with nothing a chat message renders or hides', () => {
  assert.equal(askTitle('Calmer in-chat send states'), '“Calmer in-chat send states”')
  assert.equal(askTitle('Use `x_y` in **[docs](https://a.b)** <tag> @me www.site.org\nnext'), '“Use x y in docs (https a.b) tag me www site.org next”')
  assert.equal(askTitle('   '), 'this contribution')
  assert.equal(askTitle(null), 'this contribution')
  assert.equal(askTitle('x'.repeat(300)).length, 122)
})

test('every code has a fixed template and an ask names exactly one record', () => {
  for (const code of ASK_CODES) {
    const ask = cardAsk('r-1', code, 'Title')
    assert.equal(ask.label, 'Fix in chat')
    assert.ok(ask.text.length <= 400 && ask.text.includes('“Title”'), code)
    assert.deepEqual(ask.refs, [{ id: 'r-1', code }])
  }
  assert.equal(cardAsk('r-1', 'github_reconnect', 'Title'), null, 'the account is never an ask')
  assert.equal(cardAsk('r-1', 'anything_else', 'Title'), null)
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
