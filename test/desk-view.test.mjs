import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { DeskRail, DeskCounts, projectRailCount } from './ui/Desk.jsx'
    import { DeskView } from './ui/DeskViews.jsx'
    export { projectRailCount }
    export const rail = props => renderToStaticMarkup(React.createElement(DeskRail, props))
    export const counts = props => renderToStaticMarkup(React.createElement(DeskCounts, props))
    // Where each chip leads, found by pressing it (DeskCounts holds no hooks, so it can be called directly).
    export function chipDestinations(counts) {
      const destinations = {}
      let pressed = null
      for (const chip of DeskCounts({ counts, onView: view => { pressed = view } }).props.children) {
        chip.props.onClick()
        destinations[chip.props.children[1]] = pressed
      }
      return destinations
    }
    export const view = props => renderToStaticMarkup(React.createElement(DeskView, props))
  `)
  return renderer
}

const pullFixture = (number, extra = {}) => ({
  number,
  title: `Improve thing ${number}`,
  author: { login: 'teammate' },
  repository: { nameWithOwner: 'o/r' },
  labels: { nodes: [{ name: 'enhancement', color: 'a2eeef' }] },
  comments: { totalCount: 2 },
  headRefName: `head-${number}`,
  baseRefName: 'main',
  updatedAt: '2026-11-02T08:00:00Z',
  isDraft: false,
  additions: 10,
  deletions: 3,
  ...extra,
})

const projectFixture = (key, extra = {}) => ({
  key,
  name: key === 'mobius' ? 'Möbius' : key,
  kind: 'app',
  available: true,
  localFiles: 0,
  compatibleFiles: 0,
  conflictFiles: 0,
  workingFiles: 0,
  incomingReviews: [],
  reviewRequests: [],
  ...extra,
})

const countsFixture = { questions: 1, requests: 2, merge: 3, fix: 1, drafts: 0, editedFiles: 28, editProjects: 1, mine: 4, work: 5, merged: 0 }

test('the rail shows every view with its count and marks the open project', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { reviewRequests: [pullFixture(1)] })
  const html = api.rail({ view: 'needs', counts: countsFixture, projects: [project], attention: { mobius: 2 }, selectedKey: 'mobius', onView: () => {}, onOpenProject: () => {} })
  assert.match(html, /Needs you/)
  assert.match(html, /Merged this week/)
  assert.match(html, /Möbius/)
  // The project row shows exactly the count held for it (what its Needs you card lists).
  assert.equal(api.projectRailCount(project, { mobius: 3 }), 3)
  assert.equal(api.projectRailCount(project, {}), 0)
  assert.match(html, /aria-current="page"[^>]*>[\s\S]*?Möbius|Möbius[\s\S]*?aria-current/)
})

test('counts chips name next steps and skip empty edits', async t => {
  const api = await ui(t)
  if (!api) return
  const html = api.counts({ counts: countsFixture, onView: () => {} })
  assert.match(html, />Review</)
  assert.match(html, />Merge</)
  assert.match(html, /28 files/)
  const none = api.counts({ counts: { ...countsFixture, questions: 0, editedFiles: 0, requests: 0, merge: 0, fix: 0, drafts: 0 }, onView: () => {} })
  assert.equal(none, '')
})

test('every count chip leads to a view that lists what it counted', async t => {
  const api = await ui(t)
  if (!api) return
  // An approved draft opened outside Contribute: counted by Mark ready, with no saved decision behind it.
  const draft = pullFixture(9, { author: { login: 'owner' }, reviewDecision: 'APPROVED', isDraft: true })
  const project = projectFixture('kanban', { incomingReviews: [draft] })
  const counts = { ...countsFixture, questions: 0, requests: 0, merge: 0, fix: 0, editedFiles: 0, drafts: 1, mine: 1, work: 0 }
  const view = api.chipDestinations(counts)['Mark ready']
  const html = api.view({ view, projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  assert.match(html, /Improve thing 9/)
  assert.match(html, /Approved, still a draft/)
})

test('a side view keeps each app inside one card with its own name and Open', async t => {
  const api = await ui(t)
  if (!api) return
  const asked = pullFixture(1915, { updatedAt: '2026-11-02T08:00:00Z' })
  const project = projectFixture('mobius', { reviewRequests: [asked], incomingReviews: [asked] })
  const html = api.view({
    view: 'requests', projects: [project, projectFixture('quietapp')], records: [], login: 'owner',
    decisionsFor: () => [], lastLooked: '2026-11-01T00:00:00Z', query: '',
    onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {},
  })
  assert.match(html, /co-envelope/)
  assert.match(html, /Möbius/)
  assert.match(html, /Improve thing 1915/)
  assert.match(html, /Asks for your review/)
  assert.match(html, /enhancement/)
  // Changed after the last visit, so the quiet dot is on.
  assert.match(html, /co-newdot/)
  // The quiet app has nothing to show, so it gets no card at all.
  assert.doesNotMatch(html, /quietapp/)
})

test('my PRs read as a stack in merge order when they chain', async t => {
  const api = await ui(t)
  if (!api) return
  const mine = [
    pullFixture(44, { author: { login: 'owner' }, baseRefName: 'head-43' }),
    pullFixture(43, { author: { login: 'owner' } }),
  ]
  const project = projectFixture('kanban', { incomingReviews: mine })
  const html = api.view({
    view: 'mine', projects: [project], records: [], login: 'owner',
    decisionsFor: () => [], lastLooked: '', query: '',
    onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {},
  })
  assert.match(html, /1 of 2/)
  assert.match(html, /2 of 2/)
  assert.match(html, /Waiting on reviewers/)
})

test('the search filters rows and an empty view explains itself', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { reviewRequests: [pullFixture(7)] })
  const base = { view: 'requests', projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  assert.match(api.view({ ...base, query: 'thing 7' }), /Improve thing 7/)
  assert.doesNotMatch(api.view({ ...base, query: 'zzz' }), /co-envelope/)
  assert.match(api.view({ ...base, query: 'zzz' }), /Nothing matches your search/)
})

test('a project name in the search keeps that project’s rows in every view, and an author name finds their PRs', async t => {
  const api = await ui(t)
  if (!api) return
  const authored = pullFixture(5, { author: { login: 'owner' }, reviewDecision: 'CHANGES_REQUESTED' })
  const project = projectFixture('kanban', {
    canonical_repo: 'o/r', incomingReviews: [authored, pullFixture(6, { author: { login: 'owner' }, reviewDecision: 'CHANGES_REQUESTED' })], reviewRequests: [pullFixture(7, { author: { login: 'reviewer-person' } })],
  })
  const other = projectFixture('pages', { incomingReviews: [pullFixture(8, { author: { login: 'owner' }, reviewDecision: 'CHANGES_REQUESTED' })] })
  const feedback = { id: 'f5', kind: 'public_attention', label: 'Feedback on five', record: { repo: 'o/r', number: 5 } }
  const merged = { id: 'm1', repo: 'o/r', status: 'merged', title: 'Landed work', number: 3, updated_at: new Date().toISOString() }
  const base = { projects: [project, other], records: [merged], login: 'owner', decisionsFor: item => (item === project ? [feedback] : []), lastLooked: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  const found = { requests: /Improve thing 7/, needs: /Feedback on five[\s\S]*Improve thing 6/, mine: /Improve thing 5/, work: /Feedback on five/, merged: /Landed work/ }
  for (const [view, expected] of Object.entries(found)) {
    const html = api.view({ ...base, view, query: 'kanban' })
    assert.match(html, expected, view)
    // The other project's rows stay out: the name narrows the list.
    assert.doesNotMatch(html, /Improve thing 8/, view)
  }
  // The advertised person search reaches a PR's displayed author.
  assert.match(api.view({ ...base, view: 'requests', query: 'reviewer-person' }), /Improve thing 7/)
  assert.match(api.view({ ...base, view: 'mine', query: 'owner' }), /Improve thing 5/)
  assert.match(api.view({ ...base, view: 'needs', query: 'nobody-here' }), /Nothing matches your search/)
})

test('each app card folds with a chevron: down means open it, up means fold it', async t => {
  const api = await ui(t)
  if (!api) return
  const base = { view: 'requests', records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  const two = api.view({ ...base, projects: [projectFixture('mobius', { reviewRequests: [pullFixture(7), pullFixture(8)] })] })
  assert.match(two, /class="co-envelope-toggle"[^>]*aria-expanded="true"[^>]*aria-label="Collapse Möbius"/)
  assert.match(two, /Improve thing 7/)
  // One row has nothing to fold away.
  const one = api.view({ ...base, projects: [projectFixture('mobius', { reviewRequests: [pullFixture(7)] })] })
  assert.doesNotMatch(one, /co-envelope-toggle/)
})

test('a PR with a feedback card is listed once in Needs you, and My PRs keeps it', async t => {
  const api = await ui(t)
  if (!api) return
  const authored = pullFixture(5, { author: { login: 'owner' }, reviewDecision: 'CHANGES_REQUESTED' })
  const quiet = pullFixture(6, { author: { login: 'owner' }, reviewDecision: 'CHANGES_REQUESTED' })
  const project = projectFixture('mobius', { incomingReviews: [authored, quiet] })
  const feedback = { id: 'f5', kind: 'public_attention', label: 'Feedback on five', record: { repo: 'o/r', number: 5 } }
  const base = { projects: [project], records: [], login: 'owner', decisionsFor: () => [feedback], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  const needs = api.view({ ...base, view: 'needs' })
  assert.equal((needs.match(/Improve thing 5/g) || []).length, 0)
  assert.match(needs, /Feedback on five/)
  // A PR with no feedback card still gets its own row.
  assert.match(needs, /Improve thing 6/)
  assert.match(api.view({ ...base, view: 'mine' }), /Improve thing 5/)
})

test('Your edits shows the fact once: no second Open, and it says what the files do', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { localFiles: 3, compatibleFiles: 3 })
  const html = api.view({ view: 'edits', projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  assert.doesNotMatch(html, /on this Möbius/)
  assert.match(html, /differ from GitHub/)
  assert.equal((html.match(/>Open</g) || []).length, 1)
})

test('the new-dot legend shows only when a dot is on screen', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-desk-legend \{ display:none/)
  assert.match(css, /\.co-desk-pane:has\(\.co-desk-row \.co-newdot\) \.co-desk-legend \{ display:flex/)
})

test('the project status is one panel of equal rows, with real buttons and icons, never a text link', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-project-position \{ margin:12px 0 16px; border:1px solid var\(--border\); border-radius:12px;/)
  assert.match(css, /\.co-status-row \{ display:flex; align-items:center; gap:12px; min-height:56px;/)
  assert.match(css, /\.co-status-actions \.co-btn \{ gap:8px; height:40px; min-height:40px;/)
  assert.doesNotMatch(css, /co-link-action/)
})

test('a feedback card is shaped like a PR row: title, why, chip, no second button', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius')
  const item = { id: 'f1', kind: 'public_attention', label: '#9 Feedback title', detail: 'A GitHub review requested changes.', record: { repo: 'o/r', number: 9, attention: { type: 'changes_requested', detected_at: '2026-11-02T08:00:00Z' } } }
  const html = api.view({ view: 'work', projects: [project], records: [], login: 'owner', decisionsFor: () => [item], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  assert.match(html, /class="co-desk-row is-changes"/)
  assert.match(html, /co-desk-row-title">#9 Feedback title/)
  assert.match(html, /co-desk-row-why">A GitHub review requested changes\./)
  assert.match(html, /co-desk-chip is-tone">Changes requested/)
  assert.doesNotMatch(html, /View PR/)
})

test('rail badges mark only what waits on you; information shows a quiet number', async t => {
  const api = await ui(t)
  if (!api) return
  const html = api.rail({ view: 'needs', counts: countsFixture, projects: [], attention: {}, selectedKey: '', onView: () => {}, onOpenProject: () => {} })
  assert.match(html, /co-rail-count is-you">7</)
  assert.match(html, /co-rail-quiet" title="28 edited files">28</)
  assert.match(html, /Merged this week<\/span>/)
  // Edits, My PRs and Merged are quiet numbers, never pills.
  assert.equal((html.match(/co-rail-quiet/g) || []).length, 2)
})

test('the sync note says only when it last checked, or that GitHub could not be reached', () => {
  const guard = readFileSync(new URL('../ui/GithubParts.jsx', import.meta.url), 'utf8')
  assert.match(guard, /note\.outcome\?\.ok \? <TimeAgo prefix="Checked " value=\{note\.at\} \/> : 'Couldn’t reach GitHub'/)
  const theme = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
  // Beside the button on a wide header; a phone header has no room for it.
  assert.match(theme, /\.co-toolbar-refresh span, \.co-sync-note \{ display: none; \}/)
})

test('list labels are a dot and plain text, two at most, and a bot says bot', async t => {
  const html = await (async () => {
    if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
    const mod = await renderModule(`
      import React from 'react'
      import { renderToStaticMarkup } from 'react-dom/server'
      import { QuietLabels, PullStateChips } from './ui/GithubParts.jsx'
      export const labels = pr => renderToStaticMarkup(React.createElement(QuietLabels, { pr }))
      export const chips = pr => renderToStaticMarkup(React.createElement(PullStateChips, { pr }))
    `)
    return mod
  })()
  if (!html) return
  const node = (name, color = '0075ca') => ({ name, color })
  const human = html.labels({ author: { login: 'owner' }, labels: { nodes: [node('area: ui'), node('bug', 'd73a4a'), node('maintenance')] } })
  assert.match(human, /<i aria-hidden="true"><\/i>ui</)
  assert.doesNotMatch(human, /area:/)
  assert.match(human, /is-more" title="maintenance">\+1</)
  assert.equal((human.match(/co-quiet-label"/g) || []).length, 2)
  const bot = html.labels({ author: { login: 'dependabot' }, labels: { nodes: [node('dependencies'), node('javascript')] } })
  assert.match(bot, /is-bot">bot</)
  assert.doesNotMatch(bot, /dependencies/)
  const chips = html.chips({ isDraft: true, reviewDecision: 'APPROVED' })
  assert.match(chips, /co-desk-chip">Draft</)
  assert.match(chips, /co-desk-chip is-ready">Approved</)
})

test('rows keep their checkbox and Assign out of sight until wanted, and the header checkbox stays', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-pr-row \.co-pr-select \{ opacity:0/)
  // Keyboard focus reveals them; a mouse user who closed a picker is not left with them showing.
  assert.match(css, /html\[data-input="keyboard"\] \.co-pr-row:has\(:focus-visible\) \.co-pr-select/)
  assert.match(css, /\.co-pr-row\.is-assigning \.co-pr-assign\.is-quiet \{ opacity:1/)
  assert.match(css, /\.co-pr-assign\.is-quiet \{ opacity:0/)
  assert.match(css, /@media \(hover:none\) \{ \.co-pr-row \.co-pr-select, \.co-pr-assign\.is-quiet \{ opacity:1/)
  assert.doesNotMatch(css, /\n\.co-pr-select \{ opacity:0/)
})

test('state chips sit beside the title, and the hover Assign is an icon so the row keeps its width', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-pr-headline \{ display:flex;[^}]*justify-content:space-between/)
  assert.match(css, /\.co-pr-assign\.is-quiet span \{ display:none; \}/)
  assert.match(css, /\.co-pr-assign\.is-quiet span \{ display:inline; \}/)
})

test('labels sit on their own line under the meta line, in list rows and desk rows', () => {
  const list = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  assert.match(list, /<div className="co-pr-meta">[\s\S]*?<\/div>\s*<div className="co-pr-labels"><QuietLabels pr=\{pr\} \/><\/div>/)
  const desk = readFileSync(new URL('../ui/DeskViews.jsx', import.meta.url), 'utf8')
  assert.match(desk, /<\/span>\s*<span className="co-pr-labels"><QuietLabels pr=\{pr\} \/><\/span>/)
})

test('the attention bar does not sit inside a second border', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-decisions:has\(> \.co-attn:only-child\) \{ border:0; overflow:visible; \}/)
})

test('a row only counts as assigning while the picker pane is actually open', () => {
  const list = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  // The pane's own close button leaves the assigning state set; the pane being open is what counts.
  assert.match(list, /assignAnchor === key && task\?\.activeId === 'task:assign' \? ' is-assigning'/)
})

test('the attention bar toggle has no frame and swaps its word with the chevron', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  const toggle = css.match(/\.co-attn-toggle \{[^}]*\}/)?.[0] || ''
  assert.ok(toggle && !/border|background/.test(toggle))
  assert.match(css, /\.co-attn-hide, \.co-attn\[open\] \.co-attn-show \{ display:none; \}/)
  assert.match(css, /\.co-attn\[open\] \.co-attn-toggle \.co-icon \{ transform:rotate\(180deg\)/)
})

test('attention rows and the show-more control stay inside the bar', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-attention-row \{ box-sizing:border-box;/)
  assert.match(css, /\.co-attn-more \{ box-sizing:border-box;/)
})
