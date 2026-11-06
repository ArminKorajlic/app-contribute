// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      node test/workspace-browser.mjs
// Seven scenarios, each on a fresh page: runWorkspaceChecks (the project fixture),
// runPopupFitChecks (the project fixture: its Actions menus stay on a phone screen),
// runDeskFrameChecks (the whole app: a review started on a PR page frames its Desk row),
// runReviewRequestChecks (the whole app: a review you submit takes its row out of Review requests) and
// runReviewHelperWaitChecks (the whole app: a review waiting on its helper reads as at work, not stopped) and
// runRespondAnswerChecks (the whole app: a Respond-to-feedback chat that asks you is answered from the Review tab, with no Answer-the-agent button),
// runRespondResultChecks (the whole app: a saved Respond-to-feedback answer is a draft to send in the Review tab, and Post, Discard and its stale and busy states work) and
// runRespondAgainChecks (the whole app: Respond again is delivered into the PR's existing conversation as a message) and
// runAskApprovalChecks (the whole app: a reviewer who looked again without approving is asked to approve with a note, and an approval of the same work carries over).
// Run one with WORKSPACE_BROWSER_ONLY=runDeskFrameChecks (and one viewport with WORKSPACE_BROWSER_VIEWPORT=desktop), for example while
// runWorkspaceChecks is red, so the Desk check can still show green.
// Actual app components, native Chromium DOM, and no live app/backend. The
// browser gets a disposable profile; all transports and host capabilities are
// mocked before mount, with CSP and CDP network blocking as a second boundary.
// PR98 deliberately moved the fixed selection tray into the list header,
// anchored detail/agent actions inline, and combined Description + Activity
// into Conversation. Test those placements without weakening the retained
// selection, focus-return, exact-consent, navigation or retry contracts.
// Local source comparison stays read-only; preparation/editing and applying
// accepted updates are explicit agent handoffs, not direct editor/apply buttons.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { frontendModules } from './render-harness.mjs'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const ENTRY = '\0workspace-browser-fixture'
const fixture = String.raw`
import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SourceMap } from './ui/SourceMap.jsx'
import { ReviewSelection } from './ui/ReviewSelection.jsx'
import { RepositoryPicker } from './ui/RepositoryPicker.jsx'
import { ProjectControls } from './ui/ProjectControls.jsx'
import { PullRequests } from './ui/PullRequests.jsx'
import { ContributionRun } from './ui/Feed.jsx'
import { ReviewPlan } from './ui/ContributionCard.jsx'
import { ScreenshotLoaderContext } from './ui/useScreenshots.js'
import { fetchContributionScreenshot } from './api.js'
import { organizePrivateWorkAction } from './review.js'
import { batchHandle } from './chat-blocks.js'
import { CSS } from './theme.js'
import { NAMES } from './names.js'
import { stageWords } from './publication-stage.js'
import { createSyncHub } from './refresh.js'
import { SyncHubContext, useDeskReviewRuns } from './ui/useReviewList.js'
import ContributeApp, { GithubPullsUnavailable } from './index.jsx'

const HEAD = 'a'.repeat(40), SECOND_HEAD = 'c'.repeat(40), BASE = 'b'.repeat(40)
const projects = [
  { key: 'app:fixture', kind: 'app', name: 'Fixture project', available: true,
    canonical_repo: 'owner/project', viewerPermission: 'WRITE', head_sha: HEAD,
    base_sha: BASE, localFiles: 1, workingFiles: 0 },
  { key: 'app:other', kind: 'app', name: 'Other project', available: true,
    canonical_repo: 'owner/other', viewerPermission: 'WRITE', head_sha: HEAD,
    base_sha: BASE, localFiles: 1, workingFiles: 0 },
]
const pull = (number, extra = {}) => ({
  number, title: 'Contribution ' + number, headRefOid: HEAD, baseRefOid: BASE,
  baseRefName: 'main', baseRef: { target: { oid: BASE } }, state: 'OPEN', isDraft: false, url: 'https://github.com/owner/project/pull/' + number,
  repository: { nameWithOwner: 'owner/project', viewerPermission: 'WRITE' },
  changedFiles: 1, additions: 1, deletions: 0, createdAt: '2026-09-07T12:00:00Z', updatedAt: '2026-09-07T13:00:00Z',
  author: { login: 'owner' }, assignees: { nodes: [] },
  // A PR GitHub read completely: the PR machine reads a PR without these facts as "could not be read" and disables its actions.
  mergeable: 'MERGEABLE', reviewDecision: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  latestOpinionatedReviews: { nodes: [] }, reviewThreads: { nodes: [] }, ...extra,
})
const prepared = {
  id: 'fixture-prepared', type: 'pr', status: 'prepared', repo: 'owner/project',
  title: 'Reviewed local change', summary: 'Reviewed local change',
  plan: { action: 'pr', repo: 'owner/project', title: 'Reviewed local change',
    head_sha: HEAD, branch: 'fix/fixture' },
  quality_review: { state: 'all_clear', reviewed_head_sha: HEAD },
}
const calls = { exactRuns: [], restores: [], diffs: [], requests: [], starts: [], publications: [], status: [], forbidden: [], opened: [], releases: [], stops: [], messages: [], appChatStarts: [], asks: [], githubRetries: 0 }
const values = new Map(), versions = new Map(), navigation = [], reviewRuns = [], respondChats = []
let versionCounter = 0
const pulls = [pull(7), pull(8, { headRefOid: SECOND_HEAD, assignees: { nodes: [{ login: 'teammate' }] } })]
// Reachable only by exact read, as a closed PR is absent from open search.
const closedPulls = [pull(11, { title: 'Closed contribution', state: 'CLOSED' })]
// A finished review of PR 7 with the verdict in the given state; the server's own item states follow it.
const VERDICT_ITEM_STATES = { proposed: 'verdict_pending', posted: 'all_clear', unknown: 'verdict_unknown' }
const verdictRun = verdict => ({ id: 'review-verdict', chat_id: 'review-chat-fixture', mode: 'review', state: verdict === 'proposed' ? 'needs_you' : 'complete', can_stop: false,
  items: [{ repo: 'owner/project', number: 7, head_sha: HEAD, base_ref: 'main', base_sha: BASE, state: VERDICT_ITEM_STATES[verdict], summary: 'Looks right.',
    verdict_proposal: { id: 'f'.repeat(32), state: verdict, event: 'APPROVE', head_sha: HEAD, body: '**Möbius review: Approved**\n\nLooks right.' } }] })
// A review at work on PR 7; execution is the platform's state of the chat that runs it.
const reviewingRun = (execution, id = 'review-helper') => ({ id, chat_id: 'review-chat-fixture', mode: 'review', state: 'reviewing', execution_state: execution, can_stop: true,
  items: [{ repo: 'owner/project', number: 7, head_sha: HEAD, base_ref: 'main', base_sha: BASE, state: 'reviewing' }] })
// What GitHub charges, as measured on a real account: the full requests read 55 points, the reviewed PRs 14 per 25, the change probe 1.
// Each answer carries the account's rateLimit, as the real API does.
const GITHUB_COST = { ContributeIncomingReviews: 55, ContributeChangeProbe: 1 }
function charged(query, aliases = 0) {
  const name = /query (\w+)/.exec(query)?.[1]
  const cost = name === 'ContributeReviewPulls' ? Math.ceil(aliases * 14 / 25) : GITHUB_COST[name] || 0
  window.githubPoints += cost; window.githubRemaining -= cost
  return { cost, remaining: window.githubRemaining }
}
window.githubPoints = 0; window.githubRemaining = 5000
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
// A prompt preview resolves settings; it is a read, not a public action.
const mutationRequests = () => calls.requests.filter(call => call.method !== 'GET' && call.url !== '/api/github/graphql' && !call.url.endsWith('/review-preview'))
function forbidden(kind) {
  return (...args) => { calls.forbidden.push({ kind, args: args.map(String) }); throw new Error('Forbidden fixture transport: ' + kind) }
}
window.fetch = async (url, options = {}) => {
  const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, at: Date.now() }
  calls.requests.push(call)
  // The platform's note asking reviewers who looked again to approve: the one public write of the Ask for approval sheet.
  if (call.method === 'POST' && call.url === '/api/github/contributions/fixture-app/pulls/ask-approval') { calls.asks.push(call.body); return response({ state: 'asked', observed_head_sha: call.body.head_sha, repo: call.body.repo, number: call.body.number, head_sha: call.body.head_sha }) }
  // A conversation of the app: the platform returns the PR's existing one for its scope, and takes a message into any chat the app made.
  if (call.method === 'POST' && call.url === '/api/app-chats/start') { calls.appChatStarts.push(call.body); return response({ chat_id: 'respond-chat-fixture', outcome: 'reused' }) }
  // The app's own conversation for a PR's Respond scope, with the agent it keeps.
  if (call.method === 'GET' && call.url.startsWith('/api/app-chats?scope=')) return response([{ id: 'respond-chat-fixture', provider: 'codex', model: 'fixture-model', effort: 'xhigh', scope: decodeURIComponent(call.url.split('scope=')[1]) }])
  if (call.method === 'POST' && /^\/api\/chats\/[\w-]+\/messages$/.test(call.url)) { calls.messages.push({ chatId: call.url.split('/')[3], ...call.body }); return response({ status: 'started' }) }
  if (call.url === '/api/models') return response({providers:{codex:[{id:'fixture-model',label:'Fixture model',available:true,effort_levels:['none','minimal','low','medium','high','xhigh'],default_effort:'low'}]}})
  if (call.url === '/api/owner/model-prefs') return response({hidden_ids:[]})
  if (call.url === '/api/auth/providers/status') return response({codex:{configured:true,available:true,name:'OpenAI Codex'}})
  if (window.presetsMissing && call.url === '/api/github/contributions/fixture-app/review-presets') return new Response(JSON.stringify({detail:'Not Found'}), {status:404})
  if (call.url === '/api/github/contributions/fixture-app/review-presets' && call.method === 'GET') return response({presets:{review_prompt:'Review fixture',fix_prompt:'Fix fixture',merge_prompt:'Merge fixture',autopilot:true},capabilities:window.fixtureCapabilities || {review_fix_merge:false,post_review:false}})
  if (call.url === '/api/github/contributions/fixture-app/review-preview' && call.method === 'POST') return response({preview_sha256:'f'.repeat(64),options:{provider:'codex',model:'fixture-model'}})
  if (window.fullAppFixture) {
    if (call.url === '/api/github/status') return response({ connected: window.fullAppConnected, login: window.fullAppConnected ? 'reconnected-owner' : '',
      ...(window.fullAppBinding ? { frozen_publication_binding: { record_fields: ['plan'] } } : {}) })
    if (call.url === '/api/github/source-status') return response({ apps: [], platform: null })
    // The whole app also reads the saved review runs (a plain read) whenever it syncs; this page has none. The Desk scenarios keep their own runs.
    if (!window.fullAppDesk && call.url === '/api/github/contributions/fixture-app/review-runs' && call.method === 'GET') return response({ runs: [] })
    if (call.url.includes('/review-status')) {
      const ids = new URL(call.url, location.origin).searchParams.getAll('record_id')
      return response({ records: ids.map(id => ({ id, state: 'ready' })), ...(ids.length ? { addressed_record_ids: ids } : {}) })
    }
    if (window.fullAppSubmit && call.method === 'POST' && call.url.endsWith('/submit')) return response(window.fullAppSubmit(call))
    if (call.url === '/api/github/graphql' && call.method === 'POST') {
      if (/mutation\b/i.test(call.body.query)) return forbidden('GraphQL mutation')(call)
      if (call.body.query.includes('resource(url:')) return response({data:{r0:{__typename:'PullRequest',state:'MERGED',isDraft:false}}})
      if (call.body.query.includes('ContributeRepositories')) return response({data:{viewer:{repositories:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}})
      // The Desk scenario asks the fixture PRs for review; everything else it reads falls through to the project mocks below.
      if (window.fullAppDesk && call.body.query.includes('ContributeIncomingReviews')) {
        if (window.failIncoming) return new Response(JSON.stringify({detail:'Fixture GitHub error'}), {status:503})
        return response({data:{rateLimit:charged(call.body.query),requested:{nodes:window.githubRequests || [pulls[0]]},involved:{nodes:[]}}})
      }
      // The change probe: only the review requests and the PRs the owner reviewed, one point.
      if (window.fullAppDesk && call.body.query.includes('ContributeChangeProbe')) {
        if (window.failIncoming) return new Response(JSON.stringify({detail:'Fixture GitHub error'}), {status:503})
        const probed = pr => ({ id: pr.url, updatedAt: pr.updatedAt, state: pr.state })
        const reads = [...call.body.query.matchAll(/(p\d+):repository\(owner:"[^"]+",name:"[^"]+"\) \{ pullRequest\(number:(\d+)\)/g)]
        return response({data:{rateLimit:charged(call.body.query),
          requested:{issueCount:(window.githubRequests || [pulls[0]]).length,nodes:(window.githubRequests || [pulls[0]]).map(probed)},
          ...Object.fromEntries(reads.map(([, alias, number]) => [alias, { pullRequest: probed(pulls.find(pr => pr.number === Number(number)) || closedPulls[0]) }]))}})
      }
      if (!window.fullAppDesk && call.body.query.includes('search(')) return response({data:{search:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}})
    }
    if (!window.fullAppDesk) return forbidden('full-app fetch')(call.url)
  }
  if (call.url === '/api/github/graphql' && call.method === 'POST') {
    if (/mutation\b/i.test(call.body.query)) return forbidden('GraphQL mutation')(call)
    if (call.body.query.includes('ContributeReviewSelection')) return response({data:{p0:{nameWithOwner:'owner/project',viewerPermission:window.fixturePermission || 'WRITE',pullRequest:{...pulls[0],state:'OPEN'}}}})
    if (call.body.query.includes('ContributeRepository')) return response({data:{repository:{nameWithOwner:'team/community',viewerPermission:'WRITE'}}})
    if (call.body.query.includes('ContributeExactPull')) {
      const number=Number(call.body.query.match(/pullRequest\(number:(\d+)/)?.[1])
      const pr=pulls.find(pr=>pr.number===number) || closedPulls.find(pr=>pr.number===number)
      ensure(call.body.query.includes('owner:"owner"') && call.body.query.includes('name:"project"'),'Exact read used another repository')
      return response({data:{repository:{pullRequest:{...pr,
        headRefOid:window.exactHeadChanged?'e'.repeat(40):pr.headRefOid,
        baseRef:{target:{oid:window.liveBase || BASE}},
      }}}})
    }
    if (call.body.query.includes('ContributePullContext')) {
      const pr=[...pulls, ...closedPulls].find(pr=>pr.number===call.body.variables.number)
      ensure(call.body.variables.owner==='owner' && call.body.variables.name==='project','Wrong context repository')
      return response({data:{repository:{pullRequest:{...pr,
        reviewThreads:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}},
        closingIssuesReferences:{nodes:[],pageInfo:{hasNextPage:false}},
        timelineItems:{nodes:[],pageInfo:{hasNextPage:false}},
      }}}})
    }
    if (call.body.query.includes('ContributeReviewPulls')) {
      // The review list reads each reviewed PR live, one alias per PR.
      const reads = [...call.body.query.matchAll(/(p\d+):repository\(owner:"[^"]+",name:"[^"]+"\) \{ pullRequest\(number:(\d+)\)/g)]
      return response({ data: { rateLimit: charged(call.body.query, reads.length), ...Object.fromEntries(reads.map(([, alias, number]) => [alias, { pullRequest: pulls.find(pr => pr.number === Number(number)) || null }])) } })
    }
    if (!call.body.query.includes('ContributePullRequests')) return forbidden('unknown GraphQL query')(call.body.query)
    if(window.failPulls) return new Response(JSON.stringify({detail:'Fixture pull read error'}),{status:503})
    if(window.holdPulls) await new Promise(resolve=>{window.releasePulls=resolve})
    let found = call.body.query.includes('repo:owner/other') || window.emptyPulls ? [] : pulls
    const laterPage = call.body.query.includes('after:"fixture-page-2"')
    if (window.fixturePaging) found = laterPage ? found.slice(1) : found.slice(0,1)
    if (window.fixtureChangedHead) found = found.map(pr => pr.number===8 ? {...pr,headRefOid:'e'.repeat(40)} : pr)
    return response({ data: { search: { nodes: found, issueCount: pulls.length,
      pageInfo: { hasNextPage: Boolean(window.fixturePaging && !laterPage), endCursor: window.fixturePaging && !laterPage ? 'fixture-page-2' : null } } } })
  }
  // Runs older than the capped recent list are reachable only by exact id.
  const oldRun = /^\/api\/github\/contributions\/fixture-app\/review-runs\/([\w-]+)(\/stop)?$/.exec(call.url)
  if (oldRun && window.oldRuns?.has(oldRun[1])) {
    if (oldRun[2]) {
      const stopped = { ...window.oldRuns.get(oldRun[1]), execution_state: 'stopped', can_stop: false }
      window.oldRuns.set(oldRun[1], stopped)
      return response({ run: stopped })
    }
    calls.exactRuns.push(oldRun[1])
    // Snapshot at request time; a held response is delivered later, as the network may.
    const snapshot = structuredClone(window.oldRuns.get(oldRun[1]))
    if (window.holdExactRun) await new Promise(resolve => { window.releaseExactRun = resolve })
    return response({ run: snapshot })
  }
  if (/\/review-runs\/review-verdict\/verdict$/.test(call.url) && call.method === 'POST') {
    const verdict = call.body.decision === 'submit' ? window.verdictOutcome : 'discarded'
    reviewRuns[0] = verdictRun(verdict)
    return response({ run: reviewRuns[0], ...(call.body.decision === 'submit' ? { verdict: { state: verdict, event: 'APPROVE' } } : {}), merge_resumed: null })
  }
  if (call.url === '/api/github/contributions/fixture-app/review-runs') {
    if (call.method === 'GET') {
      // Snapshot at request time; a held answer lands later, as a slow network may deliver it.
      const snapshot = structuredClone(reviewRuns)
      if (window.holdRunsRead) { window.holdRunsRead = false; await new Promise(resolve => { window.releaseRunsRead = resolve }) }
      return response({ runs: snapshot, respond_chats: structuredClone(respondChats) })
    }
    if (call.method !== 'POST') return forbidden('unexpected review method')(call.method)
    if (window.failReview) return new Response(JSON.stringify({detail:'Fixture review error'}), {status:503})
    const run = { id: 'review-' + (reviewRuns.length + 1), chat_id: 'review-chat-fixture',
      request_id: call.body.request_id, mode: call.body.mode, state: 'reviewing', items: call.body.items.map(item => ({ ...item, state: 'reviewing' })) }
    reviewRuns.unshift(run)
    return response({ run })
  }
  if (call.url.startsWith('/api/github/contributions/fixture-app/assignees?') && call.method === 'GET') {
    return response({ assignees: [{ login: 'owner' }, { login: 'teammate' }], can_assign: true })
  }
  if (call.url === '/api/github/contributions/fixture-app/assign-review' && call.method === 'POST') {
    if (window.failAssignment === call.body.number) return new Response(JSON.stringify({detail:'Fixture assignment error'}), {status:503})
    const selected = pulls.find(pr => pr.number === call.body.number)
    selected.assignees.nodes.push({ login: call.body.assignee })
    return response({ ok: true })
  }
  if (call.url.startsWith('/api/github/contributions/fixture-app/source-chats?') && call.method === 'GET') {
    if(window.holdScope) await new Promise(resolve=>{window.releaseScope=resolve})
    if(window.failScope) return new Response(JSON.stringify({detail:'Fixture scope unavailable'}),{status:503})
    return response({ chats: [] })
  }
  if (call.url.startsWith('/api/github/api/repos/owner/project/') && call.method === 'GET') {
    // GitHub's comparison of a version against the base tip: each scenario says what the PR's own files are at each commit.
    if(call.url.includes('/compare/')) return window.compareAnswers ? response(window.compareAnswers(call.url.split('...')[1])) : forbidden('unexpected comparison')(call.url)
    if(call.url.includes('/commits/')) {
      const head=call.url.match(/commits\/([a-f0-9]+)\//)?.[1]
      ensure([HEAD,SECOND_HEAD].includes(head),'Checks lost their exact head')
      if(call.url.includes('/check-runs?')) return window.failChecks
        ? new Response(JSON.stringify({detail:'Fixture check runs unavailable'}),{status:503})
        : response({total_count:1,check_runs:[{id:1,name:'Unit tests',head_sha:head,status:'completed',conclusion:'success'}]})
      if(call.url.includes('/status?')) return response({sha:head,total_count:1,statuses:[{id:2,context:'Build',state:'success'}]})
      return forbidden('unknown commit read')(call.url)
    }
    const number = Number(call.url.match(/(?:pulls|issues)\/(\d+)/)?.[1]); const pr=[...pulls, ...closedPulls].find(item=>item.number===number)
    if (call.url.includes('/files?')) return response([{filename:'change.js',additions:1,deletions:0,status:'modified',patch:'@@ -1 +1 @@\n-old\n+safe change'}])
    if (call.url.includes('/comments?')) return response([{id:1,body:'Please check this edge case',user:{login:'reviewer'},created_at:'2026-09-07T14:00:00Z'}])
    if (call.url.includes('/reviews?')) return response([])
    if(!/\/pulls\/\d+$/.test(call.url)) return forbidden('unknown pull read')(call.url)
    return response({changed_files:pr.changedFiles,additions:pr.additions,deletions:pr.deletions,body:'Fixture PR description '+number,head:{sha:pr.headRefOid},base:{sha:pr.baseRefOid,ref:pr.baseRefName}})
  }
  return forbidden('fetch')(call.url)
}
window.XMLHttpRequest = class { constructor() { forbidden('XMLHttpRequest')() } }
window.WebSocket = class { constructor() { forbidden('WebSocket')() } }
window.EventSource = class { constructor() { forbidden('EventSource')() } }
navigator.sendBeacon = forbidden('sendBeacon')
window.open = forbidden('window.open')
window.addEventListener('error', event => calls.forbidden.push({ kind: 'runtime error', message: event.message }))
window.addEventListener('unhandledrejection', event => calls.forbidden.push({ kind: 'unhandled rejection', message: String(event.reason) }))
window.cycleChats = new Map()
// The shell tells a frame whether it is shown: a pane tiled beside a chat is visible without ever being focused.
const visibilityListeners = new Set()
const shownAgain = () => { window.setFrameVisible(false); window.setFrameVisible(true) }
window.setFrameVisible = visible => { window.mobius.visible = visible; for (const listener of [...visibilityListeners]) listener(visible) }
window.mobius = {
  online: true,
  visible: true,
  runtimeFeatures: { frameVisibility: true },
  onVisibilityChange(listener) {
    visibilityListeners.add(listener); listener(window.mobius.visible)
    return () => visibilityListeners.delete(listener)
  },
  storage: {
    get: async key => structuredClone(values.get(key) ?? null),
    set: async (key, value) => { values.set(key, structuredClone(value)) },
    remove: async key => { values.delete(key) },
    subscribe: () => () => {},
    getWithVersion: async key => ({value:structuredClone(values.get(key) ?? null), version:values.has(key) ? versions.get(key) || 'fixture-version' : null}),
    // Compare-and-set like the platform: a stale version or create conflict fails.
    durableWrite: async (key, value, condition = {}) => {
      const version = values.has(key) ? versions.get(key) || 'fixture-version' : null
      if ((condition.ifNoneMatch && version) || (condition.ifMatch && condition.ifMatch !== version)) throw Object.assign(new Error('CAS conflict'), {code:'conflict',status:412})
      const next = 'fixture-version-' + (++versionCounter)
      values.set(key,structuredClone(value)); versions.set(key,next)
      return {durability:'synced',version:next}
    },
  },
  nav: {
    open(name, callbacks) {
      const handle = { name, callbacks, outcome: Promise.resolve({ status: 'owned' }),
        close() { const index = navigation.indexOf(handle); if (index >= 0) navigation.splice(index, 1) } }
      navigation.push(handle)
      return handle
    },
    back() { const handle = navigation.pop(); if (!handle) throw new Error('No owned navigation to go back'); handle.callbacks.onBack() },
  },
  chat: {
    start: async action => { calls.starts.push(structuredClone(action)); return { chatId: 'prepare-' + calls.starts.length } },
    status: async id => { calls.status.push(id); return { running: true } },
    // The project's live scoped conversations, as the platform lists them.
    list: async ({ scope } = {}) => window.cycleChats.has(scope) ? [{ id: window.cycleChats.get(scope) }] : [],
    stop: async id => { calls.stops.push(id); return {stopped:true} },
    open: id => calls.opened.push(id),
  },
}

async function loadProjectDiff(project) {
  calls.diffs.push({key:project.key,head:project.head_sha,base:project.base_sha})
  if(window.holdDiff) await new Promise(resolve=>{window.releaseDiff=resolve})
  if(window.diffMode==='error') return {ok:false}
  if(window.diffMode==='stale') return {ok:false,stale:true}
  return {ok:true,data:{diff:window.diffMode==='empty'?'':'diff --git a/local.js b/local.js\n--- a/local.js\n+++ b/local.js\n@@ -1 +1 @@\n-old\n+local improvement\n'}}
}
function Fixture() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [conn, setConn] = useState({state:'connected',login:'owner'})
  // The review runs come through the same hub and hook the app uses: one shared copy for the PR page.
  const hub = useMemo(() => createSyncHub(), [])
  useEffect(() => hub.start(), [hub])
  const deskRuns = useDeskReviewRuns({ hub, token: 'fixture-only', appId: 'fixture-app', connState: conn.state, sendOnly: false, pullPageOpen: false })
  window.setConnectionFixture = setConn
  async function retryGithub() {
    calls.githubRetries++
    await new Promise(resolve => { window.finishGithubRetry = resolve })
    setConn({state:'connected',login:'owner'})
  }
  const [records, setRecords] = useState([prepared, {...prepared,id:'fixture-dismissed',title:'Dismissed local proposal',summary:'Dismissed local proposal',status:'abandoned',plan:{...prepared.plan,title:'Dismissed local proposal'}}])
  const [selectionId, setSelectionId] = useState(null)
  const [allProjects, setAllProjects] = useState(projects)
  const [focusPull, setFocusPull] = useState(null)
  window.focusPullFixture = setFocusPull
  const [focusRun, setFocusRun] = useState(null)
  window.focusRunFixture = setFocusRun
  const [projectFocus, setProjectFocus] = useState(null)
  window.focusProjectFixture = setProjectFocus
  window.setRecordsFixture = setRecords
  function releaseFocus(nonce) { calls.releases.push(nonce); setFocusPull(old => old?.nonce === nonce ? null : old); setFocusRun(old => old?.nonce === nonce ? null : old) }
  window.openSelectionFixture = setSelectionId
  window.setProjectsFixture = setAllProjects
  function repositoryAdded(repo) { setAllProjects(old => [...old, {key:'external:' + repo.nameWithOwner,kind:'external',name:repo.nameWithOwner,canonical_repo:repo.nameWithOwner,contributions:[]}]) }

  function runFor(project) {
    const items = records.filter(record => record.repo === project.canonical_repo).map(record => ({
      id: (record.status === 'abandoned' ? 'archived:' : record.status === 'prepared' ? 'publish:' : 'public:') + record.id,
      kind: record.status === 'abandoned' ? 'archived' : record.status === 'prepared' ? 'publish' : 'public', record,
      label: record.summary, detail: record.repo,
    }))
    return { revision: records.map(record => record.status).join('|'),
      decisions: items.filter(item => item.kind === 'publish'),
      working: items.filter(item => item.kind === 'public'), recent: [], archive: items.filter(item => item.kind === 'archived'),
      privateAction: organizePrivateWorkAction([], { byId: {} }, [project]) }
  }
  async function restore(record) {
    calls.restores.push(record.id)
    setRecords(old=>old.map(item=>item.id===record.id?{...item,status:'prepared'}:item))
    return {ok:true}
  }
  async function send(record) {
    calls.publications.push(structuredClone(record))
    const shared = { ...record, status: 'open', number: 9, url: 'https://github.com/owner/project/pull/9' }
    pulls.push(pull(9, { title: record.title }))
    setRecords(old => old.map(item => item.id === record.id ? shared : item))
    return { ok: true, record: shared }
  }
  // Project work arrives with its cycle id; the platform's de-duplication
  // returns the same conversation for a repeated id.
  const cycleChats = window.cycleChats
  async function start(action) {
    if(window.failStart) return {ok:false,error:'Fixture agent unavailable'}
    const started = await window.mobius.chat.start(action)
    if (action.cid) { if (!cycleChats.has(action.scope)) cycleChats.set(action.scope, started.chatId); started.chatId = cycleChats.get(action.scope) }
    if(window.lostStart) return {ok:false,error:'Response lost'}
    return { ok: true, ...started }
  }
  // The app's header Refresh, which replaced the per-project Check GitHub button: it runs the page's retry and stays busy until that settles.
  const [syncing, setSyncing] = useState(false)
  const retryAll = async () => { setRefreshKey(old => old + 1); return { ok: true, upstream: null } }
  async function syncFromHeader() {
    setSyncing(true)
    try { await retryAll() } finally { setSyncing(false) }
  }
  return <SyncHubContext.Provider value={hub}><div className="co-root"><style>{CSS}</style><main className="co-page is-sources">
    <button type="button" className="co-btn co-toolbar-refresh" onClick={syncFromHeader} disabled={syncing} aria-busy={syncing} aria-label="Sync with GitHub">Sync with GitHub</button>
    {selectionId ? <ReviewSelection selectionId={selectionId} token="fixture-only" appId="fixture-app" onClose={() => setSelectionId(null)} /> : <SourceMap projects={allProjects} focusKey={projectFocus} snapshot={{ generated_at: 'fixture-'+refreshKey }} conn={conn}
      loadProjectDiff={loadProjectDiff} onRetry={retryAll}
      addProject={quiet => <RepositoryPicker quiet={quiet} token="fixture-only" connected onAdded={repositoryAdded} />}
      renderActivity={(project, navigation) => project ? <><GithubPullsUnavailable conn={conn} onRetry={retryGithub} /><ProjectControls key={project.key} appId="fixture-app" token="fixture-only" project={project}
        run={runFor(project)} mergeRun={runFor(project)} onStart={start}>
        {({controls,progress})=><ContributionRun run={runFor(project)} controls={controls} projectProgress={progress}
        githubState="connected" publicationPreference="github" reviewStatus={{ byId: {} }}
        selectedId={navigation.selectedId} onSelect={navigation.onSelect} onBack={navigation.onBack} onSend={send} onRestore={restore}
        renderPublicWork={view => <PullRequests refreshKey={refreshKey} appId="fixture-app" token="fixture-only" project={project} scope={view?.scope || 'all'} onScope={view?.onScope} onTotal={view?.onTotal}
          conn={conn} runs={deskRuns.runs} respondChats={deskRuns.respondChats} runsError={deskRuns.error} onRunsChanged={deskRuns.refresh} onRunPatched={deskRuns.patch} records={records.filter(record => record.repo === project.canonical_repo)} focusPull={focusPull} focusRun={focusRun} onFocusRelease={releaseFocus} onRecord={record => calls.opened.push('record:' + record.id)} />}
      />}</ProjectControls></> : null} />}
  </main></div></SyncHubContext.Provider>
}
const root = createRoot(document.getElementById('root'))
root.render(<Fixture />)

const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const text = node => node?.textContent?.replace(/\s+/g, ' ').trim() || ''
const query = selector => document.querySelector(selector)
// An icon-only button has no text, so its accessible name counts too.
const button = (name, root = document) => [...root.querySelectorAll('button')].find(node => text(node) === name || node.getAttribute('aria-label') === name)
const review = () => query('.co-review-window')
// A new PR opens ready for review by default: the first button only opens the confirmation, whose own button sends.
const opens = stageWords('ready').action(1), sends = stageWords('ready').onGithub(1)
// A PR page tab reads its name, then a count pill ("Comments2", "Files changed1"), so match on the name without the count.
const detailTab = (name, root = query('.co-detail-tabs')) => [...root.querySelectorAll('button')].find(node => text(node).replace(/\d+$/, '') === name)
// The window's one way out is the X in its header; it has no Cancel.
const closeReview = () => click(review().querySelector('[aria-label="Close"]'))
// One Sync button for the whole app (the toolbar's), which re-reads GitHub for every project.
const checkButton = () => query('.co-toolbar-refresh')
const batchAction = () => [...document.querySelectorAll('.co-public-work .co-work-progress-row')].find(node => text(node).includes('Review or assign'))
const ensure = (condition, message) => { if (!condition) throw new Error(message) }
// CDP delivers the real browser key default; dispatchEvent would not toggle a
// checkbox natively and must not be used as keyboard-selection evidence.
const nativeSpace = () => new Promise((resolve, reject) => {
  window.finishNativeKey = error => error ? reject(new Error(error)) : resolve()
  window.workspaceNativeKey(JSON.stringify({ key:' ', code:'Space', keyCode:32 }))
})
const nativeEscape = () => new Promise((resolve, reject) => {
  window.finishNativeKey = error => error ? reject(new Error(error)) : resolve()
  window.workspaceNativeKey(JSON.stringify({ key:'Escape', code:'Escape', keyCode:27 }))
})
async function until(predicate, message) {
  const deadline = performance.now() + 5000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(message + '\nDOM: ' + text(query('main')).slice(0, 3000))
    await frame()
  }
  await frame()
}
async function click(node, message = 'Expected enabled visible control') {
  ensure(node && !node.disabled && node.getClientRects().length, message + (node ? ': ' + node.outerHTML.slice(0, 100) : ': no such element'))
  node.click()
  await frame(); await frame()
}
async function fill(node, value) {
  ensure(node && node.getClientRects().length, 'Expected visible input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value)
  node.dispatchEvent(new Event('input',{bubbles:true}))
  await frame(); await frame()
}
// A launch resolves its frozen prompts/model before its approval is enabled.
// Actions ▾ → one job (Review by default). Choosing only opens the review window.
async function chooseAgent(root, choice = NAMES.review) {
  await click(root.querySelector('.co-agent-menu-button'))
  await until(() => root.querySelector('[role=menuitem]'), 'Agent menu did not open')
  await click([...root.querySelectorAll('[role=menuitem]')].find(node => text(node).startsWith(choice)))
  await until(() => review(), 'Review window did not open')
}
// The fixture viewer wrote both PRs, and an agent only checks the viewer's own PRs. Another viewer on a Möbius that can post a verdict
// and merge after it gets the review window's full choices: who sees the result, then whether it merges after the viewer approves.
const asReviewer = async () => {
  window.setConnectionFixture({state:'connected',login:'another-viewer'})
  window.fixtureCapabilities={review_fix_merge:false,post_review:true,propose_verdict:true,post_review_merge:true}
  await frame(); await frame()
}
const asOwner = async () => { window.fixtureCapabilities=undefined; window.setConnectionFixture({state:'connected',login:'owner'}); await frame(); await frame() }
// Merging follows the viewer's own approval, so it is offered only once "Draft for me" is chosen; returns its switch, still off.
async function chooseDraftThenMergeSwitch() {
  await until(()=>button('Draft for me',review()),'Who sees the result did not load')
  ensure(!review().querySelector('[role=switch]') && text(review()).includes('Merging follows your own approval'),'Merge was offered before the viewer chose to send the verdict')
  await click(button('Draft for me',review()))
  const mergeSwitch=review().querySelector('[role=switch]')
  ensure(mergeSwitch && !mergeSwitch.checked,'Drafting a verdict did not offer an unchecked merge switch')
  return mergeSwitch
}
async function openTab(name) {
  const tab = [...document.querySelectorAll('[role=tab]')].find(node => text(node).startsWith(name))
  ensure(tab, 'Tab missing: ' + name)
  if (tab.getAttribute('aria-selected') !== 'true') await click(tab)
  await until(() => tab.getAttribute('aria-selected') === 'true', 'Tab did not open: ' + name)
}
// The PR filters are chips (a pressed state, a count), one per key the app filters on.
const FILTER_LABELS = { all: 'All', authored: 'Opened by me', drafts: 'Drafts', failing: 'Failing checks', bots: 'Bots', unassigned: 'Unassigned', assigned: 'Assigned to me' }
const filterChip = value => [...query('.co-pr-filters').querySelectorAll('button')].find(node => text(node).startsWith(FILTER_LABELS[value]))
async function setFilter(value) {
  const chip = filterChip(value); chip.focus()
  await click(chip)
}
async function checkGithub(message = 'Check GitHub did not finish') {
  await click(checkButton())
  await until(() => !checkButton().disabled, message)
}
async function enabled(name) {
  await until(() => button(name) && !button(name).disabled, name + ' did not become available')
  await click(button(name))
}
async function inventory() {
  const close=query('.co-inline-close')
  if (close) await click(close)
}
async function chooseProject(name) {
  await inventory()
  const switcher = query('select[aria-label="Switch project"]')
  if (switcher?.getClientRects().length) {
    switcher.value = [...switcher.options].find(option => option.textContent === name).value
    switcher.dispatchEvent(new Event('change', { bubbles:true }))
    await frame(); await frame(); return
  }
  const back = query('[aria-label="Back to repositories"]')
  if (back) await click(back)
  else { window.mobius.nav.back(); await frame(); await frame() }
  await until(() => query('.co-source-row'), 'Project list did not return')
  await click([...document.querySelectorAll('.co-source-row')].find(node => text(node.querySelector('strong')) === name))
}
window.runWorkspaceChecks = async () => {
  const checks = []
  async function check(name, run) {
    await run()
    const page=query('.co-page')
    if (page) ensure(page.scrollWidth<=page.clientWidth+1,'Workspace overflows horizontally at '+name+': '+page.scrollWidth+' > '+page.clientWidth)
    checks.push({ name, status: 'pass' })
  }
  try {
    await until(() => query('.co-source-row'), 'Project list did not render')
    await check('project directory uses wrapped filter buttons instead of a dropdown or scroller', async () => {
      const filters=query('.co-directory .co-filter-line'), filterButtons=[...filters.querySelectorAll('button')]
      ensure(filters && !query('.co-directory-filter select') && !query('.co-lens-nav'), 'Project filters did not use the compact button group')
      ensure(filterButtons.map(node => text(node)).join('|')==='All|2With local changes|0Behind GitHub', 'Project filter choices or counts drifted')
      const search=query('.co-directory .co-search')
      ensure(search && search.querySelector('svg') && filters.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING, 'The project search is not the shared search field under the filters')
      ensure(button('All',filters).getAttribute('aria-pressed')==='true', 'The active project filter is not exposed')
      await click(query('.co-source-row'))
      await until(() => document.querySelectorAll('.co-pr-row').length === 2 && button('Make PRs from local changes') && !button('Make PRs from local changes').disabled, 'Project did not settle')
      ensure(query('.co-workspace-inventory') && !query('.co-task-content'), 'Opening a project displayed task work')
      ensure(!query('.co-task-content') && calls.starts.length === 0 && mutationRequests().length === 0, 'Opening project started work or opened an action')
    })
    const originalInventory = query('.co-workspace-inventory'), originalRow = query('.co-pr-row')
    let originalList = query('.co-pr-list')
    // My work shows no PR list; coming back renders it again from the same
    // mounted component, so later identity checks compare with the new list.
    const backToPrs = async () => { await openTab('All PRs'); originalList = query('.co-pr-list') }
    const inventoryNavigationDepth = navigation.length
    await check('project tabs lead with All PRs, whose filter chips offer each view and change totals stay visible', async () => {
      const tabs=[...document.querySelectorAll('[role=tab]')].map(node => text(node).replace(/\d+$/, ''))
      ensure(tabs.join('|')==='All PRs|Review requests|Agent runs','Project tabs drifted: '+tabs.join('|'))
      ensure([...document.querySelectorAll('[role=tab]')][0].getAttribute('aria-selected')==='true','All PRs is not the default tab')
      const chips=[...query('.co-pr-filters').querySelectorAll('button')].map(node => text(node).replace(/\d+$/, '').trim())
      ensure(chips.join('|')==='All|Opened by me|Drafts|Failing checks|Bots|Unassigned|Assigned to me','PR filter choices drifted: '+chips.join('|'))
      ensure(filterChip('all').getAttribute('aria-pressed')==='true','Default filter is not all')
      ensure([...document.querySelectorAll('.co-pr-row .co-pr-meta')].every(node => text(node).includes('+1−0')),'Change totals were not visible by default')
      ensure(!query('.co-display'), 'The retired display menu returned')
      await setFilter('authored')
      ensure(filterChip('authored').getAttribute('aria-pressed')==='true','Filter state did not follow the choice')
      ensure(document.querySelectorAll('.co-pr-row').length===2,'Authored filter hid matching fixture PRs')
      await setFilter('all')
      ensure(query('.co-workspace-inventory')===originalInventory && mutationRequests().length===0,'Display-only controls replaced inventory or mutated GitHub')
    })
    let firstCheckbox = query('input[aria-label="Select owner/project #7"]')
    let secondCheckbox = query('input[aria-label="Select owner/project #8"]')
    function selectionStaysInInventory(focused) {
      ensure(navigation.length === inventoryNavigationDepth, 'Checkbox selection changed navigation')
      ensure(firstCheckbox.getClientRects().length && secondCheckbox.getClientRects().length, 'Batch selection hid checkboxes')
      ensure(document.activeElement === focused, 'Selection stole keyboard focus')
      ensure(query('.co-workspace-inventory') === originalInventory && query('.co-pr-row') === originalRow, 'Selection remounted inventory')
      ensure(mutationRequests().length === 0, 'Selection mutated GitHub or started review')
    }
    await check('multiple checkbox changes keep selection, focus and inventory stable', async () => {
      for (const [checkbox, one, two] of [[firstCheckbox,true,false],[secondCheckbox,true,true],[firstCheckbox,false,true],[firstCheckbox,true,true]]) {
        checkbox.focus(); const scroll=query('.co-page').scrollTop; await click(checkbox)
        ensure(Math.abs(query('.co-page').scrollTop-scroll)<2,'Checkbox selection scrolled the inventory')
        ensure(firstCheckbox.checked === one && secondCheckbox.checked === two, 'Unrelated selection changed')
        ensure(text(query('.co-pr-box-head')).includes((Number(one)+Number(two))+' selected'), 'Selection count drifted')
        selectionStaysInInventory(checkbox)
      }
    })
    await check('trusted keyboard Space selects and deselects without navigation', async () => {
      const events = []; const capture = event => events.push({code:event.code,trusted:event.isTrusted})
      secondCheckbox.addEventListener('keydown',capture); secondCheckbox.focus()
      for (const selected of [false,true]) { await nativeSpace(); await until(() => secondCheckbox.checked === selected,'Space did not toggle'); selectionStaysInInventory(secondCheckbox) }
      secondCheckbox.removeEventListener('keydown',capture)
      ensure(events.length === 2 && events.every(event => event.trusted && event.code === 'Space'),'Keyboard test was not native')
    })
    await check('a row Agent menu opens past the end of a short PR list instead of being clipped', async () => {
      const row=[...document.querySelectorAll('.co-pr-row')].at(-1), trigger=row.querySelector('.co-agent-menu-button')
      await click(trigger)
      await until(() => row.querySelector('[role=menuitem]'), 'Row Agent menu did not open')
      const item=[...row.querySelectorAll('[role=menuitem]')].at(-1)
      item.scrollIntoView({ block: 'nearest' }); await frame()
      const rect=item.getBoundingClientRect()
      // On a phone the menu is a sheet on the screen's own edge, so it need not reach past the box; it must still not be clipped by it.
      const sheet = getComputedStyle(row.querySelector('.co-agent-menu-list')).position === 'fixed'
      ensure(sheet || rect.bottom > query('.co-pr-box').getBoundingClientRect().bottom, 'Fixture: the menu no longer reaches past the list box')
      ensure(item.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 6)), 'The PR list box clipped the Agent menu')
      await click(trigger)
      await until(() => !row.querySelector('[role=menuitem]'), 'Row Agent menu did not close')
    })
    await check('the PR detail Agent menu opens inward from its left-hand trigger', async () => {
      const row=[...document.querySelectorAll('.co-pr-row')][0]
      await click(row.querySelector('.co-pr-title, .co-pr-main, button'))
      await until(() => query('.co-pr-detail .co-agent-menu-button'), 'PR detail did not open')
      const detail=query('.co-pr-detail'), trigger=detail.querySelector('.co-agent-menu-button')
      await click(trigger)
      await until(() => detail.querySelector('[role=menuitem]'), 'Detail Agent menu did not open')
      const list=detail.querySelector('.co-agent-menu-list'), menu=list.getBoundingClientRect(), box=detail.getBoundingClientRect()
      // A popup hangs inward from its trigger, inside the pane; a phone's sheet spans the whole screen instead.
      const sheet=getComputedStyle(list).position === 'fixed'
      ensure((sheet ? menu.left >= 0 : menu.left >= box.left - 1) && menu.right <= window.innerWidth + 1, 'The detail Agent menu ran past the pane edge: menu ' + Math.round(menu.left) + ' to ' + Math.round(menu.right) + ', pane ' + Math.round(box.left) + ' to ' + Math.round(box.right) + ', screen ' + window.innerWidth + 'px')
      await click(trigger)
      await until(() => !detail.querySelector('[role=menuitem]'), 'Detail Agent menu did not close')
    })
    await check('inline list header keeps count, bulk actions and visible selection without changing scope', async () => {
      const header=query('.co-pr-box-head')
      ensure(button('Assign',header) && header.querySelector('.co-agent-menu-button') && text(header).includes('2 selected'),'Inline bulk actions missing')
      ensure(!button('Review & merge',header) && !query('.co-pr-selection'),'Obsolete tray or redundant merge action returned')
      ensure(getComputedStyle(header).position!=='fixed','Bulk header still floats outside inventory')
      await click(query('[aria-label="Select all visible pull requests"]'))
      ensure(!firstCheckbox.checked && !secondCheckbox.checked,'Deselect-visible changed the wrong scope')
      await click(query('[aria-label="Select all visible pull requests"]'))
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Select-visible failed')
      ensure(mutationRequests().length===0,'Bulk selection mutated remote work')
    })
    await check('refresh preserves selection across pages and announces changed versions', async () => {
      window.fixturePaging=true
      await checkGithub('Refresh did not finish')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Refresh discarded unchanged selection or skipped selected later page')
      window.fixtureChangedHead=true
      await checkGithub('Changed refresh did not finish')
      ensure(firstCheckbox.checked && !secondCheckbox.checked,'Changed head remained selected or unchanged head was lost')
      ensure(text(query('.co-public-work')).includes('Selection updated: owner/project#8'),'Selection change was not announced')
      window.fixturePaging=false; window.fixtureChangedHead=false
      await checkGithub('Restored refresh did not finish')
      await click(secondCheckbox)
    })
    await check('inline PR detail retains filters, hidden selection, list identity and keyboard return', async () => {
      const search=query('input[aria-label="Find a pull request"]')
      await setFilter('unassigned'); await fill(search,'Contribution')
      ensure(!query('input[aria-label="Select owner/project #8"]'),'Fixture filter did not hide selected PR')
      ensure(text(query('.co-pr-box-head')).includes('2 selected'),'Filtering discarded hidden selection')
      // A Möbius without the core review routes: optional workflows say so, never "Checking…" forever.
      window.presetsMissing=true
      try {
        await chooseAgent(query('.co-pr-box-head'), 'Review each')
        ensure(text(review()).includes('Contribution 7') && text(review()).includes('Contribution 8'),'Hidden selected identity omitted from confirmation')
        await until(()=>text(review()).includes('need the companion Möbius update'),'A missing review-presets route kept checking')
        ensure(!text(review()).includes('Checking'),'Unsupported workflows still read as a pending check')
        await closeReview()
      } finally { window.presetsMissing=false }
      const trigger=query('.co-pr-open'), listBefore=query('.co-pr-list')
      trigger.focus(); await click(trigger)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 7'),'Inline detail did not load')
      const region=query('[data-task="task:detail"]')
      ensure(region.getAttribute('role')==='region' && !query('.co-task-dock'),'Detail is not an inline nonmodal region')
      ensure(query('.co-pr-detail').closest('.co-pr-row')?.dataset.pr==='owner/project#7','Detail is not anchored to its PR')
      ensure(filterChip('unassigned').getAttribute('aria-pressed')==='true' && search.value==='Contribution','Opening detail cleared filter or search')
      ensure(query('.co-pr-list')===listBefore && text(query('.co-pr-box-head')).includes('2 selected'),'Opening detail remounted list or changed selection')
      await nativeEscape(); await until(() => !query('.co-task-content'),'Escape did not close inline detail')
      ensure(document.activeElement===trigger,'Escape did not return focus to the detail trigger')
      await fill(search,''); await setFilter('all')
      await until(() => document.querySelectorAll('.co-pr-row').length===2,'PR list did not restore')
      secondCheckbox=query('input[aria-label="Select owner/project #8"]')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Closing detail changed selected versions')
    })
    await check('hiding an opened PR deliberately closes detail without losing filters or resurrecting it', async () => {
      const before=mutationRequests().length
      const search=query('[aria-label="Find a pull request"]')
      const openSecond=async()=>{
        const trigger=[...document.querySelectorAll('.co-pr-open')].find(node=>text(node).includes('Contribution 8'))
        trigger.focus(); await click(trigger)
        await until(()=>query('.co-pr-detail'),'Detail did not open')
      }
      await openSecond()
      await setFilter('unassigned')
      await until(()=>!query('.co-pr-detail'),'Filter did not hide target detail')
      ensure(document.activeElement===filterChip('unassigned'),'Closing filtered detail stole focus from its filter')
      await setFilter('all')
      ensure(!query('.co-pr-detail') && !query('[data-task="task:detail"]'),'Clearing filter resurrected a hidden detail task')
      await openSecond(); search.focus(); await fill(search,'Contribution')
      ensure(query('.co-pr-detail'),'A still-visible PR lost its detail')
      await fill(search,'Contribution 7')
      ensure(!query('.co-pr-detail') && document.activeElement===search,'Search did not close detail while retaining typing focus')
      await fill(search,'')
      ensure(!query('[data-task="task:detail"]'),'Clearing search resurrected a hidden detail task')
      await openSecond(); window.emptyPulls=true
      await click(checkButton())
      await until(()=>!query('.co-pr-row'),'Refresh did not remove fixture PRs')
      window.emptyPulls=false
      await click(checkButton())
      await until(()=>document.querySelectorAll('.co-pr-row').length===2,'PRs did not reload')
      ensure(!query('[data-task="task:detail"]'),'Refreshing a removed PR resurrected its hidden task')
      ensure(navigation.length===inventoryNavigationDepth && mutationRequests().length===before,'Detail disappearance navigated or mutated work')
      // An empty successful refresh correctly clears the selected identities.
      await click(query('[aria-label="Select all visible pull requests"]'))
      await openSecond(); await chooseAgent(query('.co-pr-detail'))
      // The review window is modal: filters behind it cannot change its scope.
      ensure(review().closest('[role=dialog]')?.getAttribute('aria-modal')==='true','Review window is not a modal dialog')
      ensure(text(review()).includes('Contribution 8') && !text(review()).includes('Contribution 7'),'Individual review changed PR scope')
      await closeReview(); await setFilter('all')
      ensure(mutationRequests().length===before,'Filtering an existing confirmation approved work')
      firstCheckbox=query('input[aria-label="Select owner/project #7"]')
      secondCheckbox=query('input[aria-label="Select owner/project #8"]')
    })
    await check('closing batch actions restores their original keyboard trigger', async () => {
      const agent=query('.co-pr-box-head .co-agent-menu-button'); agent.focus()
      await chooseAgent(query('.co-pr-box-head'))
      await closeReview()
      await until(() => !review(),'Review window did not close')
      ensure(agent.isConnected && document.activeElement===agent,'Closing the window lost keyboard focus instead of returning to the Agent action')
      const trigger=button('Assign',query('.co-pr-box-head')); trigger.focus(); await click(trigger)
      await until(() => query('.co-task-content'),'Inline action did not open')
      await click(query('.co-task-content [aria-label="Close action"]'))
      await until(() => !query('.co-task-content'),'Inline action did not close')
      ensure(trigger.isConnected && document.activeElement===trigger,'Closing lost keyboard focus instead of returning to the batch action')
      ensure(mutationRequests().length===0,'Closing submitted a workflow')
    })
    await check('individual PR detail leads with Comments and retains guarded review and merge choices', async () => {
      const title=document.querySelectorAll('.co-pr-open')[1]
      title.focus(); await click(title)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 8'),'Description did not load')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Opening detail replaced batch selection')
      ensure(!query('.co-file-disclosure') && !calls.requests.some(call => call.url.includes('/files?')),'Diff loaded by default')
      const tabs=query('.co-detail-tabs')
      ensure(detailTab('Comments',tabs).getAttribute('aria-pressed')==='true' && [...tabs.querySelectorAll('button')].some(node=>text(node).startsWith('Files changed1')) && detailTab('Checks',tabs),'Comments, Files changed, and Checks tabs were not maintained')
      ensure(query('.co-task-content .co-agent-menu-button'),'Individual review choices were lost')
      ensure(mutationRequests().length === 0 && navigation.length === inventoryNavigationDepth,'Opening PR changed work or screens')
    })
    await check('files load only on demand and remain collapsed while discussion stays in Comments', async () => {
      await click(detailTab('Files changed'))
      await until(() => query('.co-file-disclosure'),'Files did not load')
      ensure(!query('.co-file-disclosure').open,'Patch opened by default')
      await click(query('.co-file-disclosure summary'))
      ensure(query('.co-file-disclosure').open && text(query('.co-file-disclosure .diff-view')).includes('safe change'),'Patch disclosure failed')
      window.failChecks=true
      await click(detailTab('Checks'))
      await until(()=>text(query('.co-pr-detail')).includes('Check runs: Could not load this information'),'Partial check failure missing')
      ensure(text(query('.co-pr-detail')).includes('Build') && text(query('.co-pr-detail')).includes('not an all-clear review'),'Successful sibling or check limitation disappeared')
      window.failChecks=false
      await click(button('Retry',query('.co-pr-detail')))
      await until(()=>text(query('.co-pr-detail')).includes('Unit tests') && !text(query('.co-pr-detail')).includes('Check runs: Could not load this information'),'Check retry did not settle')
      ensure(calls.requests.filter(call=>call.url.includes('/commits/')).every(call=>call.url.includes(SECOND_HEAD)),'Checks used another PR head')
      await click(detailTab('Comments'))
      await until(() => text(query('.co-pr-detail')).includes('Please check this edge case'),'Activity did not load')
      ensure(!query('.co-file-disclosure'),'Files leaked into activity')
      const title=document.querySelectorAll('.co-pr-open')[1]
      await asReviewer()
      try {
      await chooseAgent(query('.co-task-content'), NAMES.review)
      ensure(text(review()).includes('Contribution 8') && text(review()).includes('ccccccc') && !text(review()).includes('Contribution 7'),'Individual review changed PR scope or version')
      ensure(button('Start private review'),'Individual review granted merge by default')
      const mergeSwitch=await chooseDraftThenMergeSwitch()
      ensure(button('Start review, draft a verdict for me'),'Drafting a verdict granted merge or lost its start label')
      await click(mergeSwitch)
      ensure(button('Start review, merge after your approval'),'Individual merge choice did not require guarded approval')
      ensure(mutationRequests().length===0,'Changing individual review mode mutated GitHub')
      await closeReview()
      } finally { await asOwner() }
      await until(() => !review() && !query('.co-task-content'),'Individual review did not close')
      ensure(document.activeElement===title,'Closing individual review did not return focus to its row trigger (focused '+(document.activeElement?.className || document.activeElement?.tagName)+': '+text(document.activeElement)+')')
    })
    await check('batch assignment uses one explicit person action and preserves selected PRs', async () => {
      await click(button('Assign',query('.co-pr-box-head')))
      await until(() => query('[aria-label="Assign to me"]'),'People did not load')
      ensure(mutationRequests().length === 0,'Opening picker assigned prematurely')
      ensure(document.activeElement === query('.co-person-search input'),'People search did not receive focus')
      // #98 intentionally replaces the fixed dock with an inline region.
      // Opening it may scroll it into view; selection itself must not scroll.
      const assignmentRect=query('.co-person-search').getBoundingClientRect()
      ensure(assignmentRect.top>=0 && assignmentRect.bottom<=innerHeight && query('.co-pr-list')===originalList,'Inline assignment is not reachable or replaced the list')
      window.failAssignment = 8
      await click(query('[aria-label="Assign to me"]'))
      await until(() => mutationRequests().length === 2 && text(query('.co-pr-assignment')).includes('Only remaining'),'Partial result missing')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Partial assignment lost selection')
      window.failAssignment = null
      await click(query('[aria-label="Assign to me"]'))
      await until(() => mutationRequests().length === 3 && !query('.co-pr-assignment'),'Assignment retry did not finish')
      const assigned = mutationRequests().filter(call => call.url.endsWith('/assign-review'))
      ensure(assigned.map(call => call.body.number).join(',') === '7,8,8','Successful assignment was repeated')
      ensure(firstCheckbox.checked && secondCheckbox.checked && reviewRuns.length === 0,'Assignment started review or lost selection')
    })
    await check('inline batch review enumerates exact versions and starts only after approval', async () => {
      await asReviewer()
      try {
      await chooseAgent(query('.co-pr-box-head'))
      ensure(review().closest('[role=dialog]')?.getAttribute('aria-modal')==='true','Batch review did not use the modal review window')
      ensure(text(review()).includes('Contribution 7') && text(review()).includes('Contribution 8'),'Batch lost a PR')
      ensure(text(review()).includes('aaaaaaa') && text(review()).includes('ccccccc'),'Exact heads absent')
      ensure(button('Start private review') && reviewRuns.length === 0,'Private review was not the default, or something started')
      const mergeToggle=await chooseDraftThenMergeSwitch()
      ensure(navigation.length === inventoryNavigationDepth && query('.co-pr-list') === originalList,'Review changed screens or remounted list')
      const region=review(), rect=region.getBoundingClientRect()
      ensure(rect.top >= 0 && rect.top < innerHeight && document.activeElement === region,'Review not visible/focused')
      await click(mergeToggle)
      ensure(reviewRuns.length === 0,'Mode toggle counted as approval')
      ensure(text(review()).includes('merges into the newest version of the target branch'),'Approval falsely pins the displayed base')
      ensure(text(review()).includes('all required checks pass'),'Review and required checks missing from approval')
      window.liveBase='d'.repeat(40)
      await enabled('Start review, merge after your approval')
      // Starting closes the review window and clears the selection; the run itself lives in its own conversation.
      await until(() => reviewRuns.length === 1 && !review(),'Review did not start')
      await until(() => ['7','8'].every(n => query('[data-pr="owner/project#'+n+'"]')?.closest('.co-frame')?.dataset.frame === 'reviewing'),'A started review did not show on its rows')
      ensure(!query('input[aria-label="Select owner/project #7"]').checked && !query('input[aria-label="Select owner/project #8"]').checked,'Starting a review kept the selection')
      const write=mutationRequests().at(-1)
      ensure(write.url.endsWith('/review-runs') && write.body.mode==='review_merge' && write.body.items.length===2,'Wrong workflow request')
      ensure(write.body.items[0].head_sha===HEAD && write.body.items[1].head_sha===SECOND_HEAD,'Approval lost selected heads')
      ensure(write.body.items.every(item=>item.base_ref==='main' && item.base_sha===window.liveBase),'Exact launch did not re-read the current same-target tip')
      ensure(calls.requests.filter(call=>call.body?.query?.includes('ContributeExactPull')).length===2,'Launch did not read exactly its selected PRs')
      window.liveBase=null
      ensure(query('.co-pr-list')===originalList,'Review replaced inventory')
      } finally { window.liveBase=null; await asOwner() }
    })
    await check('review errors preserve exact selection for an explicit retry', async () => {
      // The review above has finished, so its PRs are free to be reviewed again (an agent at work on a PR disables Review).
      for (const run of reviewRuns) { run.state='complete'; run.items=run.items.map(item=>({ ...item, state:'all_clear' })) }
      await click(checkButton())
      await until(() => { const frame = query('[data-pr="owner/project#7"]')?.closest('.co-frame')?.dataset.frame; return frame && frame !== 'reviewing' },'Finished review did not reload')
      await inventory(); await click(firstCheckbox); await chooseAgent(query('.co-pr-box-head'))
      window.failReview = true
      await enabled('Start private review')
      await until(() => text(review()).includes('Fixture review error'),'No workflow error')
      ensure(firstCheckbox.checked && reviewRuns.length===1,'Failed review lost selection or started work')
      window.failReview=false; await closeReview(); await click(query('[aria-label="Clear selection"]'))
    })
    await check('changed exact code blocks an inline review instead of approving a refreshed head', async () => {
      const before=mutationRequests().length
      await click(firstCheckbox); await chooseAgent(query('.co-pr-box-head'))
      window.exactHeadChanged=true
      await enabled('Start private review')
      await until(()=>text(review()).includes('changed since this list loaded'),'Changed code did not stop exact launch')
      ensure(mutationRequests().length===before && reviewRuns.length===1,'Changed code was approved')
      window.exactHeadChanged=false
      await closeReview(); await click(query('[aria-label="Clear selection"]'))
    })
    await check('explicit send joins the same public inventory without implying merge', async () => {
      await inventory(); await click(button(opens))
      await until(() => button(sends),'Publication confirmation missing')
      ensure(calls.publications.length===0,'Opening publication sent work')
      await click(button(sends))
      await until(() => query('input[aria-label="Select owner/project #9"]'),'Published record absent')
      ensure(calls.publications.length===1 && calls.publications[0].plan.head_sha===HEAD,'Publication duplicated or lost reviewed head')
      ensure(query('.co-pr-list')===originalList,'Publication replaced inventory')
      await until(() => button('Done') && text(query('.co-task-content')).includes('Sent to GitHub'),'Publication outcome missing')
      ensure(!button(sends) && !button(opens),'Settled publication remained actionable')
      await click(button('Done'))
      ensure(query('input[aria-label="Select owner/project #9"]').getClientRects().length,'Published PR not selectable')
    })
    await check('dismissed work is discoverable without a link and only explicit Restore changes its local state', async () => {
      const before=mutationRequests().length, publications=calls.publications.length
      await openTab('Agent runs')
      const archive=query('.co-run-fold.is-recent')
      ensure(archive && !archive.open,'Dismissed contributions have no collapsed discovery route')
      await click(archive.querySelector('summary'))
      const row=[...archive.querySelectorAll('button')].find(node=>text(node).includes('Dismissed local proposal'))
      ensure(row && row.getClientRects().length,'Dismissed proposal is not discoverable')
      row.focus(); await click(row)
      await until(()=>button('Restore'),'Dismissed contribution cannot be restored from its discovered detail')
      ensure(calls.restores.length===0 && mutationRequests().length===before,'Inspecting dismissed work changed it')
      await nativeEscape(); await until(()=>!query('.co-task-content'),'Escape did not close dismissed detail')
      ensure(document.activeElement===row,'Dismissed detail did not return focus to its row')
      await click(row); await click(button('Restore'))
      await until(()=>calls.restores.length===1 && !query('.co-run-fold.is-recent'),'Restore did not move exact record out of history')
      ensure(calls.restores[0]==='fixture-dismissed' && calls.publications.length===publications && mutationRequests().length===before,'Restore published work or restored another record')
      await inventory()
      ensure(button(opens),'Restored record did not return to private preparation')
      await backToPrs()
    })
    await check('PR inventory distinguishes failed refresh, empty results and loading without mutations', async () => {
      const before=mutationRequests().length
      window.failPulls=true
      await click(checkButton())
      await until(()=>text(query('.co-public-work')).includes('Couldn’t load pull requests'),'Read failure missing')
      ensure(document.querySelectorAll('.co-pr-row').length===3,'Failed refresh erased saved inventory')
      window.failPulls=false
      await click(button('Try again',query('.co-public-work')))
      await until(()=>!query('.co-public-work [role="alert"]'),'Read retry did not clear error')
      window.emptyPulls=true
      await click(checkButton())
      await until(()=>text(query('.co-pr-empty')).includes('No pull requests'),'Empty inventory missing')
      ensure(!query('.co-pr-row'),'Empty result kept stale rows')
      window.emptyPulls=false; window.holdPulls=true
      await click(checkButton())
      await until(()=>window.releasePulls && query('.co-pr-skel'),'Loading confused with empty')
      ensure(!text(query('.co-pr-empty')).includes('No pull requests'),'Loading claimed an empty result')
      window.holdPulls=false; window.releasePulls(); window.releasePulls=null
      await until(()=>document.querySelectorAll('.co-pr-row').length===3,'Released inventory did not load')
      const search=query('[aria-label="Find a pull request"]')
      await fill(search,'no-such-contribution')
      ensure(text(query('.co-pr-empty')).includes('No pull requests match'),'Search empty result missing')
      await fill(search,'')
      ensure(mutationRequests().length===before && query('.co-pr-list')===originalList,'Read states mutated work or remounted inventory')
    })
    await check('local comparison is lazy, versioned, read-only and distinguishes loading, failure, empty and stale', async () => {
      const before=mutationRequests().length
      ensure(calls.diffs.length===0,'Local source diff loaded before inspection')
      window.holdDiff=true; window.diffMode='error'
      const local=()=>button('See the files')
      await click(local())
      await until(()=>window.releaseDiff && query('.co-project-diff-loading'),'Comparison loader missing')
      window.holdDiff=false; window.releaseDiff(); window.releaseDiff=null
      await until(()=>button('Could not load diffs · try again'),'Comparison error missing')
      window.diffMode='empty'; await click(button('Could not load diffs · try again'))
      await until(()=>text(query('.co-project-diff-empty')).includes('No changed files'),'Empty comparison missing')
      await inventory(); window.diffMode='stale'; await click(local())
      await until(()=>button('Project changed · check again'),'Stale comparison not distinguished')
      window.diffMode='ready'; await click(button('Project changed · check again'))
      await until(()=>text(query('.diff-view')).includes('local improvement'),'Fresh comparison did not recover')
      await click(query('.co-position-details summary'))
      ensure(text(query('.co-position-details')).includes('aaaaaaa') && text(query('.co-position-details')).includes('bbbbbbb'),'Compared versions missing')
      ensure(calls.diffs.every(call=>call.key==='app:fixture' && call.head===HEAD && call.base===BASE),'Comparison drifted to another source')
      ensure(mutationRequests().length===before && calls.starts.length===0,'Read-only comparison started work')
      await inventory()
    })
    await check('source conversation scope loads lazily and remains separate from project preparation', async () => {
      await click(button('Make PRs from local changes'))
      await until(() => query('[data-task="task:prepare"]'),'Preparation did not open')
      const scope = query('.co-prepare-scope')
      ensure(text(scope).includes('1 edited file'),'Preparation did not show the collocated file scope')
      window.holdScope=true; window.failScope=true
      await click(scope)
      await until(()=>window.releaseScope && text(query('[data-task="task:scope"]')).includes('Finding source conversations'),'Scope loader missing')
      window.holdScope=false; window.releaseScope(); window.releaseScope=null
      await until(()=>text(query('[data-task="task:scope"]')).includes('Fixture scope unavailable'),'Scope failure missing')
      ensure(text(query('[data-task="task:scope"]')).includes('All local work'),'Scope failure hid project preparation')
      window.failScope=false; await click(button('Try again',query('[data-task="task:scope"]')))
      await until(() => text(query('[data-task="task:scope"]')).includes('No source conversations'),'Scope did not load')
      ensure(calls.starts.length===0,'Choosing scope started work')
      await click([...document.querySelectorAll('.co-scope-row')][0])
    })
    await check('preparation starts once and project switching restores its durable owner', async () => {
      const prepareButton=button('Start',query('[data-task="task:prepare"]'))
      prepareButton.click(); prepareButton.click()
      await until(() => button('Open conversation'),'Preparation did not start')
      ensure(calls.starts.length===1 && calls.starts[0].draft.includes('app:fixture') && !calls.starts[0].draft.includes('app:other'),'Duplicate or wrong scope')
      await chooseProject('Other project'); ensure(!button('Open conversation'),'Other project inherited progress')
      await chooseProject('Fixture project')
      await openTab('Agent runs')
      await until(() => text(query('.co-work-progress-row')).includes('Agent working'),'Saved task did not restore')
      await click(query('.co-work-progress-row'))
      await until(() => button('Open current conversation',query('[data-task="task:cycle"]')),'Saved conversation unavailable')
      ensure(calls.status.includes('prepare-1') && calls.starts.length===1,'Restore restarted work')
    })
    await check('losing merge rights hides new cycle starts but keeps current work and history visible', async () => {
      window.setProjectsFixture(old => old.map(project => project.key === 'app:fixture' ? { ...project, viewerPermission: 'READ' } : project))
      await chooseProject('Other project'); await chooseProject('Fixture project')
      await openTab('Agent runs')
      await until(() => text(query('.co-work-progress-row')).includes('Agent working'), 'Current work hidden without merge rights')
      await click(query('.co-work-progress-row'))
      const pane = () => query('[data-task="task:cycle"]')
      await until(() => pane() && button('Open current conversation', pane()), 'Cycle status hidden without merge rights')
      ensure(!button('Start fresh full merge cycle', pane()), 'A read-only project offered a new merge cycle')
      await click(button('Make PRs from local changes'))
      ensure(!text(query('[data-task="task:prepare"]')).includes('Follow through to merge'), 'A read-only project offered follow-through to merge')
      window.setProjectsFixture(old => old.map(project => project.key === 'app:fixture' ? { ...project, viewerPermission: 'WRITE' } : project))
    })
    await check('effort choices are 44px targets on every viewport', async () => {
      await chooseProject('Other project'); await click(button('Make PRs from local changes'))
      await until(() => query('[data-task="task:prepare"] .co-agent-trigger'), 'Make PRs launch did not open')
      const pane = query('[data-task="task:prepare"]')
      await click(pane.querySelector('.co-agent-trigger'))
      await until(() => pane.querySelector('.co-model-row'), 'Model choices did not load')
      const row = [...pane.querySelectorAll('.co-model-row')].find(node => text(node).includes('Fixture model'))
      if (row) await click(row)
      await until(() => pane.querySelector('.co-effort-stop'), 'Effort choices did not appear')
      for (const stop of pane.querySelectorAll('.co-effort-stop')) {
        const box = stop.getBoundingClientRect()
        ensure(box.width >= 44 && box.height >= 44, 'Effort target below 44px: ' + box.width + 'x' + box.height)
      }
      // Every supported level (six), and both edges of each target, are tappable.
      const stops = [...pane.querySelectorAll('.co-effort-stop')]
      ensure(stops.length === 6, 'Fixture did not offer the full effort scale')
      for (const stop of stops) {
        stop.scrollIntoView({ block: 'center', inline: 'nearest' }); await frame()
        const box = stop.getBoundingClientRect()
        for (const x of [box.left + 3, box.right - 3]) ensure(document.elementFromPoint(x, box.top + box.height / 2) === stop, 'An effort target edge does not hit it: ' + stop.getAttribute('aria-label'))
      }
      await inventory(); await chooseProject('Fixture project')
    })
    await check('finishing an uncertain start replays its exact saved work, not today\'s choice', async () => {
      // A separate project, so later checks keep their idle projects.
      window.setProjectsFixture(old => [...old, { ...old.find(project => project.key === 'app:other'), key: 'app:third', name: 'Third project', canonical_repo: 'owner/third' }])
      await chooseProject('Third project')
      const starts = calls.starts.length
      window.lostStart = true
      const startIn = () => button('Start', query('[data-task="task:prepare"]'))
      await click(button('Make PRs from local changes')); await until(() => startIn() && !startIn().disabled, 'Make PRs did not settle')
      await click(startIn())
      await openTab('Agent runs')
      await until(() => text(query('.co-work-progress-row')).includes('A start needs sending'), 'An unconfirmed start was not offered again')
      const original = calls.starts.at(-1)
      window.lostStart = false
      await chooseProject('Fixture project'); await chooseProject('Third project')
      await openTab('Agent runs')
      await until(() => text(query('.co-work-progress-row')).includes('A start needs sending'), 'The saved cycle was lost on reload')
      await click(query('.co-work-progress-row'))
      await enabled('Send again')
      await until(() => calls.starts.length === starts + 2, 'Send again did not resend')
      const replay = calls.starts.at(-1)
      ensure(replay.cid && replay.cid === original.cid && replay.scope === original.scope && replay.draft === original.draft && replay.title === original.title, 'Send again sent a different cycle, work or scope')
      await until(() => button('Open current conversation', query('[data-task="task:cycle"]')), 'Finished start did not settle')
      await chooseProject('Fixture project')
      window.setProjectsFixture(old => old.filter(project => project.key !== 'app:third'))
    })
    await check('making PRs requires one explicit scoped agent handoff and preserves failures', async () => {
      await chooseProject('Other project')
      const before=mutationRequests().length, starts=calls.starts.length
      const pane=()=>query('[data-task="task:prepare"]'), start=()=>button('Start', pane())
      ensure(!button('Pull updates') && !button('Start pull'),'Contribute still offered its own pull')
      await click(button('Make PRs from local changes'))
      await until(()=>start() && !start().disabled,'Make PRs action did not settle')
      ensure(calls.starts.length===starts && mutationRequests().length===before,'Opening preparation started or published work')
      window.failStart=true; await click(start())
      await until(()=>text(pane()).includes('Fixture agent unavailable'),'Agent-start failure missing')
      ensure(calls.starts.length===starts,'Failed handoff counted as started')
      // A failed start keeps its cycle for Send again. No conversation holds
      // it, so Send again refuses to create one; the owner starts new work.
      ensure(button('Send again', pane()), 'A failed start offered no way to send it again')
      window.failStart=false
      const finish=button('Send again', pane()); finish.click(); finish.click()
      await until(()=>text(pane()).includes('This start isn’t in any conversation. Start it again.') && !button('Send again', pane()),'An unheld start was resent or kept offered')
      ensure(calls.starts.length===starts,'Send again created a conversation for an unheld start')
      await click(start())
      await until(()=>calls.starts.length===starts+1 && button('Open conversation'),'Preparation did not start once')
      const action=calls.starts.at(-1)
      ensure(action.draft.includes('app:other') && !action.draft.includes('app:fixture'),'Preparation scope drifted')
      ensure(action.draft.includes('Do not push, publish'),'Private preparation boundary missing')
      ensure(mutationRequests().length===before,'Preparation handoff mutated GitHub')
      await chooseProject('Fixture project')
    })
    const savedRun = (id, number, head, state) => ({id,mode:'review',state:'complete',chat_id:id+'-chat',
      items:[{repo:'owner/project',number,head_sha:head,base_ref:'main',base_sha:BASE,state,summary:'Saved findings for '+id}]})
    const historyEntry = id => query('[data-review-run="'+id+'"]')
    const historyFold = () => query('.co-review-history')
    async function openHistory() {
      await openTab('Agent runs')
      await until(()=>historyFold(),'Project review conversations are undiscoverable')
      if(!historyFold().open) await click(historyFold().querySelector('summary'))
    }
    async function openSavedRun(id, expected) {
      await openHistory()
      const opener=historyEntry(id)
      ensure(opener && opener.getClientRects().length,'Saved run has no visible opener: '+id)
      opener.focus(); await nativeSpace()
      const pane=()=>query('[data-task="task:run:'+id+'"]')
      await until(()=>pane(),'Saved run did not open: '+id)
      ensure(text(pane()).includes(expected),'Saved run lost its version context: '+text(pane()))
      const conversation=button('Answer in chat',pane()) || button('Open chat',pane())
      // This hermetic page is top-level. Mock only the direct shell boundary,
      // retaining the component's actual opaque-frame postMessage path.
      const parentDescriptor=Object.getOwnPropertyDescriptor(window,'parent')
      Object.defineProperty(window,'parent',{configurable:true,value:{postMessage(message,target){
        ensure(message.type==='moebius:open-chat' && target==='*','Wrong shell conversation command')
        calls.opened.push(message.chatId)
      }}})
      try { await click(conversation) } finally { Object.defineProperty(window,'parent',parentDescriptor) }
      ensure(calls.opened.at(-1)===id+'-chat','Opened another review conversation')
      pane().focus(); await nativeEscape()
      await until(()=>!pane(),'Saved run did not close with Escape')
      ensure(document.activeElement===opener,'Saved run did not restore focus to its history entry')
    }
    await check('project review conversations retain older, needs-you and unknown outcomes without treating them as current verdicts', async () => {
      await inventory()
      const before=mutationRequests().length, starts=calls.starts.length
      reviewRuns.unshift(savedRun('saved-current',7,HEAD,'all_clear'),savedRun('saved-needs',8,SECOND_HEAD,'needs_you'),
        savedRun('saved-unknown',7,'d'.repeat(40),'merge_unknown'),savedRun('saved-older',7,'d'.repeat(40),'all_clear'),
        savedRun('saved-shadowed',7,HEAD,'needs_you'),
        {...savedRun('saved-base',7,HEAD,'all_clear'),items:[{...savedRun('saved-base',7,HEAD,'all_clear').items[0],base_sha:'f'.repeat(40)}]},
        {...savedRun('another-project',7,HEAD,'needs_you'),items:[{repo:'owner/other',number:7,state:'needs_you'}]})
      await click(checkButton())
      await openHistory()
      ensure(!historyEntry('another-project'),'Another project leaked into review history')
      ensure(text(historyEntry('saved-needs')).includes('Needs you'),'Saved question is not discoverable')
      ensure(text(historyEntry('saved-unknown')).includes('Outcome needs checking'),'Unknown merge outcome is not discoverable')
      ensure(text(historyEntry('saved-older')).includes('Older PR version'),'Older clear verdict lacks stale context')
      await openSavedRun('saved-needs','Matches loaded PR version')
      await openSavedRun('saved-unknown','Older PR version')
      await openSavedRun('saved-older','Older PR version')
      await openSavedRun('saved-shadowed','Matches loaded PR version')
      await openSavedRun('saved-base','Older base version')
      ensure(mutationRequests().length===before && calls.starts.length===starts,'Inspecting saved reviews started or mutated work')
    })
    await check('saved reviews stay reachable during loading and failure without claiming a fresh version check', async () => {
      const before=mutationRequests().length
      window.holdPulls=true; window.failPulls=false
      await click(checkButton())
      await until(()=>window.releasePulls && text(historyEntry('saved-current')).includes('Current version not checked'),'Loading inventory reused a fresh verdict')
      await openSavedRun('saved-current','Current version not checked')
      window.holdPulls=false; window.releasePulls(); window.releasePulls=null
      await until(()=>text(historyEntry('saved-current')).includes('Matches loaded PR version'),'Refresh did not finish')
      window.failPulls=true
      await click(checkButton())
      await until(()=>text(query('.co-public-work')).includes('Couldn’t load pull requests'),'Inventory failure missing')
      await openSavedRun('saved-needs','Current version not checked')
      window.failPulls=false
      await click(button('Try again',query('.co-public-work')))
      await until(()=>text(historyEntry('saved-needs')).includes('Matches loaded PR version'),'Inventory retry did not recover')
      ensure(mutationRequests().length===before,'Inspecting review recovery mutated work')
    })
    await check('saved review conversations survive head changes, search filtering, closed PRs and project reopen', async () => {
      const before=mutationRequests().length, starts=calls.starts.length
      window.fixtureChangedHead=true
      await click(checkButton())
      await until(()=>text(historyEntry('saved-needs')).includes('Older PR version'),'Changed-head review was hidden or shown as current')
      // Searching PRs on All PRs never hides saved reviews in Agent runs.
      await openTab('All PRs'); await fill(query('[aria-label="Find a pull request"]'),'no matching pull')
      await openSavedRun('saved-needs','Older PR version')
      await openTab('All PRs'); await fill(query('[aria-label="Find a pull request"]'),'')
      window.emptyPulls=true
      await click(checkButton())
      await until(()=>!query('.co-pr-row'),'Closed PR fixture still appears open')
      await chooseProject('Other project'); await chooseProject('Fixture project')
      await openSavedRun('saved-needs','Not in the loaded open PRs')
      await openSavedRun('saved-unknown','Not in the loaded open PRs')
      await openSavedRun('saved-older','Not in the loaded open PRs')
      ensure(mutationRequests().length===before && calls.starts.length===starts,'Reopening review history restarted work')
      window.emptyPulls=false; window.fixtureChangedHead=false
      await backToPrs(); await click(checkButton())
      await until(()=>query('.co-pr-row'),'PR inventory did not recover')
    })
    await check('unknown GitHub status exposes inline retry without opening a task and prevents duplicate checks', async () => {
      await inventory()
      const before=mutationRequests().length
      window.setConnectionFixture({state:'unknown',message:'Fixture GitHub check timed out.'})
      await until(()=>button('Check GitHub again'),'Unknown GitHub retry is hidden behind an unopened task')
      ensure(button('Check GitHub again').getClientRects().length,'GitHub retry is not visible')
      ensure(text(query('.co-workspace')).includes('Your connection is unchanged'),'Unknown status implies disconnected account')
      await click(button('Check GitHub again'))
      await until(()=>button('Checking…')?.disabled && window.finishGithubRetry,'Retry did not expose checking state')
      button('Checking…').click()
      ensure(calls.githubRetries===1,'Disabled retry repeated the check')
      window.finishGithubRetry()
      await until(()=>!button('Checking…') && query('.co-pr-row'),'Retry did not recover the PR list')
      ensure(mutationRequests().length===before,'Connection retry mutated public work')
    })
    const exactReads = () => calls.requests.filter(call => call.body?.query?.includes('ContributeExactPull')).length
    const listReads = () => calls.requests.filter(call => call.body?.query?.includes('ContributePullRequests')).length
    const focusedDetail = number => query('.co-pr-detail[aria-label="Details for PR ' + number + '"]')
    const prRow = number => query('[data-pr="owner/project#' + number + '"]')
    await check('a chat PR link opens the exact later-page or closed PR read-only, then releases it on leaving', async () => {
      await chooseProject('Fixture project'); await inventory()
      window.fixturePaging = true
      await click(checkButton())
      await until(() => prRow(7) && !prRow(8), 'Paged inventory did not load')
      const exactBefore = exactReads(), listBefore = listReads(), mutationsBefore = mutationRequests().length
      window.focusPullFixture({ repo: 'owner/project', number: 8, nonce: 'later-page' })
      await until(() => focusedDetail(8) && prRow(8)?.classList.contains('is-highlighted'), 'Later-page link did not open its exact PR')
      window.setRecordsFixture(old => [...old, { id: 'fixture-closed', type: 'pr', status: 'closed', repo: 'owner/project', number: 11,
        title: 'Closed contribution', chat_id: 'source-11', quality_review: { chat_id: 'review-11' } }])
      window.focusPullFixture({ repo: 'owner/project', number: 11, nonce: 'closed' })
      await until(() => focusedDetail(11) && prRow(11)?.classList.contains('is-highlighted'), 'Closed link did not open its exact PR')
      ensure(!prRow(8), 'A replaced link stayed pinned')
      ensure(prRow(11).querySelector('input[type="checkbox"]').disabled && !prRow(11).querySelector('[aria-label="Assign PR 11"]')
        && !prRow(11).querySelector('.co-agent-menu-button'), 'Closed PR became selectable, assignable or startable')
      ensure(!focusedDetail(11).querySelector('.co-agent-menu-button') && !button('Assign', focusedDetail(11)), 'Closed PR detail offered new work')
      await until(() => text(focusedDetail(11)).includes('Fixture PR description 11'), 'Closed PR detail did not read its own conversation')
      ensure(!text(focusedDetail(11)).includes('changed since the list was loaded'), 'Closed PR detail treated its exact read as stale')
      ensure(exactReads() - exactBefore === 2 && listReads() === listBefore, 'Links scanned open pages instead of exact identities')
      const provenance = query('.co-gh-provenance')
      const links = [...provenance.querySelectorAll('.co-gh-chat-link')]
      const names = links.map(link => link.getAttribute('aria-label'))
      // The prepared PR, then one Open chat button per kind of conversation (where it started, the review).
      ensure(names.join('|') === ['Open prepared ' + NAMES.pr, NAMES.openChat + ' · where it started', NAMES.openChat + ' · review'].join('|') && links.every(link => !text(link)), 'Provenance is not one combined section of icon buttons: ' + names)
      ensure(document.querySelectorAll('.co-gh-provenance').length === 1, 'Provenance repeated')
      for (const link of links) {
        const box = link.getBoundingClientRect()
        ensure(box.height >= 44 && box.width >= 44, 'Provenance hit area below 44px: ' + text(link) + ' ' + box.width + 'x' + box.height)
      }
      const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent')
      Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage(message, target) {
        ensure(message.type === 'moebius:open-chat' && target === '*', 'Wrong shell conversation command')
        calls.opened.push(message.chatId)
      } } })
      try { await click(links[1]) } finally { Object.defineProperty(window, 'parent', parentDescriptor) }
      ensure(calls.opened.at(-1) === 'source-11', 'Provenance opened another conversation')
      await click(links[0])
      ensure(calls.opened.at(-1) === 'record:fixture-closed', 'Local preparation did not open its record')
      query('[data-task="task:detail"]').focus(); await nativeEscape()
      await until(() => !prRow(11), 'Closed PR stayed pinned after leaving its detail')
      ensure(calls.releases.includes('closed') && mutationRequests().length === mutationsBefore, 'Leaving did not release the link, or opening it mutated work')
      window.setRecordsFixture(old => old.filter(record => record.id !== 'fixture-closed'))
      window.fixturePaging = false
      await click(checkButton())
      await until(() => prRow(8), 'Inventory did not recover')
    })
    await check('a chat run link opens that run in its project and starts nothing', async () => {
      const run = { id: 'chat-run-12345678', mode: 'review', state: 'complete', chat_id: 'chat-run-chat', options: { review_prompt: 'Review fixture' },
        items: [{ repo: 'owner/project', number: 7, head_sha: HEAD, base_ref: 'main', base_sha: BASE, state: 'all_clear', summary: 'Linked run findings',
          public_review: { state: 'posted', url: 'https://github.com/owner/project/pull/7#pullrequestreview-1' } }] }
      // An older run, beyond the capped recent list: the link carries its exact read.
      const before = mutationRequests().length, starts = calls.starts.length
      window.oldRuns = new Map([[run.id, structuredClone(run)]])
      window.focusRunFixture({ runId: run.id, repo: 'owner/project', run, nonce: 'run-link' })
      const pane = () => query('[data-task="task:run:chat-run-12345678"]')
      await until(() => pane() && text(pane()).includes('Linked run findings'), 'Run link did not open its run')
      ensure(!reviewRuns.some(item => item.id === run.id), 'Fixture run leaked into the recent list')
      const exactBefore = calls.exactRuns.length
      await click(checkButton())
      await until(() => calls.exactRuns.length > exactBefore, 'Refresh did not reread the linked run')
      ensure(pane() && text(pane()).includes('Linked run findings'), 'A refresh evicted the linked run')
      ensure(text(pane()).includes('Recorded version') && pane().querySelector('a[href*="pullrequestreview-1"]') && button('Open chat', pane()), 'Shared run detail lost its version note, posted review or owning chat')
      ensure(mutationRequests().length === before && calls.starts.length === starts, 'Opening a run link started or changed work')
      pane().focus(); await nativeEscape()
      await until(() => !pane(), 'Run detail did not close')
      ensure(calls.releases.includes('run-link'), 'Leaving the run did not release its link')
      await until(() => !query('[data-review-run="' + run.id + '"]'), 'A released old run stayed pinned in project history')
      window.oldRuns = null
    })
    await check('a linked core run this app did not start renders honestly and is never observed here', async () => {
      // G1's committed minimized projection: no prompt, findings or options.
      const run = { id: 'core-run-1234', chat_id: 'core-owner-chat', state: 'reviewing', execution_state: 'running', mode: 'review_merge',
        created_at: '2026-10-23T09:00:00Z', app_id: null, can_stop: false, post_review: false, details_in_owning_chat: true,
        items: [{ repo: 'owner/project', number: 7, head_sha: HEAD, base_ref: 'main', base_sha: BASE, state: 'queued' }] }
      window.oldRuns = new Map([[run.id, structuredClone(run)]])
      window.focusRunFixture({ runId: run.id, repo: 'owner/project', run, nonce: 'core-run-link' })
      const pane = () => query('[data-task="task:run:core-run-1234"]')
      await until(() => pane() && text(pane()).includes('owning conversation'), 'Minimized run did not open')
      const exactBefore = calls.exactRuns.length
      await click(checkButton())
      await until(() => calls.exactRuns.length > exactBefore, 'Refresh did not reread the linked run')
      const shown = text(pane())
      ensure(shown.includes('Review & merge') && !shown.includes('Private review'), 'Minimized run was not titled by its mode')
      ensure(!/prompt snapshot|Older PR version|findings will appear here/.test(shown), 'Minimized run showed prompt or version warnings')
      ensure(button('Open the owning chat for details', pane()) && !button('Stop workflow', pane()), 'Minimized run lacks its owning-conversation link or offers Stop')
      ensure(!calls.requests.some(call => call.url.includes(run.id) && call.url.endsWith('/observe')), 'A run this app does not own was observed')
      pane().focus(); await nativeEscape()
      await until(() => !pane(), 'Run detail did not close')
      window.oldRuns = null
    })
    await check('a linked old run keeps its newest state across refresh instead of its navigation snapshot', async () => {
      const run = { id: 'old-run-87654321', mode: 'review', state: 'reviewing', execution_state: 'running', can_stop: true, chat_id: 'old-run-chat',
        items: [{ repo: 'owner/project', number: 7, head_sha: HEAD, base_ref: 'main', base_sha: BASE, state: 'reviewing', summary: 'Old active run' }] }
      window.oldRuns = new Map([[run.id, structuredClone(run)]])
      window.focusRunFixture({ runId: run.id, repo: 'owner/project', run, nonce: 'old-run-link' })
      const pane = () => query('[data-task="task:run:old-run-87654321"]')
      await until(() => pane() && text(pane()).includes('Recorded status: Reviewing'), 'Old run did not open')
      await click(button('Stop workflow', pane()))
      await until(() => text(pane()).includes('Recorded status: Stopped'), 'Stop result not shown')
      const exactBefore = calls.exactRuns.length
      await click(checkButton())
      await until(() => calls.exactRuns.length > exactBefore, 'Refresh did not reread the linked run exactly')
      await frame(); await frame()
      ensure(text(pane()).includes('Recorded status: Stopped') && !button('Stop workflow', pane()), 'A refresh resurrected the stale running snapshot')
      pane().focus(); await nativeEscape()
      await until(() => !pane(), 'Old run did not close')
      window.oldRuns = null
    })
    await check('an exact run read issued before Stop cannot undo the confirmed Stop', async () => {
      const run = { id: 'race-run-87654321', mode: 'review', state: 'reviewing', execution_state: 'running', can_stop: true, chat_id: 'race-run-chat',
        items: [{ repo: 'owner/project', number: 7, head_sha: HEAD, base_ref: 'main', base_sha: BASE, state: 'reviewing', summary: 'Race run' }] }
      window.oldRuns = new Map([[run.id, structuredClone(run)]])
      window.focusRunFixture({ runId: run.id, repo: 'owner/project', run, nonce: 'race-run-link' })
      const pane = () => query('[data-task="task:run:race-run-87654321"]')
      await until(() => pane() && text(pane()).includes('Recorded status: Reviewing'), 'Race run did not open')
      // Hold the exact read so it is issued before Stop and delivered after it.
      window.holdExactRun = true
      const exactBefore = calls.exactRuns.length
      await click(checkButton())
      await until(() => calls.exactRuns.length > exactBefore && window.releaseExactRun, 'Exact read was not issued')
      window.holdExactRun = false
      await click(button('Stop workflow', pane()))
      await until(() => text(pane()).includes('Recorded status: Stopped'), 'Stop result not shown')
      window.releaseExactRun(); window.releaseExactRun = null
      for (let i = 0; i < 6; i++) await frame()
      ensure(text(pane()).includes('Recorded status: Stopped') && !button('Stop workflow', pane()), 'An older read overwrote the confirmed Stop')
      pane().focus(); await nativeEscape()
      await until(() => !pane(), 'Race run did not close')
      window.oldRuns = null
    })
    await check('a linked later-page PR keeps its row while its review or assignment pane is open', async () => {
      window.fixturePaging = true
      await click(checkButton())
      await until(() => prRow(7) && !prRow(8), 'Paged inventory did not load')
      window.focusPullFixture({ repo: 'owner/project', number: 8, nonce: 'later-action' })
      await until(() => focusedDetail(8), 'Later-page link did not open its exact PR')
      await chooseAgent(focusedDetail(8))
      await frame(); await frame()
      ensure(prRow(8) && review() && text(review()).includes('Contribution 8'), 'The linked row or its review window disappeared')
      ensure(!calls.releases.includes('later-action'), 'Opening the review window released the link')
      await closeReview()
      await until(() => !prRow(8), 'Closing the pane kept the linked row pinned')
      ensure(calls.releases.includes('later-action'), 'Closing the pane did not release the link')
      window.focusPullFixture({ repo: 'owner/project', number: 8, nonce: 'later-assign' })
      await until(() => focusedDetail(8), 'Later-page link did not reopen its exact PR')
      await click(button('Assign', focusedDetail(8)))
      await until(() => query('.co-pr-assignment'), 'The assignment pane did not open')
      await frame(); await frame()
      ensure(prRow(8) && prRow(8).querySelector('.co-pr-assignment'), 'The linked row or its anchored assignment pane disappeared')
      ensure(!calls.releases.includes('later-assign'), 'Opening the assignment pane released the link')
      ensure(!button('Cancel', query('.co-pr-assignment')), 'Assignment still shows Cancel next to its close X')
      await click(query('.co-pr-assignment').closest('.co-task-content').querySelector('[aria-label="Close action"]'))
      await until(() => !prRow(8) && calls.releases.includes('later-assign'), 'Closing the assignment pane kept the link')
      window.fixturePaging = false
      await click(checkButton())
      await until(() => prRow(8), 'Inventory did not recover')
    })
    await check('switching project releases a chat PR link instead of pinning it on return', async () => {
      window.focusPullFixture({ repo: 'owner/project', number: 11, nonce: 'switch' })
      await until(() => focusedDetail(11), 'Link did not open its PR')
      await chooseProject('Other project')
      ensure(calls.releases.includes('switch'), 'Leaving the project did not release the link')
      await chooseProject('Fixture project')
      await until(() => prRow(7), 'Project did not reopen')
      ensure(!prRow(11) && !query('.co-pr-row.is-highlighted') && !query('.co-pr-detail'), 'A released link was pinned again')
    })
    await check('a repository looked up before local discovery opens its deduplicated local project', async () => {
      await inventory(); window.mobius.nav.back()
      await until(() => !query('.co-workspace') && query('.co-source-row'), 'Directory did not open')
      window.focusProjectFixture({ key: 'external:owner/project', repository: { nameWithOwner: 'OWNER/Project' }, nonce: 'cold-repo' })
      await until(() => text(query('.co-workspace-head')).includes('Fixture project'), 'Linked repository did not open its local project')
      await until(() => prRow(7), 'Linked project did not show its PRs')
      window.focusProjectFixture(null)
    })
    await check('host Back leaves the project once; inline details add no hidden back steps', async () => {
      await inventory(); await click(query('.co-pr-open'))
      const before = navigation.length
      window.mobius.nav.back()
      await until(() => !query('.co-workspace') && query('.co-source-row'),'Back did not restore directory')
      ensure(navigation.length===before-1,'Inline detail owned an extra back step')
    })
    const savedSelection = id => ({request_id:id,mode:'review_merge',items:[{repo:'owner/project',number:7,head_sha:HEAD,base_ref:'main',base_sha:BASE}]})
    async function showSelection(id, value = savedSelection(id)) {
      values.set('review-selections/' + id + '.json', value)
      window.openSelectionFixture(id)
      await until(() => !text(query('.co-selection-page')).includes('Checking the selected'), 'Approval link did not settle')
    }
    const beforeLink = mutationRequests().length
    await check('direct link opens exact approval without granting consent on navigation', async () => {
      await showSelection('selection-link-one')
      await until(() => button('Start review, merge when safe'), 'Review link did not reach exact approval')
      ensure(text(query('.co-selection-page')).includes('aaaaaaa → main (bbbbbbb)'), 'Link omitted selected version')
      ensure(!text(query('.co-selection-page')).includes('newest version of the target branch'),'Pinned link incorrectly allows base rebinding')
      ensure(mutationRequests().length === beforeLink, 'Opening an approval link mutated work')
    })
    await check('direct link confirmation posts exact scope once even after double click', async () => {
      // The approval resolves its frozen preview before it can be pressed.
      await until(() => button('Start review, merge when safe') && !button('Start review, merge when safe').disabled, 'Approval did not become available')
      const confirm = button('Start review, merge when safe')
      confirm.click(); confirm.click()
      await until(() => button('Open chat'), 'Approval did not open its owning conversation')
      ensure(mutationRequests().length === beforeLink + 1, 'Approval did not produce exactly one request')
      const body = mutationRequests().at(-1).body
      ensure(body.request_id === 'selection-link-one' && body.items[0].head_sha === HEAD && !body.chat_approval, 'Browser forged chat authority or changed selected work')
    })
    await check('already approved chat selection opens its owner without another approval', async () => {
      await click(button('Back to repositories'))
      await showSelection('selection-link-one')
      await until(() => button('Open chat'), 'Existing selection did not resolve its owner')
      ensure(!button('Start review, merge when safe') && mutationRequests().length === beforeLink + 1, 'Existing selection asked for duplicate approval')
    })
    await check('changed public version invalidates a link without silently advancing it', async () => {
      await click(button('Back to repositories'))
      const stale = savedSelection('selection-stale'); stale.items[0].head_sha = SECOND_HEAD
      await showSelection('selection-stale', stale)
      await until(() => text(query('.co-selection-page')).includes('changed or closed'), 'Changed version did not stop approval')
      ensure(!button('Start review, merge when safe') && mutationRequests().length === beforeLink + 1, 'Stale link mutated work')
    })
    await check('changed base version also invalidates a link without silently advancing it', async () => {
      await click(button('Back to repositories'))
      const stale = savedSelection('selection-stale-base'); stale.items[0].base_sha = 'd'.repeat(40)
      await showSelection('selection-stale-base', stale)
      await until(() => text(query('.co-selection-page')).includes('changed or closed'), 'Changed base did not stop approval')
      ensure(!button('Start review, merge when safe') && mutationRequests().length === beforeLink + 1, 'Stale-base link mutated work')
    })
    await check('editing saved selection during confirmation never approves replacement work', async () => {
      await click(button('Back to repositories'))
      await showSelection('selection-replaced')
      await until(() => button('Start review, merge when safe'), 'Proposal not ready')
      const changed = savedSelection('selection-replaced'); changed.items[0].number = 8
      values.set('review-selections/selection-replaced.json', changed)
      await enabled('Start review, merge when safe')
      await until(() => text(query('.co-selection-page')).includes('changed while you were reading'), 'Proposal replacement was not detected')
      ensure(mutationRequests().length === beforeLink + 1, 'Replaced proposal was approved')
    })
    await check('read-only contributor can privately review but cannot approve merging', async () => {
      await click(button('Back to repositories')); window.fixturePermission = 'READ'
      await showSelection('selection-reader')
      await until(() => button('Review privately instead'), 'Permission failure not explained')
      ensure(button('Start review, merge when safe')?.disabled, 'Read permission exposed active merge approval')
      await click(button('Review privately instead'))
      ensure(button('Start private review') && !button('Start private review').disabled, 'Private review became unavailable')
      ensure(mutationRequests().length === beforeLink + 1, 'Changing mode counted as approval')
      window.fixturePermission = 'WRITE'
    })
    await check('adding an external repository is an explicit saved choice, not a GitHub mutation', async () => {
      await click(button('Back to repositories'))
      // The side rail's Add repository is hidden on a phone, where the project list carries its own: press the one on screen.
      await click([...document.querySelectorAll('button')].filter(node => text(node)===NAMES.addRepository).find(node => node.getClientRects().length))
      const input = query('#co-repository-name')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'team/community')
      input.dispatchEvent(new Event('input',{bubbles:true}))
      await frame(); await click(button('Add'))
      await until(() => values.get('followed-repositories.json')?.includes('team/community'), 'Repository preference was not saved')
      ensure(query('.co-other-repositories') && !query('.co-other-repositories').open, 'Other repositories cluttered the default project list')
      await click(query('.co-other-repositories summary'))
      ensure([...document.querySelectorAll('.co-source-row')].some(node => node.getClientRects().length && text(node).includes('team/community')), 'Explicitly added repository was lost')
      ensure(mutationRequests().length === beforeLink + 1, 'Adding repository mutated GitHub')
    })
    await check('syncing after Settings refreshes the full app account and live feed exactly once', async () => {
      // Mount the actual app, not a refresh helper. Only external storage and
      // fetch boundaries are faked; hooks, coordinator and reconciliation run.
      root.render(null)
      await frame(); await frame()
      window.fullAppFixture = true
      window.fullAppConnected = false
      values.clear()
      let ledgerReads = 0
      const liveRecord = {...prepared, status:'open', number:7, url:'https://github.com/owner/project/pull/7'}
      window.mobius.storage.listWithStatus = async prefix => {
        ensure(prefix === 'contributions/', 'Unexpected ledger path')
        ledgerReads++
        return {complete:true,entries:[{type:'file',name:liveRecord.id+'.json',content:structuredClone(liveRecord)}]}
      }
      root.render(<ContributeApp appId="fixture-app" token="fixture-only" />)
      await until(() => values.get('feed-cache.json')?.records?.[0]?.status === 'open', 'Initial ledger did not settle')
      ensure(ledgerReads === 1, 'Initial app performed duplicate ledger scans')
      const previous = calls.requests.length
      window.fullAppConnected = true
      // One authentic parent-window message represents returning from Settings. Returning no longer re-reads on its own
      // (the app syncs when it opens and when the owner taps Sync), so the owner's one Sync is what picks the account up.
      // No retries manufacture success or conceal duplicate work.
      window.postMessage({type:'moebius:frame-visibility',visible:true}, '*')
      await frame(); await frame()
      await click(query('.co-toolbar-refresh'))
      await until(() => query('.co-settings summary')?.getAttribute('aria-label')?.includes('reconnected-owner'), 'Sync did not display the new account')
      const returning = calls.requests.slice(previous)
      ensure(returning.filter(call => call.url === '/api/github/status').length === 1, 'Returning checked the account more than once')
      const overlays = returning.filter(call => call.url === '/api/github/graphql' && call.body.query.includes('resource(url:'))
      ensure(overlays.length === 1, 'Expected one foreground live-feed query, got ' + overlays.length)
      await until(() => values.get('feed-cache.json')?.records?.[0]?.status === 'merged', 'Live state was not reconciled and cached')
      ensure(ledgerReads === 2, 'Returning did not own exactly one fresh ledger scan')
      ensure(returning.every(call => call.method === 'GET' || call.url === '/api/github/graphql'), 'Returning mutated public work')
    })
    await check('settings leads with the GitHub account then one prompt editor and a precise destination', async () => {
      await click(query('.co-settings summary'))
      await until(()=>query('.co-prompt-settings textarea'), 'Prompt editor did not settle')
      const panel=query('.co-settings-panel'), headings=[...panel.querySelectorAll('h3')]
      ensure(headings.map(h=>text(h)).join('|')==='GitHub|Default agent|Agent prompts', 'Settings section order or headings differ')
      ensure(panel.querySelectorAll('.co-prompt-settings textarea').length===1, 'Settings did not show exactly one prompt editor')
      ensure(button('Manage account',panel) && !text(panel).includes('Manage in Settings'), 'Settings destination is ambiguous')
      await click(button('Close settings',panel))
    })
    await check('a chat card sends only after Confirm, through the guarded app handler with the confirmed snapshot', async () => {
      root.render(null)
      await frame(); await frame()
      values.clear()
      const record = { ...prepared, id: 'card-record', updated_at: '2026-10-20T10:00:00Z',
        plan: { ...prepared.plan, diff_sha256: 'd'.repeat(64), diff_stat: ' 1 file changed, 3 insertions(+), 1 deletion(-)' } }
      values.set('contributions/card-record.json', structuredClone(record))
      window.mobius.storage.listWithStatus = async () => ({ complete: true, entries: [{ type: 'file', name: 'card-record.json', content: structuredClone(record) }] })
      window.fullAppConnected = true; window.fullAppBinding = true
      const submits = []
      window.fullAppSubmit = call => {
        submits.push(call.body)
        const sent = { ...record, status: 'open', number: 9, url: 'https://github.com/owner/project/pull/9', updated_at: '2026-10-20T11:00:00Z' }
        values.set('contributions/card-record.json', structuredClone(sent))
        return { record: sent, url: sent.url }
      }
      // This page is the top-level shell stand-in: capture the app's state
      // messages and deliver host events exactly as the parent document would.
      const states = []
      const realPost = window.postMessage
      window.postMessage = (message, target) => message?.type === 'moebius:app-block-state' ? states.push(structuredClone(message)) : realPost.call(window, message, target)
      const card = () => states.at(-1)?.actions?.find(action => action.key === 'chat-send:card-record')
      const fire = (name, nonce) => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
        data: { type: 'moebius:app-block-action', sessionId: 'card-1', key: 'chat-send:card-record', event: name, nonce } }))
      const before = calls.requests.length
      try {
        root.render(<ContributeApp appId="fixture-app" token="fixture-only" blockSession={{ sessionId: 'card-1', generation: 4, actions: [{ key: 'chat-send:card-record', label: 'Contribute' }], items: [{ intent: 'review:card-record' }] }} />)
        await until(() => card() && !card().disabled, 'Card state was not published')
        ensure(!calls.requests.slice(before).some(call => call.url === '/api/github/status'), 'An idle card mounted the full app')
        fire('activate', 'card-n1')
        await until(() => card()?.confirming, 'Contribute did not become Confirm: ' + JSON.stringify(card()))
        ensure(card().confirmation?.[0]?.facts?.some(fact => fact.label === 'Version' && fact.value === HEAD.slice(0, 12)), 'Confirm lacked the app-sourced identity')
        ensure(JSON.stringify(card().confirmation[0].facts.slice(0, 2).map(fact => fact.label)) === '["Project","Change"]', 'Confirm did not lead with the card facts')
        ensure(calls.requests.some(call => call.url.includes('/review-status?record_id=card-record')), 'Card did not ask for its addressed review status')
        // The hidden runtime runs only what inline Send needs and renders nothing.
        const sinceCard = calls.requests.slice(before)
        ensure(!sinceCard.some(call => call.url === '/api/github/source-status' || /ContributeRepositories|ContributeIncomingReviews/.test(call.body?.query || '') || (call.body?.query || '').includes('resource(url:')),
          'The card ran workspace-only reads: ' + JSON.stringify(sinceCard.map(call => call.url + ' ' + String(call.body?.query || '').slice(0, 40))))
        ensure(!document.querySelector('.co-root'), 'The card rendered the workspace')
        ensure(!submits.length, 'Activation sent')
        fire('confirm', 'card-n2'); fire('confirm', 'card-n3')
        await until(() => card()?.hidden && card().links?.[0]?.url === 'https://github.com/owner/project/pull/9', 'Sent card did not settle to its PR')
        ensure(submits.length === 1, 'Confirm did not send exactly once: ' + submits.length)
        ensure(submits[0].expected_record?.id === 'card-record' && submits[0].expected_record.plan.head_sha === HEAD, 'Send did not carry the confirmed snapshot')
        ensure(states.at(-1).checkpoint === null, 'A proven result kept its recovery checkpoint')
        ensure(states.length && states.every(state => state.generation === 4), 'A state report did not name its document generation')
        ensure(states.every(state => state.actions.filter(action => action.confirming).length <= 1), 'More than one action asked for confirmation')
      } finally {
        window.postMessage = realPost
        window.fullAppSubmit = null; window.fullAppBinding = false
        root.render(null)
      }
    })
    await check('A card session without its items (an older Möbius) never offers Confirm', async () => {
      root.render(null)
      await frame(); await frame()
      values.clear()
      values.set('contributions/card-record.json', structuredClone({ ...prepared, id: 'card-record', updated_at: '2026-10-20T10:00:00Z',
        plan: { ...prepared.plan, diff_sha256: 'd'.repeat(64), diff_stat: ' 1 file changed, 2 insertions(+)' } }))
      window.fullAppConnected = true; window.fullAppBinding = true
      const states = []
      const realPost = window.postMessage
      window.postMessage = (message, target) => message?.type === 'moebius:app-block-state' ? states.push(structuredClone(message)) : realPost.call(window, message, target)
      const card = () => states.at(-1)?.actions?.find(action => action.key === 'chat-send:card-record')
      const before = calls.requests.length
      try {
        root.render(<ContributeApp appId="fixture-app" token="fixture-only" blockSession={{ sessionId: 'card-old', generation: 2, actions: [{ key: 'chat-send:card-record', label: 'Contribute' }] }} />)
        await until(() => card(), 'Card state was not published')
        window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
          data: { type: 'moebius:app-block-action', sessionId: 'card-old', key: 'chat-send:card-record', event: 'activate', nonce: 'old-n1' } }))
        await new Promise(resolve => setTimeout(resolve, 300))
        ensure(card().disabled && /newer Möbius/.test(card().note) && !card().confirming, 'A card without items offered Confirm: ' + JSON.stringify(card()))
        ensure(!calls.requests.slice(before).some(call => call.url.includes('/review-status?record_id=')), 'A card without items addressed a review status')
      } finally {
        window.postMessage = realPost
        window.fullAppBinding = false
        root.render(null)
      }
    })
    await check('Try again on an incomplete ledger waits for its whole re-read, then reaches Confirm', async () => {
      root.render(null)
      await frame(); await frame()
      values.clear()
      const record = { ...prepared, id: 'ledger-record', updated_at: '2026-10-20T10:00:00Z',
        plan: { ...prepared.plan, diff_sha256: 'd'.repeat(64), diff_stat: ' 1 file changed, 3 insertions(+)' } }
      values.set('contributions/ledger-record.json', structuredClone(record))
      // The first listing is incomplete; the second (Try again's re-read) is held, then lands complete.
      let listings = 0, complete = false, releaseListing
      const held = new Promise(resolve => { releaseListing = resolve })
      window.mobius.storage.listWithStatus = async () => {
        listings++
        if (listings === 2) await held
        return { complete, entries: [{ type: 'file', name: 'ledger-record.json', content: structuredClone(record) }] }
      }
      window.fullAppConnected = true; window.fullAppBinding = true
      const states = []
      const realPost = window.postMessage
      window.postMessage = (message, target) => message?.type === 'moebius:app-block-state' ? states.push(structuredClone(message)) : realPost.call(window, message, target)
      const card = () => states.at(-1)?.actions?.find(action => action.key === 'chat-send:ledger-record')
      const fire = (name, nonce) => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
        data: { type: 'moebius:app-block-action', sessionId: 'card-ledger', key: 'chat-send:ledger-record', event: name, nonce } }))
      const before = calls.requests.length
      try {
        root.render(<ContributeApp appId="fixture-app" token="fixture-only" blockSession={{ sessionId: 'card-ledger', generation: 6, actions: [{ key: 'chat-send:ledger-record', label: 'Contribute' }], items: [{ intent: 'review:ledger-record' }] }} />)
        await until(() => card() && !card().disabled, 'Card state was not published')
        fire('activate', 'ledger-n1')
        for (let i = 0; i < 150 && !(card()?.label === 'Try again' && !card().disabled); i++) await new Promise(resolve => setTimeout(resolve, 50))
        ensure(card()?.label === 'Try again' && !card().disabled && /Could not read every contribution/.test(card().note || ''), 'An incomplete ledger did not offer Try again: ' + JSON.stringify(card()))
        ensure(listings === 1, 'Unexpected listings before Try again: ' + listings)
        complete = true
        fire('activate', 'ledger-n2')
        for (let i = 0; i < 30; i++) await frame()
        ensure(listings === 2, 'Try again did not re-read the ledger: ' + listings)
        ensure(card()?.label === 'Checking…' && card().disabled, 'An intermediate report ended the check: ' + JSON.stringify(card()))
        fire('activate', 'ledger-n3')
        for (let i = 0; i < 10; i++) await frame()
        ensure(listings === 2, 'A second Try again started another refresh while one was running')
        releaseListing()
        for (let i = 0; i < 150 && !card()?.confirming; i++) await new Promise(resolve => setTimeout(resolve, 50))
        ensure(card()?.confirming, 'The completed re-read did not reach Confirm: ' + JSON.stringify(card()))
        ensure(!calls.requests.slice(before).some(call => call.method === 'POST' && /\/(submit|submit-stack|update-stack|update-existing)$/.test(call.url)), 'Something was sent')
      } finally {
        window.postMessage = realPost
        window.fullAppBinding = false
        releaseListing()
        root.render(null)
      }
    })
    await check('a card listing every layer of a stack reaches Confirm, and sends nothing if binding is lost before the write', async () => {
      root.render(null)
      await frame(); await frame()
      values.clear()
      const layer = (id, position, parent) => ({ ...prepared, id, updated_at: '2026-10-20T10:00:00Z',
        plan: { ...prepared.plan, title: 'Layer ' + id, branch: 'stack/s1/0' + position, head_sha: position === 1 ? HEAD : BASE, diff_sha256: 'd'.repeat(64),
          diff_stat: '2 files changed, 5 insertions(+), 1 deletion(-)', ...(parent ? { base_sha: HEAD } : {}),
          stack: { id: 's1', name: 'Stack', position, total: 2, base_branch: parent ? 'stack/s1/01' : 'main', ...(parent ? { parent_record_id: parent } : {}) } },
        quality_review: { state: 'all_clear', reviewed_head_sha: position === 1 ? HEAD : BASE } })
      const records = [layer('stack-base', 1, ''), layer('stack-top', 2, 'stack-base')]
      for (const record of records) values.set('contributions/' + record.id + '.json', structuredClone(record))
      window.mobius.storage.listWithStatus = async () => ({ complete: true, entries: records.map(record => ({ type: 'file', name: record.id + '.json', content: structuredClone(record) })) })
      window.fullAppConnected = true; window.fullAppBinding = true
      const states = []
      const realPost = window.postMessage
      window.postMessage = (message, target) => message?.type === 'moebius:app-block-state' ? states.push(structuredClone(message)) : realPost.call(window, message, target)
      const stackKey = 'chat-send-batch:' + batchHandle(['stack-base', 'stack-top'])
      const card = () => states.at(-1)?.actions?.find(action => action.key === stackKey)
      const fire = (name, nonce) => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin,
        data: { type: 'moebius:app-block-action', sessionId: 'card-2', key: stackKey, event: name, nonce } }))
      const before = calls.requests.length
      try {
        root.render(<ContributeApp appId="fixture-app" token="fixture-only" blockSession={{ sessionId: 'card-2', generation: 5, actions: [{ key: stackKey, label: 'Contribute all' }], items: [{ intent: 'review:stack-base' }, { intent: 'review:stack-top' }] }} />)
        await until(() => card() && !card().disabled, 'Stack card state was not published')
        fire('activate', 'stack-n1')
        // Wait on timers rather than animation frames: the hidden runtime mounts behind the card.
        for (let i = 0; i < 150 && !card()?.confirming; i++) await new Promise(resolve => setTimeout(resolve, 100))
        await until(() => card()?.confirming, 'A whole-stack card never reached Confirm: ' + JSON.stringify(card()) + ' requests: ' + JSON.stringify(calls.requests.slice(before).map(call => call.method + ' ' + call.url)))
        const statusQueries = calls.requests.slice(before).filter(call => call.url.includes('/review-status')).map(call => call.url)
        ensure(statusQueries.some(url => url.includes('record_id=stack-base') && url.includes('record_id=stack-top')), 'The review check was not addressed to every prepared layer: ' + JSON.stringify(statusQueries))
        ensure(card().confirmation.length === 2 && card().confirmation.every(item => item.facts.some(fact => fact.label === 'Change' && fact.value === '2 files · +5 −1')), 'Confirm lacked the stack phase or its size')
        // The platform stops advertising the binding before the write.
        window.fullAppBinding = false
        fire('confirm', 'stack-n2')
        await until(() => /no longer confirms the exact version/.test(card()?.note || '') || states.some(state => (state.actions || []).some(action => /no longer confirms the exact version/.test(action.note || ''))), 'A lost binding did not refuse: ' + JSON.stringify(card()))
        ensure(!calls.requests.slice(before).some(call => call.method === 'POST' && /\/(submit|submit-stack|update-stack|update-existing)$/.test(call.url)), 'An unbound send was made')
      } finally {
        window.postMessage = realPost
        window.fullAppBinding = false
        root.render(null)
      }
    })
    await check('a prepared description shows its staged screenshots within the card width', async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900
      const wide = canvas.toDataURL('image/png'), loads = []
      const loader = (recordId, shot) => { loads.push(shot.name); return Promise.resolve(shot.name === 'before.png' ? wide : null) }
      const shot = name => ({ name, sha256: 'e'.repeat(64), size: 1200, alt: name })
      const rec = { ...prepared, id: 'fixture-shots', plan: { ...prepared.plan, screenshots: [shot('before.png'), shot('after.png')],
        body_draft: 'Wraps the title.\n\n| Before | After |\n| --- | --- |\n| ![Before, desktop](screenshot:before.png) | ![After, desktop](screenshot:after.png) |\n\n![Before, full width](screenshot:before.png)' } }
      const mount = key => root.render(<div className="co-root"><style>{CSS}</style><main className="co-page"><ScreenshotLoaderContext.Provider value={loader}>
        <div className="co-review"><ReviewPlan key={key} rec={rec} /></div></ScreenshotLoaderContext.Provider></main></div>)
      try {
        mount('first')
        await until(() => document.querySelectorAll('.co-markdown img.co-markdown-shot').length === 2 && loads.length === 2, 'The resolved screenshot did not render')
        const markdown = query('.co-markdown'), images = [...document.querySelectorAll('.co-markdown img.co-markdown-shot')]
        await until(() => images.every(image => image.complete && image.naturalWidth === 1600), 'The screenshot did not decode')
        ensure(images.every(image => image.getAttribute('src').startsWith('data:image/png;base64,') && image.alt.startsWith('Before')), 'A screenshot was not a data image')
        ensure(![...markdown.querySelectorAll('[src],[href]')].some(node => /^screenshot:/i.test(node.getAttribute('src') || node.getAttribute('href') || '')), 'A screenshot: URL reached the DOM')
        ensure(text(query('.co-markdown-shot-pending')) === 'Screenshot: After, desktop', 'An unreadable screenshot was not a neutral placeholder')
        ensure(text(query('.co-shot-note')).startsWith('2 screenshots will be uploaded to your GitHub account'), 'The upload note is missing')
        const box = markdown.getBoundingClientRect()
        ensure(markdown.scrollWidth <= markdown.clientWidth + 1 && images.every(image => image.getBoundingClientRect().right <= box.right + 1 && image.getBoundingClientRect().width > 40),
          'Screenshots overflow or collapse in the card: ' + images.map(image => image.getBoundingClientRect().width).join(',') + ' in ' + box.width)
        root.render(null); await frame()
        mount('reopened')
        await until(() => loads.length === 3 && document.querySelectorAll('.co-markdown img.co-markdown-shot').length === 2, 'Reopening did not show the cached screenshot')
        ensure(loads.filter(name => name === 'before.png').length === 1, 'A cached screenshot was fetched again: ' + loads.join(','))
      } finally {
        root.render(null)
      }
    })
    await check('a restaged screenshot never shows or caches under the digest its plan approved', async () => {
      // The real reader and cache against a name-keyed route whose bytes a
      // restage replaces: server A→B→A while plan A, then plan B, is on screen.
      const png = color => { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 4, 4)
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png')).then(blob => blob.arrayBuffer()) }
      const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
      const dataUrl = bytes => 'data:image/png;base64,' + btoa(String.fromCharCode(...new Uint8Array(bytes)))
      const A = await png('#c00'), B = await png('#00c'), shotA = { name: 'before.png', sha256: await hex(A) }, shotB = { name: 'before.png', sha256: await hex(B) }
      ensure(shotA.sha256 !== shotB.sha256, 'The fixture images are identical')
      const route = '/api/github/contributions/fixture-app/fixture-restaged/screenshots/before.png', original = window.fetch, loads = [], settled = []
      let served = B
      window.fetch = (url, options) => String(url) === route ? Promise.resolve(new Response(served.slice(0), { headers: { 'Content-Type': 'image/png' } })) : original(url, options)
      const loader = (recordId, shot) => { loads.push(shot.sha256); return fetchContributionScreenshot('tok', 'fixture-app', recordId, shot).then(url => { settled.push(url); return url }) }
      const rec = shot => ({ ...prepared, id: 'fixture-restaged', plan: { ...prepared.plan, screenshots: [shot], body_draft: 'Restaged.\n\n![Before](screenshot:before.png)' } })
      const mount = (key, shot) => root.render(<div className="co-root"><style>{CSS}</style><main className="co-page"><ScreenshotLoaderContext.Provider value={loader}>
        <div className="co-review"><ReviewPlan key={key} rec={rec(shot)} /></div></ScreenshotLoaderContext.Provider></main></div>)
      const shown = () => query('.co-markdown img.co-markdown-shot')?.getAttribute('src') || null
      try {
        mount('a-while-b-served', shotA)
        await until(() => settled.length === 1, 'Plan A did not read its screenshot')
        await frame(); await frame()
        ensure(shown() === null && text(query('.co-markdown-shot-pending')) === 'Screenshot: Before', 'Restaged bytes rendered under plan A')
        mount('b', shotB)
        await until(() => shown() === dataUrl(B), 'The restaged plan did not show its own bytes')
        served = A
        root.render(null); await frame()
        mount('a-reopened', shotA)
        await until(() => shown() === dataUrl(A), 'Reopened plan A did not show A: ' + String(shown()).slice(0, 60))
        ensure(loads.filter(sha => sha === shotA.sha256).length === 2, 'The mismatched read was cached under A: ' + loads.length)
        root.render(null); await frame()
        mount('a-cached', shotA)
        await until(() => shown() === dataUrl(A), 'Plan A lost its verified image')
        ensure(loads.length === 3, 'A verified screenshot was fetched again: ' + loads.length)
      } finally {
        window.fetch = original
        root.render(null)
      }
    })
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, calls: { reads: calls.requests.length - mutationRequests().length,
      reviewRequests: reviewRuns.length, assignments: mutationRequests().filter(call => call.url.endsWith('/assign-review')).length,
      preparations: calls.starts.length, publications: calls.publications.length }, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  }
}

// The whole app on a fresh page: a review the owner starts from a PR's own page
// must show on that PR's Desk row without pressing Sync with GitHub.
async function mountDeskApp({ pullPatch = {} } = {}) {
  root.render(null)
  await frame(); await frame()
  window.fullAppFixture = true; window.fullAppConnected = true; window.fullAppDesk = true
  values.set('followed-repositories.json', ['owner/project'])
  // Only the saved Respond answers and decisions are ever listed; every other folder is empty.
  // A test may hold the reads of the saved answers (window.holdResponsesRead) and let them go with window.releaseResponsesRead().
  window.responseGates = []
  window.releaseResponsesRead = () => { window.holdResponsesRead = false; window.responseGates.splice(0).forEach(resolve => resolve()) }
  window.mobius.storage.listWithStatus = async prefix => (window.holdResponsesRead && prefix.startsWith('respond-') ? await new Promise(resolve => window.responseGates.push(resolve)) : null, { complete: true, entries: !prefix.startsWith('respond-') ? [] : [...values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ type: 'file', name: key.slice(prefix.length), path: key, content: structuredClone(value) })) })
  // A PR GitHub read completely: without these facts its standing is "couldn't read" and nothing frames it.
  Object.assign(pulls[0], { mergeable: 'MERGEABLE', reviewDecision: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    latestOpinionatedReviews: { nodes: [] }, reviewThreads: { nodes: [] }, ...pullPatch })
  root.render(<ContributeApp appId="fixture-app" token="fixture-only" />)
}
// A popup menu must stay on the screen whichever button opens it: on a phone a row's Actions button sits well
// in from the left edge, and a menu lined up with its right edge ran off the screen.
window.runPopupFitChecks = async () => {
  const checks = []
  async function staysOnScreen(name, scope) {
    const trigger = scope.querySelector('.co-agent-menu-button')
    // A page sliding in is a transformed ancestor, and a fixed sheet would hang from it instead of the screen. This harness
    // never advances that 0.16 s entrance, so the menus are measured with it switched off.
    const still = document.createElement('style')
    still.textContent = '.co-workspace,.co-pull-page,.co-desk-envelopes,.co-directory,.co-stage-empty { animation: none !important; }'
    document.head.append(still)
    await click(trigger)
    await until(() => scope.querySelector('.co-agent-menu-list'), 'The ' + name + ' Actions menu did not open')
    const box = scope.querySelector('.co-agent-menu-list').getBoundingClientRect()
    ensure(box.left >= 0 && box.right <= window.innerWidth, 'The ' + name + ' Actions menu ran off the screen: ' + Math.round(box.left) + ' to ' + Math.round(box.right) + ' of ' + window.innerWidth + 'px')
    if (window.innerWidth <= 680) {
      // On a phone the menu is a sheet on the bottom edge. Its scrim covers the trigger, so the scrim (or Cancel) closes it.
      ensure(box.left === 0 && Math.round(box.right) === window.innerWidth && Math.abs(box.bottom - window.innerHeight) < 2, 'The ' + name + ' Actions menu is not a sheet on the bottom edge: ' + Math.round(box.left) + ' to ' + Math.round(box.right) + ', bottom ' + Math.round(box.bottom) + ' of ' + window.innerHeight)
      const cancel = scope.querySelector('.co-agent-menu-cancel')
      ensure(cancel && cancel.offsetParent && text(cancel) === 'Cancel', 'The ' + name + ' Actions sheet shows no Cancel on a phone')
      await click(scope.querySelector('.co-agent-menu-scrim'))
      await until(() => !scope.querySelector('.co-agent-menu-list'), 'Pressing outside did not close the ' + name + ' Actions sheet')
      await click(trigger)
      await until(() => scope.querySelector('.co-agent-menu-cancel'), 'The ' + name + ' Actions sheet did not open again')
      await click(scope.querySelector('.co-agent-menu-cancel'))
    } else {
      ensure(!scope.querySelector('.co-agent-menu-cancel').offsetParent, 'The ' + name + ' Actions popup shows a Cancel on a desktop')
      await click(trigger)
    }
    await until(() => !scope.querySelector('.co-agent-menu-list'), 'The ' + name + ' Actions menu did not close')
    still.remove()
    checks.push({ name: 'the ' + name + ' Actions menu stays on the screen', status: 'pass' })
  }
  try {
    await until(() => query('.co-source-row'), 'Project list did not render')
    await click(query('.co-source-row'))
    await until(() => document.querySelectorAll('.co-pr-row').length === 2, 'Project did not settle')
    await staysOnScreen('row', query('.co-pr-row'))
    await click(query('input[aria-label="Select owner/project #7"]'))
    await until(() => query('.co-pr-box-head .co-agent-menu-button'), 'Selecting a PR did not offer the bulk Actions menu')
    await staysOnScreen('bulk', query('.co-pr-box-head'))
    return { status: 'pass', checks }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 2000) }
  }
}
window.runDeskFrameChecks = async () => {
  const checks = []
  const deskFrame = title => [...document.querySelectorAll('.co-frame')].find(node => text(node).includes(title))?.dataset.frame
  try {
    await mountDeskApp()
    await until(() => deskFrame('Contribution 7'), 'The Desk did not list the review request')
    ensure(deskFrame('Contribution 7') === 'idle', 'The row wore a frame before any review ran')
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('[aria-label="Choose an action for PR 7"]'), 'The PR page did not open')
    await click(query('[aria-label="Choose an action for PR 7"]'))
    // Opening the menu never lands the keyboard on a destructive choice, and Close pull request sits last and apart.
    const menuItems = [...document.querySelectorAll('[role=menuitem]')], closeItem = menuItems.find(node => text(node.querySelector('strong')) === 'Close pull request')
    ensure(document.activeElement?.getAttribute('role') === 'menuitem' && !document.activeElement.hasAttribute('data-danger'), 'The Actions menu put its first focus on: ' + text(document.activeElement))
    ensure(!closeItem || (menuItems.at(-1) === closeItem && closeItem.closest('.co-agent-menu-apart')), 'Close pull request is not last and apart')
    checks.push({ name: 'the Actions menu never starts its focus on a destructive choice', status: 'pass' })
    await click([...document.querySelectorAll('[role=menuitem]')].find(node => text(node.querySelector('strong')) === 'Review'))
    await until(() => review(), 'Review window did not open')
    // The lock (green) or globe (amber) takes its colour from --seen: a quiet button's own colour must not win over it.
    const seen = review().querySelector('.co-rw-seen'), seenButton = seen?.querySelector('.co-rw-seen-btn')
    ensure(seenButton, 'The review window has no lock or globe')
    seenButton.style.transition = 'none'
    seen.style.setProperty('--seen', 'rgb(1, 2, 3)')
    ensure(getComputedStyle(seenButton).color === 'rgb(1, 2, 3)', 'The lock or globe lost its colour: ' + getComputedStyle(seenButton).color)
    seen.style.removeProperty('--seen')
    checks.push({ name: 'the review window lock or globe keeps its green or amber', status: 'pass' })
    const start = () => [...review().querySelectorAll('button')].find(node => text(node).startsWith('Start'))
    await until(() => start() && !start().disabled, 'The review window never offered Start')
    await click(start())
    await until(() => reviewRuns.length === 1, 'The review did not start')
    // The PR page itself knows the run, so the missing frame below is the Desk's, not the fixture's.
    await until(() => query('.co-frame[data-frame="reviewing"]'), 'The PR page did not frame the review it started')
    // The Desk is told at once, before the owner leaves the page: here only onRunsChanged reads the run list again.
    const started = calls.requests.findIndex(call => call.method === 'POST' && call.url.endsWith('/review-runs'))
    await until(() => calls.requests.slice(started + 1).some(call => call.method === 'GET' && call.url.endsWith('/review-runs')), 'Starting the review did not make the Desk re-read its review runs')
    await click(query('.co-desk-back'))
    await until(() => query('.co-desk-envelopes'), 'Back did not return to the Desk')
    await until(() => deskFrame('Contribution 7') === 'reviewing', 'The Desk row has no review frame after Back: ' + deskFrame('Contribution 7'))
    checks.push({ name: 'a review started on a PR page leaves its Desk row framed once the owner is back', status: 'pass' })
    // A review stopped elsewhere (a chat, another device) shows when the frame is shown again.
    reviewRuns[0].execution_state = 'stopped'
    shownAgain()
    await until(() => deskFrame('Contribution 7') === 'idle', 'The Desk kept the frame of a stopped review after the frame was shown again')
    checks.push({ name: 'a review stopped elsewhere loses its Desk frame when the frame is shown again', status: 'pass' })
    // Leaving a PR page re-reads too. The Desk's 15 s poll cannot be what shows it: this scenario ends well inside the 5 s wait of each step.
    delete reviewRuns[0].execution_state
    shownAgain()
    await until(() => deskFrame('Contribution 7') === 'reviewing', 'The Desk did not frame the review again when the frame was shown again')
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('.co-desk-back') && query('[aria-label="Choose an action for PR 7"]'), 'The PR page did not open again')
    reviewRuns[0].execution_state = 'stopped'
    await click(query('.co-desk-back'))
    await until(() => deskFrame('Contribution 7') === 'idle', 'The Desk kept the frame of a review stopped while its PR page was open')
    checks.push({ name: 'leaving a PR page makes the Desk re-read the review runs', status: 'pass' })
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  }
}

// The whole app on a fresh page: a review hands its PR to a reviewer helper and ends its own
// turn ("completed") while the review still says "reviewing". That is a review at work, not one
// that stopped: the Desk row and the PR page show the moving frame. Only a review the platform
// reports "interrupted" (nothing will wake it any more) asks the owner to run it again.
window.runReviewHelperWaitChecks = async () => {
  const checks = []
  const deskFrame = title => [...document.querySelectorAll('.co-frame')].find(node => text(node).includes(title))?.dataset.frame
  const helperRun = execution => reviewingRun(execution)
  const openPull = async () => {
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('.co-desk-back') && query('.co-next-hint'), 'The PR page did not open')
  }
  try {
    reviewRuns.length = 0
    reviewRuns.push(helperRun('completed'))
    await mountDeskApp()
    await until(() => deskFrame('Contribution 7'), 'The Desk did not list the review request')
    ensure(deskFrame('Contribution 7') === 'reviewing', 'The Desk row of a review waiting on its helper did not wear the moving frame: ' + deskFrame('Contribution 7'))
    await openPull()
    ensure(query('.co-frame[data-frame="reviewing"]') && !query('.co-tab-dot.is-waiting'), 'The PR page did not frame a review waiting on its helper as at work')
    ensure(text(query('.co-next-hint')) === 'An agent is working on it', 'The PR page said: ' + text(query('.co-next-hint')))
    checks.push({ name: 'a review whose own turn ended while its helper works is shown as at work', status: 'pass' })
    // The platform reports "interrupted" once nothing can wake the review: now it is the owner's move.
    await click(query('.co-desk-back'))
    await until(() => query('.co-desk-envelopes'), 'Back did not return to the Desk')
    reviewRuns[0].execution_state = 'interrupted'
    shownAgain()
    await until(() => deskFrame('Contribution 7') === 'verdict', 'The Desk row of an interrupted review did not hold the amber frame: ' + deskFrame('Contribution 7'))
    await openPull()
    ensure(text(query('.co-next-hint')) === 'The agent stopped before it finished. Run it again', 'The PR page said: ' + text(query('.co-next-hint')))
    checks.push({ name: 'a review the platform reports interrupted is shown as stopped', status: 'pass' })
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  }
}

// A Respond-to-feedback conversation is no review run: the platform lists it beside the runs. When it asks you
// something the PR page must not offer a button for it (the Review tab is the one place to answer), must say where,
// and the Review tab must offer the conversation instead of "No review yet".
window.runRespondAnswerChecks = async () => {
  const checks = []
  const deskFrame = title => [...document.querySelectorAll('.co-frame')].find(node => text(node).includes(title))?.dataset.frame
  const button = label => [...document.querySelectorAll('button')].find(node => text(node) === label)
  const reviewBody = () => text(query('.co-pr-detail-body'))
  try {
    reviewRuns.length = 0
    respondChats.length = 0
    respondChats.push({ repo: 'owner/project', number: 7, state: 'needs_answer', chat_id: 'respond-chat-fixture' })
    await mountDeskApp()
    await until(() => deskFrame('Contribution 7') === 'verdict', 'The Desk row of a Respond chat that asks you did not hold the amber frame: ' + deskFrame('Contribution 7'))
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('.co-desk-back') && query('.co-next-hint'), 'The PR page did not open')
    ensure(text(query('.co-next-hint')).startsWith('The agent has a question for you'), 'The panel said: ' + text(query('.co-next-hint')))
    ensure(text(query('.co-next-pointer')) === 'Answer it in the Review tab.', 'The panel did not say where to answer: ' + text(query('.co-next-pointer')))
    ensure(!button('Answer the agent') && !query('.co-decision-bar'), 'A button for the question is still offered')
    checks.push({ name: 'a question has no button on the PR page, only a pointer to the Review tab', status: 'pass' })
    // The Desk opens a PR whose frame is not idle on its Review tab.
    await until(() => button('Answer in chat'), 'The Review tab did not offer Answer in chat: ' + reviewBody())
    ensure(reviewBody().includes('Waiting for your answer') && !reviewBody().includes('No review yet'), 'The Review tab said: ' + reviewBody())
    ensure(query('.co-gh-chat-link'), 'The PR header has no link to the Respond conversation')
    const sent = []
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage(message, target) { sent.push([message, target]) } } })
    await click(button('Answer in chat'))
    ensure(sent.length === 1 && sent[0][0].type === 'moebius:open-chat' && sent[0][0].chatId === 'respond-chat-fixture' && sent[0][1] === '*', 'Answer in chat sent: ' + JSON.stringify(sent))
    checks.push({ name: 'the Review tab answers a Respond chat that asks you through its own conversation', status: 'pass' })
    // The same chat at work: nothing to answer, but the tab still says an agent is on it.
    respondChats[0].state = 'running'
    shownAgain()
    await until(() => text(query('.co-next-hint')) === 'An agent is working on it', 'The panel did not follow the chat to working: ' + text(query('.co-next-hint')))
    await until(() => reviewBody().includes('Working on feedback'), 'The Review tab did not follow the chat to working: ' + reviewBody())
    ensure(!reviewBody().includes('No review yet') && !query('.co-next-pointer'), 'A working chat still showed the question state: ' + reviewBody())
    checks.push({ name: 'a Respond chat at work is shown as working, with its conversation one button away', status: 'pass' })
    ensure(document.documentElement.scrollWidth <= window.innerWidth, 'The page scrolls sideways: ' + document.documentElement.scrollWidth + ' of ' + window.innerWidth)
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  }
}

// A Respond-to-feedback answer the helper saved: the PR reads "Draft to send", the Review tab shows the replies, and Post, Discard,
// an out-of-date answer and a busy chat each do what the card says. Nothing is posted by the app: it writes the owner's decision and
// tells the chat to run the helper.
const OWN_PULL_WITH_FEEDBACK = { author: { login: 'reconnected-owner' }, reviewDecision: 'CHANGES_REQUESTED',
  latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'teammate', __typename: 'User' }, commit: { oid: HEAD } }] } }
const savedResponse = (patch = {}) => ({ version: 1, id: 'r-3f9a1c2b04d5', repo: 'owner/project', number: 7, chat_id: 'respond-chat-fixture', created_at: '2026-11-06T08:41:00Z', state: 'ready',
  pr: { head_sha: HEAD, head_ref: 'fix/fixture', base_ref: 'main', head_repo: 'owner/project' }, tip_sha: HEAD,
  points: [{ reviewer: 'teammate', title: 'A lost answer is unresolved', ending: 'fixed', commit: null, answer: 'Fixed.' }, { reviewer: 'teammate', title: 'Rename the helper', ending: 'not_valid', commit: null, answer: 'It matches its siblings.' }],
  replies: [{ body: 'Both points are answered.', reply_to: null }], description: null, rerequest: ['teammate'], tests: '10 pass, 0 fail',
  commits: [], files: [], bundle: null, digest: 'd'.repeat(64), receipts: { push: null, replies: [], description: null, rerequest: null }, error: null, ...patch })
const RESPONSE_KEY = 'respond-results/owner__project__7.json', DECISION_KEY = 'respond-decisions/owner__project__7.json'
window.runRespondResultChecks = async () => {
  const checks = []
  const deskFrame = title => [...document.querySelectorAll('.co-frame')].find(node => text(node).includes(title))?.dataset.frame
  const button = label => [...document.querySelectorAll('button')].find(node => text(node) === label)
  const reviewBody = () => text(query('.co-pr-detail-body'))
  const hint = () => text(query('.co-next-hint'))
  const settle = async () => { for (let turn = 0; turn < 6; turn++) await frame() }
  const answer = async (patch, decision) => {
    values.set(RESPONSE_KEY, savedResponse(patch))
    decision ? values.set(DECISION_KEY, decision) : values.delete(DECISION_KEY)
    shownAgain()
  }
  try {
    reviewRuns.length = 0
    respondChats.length = 0
    values.set(RESPONSE_KEY, savedResponse())
    await mountDeskApp({ pullPatch: OWN_PULL_WITH_FEEDBACK })
    await until(() => deskFrame('Contribution 7') === 'verdict', 'The Desk row of a PR with a saved answer did not hold the amber frame: ' + deskFrame('Contribution 7'))
    ensure([...document.querySelectorAll('.co-desk-row')].some(node => text(node).includes('Contribution 7') && text(node).includes('Draft to send')), 'The Desk row did not say Draft to send')
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('.co-desk-back') && query('.co-next-hint'), 'The PR page did not open')
    ensure(hint().startsWith('A draft is ready. Read it, then send it or throw it away'), 'The panel said: ' + hint())
    await until(() => reviewBody().includes('Replies ready'), 'The Review tab did not show the saved answer: ' + reviewBody())
    ensure(reviewBody().includes('Both points are answered.') && reviewBody().includes('A lost answer is unresolved') && reviewBody().includes('Ask teammate to review again'), 'The card is missing its content: ' + reviewBody())
    ensure(!reviewBody().includes('No review yet'), 'The tab still said No review yet')
    ensure(button(NAMES.postAnswer) && !button(NAMES.postAnswer).disabled, 'Post is not offered')
    checks.push({ name: 'a saved answer is a draft to send: the row, the panel and the Review tab all say so', status: 'pass' })
    // Post: the owner's approval is written for exactly this answer, and the chat is told to run the helper. The reads that follow are
    // held for a moment: until the refreshed answer is on screen the card stays busy, so Post cannot be pressed twice in that gap.
    window.holdResponsesRead = true
    await click(button(NAMES.postAnswer))
    await until(() => values.get(DECISION_KEY)?.decision === 'approved', 'Post wrote no approval')
    ensure(values.get(DECISION_KEY).result_id === 'r-3f9a1c2b04d5' && values.get(DECISION_KEY).digest === 'd'.repeat(64), 'The approval named another answer: ' + JSON.stringify(values.get(DECISION_KEY)))
    await until(() => calls.messages.length === 1, 'Post sent the chat nothing')
    const sent = calls.messages[0]
    ensure(sent.chatId === 'respond-chat-fixture' && sent.cid === 'respond-post-r-3f9a1c2b04d5', 'The message went to ' + sent.chatId + ' as ' + sent.cid)
    ensure(sent.content.includes('python3 /data/apps/contribute/respond_result.py post --pr owner/project#7 --id r-3f9a1c2b04d5'), 'The message did not name the command: ' + sent.content)
    await settle()
    ensure(button(NAMES.postAnswer)?.disabled || !button(NAMES.postAnswer), 'Post could be pressed again before the refreshed answer arrived: ' + reviewBody())
    window.releaseResponsesRead()
    await until(() => reviewBody().includes('Sent to the chat'), 'The card did not follow the approval: ' + reviewBody())
    ensure(hint() === 'Sending to GitHub…', 'The panel said: ' + hint())
    ensure(!button(NAMES.sendAgain) && button(NAMES.openChat), 'Send again was offered while the chat is starting: ' + reviewBody())
    ensure(reviewBody().includes('The chat is starting') && query('.co-pr-detail-body .co-arc'), 'The card showed no spinner: ' + reviewBody())
    checks.push({ name: 'Post writes the approval for this answer, tells the chat to run the helper, and the card says it is starting, with no Send again', status: 'pass' })
    // Thirty seconds on with nothing started, the way out comes back, in words that say why.
    values.set(DECISION_KEY, { ...values.get(DECISION_KEY), at: new Date(Date.now() - 40000).toISOString() })
    shownAgain()
    await until(() => reviewBody().includes('Not started yet') && button(NAMES.sendAgain), 'The card never offered Send again: ' + reviewBody())
    ensure(reviewBody().includes('The chat has not started yet. Send it again, or open the chat.'), 'The stalled card said: ' + reviewBody())
    checks.push({ name: 'after 30 s with nothing started, Send again is offered', status: 'pass' })
    // The helper at work and done.
    await answer({ state: 'posting' }, values.get(DECISION_KEY))
    await until(() => reviewBody().includes('Posting'), 'The card did not show posting: ' + reviewBody())
    const pullReads = () => calls.requests.filter(call => call.url === '/api/github/graphql' && call.body?.query.includes('ContributePullRequests')).length
    const readsBefore = pullReads()
    await answer({ state: 'posted', receipts: { push: null, replies: [{ index: 0, url: 'https://example.test/c/1', at: '2026-11-06T09:40:00Z' }], description: null, rerequest: { at: '2026-11-06T09:40:05Z', reviewers: ['teammate'] } } }, values.get(DECISION_KEY))
    await until(() => reviewBody().includes('Posted') && query('.co-pr-detail-body a[href="https://example.test/c/1"]'), 'The card did not show what was posted: ' + reviewBody())
    await until(() => pullReads() > readsBefore, 'The PR was not read again once the answer was posted')
    checks.push({ name: 'posting and posted follow what the helper saved, and the PR is read again once it is posted', status: 'pass' })
    // Discard.
    await answer({}, null)
    await until(() => button(NAMES.discard), 'The answer did not come back to be discarded: ' + reviewBody())
    await click(button(NAMES.discard))
    await until(() => values.get(DECISION_KEY)?.decision === 'discarded', 'Discard wrote no decision')
    await until(() => !reviewBody().includes('Replies ready') && hint().startsWith('Your PR · feedback is waiting'), 'The PR did not go back to Feedback to answer: ' + hint())
    checks.push({ name: 'Discard takes the answer off the PR, which reads Feedback to answer again', status: 'pass' })
    // The PR moved after the answer: nothing to post, a second pass instead.
    await answer({ pr: { head_sha: 'e'.repeat(40), head_ref: 'fix/fixture', base_ref: 'main', head_repo: 'owner/project' } }, null)
    await until(() => reviewBody().includes('Out of date'), 'The card did not say it is out of date: ' + reviewBody())
    ensure(!button(NAMES.postAnswer) && button(NAMES.respondAgain), 'An out-of-date answer offered the wrong buttons')
    // A chat that waits on a card of its own cannot take the message, so Post says why instead of failing.
    respondChats.push({ repo: 'owner/project', number: 7, state: 'needs_answer', chat_id: 'respond-chat-fixture' })
    await answer({}, null)
    await until(() => button(NAMES.postAnswer) && button(NAMES.postAnswer).disabled && reviewBody().includes('waiting for your answer to its own card'), 'Post was not held back for the chat’s own card: ' + reviewBody())
    checks.push({ name: 'an out-of-date answer and a chat with a card of its own each hold Post back, in words', status: 'pass' })
    ensure(document.documentElement.scrollWidth <= window.innerWidth, 'The page scrolls sideways: ' + document.documentElement.scrollWidth + ' of ' + window.innerWidth)
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  }
}

// A picture of this moment when a capture run asks for one (window.workspaceShot is a CDP binding); otherwise nothing.
// It waits up to 1.5 s for finite animations (a window fading in) to end first; a spinner never ends, so it is not waited for.
async function captureShot(name) {
  if (!window.workspaceShot) return
  const settled = Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
  await Promise.race([settled, new Promise(resolve => setTimeout(resolve, 1500))])
  await new Promise(resolve => { window.finishShot = resolve; window.workspaceShot(name) })
}

// Respond again is delivered into the PR's conversation as a message: the platform hands back the conversation it already has for the
// PR's scope without sending the job, so a plain start would only reopen it.
window.runRespondAgainChecks = async () => {
  const checks = []
  const button = label => [...document.querySelectorAll('button')].find(node => text(node) === label)
  const reviewBody = () => text(query('.co-pr-detail-body'))
  try {
    reviewRuns.length = 0
    respondChats.length = 0
    values.set(RESPONSE_KEY, savedResponse())
    await mountDeskApp({ pullPatch: OWN_PULL_WITH_FEEDBACK })
    await until(() => [...document.querySelectorAll('.co-desk-row')].some(node => text(node).includes('Contribution 7')), 'The Desk did not list the PR')
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('[aria-label="Choose an action for PR 7"]') && reviewBody().includes('Replies ready'), 'The PR page did not open on its answer')
    await click(query('[aria-label="Choose an action for PR 7"]'))
    const item = [...document.querySelectorAll('[role=menuitem]')].find(node => text(node.querySelector('strong')) === NAMES.respondAgain)
    ensure(item, 'The Actions menu did not offer Respond again: ' + [...document.querySelectorAll('[role=menuitem]')].map(node => text(node.querySelector('strong'))).join(', '))
    await click(item)
    await until(() => query('.co-review-window'), 'The Respond window did not open')
    const window_ = text(query('.co-review-window'))
    ensure(window_.includes('This replaces the answer that is waiting') && window_.includes('It does not review the PR again') && !window_.includes('How far should it go'), 'The window said: ' + window_)
    await until(() => text(query('.co-review-window [aria-label="Agent"]')).includes('Fixture model'), 'The window did not name the conversation’s agent: ' + text(query('.co-review-window')))
    const agentLine = text(query('.co-review-window [aria-label="Agent"]'))
    ensure(agentLine.includes('Extra high') && agentLine.includes('Same agent as the first answer') && !query('.co-review-window .co-model-list'), 'The agent line said: ' + agentLine)
    ensure(calls.requests.some(call => call.url === '/api/app-chats?scope=' + encodeURIComponent('contribute-address:owner/project#7')), 'The agent was not read from the PR’s own conversation')
    checks.push({ name: 'Respond again names the agent the PR’s conversation keeps, with its effort, and offers no picker', status: 'pass' })
    await captureShot('respond-again-window')
    const runsReads = () => calls.requests.filter(call => call.method === 'GET' && call.url === '/api/github/contributions/fixture-app/review-runs').length
    const readsBefore = runsReads()
    await until(() => button(NAMES.respondAgain) && !button(NAMES.respondAgain).disabled, 'Respond again is not ready: ' + window_)
    await click(button(NAMES.respondAgain))
    await until(() => calls.messages.length === 1, 'Respond again sent the conversation nothing')
    const sent = calls.messages[0]
    ensure(sent.chatId === 'respond-chat-fixture' && /^respond-/.test(sent.cid), 'The message went to ' + sent.chatId + ' as ' + sent.cid)
    ensure(sent.content.includes('respond_result.py save --pr owner/project#7') && !/approval card/.test(sent.content), 'The brief was: ' + sent.content.slice(0, 400))
    ensure(calls.appChatStarts.length === 1 && calls.appChatStarts[0].scope === 'contribute-address:owner/project#7', 'The start used another scope: ' + JSON.stringify(calls.appChatStarts))
    ensure(!calls.requests.some(call => call.method === 'PATCH' && call.url.startsWith('/api/app-chats/')), 'A second pass changed the conversation’s agent')
    await until(() => text(query('.co-review-window')).includes('The agent is on it'), 'The window did not confirm: ' + text(query('.co-review-window')))
    checks.push({ name: 'Respond again goes into the PR’s own conversation as one message, with the new brief', status: 'pass' })
    // The platform does not list the conversation yet (respondChats stays empty): the PR shows it at work anyway, and reads again at once.
    await until(() => runsReads() > readsBefore, 'The runs were not read again after the start')
    await click(button('Close'))
    await until(() => reviewBody().includes('Working on feedback'), 'The Review tab did not show the agent at work: ' + reviewBody())
    ensure(button(NAMES.postAnswer)?.disabled && reviewBody().includes('The agent is working on this PR right now'), 'The old answer could still be posted: ' + reviewBody())
    checks.push({ name: 'once started, the Review tab shows the agent at work at once and holds the old answer’s Post back', status: 'pass' })
    await captureShot('respond-again-review-tab')
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  }
}

// A reviewer who looked again and only commented still holds a change request on GitHub, and an approval of an older commit
// stays good when the PR's own work did not change. The PR page says so in one voice and offers the one next step.
const OLD_HEAD = 'd'.repeat(40)
const reviewer = { login: 'teammate', __typename: 'User' }
const OWN_LOOKED_AGAIN = { author: { login: 'reconnected-owner' }, reviewDecision: 'CHANGES_REQUESTED',
  latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: reviewer, commit: { oid: OLD_HEAD } }] },
  latestReviews: { nodes: [{ state: 'COMMENTED', author: reviewer, commit: { oid: HEAD } }] } }
// The same approval at another old commit: what GitHub says about a pair of commits cannot change, so the app asks once per pair.
const approvedAt = oid => ({ author: { login: 'reconnected-owner' }, reviewDecision: 'APPROVED',
  latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: reviewer, commit: { oid } }] } })
const OWN_APPROVED_BEFORE = approvedAt(OLD_HEAD)
const ownFile = (name, lines, hunk = '@@ -1 +1 @@') => ({ filename: name, status: 'modified', additions: lines.length, deletions: 0, patch: hunk + '\n' + lines.map(line => '+' + line).join('\n') })
window.runAskApprovalChecks = async () => {
  const checks = []
  const hint = () => text(query('.co-next-hint'))
  const pill = () => text(query('.co-next-step .co-desk-chip'))
  const menuItems = () => [...document.querySelectorAll('[role=menuitem]')]
  const button = label => [...document.querySelectorAll('button')].find(node => text(node) === label)
  const sideways = () => document.documentElement.scrollWidth <= window.innerWidth
  const openPage = async () => {
    await until(() => [...document.querySelectorAll('.co-desk-row')].some(node => text(node).includes('Contribution 7')), 'The Desk did not list the PR')
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('.co-desk-back') && query('.co-next-hint'), 'The PR page did not open')
  }
  try {
    reviewRuns.length = 0
    respondChats.length = 0
    window.fixtureCapabilities = { request_rereview_now: true, ask_approval_now: true, merge_now: true, pr_machine: true }
    // 1. Looked again, not approved.
    await mountDeskApp({ pullPatch: OWN_LOOKED_AGAIN })
    await openPage()
    ensure(pill() === 'Looked again · not approved', 'The pill said: ' + pill())
    ensure(hint().startsWith('Your PR · teammate looked again and left a comment, but GitHub still holds their change request'), 'The panel said: ' + hint())
    ensure(button('Ask teammate to approve'), 'The next step offered no Ask button: ' + [...document.querySelectorAll('button')].map(node => text(node)).join(' | '))
    ensure(sideways(), 'The PR page scrolls sideways: ' + document.documentElement.scrollWidth + ' of ' + window.innerWidth)
    checks.push({ name: 'a reviewer who looked again without approving reads as one state, with Ask for approval as the next step', status: 'pass' })
    await captureShot('ask-approval-page')
    // The Actions menu puts the Ask first, and dims the re-review ask with the reason.
    await click(query('[aria-label="Choose an action for PR 7"]'))
    await until(() => menuItems().length, 'The Actions menu did not open')
    const titles = menuItems().map(node => text(node.querySelector('strong')))
    ensure(titles[0] === 'Ask teammate to approve' && titles.includes('Ask for re-review'), 'The menu offered: ' + titles.join(', '))
    ensure(menuItems().find(node => text(node.querySelector('strong')) === 'Ask for re-review').getAttribute('aria-disabled') === 'true' || menuItems().find(node => text(node.querySelector('strong')) === 'Ask for re-review').disabled, 'Ask for re-review was still offered to someone who already looked')
    await captureShot('ask-approval-menu')
    await click(menuItems()[0])
    await until(() => query('.co-review-window'), 'The confirm sheet did not open')
    const sheet = text(query('.co-review-window'))
    ensure(sheet.includes('Ask teammate to approve #7?') && sheet.includes('@teammate you left a comment on this version') && sheet.includes('Posts exactly this note, once.'), 'The sheet said: ' + sheet)
    ensure(sideways(), 'The sheet scrolls the page sideways')
    const box = query('.co-review-window').getBoundingClientRect()
    ensure(box.left >= 0 && box.right <= window.innerWidth, 'The sheet ran off the screen: ' + Math.round(box.left) + ' to ' + Math.round(box.right) + ' of ' + window.innerWidth)
    await captureShot('ask-approval-sheet')
    checks.push({ name: 'the Ask sheet shows the exact note and stays on the screen', status: 'pass' })
    await click(button('Ask for approval'))
    await until(() => calls.asks.length === 1, 'Nothing was sent to the platform')
    const asked = calls.asks[0]
    ensure(asked.repo === 'owner/project' && asked.number === 7 && asked.head_sha === HEAD && asked.people.join() === 'teammate' && asked.note.startsWith('@teammate you left a comment on this version'), 'The platform got: ' + JSON.stringify(asked))
    ensure(asked.note.match(/@[A-Za-z0-9-]+/g).join() === '@teammate', 'The note named someone who was not asked: ' + asked.note)
    await until(() => text(query('.co-review-window')).includes('Note posted'), 'The sheet did not say the note was posted: ' + text(query('.co-review-window')))
    checks.push({ name: 'Ask for approval sends one note naming only the person asked, and says it was posted', status: 'pass' })
    // The longest GitHub login (39 characters) in the title, the sentence and the note must wrap, never push the screen sideways.
    const longLogin = 'a-reviewer-with-the-longest-login-1234'
    ensure(longLogin.length === 38 || longLogin.length === 39, 'The long login fixture is ' + longLogin.length)
    await click(button('Done'))
    const longReviewer = { login: longLogin, __typename: 'User' }
    await mountDeskApp({ pullPatch: { ...OWN_LOOKED_AGAIN,
      latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: longReviewer, commit: { oid: OLD_HEAD } }] },
      latestReviews: { nodes: [{ state: 'COMMENTED', author: longReviewer, commit: { oid: HEAD } }] } } })
    await openPage()
    ensure(hint().includes(longLogin) && sideways(), 'A long login pushed the PR page sideways: ' + document.documentElement.scrollWidth + ' of ' + window.innerWidth)
    await click(query('[aria-label="Choose an action for PR 7"]'))
    await until(() => menuItems().length, 'The Actions menu did not open for the long login')
    const longBox = query('.co-agent-menu-list').getBoundingClientRect()
    ensure(longBox.left >= 0 && longBox.right <= window.innerWidth && sideways(), 'The menu with a long login ran off the screen')
    await click(menuItems()[0])
    await until(() => query('.co-review-window'), 'The sheet did not open for the long login')
    const longSheet = query('.co-review-window').getBoundingClientRect()
    ensure(longSheet.left >= 0 && longSheet.right <= window.innerWidth && sideways(), 'The sheet with a long login ran off the screen')
    await captureShot('ask-approval-long-login-sheet')
    checks.push({ name: 'the longest GitHub login wraps in the page, the menu and the sheet without pushing the screen sideways', status: 'pass' })
    // 2. An approval of an older commit whose work is the same carries over.
    window.compareAnswers = commit => ({ files: [ownFile('a.js', ['one', 'two'], commit === HEAD ? '@@ -40,0 +41,2 @@' : '@@ -3,0 +3,2 @@')] })
    await mountDeskApp({ pullPatch: OWN_APPROVED_BEFORE })
    await openPage()
    await until(() => pill() === 'Ready to merge', 'The approval did not carry over: ' + pill() + ' / ' + hint())
    ensure(hint().includes('approved by teammate') && hint().includes('The lines you added and removed are the same as when they approved'), 'The panel said: ' + hint())
    await captureShot('carried-approval-page')
    await click(query('[aria-label="Choose an action for PR 7"]'))
    await until(() => menuItems().length, 'The Actions menu did not open')
    const merge = menuItems().find(node => text(node.querySelector('strong')) === 'Merge')
    ensure(merge && merge.getAttribute('aria-disabled') !== 'true' && !merge.disabled, 'Merge was not offered for a carried approval')
    await click(merge)
    await until(() => query('.co-review-window'), 'The merge sheet did not open')
    ensure(text(query('.co-review-window')).includes('Approved by teammate on ' + OLD_HEAD.slice(0, 7) + '. The lines you added and removed have not changed since'), 'The merge sheet said: ' + text(query('.co-review-window')))
    await captureShot('carried-approval-merge-sheet')
    checks.push({ name: 'an approval of an older commit whose own work is the same carries over: Ready to merge, and the merge sheet says why', status: 'pass' })
    // 3. The work changed: the approval is old, and one comparison that cannot be read is treated the same.
    window.compareAnswers = commit => ({ files: [ownFile('a.js', commit === HEAD ? ['one', 'CHANGED'] : ['one', 'two'])] })
    await mountDeskApp({ pullPatch: approvedAt('e'.repeat(40)) })
    await openPage()
    await until(() => pill() === 'Approval is old', 'A changed PR did not read as an old approval: ' + pill())
    window.compareAnswers = () => ({ message: 'Not Found' })
    await mountDeskApp({ pullPatch: approvedAt('f'.repeat(40)) })
    await openPage()
    await until(() => pill() === 'Approval is old', 'An unreadable comparison did not read as an old approval: ' + pill())
    checks.push({ name: 'when the work changed, or the comparison cannot be read, the approval stays old', status: 'pass' })
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  } finally {
    delete window.compareAnswers
    window.fixtureCapabilities = undefined
  }
}

// The whole app on a fresh page: a review the owner submits answers its request on
// GitHub, so the Desk row leaves Review requests when the verdict posts, not at the
// next Sync. Reads after that (the frame shown again, the hub's probe) keep it honest.
window.runReviewRequestChecks = async () => {
  const checks = []
  const rows = () => [...document.querySelectorAll('.co-desk-row')]
  const askRows = () => rows().filter(node => text(node).includes('Asks for your review'))
  const incomingReads = () => calls.requests.filter(call => call.url === '/api/github/graphql' && call.body?.query.includes('ContributeIncomingReviews')).length
  const settle = () => new Promise(resolve => setTimeout(resolve, 150))
  const approve = () => [...document.querySelectorAll('.co-verdict button')].find(node => text(node) === 'Approve on GitHub')
  const reviewTab = () => [...document.querySelectorAll('.co-detail-tabs button')].find(node => text(node).startsWith('Review'))
  const openVerdict = async () => {
    await click(rows().find(node => text(node).includes('Contribution 7')))
    await until(() => query('.co-desk-back') && reviewTab(), 'The PR page did not open')
    if (!approve()) await click(reviewTab())
    await until(approve, 'The PR page did not offer the proposed verdict')
  }
  const approveAndLeave = async () => {
    await click(approve())
    await until(() => !approve(), 'The verdict did not go out')
    await click(query('.co-desk-back'))
    await until(() => !query('.co-desk-back'), 'Back did not return to the Desk')
  }
  const realNow = Date.now
  try {
    reviewRuns.length = 0
    reviewRuns.push(verdictRun('proposed'))
    await mountDeskApp()
    await until(() => askRows().length === 1, 'The Desk did not list the review request')
    // GitHub did not confirm the verdict: the request may still stand, so the row stays.
    window.verdictOutcome = 'unknown'
    await openVerdict()
    await approveAndLeave()
    await settle()
    ensure(askRows().length === 1, 'An unconfirmed verdict took the row out of Review requests')
    checks.push({ name: 'a verdict GitHub did not confirm leaves the request in place', status: 'pass' })
    // The verdict posted. GitHub still lists the PR for the moment (its search lags), yet the row leaves now.
    reviewRuns[0] = verdictRun('proposed')
    window.verdictOutcome = 'posted'
    await openVerdict()
    const readsBefore = incomingReads()
    await approveAndLeave()
    await until(() => askRows().length === 0, 'The row stayed in Review requests after the verdict posted')
    ensure(incomingReads() === readsBefore, 'The row left only because GitHub was read again, not because the verdict landed')
    checks.push({ name: 'a posted verdict takes the PR out of Review requests at once, before any new GitHub read', status: 'pass' })
    // The frame shown again: the requests are not read again within five minutes of a read (55 GitHub points each), then they are, and show what GitHub says now.
    window.githubRequests = [pulls[1]]
    shownAgain()
    await settle()
    ensure(incomingReads() === readsBefore && askRows().length === 0, 'Showing the frame read GitHub again straight after a read')
    Date.now = () => realNow() + 6 * 60000
    shownAgain()
    await until(() => askRows().length === 1 && text(askRows()[0]).includes('Contribution 8'), 'Showing the frame again did not read the requests once the cooldown was over')
    ensure(!rows().some(node => text(node).includes('Contribution 7')), 'The reviewed PR came back after the next read')
    checks.push({ name: 'the frame shown again reads the requests once the five-minute cooldown is over', status: 'pass' })
    // A read that fails is not "nothing asks for your review".
    window.failIncoming = true
    const failedFrom = incomingReads()
    Date.now = () => realNow() + 12 * 60000
    shownAgain()
    await until(() => incomingReads() === failedFrom + 1, 'The failing read was never attempted')
    await settle()
    ensure(askRows().length === 1 && text(askRows()[0]).includes('Contribution 8'), 'A failed read emptied Review requests')
    checks.push({ name: 'a failed read keeps the requests that were listed', status: 'pass' })
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  } finally {
    Date.now = realNow
  }
}

// A fake clock for the sync scenario: the app's timers and Date.now run on it, so a minute of waiting
// costs a few milliseconds. Animation frames stay real, so the harness helpers keep working.
function installClock() {
  const real = { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, setInterval: window.setInterval, clearInterval: window.clearInterval, now: Date.now }
  const timers = new Map()
  let now = real.now(), serial = 0
  window.setTimeout = (callback, ms = 0) => { const id = ++serial; timers.set(id, { at: now + Math.max(0, ms), callback }); return id }
  window.setInterval = (callback, ms = 0) => { const id = ++serial; timers.set(id, { at: now + Math.max(1, ms), callback, every: Math.max(1, ms) }); return id }
  window.clearTimeout = window.clearInterval = id => { timers.delete(id) }
  Date.now = () => now
  const settle = async () => { for (let turn = 0; turn < 4; turn++) await new Promise(resolve => real.setTimeout.call(window, resolve, 0)); await frame() }
  async function advance(ms) {
    const target = now + ms
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, timer] = next
      now = Math.max(now, timer.at)
      if (timer.every) timer.at += timer.every; else timers.delete(id)
      timer.callback()
      await settle()
    }
    now = target
    await settle()
  }
  const restore = () => Object.assign(window, { setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval }) && (Date.now = real.now)
  return { advance, restore, now: () => now }
}

// The whole app, on a frame nobody ever focuses (a pane tiled beside a chat, or a drawer switched to): only the
// shell's visibility signal is real. Five changes happen outside the app; each must show within its bound with
// no Sync, no focus and no click. Hidden means no reads at all; a busy hour stays inside a GitHub budget.
window.runSyncChecks = async () => {
  const timeline = [], reads = {}
  const clock = installClock()
  const graphqlReads = name => calls.requests.filter(call => call.url === '/api/github/graphql' && call.body?.query.includes(name)).length
  const runReads = () => calls.requests.filter(call => call.method === 'GET' && call.url.endsWith('/review-runs')).length
  const rowOf = title => [...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes(title))
  const asks = title => !!rowOf(title) && text(rowOf(title)).includes('Asks for your review')
  const deskFrame = title => [...document.querySelectorAll('.co-frame')].find(node => text(node).includes(title))?.dataset.frame
  const minutes = count => clock.advance(count * 60000)
  const startedAt = clock.now()
  // How long (fake seconds) until shown() holds; null when it never does within the cap.
  async function timed(event, bound, shown, capSeconds = 400) {
    const started = clock.now()
    for (let second = 0; second < capSeconds && !shown(); second++) await clock.advance(1000)
    timeline.push({ event, bound, seconds: shown() ? Math.round((clock.now() - started) / 1000) : null })
  }
  try {
    reviewRuns.length = 0
    reviewRuns.push(reviewingRun(undefined, 'review-open'))
    window.githubRequests = [pulls[0]]
    await mountDeskApp()
    await until(() => asks('Contribution 7') && deskFrame('Contribution 7') === 'reviewing', 'The Desk did not list the review request with its review at work')
    // 0. The Desk shows a review at work; it ends in its chat. This is the one case that was polled before.
    reviewRuns[0] = verdictRun('proposed')
    await timed('a review the Desk shows at work ends: the row holds the amber frame', 11, () => deskFrame('Contribution 7') === 'verdict')
    reviewRuns.length = 0
    // 1. A review starts in a chat; nothing in the app is active, nothing is clicked.
    reviewRuns.unshift(reviewingRun(undefined, 'review-chat'))
    await timed('a review starts elsewhere: the row wears its frame', 31, () => deskFrame('Contribution 7') === 'reviewing')
    // 2. It finishes with a verdict waiting on the owner.
    reviewRuns[0] = { ...verdictRun('proposed'), id: 'review-chat' }
    const reviewShown = deskFrame('Contribution 7') === 'reviewing'
    await timed('the review ends: the row holds the amber frame', 11, () => reviewShown && deskFrame('Contribution 7') === 'verdict')
    // 3. The verdict is posted on GitHub: the request is answered and the run is complete.
    reviewRuns[0] = { ...verdictRun('posted'), id: 'review-chat' }; window.githubRequests = []
    await timed('the verdict is posted: the row leaves Review requests', 31, () => !asks('Contribution 7'))
    // GitHub confirms by the probe and the read it asks for once the cooldown allows; then five quiet minutes.
    await minutes(12)
    // 4. A new review request arrives on GitHub.
    window.githubRequests = [pulls[1]]
    await timed('a new review request: the row appears', 61, () => asks('Contribution 8'))
    await minutes(6)
    // 5. That PR is merged or closed elsewhere.
    window.githubRequests = []
    const listed = !!rowOf('Contribution 8')
    await timed('a PR is merged or closed elsewhere: the row leaves', 61, () => listed && !rowOf('Contribution 8'))
    reads.githubUntilHidden = calls.requests.filter(call => call.url === '/api/github/graphql').map(call => Math.round((call.at - startedAt) / 1000) + ' s ' + /query (\w+)/.exec(call.body.query)[1].replace('Contribute', ''))
    // Hidden: not one read, however long. Visible again: the read comes at once.
    window.setFrameVisible(false)
    const hiddenFrom = calls.requests.length
    await minutes(10)
    reads.whileHidden = calls.requests.length - hiddenFrom
    window.githubRequests = [pulls[0]]; reviewRuns.unshift(reviewingRun(undefined, 'review-again'))
    window.setFrameVisible(true)
    await timed('the frame is shown again: both changes show at once', 3, () => asks('Contribution 7') && deskFrame('Contribution 7') === 'reviewing', 30)
    // A busy hour: GitHub reports a change every minute and nothing stops it. The account's points are the budget.
    // A review is at work on PR 7 the whole hour; its conversation ends a turn every other minute (no change of state).
    reviewRuns.length = 0
    reviewRuns.push(reviewingRun('running', 'review-busy'))
    await minutes(1)
    window.githubPoints = 0
    for (let minute = 0; minute < 60; minute++) {
      pulls[0].updatedAt = '2026-09-07T14:' + String(minute).padStart(2, '0') + ':00Z'
      window.githubRequests = minute % 2 ? [pulls[0]] : [pulls[0], pulls[1]]
      reviewRuns[0].execution_state = minute % 2 ? 'running' : 'completed'
      await minutes(1)
    }
    reads.busyHourPoints = window.githubPoints
    // Low on points, automatic GitHub reads stop; the platform's own reads go on; Sync still reads.
    window.githubRemaining = 900
    await minutes(2) // the next answer tells the app how many points are left
    const githubBefore = calls.requests.filter(call => call.url === '/api/github/graphql').length, runsBefore = runReads()
    await minutes(10)
    reads.lowBudgetGithubReads = calls.requests.filter(call => call.url === '/api/github/graphql').length - githubBefore
    reads.lowBudgetRunReads = runReads() - runsBefore
    const incomingBefore = graphqlReads('ContributeIncomingReviews')
    await click(query('.co-toolbar-refresh'))
    reads.syncReadsWhenLow = graphqlReads('ContributeIncomingReviews') - incomingBefore
    const late = timeline.filter(row => row.seconds === null || row.seconds > row.bound)
    const problems = late.map(row => row.event + ': ' + (row.seconds === null ? 'never' : row.seconds + ' s') + ' (bound ' + row.bound + ' s)')
    if (reads.whileHidden !== 0) problems.push('a hidden frame made ' + reads.whileHidden + ' requests')
    if (reads.busyHourPoints < 60 || reads.busyHourPoints >= 800) problems.push('a busy hour cost ' + reads.busyHourPoints + ' GitHub points (it must read, and stay under 800)')
    if (reads.lowBudgetGithubReads !== 0) problems.push('low on points, ' + reads.lowBudgetGithubReads + ' automatic GitHub reads still ran')
    if (reads.lowBudgetRunReads < 10) problems.push('low on points, only ' + reads.lowBudgetRunReads + ' platform reads ran in ten minutes')
    if (reads.syncReadsWhenLow < 1) problems.push('Sync did not read GitHub while the budget was low')
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    const report = { timeline, reads }
    if (problems.length) return { status: 'fail', error: problems.join('\n'), ...report, forbidden: calls.forbidden }
    return { status: 'pass', checks: [{ name: 'every outside change shows inside its bound on a frame nobody focuses', status: 'pass' }], ...report, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', error: error.stack, timeline, reads, dom: text(query('main')).slice(0, 3000), forbidden: calls.forbidden }
  } finally {
    clock.restore()
  }
}

// The whole app: a slow read of the review runs, begun before the owner starts a review on the PR page,
// answers with the list as it was (no review). It must never hide the review the owner just started.
window.runStaleAnswerChecks = async () => {
  const checks = []
  const reviewing = () => query('.co-frame[data-frame="reviewing"]')
  const settle = async () => { for (let turn = 0; turn < 6; turn++) await frame() }
  try {
    reviewRuns.length = 0
    await mountDeskApp()
    await until(() => [...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')), 'The Desk did not list the review request')
    await click([...document.querySelectorAll('.co-desk-row')].find(node => text(node).includes('Contribution 7')))
    await until(() => query('[aria-label="Choose an action for PR 7"]'), 'The PR page did not open')
    // Sync reads the runs; the answer is held on the way.
    window.holdRunsRead = true
    await click(query('.co-toolbar-refresh'))
    await until(() => !window.holdRunsRead, 'Sync never read the review runs')
    const releaseSlowRead = window.releaseRunsRead
    // The owner starts a review while that read is out.
    await click(query('[aria-label="Choose an action for PR 7"]'))
    await click([...document.querySelectorAll('[role=menuitem]')].find(node => text(node.querySelector('strong')) === 'Review'))
    await until(() => review(), 'Review window did not open')
    const start = () => [...review().querySelectorAll('button')].find(node => text(node).startsWith('Start'))
    await until(() => start() && !start().disabled, 'The review window never offered Start')
    await click(start())
    await until(reviewing, 'The PR page did not frame the review it started')
    // The slow read lands now, with no review in it. The read the start asked for waits behind it, held too.
    window.holdRunsRead = true
    releaseSlowRead()
    await until(() => !window.holdRunsRead, 'The read after the slow one never started')
    await settle()
    ensure(reviewing(), 'An older list of the runs hid the review the owner had just started')
    checks.push({ name: 'a read begun before the owner started a review never hides it when it lands', status: 'pass' })
    // Sync ends once the newer read lands and reloads the PR list, so the frame returns a moment later.
    window.releaseRunsRead()
    await until(reviewing, 'The review was lost once the newer read landed')
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 3000), forbidden: calls.forbidden }
  }
}
`
async function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  for (const path of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(path)) return path
  }
  const directory = '/opt/agent-browser/browsers'
  if (existsSync(directory)) for (const name of (await readdir(directory)).sort().reverse()) {
    const path = join(directory, name, 'chrome')
    if (existsSync(path)) return path
  }
  throw new Error('No installed Chromium found; set CHROMIUM_PATH. This test never installs a browser.')
}

function cdp(browser) {
  let serial = 0, buffer = ''
  const pending = new Map(), events = [], listeners = new Set()
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString()
    let end
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      if (message.id) {
        const entry = pending.get(message.id)
        if (!entry) continue
        pending.delete(message.id); clearTimeout(entry.timer)
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
      } else { events.push(message); for (const listener of listeners) listener(message) }
    }
  })
  return { events, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) }, send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)) }, 120000)
      pending.set(id, { resolve, reject, timer })
      browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  } }
}

const shotsFolder = process.env.WORKSPACE_BROWSER_SHOTS || ''
async function captureShots(protocol, sessionId, viewportName) {
  await protocol.send('Runtime.addBinding', { name: 'workspaceShot' }, sessionId)
  return protocol.onEvent(event => {
    if (event.sessionId !== sessionId || event.method !== 'Runtime.bindingCalled' || event.params.name !== 'workspaceShot') return
    void (async () => {
      const { data } = await protocol.send('Page.captureScreenshot', { format: 'png' }, sessionId)
      await writeFile(join(shotsFolder, `${event.params.payload}-${viewportName}.png`), Buffer.from(data, 'base64'))
      await protocol.send('Runtime.evaluate', { expression: 'window.finishShot()' }, sessionId)
    })()
  })
}

async function main() {
  if (!frontendModules) throw new Error('MOBIUS_FRONTEND_NODE_MODULES is required')
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)
  const build = await rolldown({ input: ENTRY, platform: 'browser', tsconfig: false,
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    resolve: { modules: [frontendModules, 'node_modules'] },
    plugins: [{ name: 'workspace-browser-fixture',
      resolveId(id, importer) { if (id === ENTRY) return id; if (importer === ENTRY && id.startsWith('.')) return join(root, id) },
      load(id) { if (id === ENTRY) return { code: fixture, moduleType: 'jsx' } },
    }],
  })
  const { output } = await build.generate({ format: 'iife' })
  await build.close()
  const temporary = await mkdtemp(join(tmpdir(), 'contribute-workspace-browser-'))
  let browser
  try {
    const page = join(temporary, 'fixture.html')
    await writeFile(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'">' +
      '<style>:root{--bg:#fff;--surface:#f5f5f5;--surface-2:#eee;--text:#222;--muted:#666;--border:#ddd;--accent:#2454cc;--accent-dim:#eef;--font:Arial}html,body,#root{height:100%;margin:0}</style>' +
      '</head><body><div id="root"></div><script>' + output[0].code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>')
    browser = spawn(await chromiumPath(), ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--remote-debugging-pipe', '--user-data-dir=' + join(temporary, 'profile'), 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
    browser.stderr.resume()
    const protocol = cdp(browser), reports = []
    // Each scenario gets a fresh page, so the whole-app Desk scenario never inherits the project fixture's state.
    // WORKSPACE_BROWSER_ONLY=runDeskFrameChecks runs one scenario.
    const scenarios = process.env.WORKSPACE_BROWSER_ONLY ? [process.env.WORKSPACE_BROWSER_ONLY] : ['runWorkspaceChecks', 'runPopupFitChecks', 'runDeskFrameChecks', 'runReviewRequestChecks', 'runReviewHelperWaitChecks', 'runRespondAnswerChecks', 'runRespondResultChecks', 'runRespondAgainChecks', 'runAskApprovalChecks', 'runSyncChecks', 'runStaleAnswerChecks']
    const viewports = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }].filter(size => !process.env.WORKSPACE_BROWSER_VIEWPORT || size.name === process.env.WORKSPACE_BROWSER_VIEWPORT)
    for (const [viewport, scenario] of viewports.flatMap(size => scenarios.map(name => [size, name]))) {
      const { targetId } = await protocol.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await protocol.send('Target.attachToTarget', { targetId, flatten: true })
      const inputErrors = []
      const unsubscribeInput = protocol.onEvent(event => {
        if (event.sessionId !== sessionId || event.method !== 'Runtime.bindingCalled' || event.params.name !== 'workspaceNativeKey') return
        void (async () => {
          let error = ''
          try {
            const input = JSON.parse(event.params.payload)
            if (!['Space','Escape'].includes(input.code)) throw new Error('Unknown native input request')
            for (const type of ['keyDown', 'keyUp']) await protocol.send('Input.dispatchKeyEvent', {
              type, key: input.key, code: input.code, windowsVirtualKeyCode: input.keyCode, nativeVirtualKeyCode: input.keyCode,
            }, sessionId)
          } catch (failure) { error = failure.message }
          await protocol.send('Runtime.evaluate', { expression: `window.finishNativeKey(${JSON.stringify(error)})` }, sessionId)
        })().catch(error => inputErrors.push(error.message))
      })
      await protocol.send('Runtime.enable', {}, sessionId)
      await protocol.send('Runtime.addBinding', { name: 'workspaceNativeKey' }, sessionId)
      // WORKSPACE_BROWSER_SHOTS=<folder> saves a PNG wherever a scenario calls captureShot(name): the PR's before and after pictures.
      const unsubscribeShots = shotsFolder ? await captureShots(protocol, sessionId, viewport.name) : () => {}
      await protocol.send('Network.enable', {}, sessionId)
      await protocol.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] }, sessionId)
      await protocol.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === 'phone' }, sessionId)
      await protocol.send('Page.enable', {}, sessionId)
      await protocol.send('Page.navigate', { url: pathToFileURL(page).href }, sessionId)
      const evaluated = await protocol.send('Runtime.evaluate', { expression: `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        function ready() { if (window[${JSON.stringify(scenario)}]) window[${JSON.stringify(scenario)}]().then(resolve, reject);
          else if (Date.now() > deadline) reject(new Error('Fixture did not load'));
          else setTimeout(ready, 20); }
        ready();
      })`, awaitPromise: true, returnByValue: true }, sessionId)
      const report = evaluated.result?.value || { status: 'fail', error: evaluated.exceptionDetails || evaluated }
      unsubscribeInput()
      unsubscribeShots()
      if (inputErrors.length) { report.status = 'fail'; report.nativeInputErrors = inputErrors }
      const network = protocol.events.filter(event => event.sessionId === sessionId && event.method === 'Network.requestWillBeSent'
        && !/^(file|data):/.test(event.params.request.url)).map(event => event.params.request.url)
      if (network.length) { report.status = 'fail'; report.unexpectedNetwork = network }
      reports.push({ viewport, scenario, ...report })
      await protocol.send('Target.closeTarget', { targetId })
    }
    const passed = reports.every(report => report.status === 'pass')
    console.log(JSON.stringify({ status: passed ? 'pass' : 'fail', reports }, null, 2))
    if (!passed) process.exitCode = 1
    await protocol.send('Browser.close')
  } finally {
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      // Browser.close owns graceful shutdown, including profile writers. Do
      // not interrupt that shutdown and race its child processes during rm.
      await new Promise(resolve => {
        const timer = setTimeout(() => browser.kill('SIGKILL'), 3000)
        browser.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    await rm(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(JSON.stringify({ status: 'fail', error: error.stack })); process.exitCode = 1 })
