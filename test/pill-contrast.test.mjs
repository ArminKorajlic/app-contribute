import test from 'node:test'
import assert from 'node:assert/strict'
import { CSS } from '../theme.js'

// The shell's two palettes (platform theme.js DARK_COLORS / LIGHT_COLORS) and the caution amber.
const PALETTES = {
  dark: { '--bg': '#0d0d0d', '--surface': '#171717', '--surface-2': '#212121', '--text': '#ececec', '--accent': '#8b6cf7', '--danger': '#f87171', '--green': '#10b981', '--co-warn': '#b38235' },
  light: { '--bg': '#f0eeeb', '--surface': '#ffffff', '--surface-2': '#e8e6e2', '--text': '#1c1b1a', '--accent': '#8b6cf7', '--danger': '#ef4444', '--green': '#059669', '--co-warn': '#b38235' },
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const mix = (a, b, share) => a.map((value, i) => value * share + b[i] * (1 - share))
const channel = value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

// Each pill tone: its text token (or inline mix) and the tint the pill sits on, as the CSS declares them.
function pillRules() {
  const rules = []
  for (const match of CSS.matchAll(/\.co-desk-chip\.is-(you|blocker|waiting|ready|tone)\s*\{([^}]*)\}/g)) rules.push([match[1], match[2]])
  return rules
}
const share = text => Number(/color-mix\(in srgb,\s*[^,]+,\s*[^)]*\)\s*(\d+)%/.exec(text)?.[1] ?? NaN)

test('the five pill tones are all declared', () => {
  assert.deepEqual(pillRules().map(([tone]) => tone).sort(), ['blocker', 'ready', 'tone', 'waiting', 'you'])
})

const BASES = { you: '--accent', blocker: '--danger', waiting: '--co-warn', ready: '--green' }
// The share of --text a colour is mixed with: "color-mix(in srgb, <tone> 60%, var(--text))" or a token that holds one.
function textShare(declared) {
  let color = declared.trim()
  const token = /^var\((--co-[a-z-]+)\)$/.exec(color)?.[1]
  if (token) color = new RegExp(`${token}:\\s*([^;]+);`).exec(CSS)[1]
  const mixed = /color-mix\(in srgb,.*\s(\d+)%,\s*var\(--text\)\)\s*$/.exec(color)
  assert.ok(mixed, `colour ${color} is not a mix toward --text`)
  return Number(mixed[1]) / 100
}
// The share of its own tone a fill carries: "background: color-mix(in srgb, <tone> 14%, transparent)" or var(--accent-dim).
function fillShare(body, theme) {
  const given = /background:\s*color-mix\(in srgb,\s*.*?\s(\d+)%,\s*transparent\)/.exec(body)?.[1]
  if (given) return Number(given) / 100
  assert.match(body, /background:\s*var\(--accent-dim/, 'a fill is a tone tint or the accent tint')
  return { dark: 0.14, light: 0.08 }[theme]
}
const ruleBody = selector => CSS.split('\n').flatMap(line => (line.trimStart().startsWith(selector + ' {') ? [line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'))] : []))[0]

// Every pill look: the text tone, its text share, and the tint it sits on. `is-tone` pills take their tone from
// --tone, which is red, amber or purple; the attention tags and counts share that mix.
function cases() {
  const out = []
  for (const tone of Object.keys(BASES)) {
    const body = ruleBody(`.co-desk-chip.is-${tone}`)
    out.push({ name: `chip is-${tone}`, base: BASES[tone], text: body && /(?:^|[\s;])color:\s*([^;]+);/.exec(body)[1], body })
  }
  for (const [name, selector] of [['chip is-tone', '.co-desk-chip.is-tone'], ['attention reason', '.co-attention-reason, .co-attn-tag']]) {
    const body = ruleBody(selector)
    for (const base of ['--danger', '--co-warn', '--accent']) out.push({ name: `${name} (${base})`, base, text: /(?:^|[\s;])color:\s*([^;]+);/.exec(body)[1], body })
  }
  const counts = ruleBody('.co-attn-rs b')
  for (const base of ['--danger', '--co-warn', '--accent']) out.push({ name: `attention count (${base})`, base, text: /(?:^|[\s;])color:\s*([^;]+);/.exec(counts)[1], body: ruleBody('.co-attn') })
  return out
}

test('every pill look reads at 4.5:1 or better on its own tint, on every surface, in both themes', () => {
  const all = cases()
  assert.equal(all.length, 13, 'four fixed chips, then the toned chip, the attention tags and the count in red, amber and purple')
  for (const { name, base, text, body } of all) {
    const share = textShare(text)
    assert.ok(share >= 0.4 && share <= 0.8, `${name}: ${share} looks wrong`)
    for (const [theme, palette] of Object.entries(PALETTES)) {
      const mixed = mix(rgb(palette[base]), rgb(palette['--text']), share)
      // The attention bar tints with the accent, whatever tone its count has.
      const tint = name.startsWith('attention count') ? rgb(palette['--accent']) : rgb(palette[base])
      const own = fillShare(body, theme)
      for (const surface of ['--bg', '--surface', '--surface-2']) {
        const fill = mix(tint, rgb(palette[surface]), own)
        assert.ok(ratio(mixed, fill) >= 4.5, `${name} on ${surface} in ${theme}: ${ratio(mixed, fill).toFixed(2)}:1`)
      }
    }
  }
})

test('no pill or tone takes a raw amber', () => {
  assert.doesNotMatch(CSS, /#cf9526|#e0823d/i)
})
