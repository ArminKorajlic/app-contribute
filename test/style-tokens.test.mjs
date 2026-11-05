import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const sheets = ['theme.js', 'workspace-theme.js', 'button-theme.js',
  ...readdirSync(new URL('ui/', root)).filter(name => name.endsWith('.jsx')).map(name => `ui/${name}`)]
  .map(file => [file, readFileSync(new URL(file, root), 'utf8')])

// DESIGN.md's token sheet: 5 radii and 4 type sizes, none under 14 px.
test('every corner radius and type size names a token, never a raw value', () => {
  const raw = []
  for (const [file, text] of sheets) {
    for (const match of text.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;}\n`]+)/g)) {
      if (/\d+(\.\d+)?(px|em)/.test(match[1].replace(/var\([^)]*\)/g, ''))) raw.push(`${file}: ${match[0]}`)
    }
    for (const match of text.matchAll(/font-size:\s*([^;}\n`]+)/g)) {
      if (/\d+(\.\d+)?px/.test(match[1])) raw.push(`${file}: ${match[0]}`)
    }
    for (const match of text.matchAll(/font:\s*(\d{3}\s+)?(\d+(\.\d+)?)px/g)) raw.push(`${file}: ${match[0]}`)
  }
  assert.deepEqual(raw, [])
})

test('the token sheet holds exactly five radii and four type sizes', () => {
  const theme = readFileSync(new URL('theme.js', root), 'utf8')
  const radii = [...theme.matchAll(/--co-radius-[a-z]+:\s*(\d+)px/g)].map(match => Number(match[1]))
  const sizes = [...theme.matchAll(/--co-text-[a-z]+:\s*(\d+)px/g)].map(match => Number(match[1]))
  assert.deepEqual(radii, [6, 8, 10, 12, 999])
  assert.deepEqual(sizes, [14, 16, 22, 28])
})

// The old per-screen button looks; a button now takes one of the three types in button-theme.js.
const RETIRED_BUTTONS = ['co-quiet-action', 'co-icon-btn', 'co-icon-action', 'co-btn-sm', 'co-btn-caution']
test('buttons use the three types, not the retired per-screen classes', () => {
  const found = sheets.flatMap(([file, text]) => RETIRED_BUTTONS.filter(name => new RegExp(`${name}(?![\\w-])`).test(text)).map(name => `${file}: ${name}`))
  assert.deepEqual(found, [])
})
