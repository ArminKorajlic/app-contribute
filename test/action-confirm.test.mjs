import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTION_COPY, allowedMergeMethods, mergeCopy, openForReviewCopy, methodToSend, postFindingsCopy } from '../action-copy.js'
import { isPersonalDraft } from '../domain.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const rollup = (state, count) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: count, checkRunCountsByState: [{ state, count }], statusContextCountsByState: [] } } } }] } })
const pr = (extra = {}) => ({ number: 9, title: 'Fix the thing', baseRefName: 'main', headRefOid: 'abcdef0123456789', mergeable: 'MERGEABLE', repository: { nameWithOwner: 'team/repo' }, ...rollup('SUCCESS', 21), ...extra })

test('opening for review says what happens, what GitHub shows now, and what it cannot undo', () => {
  const copy = openForReviewCopy(pr())
  assert.equal(copy.title, 'Open #9 for review?')
  assert.deepEqual(copy.facts.map(fact => `${fact.tone}:${fact.text}`), [
    'ok:Reviewers are asked to look at it',
    'ok:21 checks passed',
    'ok:No conflicts with main',
    'ok:You can turn it back into a draft later',
  ])
  assert.match(copy.footnote, /abcdef0/)
  assert.match(copy.footnote, /Nothing merges/)
  assert.equal(ACTION_COPY.open_for_review, openForReviewCopy)
})

test('failing, running or conflicting PRs warn but still may be opened for review', () => {
  const tones = extra => openForReviewCopy(pr(extra)).facts.filter(fact => fact.tone !== 'ok').map(fact => `${fact.tone}:${fact.text}`)
  assert.ok(tones({ ...rollup('FAILURE', 2) }).includes('warn:2 checks are failing'))
  assert.ok(tones({ ...rollup('PENDING', 3) }).includes('warn:Checks are still running'))
  assert.ok(tones({ mergeable: 'CONFLICTING' }).includes('bad:It conflicts with main'))
  assert.ok(!openForReviewCopy(pr({ commits: { nodes: [] } })).facts.some(fact => /check/i.test(fact.text)), 'no checks reported, no check line')
})

test('only a draft the owner opened with their own GitHub account can be opened for review', () => {
  assert.equal(isPersonalDraft({ status: 'draft', submission_mode: 'github' }), true)
  assert.equal(isPersonalDraft({ status: 'draft' }), true)
  assert.equal(isPersonalDraft({ status: 'draft', submission_mode: 'mobius-bot' }), false)
  assert.equal(isPersonalDraft({ status: 'open' }), false)
  assert.equal(isPersonalDraft(null), false)
})

test('the confirm sheet has one close affordance and one button that names the result', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render, icon } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    import { Icon } from './ui/Icons.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ActionConfirm, props))
    export const icon = name => renderToStaticMarkup(React.createElement(Icon, { name, size: 22 }))
  `)
  const html = render({ pr: pr(), copy: openForReviewCopy(pr()), onConfirm: () => {}, onClose: () => {} })
  assert.match(html, /<h3[^>]*>Open #9 for review\?<\/h3>/)
  assert.match(html, /#9 Fix the thing/)
  assert.match(html, />Open for review<\/button>/)
  assert.match(html, /aria-label="Close"/)
  assert.doesNotMatch(html, />Cancel</, 'the X is the only way out')
  assert.match(html, /You can turn it back into a draft later/)
  // Each action's words name their own icon, so no caller can show Merge with the arrow of Open for review.
  assert.ok(html.includes(icon('send')), 'open for review wears the send arrow')
  const merge = render({ pr: approved(), copy: mergeCopy(approved()), onConfirm: () => {}, onClose: () => {} })
  assert.ok(merge.includes(icon('merge')), 'merge wears the merge icon')
  assert.ok(!merge.includes(icon('send')), 'and not the arrow of another action')
})

import { mergePull, postFindings, previewPostedFindings, pullAction } from '../collaboration.js'
const markReadyPull = (token, appId, pr) => pullAction(token, appId, pr, 'ready')

const landable = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true }
const approved = (extra = {}) => pr({ reviewDecision: 'APPROVED', repository: { nameWithOwner: 'team/repo', ...landable }, ...extra })

const approvedBy = people => ({ standing: { approvedBy: people } })

test('Merge names what it lands, who approved this version, and that Contribute cannot undo it', () => {
  const copy = mergeCopy(approved(), approvedBy(['sam']))
  assert.equal(copy.title, 'Merge #9 into main?')
  assert.equal(copy.confirm, 'Squash and merge', 'squash is the platform\'s first choice when the repository allows it')
  assert.deepEqual(copy.facts.map(fact => `${fact.tone}:${fact.text}`), ['ok:Approved at this version by sam', 'ok:21 checks passed', 'ok:No conflicts with main'])
  assert.match(copy.footnote, /abcdef0/)
  assert.match(copy.footnote, /nothing is merged and you are told/)
  assert.match(copy.footnote, /cannot undo a merge/)
  assert.equal(ACTION_COPY.merge, mergeCopy)
})

test('the ways to land are the ones the repository allows, in the platform\'s order, asked only when there is a choice', () => {
  assert.deepEqual(allowedMergeMethods(landable), ['squash', 'merge', 'rebase'])
  assert.deepEqual(allowedMergeMethods({ mergeCommitAllowed: true }), ['merge'])
  assert.deepEqual(allowedMergeMethods({}), [])
  const many = mergeCopy(approved())
  assert.deepEqual(many.choices.options.map(option => option.key), ['squash', 'merge', 'rebase'])
  assert.equal(many.choices.value, 'squash')
  assert.match(many.choices.options[0].detail, /one commit on main/)
  assert.equal(mergeCopy(approved(), { method: 'rebase' }).confirm, 'Rebase and merge')
  assert.equal(mergeCopy(approved(), { method: 'nonsense' }).choices.value, 'squash', 'a method the repository does not allow is not honored')
  const one = mergeCopy(approved({ repository: { nameWithOwner: 'team/repo', mergeCommitAllowed: true } }))
  assert.equal(one.choices, null)
  assert.equal(one.confirm, 'Merge')
  assert.equal(mergeCopy(pr()).choices, null, 'unknown settings ask nothing; the platform picks')
})

test('a missing approval, failing checks or a conflict show as blockers, and your own review is named for this version', () => {
  const tones = (extra, people = ['sam']) => mergeCopy(approved(extra), approvedBy(people)).facts.filter(fact => fact.tone !== 'ok').map(fact => `${fact.tone}:${fact.text}`)
  assert.deepEqual(tones({}, []), ['bad:Nobody but the author has approved this version'], 'an approval of an older version, or none, is not one')
  assert.deepEqual(tones({ reviewDecision: null }, []), ['bad:Nobody but the author has approved this version'], 'GitHub asking for no review is not an approval')
  assert.deepEqual(tones({ ...rollup('FAILURE', 2) }), ['bad:2 checks are failing'])
  assert.deepEqual(tones({ mergeable: 'CONFLICTING' }), ['bad:It conflicts with main'])
  const status = (state, extra = {}) => ({ run: { state: 'complete', execution_state: 'completed' }, item: { state, ...extra } })
  const reviewLine = value => mergeCopy(approved(), { status: value }).facts.at(-1)
  assert.deepEqual(reviewLine(status('all_clear')), { tone: 'ok', text: 'Your agent’s review is clear for this version' })
  assert.deepEqual(reviewLine(status('needs_you', { summary: 'P1' })), { tone: 'warn', text: 'Your agent’s review found problems on this version' })
  const ignored = { 'o/r#1@x': { reason: 'Not a problem' } }
  const setAside = mergeCopy(approved(), { status: status('needs_you', { repo: 'o/r', number: 1, head_sha: 'x' }), ignored })
  assert.equal(setAside.facts.at(-1).text, 'No conflicts with main', 'a finding you set aside is not a warning')
})

test('the finished sheet says merged or queued, from what the platform answered', () => {
  const done = mergeCopy(approved()).done
  assert.deepEqual(done({ state: 'merged' }), { title: 'Merged', text: '#9 is now in main.' })
  assert.deepEqual(done({ state: 'queued' }), { title: 'Added to the merge queue', text: 'GitHub merges #9 into main when the queue reaches it.' })
})

test('Merge goes to the platform for this exact version and returns the outcome shapes the sheet reads', async () => {
  const sent = []
  const previous = globalThis.fetch
  const reply = (status, body) => async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: status < 400, status, json: async () => body } }
  try {
    globalThis.fetch = reply(200, { state: 'merged', merge_sha: 'c0ffee' })
    assert.deepEqual(await mergePull('t', 10, approved(), { method: 'squash' }), { ok: true, state: 'merged', mergeSha: 'c0ffee' })
    assert.equal(sent[0].url, '/api/github/contributions/10/pulls/merge')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789', method: 'squash' })
    await mergePull('t', 10, approved())
    assert.equal('method' in sent[1].body, false, 'no choice, no method: the platform picks')
    globalThis.fetch = reply(409, { detail: 'GitHub still requires a review or has requested changes.' })
    assert.deepEqual(await mergePull('t', 10, approved()), { error: 'GitHub still requires a review or has requested changes.' })
    globalThis.fetch = reply(502, { detail: { code: 'merge_unconfirmed', message: 'GitHub may have merged it. Check the pull request before trying again.' } })
    assert.deepEqual(await mergePull('t', 10, approved()), { pending: true, error: 'GitHub may have merged it. Check the pull request before trying again.' })
    globalThis.fetch = reply(404, {})
    assert.match((await mergePull('t', 10, approved())).error, /companion Möbius update/)
    globalThis.fetch = reply(404, { detail: 'Not Found' })
    assert.match((await mergePull('t', 10, approved())).error, /companion Möbius update/, 'a missing route is still the update hint')
    globalThis.fetch = reply(404, { detail: 'This pull request could not be read from GitHub. Check that GitHub is connected and that the pull request still exists.' })
    assert.deepEqual(await mergePull('t', 10, approved()), { error: 'This pull request could not be read from GitHub. Check that GitHub is connected and that the pull request still exists.' }, 'the platform’s own 404 reason is shown as it is')
  } finally { globalThis.fetch = previous }
})

test('the open Actions menu names its two groups only when there is something of your own to do', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionsMenu } from './ui/ActionsMenu.jsx'
    import { standingFor } from './pr-standing.js'
    export const render = (props, login = 'me') => renderToStaticMarkup(React.createElement(ActionsMenu, { defaultOpen: true, onChoose() {}, decisions: props.pulls.map(pr => standingFor({ pr, login })), ...props }))
  `)
  const reviews = { latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] } }
  const draft = pr({ isDraft: true, number: 122, state: 'OPEN', author: { login: 'me' }, ...reviews })
  const withYou = render({ pulls: [draft], record: { status: 'draft', submission_mode: 'github' }, capabilities: { merge_now: true } })
  assert.match(withYou, /role="group" aria-label="You"/)
  assert.match(withYou, /co-agent-menu-scrim/, 'the phone sheet dims the page behind it')
  assert.match(withYou, /co-agent-menu-cancel[^>]*>Cancel<\/button>/, 'and has a Cancel of its own')
  assert.match(withYou, /M10\.5 8\.5 15\.5 12l-5 3\.5Z/, 'the button wears the play icon, not three dots')
  assert.match(withYou, /role="group" aria-label="Agent"/)
  assert.ok(withYou.indexOf('Open for review') < withYou.indexOf('aria-label="Agent"'), 'your own actions come first')
  assert.match(withYou, /Open it for review first\./, 'Merge stays in place, dimmed, with its reason')
  // Close appears only where this Möbius can close for you; then it sits apart, red, after everything else of yours.
  const withClose = render({ pulls: [draft], record: { status: 'draft', submission_mode: 'github' }, capabilities: { merge_now: true, close_now: true } })
  assert.match(withClose, /co-agent-menu-apart"><button[^>]*data-danger="true"[^>]*class="[^"]*is-danger[^"]*"[^>]*><span class="co-agent-menu-tile">.*?Close pull request/, 'Close sits apart, marked destructive')
  assert.ok(withClose.indexOf('Close pull request') > withClose.indexOf('Merge'), 'and after every other choice of yours')
  assert.ok(withYou.indexOf('is-rec') > withYou.indexOf('aria-label="Agent"'), 'an unchecked draft of yours is checked first')
  const plain = render({ pulls: [pr({ state: 'OPEN', author: { login: 'sam' }, ...reviews })] })
  assert.doesNotMatch(plain, /aria-label="You"|co-agent-menu-group/, 'with nothing of your own the menu is the plain agent list')
  assert.match(plain, />Review</)
  assert.doesNotMatch(plain, /Respond to feedback|Address feedback/, 'their branch is not yours to fix')
})

test('Merge names a method only when the owner moved off the first allowed one', () => {
  const repo = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: false }
  assert.equal(methodToSend(repo, 'squash'), '', 'the default is left to the platform, so a merge queue is never given a method')
  assert.equal(methodToSend(repo, ''), '')
  assert.equal(methodToSend(repo, 'merge'), 'merge')
  assert.equal(methodToSend({ squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true }, 'merge'), '', 'the first allowed method is the default whichever it is')
})

// A fetch that records what was sent and answers with one status and body.
async function withFetch(reply, run) {
  const sent = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => { sent.push({ url, body: options?.body ? JSON.parse(options.body) : null }); const [status, body] = reply(url); return { ok: status < 400, status, json: async () => body } }
  try { await run(sent) } finally { globalThis.fetch = previous }
}

test('Open for review of a draft you wrote goes to the platform for this exact version and says what happened', async () => {
  const draft = pr({ isDraft: true })
  await withFetch(() => [200, { state: 'ready', observed_head_sha: 'abcdef0123456789' }], async sent => {
    assert.deepEqual(await markReadyPull('t', 10, draft), { ok: true, state: 'ready', observedHead: 'abcdef0123456789' })
    assert.equal(sent[0].url, '/api/github/contributions/10/pulls/ready')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789' })
  })
  await withFetch(() => [409, { detail: 'This pull request is not a draft any more.' }], async () => {
    assert.deepEqual(await markReadyPull('t', 10, draft), { error: 'This pull request is not a draft any more.' })
  })
  await withFetch(() => [502, { detail: { code: 'ready_unconfirmed', message: 'GitHub may have marked it ready. Check the pull request before trying again.' } }], async () => {
    assert.deepEqual(await markReadyPull('t', 10, draft), { pending: true, error: 'GitHub may have marked it ready. Check the pull request before trying again.' })
  })
})

test('the finished Open for review sheet warns when the PR moved while you looked', () => {
  const done = openForReviewCopy(pr()).done
  assert.deepEqual(done({ ok: true, observedHead: 'abcdef0123456789' }), { title: 'Open for review', text: 'Reviewers can see it now.' })
  assert.deepEqual(done({ ok: true }), { title: 'Open for review', text: 'Reviewers can see it now.' }, 'a platform that reports nothing is not read as a change')
  assert.match(done({ ok: true, observedHead: '1234567890abcdef' }).text, /It changed while you were looking: GitHub shows 1234567 now/)
})

const run = { id: 'run 1' }
const item = { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789' }

test('Post to GitHub reads the exact words first and posts them once, with the outcome shapes the sheet reads', async () => {
  const preview = { event: 'COMMENT', body: 'Three problems.', preview_sha256: 'f'.repeat(64), head_sha: 'abcdef0123456789' }
  await withFetch(() => [200, preview], async sent => {
    assert.deepEqual(await previewPostedFindings('t', 10, run, item), preview)
    assert.equal(sent[0].url, '/api/github/contributions/10/review-runs/run%201/post-preview')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789' })
  })
  await withFetch(() => [200, { state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1', review_id: 1 }], async sent => {
    assert.deepEqual(await postFindings('t', 10, run, item, preview), { ok: true, state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' })
    assert.equal(sent[0].url, '/api/github/contributions/10/review-runs/run%201/post')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789', preview_sha256: 'f'.repeat(64) }, 'the post names the words it was shown')
  })
  await withFetch(() => [409, { detail: 'The pull request changed since you looked. Refresh and check it again.' }], async () => {
    assert.deepEqual(await postFindings('t', 10, run, item, preview), { error: 'The pull request changed since you looked. Refresh and check it again.' })
  })
  await withFetch(() => [502, { detail: { code: 'post_unconfirmed', message: 'GitHub may have posted it. Check the pull request before trying again.' } }], async () => {
    assert.deepEqual(await postFindings('t', 10, run, item, preview), { pending: true, error: 'GitHub may have posted it. Check the pull request before trying again.' })
  })
  await withFetch(() => [409, { detail: 'There is nothing to post.' }], async () => {
    await assert.rejects(previewPostedFindings('t', 10, run, item), /There is nothing to post\./, 'a refused preview says why')
  })
})

test('the post sheet names what it posts, keeps its button off until the words arrive, and says why when refused', async t => {
  const target = pr({ number: 9 })
  const preview = { body: 'Three problems in the lost-reply path.', head_sha: 'abcdef0123456789', preview_sha256: 'f'.repeat(64) }
  const ready = postFindingsCopy(target, { preview, own: false })
  assert.equal(ready.title, 'Post this review on #9?')
  assert.deepEqual(ready.facts.map(fact => `${fact.tone}:${fact.text}`), ['ok:A comment on this PR, from your GitHub account', 'ok:Not an approval and not a request for changes', 'warn:Anyone who can see this PR can read it'])
  assert.deepEqual(ready.says, { label: 'What it would post', markdown: 'Three problems in the lost-reply path.' })
  assert.match(ready.footnote, /Posts exactly this text, once, at the version you reviewed \(abcdef0\)/)
  assert.match(ready.footnote, /Contribute cannot take it back/)
  assert.equal(ready.disabled, undefined)
  assert.match(postFindingsCopy(target, { preview, own: true }).facts[0].text, /your own PR/)
  assert.deepEqual(ready.done({ ok: true, url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' }), { title: 'Posted on GitHub', text: 'Your review is on #9 now.', link: { href: 'https://github.com/team/repo/pull/9#pullrequestreview-1', label: 'View the review on GitHub' } })
  assert.equal(ready.done({ ok: true }).link, undefined, 'no address, no link')
  const loading = postFindingsCopy(target)
  const refused = postFindingsCopy(target, { error: 'The pull request changed since you looked. Refresh and check it again.' })
  assert.equal(loading.disabled, true)
  assert.equal(refused.disabled, true)
  assert.deepEqual(refused.facts, [{ tone: 'bad', text: 'The pull request changed since you looked. Refresh and check it again.' }])
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ActionConfirm, props))
  `)
  const html = render({ pr: target, copy: ready, onConfirm() {}, onClose() {} })
  assert.match(html, /What it would post/)
  assert.match(html, /Three problems in the lost-reply path\./)
  assert.match(html, /<button[^>]*class="co-btn co-btn-primary"[^>]*>Post to GitHub<\/button>/)
  assert.doesNotMatch(html, /<button[^>]*co-btn-primary[^>]*disabled/, 'ready to post')
  assert.doesNotMatch(html, />Cancel</)
  assert.match(render({ pr: target, copy: loading, onConfirm() {}, onClose() {} }), /<button[^>]*co-btn-primary[^>]*disabled[^>]*>Post to GitHub/, 'the button waits for the words')
  assert.match(render({ pr: target, copy: refused, onConfirm() {}, onClose() {} }), /The pull request changed since you looked/)
})

test('a row that cannot run dims its title, never its reason, and the menu never starts its focus on a destructive row', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-agent-menu-list button\.is-off \{ cursor:default; \}/)
  assert.doesNotMatch(css, /button\.is-off \{[^}]*opacity/)
  assert.match(css, /button\.is-off strong,\.co-agent-menu-list button\.is-off \.co-agent-menu-tile \{ opacity:\.6; \}/)
  const menu = readFileSync(new URL('../ui/useDismissableMenu.js', import.meta.url), 'utf8')
  assert.match(menu, /:not\(\[aria-disabled=true\]\):not\(\[data-danger\]\)/)
  assert.match(menu, /querySelector\('\[role=menu\]'\)/, 'a menu with only a destructive choice focuses the menu, not the choice')
})

test('the lock and globe in a window head, and the files toggle, keep their own colour over the quiet button\'s', () => {
  const css = ['workspace-theme.js', 'theme.js', 'button-theme.js'].map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n')
  // Same specificity as `.co-btn-quiet` loses to the later sheet, so these name `.co-btn` as well.
  // The quiet button reads its tone from a hook, so no rule overrides its colour or fill.
  assert.match(css, /\.co-rw-seen \{ --co-btn-tone:var\(--seen\); --co-btn-tone-fill:/)
  assert.match(css, /\.co-btn-quiet \{[^}]*color: var\(--co-btn-tone, var\(--muted\)\)/)
  assert.doesNotMatch(css, /\.co-rw-seen-btn[^{]*\{[^}]*(?:color|background):/)
  assert.match(css, /\.co-btn\.co-project-files-toggle \{ color: var\(--accent\); \}/)
})
