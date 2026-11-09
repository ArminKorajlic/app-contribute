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

// One mark, one meaning (finding L14): the five places that shared a mark with something else.
test('the files button, the requests empty state, Take over, merged rows and Respond each have their own mark', async () => {
  const { AGENT_MENU, YOUR_INTENTS } = await import('../actions-menu.js')
  const { DESK_VIEWS } = await import('../desk.js')
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const viewIcon = key => DESK_VIEWS.find(view => view.key === key).icon
  assert.match(read('ui/ProjectControls.jsx'), /aria-label="See the files"[^>]*><Icon name="file"/, 'the files button is a file, not the Needs you eye')
  assert.match(read('ui/DeskViews.jsx'), new RegExp(`requests: \\{ icon: '${viewIcon('requests')}'`), 'the empty Review requests page shows its own view mark')
  assert.match(read('ui/DeskViews.jsx'), /<Icon name="merge"[^>]*co-desk-merged-icon/, 'a merged row shows the merge mark, not a tick')
  const agent = Object.fromEntries(Object.entries(AGENT_MENU))
  assert.ok(YOUR_INTENTS.size > 0)
  assert.notEqual(agent.take_over, agent.finish_it, 'Take over is not the Finish it wrench')
  assert.ok(![...DESK_VIEWS.map(view => view.icon)].includes(agent.respond), 'Respond is not any view\'s mark (Review requests is the bubble)')
  for (const name of ['file', 'reply', 'takeover']) assert.ok(known.has(name), `${name} is in the icon set`)
})
