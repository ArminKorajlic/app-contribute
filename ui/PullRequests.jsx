import { useCallback, useEffect, useRef, useState } from 'react'
import { awaitsGithub, OWNER_ITEM_STATES, collaborationRequest, discoverPull, discoverPulls, liveSelection, loadReviewRuns, matchingPulls, mayAssign, mergeSelection, prKey, reviewForPull, reviewItemProgress, reviewRunRequest, reviewRunTitle, runDetailsElsewhere, notOursToObserve, assignPulls, takeoverScope } from '../collaboration.js'
import { acknowledgeAssignment, emptyPullView, invalidatedSelection, isOpenPull, observePulls, pullsInView } from '../pull-view.js'
import { pullConversations, recordsForPull } from '../provenance.js'
import { RunDetail, savedVersion } from './RunDetail.jsx'
import { PullRequestDetail } from './PullRequestDetail.jsx'
import { Avatar, ChecksBadge, GithubLabel, PullStateIcon, REVIEW_DECISION, TimeAgo } from './GithubParts.jsx'
import { TaskPane, useProjectTask, focusActionRegion } from './TaskPane.jsx'
import { useFocusLease } from './useFocusLease.js'
import { Icon } from './Icons.jsx'
import { AgentMenu } from './AgentMenu.jsx'
import { ReviewDialog } from './ReviewDialog.jsx'
import { ReviewConfirmation } from './ReviewConfirmation.jsx'
import { projectUpdater } from '../updates.js'

// One draft-scope decision for the chooser, its copy and the start body.
const scopeFor = (mode, pulls) => mode === 'review_fix_merge' ? { confirmation_scope: takeoverScope(pulls) } : {}

const FILTERS = [['all', 'Show: all'], ['unassigned', 'Show: unassigned'], ['assigned', 'Show: assigned'], ['authored', 'Show: opened by me']]

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
  const kind = filter === 'unassigned' ? 'unassigned ' : filter === 'assigned' ? 'assigned ' : ''
  const hint = hasNextPage ? 'Load more to search the remaining results.' : filter === 'all' ? 'When work is shared on GitHub, it appears here.' : 'Choose Show: all to see the project’s other pull requests.'
  return <div className="co-pr-empty"><strong>No {kind}pull requests{query ? ' match' : ''}</strong><p>{hint}</p></div>
}

// GitHub-style list header: the count when nothing is selected, bulk actions
// once something is. Selection never moves focus or interrupts browsing.
function SelectionTray({ selection, busy, onClear, onReview, onAssign, visible, shown = visible.length, loading = false, onSelectVisible }) {
  const selected = selection.length
  const allVisible = visible.length > 0 && visible.every(pr => selection.some(item => prKey(item) === prKey(pr)))
  return <div className="co-pr-box-head" role="group" aria-label="Pull request actions">
    <label className="co-pr-select"><input type="checkbox" checked={allVisible} onChange={onSelectVisible} aria-label="Select all visible pull requests" /></label>
    <strong className="co-pr-box-count">{selected ? `${selected} selected` : <><Icon name="pull" size={16} />{loading && !shown ? 'Open pull requests' : `${shown} open`}</>}</strong>
    {selected ? <div className="co-pr-box-actions">
      <button className="co-btn" disabled={busy || selected > 20 || !selection.every(pr => mayAssign(pr.repository.viewerPermission))} onClick={onAssign} aria-label="Assign selected PRs to a person"><Icon name="person" size={16} /><span>Assign</span></button>
      <AgentMenu variant="button" disabled={selected > 20 || busy} onChoose={mode => onReview(selection, mode)} ariaLabel="Choose what an agent does with the selected PRs" />
      <button className="co-quiet-action" aria-label="Clear selection" onClick={onClear}><Icon name="close" size={16} /></button>
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
    <input type="search" className="co-person-search" aria-label="Find a person" placeholder="Find a person…" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
    {people.loading ? <p role="status">Loading people…</p> : null}
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

// `focusPull` is a navigation lease from a chat link: while it is held, that
// exact PR stays in view (even when closed or on a later page) and its detail
// is open. Leaving the detail or the project hands the lease back.
// A run opens beside its PR when it covers one; batches open under the header.
const runAnchor = run => run.items?.length === 1 ? `${run.items[0].repo.toLowerCase()}#${run.items[0].number}` : ''

// `scope` follows the project tabs: 'all' (every open PR), 'requests' (PRs that
// ask for the owner's review) or 'mine' (the saved agent reviews only).
export function PullRequests({ appId, token, project, conn, onChanged, records = [], onRecord, refreshKey, focusPull, focusRun, onFocusRelease, scope = 'all', onScope, onTotal }) {
  const repo = project?.canonical_repo || ''
  const task = useProjectTask()
  const [data, setData] = useState({ loading: true, error: '' })
  const [view, setView] = useState(emptyPullView)
  const viewRef = useRef(view)
  const generation = useRef(0)
  const focusKey = focusPull && conn.state === 'connected' && focusPull.repo?.toLowerCase() === repo.toLowerCase()
    ? `${focusPull.repo.toLowerCase()}#${focusPull.number}` : ''
  const focusRef = useRef(null)
  focusRef.current = focusKey ? { key: focusKey, nonce: focusPull.nonce, repo: focusPull.repo, number: focusPull.number } : null
  const [focusError, setFocusError] = useState(null)
  const [runs, setRuns] = useState([])
  const [runError, setRunError] = useState('')
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
  const [choice, setChoice] = useState(null)
  const [resolved, setResolved] = useState(null)
  // The platform's advertised workflows, remembered across launches.
  const [capabilities, setCapabilities] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const detailSnapshots = useRef(new Map())
  const [detailRevision, setDetailRevision] = useState(0)
  function detailSnapshot(pr) {
    const key = `${prKey(pr)}:${pr.headRefOid}:${pr.baseRefOid}:${pr.baseRefName}`
    if (!detailSnapshots.current.has(key)) detailSnapshots.current.set(key, { entries:{}, stale:false })
    return detailSnapshots.current.get(key)
  }
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current += 1 } }, [])
  // Both readers publish through here, so selection follows the same winner.
  const publish = useCallback((pulls, issued, inventory, announce) => {
    const before = viewRef.current, pinned = focusRef.current?.key || ''
    const next = observePulls(before, pulls, issued, { inventory, pinned })
    viewRef.current = next
    setView(next)
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
      if (!cursor) { detailSnapshots.current.clear(); setDetailRevision(value => value + 1) }
      const inventory = cursor ? [...new Set([...viewRef.current.inventory, ...next.pulls.map(prKey)])] : next.pulls.map(prKey)
      publish(next.pulls, issued, inventory, !cursor)
      setData({ total: next.total, hasNextPage: next.hasNextPage, endCursor: next.endCursor, loading: false, error: '' })
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
  // One ordering boundary for every run observation: a read applies only if
  // nothing newer was issued or confirmed since it began. A Stop, a newer
  // read advances it, and exact reads also match their lease nonce, so an older response can never
  // overwrite a confirmed newer state.
  const runsEpoch = useRef(0)
  const loadRuns = useCallback(async () => {
    const epoch = ++runsEpoch.current
    const current = () => alive.current && runsEpoch.current === epoch
    let list
    try {
      const show = next => { if (current()) { setRuns(next.runs || []); setRunError('') } }
      list = await loadReviewRuns(token, appId, { onList: show })
      show(list)
    } catch (error) { if (current()) setRunError(error.message); return }
    const focus = runFocusRef.current
    if (!current() || !focus || (list.runs || []).some(run => run.id === focus.runId)) return
    const path = `review-runs/${encodeURIComponent(focus.runId)}`
    try {
      if (linkedRef.current && !runDetailsElsewhere(linkedRef.current) && awaitsGithub(linkedRef.current)) {
        // A run the core owns is reconciled there; its refusal is not an error.
        try { await collaborationRequest(token, appId, `${path}/observe`, {}) }
        catch (error) { if (!notOursToObserve(error)) throw error }
      }
      const exact = (await collaborationRequest(token, appId, path)).run
      if (current() && runFocusRef.current?.nonce === focus.nonce && exact) setLinked(exact)
    } catch (error) { if (current()) setRunError(`This run's latest status is unavailable: ${error.message}`) }
  }, [token, appId])
  const publicRevision = records.filter(record => record.url).map(record => `${record.id}:${record.status}:${record.number}:${record.last_updated_pr_at || ''}`).sort().join('|')
  useEffect(() => {
    if (conn.state !== 'connected') return
    void load(); void loadRuns()
    const refresh = () => { if (!document.hidden) void loadRuns() }
    const timer = setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [conn.state, publicRevision, refreshKey, load, loadRuns])
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
  const detailPr = pulls.find(pr => prKey(pr) === opened)
  function inspect(pr) { setOpened(prKey(pr)); task?.open('task:detail') }
  // A launch or assignment opened from one PR stays beside that PR; a batch
  // opens under the list header. `anchor` is only placement, never scope.
  function choose(pulls, mode, anchor = '') {
    setResolved(null)
    task?.open('task:review')
    setAssigning(null)
    setChoice({ pulls: pulls.map(pr => ({ ...pr, repository: { ...pr.repository } })), mode, anchor, ...scopeFor(mode, pulls), request_id: crypto.randomUUID() })
    setError('')
  }
  async function start() {
    setBusy(true); setError('')
    try {
      if (!resolved) throw new Error('The selected workflow is still being checked. Try again shortly.')
      const pulls = await liveSelection(token, choice.pulls)
      const result = await collaborationRequest(token, appId, 'review-runs', reviewRunRequest({ ...choice, pulls, options:resolved.options, agent:resolved.agent, preview_sha256:resolved.preview.preview_sha256 }))
      setRuns(old => [result.run, ...old.filter(run => run.id !== result.run.id)])
      setChoice(null); setSelected(new Set())
      task?.open(`task:run:${result.run.id}`)
    } catch (error) {
      setError(error.message)
      if (error.code === 'changed') void load()
    }
    finally { setBusy(false) }
  }
  async function stopRun(run) {
    if (busy) return
    setBusy(true); setRunError('')
    runsEpoch.current++ // reads issued before Stop cannot land after it
    try {
      const result=await collaborationRequest(token,appId,`review-runs/${encodeURIComponent(run.id)}/stop`,{})
      runsEpoch.current++
      if (linkedRef.current?.id === run.id) setLinked(result.run)
      setRuns(old=>old.map(item=>item.id===run.id ? result.run : item))
    } catch(error) {setRunError(error.message)}
    finally {setBusy(false)}
  }
  // The owner's own submit or discard of one proposed verdict. The server
  // posts exactly the saved proposal, once; an agent can never do this.
  async function decideVerdict(run, item, proposal, decision) {
    if (busy) return
    setBusy(true); setRunError('')
    runsEpoch.current++
    try {
      const result = await collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}/verdict`,
        { repo: item.repo, number: item.number, head_sha: item.head_sha, proposal_id: proposal.id, decision })
      runsEpoch.current++
      if (linkedRef.current?.id === run.id) setLinked(result.run)
      setRuns(old => old.map(entry => entry.id === run.id ? result.run : entry))
      if (result.merge_resumed === false) setRunError('Approved on GitHub. Open the review conversation and ask it to continue to the merge.')
    } catch (error) { setRunError(error.message) }
    finally { setBusy(false) }
  }
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
  const retryPulls = run => (run.items || []).map(item => pulls.find(pr => prKey(pr) === `${item.repo.toLowerCase()}#${item.number}`)).filter(pr => pr && isOpenPull(pr))
  const runPane = run => <TaskPane key={run.id} dock={false} id={`task:run:${run.id}`}>
      <RunDetail run={run} pulls={pulls} listState={data} busy={busy} error={runError}
        onStop={() => stopRun(run)} onVerdict={(item, proposal, decision) => decideVerdict(run, item, proposal, decision)} retryPulls={retryPulls(run)} onRetry={retry => choose(retry, run.mode === 'review_merge' ? 'review' : run.mode, runAnchor(run))}
        updater={projectUpdater(project)} />
    </TaskPane>
  const closeReview = () => { setChoice(null); task?.close() }
  const reviewDialog = task?.activeId === 'task:review' && choice ? <ReviewDialog onClose={closeReview}><ReviewConfirmation appId={appId} token={token} bindCurrentTarget onResolved={value => { setResolved(value); if (value?.capabilities) setCapabilities(value.capabilities) }} disabled={!resolved} onOptionsChange={options => { setResolved(null); setChoice(old => ({ ...old, options, request_id:crypto.randomUUID() })) }} onAgentChange={agent => { setResolved(null); setChoice(old => ({ ...old, agent, request_id:crypto.randomUUID() })) }} choice={choice} busy={busy} error={error} onConfirm={start} onCancel={closeReview} onModeChange={mode => { setError(''); setResolved(null); setChoice(old => ({ ...old, mode, confirmation_scope: undefined, ...scopeFor(mode, old.pulls), request_id: crypto.randomUUID() })) }} capabilities={capabilities} /></ReviewDialog> : null
  const assignPane = <TaskPane id="task:assign" dock={false}>{assigning ? <AssigneePicker key={assigning.map(prKey).join(',')} pulls={assigning} appId={appId} token={token} ownLogin={conn.login} onClose={() => { setAssigning(null); task?.close() }} onAssigned={(login, keys) => {
      viewRef.current = acknowledgeAssignment(viewRef.current, keys, login, ++generation.current)
      setView(viewRef.current)
      void onChanged?.()
    }} /> : null}</TaskPane>
  const visibleKeys = new Set(visible.map(prKey))
  const openRun = run => task?.open(`task:run:${run.id}`)
  // Saved reviews compare with the loaded PRs, so a failed read shows on every tab.
  const loadError = data.error ? <div className="co-alert" role="alert"><strong>Couldn’t load pull requests</strong><p className="co-alert-text">{data.error}</p><button className="co-btn" disabled={data.loading} onClick={() => { void load(); void loadRuns() }}>Try again</button></div> : null
  if (scope === 'mine') return <section className="co-public-work is-mine" aria-label="Agent reviews">
    {runError ? <p className="co-pr-note" role="status">Agent progress unavailable: {runError}</p> : null}
    {loadError}
    {relevantRuns.map(runPane)}
    {reviewDialog}
    <AgentReviewHistory runs={relevantRuns} pulls={pulls} listState={data} onOpen={openRun} />
  </section>
  const assignAnchor = assigning?.anchor && visibleKeys.has(assigning.anchor) ? assigning.anchor : ''
  return <section className="co-public-work" aria-label="Pull requests">
    <div className={'co-pr-list-controls' + (searchOpen ? ' is-searching' : '')}>
      <label className="co-pr-search"><Icon name="search" size={16} /><input ref={searchField} type="search" aria-label="Find a pull request" placeholder="Search pull requests" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" className="co-pr-search-toggle" aria-label={query ? `Search PRs: ${query}` : 'Search pull requests'} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Icon name="search" size={18} /></button>
      {scope === 'all' ? <select className="co-pr-filter-select" aria-label="Filter pull requests" value={filter} onChange={event => setFilter(event.target.value)}>{FILTERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : null}
    </div>
    {scope === 'requests' ? <p className="co-pr-intro">PRs where someone asked for your review. Start an agent review, or open the PR yourself.</p> : null}
    {selectionNotice ? <p className="co-pr-note" role="status">{selectionNotice}</p> : null}
    {focusRead ? <p className="co-pr-note" role="alert">Could not read that pull request: {focusRead.message}{focusRow ? ' Showing the previous snapshot.' : ''}</p> : null}
    {runError ? <p className="co-pr-note" role="status">Agent progress unavailable: {runError}</p> : null}
    {loadError}
    <div className="co-pr-box">
    <SelectionTray selection={selection} visible={selectableVisible} shown={data.hasNextPage ? data.total || visible.length : visible.length} loading={data.loading} busy={busy} onClear={() => setSelected(new Set())} onSelectVisible={() => setSelected(old => { const next = new Set(old); const all = selectableVisible.every(pr => next.has(prKey(pr))); selectableVisible.forEach(pr => all ? next.delete(prKey(pr)) : next.add(prKey(pr))); return next })} onReview={choose} onAssign={() => assignSelection()} />
    {!assignAnchor ? assignPane : null}
    {relevantRuns.filter(run => !visibleKeys.has(runAnchor(run))).map(runPane)}
    {data.loading && !pulls.length ? <p className="co-pr-empty" role="status">Loading pull requests…</p> : null}
    {!data.loading && !data.error && !visible.length ? <EmptyPulls scope={scope} filter={filter} query={query} hasNextPage={data.hasNextPage} waiting={requestedKeys.size} /> : null}
    <div className="co-pr-list">{visible.map(pr => {
      const key = prKey(pr)
      const status = statusFor(pr)
      // A run whose conversation stopped or failed is not still reviewing.
      const progress = status ? reviewItemProgress(status.run, status.item) : null
      const halted = progress?.halted
      const attention = halted || progress?.waiting || (status?.run.chat_id && OWNER_ITEM_STATES.has(status.item.state))
      const assignees = pr.assignees?.nodes || []
      const comments = pr.comments?.totalCount || 0
      const open = isOpenPull(pr)
      return <article className={'co-pr-row' + (selected.has(key) ? ' is-selected' : '') + (focusKey === key ? ' is-highlighted' : '')} key={key} data-pr={key}>
        <label className="co-pr-select"><input type="checkbox" checked={open && selected.has(key)} disabled={!open} onChange={() => toggle(pr)} aria-label={`Select ${pr.repository.nameWithOwner} #${pr.number}`} /></label>
        <PullStateIcon pr={pr} />
        <div className="co-pr-content">
          <button className="co-pr-open" aria-expanded={task?.activeId === 'task:detail' && opened === key} onClick={() => {
            if (window.getSelection?.()?.toString().trim()) return
            inspect(pr)
          }}>
            <span className="co-pr-title">{pr.title}</span>
            {pr.labels?.nodes?.map(label => <GithubLabel key={label.name} name={label.name} color={label.color} />)}
          </button>
          <div className="co-pr-meta">
            <span>#{pr.number} · {pr.author?.login || 'Contributor'} <TimeAgo prefix="opened " value={pr.createdAt} /></span>
            {pr.isDraft ? <span>Draft</span> : null}
            {REVIEW_DECISION[pr.reviewDecision] && pr.reviewDecision !== 'REVIEW_REQUIRED' ? <span>{REVIEW_DECISION[pr.reviewDecision]}</span> : null}
            <ChecksBadge pr={pr} />
            {Number.isInteger(pr.additions) ? <span className="co-change-total"><b>+{pr.additions}</b><em>−{pr.deletions}</em></span> : null}
            {requestedKeys.has(key) ? <span className="co-pr-requested">Your review requested</span> : null}
            {status ? <button className={'co-pr-agent-state' + (attention ? ' needs-you' : '')} onClick={() => task?.open(`task:run:${status.run.id}`)}><Icon name="prepare" size={13} />{halted ? 'Run stopped' : attention ? (['merge_unknown','ready_unknown'].includes(status.item.state) ? 'Check outcome' : 'Needs you') : status.item.state === 'all_clear' && !status.exactBase ? `Reviewed on an older ${pr.baseRefName}` : progress.label}</button> : null}
          </div>
        </div>
        <div className="co-pr-aside">
          {comments ? <span className="co-pr-comments" title={`${comments} ${comments === 1 ? 'comment' : 'comments'}`}><Icon name="comment" size={16} />{comments}</span> : null}
          {open && mayAssign(pr.repository.viewerPermission)
            ? <button className="co-pr-assign" onClick={() => assignSelection([pr], key)} aria-label={assignees.length ? `Assigned to ${assignees.map(user => user.login).join(', ')}. Change assignment for PR ${pr.number}` : `Assign PR ${pr.number}`} title={assignees.length ? assignees.map(user => user.login).join(', ') : undefined}>{assignees.length ? <span className="co-gh-avatars">{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : <><Icon name="person" size={15} /><span>Assign</span></>}</button>
            : assignees.length ? <span className="co-gh-avatars" title={assignees.map(user => user.login).join(', ')}>{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : null}
          {open ? <AgentMenu active={!!status && !progress.halted && (attention || !progress.settled)} disabled={busy} onChoose={mode => choose([pr], mode, key)} ariaLabel={`Choose what an agent does with PR ${pr.number}`} /> : null}
        </div>
        {assignAnchor === key ? assignPane : null}
        {relevantRuns.filter(run => runAnchor(run) === key).map(runPane)}
        {opened === key ? <TaskPane id="task:detail" dock={false}>{detailPr ? <PullRequestDetail key={`${prKey(detailPr)}:${detailPr.headRefOid}:${detailPr.baseRefOid}:${detailRevision}`} cacheStore={detailSnapshot(detailPr)} pr={detailPr} token={token} onReview={mode => choose([detailPr], mode, key)} onAssign={() => assignSelection([detailPr], key)} onRefresh={() => load()} readOnly={!isOpenPull(detailPr)} canAssign={mayAssign(detailPr.repository.viewerPermission)} status={statusFor(detailPr)} onProgress={() => task?.open(`task:run:${statusFor(detailPr)?.run.id}`)} record={recordsForPull(records, detailPr)[0]} onRecord={onRecord} provenance={pullConversations(records, relevantRuns, detailPr)} /> : <p>This pull request is no longer in the current list. Refresh to see its latest status.</p>}</TaskPane> : null}
      </article>
    })}</div>
    </div>
    {data.hasNextPage ? <button className="co-btn" disabled={data.loading} onClick={() => load(data.endCursor)}>Load more PRs</button> : null}
    {reviewDialog}


  </section>
}
