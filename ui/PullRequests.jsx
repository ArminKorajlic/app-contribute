import { useCallback, useEffect, useRef, useState } from 'react'
import { awaitsGithub, baseTip, collaborationRequest, DRAFT_TAKEOVER_SCOPE, discoverPull, discoverPulls, liveSelection, loadReviewRuns, matchingPulls, mayAssign, mayMerge, mergeSelection, prKey, reviewForPull, reviewItemProgress, reviewRunRequest, reviewRunTitle, runDetailsElsewhere, notOursToObserve, assignPulls, takeoverBlocker, takeoverScope } from '../collaboration.js'
import { acknowledgeAssignment, emptyPullView, invalidatedSelection, isOpenPull, observePulls, pullsInView } from '../pull-view.js'
import { pullConversations, recordsForPull } from '../provenance.js'
import { RunDetail, savedVersion } from './RunDetail.jsx'
import { PullRequestDetail } from './PullRequestDetail.jsx'
import { Avatar, ChecksBadge, GithubLabel, PullStateIcon, REVIEW_DECISION, TimeAgo } from './GithubParts.jsx'
import { TaskPane, useProjectTask, focusActionRegion } from './TaskPane.jsx'
import { useFocusLease } from './useFocusLease.js'
import { Icon } from './Icons.jsx'
import { ReviewPromptPreview } from './ReviewPromptSettings.jsx'
import { AgentModelSettings } from './AgentModelSettings.jsx'

// One draft-scope decision for the chooser, its copy and the start body.
const scopeFor = (mode, pulls) => mode === 'review_fix_merge' ? { confirmation_scope: takeoverScope(pulls) } : {}

const FILTERS = [['all', 'All'], ['unassigned', 'Unassigned'], ['assigned', 'Assigned'], ['authored', 'Mine']]

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
      <button className="co-btn co-btn-primary" disabled={selected > 20 || busy} onClick={() => onReview(selection, 'review')} aria-label="Take selected PRs on with agent"><Icon name="prepare" size={16} /><span>Take on with agent</span></button>
      <button className="co-quiet-action" aria-label="Clear selection" onClick={onClear}><Icon name="close" size={16} /></button>
    </div> : null}
    {selected > 20 ? <p role="status">Choose up to 20 PRs per run.</p> : null}
  </div>
}

function AssigneePicker({ pulls, token, appId, ownLogin, onAssigned, onCancel }) {
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
      if (results.every(result => result.ok)) onCancel()
    } finally { setBusy(false) }
  }

  const matching = people.assignees.filter(person => [person.login, person.name].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))
  const own = people.assignees.find(person => person.login.toLowerCase() === ownLogin?.toLowerCase())
  return <div ref={picker} tabIndex={-1} className="co-pr-assignment" role="region" aria-label="Assign selected PRs">
    <h3>Assign {pulls.length === 1 ? `#${pr.number}` : `${pulls.length} PRs`}</h3>
    <p>Choose a person to assign {pulls.map(item => `#${item.number}`).join(', ')} on GitHub. This doesn’t start a review.</p>
    <input type="search" className="co-person-search" aria-label="Find a person" placeholder="Find a person…" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
    {people.loading ? <p role="status">Loading people…</p> : null}
    <div className="co-person-list">
      {own && !query ? <button className="co-person-option" aria-label="Assign to me" disabled={busy || !people.can_assign} onClick={() => assign(own.login)}><b className="co-avatar">{own.login[0].toUpperCase()}</b>Assign to me<span>{own.login}</span></button> : null}
      {matching.filter(person => query || person.login !== own?.login).map(person => <button className="co-person-option" key={person.login} disabled={busy || !people.can_assign} onClick={() => assign(person.login)} aria-label={`Assign to ${person.login}`}><b className="co-avatar">{person.login[0].toUpperCase()}</b>{person.name || person.login}{person.name ? <span>{person.login}</span> : null}</button>)}
    </div>
    {!people.loading && !matching.length ? <p>No matching people in the loaded results.</p> : null}
    {busy ? <p role="status">Assigning…</p> : null}
    {people.next_page ? <button className="co-btn" disabled={busy || people.loading} onClick={() => load(people.next_page)}>Load more people</button> : null}
    <button className="co-quiet-action" disabled={busy} onClick={onCancel}>Cancel</button>
    {outcomes.filter(result => !result.ok).map(result => <p key={result.key} role="alert" className="co-run-error">{result.key}: {result.error}</p>)}
    {outcomes.some(result => result.ok) ? <p role="status">{outcomes.filter(result => result.ok).length} assigned. Only remaining PRs will be retried.</p> : null}
    {error ? <div className="co-alert" role="alert"><p className="co-alert-text">{error}</p><button className="co-btn" disabled={busy} onClick={() => load()}>Retry</button></div> : null}
  </div>
}

// A saved (frozen) selection keeps its own scope; only fresh launches consult
// the served capability. Unresolved capabilities are a pending check.
export function draftCapabilityBlocker({ drafts, capabilities, saved, allowDraft }) {
  if (!drafts || allowDraft || saved) return ''
  if (!capabilities) return 'Checking draft support…'
  return 'Draft takeover needs the Möbius update to be activated.'
}

// A fresh launch offers only the workflows this Möbius advertises.
export function takeoverCapabilityBlocker({ capabilities, saved }) {
  if (saved) return ''
  if (!capabilities) return 'Checking what this Möbius supports…'
  return capabilities.review_fix_merge === true ? '' : 'Needs a newer Möbius.'
}

export function ReviewConfirmation({ choice, busy, disabled, error, onConfirm, onCancel, onModeChange, appId, token, onResolved, onOptionsChange, onAgentChange, bindCurrentTarget = false, capabilities: served = null }) {
  const confirmation = useRef(null)
  const [promptOptions,setPromptOptions] = useState(null)
  // null until the server preset resolves: loading is not the same as an
  // inactive capability, so the launch must not claim an update is missing.
  const [resolvedCapabilities,setCapabilities] = useState(null)
  const [unsupported,setUnsupported] = useState(false)
  const capabilities = resolvedCapabilities || served || (unsupported ? {} : null)
  // The preview resolves what "default" means right now (owner background
  // agent setting and its quota fallback); keep that answer for the picker.
  const [defaultChoice,setDefaultChoice] = useState(null)
  const resolve = useCallback(value => {
    setPromptOptions(value?.options || null); setCapabilities(value ? (value.capabilities || {}) : null)
    if (value) setUnsupported(false)
    if (value && !value.agent) setDefaultChoice(value.preview?.options?.choice || null)
    onResolved?.(value)
  },[onResolved])
  useEffect(() => {
    if (choice) {
      focusActionRegion(confirmation.current)
    }
  }, [choice])
  if (!choice) return null
  const takeover = choice.mode === 'review_fix_merge'
  const merge = choice.mode === 'review_merge'
  const saved = !!choice.preview_sha256
  const drafts = choice.pulls.some(pr => pr.isDraft)
  const draftScope = choice.confirmation_scope === DRAFT_TAKEOVER_SCOPE
  const allowDraft = capabilities?.draft_takeover === true && (!saved || draftScope)
  const mergeAllowed = choice.pulls.every(pr => mayMerge(pr.repository.viewerPermission) && !pr.isDraft)
  // Rights do not depend on the capability read, so they explain first.
  const blocker = takeoverBlocker(choice.pulls, { allowDraft: true })
    || takeoverCapabilityBlocker({ capabilities, saved })
    || draftCapabilityBlocker({ drafts, capabilities, saved, allowDraft })
    || takeoverBlocker(choice.pulls, { allowDraft })
  const takeoverAvailable = !blocker
  // Posting makes Review only public, so its labels must stop saying private.
  const posting = choice.mode === 'review' && (choice.options?.post_review ?? promptOptions?.post_review) === true
  return <section ref={confirmation} tabIndex={-1} className="co-pr-confirm" aria-label="Confirm review workflow">

    <h3>{choice.pulls.length === 1 ? `Take on #${choice.pulls[0].number} with an agent` : `Take on ${choice.pulls.length} PRs with an agent`}</h3>
    <div className="co-pr-modes" role="group" aria-label="Agent workflow">
      <div className="co-pr-mode-group"><button type="button" className="co-pr-mode" aria-pressed={!takeover} disabled={busy} onClick={() => onModeChange?.('review')}><strong>Review</strong><small>{merge ? 'Merges or queues after review and required checks. No code changes.' : posting ? 'May post its verdict on GitHub. No code changes.' : 'Private findings, no public changes.'}</small></button>
        {choice.mode === 'review' && onOptionsChange && capabilities?.post_review === true ? <label className="co-workflow-option"><input type="checkbox" checked={(choice.options?.post_review ?? promptOptions?.post_review) === true} disabled={busy || !promptOptions} onChange={event => onOptionsChange({ ...promptOptions, ...choice.options, post_review:event.target.checked })} /><span>Allow posting the review on GitHub<small>The agent may post one comment review with a verdict it marks as public. Questions to you stay private. It never approves or requests changes.</small></span></label> : null}
        {!takeover && onModeChange && mergeAllowed ? <label className="co-workflow-option"><input type="checkbox" checked={merge} disabled={busy} onChange={event => onModeChange(event.target.checked ? 'review_merge' : 'review')} /> Merge when safe</label> : null}</div>
      {onModeChange ? <div className="co-pr-mode-group"><button type="button" className="co-pr-mode" aria-pressed={takeover} disabled={busy || !takeoverAvailable} onClick={() => onModeChange('review_fix_merge')}><strong>Review, fix &amp; merge</strong><small>{blocker || (drafts ? 'Reviews and fixes drafts, then marks ready and merges.' : 'Continues through scoped fixes and fresh review.')}</small></button></div> : null}
    </div>
    {/* Consent always names its exact PRs, even when it opened beside one. */}
    <ul className="co-pr-confirm-list">{choice.pulls.map(pr => <li key={prKey(pr)}><strong>#{pr.number} {pr.title}</strong><span>{pr.repository.nameWithOwner}</span></li>)}</ul>
    {takeover ? <p>Public effects: scoped fixes may be pushed{draftScope ? ', drafts marked ready' : ''}, then these PRs merged or queued after independent review and required checks. {draftScope ? 'Marking ready may notify reviewers. ' : ''}No public comments or unrelated edits. Stop prevents new actions; one already underway may finish.</p>
      : merge ? <p>{bindCurrentTarget
        ? 'Allow the agent to merge or queue these PR heads into their named target branches after a fresh review of the combined code and required checks. Questions come back to you. No branch edits or public review comments.'
        : 'Allow the agent to merge or queue these exact versions after a thorough review and required checks. Changed versions and questions come back to you. No branch edits or public review comments.'}</p>
      : posting ? <p>Possible public effect: one comment review per PR, only for a verdict the agent marks as public, posted on {choice.pulls.length === 1 ? 'this PR' : 'each PR'} from your connected GitHub account. Questions to you and unverified results stay private. It never approves, requests changes, edits code or merges.</p> : null}
    {bindCurrentTarget ? <p>On confirmation, unchanged PR heads are bound to the current tip of the same target branch, which may be newer than the snapshot below. Changed heads, target branches or draft status require a fresh confirmation.</p> : null}
    <details className="co-task-details"><summary>{bindCurrentTarget ? 'PR heads and target branches' : 'Exact versions covered by this approval'}</summary>{choice.pulls.map(pr => <p key={prKey(pr)}>#{pr.number}: version <code>{pr.headRefOid.slice(0, 7)} → {pr.baseRefName} ({bindCurrentTarget ? 'last seen ' : ''}{baseTip(pr)?.slice(0, 7)})</code></p>)}{!bindCurrentTarget ? <p>Changed code requires a fresh approval.</p> : null}</details>
    {onAgentChange ? <AgentModelSettings token={token} choice={choice.agent} defaultChoice={defaultChoice} defaultHint="Your background agent setting" onChange={next => { onAgentChange(next); return true }} /> : null}
    {appId && token ? <ReviewPromptPreview token={token} appId={appId} choice={choice} onResolved={resolve} onUnsupported={() => setUnsupported(true)} /> : null}
    <div className="co-board-actions">
      <button className="co-btn co-btn-primary" disabled={busy || disabled || (takeover && !takeoverAvailable)} onClick={onConfirm}>{busy ? 'Starting…' : takeover ? 'Allow scoped takeover' : merge ? 'Allow review & merge' : posting ? 'Start review, allow posting' : 'Start private review'}</button>
      <button className="co-btn" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    {error ? <p className="co-run-error" role="alert">{error}</p> : null}
  </section>
}

// `focusPull` is a navigation lease from a chat link: while it is held, that
// exact PR stays in view (even when closed or on a later page) and its detail
// is open. Leaving the detail or the project hands the lease back.
// A run opens beside its PR when it covers one; batches open under the header.
const runAnchor = run => run.items?.length === 1 ? `${run.items[0].repo.toLowerCase()}#${run.items[0].number}` : ''

export function PullRequests({ appId, token, project, conn, onChanged, records = [], onRecord, refreshKey, focusPull, focusRun, onFocusRelease }) {
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
  const visible = matchingPulls(pulls, filter, conn.login).filter(pr => !query.trim() || `${pr.number} ${pr.title} ${pr.author?.login || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
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
        onStop={() => stopRun(run)} retryPulls={retryPulls(run)} onRetry={retry => choose(retry, run.mode === 'review_merge' ? 'review' : run.mode, runAnchor(run))}
        onPullUpdates={project.available && project.kind !== 'external' ? () => task?.open('task:update') : null} />
    </TaskPane>
  const reviewPane = <TaskPane id="task:review" dock={false}><ReviewConfirmation appId={appId} token={token} bindCurrentTarget onResolved={value => { setResolved(value); if (value?.capabilities) setCapabilities(value.capabilities) }} disabled={!resolved} onOptionsChange={options => { setResolved(null); setChoice(old => ({ ...old, options, request_id:crypto.randomUUID() })) }} onAgentChange={agent => { setResolved(null); setChoice(old => ({ ...old, agent, request_id:crypto.randomUUID() })) }} choice={choice} busy={busy} error={error} onConfirm={start} onCancel={() => { setChoice(null); task?.close() }} onModeChange={mode => { setError(''); setResolved(null); setChoice(old => ({ ...old, mode, confirmation_scope: undefined, ...scopeFor(mode, old.pulls), request_id: crypto.randomUUID() })) }} capabilities={capabilities} />{!choice ? <p>This selection has finished. Choose the current PRs to start another review.</p> : null}</TaskPane>
  const assignPane = <TaskPane id="task:assign" dock={false}>{assigning ? <AssigneePicker key={assigning.map(prKey).join(',')} pulls={assigning} appId={appId} token={token} ownLogin={conn.login} onCancel={() => { setAssigning(null); task?.close() }} onAssigned={(login, keys) => {
      viewRef.current = acknowledgeAssignment(viewRef.current, keys, login, ++generation.current)
      setView(viewRef.current)
      void onChanged?.()
    }} /> : null}</TaskPane>
  const visibleKeys = new Set(visible.map(prKey))
  const requestedKeys = new Set((project.reviewRequests || []).map(prKey))
  const reviewAnchor = choice?.anchor && visibleKeys.has(choice.anchor) ? choice.anchor : ''
  const assignAnchor = assigning?.anchor && visibleKeys.has(assigning.anchor) ? assigning.anchor : ''
  return <section className="co-public-work" aria-label="Pull requests">
    <div className={'co-pr-list-controls' + (searchOpen ? ' is-searching' : '')}>
      <label className="co-pr-search"><Icon name="search" size={16} /><input ref={searchField} type="search" aria-label="Find a pull request" placeholder="Search pull requests" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" className="co-pr-search-toggle" aria-label={query ? `Search PRs: ${query}` : 'Search pull requests'} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Icon name="search" size={18} /></button>
      <div className="co-pr-filters" role="group" aria-label="Filter pull requests">{FILTERS.map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    </div>
    {selectionNotice ? <p className="co-pr-note" role="status">{selectionNotice}</p> : null}
    {focusRead ? <p className="co-pr-note" role="alert">Could not read that pull request: {focusRead.message}{focusRow ? ' Showing the previous snapshot.' : ''}</p> : null}
    {runError ? <p className="co-pr-note" role="status">Agent progress unavailable: {runError}</p> : null}
    {data.error ? <div className="co-alert" role="alert"><strong>Couldn’t load pull requests</strong><p className="co-alert-text">{data.error}</p><button className="co-btn" disabled={data.loading} onClick={() => { void load(); void loadRuns() }}>Try again</button></div> : null}
    <div className="co-pr-box">
    <SelectionTray selection={selection} visible={selectableVisible} shown={data.hasNextPage ? data.total || visible.length : visible.length} loading={data.loading} busy={busy} onClear={() => setSelected(new Set())} onSelectVisible={() => setSelected(old => { const next = new Set(old); const all = selectableVisible.every(pr => next.has(prKey(pr))); selectableVisible.forEach(pr => all ? next.delete(prKey(pr)) : next.add(prKey(pr))); return next })} onReview={choose} onAssign={() => assignSelection()} />
    {!reviewAnchor ? reviewPane : null}
    {!assignAnchor ? assignPane : null}
    {relevantRuns.filter(run => !visibleKeys.has(runAnchor(run))).map(runPane)}
    {data.loading && !pulls.length ? <p className="co-pr-empty" role="status">Loading pull requests…</p> : null}
    {!data.loading && !data.error && !visible.length ? <div className="co-pr-empty"><strong>No {filter === 'unassigned' ? 'unassigned ' : filter === 'assigned' ? 'assigned ' : ''}pull requests{query ? ' match' : ''}</strong><p>{data.hasNextPage ? 'Load more to search the remaining results.' : filter === 'all' ? 'When work is shared on GitHub, it appears here.' : 'Try All to see the project’s other pull requests.'}</p></div> : null}
    <div className="co-pr-list">{visible.map(pr => {
      const key = prKey(pr)
      const status = statusFor(pr)
      // A run whose conversation stopped or failed is not still reviewing.
      const progress = status ? reviewItemProgress(status.run, status.item) : null
      const halted = progress?.halted
      const attention = halted || progress?.waiting || (status?.run.chat_id && ['needs_you', 'failed', 'merge_unknown', 'ready_unknown'].includes(status.item.state))
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
            ? <button className="co-pr-assign" onClick={() => assignSelection([pr], key)} aria-label={assignees.length ? `Assigned to ${assignees.map(user => user.login).join(', ')}. Change assignment for PR ${pr.number}` : `Assign PR ${pr.number}`} title={assignees.length ? assignees.map(user => user.login).join(', ') : 'Assign'}>{assignees.length ? <span className="co-gh-avatars">{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : <Icon name="person" size={16} />}</button>
            : assignees.length ? <span className="co-gh-avatars" title={assignees.map(user => user.login).join(', ')}>{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : null}
          {open ? <button type="button" className={'co-pr-agent-action' + (status && !progress.halted && (attention || !progress.settled) ? ' is-active' : '')} disabled={busy} onClick={() => choose([pr], 'review', key)} aria-label={`Take PR ${pr.number} on with an agent`} title="Take on with agent"><Icon name="prepare" size={16} /></button> : null}
        </div>
        {reviewAnchor === key ? reviewPane : null}
        {assignAnchor === key ? assignPane : null}
        {relevantRuns.filter(run => runAnchor(run) === key).map(runPane)}
        {opened === key ? <TaskPane id="task:detail" dock={false}>{detailPr ? <PullRequestDetail key={`${prKey(detailPr)}:${detailPr.headRefOid}:${detailPr.baseRefOid}:${detailRevision}`} cacheStore={detailSnapshot(detailPr)} pr={detailPr} token={token} onReview={mode => choose([detailPr], mode, key)} onAssign={() => assignSelection([detailPr], key)} onRefresh={() => load()} readOnly={!isOpenPull(detailPr)} canAssign={mayAssign(detailPr.repository.viewerPermission)} status={statusFor(detailPr)} onProgress={() => task?.open(`task:run:${statusFor(detailPr)?.run.id}`)} record={recordsForPull(records, detailPr)[0]} onRecord={onRecord} provenance={pullConversations(records, relevantRuns, detailPr)} /> : <p>This pull request is no longer in the current list. Refresh to see its latest status.</p>}</TaskPane> : null}
      </article>
    })}</div>
    </div>
    {data.hasNextPage ? <button className="co-btn" disabled={data.loading} onClick={() => load(data.endCursor)}>Load more PRs</button> : null}
    {relevantRuns.length ? <details className="co-run-fold co-review-history">
      <summary><span>Review conversations</span><b>{relevantRuns.length}</b><Icon name="chevron" size={14} /></summary>
      <p className="co-pr-note">Saved findings apply only to their recorded versions. Open a conversation to answer questions or check an unresolved outcome.</p>
      <div>{relevantRuns.map(run => <button key={run.id} type="button" className="co-review-history-entry" data-review-run={run.id} onClick={() => task?.open(`task:run:${run.id}`)}>
        <strong>{reviewRunTitle(run)}</strong>
        {run.items?.map(item => <span key={`${item.repo}:${item.number}`}>{item.repo} #{item.number} · Recorded: {reviewItemProgress(run, item).label}<small>{savedVersion(item, pulls, data)}</small></span>)}
      </button>)}</div>
    </details> : null}


  </section>
}
