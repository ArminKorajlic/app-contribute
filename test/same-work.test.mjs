import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { COMPARE_FILE_LIMIT, sameWorkOf } from '../same-work.js'

const { cases } = JSON.parse(readFileSync(new URL('./same-work.cases.json', import.meta.url), 'utf8'))

test('every shared case says whether the PR’s own work is the same, or that it cannot tell', () => {
  for (const { name, approved, head, expect } of cases) assert.equal(sameWorkOf(approved, head), expect, name)
})

test('a comparison that may have been cut off at GitHub’s file limit cannot say the work is the same', () => {
  const files = count => Array.from({ length: count }, (_, index) => ({ filename: `f${index}.js`, status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+x' }))
  assert.equal(sameWorkOf({ files: files(COMPARE_FILE_LIMIT) }, { files: files(COMPARE_FILE_LIMIT) }), null)
  assert.equal(sameWorkOf({ files: files(COMPARE_FILE_LIMIT - 1) }, { files: files(COMPARE_FILE_LIMIT - 1) }), true)
})
