// The look of a PR: soft label and state colours, icon buttons that name
// themselves in a tooltip, one window head, and a window whose steps follow
// the "Who sees the result?" choice.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'
import { reviewWindowCopy } from '../review-copy.js'

let renderer
async function load(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { contrastRatio, labelColors, PullStateBadge } from './ui/GithubParts.jsx'
    import { CloseWindowButton, WindowHead } from './ui/WindowHead.jsx'
    import { WHO_OPTIONS } from './ui/ReviewConfirmation.jsx'
    const html = (component, props) => renderToStaticMarkup(React.createElement(component, props))
    export { contrastRatio, labelColors, WHO_OPTIONS }
    export const badge = pr => html(PullStateBadge, { pr })
    export const head = ({ withClose, ...props }) => html(WindowHead, { ...props, tools: withClose ? React.createElement(CloseWindowButton, { onClick() {} }) : null })
  `)
  return renderer
}

const rgb = value => value.match(/\d+/g).map(Number)
const GITHUB_COLOURS = ['d73a4a', 'a2eeef', '0e8a16', '1d76db', '0075ca', '5319e7', 'fbca04', 'e4e669', 'cfd3d7', '7057ff', 'd876e3', '008672', '000000', 'ffffff']
const SURFACE = { dark: [23, 23, 23], light: [255, 255, 255] }

test('a label is 70% of its GitHub colour mixed into the page, with text that reads on it, in both themes', async t => {
  const mod = await load(t)
  if (!mod) return
  for (const hex of GITHUB_COLOURS) {
    const vars = mod.labelColors(hex)
    const source = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16))
    for (const theme of ['dark', 'light']) {
      const fill = rgb(vars[`--co-label-${theme}-bg`])
      assert.deepEqual(fill, source.map((channel, at) => Math.round(channel * 0.7 + SURFACE[theme][at] * 0.3)), `${hex} on ${theme} is 70% colour, 30% surface`)
      assert.ok(mod.contrastRatio(rgb(vars[`--co-label-${theme}-fg`]), fill) >= 4.5, `${hex} text reads on its ${theme} fill`)
    }
  }
  assert.equal(mod.labelColors('not-a-colour'), null)
})

test('a fill that would vanish into the page keeps a hairline, and others have none', async t => {
  const mod = await load(t)
  if (!mod) return
  assert.equal(mod.labelColors('000000')['--co-label-dark-edge'], 'rgba(255,255,255,0.28)')
  assert.equal(mod.labelColors('ffffff')['--co-label-light-edge'], 'rgba(0,0,0,0.28)')
  assert.equal(mod.labelColors('d73a4a')['--co-label-dark-edge'], 'transparent')
})

test('the Open, Draft, Merged and Closed pills use the same soft fill as labels and keep readable text', async t => {
  const mod = await load(t)
  if (!mod) return
  const states = { open: {}, draft: { isDraft: true }, merged: { state: 'MERGED' }, closed: { state: 'CLOSED' } }
  for (const [state, pr] of Object.entries(states)) {
    const html = mod.badge(pr)
    assert.match(html, new RegExp(`class="co-gh-badge is-${state}"`))
    for (const theme of ['dark', 'light']) {
      const fill = html.match(new RegExp(`--co-label-${theme}-bg:(rgb\\([^)]*\\))`))?.[1]
      const text = html.match(new RegExp(`--co-label-${theme}-fg:(rgb\\([^)]*\\))`))?.[1]
      assert.ok(fill && text, `${state} carries its ${theme} colours`)
      assert.ok(mod.contrastRatio(rgb(text), rgb(fill)) >= 4.5, `${state} text reads on ${theme}`)
    }
  }
})

test('an icon-only button names itself after 2 s of hover, at once on keyboard focus, and while a finger holds it', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-tip::after \{ content:attr\(data-tip\);/)
  assert.match(css, /\.co-tip:hover::after \{ opacity:1; transition-delay:2s; \}/)
  assert.match(css, /\.co-tip:focus-visible::after \{ opacity:1; transition-delay:0s; \}/)
  assert.match(css, /@media \(hover:none\) \{.*\.co-tip:active::after \{ opacity:1; transition-delay:0s; \}/)
  // Reduced motion shortens the fade, never the 2 s wait that stops a tooltip flashing past.
  assert.match(css, /prefers-reduced-motion:reduce\) \{ \.co-tip::after \{ transition-duration:0s; \}/)
})

test('Escape hides an icon button tooltip until the pointer or focus leaves that button', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-pr-detail-actions\.is-tips-off \.co-tip::after \{ opacity:0; transition-delay:0s; \}/)
  const hook = readFileSync(new URL('../ui/useTipDismiss.js', import.meta.url), 'utf8')
  assert.match(hook, /event\.key === 'Escape'\) setDismissed\(true\)/)
  assert.match(hook, /onPointerOut: event => /)
  assert.match(hook, /onBlur: rearm/)
  const detail = readFileSync(new URL('../ui/PullRequestDetail.jsx', import.meta.url), 'utf8')
  assert.match(detail, /className=\{'co-pr-detail-actions' \+ tips\.className\} onPointerOut=\{tips\.onPointerOut\} onBlur=\{tips\.onBlur\}/)
})

test('every agent and confirm window starts with the same head: the job, then #number and name, then the repository', async t => {
  const mod = await load(t)
  if (!mod) return
  const pr = { number: 1923, title: 'Example PR name', repository: { nameWithOwner: 'team/repo' } }
  const one = mod.head({ icon: 'review', title: 'Review', titleId: 'x', pulls: [pr], withClose: true })
  assert.match(one, /<h3 id="x">Review<\/h3><p class="co-rw-pr"><strong>#1923 Example PR name<\/strong><span>team\/repo<\/span><\/p>/)
  assert.match(one, /class="co-rw-tools"><button[^>]*aria-label="Close"/)
  const several = mod.head({ icon: 'review', title: 'Review', pulls: [pr, { ...pr, number: 2 }] })
  assert.match(several, /<strong>2 PRs<\/strong>/)
  const dir = new URL('../ui/', import.meta.url)
  const own = readdirSync(dir).filter(file => file.endsWith('.jsx') && file !== 'WindowHead.jsx')
    .filter(file => readFileSync(new URL(file, dir), 'utf8').includes('className="co-rw-head'))
  assert.deepEqual(own, [], 'a window that draws its own head can drift from the other three lines')
})

test('what happens follows the Who sees the result choice, in the order the agent does it', async t => {
  const mod = await load(t)
  if (!mod) return
  const copyFor = key => {
    const options = mod.WHO_OPTIONS[key]
    return reviewWindowCopy({ mode: 'review', posting: options.post_review, verdict: options.propose_verdict, agentPosts: options.agent_submits_verdict })
  }
  const steps = key => copyFor(key).steps.map(step => step.text)
  const priv = steps('private')
  assert.equal(priv.length, 3)
  assert.match(priv[0], /reads the PR/)
  assert.match(priv[1], /writes its findings/)
  assert.match(priv[2], /asks you first/)
  const draft = steps('draft')
  assert.equal(draft.length, 4)
  assert.match(draft[2], /drafts a verdict .* You send it/, 'drafting adds its step before the question step')
  assert.match(draft[3], /asks you first/)
  const agent = steps('agent')
  assert.match(agent[2], /posts its verdict on the PR from your account/, 'letting the agent post replaces the draft step')
  assert.notEqual(draft[2], agent[2])
  const merging = reviewWindowCopy({ mode: 'review_merge', posting: true, verdict: true }).steps.map(step => step.text)
  assert.match(merging[2], /drafts a verdict/)
  assert.match(merging[3], /merges the PR or adds it to the merge queue/)
  assert.match(merging[4], /asks you first/)
})
