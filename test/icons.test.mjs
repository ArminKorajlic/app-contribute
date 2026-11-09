import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

// An icon name the set does not know renders as nothing, so a button can look empty.
const root = new URL('../', import.meta.url)
const icons = readFileSync(new URL('ui/Icons.jsx', root), 'utf8')
const keysIn = block => new Set([...block.matchAll(/^\s{2}['"]?([\w-]+)['"]?:/gm)].map(match => match[1]))
const known = new Set([
  ...keysIn(icons.slice(icons.indexOf('const SDK_ICONS'), icons.indexOf('}', icons.indexOf('const SDK_ICONS')))),
  ...keysIn(icons.slice(icons.indexOf('const PATHS'), icons.indexOf('\n}\n', icons.indexOf('const PATHS')))),
  ...keysIn(icons.slice(icons.indexOf('const OCTICONS'), icons.indexOf('\n}\n', icons.indexOf('const OCTICONS')))),
  'github',
])

test('every icon a component names exists in the icon set', () => {
  const files = [...readdirSync(new URL('ui/', root)).filter(name => name.endsWith('.jsx')).map(name => `ui/${name}`), 'index.jsx']
  const missing = []
  for (const file of files) {
    const source = readFileSync(new URL(file, root), 'utf8')
    for (const match of source.matchAll(/<Icon name="([\w-]+)"/g)) if (!known.has(match[1])) missing.push(`${file}: ${match[1]}`)
  }
  assert.deepEqual(missing, [])
})
