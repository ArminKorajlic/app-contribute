// Contribute — thin app shell. The module tree is declared in mobius.json's
// source_files; the multi-file installer fetches each path and Rolldown bundles
// from this entry, resolving the relative imports below at compile time.
//
//   theme.js    — the single app stylesheet (CSS)
//   domain.js   — pure logic: grouping, counts, the batched live-refresh query
//   contribution-policy.js — target-aware personal GitHub / Möbius bot routing
//   storage.js  — the window.mobius.storage ledger layer (+ offline cache,
//                 the full-diff read, and the Dismiss CAS flip)
//   api.js      — same-origin /api/github/* transport
//   github-connection.js — open Settings at GitHub
//   ui/*.jsx    — one React component per file (owned copies, not shared imports)
//
// Only App lives here: it owns ledger + connection state, runs the best-effort
// live refresh, keeps prepared cards live via a rescan when the partner returns
// to the app, wires the review flow (Send calls the platform's direct PR
// submit endpoint; Feedback returns to the source chat; Dismiss CAS-abandons),
// and composes header, tiles, connection card, feed.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CSS } from './theme.js'
import {
  attachSourceProjects,
  localChangeSentence,
  localChangeSummary,
  proposalSourceCommits,
  recordsForProject,
} from './source-map.js'
import {
  applyLiveStates,
  buildRefreshQuery,
  isSubmissionResolutionSettled,
  mergeRecordUpdates,
  reconcileLedgerSnapshot,
  resolveUncertainSubmission,
  summarizeSubmissionResolutions,
  syncSetupCompletion,
  upsertRecord,
} from './domain.js'
import { contributionActionScope, contributionApprovalIsCurrent, contributionPhaseApprovalIsCurrent, contributionReviewTargetFromIntent, focusedContributionNavigationReady, focusedContributionReady, indexReviewStatus, qualityReviewFor } from './review.js'
import { buildContributionRun, findRunItemByRecord } from './run.js'
import { stackPublicationRecords } from './stack.js'
import { deliverCycleMessage } from './cycle-delivery.js'
import { DEFAULT_STAGE, stageOf } from './publication-stage.js'
import { abandonPrepared, cacheFeed, cacheSourceSnapshot, loadAppSettings, loadCachedFeed, loadCachedSourceSnapshot, loadContributionRecord, loadFreshContributionRecord, loadFreshContributionRecords, loadCycleState, loadFullDiff, loadLedger, restoreAbandoned, saveAppSettings } from './storage.js'
import { createRefreshCoordinator } from './refresh.js'
import { checkUpstream } from './upstream-check.js'
import { DESK_LAST_LOOKED_KEY, deskCounts, projectNeedsCount } from './desk.js'
import { hasActiveReview } from './review-frame.js'
import { loadReviewRuns, withIgnoreNote, withoutIgnoreNote } from './collaboration.js'
import {
  contributionPathDecision,
  contributionStackDecision,
} from './contribution-policy.js'
import {
  assignIncomingReview,
  fetchIncomingReviews,
  fetchGithubStatus,
  fetchLiveStates,
  fetchMobiusContributionStatus,
  fetchContributionScreenshot,
  fetchReviewStatus,
  fetchSourceDiff,
  fetchSourceStatus,
  markContributionReady,
  setAutopilot,
  submitContribution,
  submitContributionViaMobius,
  submitContributionStack,
  updateContribution,
  updateContributionStack,
  withdrawMobiusContribution,
} from './api.js'
import { ConnectionSettings } from './ui/ConnectionCard.jsx'
import { openAgentConversation } from './ui/BatchAction.jsx'
import { ContributionRun } from './ui/Feed.jsx'
import { ScreenshotLoaderContext } from './ui/useScreenshots.js'
import { Icon } from './ui/Icons.jsx'
import { SourceMap } from './ui/SourceMap.jsx'
import { useReviewList } from './ui/useReviewList.js'
import { SyncNote } from './ui/GithubParts.jsx'
import { ProjectEdits } from './ui/ProjectEdits.jsx'
import { RepositoryPicker } from './ui/RepositoryPicker.jsx'
import { ReviewSelection } from './ui/ReviewSelection.jsx'
import { reviewSelectionIdFromIntent } from './review-selection.js'
import { FOLLOWED_REPOSITORIES, followedRepositories } from './repositories.js'
import { ProjectControls } from './ui/ProjectControls.jsx'
import { PullRequests } from './ui/PullRequests.jsx'
import { collaborationRequest, discoverRepositories, discoverRepository } from './collaboration.js'
import { cardRecordIds, chatBlockTarget } from './chat-blocks.js'
import { InlineBlockSession } from './ui/InlineBlockSession.jsx'
import { reviewAddressFor, writeBindingRefusal } from './send-readiness.js'
import { readBlockSession } from './block-protocol.js'

// The app's own icon, with a lettered fallback for installs whose icon route
// 404s. Mirrors the App Store header pattern.
function Header({ appId, fromCache, checking, onBack, children }) {
  const [iconFailed, setIconFailed] = useState(false)
  return (
    <header className="co-header">
      <div className="co-header-main">
        {onBack ? (
          <button type="button" className="co-header-back" onClick={onBack} aria-label="Back to projects"><Icon name="left" size={18} /><span>Projects</span></button>
        ) : (
          <>
            {iconFailed ? (
              <span className="co-brand-fallback" aria-hidden="true">C</span>
            ) : (
              <img
                src={`/api/apps/${appId}/icon?size=64`}
                alt=""
                width={34}
                height={34}
                className="co-brand-icon"
                onError={() => setIconFailed(true)}
              />
            )}
            <div className="co-brand-copy">
              <h1 className="co-title">Contribute</h1>
            </div>
          </>
        )}
      </div>
      <div className="co-toolbar">
        {checking && (
          <span className="co-toolbar-check" role="status" aria-live="polite">
            <span className="ma-spinner is-compact" aria-hidden="true" />
            <span className="co-visually-hidden">Updating contribution state</span>
          </span>
        )}
        {children}
      </div>
      {fromCache && (
        <span className="co-offline-note">
          {window.mobius?.online === false
            ? 'Offline — showing your last synced feed.'
            : 'Not fully up to date — showing your last synced feed.'}
        </span>
      )}
    </header>
  )
}

// The PR list needs a confirmed connection. Only a confirmed disconnect asks
// the owner to connect; a failed or timed-out status read is retryable and
// says so, and the initial check renders nothing rather than a false prompt.
export function GithubPullsUnavailable({ conn, onRetry }) {
  const [retrying, setRetrying] = useState(false)
  if (conn?.state === 'disconnected') {
    return <section className="co-alert" aria-label="GitHub connection"><h3>Pull requests</h3><p>Go to Möbius Settings → Accounts and connect GitHub to see this project’s pull requests, assign work, and run reviews. Your saved contributions remain here.</p></section>
  }
  if (conn?.state !== 'unknown') return null
  return <section className="co-alert" aria-label="GitHub connection"><h3>Pull requests</h3><p>{conn.message || 'Could not reach GitHub.'} Your connection is unchanged.</p>
    <button type="button" className="co-btn" disabled={retrying} onClick={async () => {
      setRetrying(true)
      try { await onRetry?.() } finally { setRetrying(false) }
    }}>{retrying ? 'Checking…' : 'Check GitHub again'}</button></section>
}

// Preflight rejection did not enter a public write. Keep it distinct from a
// lost response after dispatch, which must retain reconciliation ownership.
function stalePublicApproval() {
  return {
    notAttempted: true,
    error: 'The saved proposal changed. Review its current version and confirm again; this action made no public request.',
    failure: { owner: 'agent', code: 'approval_changed' },
  }
}

// Chat sends only through routes that bind the confirmed snapshot; the
// Möbius relay route does not, so relay contributions are sent from
// Contribute itself.
function relayFromChatRefusal() {
  return {
    notAttempted: true,
    error: 'This contribution is sent through the Möbius relay, which chat cannot send with a confirmed snapshot. Open Contribute to send it.',
    failure: { owner: 'owner', code: 'relay_not_inline' },
  }
}

// The longest a card's explicit Try again may take before it settles as failed.
export const CARD_REFRESH_DEADLINE_MS = 20000

// Lets the chat host run this app headless behind a Contribute card.
export const appBlockSessions = true

// A chat card starts with exact record reads only. The ordinary app, with its
// account, ledger and review reads and its guarded Send handlers, mounts only
// once the owner taps the card's action, and stays invisible.
export default function ContributeEntry({ appId, token, blockSession = null }) {
  const [runtimeWanted, setRuntimeWanted] = useState(false)
  const [runtime, setRuntime] = useState(null)
  // Status is read only for the records the card's items name (none when the
  // host sent no items).
  const addressed = useMemo(() => {
    const session = readBlockSession(blockSession)
    return cardRecordIds((session?.actions || []).map(action => action.key), session?.items)
  }, [blockSession])
  if (!blockSession) return <ContributeApp appId={appId} token={token} />
  return <>
    <InlineBlockSession blockSession={blockSession} runtime={runtime} onNeedRuntime={() => setRuntimeWanted(true)} />
    {runtimeWanted ? <ContributeApp appId={appId} token={token} addressedRecordIds={addressed} onPublicationRuntime={setRuntime} /> : null}
  </>
}

function ContributeApp({ appId, token, addressedRecordIds = null, onPublicationRuntime = null }) {
  // Behind a chat card the app runs only what inline Send needs: the ledger,
  // the addressed review status, the GitHub connection and the guarded Send
  // handlers. It renders nothing and skips the workspace's other reads.
  const sendOnly = Boolean(onPublicationRuntime)
  const [records, setRecords] = useState([])
  const [fromCache, setFromCache] = useState(false)
  const [conn, setConn] = useState({ state: 'checking' })
  const [loading, setLoading] = useState(true)
  const [ledgerReady, setLedgerReady] = useState(false)
  const [omittedCount, setOmittedCount] = useState(0)
  const [sourceSnapshot, setSourceSnapshot] = useState(null)
  // The last upstream answer per project key; empty until Refresh has asked.
  const [upstreamChecks, setUpstreamChecks] = useState({})
  const [projectFocus, setProjectFocus] = useState(null)
  // A chat PR link leases one exact PR in its project; the PR view hands the
  // lease back when the owner leaves that PR's detail or the project.
  const [pullFocus, setPullFocus] = useState(null)
  const pullFocusRef = useRef(null)
  pullFocusRef.current = pullFocus
  const sourceProjectsRef = useRef([])
  const tokenRef = useRef(token)
  tokenRef.current = token
  const releasePullFocus = useCallback(nonce => setPullFocus(old => old?.nonce === nonce ? null : old), [])
  // Open the project that owns a repository: the local one when known,
  // otherwise the repository as an external project.
  function openRepository(repoName, nonce) {
    const repo = repoName.toLowerCase()
    const project = sourceProjectsRef.current.find(item => item.canonical_repo?.toLowerCase() === repo)
    if (project) { setProjectFocus({ key: project.key, nonce }); return }
    void discoverRepository(tokenRef.current, repoName).then(repository => {
      if (pullFocusRef.current?.nonce !== nonce) return
      setProjectFocus({ key: `external:${repository.nameWithOwner.toLowerCase()}`, repository, nonce })
    }, error => {
      if (pullFocusRef.current?.nonce !== nonce) return
      setSelectionError(error.message)
      releasePullFocus(nonce)
    })
  }
  function openPullFocus(target, nonce) {
    setSelectionError('')
    setPullFocus({ repo: target.repo, number: target.number, nonce })
    openRepository(target.repo, nonce)
  }
  // A run link opens the run's own project with that run's detail.
  async function openRunFocus(id, nonce) {
    setSelectionError('')
    setPullFocus({ runId: id, nonce })
    // Read the exact run: the recent list is capped and would hide older runs.
    let run = null
    try { run = (await collaborationRequest(tokenRef.current, appId, `review-runs/${encodeURIComponent(id)}`)).run || null }
    catch (error) { if (pullFocusRef.current?.nonce === nonce) { setSelectionError(error.message); releasePullFocus(nonce) } return }
    if (pullFocusRef.current?.nonce !== nonce) return
    const repo = run?.items?.[0]?.repo
    if (!repo) { setSelectionError('This review run is not in Contribute’s history.'); releasePullFocus(nonce); return }
    setPullFocus({ runId: id, repo, run, nonce })
    openRepository(repo, nonce)
  }
  const [projectOpen, setProjectOpen] = useState(false)
  const [sourceLoading, setSourceLoading] = useState(true)
  const [sourceError, setSourceError] = useState('')
  const [reviewStatus, setReviewStatus] = useState({
    state: 'loading', byId: {}, checkedAt: '',
  })
  const [reviewFocus, setReviewFocus] = useState(null)
  const [selectionFocus, setSelectionFocus] = useState(null)
  const selectionNav = useRef(null)
  const [selectionError, setSelectionError] = useState('')
  function closeSelection() {
    const handle = selectionNav.current
    selectionNav.current = null
    handle?.close()
    setSelectionFocus(null)
  }
  async function openSelection(id) {
    closeSelection(); setSelectionError('')
    let handle
    handle = window.mobius.nav.open('contribute-approval', {
      onBack: () => { selectionNav.current = null; setSelectionFocus(null) },
      onForward: () => { selectionNav.current = handle; setSelectionFocus(id) },
    })
    selectionNav.current = handle
    const outcome = await handle.outcome
    if (selectionNav.current !== handle) { handle.close(); return }
    if (outcome?.status !== 'owned') { selectionNav.current = null; setSelectionError('Could not open the review link. Try opening it again.'); return }
    setSelectionFocus(id)
  }
  useEffect(() => () => { selectionNav.current?.close() }, [])
  const [focusedRecordLookup, setFocusedRecordLookup] = useState({
    nonce: '', recordId: '', ready: false,
  })
  const [incomingReviews, setIncomingReviews] = useState([])
  const [followedRepos, setFollowedRepos] = useState([])
  useEffect(() => window.mobius.storage.subscribe(FOLLOWED_REPOSITORIES, value => setFollowedRepos(followedRepositories(value))), [])
  const repositoryRequest = useRef(0)
  const [repositoryAccess, setRepositoryAccess] = useState({ repositories: [], error: '', hasNextPage: false })
  const loadRepositories = useCallback(async (cursor = null) => {
    const requestId = ++repositoryRequest.current
    try {
      const next = await discoverRepositories(token, cursor)
      if (requestId !== repositoryRequest.current) return
      setRepositoryAccess(old => ({ ...next, error: '', repositories: cursor
        ? [...new Map([...old.repositories, ...next.repositories].map(repo => [repo.nameWithOwner, repo])).values()]
        : next.repositories }))
    } catch (error) { if (requestId === repositoryRequest.current) setRepositoryAccess(old => ({ ...old, error: error.message })) }
  }, [token])
  useEffect(() => {
    if (sendOnly) return undefined
    if (conn.state === 'connected') void loadRepositories()
    else { repositoryRequest.current += 1; setRepositoryAccess({ repositories: [], error: '', hasNextPage: false }) }
    return () => { repositoryRequest.current += 1 }
  }, [conn.state, loadRepositories, sendOnly])
  // Whether a new Send grants autopilot. Default on; consulted only at Send
  // time (job.sh keys off each record's stamped grant, never this preference).
  const [autopilotDefault, setAutopilotDefault] = useState(true)
  // How a new PR opens when the owner does not pick for that send (see publication-stage.js).
  const [newPrStage, setNewPrStage] = useState(DEFAULT_STAGE)
  // Findings the owner set aside, by review version (see ignoreKey). Kept in the app's settings.
  const [ignoredReviews, setIgnoredReviews] = useState({})
  const [deskView, setDeskView] = useState('needs')
  const [lastLooked, setLastLooked] = useState('')
  // The PR page the desk pane shows, over whatever view or project is behind
  // it. Back only clears this, so the place the owner came from is untouched.
  const [pullPage, setPullPage] = useState(null)
  const submissionMethod = 'github'
  const [refreshKey, setRefreshKey] = useState(0)
  const [earlierCycle, setEarlierCycle] = useState(null)
  useEffect(() => { if (!sendOnly) void loadCycleState().then(setEarlierCycle) }, [sendOnly])
  const pageRef = useRef(null)
  // Latest records for callbacks (the connect-flow refresh) that must not take
  // a `records` dependency and re-bind on every ledger change.
  const recordsRef = useRef(records)
  useEffect(() => { recordsRef.current = records }, [records])
  const connRef = useRef(conn)
  const connectionRequestRef = useRef(0)
  const reviewStatusRequestRef = useRef(0)
  const incomingReviewsRequestRef = useRef(0)
  const agentStartRef = useRef(false)
  const sourceSnapshotRef = useRef(sourceSnapshot)
  const readySignalRef = useRef(false)
  const ledgerReadyRef = useRef(false)
  // Whether the last ledger read was complete. The manual refresh reports
  // failure from it, so a still-partial feed never reads as "updated".
  const ledgerCurrentRef = useRef(false)
  useEffect(() => { connRef.current = conn }, [conn])
  useEffect(() => { sourceSnapshotRef.current = sourceSnapshot }, [sourceSnapshot])

  const signalReady = useCallback((details = {}) => {
    if (readySignalRef.current) return
    readySignalRef.current = true
    window.mobius?.signal?.('app_ready', details)
  }, [])

  // Every app-owned agent handoff uses the durable first-turn primitive. A
  // scoped handoff is admitted atomically by the platform, so two panes or a
  // remounted frame resolve to one exact conversation without a read/create
  // race. The local guard exists only for immediate button feedback.
  const startAgentTask = useCallback(async (action) => {
    if (!action?.title || !action?.draft) {
      return { ok: false, error: 'This agent handoff is incomplete.' }
    }
    if (agentStartRef.current) {
      return { ok: false, error: 'Another agent task is already starting.' }
    }
    if (action.cid) {
      // Project work: one deterministic message in the project's conversation.
      agentStartRef.current = true
      try {
        const delivered = await deliverCycleMessage(tokenRef.current, action)
        if (delivered.ok) window.mobius?.signal?.(action.event || 'contribute_agent_handoff', { item_count: Number(action.count || 0), outcome: delivered.outcome })
        return delivered
      } finally { agentStartRef.current = false }
    }
    if (!window.mobius?.chat?.start) {
      return { ok: false, error: 'Agent handoffs are unavailable in this Möbius version.' }
    }
    agentStartRef.current = true
    try {
      // A launch carries its own model choice; none means the chat default.
      const chosenAgent = action.agent || {}
      const started = await window.mobius.chat.start({
        title: action.title,
        draft: action.draft,
        scope: contributionActionScope(action),
        scopeLabel: action.scopeLabel,
        ...(chosenAgent.model ? {
          provider: chosenAgent.provider,
          model: chosenAgent.model,
          ...(chosenAgent.effort ? { effort: chosenAgent.effort } : {}),
        } : {}),
      })
      if (!started?.chatId) throw new Error('Missing chat id')
      window.mobius?.signal?.(action.event || 'contribute_agent_handoff', {
        item_count: Number(action.count || 0),
        outcome: started.outcome || (started.reused ? 'reused' : 'started'),
      })
      return {
        ok: true,
        chatId: started.chatId,
        reused: started.reused === true,
        outcome: started.outcome || (started.reused ? 'reused' : 'started'),
      }
    } catch {
      return { ok: false, error: 'Could not start the agent. Try again.' }
    } finally {
      agentStartRef.current = false
    }
  }, [])

  // Keep the App Store's "Setup" tag truthful: every settled connection
  // status — initial load, in-app connect, disconnect — lands here via
  // setConn. The frame's virtual localStorage forwards the shared completion
  // key to the shell, which fans it out to every mounted app frame,
  // including the App Store's.
  useEffect(() => {
    const setupState = conn.state
    try { syncSetupCompletion(appId, setupState, window.localStorage) } catch {}
  }, [appId, conn.state])

  // Every local ledger result must update the render, the callback mirror, and
  // the offline cache together. Keeping that write in one place prevents a
  // dismissed/restored card from reappearing when an offline mount reads a
  // stale cache before the next visibility rescan.
  const replaceFeed = useCallback((next) => {
    recordsRef.current = next
    setRecords(next)
    if (!sendOnly) cacheFeed(next)
    return next
  }, [sendOnly])

  const applyRecordUpdates = useCallback((updates) => (
    replaceFeed(mergeRecordUpdates(recordsRef.current, updates))
  ), [replaceFeed])

  // Best-effort live refresh of the open PR/issue records in ONE batched
  // GraphQL round-trip. Returns the refreshed array — a NEW array only when
  // GitHub actually moved a record, the same reference otherwise (nothing to
  // refresh, a null/failed result, or no change), so callers can detect "no
  // change" with ===. A null/failed result leaves stored state untouched
  // (applyLiveStates passes records through), so a flaky network never blanks
  // or downgrades the feed. Pure fetch: the caller owns setRecords/cacheFeed.
  const fetchRefreshed = useCallback(async (recs) => {
    if (sendOnly) return recs
    const refresh = buildRefreshQuery(recs)
    if (!refresh) return recs
    const data = await fetchLiveStates(token, refresh.query)
    return applyLiveStates(recs, refresh.aliases, data)
  }, [token, sendOnly])

  // A chat card's status request names its records and, once the ledger is
  // read, every prepared layer of their stacks.
  const reviewAddressKey = useMemo(() => addressedRecordIds
    ? reviewAddressFor(addressedRecordIds, ledgerReady ? records : []).join('\n') : null, [addressedRecordIds, ledgerReady, records])
  const reviewAddress = useMemo(() => reviewAddressKey === null ? null : reviewAddressKey.split('\n').filter(Boolean), [reviewAddressKey])
  const refreshReviewStatus = useCallback(async () => {
    const requestId = reviewStatusRequestRef.current + 1
    reviewStatusRequestRef.current = requestId
    setReviewStatus((current) => ({ ...current, state: 'loading' }))
    const outcome = await fetchReviewStatus(token, appId, reviewAddress || [])
    if (requestId !== reviewStatusRequestRef.current) return null
    if (outcome.ok) {
      // Tagged with the address it answers, so a status for an older, narrower
      // address is never mistaken for a check of the card's whole stack.
      const indexed = { ...indexReviewStatus(outcome.data), address: reviewAddressKey }
      setReviewStatus(indexed)
      return indexed
    }
    const next = {
      state: 'unavailable',
      byId: {},
      checkedAt: '',
      address: reviewAddressKey,
    }
    setReviewStatus(next)
    return next
  }, [token, appId, reviewAddress, reviewAddressKey])

  // Local Sources refresh: fetch-free and safe to repeat after an agent edit.
  // A 404 specifically means this app source arrived before the companion
  // backend route was restarted into the running server, so say that plainly.
  const sourceCommitsKeyRef = useRef('')
  const sourceRequestRef = useRef(0)
  const refreshSources = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setSourceLoading(true)
    const since = proposalSourceCommits(recordsRef.current)
    sourceCommitsKeyRef.current = since.join(',')
    const requestId = sourceRequestRef.current + 1
    sourceRequestRef.current = requestId
    const result = await fetchSourceStatus(token, since)
    // An older read (for example one made before the feed loaded) must not
    // replace a newer snapshot that compared more proposal sources.
    if (requestId !== sourceRequestRef.current) return result.ok
    if (result.ok) {
      sourceSnapshotRef.current = result.data
      setSourceSnapshot(result.data)
      setSourceError('')
      cacheSourceSnapshot(result.data)
      window.mobius?.signal?.('source_map_viewed', {
        source_count: 1 + (result.data?.apps?.length || 0),
      })
    } else if (!quiet || !sourceSnapshotRef.current) {
      setSourceError(result.unsupported ? 'restart' : 'unavailable')
    }
    setSourceLoading(false)
    return result.ok
  }, [token])

  useEffect(() => {
    if (sendOnly) return undefined
    let cancelled = false
    async function loadSources() {
      const cached = await loadCachedSourceSnapshot()
      if (cached && !cancelled) {
        sourceSnapshotRef.current = cached
        setSourceSnapshot(cached)
        setSourceLoading(false)
        signalReady({
          source: 'project-snapshot',
          item_count: 1 + (cached?.apps?.length || 0),
        })
      }
      if (!cancelled) await refreshSources({ quiet: !!cached })
    }
    loadSources()
    return () => { cancelled = true }
  }, [refreshSources, signalReady, sendOnly])
  useEffect(() => { refreshReviewStatus() }, [refreshReviewStatus])
  // Proposal coverage depends on which recorded sources source status
  // compared. When the active set changes (feed load, staging, dismissal),
  // re-read it quietly rather than leaving covered files counted as local.
  const sourceCommitsKey = useMemo(
    () => proposalSourceCommits(records).join(','), [records],
  )
  useEffect(() => {
    if (!sendOnly && sourceCommitsKey !== sourceCommitsKeyRef.current) refreshSources({ quiet: true })
  }, [sourceCommitsKey, refreshSources, sendOnly])

  // Account reads do not scan the feed; the foreground coordinator owns that.
  const refreshConnection = useCallback(async () => {
    const requestId = connectionRequestRef.current + 1
    connectionRequestRef.current = requestId
    const status = await fetchGithubStatus(token)
    if (requestId !== connectionRequestRef.current) return connRef.current
    connRef.current = status
    setConn(status)
    return status
  }, [token])

  const refreshConnectionRef = useRef(null)
  refreshConnectionRef.current = refreshConnection

  const refreshIncomingReviews = useCallback(async () => {
    const requestId = incomingReviewsRequestRef.current + 1
    incomingReviewsRequestRef.current = requestId
    if (connRef.current.state !== 'connected') {
      setIncomingReviews([])
      return []
    }
    const rows = await fetchIncomingReviews(token)
    if (
      requestId !== incomingReviewsRequestRef.current
      || connRef.current.state !== 'connected'
    ) return []
    setIncomingReviews(rows)
    return rows
  }, [token])

  // Review requests count toward the first full sync, so the workspace never
  // opens with an empty inbox that fills in a beat later.
  // Review runs for the whole desk: its rows show which PRs are under review.
  // Read once at open and on Refresh; polled only while a review is running.
  const [reviewRuns, setReviewRuns] = useState([])
  const [runsReady, setRunsReady] = useState(false)
  const refreshReviewRuns = useCallback(async () => {
    try { setReviewRuns((await loadReviewRuns(token, appId)).runs || []) } catch { /* the rows simply show no frame */ }
  }, [token, appId])
  useEffect(() => {
    if (sendOnly || conn.state === 'checking') return
    if (conn.state !== 'connected') { setRunsReady(true); return }
    void refreshReviewRuns().finally(() => setRunsReady(true))
  }, [conn.state, refreshReviewRuns, sendOnly])
  const reviewActive = hasActiveReview(reviewRuns)
  useEffect(() => {
    if (!reviewActive) return undefined
    const timer = window.setInterval(() => { void refreshReviewRuns() }, 15000)
    return () => window.clearInterval(timer)
  }, [reviewActive, refreshReviewRuns])
  const [incomingReady, setIncomingReady] = useState(false)
  useEffect(() => {
    if (sendOnly || conn.state === 'checking') return
    Promise.resolve(refreshIncomingReviews()).finally(() => setIncomingReady(true))
  }, [conn.state, refreshIncomingReviews, sendOnly])

  // Mount: the cached first screen, GitHub status, and app preferences are all
  // small independent reads. Publish them without holding those controls
  // behind the much larger ledger enumeration. The live refresh still waits
  // for both GitHub and the authoritative ledger.
  useEffect(() => {
    let cancelled = false
    async function load() {
      // Start the single-file snapshot read before the paged authoritative
      // ledger scan. It gives repeat visits a useful queue immediately while
      // the full ledger catches up without ever becoming a second truth.
      const cachedPromise = loadCachedFeed()
      const ledgerPromise = Promise.resolve().then(() => loadLedger())
      const statusPromise = fetchGithubStatus(token)
      const settingsPromise = loadAppSettings()
      const cached = await cachedPromise
      if (!cancelled && cached.length > 0) {
        recordsRef.current = cached
        setRecords(cached)
        setLoading(false)
        signalReady({
          item_count: cached.length,
          source: 'snapshot',
        })
      }
      const [status, appSettings] = await Promise.all([
        statusPromise,
        settingsPromise,
      ])
      if (cancelled) return
      if (typeof appSettings.autopilot_default === 'boolean') {
        setAutopilotDefault(appSettings.autopilot_default)
      }
      setNewPrStage(appSettings.new_pr_stage)
      if (appSettings.ignored_reviews && typeof appSettings.ignored_reviews === 'object') setIgnoredReviews(appSettings.ignored_reviews)
      // The previous visit's time marks what changed "since you last looked";
      // this visit becomes the next one's mark. One write per app open.
      if (typeof appSettings[DESK_LAST_LOOKED_KEY] === 'string') {
        setLastLooked(appSettings[DESK_LAST_LOOKED_KEY])
      }
      void saveAppSettings({ ...appSettings, [DESK_LAST_LOOKED_KEY]: new Date().toISOString() })
      connRef.current = status
      setConn(status)

      const ledger = await ledgerPromise
      if (cancelled) return
      const recs = ledger.records
      recordsRef.current = recs
      setOmittedCount(ledger.omitted.length)
      setRecords(recs)
      setFromCache(ledger.fromCache)
      ledgerCurrentRef.current = !ledger.fromCache
      setLoading(false)
      ledgerReadyRef.current = true
      setLedgerReady(true)
      signalReady({ item_count: recs.length })

      if (ledger.fromCache) return
      let toCache = recs
      let feedReplaced = false
      if (status.state === 'connected') {
        const next = await fetchRefreshed(recs)
        if (cancelled) return
        if (next !== recs) {
          // A public action or focused exact read may have advanced one row
          // while the mount-time GitHub overlay was in flight. Reconcile at
          // settlement so that slower startup work cannot overwrite it.
          toCache = replaceFeed(reconcileLedgerSnapshot(recordsRef.current, next, recs))
          feedReplaced = true
        }
      }
      if (!feedReplaced && !sendOnly) cacheFeed(toCache)
    }
    load().catch((err) => {
      if (cancelled) return
      setLoading(false)
      ledgerReadyRef.current = true
      setLedgerReady(true)
      signalReady({ item_count: recordsRef.current.length })
      window.mobius?.signal?.('error', {
        message: String(err?.message || err),
        source: 'load',
      })
    })
    return () => { cancelled = true }
  }, [token, fetchRefreshed, replaceFeed, signalReady, sendOnly])

  // One coordinator owns every later full pass (the header's Refresh, a chat
  // card's Try again, a focused link's catch-up): concurrent requests dedupe
  // into one run plus at most one trailing run. GitHub is synced once when the
  // app opens; there is deliberately no timer and no hidden focus/visibility
  // re-sync — the owner refreshes explicitly from the header.
  const refreshWorkRef = useRef(null)
  const forceRefreshRef = useRef(false)
  const runRefreshWork = useCallback(async () => {
    // A card's explicit Try again runs even while the frame is not visible.
    const force = forceRefreshRef.current
    forceRefreshRef.current = false
    if (!force && document.visibilityState !== 'visible') return
    // Mount already owns the first authoritative scan. Startup focus and
    // visibility events must not queue another full pass behind it.
    if (!ledgerReadyRef.current) return
    // Returning from Settings is the normal way GitHub becomes connected, so
    // every return also re-reads the account before the ledger pass.
    const [ledger] = await Promise.all([
      loadLedger(),
      refreshReviewStatus(),
      refreshConnectionRef.current?.(),
    ])
    setOmittedCount(ledger.omitted.length)
    ledgerCurrentRef.current = !ledger.fromCache
    if (!ledger.fromCache) {
      // Reconcile stored rows before querying so stale ledger lifecycle state
      // cannot erase a live overlay. At settlement keep concurrent local edits.
      const baseline = reconcileLedgerSnapshot(recordsRef.current, ledger.records)
      const next = connRef.current.state === 'connected'
        ? await fetchRefreshed(baseline) : baseline
      replaceFeed(reconcileLedgerSnapshot(recordsRef.current, next, baseline))
      setFromCache(false)
    }
  }, [fetchRefreshed, refreshReviewStatus, replaceFeed])
  refreshWorkRef.current = runRefreshWork
  const refreshCoordinatorRef = useRef(null)
  if (!refreshCoordinatorRef.current) {
    refreshCoordinatorRef.current = createRefreshCoordinator(
      () => refreshWorkRef.current(),
    )
  }


  // Shell review cards use the platform's one-shot app-intent rail. The card
  // names only the ledger record; this app resolves the record's current stage
  // and enclosing stack from authoritative storage.
  useEffect(() => {
    function onReviewIntent(event) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (event.data?.type !== 'moebius:app-intent') return
      const pullTarget = chatBlockTarget(event.data.intent)
      if (pullTarget) {
        closeSelection()
        const nonce = String(event.data.nonce ?? crypto.randomUUID())
        if (pullTarget.kind === 'run') void openRunFocus(pullTarget.id, nonce)
        else openPullFocus(pullTarget, nonce)
        return
      }
      const selectionId = reviewSelectionIdFromIntent(event.data.intent)
      if (selectionId) { void openSelection(selectionId); return }
      const target = contributionReviewTargetFromIntent(event.data.intent)
      if (!target) return
      closeSelection()
      setReviewFocus({
        ...target,
        nonce: String(event.data.nonce ?? Date.now()),
        refreshMountedLedger: ledgerReadyRef.current,
      })
      if (target.queue) setProjectFocus({ key: '', nonce: String(event.data.nonce ?? Date.now()) })
      window.mobius?.signal?.('contribution_review_opened', { id: target.recordId })
    }
    window.addEventListener('message', onReviewIntent)
    return () => window.removeEventListener('message', onReviewIntent)
  }, [])

  // A queue intent has no exact record to fresh-read. If it arrived after the
  // app had already mounted, join the same deduplicated foreground refresh as
  // focus/visibility events before exposing the queue. An intent that arrived
  // during the initial authoritative scan can use that scan when it settles.
  useEffect(() => {
    const nonce = reviewFocus?.nonce
    if (!reviewFocus?.queue || !nonce) return undefined
    let cancelled = false
    let resolving = false
    setFocusedRecordLookup({ nonce, recordId: '', queue: true, ready: false })

    const resolveFocusedQueue = async () => {
      if (cancelled || resolving || !ledgerReadyRef.current) return
      if (!reviewFocus.refreshMountedLedger) {
        setFocusedRecordLookup({ nonce, recordId: '', queue: true, ready: true })
        return
      }
      if (document.visibilityState !== 'visible') return
      resolving = true
      try {
        await refreshCoordinatorRef.current()
        if (!cancelled) {
          setFocusedRecordLookup({ nonce, recordId: '', queue: true, ready: true })
        }
      } finally {
        resolving = false
      }
    }

    resolveFocusedQueue()
    document.addEventListener('visibilitychange', resolveFocusedQueue)
    window.addEventListener('focus', resolveFocusedQueue)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', resolveFocusedQueue)
      window.removeEventListener('focus', resolveFocusedQueue)
    }
  }, [reviewFocus?.queue, reviewFocus?.nonce, reviewFocus?.refreshMountedLedger, ledgerReady])

  // The full contribution history is intentionally loaded in the background,
  // but it can span hundreds of records. Fetch the exact focused row directly,
  // then render as soon as the active snapshot contains either that standalone
  // record or every layer in its stack. Public actions still fresh-read their
  // exact records, so this fast path changes navigation latency, not authority.
  useEffect(() => {
    const recordId = reviewFocus?.recordId
    const nonce = reviewFocus?.nonce
    if (reviewFocus?.queue || !recordId || !nonce) return undefined
    let cancelled = false
    let resolvingStack = false
    let needsStackRefresh = false
    setFocusedRecordLookup({ nonce, recordId, ready: false })

    const resolveIncompleteStack = async () => {
      if (
        cancelled
        || resolvingStack
        || !needsStackRefresh
        || !ledgerReadyRef.current
        || window.mobius?.online === false
        || document.visibilityState !== 'visible'
      ) return
      resolvingStack = true
      try {
        await refreshCoordinatorRef.current()
        if (!cancelled) setFocusedRecordLookup({ nonce, recordId, ready: true })
      } finally {
        resolvingStack = false
      }
    }

    async function resolveFocusedReview() {
      const record = await loadContributionRecord(recordId)
      if (cancelled) return
      if (!record) {
        if (window.mobius?.online === false) {
          // An absent offline cache entry is not proof that the review was
          // deleted. A complete cached unit may still open safely; otherwise
          // keep waiting for a real foreground read.
          if (focusedContributionReady(recordsRef.current, recordId)) {
            setFocusedRecordLookup({ nonce, recordId, ready: true })
          } else {
            needsStackRefresh = true
          }
          return
        }
        // Both canonical and legacy exact reads settled without a record. This
        // is the only focused path that may truthfully report disappearance
        // without waiting for the larger ledger scan.
        setFocusedRecordLookup({ nonce, recordId, ready: true })
        return
      }

      const next = upsertRecord(recordsRef.current, record)
      recordsRef.current = next
      setRecords(next)
      setLoading(false)
      if (focusedContributionReady(next, recordId)) {
        setFocusedRecordLookup({ nonce, recordId, ready: true })
        return
      }

      // A focused stack record does not name every sibling. If the mounted
      // app's prior ledger predates this stack, join the existing deduplicated
      // foreground refresh rather than creating a third full-history reader.
      // Mount already owns the same scan while the first ledger is loading.
      needsStackRefresh = true
      await resolveIncompleteStack()
    }
    document.addEventListener('visibilitychange', resolveIncompleteStack)
    window.addEventListener('focus', resolveIncompleteStack)
    window.addEventListener('online', resolveIncompleteStack)
    resolveFocusedReview().catch(() => {
      // A failed direct read is not proof that the review disappeared. Keep
      // waiting for any foreground ledger refresh instead.
      if (!cancelled) setFocusedRecordLookup({ nonce, recordId, ready: false })
    })
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', resolveIncompleteStack)
      window.removeEventListener('focus', resolveIncompleteStack)
      window.removeEventListener('online', resolveIncompleteStack)
    }
  }, [reviewFocus?.recordId, reviewFocus?.nonce, ledgerReady])

  const consumeReviewFocus = useCallback((nonce) => {
    setReviewFocus((current) => current?.nonce === nonce ? null : current)
  }, [])

  const focusedReviewReady = focusedContributionNavigationReady(
    reviewFocus,
    focusedRecordLookup,
    records,
  )

  const loadProjectDiff = useCallback(
    (project) => fetchSourceDiff(token, project),
    [token],
  )

  // New PRs use the connected owner's GitHub identity. Existing-PR updates
  // stay on the personal GitHub identity that owns their public branch. Both
  // actions consume one exact reviewed record and remain explicit clicks.
  // `rec` is the exact record the owner confirmed. Where the platform binds
  // it, the server compares it under its publication lock before any write.
  const onSend = useCallback(async (rec, { requireBinding = false, stage = newPrStage } = {}) => {
    let canonical = null
    try {
      canonical = await loadFreshContributionRecord(rec.id)
    } catch { /* handled by the safe refresh error below */ }
    if (!canonical) {
      return {
        notAttempted: true,
        error: 'Contribute could not refresh the saved review. Nothing was sent; try again once it reconnects.',
        failure: { owner: 'automatic' },
      }
    }
    const refreshed = { ...canonical, path: canonical.path || rec.path }
    applyRecordUpdates(refreshed)
    if (!contributionApprovalIsCurrent(rec, refreshed)) {
      return stalePublicApproval()
    }
    if (
      refreshed.status === 'prepared' &&
      qualityReviewFor(refreshed).state !== 'all_clear'
    ) {
      return {
        notAttempted: true,
        reviewNeeded: true,
        record: refreshed,
        error: 'Review this exact version first. The Review action is ready on this card.',
        failure: { owner: 'agent' },
      }
    }
    const updating = refreshed.plan?.action === 'pr_update'
    let viaMobius = false
    let outcome
    if (updating) {
      if (connRef.current.state !== 'connected') {
        return {
          notAttempted: true,
          error: 'Connect GitHub in Möbius Settings → Accounts before updating this pull request.',
          failure: { owner: 'owner', code: 'github_not_connected' },
        }
      }
      const unbound = writeBindingRefusal({ requireBinding, frozenBinding: connRef.current.frozenBinding })
      if (unbound) return unbound
      outcome = await updateContribution({ appId, token, rec: refreshed, expectedRecord: connRef.current.frozenBinding ? rec : null })
    } else {
      const decision = contributionPathDecision(
        refreshed,
        submissionMethod,
        connRef.current.state,
      )
      if (decision.error) return {
        notAttempted: true,
        error: decision.error,
        failure: { owner: 'owner' },
      }
      viaMobius = decision.method === 'mobius'
      const unbound = writeBindingRefusal({ requireBinding, frozenBinding: connRef.current.frozenBinding, relay: viaMobius })
      if (unbound) return unbound
      outcome = viaMobius
        ? await submitContributionViaMobius({ appId, token, rec: refreshed })
        : await submitContribution({
            appId,
            token,
            rec: refreshed,
            autopilot: autopilotDefault && connRef.current.autopilotAvailable === true,
            publicationStage: stage,
            expectedRecord: connRef.current.frozenBinding ? rec : null,
          })
    }
    if (outcome.ok) {
      const next = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(next)
      window.mobius?.signal?.(updating ? 'contribution_updated' : 'contribution_submitted', {
        id: rec.id,
        url: outcome.url || next.url,
        via: viaMobius ? 'mobius' : 'github',
      })
      refreshReviewStatus()
      return {
        ok: true,
        record: next,
        url: outcome.url || next.url,
        viaMobius,
        updated: updating,
      }
    }
    if (outcome.pending) {
      const next = { ...outcome.pending, path: rec.path }
      applyRecordUpdates(next)
      return { pending: true, record: next, viaMobius }
    }
    if (outcome.alreadyHandled) {
      try {
        const fresh = await loadFreshContributionRecord(rec.id)
        if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
      } catch { /* the ordinary refresh below remains authoritative */ }
      refreshReviewStatus()
      return { alreadyHandled: true }
    }
    if (outcome.record) {
      const next = { ...outcome.record, path: rec.path }
      applyRecordUpdates(next)
    }
    if (outcome.uncertain) {
      // The POST may have completed even though its response never reached the
      // browser. Re-read the durable ledger instead of showing a raw network
      // error or enabling a potentially duplicate retry. A short second read
      // covers the common server-restart / connection-recovery boundary.
      let resolution = { state: 'unconfirmed', record: null }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          const fresh = await loadFreshContributionRecord(rec.id)
          resolution = resolveUncertainSubmission(rec, {
            records: fresh ? [fresh] : [],
            fromCache: window.mobius.online === false,
          })
        } catch {
          resolution = { state: 'unconfirmed', record: null }
        }
        if (isSubmissionResolutionSettled(resolution)) break
      }
      if (resolution.record) {
        const next = { ...resolution.record, path: rec.path }
        applyRecordUpdates(next)
        if (resolution.state === 'published') {
          window.mobius?.signal?.(updating ? 'contribution_updated' : 'contribution_submitted', {
            id: rec.id,
            url: next.url || '',
            reconciled: true,
          })
          refreshReviewStatus()
          return {
            ok: true,
            record: next,
            url: next.url || '',
            viaMobius,
            updated: updating,
          }
        }
        if (resolution.state === 'publishing') {
          refreshReviewStatus()
          return { pending: true, record: next, viaMobius }
        }
        if (resolution.state === 'blocked') {
          refreshReviewStatus()
          return {
            error: 'Nothing was sent. This contribution needs an update before you try again.',
            failure: { owner: 'agent', code: 'review_refresh_needed' },
          }
        }
      }
      refreshReviewStatus()
      return {
        error: 'We could not confirm the result. Reopen Contribute to check before trying again; a retry will not create a duplicate.',
        failure: { owner: 'automatic' },
      }
    }
    refreshReviewStatus()
    return {
      ...(outcome.notAttempted ? { notAttempted: true } : {}),
      error: outcome.error || 'Could not submit this PR.',
      failure: outcome.failure,
    }
  }, [
    appId,
    token,
    autopilotDefault,
    newPrStage,
    submissionMethod,
    applyRecordUpdates,
    refreshReviewStatus,
  ])

  const onMarkReady = useCallback(async (rec) => {
    let canonical = null
    try {
      canonical = await loadFreshContributionRecord(rec.id)
    } catch { /* handled by the safe error below */ }
    if (!canonical) {
      return {
        notAttempted: true,
        error: 'Contribute could not refresh this draft. Nothing changed; try again once it reconnects.',
        failure: { owner: 'automatic' },
      }
    }
    const current = { ...canonical, path: canonical.path || rec.path }
    applyRecordUpdates(current)
    if (!contributionApprovalIsCurrent(rec, current)) {
      return stalePublicApproval()
    }
    if (current.status === 'open') return { alreadyHandled: true, record: current }
    if (current.status !== 'draft' || current.submission_mode === 'mobius-bot') {
      return {
        notAttempted: true,
        error: current.submission_mode === 'mobius-bot'
          ? 'Möbius relay drafts cannot request review from this connection yet.'
          : 'This pull request is no longer a personal draft.',
        failure: { owner: 'owner', code: 'ready_not_available' },
      }
    }

    let outcome = await markContributionReady({ appId, token, rec: current })
    if (outcome.record) {
      applyRecordUpdates({ ...outcome.record, path: current.path })
    }
    if (outcome.ok) {
      const next = { ...outcome.ok, path: current.path }
      applyRecordUpdates(next)
      refreshReviewStatus()
      window.mobius?.signal?.('contribution_ready_for_review', {
        id: next.id,
        url: outcome.url || next.url || '',
      })
      return { ok: true, record: next }
    }

    if (outcome.uncertain) {
      let fresh = null
      try { fresh = await loadFreshContributionRecord(rec.id) } catch { /* keep uncertain */ }
      if (fresh?.status === 'open') {
        const next = { ...fresh, path: current.path }
        applyRecordUpdates(next)
        refreshReviewStatus()
        return { ok: true, record: next }
      }
      if (fresh?.readying) {
        // The durable claim proves the earlier owner approval reached Möbius.
        // Repeating this route is read-only reconciliation; it cannot issue a
        // second GitHub mutation.
        outcome = await markContributionReady({ appId, token, rec: fresh })
        if (outcome.record) {
          applyRecordUpdates({ ...outcome.record, path: current.path })
        }
        if (outcome.ok) {
          const next = { ...outcome.ok, path: current.path }
          applyRecordUpdates(next)
          refreshReviewStatus()
          return { ok: true, record: next }
        }
      }
      refreshReviewStatus()
      return {
        pending: Boolean(fresh?.readying || outcome.record?.readying),
        error: outcome.error || 'Review-stage confirmation is still being reconciled.',
        failure: outcome.failure || { owner: 'automatic' },
      }
    }

    refreshReviewStatus()
    return {
      error: outcome.error || 'Could not request review for this pull request.',
      failure: outcome.failure,
    }
  }, [appId, token, applyRecordUpdates, refreshReviewStatus])

  const relaySubmittingIds = useMemo(() => records
    .filter((rec) => (
      rec.submission_mode === 'mobius-bot' &&
      rec.status === 'submitting' &&
      rec.relay_contribution_id
    ))
    .map((rec) => rec.id)
    .sort()
    .join('\0'), [records])

  // The relay may acknowledge before GitHub has opened the draft. Poll only
  // the exact durable ids; remounting resumes from the ledger and never creates
  // another submission.
  useEffect(() => {
    if (!relaySubmittingIds || window.mobius?.online === false) return undefined
    let cancelled = false
    let timer = null
    const poll = async () => {
      const wanted = new Set(relaySubmittingIds.split('\0'))
      const active = recordsRef.current.filter((rec) => wanted.has(rec.id))
      for (const rec of active) {
        const outcome = await fetchMobiusContributionStatus({ appId, token, rec })
        if (cancelled) return
        if (outcome.ok) {
          const next = { ...outcome.ok, path: rec.path }
          applyRecordUpdates(next)
          if (next.url) {
            window.mobius?.signal?.('contribution_submitted', {
              id: next.id,
              url: next.url,
              via: 'mobius',
              reconciled: true,
            })
          }
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 30000)
    }
    timer = window.setTimeout(poll, 1200)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [relaySubmittingIds, appId, token, applyRecordUpdates])

  const onWithdraw = useCallback(async (rec) => {
    const outcome = await withdrawMobiusContribution({ appId, token, rec })
    if (outcome.ok) {
      const next = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(next)
      window.mobius?.signal?.('contribution_withdrawn', { id: rec.id })
      refreshReviewStatus()
      return { ok: next }
    }
    if (outcome.uncertain) {
      try {
        const fresh = await loadFreshContributionRecord(rec.id)
        if (fresh?.status === 'closed') {
          const next = { ...fresh, path: rec.path }
          applyRecordUpdates(next)
          return { ok: next }
        }
      } catch { /* keep the explicit uncertain result */ }
    }
    return outcome
  }, [appId, token, applyRecordUpdates, refreshReviewStatus])

  // Pause / resume autopilot for one shipped PR. Platform endpoint (not a ledger
  // write); on success we re-read that record so the mirrored autopilot block
  // and any cleared human_required flag land in the feed.
  const onSetAutopilot = useCallback(async (rec, enabled) => {
    const outcome = await setAutopilot({
      appId, token, recordId: rec.id, enabled,
    })
    if (outcome.ok) {
      try {
        const fresh = await loadFreshContributionRecord(rec.id)
        if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
      } catch { /* the next refresh reconciles */ }
      return { ok: true }
    }
    return { error: outcome.error || 'Could not update autopilot.' }
  }, [appId, token, applyRecordUpdates])

  const onChangeNewPrStage = useCallback(async (next) => {
    const stage = stageOf(next)
    setNewPrStage(stage)
    const settings = await loadAppSettings()
    saveAppSettings({ ...settings, new_pr_stage: stage })
  }, [])

  // Setting a review's findings aside is the owner's own note: nothing is posted anywhere.
  const saveIgnoredReviews = useCallback(async (change) => {
    setIgnoredReviews(change)
    const settings = await loadAppSettings()
    saveAppSettings({ ...settings, ignored_reviews: change(settings.ignored_reviews || {}) })
  }, [])
  const onIgnoreReview = useCallback((item, reason) => saveIgnoredReviews(notes => withIgnoreNote(notes, item, reason)), [saveIgnoredReviews])
  const onUndoIgnore = useCallback(item => saveIgnoredReviews(notes => withoutIgnoreNote(notes, item)), [saveIgnoredReviews])

  const onToggleAutopilotDefault = useCallback(async (next) => {
    setAutopilotDefault(next)
    const settings = await loadAppSettings()
    saveAppSettings({ ...settings, autopilot_default: next })
  }, [])


  const onAssignIncomingReview = useCallback(async (item) => {
    const repo = item?.repository?.nameWithOwner || ''
    const outcome = await assignIncomingReview({ appId, token, repo, number: item?.number })
    if (!outcome.ok) return outcome
    const started = await startAgentTask({
      event: 'assign_and_review_incoming_pr',
      title: `Review ${repo} #${item.number}`,
      count: 1,
      draft: [
        `Thoroughly review ${item.url}.`,
        '',
        'The owner explicitly assigned this exact pull request to themselves from Contribute.',
        'Inspect the complete current diff with expanding scope for correctness, maintainability, simplicity, tests, security/privacy, and avoidable technical debt.',
        'Do not change the author’s branch. Prepare specific, actionable suggestions for sound findings and re-review if the author updates it.',
        'Do not submit a GitHub review or comment without the owner’s exact approval for that public action.',
      ].join('\n'),
    })
    if (!started.ok) {
      return {
        ...started,
        error: 'Assigned on GitHub, but the review conversation did not start. Try again to resume it.',
      }
    }
    // The assignment settled after any earlier incoming-review request began.
    // Invalidate that request before hiding this row so its stale response
    // cannot put the just-assigned review back into the queue.
    incomingReviewsRequestRef.current += 1
    setIncomingReviews((current) => current.filter((row) => row.url !== item.url))
    return { ok: true }
  }, [appId, token, startAgentTask])

  // One explicit confirmation advances the exact current phase of an already-
  // reviewed chain. The response may contain partial progress, so merge every
  // returned ledger record rather than treating the phase as all-or-nothing.
  const onSendStack = useCallback(async (stackRecords, { requireBinding = false, stage = newPrStage } = {}) => {
    const approvedPublicationRecords = stackPublicationRecords({
      type: 'stack', records: stackRecords, total: stackRecords.length,
    })
    let freshRecords = []
    try {
      freshRecords = await loadFreshContributionRecords(
        stackRecords.map((rec) => rec.id),
      )
    } catch { /* handled by the complete-set check below */ }
    const freshById = new Map(freshRecords.map((rec) => [rec.id, rec]))
    const currentRecords = stackRecords.flatMap((approved) => {
      const current = freshById.get(approved.id)
      return current ? [{ ...current, path: current.path || approved.path }] : []
    })
    if (currentRecords.length !== stackRecords.length) {
      return {
        notAttempted: true,
        error: 'Contribute could not refresh the complete reviewed chain. Nothing was sent; try again once it reconnects.',
        failure: { owner: 'automatic' },
      }
    }
    applyRecordUpdates(currentRecords)
    const publicationRecords = stackPublicationRecords({
      type: 'stack', records: currentRecords, total: currentRecords.length,
    })
    if (!contributionPhaseApprovalIsCurrent(
      approvedPublicationRecords,
      publicationRecords,
    )) {
      return stalePublicApproval()
    }
    const updating = publicationRecords.length > 0 && publicationRecords.every(
      (rec) => rec?.plan?.action === 'pr_update',
    )
    if (updating && connRef.current.state !== 'connected') {
      return {
        notAttempted: true,
        error: 'Connect GitHub in Möbius Settings → Accounts before updating these pull requests.',
        failure: { owner: 'owner', code: 'github_not_connected' },
      }
    }
    if (!updating) {
      const decision = contributionStackDecision(
        currentRecords,
        submissionMethod,
        connRef.current.state,
      )
      if (decision.error) return {
        notAttempted: true,
        error: decision.error,
        failure: { owner: 'owner' },
      }
      if (decision.method === 'mobius') {
        return {
          notAttempted: true,
          error: 'Connect GitHub in Möbius Settings → Accounts to send this related group as your account.',
          failure: { owner: 'owner', code: 'github_not_connected' },
        }
      }
    }
    const unbound = writeBindingRefusal({ requireBinding, frozenBinding: connRef.current.frozenBinding })
    if (unbound) return unbound
    const writeStack = updating
      ? updateContributionStack
      : submitContributionStack
    const outcome = await writeStack({
      appId,
      token,
      recordIds: currentRecords.map((rec) => rec.id),
      publicationStage: stage,
      // The owner confirmed the whole chain, including public context.
      expectedRecords: connRef.current.frozenBinding
        ? currentRecords.map((current) => stackRecords.find((approved) => approved.id === current.id))
        : null,
    })
    const updates = outcome.ok || outcome.records || []
    if (updates.length > 0) {
      applyRecordUpdates(updates)
    }
    if (outcome.ok) {
      window.mobius?.signal?.(
        updating ? 'contribution_stack_updated' : 'contribution_stack_submitted',
        {
          stack_id: currentRecords[0]?.plan?.stack?.id || '',
          item_count: outcome.submitted?.length || 0,
        },
      )
      refreshReviewStatus()
      return { ok: true, submitted: outcome.submitted?.length || 0 }
    }
    if (outcome.alreadyHandled) {
      try {
        const wanted = new Set(currentRecords.map((rec) => rec.id))
        const fresh = (await loadFreshContributionRecords([...wanted]))
          .filter((rec) => wanted.has(rec.id))
          .map((rec) => ({ ...rec, path: currentRecords.find((item) => item.id === rec.id)?.path }))
        if (fresh.length > 0) applyRecordUpdates(fresh)
      } catch { /* the ordinary refresh below remains authoritative */ }
      refreshReviewStatus()
      return { alreadyHandled: true }
    }
    if (outcome.uncertain) {
      let resolutions = publicationRecords.map(() => ({
        state: 'unconfirmed', record: null,
      }))
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          const records = await loadFreshContributionRecords(
            publicationRecords.map((rec) => rec.id),
          )
          const ledger = {
            records,
            fromCache: window.mobius.online === false,
          }
          resolutions = publicationRecords.map(
            (rec) => resolveUncertainSubmission(rec, ledger),
          )
        } catch {
          resolutions = publicationRecords.map(() => ({
            state: 'unconfirmed', record: null,
          }))
        }
        if (resolutions.every(isSubmissionResolutionSettled)) break
      }
      const durable = resolutions.flatMap((item, index) => item.record
        ? [{ ...item.record, path: publicationRecords[index].path }]
        : [])
      if (durable.length > 0) applyRecordUpdates(durable)
      const summary = summarizeSubmissionResolutions(resolutions)
      if (summary.state === 'published') {
        window.mobius?.signal?.('contribution_stack_submitted', {
          stack_id: currentRecords[0]?.plan?.stack?.id || '',
          item_count: summary.published,
          reconciled: true,
        })
        refreshReviewStatus()
        return { ok: true, submitted: summary.published }
      }
      if (summary.state === 'publishing') {
        refreshReviewStatus()
        return {
          pending: true,
          publishing: summary.publishing,
          published: summary.published,
        }
      }
      refreshReviewStatus()
      if (summary.blocked > 0) {
        return {
          error: summary.published > 0
            ? 'Saved progress was restored. The remaining changes show what needs updating.'
            : 'Nothing was sent. These changes need an update before you try again.',
          failure: { owner: 'agent', code: 'review_refresh_needed' },
        }
      }
      return {
        error: 'We could not confirm the result. Reopen Contribute to check before trying again; a retry will not create duplicates.',
        failure: { owner: 'automatic' },
      }
    }
    refreshReviewStatus()
    return {
      ...(outcome.notAttempted ? { notAttempted: true } : {}),
      error: outcome.error || 'Could not submit this PR stack.',
      failure: outcome.failure,
    }
  }, [
    appId,
    token,
    newPrStage,
    submissionMethod,
    applyRecordUpdates,
    refreshReviewStatus,
  ])

  // Feedback = return to the chat that created the contribution, with a small
  // draft already pointing at the exact record. Attention follow-ups can pass
  // a more specific draft. Older records may not have
  // chat_id; in that case the card says so rather than opening an ambiguous
  // new chat.
  const onFeedback = useCallback((rec, opts = {}) => {
    if (window.parent === window) {
      return { ok: false, reason: 'standalone' }
    }
    if (!rec.chat_id) {
      return { ok: false, reason: 'missing-chat' }
    }
    const draft = opts.draft || (
      'Feedback on contribution ' + rec.id +
      ' ("' + (rec.title || 'untitled') + '"): '
    )
    // App frames have an opaque origin, so `*` is required for this one hop to
    // the direct parent. AppCanvas accepts it only from the exact mounted live
    // contentWindow and narrows the message before the shell sees chat metadata.
    window.parent.postMessage(
      { type: 'moebius:open-chat', chatId: rec.chat_id, draft },
      '*')
    window.mobius?.signal?.('contribution_feedback_opened', { id: rec.id })
    return { ok: true }
  }, [])

  // Dismiss = CAS flip to abandoned (storage.js owns the If-Match dance). On
  // success the record moves to the Run's Dismissed fold in place; on a conflict the feed is
  // reloaded so the card shows whatever actually happened to it.
  const onDismiss = useCallback(async (rec) => {
    const outcome = await abandonPrepared({ appId, token, rec })
    if (outcome.ok) {
      // Pure updater — the feed cache catches up on the next rescan/mount,
      // and the runtime mirror already holds the flipped record.
      const flipped = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(flipped)
      refreshReviewStatus()
      window.mobius?.signal?.('contribution_dismissed', { id: rec.id })
    } else if (outcome.conflict) {
      applyRecordUpdates({ ...outcome.conflict, path: rec.path })
    } else if (outcome.gone) {
      replaceFeed(recordsRef.current.filter((item) => item.id !== rec.id))
    } else if (outcome.conflict === null) {
      const fresh = await loadFreshContributionRecord(rec.id)
      if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
    }
    return outcome
  }, [appId, token, applyRecordUpdates, replaceFeed, refreshReviewStatus])

  // Restore = CAS flip an archived record back to `prepared`. Mirrors onDismiss:
  // on success it moves from Dismissed back to the current Run in place; on a
  // conflict/gone the feed reloads so the card reflects reality.
  const onRestore = useCallback(async (rec) => {
    const outcome = await restoreAbandoned({ appId, token, rec })
    if (outcome.ok) {
      const flipped = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(flipped)
      refreshReviewStatus()
      window.mobius?.signal?.('contribution_restored', { id: rec.id })
    } else if (outcome.conflict) {
      applyRecordUpdates({ ...outcome.conflict, path: rec.path })
    } else if (outcome.gone) {
      replaceFeed(recordsRef.current.filter((item) => item.id !== rec.id))
    } else if (outcome.conflict === null) {
      const fresh = await loadFreshContributionRecord(rec.id)
      if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
    }
    return outcome
  }, [appId, token, applyRecordUpdates, replaceFeed, refreshReviewStatus])

  // A linked repository outside the owner's lists still opens as a project.
  const linkedRepository = projectFocus?.repository
  const sourceProjects = useMemo(
    () => attachSourceProjects(sourceSnapshot, records, incomingReviews,
      linkedRepository ? [...repositoryAccess.repositories, linkedRepository] : repositoryAccess.repositories,
      linkedRepository ? [...followedRepos, linkedRepository.nameWithOwner] : followedRepos),
    [sourceSnapshot, records, incomingReviews, repositoryAccess.repositories, followedRepos, linkedRepository],
  )
  sourceProjectsRef.current = sourceProjects
  const contributionRun = useMemo(() => buildContributionRun({
    records,
    reviewStatus,
    projects: sourceProjects,
    incomingReviews: [],
  }), [records, reviewStatus, sourceProjects, incomingReviews])
  const focusedRecord = records.find(record => record.id === reviewFocus?.recordId)
  const focusedProjectKey = sourceProjects.find(project =>
    recordsForProject(focusedRecord ? [focusedRecord] : [], project).length > 0)?.key || ''
  const routedFocusRef = useRef('')
  useEffect(() => {
    if (!reviewFocus?.recordId || !focusedReviewReady || sourceLoading || routedFocusRef.current === reviewFocus.nonce) return
    routedFocusRef.current = reviewFocus.nonce
    setProjectFocus({ key: focusedProjectKey, nonce: reviewFocus.nonce })
  }, [reviewFocus, focusedReviewReady, sourceLoading, focusedProjectKey])

  // What waits on the owner in each project: the same count its Needs you
  // card lists, so the rail and the card never disagree.
  const projectAttention = useMemo(() => Object.fromEntries(sourceProjects
    .map(project => [project.key, projectNeedsCount(project, projectRun(project).decisions, conn.login || '')])), [sourceProjects, records, reviewStatus, conn.login])
  // The home's clickable counts: every number names a next step and its view.
  // Reviews you started: one row per PR for the PR reviews page, counted in the rail.
  const reviewList = useReviewList({ token, runs: reviewRuns, ignored: ignoredReviews, login: conn.login || '', refreshKey })
  const deskCountsValue = useMemo(() => deskCounts({
    projects: sourceProjects,
    decisions: contributionRun.decisions,
    incoming: incomingReviews,
    records,
    login: conn.login || '',
    reviews: reviewList.counts,
  }), [sourceProjects, contributionRun, incomingReviews, records, conn.login, reviewList.counts])
  const desk = {
    view: deskView,
    onView: setDeskView,
    counts: deskCountsValue,
    login: conn.login || '',
    records,
    runs: reviewRuns,
    ignored: ignoredReviews,
    reviews: reviewList,
    lastLooked,
    decisionsFor: project => projectRun(project).decisions,
    onOpenPull: openPullPage,
    pull: pullPage,
    onClosePull: () => setPullPage(null),
    renderPull: () => {
      if (!pullPage) return null
      const project = sourceProjects.find(item => item.key === pullPage.key)
        || sourceProjects.find(item => item.canonical_repo?.toLowerCase() === pullPage.repo.toLowerCase())
        || null
      return renderPullRequests(project, null, null, pullPage)
    },
  }
  function projectRun(project) {
    return project ? buildContributionRun({
      records: recordsForProject(records, project), reviewStatus, projects: [project],
      incomingReviews: [],
    }) : contributionRun
  }
  // `intent` lets a desk row open the PR straight into a window ('fix' = Address feedback).
  function openPullPage(project, pr, tab = 'conversation', intent = '') {
    const repo = pr?.repository?.nameWithOwner || project?.canonical_repo || ''
    if (!repo || !pr?.number) return
    setPullPage({ key: project?.key || '', repo, number: pr.number, tab, intent, nonce: crypto.randomUUID() })
  }
  // `view` comes from the project tabs: which PRs to show, how to switch tabs,
  // and where to report the open PR count. Without it the list shows all PRs.
  function renderPullRequests(project, navigation, view = null, page = null) {
    if (page) {
      return <PullRequests key={`page:${page.repo}#${page.number}`} appId={appId} token={token}
        project={project} conn={conn} refreshKey={refreshKey} onChanged={refreshIncomingReviews}
        presentation="page" focusPull={page} onFocusRelease={() => {}} onStartAgent={startAgentTask} onOpenForReview={onMarkReady} ignoredReviews={ignoredReviews} onIgnoreReview={onIgnoreReview} onUndoIgnore={onUndoIgnore}
        records={recordsForProject(records, project)} onRecord={record => {
          setPullPage(null)
          if (project?.key) setProjectFocus({ key: project.key, nonce: crypto.randomUUID() })
        }} />
    }
    return <PullRequests key={`pulls:${project?.key || 'all'}`} appId={appId} token={token}
      project={project} conn={conn} refreshKey={refreshKey} onChanged={refreshIncomingReviews}
      scope={view?.scope || 'all'} onScope={view?.onScope} onTotal={view?.onTotal} onStartAgent={startAgentTask} onOpenForReview={onMarkReady} ignoredReviews={ignoredReviews} onIgnoreReview={onIgnoreReview} onUndoIgnore={onUndoIgnore}
      onOpenPage={(pr, tab) => openPullPage(project, pr, tab)}
      focusPull={pullFocus?.number ? pullFocus : null} focusRun={pullFocus?.runId ? pullFocus : null} onFocusRelease={releasePullFocus}
      records={recordsForProject(records, project)} onRecord={record => {
        const found = findRunItemByRecord(projectRun(project), record.id)
        if (found) navigation.onSelect(found.item.id)
      }} />
  }

  // The one refresh path after the open-time sync: the header's Refresh and
  // the header's Refresh renews everything on screen — local
  // sources, the contribution feed, review requests, repositories, upstream
  // checks — and bump refreshKey so every cached PR list reloads too.
  async function refreshEverything() {
    const [sourceOk] = await Promise.all([
      refreshSources(),
      refreshCoordinatorRef.current(),
    ])
    let upstream = null
    if (conn.state === 'connected') {
      const [, , checked] = await Promise.all([loadRepositories(), refreshIncomingReviews(), checkUpstream(token, sourceProjects), refreshReviewRuns()])
      upstream = checked
      if (checked.ok) setUpstreamChecks(checked.results)
    }
    setRefreshKey(value => value + 1)
    return { ok: sourceOk && ledgerCurrentRef.current, upstream }
  }
  const [refreshingAll, setRefreshingAll] = useState(false)
  // Whether the last input was the keyboard or a pointer. A row shows its
  // hover-only controls for keyboard focus, but a mouse user who closed a
  // picker must not be left with them showing (focus returning from a text
  // field counts as focus-visible in every browser).
  useEffect(() => {
    const root = document.documentElement
    const keyboard = () => { root.dataset.input = 'keyboard' }
    const pointer = () => { root.dataset.input = 'pointer' }
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('pointerdown', pointer, true)
    return () => { document.removeEventListener('keydown', keyboard, true); document.removeEventListener('pointerdown', pointer, true) }
  }, [])
  // What the last Refresh found, shown under the page title.
  const [refreshNote, setRefreshNote] = useState(null)
  async function refreshAll() {
    if (refreshingAll) return undefined
    setRefreshingAll(true)
    try {
      const outcome = await refreshEverything()
      setRefreshNote({ outcome, at: new Date().toISOString() })
      return outcome
    } catch {
      setRefreshNote({ outcome: null, at: new Date().toISOString() })
      return null
    } finally { setRefreshingAll(false) }
  }

  // The workspace opens only once its first sync is complete — the saved
  // ledger, the project snapshot, the GitHub account and the review-request
  // inbox — so nothing visibly reloads right after it appears. Latched: a
  // later manual refresh never drops the app back to the opening screen.
  const [booted, setBooted] = useState(false)
  const bootReady = ledgerReady && !sourceLoading && conn.state !== 'checking' && (incomingReady || conn.state !== 'connected') && runsReady
  useEffect(() => { if (bootReady) setBooted(true) }, [bootReady])

  // The toolbar reflects only the app's first connection/feed read. Once that
  // read settles, an unavailable GitHub status is rendered as a retryable
  // content state instead of leaving "Checking…" visible forever.
  const checking = loading && records.length === 0 && !sourceSnapshot

  // A card's Try again: once the first ledger read is done, the full pass
  // (ledger, review status, connection) through the refresh coordinator, even
  // while the frame is hidden; before that, the review status on its own. One
  // card refresh runs at a time. The card sees `refreshing` while it runs and
  // `refreshDone` once it has completed, so intermediate reports are not
  // mistaken for its result.
  const [cardRefreshes, setCardRefreshes] = useState({ running: false, done: 0, outcome: '' })
  const cardRefreshRef = useRef(null)
  const cardRefresh = useCallback(() => {
    if (cardRefreshRef.current) return cardRefreshRef.current
    setCardRefreshes(state => ({ ...state, running: true }))
    const run = (async () => {
      // A read whose response never settles (network timeouts end at the
      // headers, not the body) or that fails still completes this refresh, so
      // the card returns to Try again. A late result only updates state; the
      // card's activation has already ended, so it cannot arm Confirm.
      // The completion carries its outcome: done, failed, or timeout.
      let timer, outcome = 'failed'
      const deadline = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), CARD_REFRESH_DEADLINE_MS) })
      try {
        let work
        if (ledgerReadyRef.current) {
          forceRefreshRef.current = true
          work = refreshCoordinatorRef.current()
        } else {
          work = refreshReviewStatus()
        }
        outcome = await Promise.race([Promise.resolve(work).then(() => 'done', () => 'failed'), deadline])
      } finally {
        clearTimeout(timer)
        cardRefreshRef.current = null
        setCardRefreshes(state => ({ running: false, done: state.done + 1, outcome }))
      }
    })()
    cardRefreshRef.current = run
    return run
  }, [refreshReviewStatus])

  // Behind a chat card, hand the inline session this app's own state and
  // guarded Send handlers; there is no second publication path.
  useEffect(() => {
    onPublicationRuntime?.({
      // The ledger is loading until its first read finishes, then current, or
      // incomplete when that read could not list every contribution.
      records, ledgerReady: ledgerReady && ledgerCurrentRef.current,
      ledger: !ledgerReady ? 'loading' : ledgerCurrentRef.current ? 'current' : 'incomplete',
      reviewStatus: reviewStatus.address === reviewAddressKey ? reviewStatus : { ...reviewStatus, state: 'loading' },
      connection: conn.state === 'checking' ? 'checking' : conn.state, frozenBinding: conn.frozenBinding === true,
      // The relay route cannot bind a confirmed snapshot, so chat never uses it.
      // Chat sends require the binding at the moment of the write, too.
      stage: newPrStage,
      send: (rec, options) => rec?.submission_mode === 'mobius-bot' ? relayFromChatRefusal() : onSend(rec, { ...options, requireBinding: true }),
      sendStack: (stack, options) => stack?.some(rec => rec?.submission_mode === 'mobius-bot') ? relayFromChatRefusal() : onSendStack(stack, { ...options, requireBinding: true }),
      refresh: cardRefresh, refreshing: cardRefreshes.running, refreshDone: cardRefreshes.done, refreshOutcome: cardRefreshes.outcome,
    })
  }, [onPublicationRuntime, records, ledgerReady, reviewStatus, reviewAddressKey, conn, onSend, onSendStack, newPrStage, cardRefresh, cardRefreshes])

  // Staged screenshots a prepared card shows in its description.
  const loadScreenshot = useCallback((recordId, shot) => fetchContributionScreenshot(token, appId, recordId, shot), [token, appId])

  if (sendOnly) return null
  if (!booted) {
    return (
      <div className="co-root" data-design-seed="ae1883df">
        <style>{CSS}</style>
        <div className="co-boot" role="status">
          <span className="ma-spinner" aria-hidden="true" />
          <strong>Opening Contribute…</strong>
          <span>Reading your projects and pull requests from GitHub.</span>
        </div>
      </div>
    )
  }
  // One workspace owns project context and the exact contribution beneath it.
  return (
    <ScreenshotLoaderContext.Provider value={loadScreenshot}>
    <div className="co-root" data-design-seed="ae1883df">
      <style>{CSS}</style>
      <div className="co-header-shell">
        <Header appId={appId} fromCache={fromCache} checking={checking} onBack={projectOpen && !pullPage ? () => setProjectFocus({ key: '', nonce: crypto.randomUUID() }) : null}>
          <SyncNote note={refreshNote} />
          <button type="button" className="co-btn co-toolbar-refresh" onClick={refreshAll} disabled={refreshingAll} aria-busy={refreshingAll} aria-label="Sync with GitHub">
            <Icon name={refreshingAll ? 'refresh' : 'github'} size={16} className={'co-icon' + (refreshingAll ? ' is-spinning' : '')} />
            <span>{refreshingAll ? 'Syncing…' : 'Sync with GitHub'}</span>
          </button>
          <ConnectionSettings
            appId={appId} conn={conn} token={token} onChanged={refreshConnection}
            autopilotDefault={autopilotDefault} onToggleAutopilotDefault={onToggleAutopilotDefault}
            newPrStage={newPrStage} onChangeNewPrStage={onChangeNewPrStage}
          />
        </Header>
      </div>
      <main ref={pageRef} className="co-page is-sources">
        {selectionError ? <p className="co-run-error" role="alert">{selectionError}</p> : null}
        {selectionFocus ? <ReviewSelection selectionId={selectionFocus} appId={appId} token={token} onClose={closeSelection} /> : <SourceMap
          snapshot={sourceSnapshot} projects={sourceProjects} focusKey={projectFocus} desk={desk}
          onProjectOpenChange={setProjectOpen}
          conn={conn} loading={sourceLoading} error={sourceError}
          onRetry={refreshAll} checks={upstreamChecks} attention={projectAttention} loadProjectDiff={loadProjectDiff}
          repositoryPicker={<RepositoryPicker token={token} connected={conn.state === 'connected'} onAdded={(repo, followed) => {
            setFollowedRepos(followed)
            setRepositoryAccess(old => ({ ...old, repositories: [...old.repositories.filter(item => item.nameWithOwner.toLowerCase() !== repo.nameWithOwner.toLowerCase()), repo] }))
            setProjectFocus({ key: sourceProjects.find(project => project.canonical_repo?.toLowerCase() === repo.nameWithOwner.toLowerCase())?.key || 'external:' + repo.nameWithOwner.toLowerCase(), nonce: crypto.randomUUID() })
          }} />}
          renderActivity={(project, navigation) => (
            <>


            {project ? <GithubPullsUnavailable conn={conn} onRetry={refreshConnection} /> : null}
            {project ? <ProjectControls key={`controls:${project.key}`} appId={appId} token={token} project={project} run={projectRun(project)} loading={loading || !ledgerReady || sourceLoading || !!sourceError} check={upstreamChecks[project.key] || null} onStart={startAgentTask}>
            {({ controls, progress }) => <ContributionRun
              renderPublicWork={project ? view => renderPullRequests(project, navigation, view) : null}
              reviewRequestCount={project?.reviewRequests?.length || 0}
              edits={project && localChangeSentence(project).edits ? <ProjectEdits project={project} run={projectRun(project)} loadProjectDiff={loadProjectDiff} onRefresh={refreshAll} /> : null}
              editsCount={project && localChangeSentence(project).edits ? localChangeSummary(project).changed : null}
              controls={controls}
              projectProgress={progress}
              run={projectRun(project)} presentation={project ? 'project' : 'overview'}
              projectName={project?.name || 'all projects'}
              selectedId={navigation.selectedId} onSelect={navigation.onSelect} onBack={navigation.onBack}
              loading={loading} omittedCount={fromCache ? 0 : omittedCount}
              publicationPreference="github" githubState={conn.state} newPrStage={newPrStage}
              reviewStatus={reviewStatus}
              onSend={onSend} onSendStack={onSendStack} onMarkReady={onMarkReady}
              onFeedback={onFeedback} onReview={startAgentTask} onDismiss={onDismiss} onRestore={onRestore}
              onSetAutopilot={onSetAutopilot} onWithdraw={onWithdraw}
              onAssignIncomingReview={onAssignIncomingReview} loadDiff={loadFullDiff}
              focusTarget={(project?.key || '') === focusedProjectKey ? reviewFocus : null}
              focusReady={focusedReviewReady && !sourceLoading}
              onFocusConsumed={consumeReviewFocus}
              onOpenPull={project ? pr => openPullPage(project, pr) : null}
            />}
            </ProjectControls> : null}
            </>
          )}
        />}
      </main>
    </div>
    </ScreenshotLoaderContext.Provider>
  )
}
