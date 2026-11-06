import { useCallback, useEffect, useRef, useState } from 'react'
import { awaitsGithub, earlierReviewForPull, pullAction, mergePull, reviewIntent, collaborationRequest, discoverPull, discoverPulls, liveSelection, conversationCount, matchingPulls, mayAssign, mergeSelection, prKey, reviewForPull, reviewItemProgress, reviewRunRequest, reviewRunTitle, runDetailsElsewhere, notOursToObserve, assignPulls, TAKEOVER_SCOPE } from '../collaboration.js'
import { acknowledgeAssignment, emptyPullView, invalidatedSelection, isOpenPull, isOwnPull, observePulls, pullsInView } from '../pull-view.js'
import { chipOf, frameOf, standingFor } from '../pr-standing.js'
import { ReviewFrame } from './ReviewFrame.jsx'
import { pullConversations, recordsForPull } from '../provenance.js'
import { RunDetail, savedVersion } from './RunDetail.jsx'
import { PullRequestDetail, Skeleton } from './PullRequestDetail.jsx'
import { Avatar, ChecksBadge, PullLabels, PullStateChips, PullStateIcon, TimeAgo } from './GithubParts.jsx'
import { TaskPane, useProjectTask, focusActionRegion } from './TaskPane.jsx'
import { useFocusLease } from './useFocusLease.js'
import { Icon } from './Icons.jsx'
import { ActionsMenu } from './ActionsMenu.jsx'
import { ReviewDialog } from './ReviewDialog.jsx'
import { AddressFeedbackWindow } from './AddressFeedback.jsx'
import { savedFindings } from '../address-feedback.js'
import { ReviewConfirmation } from './ReviewConfirmation.jsx'
import { ActionConfirm } from './ActionConfirm.jsx'
import { IgnoreReview } from './IgnoreReview.jsx'
import { PostFindings } from './PostFindings.jsx'
import { isPersonalDraft } from '../domain.js'
import { RunOnce } from './RunOnce.jsx'
import { YOUR_INTENTS } from '../actions-menu.js'
import { ACTION_COPY, methodToSend } from '../action-copy.js'
import { projectUpdater } from '../updates.js'
import { NAMES } from '../names.js'
import { SearchField } from './SearchField.jsx'

// A takeover's one scope: repairs to the named PR, each push approved by the owner.
const scopeFor = mode => mode === 'review_fix_merge' ? { confirmation_scope: TAKEOVER_SCOPE } : {}

// The review chip's look by who holds the next move (see pr-standing.js chipOf).
const CHIP_TONE_CLASS = { owner: ' needs-you', waiting: ' is-waiting', plain: '' }

const FILTERS = [['all', 'All'], ['authored', 'Opened by me'], ['drafts', 'Drafts'], ['failing', 'Failing checks'], ['bots', 'Bots'], ['unassigned', 'Unassigned'], ['assigned', 'Assigned to me']]

// Saved agent review conversations for this project, shown in My work.
function AgentReviewHistory({ runs, pulls, listState, onOpen }) {
  if (!runs.length) return <p className="co-pr-note co-mywork-empty">No agent reviews in this project yet.</p>
  return <details className="co-run-fold co-review-history">
    <summary><span>Agent reviews</span><b>{runs.length}</b><Icon name="chevron" size={14} /></summary>
    <p className="co-pr-note">Saved findings apply only to their recorded versions. Open a conversation to answer questions or check an unresolved outcome.</p>
    <div>{runs.map(run => <button key={run.id} type="button" className="co-review-history-entry" data-review-run={run.id} onClick={() => onOpen(run)}>
      <strong>{reviewRunTitle(run)}</strong>
      {run.items?.map(item => <span key={`${item.repo}:${item.number}`}>{item.repo} #{item.number} · Recorded: {reviewItemProgress(run, item).label}<small>{savedVersion(item, pulls, listState)}</small></span>)}
    </button>)}</div>
  </details>
}

// The tab badge counts every request, but this list filters only the loaded
// pages: with more pages left, never claim the inbox is empty.
function EmptyRequests({ query, hasNextPage, waiting }) {
  if (!hasNextPage) return <div className="co-pr-empty"><strong>No review requests{query ? ' match' : ' right now'}</strong><p>When someone asks for your review, the PR appears here.</p></div>
  const known = waiting && !query ? `You have ${waiting === 1 ? '1 review request' : `${waiting} review requests`} in this project. ` : ''
  return <div className="co-pr-empty"><strong>No review requests{query ? ' match' : ''} in the PRs loaded so far</strong><p>{known}Load more PRs to check the rest.</p></div>
}

export function EmptyPulls({ scope, filter, query, hasNextPage, waiting = 0 }) {
  if (scope === 'requests') return <EmptyRequests query={query} hasNextPage={hasNextPage} waiting={waiting} />
  const kind = { unassigned: 'unassigned ', assigned: 'assigned ', drafts: 'draft ', failing: 'failing ', bots: 'bot ', authored: 'your ' }[filter] || ''
  const hint = hasNextPage ? 'Load more to search the remaining results.' : filter === 'all' ? 'When work is shared on GitHub, it appears here.' : 'Choose All to see the project’s other pull requests.'
  return <div className="co-pr-empty"><strong>No {kind}pull requests{query ? ' match' : ''}</strong><p>{hint}</p></div>
}

// GitHub-style list header: the count when nothing is selected, bulk actions
// once something is. Selection never moves focus or interrupts browsing.
function SelectionTray({ selection, decisions, busy, onClear, onReview, onAssign, visible, shown = visible.length, loading = false, onSelectVisible }) {
  const selected = selection.length
  const allVisible = visible.length > 0 && visible.every(pr => selection.some(item => prKey(item) === prKey(pr)))
  return <div className="co-pr-box-head" role="group" aria-label="Pull request actions">
    <label className="co-pr-select"><input type="checkbox" checked={allVisible} onChange={onSelectVisible} aria-label="Select all visible pull requests" /></label>
    <strong className="co-pr-box-count">{selected ? `${selected} selected` : <><Icon name="pull" size={16} />{loading && !shown ? 'Open pull requests' : `${shown} open`}</>}</strong>
    {selected ? <div className="co-pr-box-actions">
      <button className="co-btn" disabled={busy || selected > 20 || !selection.every(pr => mayAssign(pr.repository.viewerPermission))} onClick={onAssign} aria-label="Assign selected PRs to a person"><Icon name="person" size={16} /><span>Assign</span></button>
      <ActionsMenu variant="button" pulls={selection} decisions={decisions} disabled={selected > 20 || busy} onChoose={mode => onReview(selection, mode)} ariaLabel="Choose an action for the selected PRs" />
      <button className="co-btn co-btn-quiet co-btn-icon" aria-label="Clear selection" onClick={onClear}><Icon name="close" size={16} /></button>
    </div> : null}
    {selected > 20 ? <p role="status">Choose up to 20 PRs per run.</p> : null}
  </div>
}

// One person in the assignment grid: name on top, GitHub login underneath.
function PersonOption({ label, login, hint = login, ariaLabel, disabled, onPick }) {
  return <button className="co-person-option" disabled={disabled} onClick={() => onPick(login)} aria-label={ariaLabel}>
    <b className="co-avatar">{login[0].toUpperCase()}</b>
    <span className="co-person-text"><span>{label}</span>{hint ? <small>{hint}</small> : null}</span>
  </button>
}

function AssigneePicker({ pulls, token, appId, ownLogin, onAssigned, onClose }) {
  const picker = useRef(null)
  useEffect(() => {
    focusActionRegion(picker.current, picker.current?.querySelector('input[type=search]'))
  }, [])
  const pr = pulls[0]
  const [outcomes, setOutcomes] = useState([])
  const pending = pulls.filter(item => !outcomes.some(result => result.ok && result.key === prKey(item)))
  const [people, setPeople] = useState({ assignees: [], loading: true })
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load(page = 1) {
    setError('')
    try {
      const next = await collaborationRequest(token, appId, `assignees?repo=${encodeURIComponent(pr.repository.nameWithOwner)}&page=${page}`)
      setPeople(old => ({ ...next, loading: false, assignees: page === 1 ? next.assignees : [...old.assignees, ...next.assignees] }))
    } catch (error) { setError(error.message); setPeople(old => ({ ...old, loading: false })) }
  }
  useEffect(() => { void load() }, [])
  async function assign(login) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const results = await assignPulls(token, appId, pending, login)
      setOutcomes(old => [...old.filter(item => !results.some(result => result.key === item.key)), ...results])
      onAssigned(login, results.filter(result => result.ok).map(result => result.key))
      if (results.every(result => result.ok)) onClose()
    } finally { setBusy(false) }
  }

  const matching = people.assignees.filter(person => [person.login, person.name].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))
  const own = people.assignees.find(person => person.login.toLowerCase() === ownLogin?.toLowerCase())
  return <div ref={picker} tabIndex={-1} className="co-pr-assignment" role="region" aria-label="Assign selected PRs">
    <h3>Assign {pulls.length === 1 ? `#${pr.number}` : `${pulls.length} PRs`}</h3>
    <p className="co-pr-assignment-note">The assignee is the person responsible for {pulls.length === 1 ? 'this PR' : 'these PRs'} on GitHub. This does not change the author, and it does not ask anyone for a review.</p>
    <SearchField className="co-person-search" label="Find a person" value={query} onChange={setQuery} disabled={busy} />
    {people.loading ? <Skeleton lines={3} label="Loading people" /> : null}
    <div className="co-person-list">
      {own && !query ? <PersonOption label="Assign to me" login={own.login} ariaLabel="Assign to me" disabled={busy || !people.can_assign} onPick={assign} /> : null}
      {matching.filter(person => query || person.login !== own?.login).map(person => <PersonOption key={person.login} label={person.name || person.login} login={person.login} hint={person.name ? person.login : ''} ariaLabel={`Assign to ${person.login}`} disabled={busy || !people.can_assign} onPick={assign} />)}
    </div>
    {!people.loading && !matching.length ? <p>No matching people in the loaded results.</p> : null}
    {busy ? <p role="status">Assigning…</p> : null}
    {people.next_page ? <button className="co-btn" disabled={busy || people.loading} onClick={() => load(people.next_page)}>Load more people</button> : null}
    {outcomes.filter(result => !result.ok).map(result => <p key={result.key} role="alert" className="co-run-error">{result.key}: {result.error}</p>)}
    {outcomes.some(result => result.ok) ? <p role="status">{outcomes.filter(result => result.ok).length} assigned. Only remaining PRs will be retried.</p> : null}
    {error ? <div className="co-alert" role="alert"><p className="co-alert-text">{error}</p><button className="co-btn" disabled={busy} onClick={() => load()}>Retry</button></div> : null}
  </div>
}

// One session cache per repository: the loaded PR list (view and paging
// state), the per-PR detail snapshots and the observation
// generation survive leaving and reopening a project or a PR page, so GitHub
// is asked once per repository per app open. The header's Refresh (refreshKey)
// or a change in the local contribution records invalidates the entry.
const sessionCache = new Map()
const NO_LIST = []
function sessionEntry(repo, key) {
  const id = repo.toLowerCase()
  if (sessionCache.get(id)?.key !== key) {
    sessionCache.set(id, { key, view: null, data: null, details: new Map(), generation: 0 })
  }
  return sessionCache.get(id)
}

// `focusPull` is a navigation lease from a chat link: while it is held, that
// exact PR stays in view (even when closed or on a later page) and its detail
// is open. Leaving the detail or the project hands the lease back.
// A run opens beside its PR when it covers one; batches open under the header.
const runAnchor = run => run.items?.length === 1 ? `${run.items[0].repo.toLowerCase()}#${run.items[0].number}` : ''

// `scope` follows the project tabs: 'all' (every open PR), 'requests' (PRs that
// ask for the owner's review) or 'mine' (the saved agent reviews only).
// The review runs and the live Respond conversations are the app's one shared copy
// (`runs`, `respondChats`; index.jsx useDeskReviewRuns), kept fresh by the sync hub:
// this page holds no copy, timer or focus handler of its own. `onRunPatched(run)`
// shows the answer of an action here (a start, a stop, a verdict) in that copy, and
// `onRunsChanged` asks the hub to read it again, so every screen shows the change.
// `onReviewPosted(repo, number)` tells it the owner's review of a PR reached GitHub,
// so the row leaves Review requests without waiting for the next read.
export function PullRequests({ appId, token, project, conn, onChanged, onReviewPosted, runs = NO_LIST, respondChats = NO_LIST, runsError = '', onRunsChanged, onRunPatched, records = [], onRecord, refreshKey, focusPull, focusRun, onFocusRelease, scope = 'all', onScope, onTotal, presentation = 'list', onOpenPage = null, onStartAgent = null, onOpenForReview = null, ignoredReviews = null, onIgnoreReview = null, onUndoIgnore = null, defaultAgent = null }) {
  const repo = project?.canonical_repo || ''
  const publicRevision = records.filter(record => record.url).map(record => `${record.id}:${record.status}:${record.number}:${record.last_updated_pr_at || ''}`).sort().join('|')
  const session = sessionEntry(repo, `${refreshKey}|${publicRevision}`)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const task = useProjectTask()
  const [data, setData] = useState(session.data || { loading: true, error: '' })
  const [view, setView] = useState(() => session.view || emptyPullView())
  const viewRef = useRef(view)
  const generation = useRef(session.generation)
  const focusKey = focusPull && conn.state === 'connected' && focusPull.repo?.toLowerCase() === repo.toLowerCase()
    ? `${focusPull.repo.toLowerCase()}#${focusPull.number}` : ''
  const focusRef = useRef(null)
  focusRef.current = focusKey ? { key: focusKey, nonce: focusPull.nonce, repo: focusPull.repo, number: focusPull.number } : null
  const [focusError, setFocusError] = useState(null)
  // Three sources of the one "agent progress unavailable" note: an action's own
  // failure (cleared by the next action), a failed read of the runs (`runsError`,
  // cleared by the next read) and a failed read of the linked run (likewise).
  const [ownRunError, setOwnRunError] = useState('')
  const [linkedError, setLinkedError] = useState('')
  const runError = ownRunError || runsError || linkedError
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchField = useRef(null)
  useEffect(() => { if (searchOpen) searchField.current?.focus() }, [searchOpen])
  const [opened, setOpened] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [selectionNotice, setSelectionNotice] = useState('')
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const pulls = pullsInView(view, focusKey)
  const [assigning, setAssigning] = useState(null)
  // Address feedback has its own window: it starts an agent conversation, not a review run.
  const [addressing, setAddressing] = useState(null)
  // One of the owner's own actions (Open for review, Merge) waiting on its confirm sheet.
  const [acting, setActing] = useState(null)
  const [posting, setPosting] = useState(null)
  // A review's findings waiting on the owner's reason to set them aside.
  const [ignoring, setIgnoring] = useState(null)
  const [choice, setChoice] = useState(null)
  const [resolved, setResolved] = useState(null)
  // The platform's advertised workflows, remembered across launches.
  const [capabilities, setCapabilities] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const [detailRevision, setDetailRevision] = useState(0)
  function detailSnapshot(pr) {
    const key = `${prKey(pr)}:${pr.headRefOid}:${pr.baseRefOid}:${pr.baseRefName}`
    const details = sessionRef.current.details
    if (!details.has(key)) details.set(key, { entries:{}, stale:false })
    return details.get(key)
  }
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current += 1 } }, [])
  // Both readers publish through here, so selection follows the same winner.
  const publish = useCallback((pulls, issued, inventory, announce) => {
    const before = viewRef.current, pinned = focusRef.current?.key || ''
    const next = observePulls(before, pulls, issued, { inventory, pinned })
    viewRef.current = next
    setView(next)
    sessionRef.current.view = next
    sessionRef.current.generation = generation.current
    const removed = invalidatedSelection(selectedRef.current, pullsInView(before, pinned), pullsInView(next, pinned))
    if (removed.length) {
      selectedRef.current = new Set([...selectedRef.current].filter(key => !removed.includes(key)))
      setSelected(selectedRef.current)
    }
    if (removed.length || announce) setSelectionNotice(removed.length ? `Selection updated: ${removed.join(', ')} changed or is no longer open. Select its current version again if needed.` : '')
  }, [])
  const readFocus = useCallback(async focus => {
    const issued = ++generation.current
    const current = () => alive.current && focusRef.current?.key === focus.key && focusRef.current.nonce === focus.nonce
    try {
      const pr = await discoverPull(token, focus.repo, focus.number)
      if (current()) publish([pr], issued, viewRef.current.inventory, false)
    } catch (error) {
      if (current()) setFocusError({ key: focus.key, nonce: focus.nonce, issued, message: error.message })
    }
  }, [token, publish])
  const load = useCallback(async (cursor = null) => {
    const id = ++request.current, issued = ++generation.current
    setData(old => ({ ...old, loading: true, error: '' }))
    try {
      let next = await discoverPulls(token, repo, cursor)
      // A first-page refresh must not discard selections from later pages.
      while (!cursor && next.hasNextPage && [...selectedRef.current].some(key => !next.pulls.some(pr => prKey(pr) === key))) {
        if (id !== request.current || !alive.current) return
        const page = await discoverPulls(token, repo, next.endCursor)
        next = { ...page, pulls: mergeSelection(next.pulls, page.pulls) }
      }
      if (id !== request.current || !alive.current) return
      if (!cursor) { sessionRef.current.details.clear(); setDetailRevision(value => value + 1) }
      const inventory = cursor ? [...new Set([...viewRef.current.inventory, ...next.pulls.map(prKey)])] : next.pulls.map(prKey)
      publish(next.pulls, issued, inventory, !cursor)
      const settled = { total: next.total, hasNextPage: next.hasNextPage, endCursor: next.endCursor, loading: false, error: '' }
      sessionRef.current.data = settled
      setData(settled)
      // Absence from the open list is not closure: re-read a pinned destination.
      const focus = focusRef.current
      if (!cursor && focus && !inventory.includes(focus.key)) void readFocus(focus)
    } catch (error) {
      if (id === request.current && alive.current) setData(old => ({ ...old, loading: false, error: error.message }))
    }
  }, [token, repo, publish, readFocus])
  // A linked run older than the capped recent list is kept as its own exact
  // record: every refresh rereads it (observing an unsettled public outcome)
  // so a list refresh can never fall back to the navigation-time snapshot.
  const [linked, setLinked] = useState(null)
  const linkedRef = useRef(null)
  linkedRef.current = linked
  const runFocusRef = useRef(null)
  const runsChangedRef = useRef(onRunsChanged)
  runsChangedRef.current = onRunsChanged
  // One ordering boundary for the linked run's exact read: it applies only if
  // nothing newer was issued or confirmed since it began. A Stop advances it, a
  // newer read advances it, and exact reads also match their lease nonce, so an
  // older response can never overwrite a confirmed newer state.
  const linkedEpoch = useRef(0)
  const readLinked = useCallback(async list => {
    const epoch = ++linkedEpoch.current
    const current = () => alive.current && linkedEpoch.current === epoch
    const focus = runFocusRef.current
    if (!focus || list.some(run => run.id === focus.runId)) return
    const path = `review-runs/${encodeURIComponent(focus.runId)}`
    try {
      if (linkedRef.current && !runDetailsElsewhere(linkedRef.current) && awaitsGithub(linkedRef.current)) {
        // A run the core owns is reconciled there; its refusal is not an error.
        try { await collaborationRequest(token, appId, `${path}/observe`, {}) }
        catch (error) { if (!notOursToObserve(error)) throw error }
      }
      const exact = (await collaborationRequest(token, appId, path)).run
      if (current() && runFocusRef.current?.nonce === focus.nonce && exact) { setLinked(exact); setLinkedError('') }
    } catch (error) { if (current()) setLinkedError(`This run's latest status is unavailable: ${error.message}`) }
  }, [token, appId])
  // What this Möbius can do for the owner (Merge among it), asked once. An older
  // Möbius answers 404 and keeps the menu as it was.
  useEffect(() => {
    if (capabilities || conn.state !== 'connected') return undefined
    let alive = true
    collaborationRequest(token, appId, 'review-presets').then(value => { if (alive) setCapabilities(value.capabilities || {}) }, () => {})
    return () => { alive = false }
  }, [conn.state, token, appId])
  useEffect(() => {
    if (conn.state !== 'connected') return
    // A repository already read this session reopens from its cache with no
    // new GitHub round-trip; Refresh or changed local records reload it.
    const cached = sessionRef.current
    if (cached.view && cached.data && !cached.data.loading && !cached.data.error) {
      if (viewRef.current !== cached.view) { viewRef.current = cached.view; setView(cached.view) }
      setData(cached.data)
    } else {
      void load()
    }
    // Opening a project's list or a PR page shows the runs as they are now, not as the last cadence read had them.
    void runsChangedRef.current?.()
  }, [conn.state, publicRevision, refreshKey, load])
  useEffect(() => {
    task?.setPublicKeys(new Set(view.inventory))
    return () => task?.setPublicKeys(new Set())
  }, [view.inventory, task?.setPublicKeys])
  useEffect(() => {
    setFocusError(null)
    const focus = focusRef.current
    if (!focus) return
    setFilter('all'); setQuery('')
    void readFocus(focus)
  }, [focusKey, focusPull?.nonce, readFocus])
  // Open the destination once it is observed; hand the lease back when its
  // detail closes, another PR opens, or this project view unmounts.
  const focusOpened = useRef('')
  const focusRow = focusKey && view.rows.has(focusKey)
  useEffect(() => {
    if (!focusRow || focusOpened.current === focusPull.nonce) return
    focusOpened.current = focusPull.nonce
    setOpened(focusKey)
    task?.open('task:detail')
  }, [focusRow, focusKey, focusPull?.nonce])
  // A run link opens that run's detail once runs are read, under the same lease.
  const runFocusId = focusRun?.runId && conn.state === 'connected' && focusRun.repo?.toLowerCase() === repo.toLowerCase() ? focusRun.runId : ''
  runFocusRef.current = runFocusId ? focusRun : null
  // The lease brings its exact read; it is kept and refreshed only while held.
  // An exact read lands only on the lease (nonce) it was issued for.
  useEffect(() => { setLinked(runFocusId && focusRun?.run?.id === runFocusId ? focusRun.run : null) }, [runFocusId, focusRun?.nonce])
  // The linked run is read again with each new copy of the runs (the hub's cadence).
  useEffect(() => { if (conn.state === 'connected' && runFocusId) void readLinked(runs) }, [runs, runFocusId, focusRun?.nonce, conn.state, readLinked])
  const runOpened = useRef('')
  const runPresent = !!runFocusId && (runs.some(run => run.id === runFocusId) || linked?.id === runFocusId)
  useEffect(() => {
    if (!runPresent || runOpened.current === focusRun.nonce) return
    runOpened.current = focusRun.nonce
    task?.open(`task:run:${runFocusId}`)
  }, [runPresent, runFocusId, focusRun?.nonce])
  const runDetailOpen = !!runFocusId && runOpened.current === focusRun?.nonce && task?.activeId === `task:run:${runFocusId}`
  // The PR lease is held while the owner works on that PR: its detail, or a
  // review, assignment or run pane anchored to its row. Releasing earlier
  // would drop a later-page PR's row, and the pane rendered inside it.
  const activeRunId = task?.activeId?.startsWith('task:run:') ? task.activeId.slice('task:run:'.length) : ''
  const activeRun = activeRunId ? runs.find(run => run.id === activeRunId) || (linked?.id === activeRunId ? linked : null) : null
  const focusWorking = !!focusKey && focusOpened.current === focusPull?.nonce && (
    (task?.activeId === 'task:detail' && opened === focusKey)
    || (task?.activeId === 'task:review' && choice?.anchor === focusKey)
    || (task?.activeId === 'task:assign' && assigning?.anchor === focusKey)
    || (activeRun && runAnchor(activeRun) === focusKey))
  const connected = conn.state === 'connected'
  const linkedHere = focusPull && focusPull.repo?.toLowerCase() === repo.toLowerCase() ? focusPull.nonce : ''
  useFocusLease({ nonce: linkedHere, held: focusWorking, connected, release: onFocusRelease })
  // A run link's lease is held while that run's detail is open.
  const runLinkedHere = focusRun?.runId && focusRun.repo?.toLowerCase() === repo.toLowerCase() ? focusRun.nonce : ''
  useFocusLease({ nonce: runLinkedHere, held: runDetailOpen, connected, release: onFocusRelease })
  const requestedKeys = new Set((project?.reviewRequests || []).map(prKey))
  const scoped = scope === 'requests'
    ? pulls.filter(pr => requestedKeys.has(prKey(pr)) || prKey(pr) === focusKey)
    : matchingPulls(pulls, filter, conn.login)
  const visible = scope === 'mine' ? [] : scoped.filter(pr => !query.trim() || `${pr.number} ${pr.title} ${pr.author?.login || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  // The All PRs tab shows this count; a chat link to a PR always lands on All PRs.
  const openTotal = data.loading && !pulls.length ? null : data.hasNextPage ? data.total || pulls.length : pulls.filter(isOpenPull).length
  useEffect(() => { onTotal?.(openTotal) }, [openTotal, onTotal])
  useEffect(() => { if (focusKey && scope !== 'all') onScope?.('all') }, [focusKey, focusPull?.nonce])
  const selectableVisible = visible.filter(isOpenPull)
  const selection = pulls.filter(pr => isOpenPull(pr) && selected.has(prKey(pr)))
  const detailVisible = visible.some(pr => prKey(pr) === opened)
  const focusRead = focusError && focusError.key === focusKey && focusError.nonce === focusPull?.nonce
    && focusError.issued >= (view.rows.get(focusKey)?.generation ?? -Infinity) ? focusError : null
  useEffect(() => {
    // Inline detail belongs to its visible row. When filtering or a successful
    // refresh removes that row, retire the task as well as its local identity;
    // clearing the filter must not silently reopen an orphaned action.
    if (task?.activeId === 'task:detail' && opened && !detailVisible) {
      setOpened('')
      task.close()
    }
  }, [opened, detailVisible, task?.activeId, task?.close])
  if (conn.state !== 'connected' || !project || !repo) return null
  // A linked run is shown from its exact read while its lease is held, even
  // when it is older than the capped recent list; a refresh cannot evict it.
  const linkedRun = runFocusId && linked?.id === runFocusId && !runs.some(run => run.id === runFocusId) ? [linked] : []
  const relevantRuns = [...linkedRun, ...runs].filter(run => !repo || run.items?.some(item => item.repo.toLowerCase() === repo.toLowerCase()))
  const statusFor = pr => reviewForPull(relevantRuns, pr)
  // Where each PR stands and what may happen next: the PR machine's decision.
  const standingOf = pr => standingFor({ pr, login: conn.login, runs: relevantRuns, chats: respondChats, ignored: ignoredReviews })
  const detailPr = pulls.find(pr => prKey(pr) === opened)
  function inspect(pr) {
    // While a review runs, the frame on the row is the signal; opening it lands on the Review tab.
    if (onOpenPage) { onOpenPage(pr, frameOf(standingOf(pr)) === 'reviewing' ? 'review' : 'conversation'); return }
    setOpened(prKey(pr))
    task?.open('task:detail')
  }
  // A launch or assignment opened from one PR stays beside that PR; a batch
  // opens under the list header. `anchor` is only placement, never scope.
  function choose(pulls, job, anchor = '') {
    if (job === 'respond') { setAssigning(null); setAddressing({ pr: { ...pulls[0], repository: { ...pulls[0].repository } }, findings: savedFindings(statusFor(pulls[0]), ignoredReviews) }); return }
    if (YOUR_INTENTS.has(job)) { setAssigning(null); setActing({ intent: job, pr: { ...pulls[0], repository: { ...pulls[0].repository } }, record: recordsForPull(records, pulls[0])[0] }); return }
    const { mode, intent, options } = reviewIntent(job)
    setResolved(null)
    task?.open('task:review')
    setAssigning(null)
    setChoice({ pulls: pulls.map(pr => ({ ...pr, repository: { ...pr.repository } })), mode, intent, ...(options ? { options } : {}), ...(defaultAgent?.model ? { agent: defaultAgent } : {}), anchor, ...scopeFor(mode), request_id: crypto.randomUUID() })
    setError('')
  }
  async function start() {
    setBusy(true); setError('')
    try {
      if (!resolved) throw new Error('The selected workflow is still being checked. Try again shortly.')
      const pulls = await liveSelection(token, choice.pulls)
      const result = await collaborationRequest(token, appId, 'review-runs', reviewRunRequest({ ...choice, pulls, options:resolved.options, agent:resolved.agent, preview_sha256:resolved.preview.preview_sha256 }))
      onRunPatched?.(result.run)
      void onRunsChanged?.()
      setChoice(null); setSelected(new Set())
    } catch (error) {
      setError(error.message)
      if (error.code === 'changed') void load()
    }
    finally { setBusy(false) }
  }
  // One owner action on a run: ask the platform, then show the run it returns
  // instead of any older read. Null when it failed (the error is shown).
  async function runAction(run, action, body = {}) {
    if (busy) return null
    setBusy(true); setOwnRunError('')
    linkedEpoch.current++ // a linked read issued before the action cannot land after it
    try {
      const result = await collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}/${action}`, body)
      linkedEpoch.current++
      if (linkedRef.current?.id === run.id) setLinked(result.run)
      onRunPatched?.(result.run)
      void onRunsChanged?.()
      return result
    } catch (error) { setOwnRunError(error.message); return null }
    finally { setBusy(false) }
  }
  const stopRun = run => runAction(run, 'stop')
  // Read-only: asks GitHub again whether a public action it never confirmed is there.
  const checkRun = run => runAction(run, 'observe')
  // The owner's own submit or discard of one proposed verdict. The server
  // posts exactly the saved proposal, once; an agent can never do this.
  async function decideVerdict(run, item, proposal, decision, extra = {}) {
    const result = await runAction(run, 'verdict', { repo: item.repo, number: item.number, head_sha: item.head_sha, proposal_id: proposal.id, decision, ...extra })
    if (result?.verdict?.state === 'posted') onReviewPosted?.(item.repo, item.number)
    if (result?.merge_resumed === false) setOwnRunError('Approved on GitHub. Open the review chat and ask it to continue to the merge.')
  }
  // The owner's own Push or Don't push for fixes an agent prepared. The platform pushes exactly
  // that commit, once, and only if the branch has not moved; the agent never pushes by itself.
  const decideRepair = (run, item, attempt, decision) => runAction(run, 'repairs/decision', { repo: item.repo, number: item.number, head_sha: item.head_sha, attempt_id: attempt.id, decision })
  function toggle(pr) {
    setSelected(old => { const next = new Set(old); const key = prKey(pr); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function assignSelection(pulls = selection, anchor = '') {
    setChoice(null)
    setAssigning(Object.assign(pulls.map(pr => ({ ...pr, repository: { ...pr.repository } })), { anchor }))
    task?.open('task:assign')
  }
  // A stopped or failed run can be started again on the PRs' current versions;
  // the new launch is a fresh consent with its own model choice.
  // A retry reopens the same job by its machine name, so its window reads right for whose PR it is.
  const RETRY_JOBS = { author: { review_fix_merge: 'finish_it' }, reviewer: { review_fix_merge: 'take_over' } }
  const retryJob = (run, pr) => RETRY_JOBS[standingOf(pr).role]?.[run.mode] || (standingOf(pr).role === 'author' ? 'check_my_pr' : 'review')
  const retryPulls = run => (run.items || []).map(item => pulls.find(pr => prKey(pr) === `${item.repo.toLowerCase()}#${item.number}`)).filter(pr => pr && isOpenPull(pr))
  // What a PR's Review tab needs: the run's own actions and whether you wrote the PR.
  const reviewProps = pr => {
    const run = statusFor(pr)?.run
    return {
      own: isOwnPull(pr, conn.login), standing: standingOf(pr), earlier: run ? null : earlierReviewForPull(relevantRuns, pr), busy, error: runError, pulls, listState: data,
      ignored: ignoredReviews,
      canPost: capabilities?.post_findings_now === true,
      onPost: ({ run: postRun, item }) => setPosting({ pr, run: postRun, item, own: isOwnPull(pr, conn.login) }),
      onStart: job => choose([pr], job, prKey(pr)),
      onFix: onStartAgent ? () => choose([pr], 'respond', prKey(pr)) : undefined,
      onIgnore: onIgnoreReview ? item => setIgnoring({ pr, item }) : undefined,
      onUndoIgnore: onUndoIgnore || undefined,
      onStop: run ? () => stopRun(run) : undefined,
      onRetry: run ? () => choose(retryPulls(run), retryJob(run, pr), runAnchor(run)) : undefined,
      onVerdict: run ? (item, proposal, decision, extra) => decideVerdict(run, item, proposal, decision, extra) : undefined,
      onRepair: run && capabilities?.push_approval === true ? (item, attempt, decision) => decideRepair(run, item, attempt, decision) : undefined,
      onCheck: run && !runDetailsElsewhere(run) ? () => checkRun(run) : undefined,
    }
  }
  const runPane = run => <TaskPane key={run.id} dock={false} id={`task:run:${run.id}`}>
      <RunDetail run={run} pulls={pulls} listState={data} busy={busy} error={runError}
        onStop={() => stopRun(run)} onVerdict={(item, proposal, decision, extra) => decideVerdict(run, item, proposal, decision, extra)} onRepair={capabilities?.push_approval === true ? (item, attempt, decision) => decideRepair(run, item, attempt, decision) : null} onCheck={() => checkRun(run)} retryPulls={retryPulls(run)} onRetry={retry => choose(retry, retry[0] ? retryJob(run, retry[0]) : 'review', runAnchor(run))}
        updater={projectUpdater(project)} />
    </TaskPane>
  const closeReview = () => { setChoice(null); task?.close() }
  const reviewDialog = task?.activeId === 'task:review' && choice ? <ReviewDialog onClose={closeReview}><ReviewConfirmation appId={appId} token={token} ownLogin={conn.login} defaultAgent={defaultAgent} bindCurrentTarget onResolved={value => { setResolved(value); if (value?.capabilities) setCapabilities(value.capabilities) }} disabled={!resolved} onOptionsChange={options => { setResolved(null); setChoice(old => ({ ...old, options, request_id:crypto.randomUUID() })) }} onAgentChange={agent => { setResolved(null); setChoice(old => ({ ...old, agent, request_id:crypto.randomUUID() })) }} choice={choice} busy={busy} error={error} onConfirm={start} onCancel={closeReview} onModeChange={mode => { setError(''); setResolved(null); setChoice(old => ({ ...old, mode, confirmation_scope: undefined, ...scopeFor(mode), request_id: crypto.randomUUID() })) }} onReasonChange={takeover_reason => setChoice(old => ({ ...old, takeover_reason }))} capabilities={capabilities} /></ReviewDialog> : null
  const addressDialog = addressing && onStartAgent ? <ReviewDialog onClose={() => setAddressing(null)}><AddressFeedbackWindow pr={addressing.pr} findings={addressing.findings} token={token} appId={appId} defaultAgent={defaultAgent} onStart={onStartAgent} onClose={() => setAddressing(null)} /></ReviewDialog> : null
  const closeIgnore = () => setIgnoring(null)
  // A posted review changes what the run shows (a link to it, and whose turn it is), so the runs are read again.
  const refreshRuns = () => onRunsChanged?.()
  const closePost = () => setPosting(null)
  // The posted findings are a review of the PR, which answers a request for it.
  const findingsPosted = outcome => {
    void refreshRuns()
    if (outcome?.ok) onReviewPosted?.(posting.pr.repository.nameWithOwner, posting.pr.number)
  }
  const postDialog = posting ? <ReviewDialog onClose={closePost}><PostFindings pr={posting.pr} run={posting.run} item={posting.item} own={posting.own} token={token} appId={appId} onDone={findingsPosted} onClose={closePost} /></ReviewDialog> : null
  const ignoreDialog = ignoring ? <ReviewDialog onClose={closeIgnore}><IgnoreReview pr={ignoring.pr} onPick={reason => { onIgnoreReview(ignoring.item, reason); closeIgnore() }} onClose={closeIgnore} /></ReviewDialog> : null
  // Each of your own actions runs the app's one guarded handler for it.
  const actionHandlers = {
    // A draft this app sent is marked ready through its saved record; any other draft of yours, by the platform's own action.
    open_for_review: ({ pr, record }) => isPersonalDraft(record) ? (onOpenForReview ? onOpenForReview(record) : { error: 'Opening for review is not available here.' }) : pullAction(token, appId, pr, 'ready'),
    merge: ({ pr, choice }) => mergePull(token, appId, pr, { method: methodToSend(pr.repository, choice) }),
    back_to_draft: ({ pr }) => pullAction(token, appId, pr, 'draft'),
    close: ({ pr }) => pullAction(token, appId, pr, 'close'),
    ask_rereview: ({ pr }) => pullAction(token, appId, pr, 'request-reviewers', { reviewers: standingOf(pr).rereviewFrom }),
  }
  const closeAction = () => setActing(null)
  // A merge changes the list (the PR leaves it), so it reads again once done.
  const actionDialog = acting ? <ReviewDialog onClose={closeAction}><ActionConfirm pr={acting.pr} copy={ACTION_COPY[acting.intent](acting.pr, { status: statusFor(acting.pr), ignored: ignoredReviews, standing: standingOf(acting.pr) })} onConfirm={({ choice }) => actionHandlers[acting.intent]({ ...acting, choice })} onDone={() => { if (acting.intent !== 'open_for_review' || !isPersonalDraft(acting.record)) { void load(); void onChanged?.() } }} onClose={closeAction} /></ReviewDialog> : null
  const assignPane = <TaskPane id="task:assign" dock={false}>{assigning ? <AssigneePicker key={assigning.map(prKey).join(',')} pulls={assigning} appId={appId} token={token} ownLogin={conn.login} onClose={() => { setAssigning(null); task?.close() }} onAssigned={(login, keys) => {
      viewRef.current = acknowledgeAssignment(viewRef.current, keys, login, ++generation.current)
      setView(viewRef.current)
      sessionRef.current.view = viewRef.current
      sessionRef.current.generation = generation.current
      void onChanged?.()
    }} /> : null}</TaskPane>
  const visibleKeys = new Set(visible.map(prKey))
  const openRun = run => task?.open(`task:run:${run.id}`)
  // Saved reviews compare with the loaded PRs, so a failed read shows on every tab.
  const loadError = data.error ? <div className="co-alert" role="alert"><strong>Couldn’t load pull requests</strong><p className="co-alert-text">{data.error}</p><button className="co-btn" disabled={data.loading} onClick={() => { void load(); void onRunsChanged?.() }}>Try again</button></div> : null
  if (scope === 'edits') return null
  if (scope === 'mine') return <section className="co-public-work is-mine" aria-label="Agent reviews">
    {runError ? <p className="co-pr-note" role="status">Agent progress unavailable: {runError}</p> : null}
    {loadError}
    {relevantRuns.map(runPane)}
    {reviewDialog}
    {addressDialog}
    {actionDialog}
    {ignoreDialog}
    {postDialog}
    <AgentReviewHistory runs={relevantRuns} pulls={pulls} listState={data} onOpen={openRun} />
  </section>
  if (presentation === 'page') {
    return <section className="co-public-work is-page" aria-label="Pull request">
      {focusRead ? <p className="co-pr-note" role="alert">Could not read that pull request: {focusRead.message}</p> : null}
      {runError ? <p className="co-pr-note" role="status">Agent progress unavailable: {runError}</p> : null}
      {loadError}
      {assignPane}
      {/* The saved agent-review record never leads the page: its outcome shows
          as the flag under the description, and My work keeps the full run. */}
      {detailPr ? (
        // The detail is the page itself, not a swappable pane: the review
        // window overlays it and the assignment pane opens above it.
        <PullRequestDetail key={`${prKey(detailPr)}:${detailPr.headRefOid}:${detailPr.baseRefOid}:${detailRevision}`} cacheStore={detailSnapshot(detailPr)} pr={detailPr} token={token} initialTab={focusPull?.tab === 'review' ? 'review' : 'conversation'} review={reviewProps(detailPr)} onReview={mode => choose([detailPr], mode, opened || prKey(detailPr))} onAssign={() => assignSelection([detailPr], opened || prKey(detailPr))} onRefresh={() => load()} readOnly={!isOpenPull(detailPr)} canAssign={mayAssign(detailPr.repository.viewerPermission)} status={statusFor(detailPr)} onProgress={null} record={recordsForPull(records, detailPr)[0]} capabilities={capabilities} onRecord={onRecord} provenance={pullConversations(records, relevantRuns, detailPr)} holdUntilLoaded />
      ) : data.loading || data.error || focusKey ? <Skeleton lines={8} label="Loading the pull request" /> : <p className="co-pr-note" role="status">This pull request is not in the open list. It may be closed. {NAMES.sync} to check.</p>}
      {/* A desk row's Fix these findings opens the PR straight into its fix window. */}
      {focusPull?.intent === 'fix' && onStartAgent ? <RunOnce ready={!!detailPr} nonce={focusPull.nonce} run={() => choose([detailPr], 'respond', prKey(detailPr))} /> : null}
      {reviewDialog}
    {addressDialog}
    {actionDialog}
    {ignoreDialog}
    {postDialog}
    </section>
  }
  const assignAnchor = assigning?.anchor && visibleKeys.has(assigning.anchor) ? assigning.anchor : ''
  return <section className="co-public-work" aria-label="Pull requests">
    <div className={'co-pr-list-controls' + (searchOpen ? ' is-searching' : '')}>
      <SearchField className="co-pr-search" label="Find a pull request" placeholder="Search pull requests" value={query} onChange={setQuery} inputRef={searchField} />
      <button type="button" className="co-btn co-btn-quiet co-btn-icon co-pr-search-toggle" aria-label={query ? `Search PRs: ${query}` : 'Search pull requests'} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Icon name="search" size={18} /></button>
    </div>
    {scope === 'all' ? <div className="co-pr-filters" role="group" aria-label="Filter pull requests">{FILTERS.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{key !== 'all' && !data.hasNextPage && !data.loading ? <span className="co-pr-filter-count">{matchingPulls(pulls.filter(isOpenPull), key, conn.login).length}</span> : null}</button>)}</div> : null}
    {scope === 'requests' ? <p className="co-pr-intro">PRs where someone asked for your review. Start an agent review, or open the PR yourself.</p> : null}
    {selectionNotice ? <p className="co-pr-note" role="status">{selectionNotice}</p> : null}
    {focusRead ? <p className="co-pr-note" role="alert">Could not read that pull request: {focusRead.message}{focusRow ? ' Showing the previous snapshot.' : ''}</p> : null}
    {runError ? <p className="co-pr-note" role="status">Agent progress unavailable: {runError}</p> : null}
    {loadError}
    <div className={'co-pr-box' + (selection.length ? ' has-selection' : '')}>
    <SelectionTray selection={selection} decisions={selection.map(standingOf)} visible={selectableVisible} shown={data.hasNextPage ? data.total || visible.length : visible.length} loading={data.loading} busy={busy} onClear={() => setSelected(new Set())} onSelectVisible={() => setSelected(old => { const next = new Set(old); const all = selectableVisible.every(pr => next.has(prKey(pr))); selectableVisible.forEach(pr => all ? next.delete(prKey(pr)) : next.add(prKey(pr))); return next })} onReview={choose} onAssign={() => assignSelection()} />
    {!assignAnchor ? assignPane : null}
    {relevantRuns.filter(run => !visibleKeys.has(runAnchor(run))).map(runPane)}
    {data.loading && !pulls.length ? <div className="co-pr-skel" role="status" aria-label="Loading pull requests">{[3, 2, 3].map((lines, index) => <Skeleton key={index} lines={lines} label="" />)}</div> : null}
    {!data.loading && !data.error && !visible.length ? <EmptyPulls scope={scope} filter={filter} query={query} hasNextPage={data.hasNextPage} waiting={requestedKeys.size} /> : null}
    <div className="co-pr-list">{visible.map(pr => {
      const key = prKey(pr)
      const status = statusFor(pr)
      const standing = standingOf(pr)
      const review = { frame: frameOf(standing), chip: chipOf(standing) }
      const assignees = pr.assignees?.nodes || []
      const comments = conversationCount(pr)
      const open = isOpenPull(pr)
      return <ReviewFrame key={key} state={review.frame} inset={4} radius={10}><article className={'co-pr-row' + (selected.has(key) ? ' is-selected' : '') + (focusKey === key ? ' is-highlighted' : '') + (assignAnchor === key && task?.activeId === 'task:assign' ? ' is-assigning' : '')} data-pr={key}>
        <label className="co-pr-select"><input type="checkbox" checked={open && selected.has(key)} disabled={!open} onChange={() => toggle(pr)} aria-label={`Select ${pr.repository.nameWithOwner} #${pr.number}`} /></label>
        <PullStateIcon pr={pr} />
        <div className="co-pr-content">
          <div className="co-pr-headline">
            <button className="co-pr-open" aria-expanded={task?.activeId === 'task:detail' && opened === key} onClick={() => {
              if (window.getSelection?.()?.toString().trim()) return
              inspect(pr)
            }}>
              <span className="co-pr-title">{pr.title}</span>
            </button>
          </div>
          <div className="co-pr-meta">
            <span>#{pr.number} · {pr.author?.login || 'Contributor'} <TimeAgo prefix="opened " value={pr.createdAt} /></span>
            <ChecksBadge pr={pr} />
            {Number.isInteger(pr.additions) ? <span className="co-change-total"><b>+{pr.additions}</b><em>−{pr.deletions}</em></span> : null}
          </div>
          <div className="co-pr-labels"><PullLabels pr={pr} /></div>
          <div className="co-row-pills">
            <PullStateChips pr={pr} />
            {requestedKeys.has(key) ? <span className="co-pr-requested">Your review requested</span> : null}
            {review.chip ? <button className={'co-pr-agent-state' + CHIP_TONE_CLASS[review.chip.tone]} onClick={() => status && !onOpenPage ? task?.open(`task:run:${status.run.id}`) : onOpenPage ? onOpenPage(pr, 'review') : inspect(pr)}><Icon name="prepare" size={13} />{review.chip.label}</button> : null}
          </div>
        </div>
        <div className="co-pr-aside">
          {comments ? <span className="co-pr-comments" title={`${comments} in the conversation: comments and reviews`}><Icon name="comment" size={16} />{comments}</span> : null}
          {open && mayAssign(pr.repository.viewerPermission)
            ? <button className={'co-btn co-btn-quiet co-pr-assign' + (assignees.length ? '' : ' is-quiet')} onClick={() => assignSelection([pr], key)} aria-label={assignees.length ? `Assigned to ${assignees.map(user => user.login).join(', ')}. Change assignment for PR ${pr.number}` : `Assign PR ${pr.number}`} title={assignees.length ? assignees.map(user => user.login).join(', ') : undefined}>{assignees.length ? <span className="co-gh-avatars">{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : <><Icon name="person" size={15} /><span>Assign</span></>}</button>
            : assignees.length ? <span className="co-gh-avatars" title={assignees.map(user => user.login).join(', ')}>{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : null}
          {open ? <ActionsMenu pulls={[pr]} decisions={[standing]} record={recordsForPull(records, pr)[0]} capabilities={capabilities} disabled={busy} onChoose={mode => choose([pr], mode, key)} ariaLabel={`Choose an action for PR ${pr.number}`} /> : null}
        </div>
        {assignAnchor === key ? assignPane : null}
        {relevantRuns.filter(run => runAnchor(run) === key).map(runPane)}
        {opened === key ? <TaskPane id="task:detail" dock={false}>{detailPr ? <PullRequestDetail key={`${prKey(detailPr)}:${detailPr.headRefOid}:${detailPr.baseRefOid}:${detailRevision}`} cacheStore={detailSnapshot(detailPr)} pr={detailPr} token={token} review={reviewProps(detailPr)} onReview={mode => choose([detailPr], mode, key)} onAssign={() => assignSelection([detailPr], key)} onRefresh={() => load()} readOnly={!isOpenPull(detailPr)} canAssign={mayAssign(detailPr.repository.viewerPermission)} status={statusFor(detailPr)} onProgress={() => task?.open(`task:run:${statusFor(detailPr)?.run.id}`)} record={recordsForPull(records, detailPr)[0]} capabilities={capabilities} onRecord={onRecord} provenance={pullConversations(records, relevantRuns, detailPr)} /> : <p>This pull request is no longer in the current list. Refresh to see its latest status.</p>}</TaskPane> : null}
      </article></ReviewFrame>
    })}</div>
    </div>
    {data.hasNextPage ? <button className="co-btn" disabled={data.loading} onClick={() => load(data.endCursor)}>Load more PRs</button> : null}
    {reviewDialog}
    {addressDialog}
    {actionDialog}
    {ignoreDialog}
    {postDialog}
  </section>
}
