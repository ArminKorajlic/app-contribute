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
