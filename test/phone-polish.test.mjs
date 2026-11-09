import assert from 'node:assert/strict'
import test from 'node:test'
import { CSS } from '../theme.js'
import { showOpenTab } from '../ui/stripScroll.js'

const strip = (width, scrollLeft = 40) => ({ offsetLeft: 0, clientWidth: width, scrollLeft })
const tab = (left, width) => ({ offsetLeft: left, offsetWidth: width })

test('a tab strip starts at its first tab when the open tab fits, and scrolls only as far as it must when not', () => {
  const fits = strip(380)
  showOpenTab(fits, tab(120, 90))
  assert.equal(fits.scrollLeft, 0, 'nothing clipped on the left while the open tab is in view')
  const far = strip(380)
  showOpenTab(far, tab(400, 100))
  assert.equal(far.scrollLeft, 120, 'the open tab\'s right edge meets the strip\'s')
  assert.doesNotThrow(() => showOpenTab(null, tab(0, 10)))
})

test('the PR tabs, repo tabs and filter chips fade at the edge on a phone', () => {
  const rule = /@media\(max-width:680px\) \{\s*([^{}]*)\{[^}]*mask-image/.exec(CSS)?.[1] || ''
  for (const selector of ['.co-project-tabs', '.co-pr-filters', '.co-pr-detail .co-detail-tabs']) assert.ok(rule.includes(selector), `${selector} fades`)
})

test('the repo page\'s search toggle stays hidden while its field shows, whatever the button class says', () => {
  assert.match(CSS, /\.co-pr-list-controls \.co-pr-search-toggle \{ display:none; \}/)
  assert.doesNotMatch(CSS, /font-size: 0/, 'no label-hiding font-size hack is left')
})

test('the PR page\'s icon tooltips open above their buttons, off the facts line', () => {
  assert.match(CSS, /\.co-pr-detail-actions \.co-tip::after \{ top:auto; bottom:calc\(100% \+ 6px\); \}/)
})

test('on a phone a tooltip hangs from its button\'s right edge, so the longest one cannot push the page sideways', () => {
  // Centred under the last button of the PR page's action row, "Open chat · 3 where it started" ran
  // past the screen's edge: invisible, but it still made the whole page scroll sideways.
  assert.match(CSS, /@media \(max-width:680px\) \{ \.co-tip::after \{ left:auto; right:0; transform:none; \} \}/)
})

// The Actions menu: a popup above 680px, a sheet from the bottom edge below it (so it can never run off a side).
test('on a phone the Actions menu is a bottom sheet with a dimmed page and Cancel; above 680px neither shows', () => {
  assert.match(CSS, /\.co-agent-menu-scrim,\.co-agent-menu-list \.co-agent-menu-cancel \{ display:none; \}/, 'the popup has no scrim or Cancel')
  const phone = /@media\(max-width:680px\) \{\s*\.co-agent-menu-scrim \{[^}]*position:fixed[^}]*\}\s*\.co-agent-menu \.co-agent-menu-list,\.co-agent-menu\.is-align-start \.co-agent-menu-list \{([^}]*)\}/.exec(CSS)?.[1] || ''
  assert.match(CSS, /@media\(max-width:680px\) \{[^@]*\.co-agent-menu\.is-align-start \.co-agent-menu-list \{ position:fixed/, 'a start-aligned menu (the PR page) is the same full-width sheet, not shrunk by its popup rule')
  assert.match(phone, /position:fixed/)
  assert.match(phone, /bottom:0/)
  assert.match(phone, /left:0; right:0/, 'the sheet spans the screen, so no side can be cut off')
  assert.match(CSS, /\.co-agent-menu-list \.co-agent-menu-cancel \{ display:flex;/)
})

test('the Actions button has the strong edge on every width, in the one sheet that owns button borders', async () => {
  const { BUTTON_CSS } = await import('../button-theme.js')
  assert.match(BUTTON_CSS, /\n\.co-agent-menu-button \{ border-color: var\(--co-edge\); \}/)
  assert.match(CSS, /\.co-agent-menu-list \{ position:absolute;[^}]*border:1\.5px solid var\(--co-edge\)/, 'the desktop popup has the same edge as the phone sheet')
  assert.match(CSS, /--co-edge: color-mix\(in srgb, var\(--text\) 32%, var\(--border\)\)/)
})
