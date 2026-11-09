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
    // Inline styles in JSX write camelCase: fontSize: 10, fontSize: '11px', borderRadius: 4, fontSize: Math.round(size * 0.5).
    for (const match of text.matchAll(/\b(fontSize|borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius):\s*([^,}\n]+)/g)) {
      if (!/var\(--co-/.test(match[2])) raw.push(`${file}: ${match[0]}`)
    }
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

// A control is 44 px tall (--co-control-height). These ones are named; the rest of the list is the
// known shorter ones (inputs, labels, rows) that a later pass may lift. A new rule under 44 fails here.
test('the segment bar, filter chips, count chips, rail rows and lens tabs take the control height token', () => {
  const css = sheets.map(([, text]) => text).join('\n')
  for (const selector of ['.co-seg button', '.co-pr-filters button', '.co-desk-counts button', '.co-rail-item', '.co-lens-nav button']) {
    const rule = css.split('\n').flatMap(line => (line.trimStart().startsWith(selector + ' {') ? [line] : [])).join('\n')
    assert.match(rule, /min-height:\s*var\(--co-control-height\)/, `${selector} must be var(--co-control-height) tall`)
  }
})

const SHORTER_THAN_A_CONTROL = ['.co-source-group-label', '.co-agent-chat-link', '.co-prior-work-details > summary', '.co-plan-label', '.co-files-head',
  '.co-review-project > header', '.co-review-default', '.co-pr-search', '.co-workspace .co-pr-search input', '.co-pr-select', '.co-pr-agent-state',
  '.co-pr-requested', '.co-split .co-split-main', '.co-rail-quiet > summary', '.co-desk-chips .co-desk-chips-projects', '.co-desk-search', '.co-desk-back',
  '.co-file-tools input', '.co-set-row .co-btn', '.co-prompt-choices button', '.co-alert']
test('no new rule gives a control a min-height under 44 px', () => {
  const found = []
  for (const [file, text] of sheets) {
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const px = /(?:^|[;\s])min-height:\s*(\d+)px/.exec(match[2])?.[1]
      if (px && Number(px) < 44 && !SHORTER_THAN_A_CONTROL.some(name => match[1].includes(name))) found.push(`${file}: ${match[1].trim().split('\n').pop().slice(0, 70)} => ${px}px`)
    }
  }
  assert.deepEqual(found, [])
})
