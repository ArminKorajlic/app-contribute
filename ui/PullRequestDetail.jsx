import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPullActivity, loadPullChecks, loadPullDescription, loadPullFiles, loadPullRelated, loadPullThreads, pullFileDiff, safeDetailLink } from '../pull-details.js'
import { MarkdownView } from './MarkdownView.jsx'
import DiffView from './diff/DiffView.jsx'
import { Icon } from './Icons.jsx'
import { AgentMenu } from './AgentMenu.jsx'
import { GithubLabel, PullStateBadge, REVIEW_DECISION } from './GithubParts.jsx'
import { checkSummary } from '../collaboration.js'
import { openAgentConversation } from './BatchAction.jsx'

export function DateLabel({ value, prefix = '', time = false }) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  const at = new Date(value)
  const day = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const text = time ? `${day} · ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : day
  return <time dateTime={value} title={at.toLocaleString(undefined, { hourCycle: 'h23' })}>{prefix}{text}</time>
}

// A quiet placeholder with the rough shape of the incoming text instead of a
// "Loading…" sentence; the label keeps the state readable to assistive tech.
export function Skeleton({ lines = 3, label = 'Loading' }) {
  return <div className="co-skel" role="status" aria-label={label}>
    {Array.from({ length: lines }, (_, index) => <span key={index} style={{ width: `${96 - (index % 3) * 22}%` }} />)}
  </div>
}
// Roughly ten text lines stay visible; anything longer waits behind Show
// more. Measured while clamped, so the control appears only when needed.
function ClampedMarkdown({ markdown }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const body = useRef(null)
  useEffect(() => {
    if (!expanded && body.current) setOverflows(body.current.scrollHeight > body.current.clientHeight + 1)
  }, [markdown, expanded])
  return <>
    <div ref={body} className={'co-desc-body' + (expanded ? ' is-open' : '')}><MarkdownView markdown={markdown} /></div>
    {overflows || expanded ? <button type="button" className="co-quiet-action" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show more'}</button> : null}
  </>
}

// Each comment box carries its review verdict on its border: red for a
// requested change, green for an approval, the accent for a plain review
// note, grey for a dismissed verdict. Ordinary comments keep the quiet border.
const REVIEW_TONES = { APPROVED: ' is-approved', CHANGES_REQUESTED: ' is-changes', DISMISSED: ' is-dismissed' }
function reviewTone(item) {
  if (item?.kind !== 'review') return ''
  return REVIEW_TONES[item.state] ?? ' is-reviewed'
}

function openedLine(login, value) {
  if (!value || !Number.isFinite(Date.parse(value))) return login ? `${login} opened this` : ''
  const at = new Date(value)
  const day = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${login || 'Someone'} opened ${day} · ${time}`
}

function DetailLink({ href, children }) {
  const safe = safeDetailLink(href)
  return safe ? <a className="co-quiet-action" href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
}
function threadLocation(thread) {
  const side = thread.diffSide === 'LEFT' ? 'old' : thread.diffSide === 'RIGHT' ? 'new' : 'unknown-side'
  if (thread.subjectType === 'FILE') return 'file discussion'
  if (Number.isInteger(thread.line)) {
    const range = Number.isInteger(thread.startLine) && thread.startLine !== thread.line
    if (range && thread.startDiffSide && thread.startDiffSide !== thread.diffSide) return `${thread.startDiffSide === 'LEFT' ? 'old' : 'new'} line ${thread.startLine} → ${side} line ${thread.line}`
    return `${side} line ${range ? `${thread.startLine}–` : ''}${thread.line}`
  }
  if (Number.isInteger(thread.originalLine)) return `original line ${thread.originalStartLine && thread.originalStartLine !== thread.originalLine ? `${thread.originalStartLine}–` : ''}${thread.originalLine}`
  return 'line unavailable'
}
// What a GitHub event url points at: the numeric id of the review or comment.
// The owner copies it to name the exact event in a reply or an agent task.
export function commentReference(url) {
  const match = /#(?:pullrequestreview-|issuecomment-|discussion_r)(\d+)/.exec(url || '')
  return match ? match[1] : ''
}

export function CopyId({ id, label = 'id' }) {
  const [copied, setCopied] = useState(false)
  if (!id) return null
  return <button type="button" className="co-copy-id" title={`Copy ${label} ${id}`}
    onClick={() => {
      try { navigator.clipboard?.writeText(String(id)) } catch { /* title still shows the id */ }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }}>{copied ? 'Copied' : `#${id}`}</button>
}

// New feedback on a tracked PR, kept visible under the folded description.
// The record's attention is server-maintained: it appears when a review or
// comment lands and clears once addressed, so no flag means nothing waits.
// An approving review or a recorded all-clear agent review is good news, not
// a task: it gets the green box, naming the posted review's copyable id.
const FEEDBACK_FLAGS = {
  changes_requested: { label: 'Changes requested', tone: 'blocker', note: '— not addressed yet. The review text is under Comments.' },
  github_activity: { label: 'New feedback', tone: 'news', note: '— the text is under Comments.' },
}
export function PullFeedbackFlag({ record, status = null, activity = null }) {
  const attention = record?.attention
  const flag = FEEDBACK_FLAGS[attention?.type]
  const reference = commentReference(attention?.url)
  const flagged = reference ? (activity?.items || []).find(item => String(item.id) === reference) : null
  const clear = attention?.type === 'github_activity'
    && (flagged?.state === 'APPROVED' || status?.item?.state === 'all_clear')
  if (clear) {
    return <p className="co-pr-feedback-flag is-clear" role="status">
      <Icon name="check" size={15} />
      <b>Review clear</b>
      <span>— this review found no blocking problems. Review</span>
      <CopyId id={reference || commentReference(status?.item?.public_review?.url)} label="review id" />
    </p>
  }
  if (!flag) return null
  return <p className={'co-pr-feedback-flag is-' + flag.tone} role="status">
    <Icon name="feedback" size={15} />
    <b>{flag.label}</b>
    <span>{flag.note}</span>
    <CopyId id={reference} label={attention?.type === 'changes_requested' ? 'review id' : 'comment id'} />
  </p>
}

// Where this PR came from, as buttons beside Agent, Assign and Open: the saved
// contribution behind it and the chats that wrote, reviewed or fixed it. Short
// role labels keep the row tidy; the chat's own title is the tooltip.
const COMMENT_PREVIEW = 3

const PROVENANCE_LABELS = { source: 'Source chat', review: 'Review chat', fix: 'Fix chat' }
function PullProvenance({ record, onRecord, conversations }) {
  const local = record && onRecord
  if (!local && !conversations.length) return null
  return <span className="co-gh-provenance" role="group" aria-label="Where this PR came from">
    {local ? <button type="button" className="co-btn co-gh-chat-link" title="The saved contribution this PR was sent from" onClick={() => onRecord(record)}><Icon name="prepare" size={15} />Saved work</button> : null}
    {conversations.map((link, index) => {
      const repeat = conversations.slice(0, index).filter(other => other.role === link.role).length
      return <button type="button" className="co-btn co-gh-chat-link" key={link.chat_id} title={link.title} onClick={() => openAgentConversation(link.chat_id)}><Icon name="feedback" size={15} />{(PROVENANCE_LABELS[link.role] || 'Chat') + (repeat ? ` ${repeat + 1}` : '')}</button>
    })}
  </span>
}
function ReadErrors({ errors, onRetry }) {
  return errors?.map(message => <p key={message} role="alert">{message} <button className="co-btn" onClick={onRetry}>Retry</button></p>)
}
export function PullFileTotals({ totals, label = 'Total change' }) {
  if (!totals || Object.values(totals).every(value => value === null)) return null
  return <p className="co-detail-stats" aria-label={label}><span>{label}</span>{totals.files !== null ? <span>{totals.files} {totals.files === 1 ? 'file' : 'files'}</span> : null}{totals.additions !== null ? <span className="co-file-add">+{totals.additions} lines</span> : null}{totals.deletions !== null ? <span className="co-file-del">−{totals.deletions} lines</span> : null}</p>
}
export function PullFiles({ data }) {
  const totals = data?.totals
  const counts = [
    Number.isInteger(totals?.additions) ? `${totals.additions} additions` : null,
    Number.isInteger(totals?.deletions) ? `${totals.deletions} deletions` : null,
  ].filter(Boolean).join(' and ')
  return <>
    {Number.isInteger(totals?.files) ? <p className="co-pr-note">Showing {totals.files} changed {totals.files === 1 ? 'file' : 'files'}{counts ? ` with ${counts}` : ''}{data?.page > 1 ? ` · page ${data.page}` : ''}. GitHub may omit or shorten large patches.</p> : null}
    {(data?.files || []).map(file => <details key={file.filename} className="co-file-disclosure"><summary>{file.filename} <span className="co-detail-stats">{file.status} · +{file.additions} −{file.deletions}</span></summary>{file.previous_filename ? <p>Previously {file.previous_filename}</p> : null}{file.patch ? <DiffView file={pullFileDiff(file)} /> : <p>No text patch is available for this file; it may be binary or too large.</p>}</details>)}
    {!data?.files?.length ? <p>No changed files returned on this page.</p> : null}
    {data?.capped ? <p>GitHub’s 3,000-file limit has been reached. More files may be omitted; use the review conversation for the full source.</p> : null}
  </>
}
export function PullChecks({ data }) {
  return <>
    <p className="co-pr-note">Reported by GitHub for this version{data?.page > 1 ? ` · page ${data.page}` : ''}. Checks are not an all-clear review.</p>
    {data?.groups?.map(group => <section key={group.name} aria-label={group.name}>
      <h4>{group.name}{group.total !== null ? ` · ${group.total}` : ''}</h4>
      {group.hasMore ? <p className="co-pr-note">More results remain on GitHub.</p> : null}
      {group.items.map(item => <article className="co-activity-item" key={item.id}>
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', overflowWrap: 'anywhere' }}><strong>{item.name || item.context || 'Unnamed check'}</strong><span>{(item.conclusion || item.status || item.state || 'unknown').replaceAll('_', ' ')}</span><DateLabel value={item.completed_at || item.updated_at || item.started_at || item.created_at} /></header>
        {item.output?.title || item.description ? <p>{item.output?.title || item.description}</p> : null}
        {item.details_url || item.target_url || item.html_url ? <DetailLink href={item.details_url || item.target_url || item.html_url}>View result</DetailLink> : null}
      </article>)}
      {!group.items.length ? <p>No {group.name.toLowerCase()} returned on this page.</p> : null}
    </section>)}
    {data?.capped ? <p>Only the first 100 result pages are available here. More results remain on GitHub.</p> : null}
  </>
}
// One boxed row per related item, a pull-request or issue icon telling them
// apart at a glance; the whole box opens the item on GitHub.
function RelatedRow({ item }) {
  const pull = item.__typename === 'PullRequest'
  const safe = safeDetailLink(item.url)
  const body = <>
    <Icon name={pull ? 'pull' : 'issue'} size={16} className={'co-related-icon ' + (pull ? 'is-pull' : 'is-issue')} />
    <span className="co-related-main">
      <strong>{item.title}</strong>
      <small>{pull ? 'PR' : 'Issue'} {item.repository?.nameWithOwner}#{item.number}{item.relationships?.length ? ` · ${item.relationships.join(' · ')}` : ''}</small>
    </span>
  </>
  if (!safe) return <span className="co-related-row">{body}</span>
  return <a className="co-related-row" href={safe} target="_blank" rel="noopener noreferrer">{body}</a>
}

export function PullRelated({ data }) {
  if (!data?.items?.length) return null
  return <section className="co-related-section" aria-label="Related issues and pull requests"><h4>Related issues & PRs</h4>
    <div className="co-related-list">{data.items.map(item => <RelatedRow key={item.url} item={item} />)}</div>
    {data?.truncated ? <p>Showing the first 50 closing issues and first 50 cross-reference events. More references remain on GitHub.</p> : null}
  </section>
}
export function PullThreads({ data }) {
  if (!data?.threads?.length) return null
  return <section className="co-related-section" aria-label="Inline review discussions"><h4>Inline discussions</h4>
    {data?.threads?.map(thread => <article className="co-activity-item" key={thread.id}>
      <header style={{ overflowWrap: 'anywhere' }}><strong>{thread.path || 'File not provided'}</strong> · {threadLocation(thread)} · {thread.isResolved === true ? 'Resolved' : thread.isResolved === false ? 'Unresolved' : 'Resolution unknown'}{thread.isOutdated ? ' · Outdated location' : ''}</header>
      {thread.comments?.nodes?.filter(Boolean).map(comment => <div key={comment.id} style={{ padding: '12px 0' }}><div className="co-detail-stats"><span>{comment.author?.login || 'Contributor'}</span><DateLabel value={comment.createdAt} time /></div><MarkdownView markdown={comment.body || 'No written comment.'} /></div>)}
      {thread.comments?.pageInfo?.hasNextPage ? <p className="co-pr-note">First 50 of {thread.comments.totalCount} comments shown in this thread. More replies remain on GitHub.</p> : null}
      {!thread.comments ? <p role="alert">Thread comments are unavailable.</p> : null}
    </article>)}
  </section>
}
// Key the complete local cache to the exact selected identity. Equal SHAs in
// different PRs must not reuse descriptions, pages, or stale-state decisions.
export function PullRequestDetail(props) {
  const pr = props.pr
  const identity = `${pr.repository?.nameWithOwner}#${pr.number}:${pr.headRefOid}:${pr.baseRefOid}:${pr.baseRefName}`
  return <PullRequestDetailView key={identity} {...props} />
}
function PullRequestDetailView({ cacheStore, pr, token, onReview, onAssign, onRefresh, canAssign, status, onProgress, onRecord, record, readOnly = false, provenance = [], holdUntilLoaded = false }) {
  const [tab, setTab] = useState('conversation')
  const [cache, setCache] = useState(() => cacheStore?.entries || {})
  const cacheRef = useRef(cache)
  const requests = useRef(new Map())
  // Request admission and cache publication share a synchronous owner. React
  // snapshots alone can still contain a loader whose request was just aborted.
  const writeCache = useCallback(update => {
    const next = update(cacheRef.current)
    if (next === cacheRef.current) return
    cacheRef.current = next
    setCache(next)
  }, [])
  useEffect(() => () => {
    const abandoned = [...requests.current.values()]
    requests.current.clear()
    for (const request of abandoned) request.controller.abort()
  }, [token])
  const [page, setPage] = useState({ files: 1, checks: 1, conversation: 1 })
  // More than three comments fold to the newest three — the feedback the owner
  // came for — with Show all / Show less at the end. The page pager joins the
  // full list, so a folded view never mixes "all" with "page 2".
  const [allComments, setAllComments] = useState(false)
  const commentsOpen = items => allComments || (items?.length || 0) <= COMMENT_PREVIEW
  const shownComments = items => commentsOpen(items) ? (items || []) : items.slice(-COMMENT_PREVIEW)
  const [threadCursors, setThreadCursors] = useState([null])
  const [versionStale, setVersionStale] = useState(cacheStore?.stale === true)
  useEffect(() => {
    if (!cacheStore) return
    // Incomplete reads are aborted on close and must be retried, not cached
    // as a permanent loader. This snapshot belongs to the project/PR version.
    cacheStore.entries = Object.fromEntries(Object.entries(cache).filter(([,value]) => !value.loading))
    cacheStore.stale = versionStale
  }, [cache, cacheStore, versionStale])
  const threadCursor = threadCursors[threadCursors.length - 1]
  const number = page[tab] || 1
  // Conversation is GitHub's first tab: the description plus its comments,
  // reviews, inline discussions and links. Each is an independent read so one
  // failure never blanks the others.
  const keys = {
    description: 'description:1',
    ...(tab === 'conversation'
      ? { activity: `activity:${number}`, threads: `threads:${threadCursor || ''}`, related: 'related' }
      : { view: `${tab}:${number}` }),
  }
  const keySignature = Object.values(keys).join('|')
  useEffect(() => {
    const active = new Set(Object.values(keys))
    // A retry invalidates only its failed cache entries. Navigation cancels
    // reads that leave the visible page, not pending siblings that still belong.
    for (const [key, request] of requests.current) if (!active.has(key)) {
      requests.current.delete(key)
      request.controller.abort()
      writeCache(old => {
        if (old[key] !== request.entry) return old
        const next = { ...old }; delete next[key]; return next
      })
    }
    function read(key, loader) {
      if (requests.current.has(key) || (cacheRef.current[key] && !cacheRef.current[key].loading)) return
      const request = { controller: new AbortController(), entry: { loading: true } }
      requests.current.set(key, request)
      writeCache(old => ({ ...old, [key]: request.entry }))
      loader(request.controller.signal).then(data => {
        if (requests.current.get(key) !== request) return
        requests.current.delete(key)
        writeCache(old => ({ ...old, [key]: { data, loading: false } }))
      }).catch(error => {
        if (requests.current.get(key) !== request) return
        requests.current.delete(key)
        if (error.code === 'stale') setVersionStale(true)
        writeCache(old => ({ ...old, [key]: { loading: false, error: error.message, stale: error.code === 'stale' } }))
      })
    }
    read(keys.description, signal => loadPullDescription(token, pr, signal))
    if (tab === 'conversation') {
      read(keys.activity, signal => loadPullActivity(token, pr, number, signal))
      read(keys.threads, signal => loadPullThreads(token, pr, threadCursor, signal))
      read(keys.related, signal => loadPullRelated(token, pr, signal))
    } else {
      read(keys.view, signal => tab === 'files' ? loadPullFiles(token, pr, number, signal) : loadPullChecks(token, pr, number, signal))
    }
  }, [keySignature, cache, writeCache, token, pr.number, pr.repository?.nameWithOwner, pr.headRefOid, pr.baseRefOid, pr.baseRefName])
  const entry = key => cache[key] || { loading: true }
  const stale = versionStale || Object.values(cache).some(value => value.stale)
  const tryAgain = () => {
    const mine = new Set(Object.values(keys))
    writeCache(old => Object.fromEntries(Object.entries(old).filter(([key, value]) => !mine.has(key) || (!value.error && !value.data?.errors?.length))))
  }
  const retryRelated = () => {
    writeCache(old => { const next = { ...old }; delete next[keys.related]; return next })
  }
  function readState(value, label, onRetry = tryAgain) {
    return <>{value.loading ? <Skeleton label={`Loading ${label}`} /> : null}{value.error ? <div role="alert"><p>{value.error}</p><button className="co-btn" onClick={value.stale ? onRefresh : onRetry}>{value.stale ? 'Refresh PR list' : 'Try again'}</button></div> : null}<ReadErrors errors={value.data?.errors} onRetry={onRetry} /></>
  }
  const ready = value => !value.loading && !value.error && !stale
  const description = entry(keys.description || '')
  const activity = entry(keys.activity || '')
  const threads = entry(keys.threads || '')
  const related = entry(keys.related || '')
  const view = entry(keys.view || '')
  const pager = (current, hasMore, unknown, set) => current > 1 || hasMore ? <div className="co-board-actions">
    {current > 1 ? <button className="co-btn" onClick={() => set(current - 1)}>Previous page</button> : null}
    {hasMore ? <button className="co-btn" onClick={() => set(current + 1)}>{unknown ? 'Check next page' : 'Next page'}</button> : null}
  </div> : null
  const labels = pr.labels?.nodes || []
  const tabs = [['conversation', 'Comments'], ['files', 'Files changed'], ['checks', 'Checks']]
  // GitHub-style tab badges: one neutral count pill per tab. Comments counts
  // the loaded conversation (comments and reviews); until it loads, GitHub's
  // issue-comment total stands in. Checks add a pass/fail dot before the pill;
  // the +added −removed totals live inside the Files tab, not on it.
  const checks = checkSummary(pr)
  // The conversation count reads its cached first page directly: switching to
  // Files or Checks must not drop it back to GitHub's issue-comment total.
  const loadedConversation = cache['activity:1']
  const tabCounts = {
    conversation: !loadedConversation?.loading && loadedConversation?.data?.items
      ? loadedConversation.data.items.length : (pr.comments?.totalCount ?? null),
    files: Number.isInteger(pr.changedFiles) ? pr.changedFiles : null,
  }
  const githubUrl = safeDetailLink(pr.url)
  // The conversation loads as one unit: a single skeleton stands in for the
  // description, the flag and the comments, and everything appears together.
  // A PR page holds the whole detail back instead of revealing it in parts.
  const conversationLoading = tab === 'conversation'
    && [description, activity, threads, related].some(value => value.loading)
  if (holdUntilLoaded && conversationLoading) {
    return <div className="co-pr-detail" aria-label={`Details for PR ${pr.number}`}>
      <Skeleton lines={8} label="Loading the pull request" />
    </div>
  }
  return <div className="co-pr-detail" aria-label={`Details for PR ${pr.number}`}>
    <header className="co-gh-pr-head">
      <h3 className="co-gh-pr-title">{pr.title} <span>#{pr.number}</span></h3>
      {labels.length ? <div className="co-gh-labels">{labels.map(label => <GithubLabel key={label.name} name={label.name} color={label.color} />)}</div> : null}
    </header>
    <div className="co-pr-detail-actions">
      {!readOnly ? <AgentMenu variant="button" align="start" disabled={stale} onChoose={mode => onReview?.(mode)} ariaLabel={`Choose what an agent does with PR ${pr.number}`} /> : null}
      {!readOnly && canAssign ? <button className="co-btn" disabled={stale} onClick={onAssign}><Icon name="person" /> Assign</button> : null}
      {status && onProgress ? <button className="co-btn" onClick={onProgress}>Agent progress</button> : null}
      {githubUrl ? <a className="co-btn" href={githubUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open on GitHub: PR ${pr.number}`}><Icon name="github" /> Open</a> : null}
      <PullProvenance record={record} onRecord={onRecord} conversations={provenance} />
    </div>
    <div className="co-gh-pr-sub"><PullStateBadge pr={pr} />
      <span className="co-branch-flow">{pr.headRefName ? <><code>{pr.headRefName}</code><Icon name="arrow-right" size={15} /></> : null}<code>{pr.baseRefName}</code></span>
      <span>by <b>{pr.author?.login || 'Someone'}</b></span></div>
    {conversationLoading ? null : <>
    <details className="co-gh-description">
      <summary>
        <span className="co-desc-title"><Icon name="chevron" size={14} />Description</span>
        <small>{openedLine(description.data?.user?.login || pr.author?.login, pr.createdAt)}</small>
      </summary>
      <div className="co-desc-content">
        {readState(description, 'description')}
        {ready(description) ? <ClampedMarkdown markdown={description.data?.body || '_No description provided._'} /> : null}
      </div>
    </details>
    <PullFeedbackFlag record={record} status={status} activity={ready(activity) ? activity.data : null} />
    </>}
    <nav className="co-detail-tabs" aria-label="Pull request details">{tabs.map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}
      {key === 'checks' && checks?.total ? <><span className={'co-tab-dot is-' + checks.state} title={`${checks.passed} of ${checks.total} checks passed or skipped`} aria-label={{ success: 'checks passed', failure: 'checks failing', pending: 'checks running' }[checks.state]} /><span className="co-tab-count">{checks.passed}/{checks.total}</span></> : null}
      {Number.isInteger(tabCounts[key]) ? <span className="co-tab-count">{tabCounts[key]}</span> : null}</button>)}</nav>
    <div className="co-pr-detail-body" role="region" aria-label="Pull request context">
    {stale ? <p role="alert">This PR changed since the list was loaded. <button className="co-btn" onClick={onRefresh}>Refresh PR list</button></p> : null}
    {tab === 'conversation' && conversationLoading ? <Skeleton lines={7} label="Loading the conversation" /> : null}
    {tab === 'conversation' && !conversationLoading ? <>
      {ready(activity) && !activity.data?.items?.length && number === 1 ? <p className="co-pr-note">No comments yet.</p> : null}
      {ready(activity) ? shownComments(activity.data?.items).map(item => <article className={'co-gh-comment' + reviewTone(item)} key={`${item.kind}:${item.id}`}><header><b>{item.user?.login || 'Contributor'}</b> {item.kind === 'review' ? (item.state || 'reviewed').toLowerCase().replaceAll('_', ' ') : 'commented'} <DateLabel value={item.date} time /><CopyId id={item.id} label={item.kind === 'review' ? 'review id' : 'comment id'} /></header>{item.body ? <div className="co-comment-body"><ClampedMarkdown markdown={item.body} /></div> : null}</article>) : null}
      {ready(activity) && (activity.data?.items?.length || 0) > COMMENT_PREVIEW ? <button type="button" className="co-comments-toggle" onClick={() => setAllComments(value => !value)}>
        {allComments ? 'Show less' : `Show all ${activity.data.items.length} comments`}
      </button> : null}
      {readState(activity, 'comments')}
      {ready(activity) && commentsOpen(activity.data?.items) ? pager(number, activity.data?.hasMore, false, value => setPage(old => ({ ...old, conversation: value }))) : null}
      {readState(threads, 'inline discussions')}
      {ready(threads) ? <><PullThreads data={threads.data} />{threadCursors.length > 1 || threads.data?.hasMore ? <div className="co-board-actions">{threadCursors.length > 1 ? <button className="co-btn" onClick={() => setThreadCursors(old => old.slice(0, -1))}>Previous discussions</button> : null}{threads.data.hasMore && threads.data.nextCursor ? <button className="co-btn" onClick={() => setThreadCursors(old => [...old, threads.data.nextCursor])}>More discussions</button> : null}</div> : null}</> : null}
      {readState(related, 'related issues', retryRelated)}
      {ready(related) ? <PullRelated data={related.data} /> : null}
      <p className="co-gh-merge-state">{[REVIEW_DECISION[pr.reviewDecision], pr.mergeable === 'CONFLICTING' ? 'Has merge conflicts' : pr.mergeable === 'MERGEABLE' ? 'No conflicts with base branch' : null].filter(Boolean).join(' · ')}</p>
    </> : null}
    {tab !== 'conversation' ? readState(view, tab === 'files' ? 'files' : 'checks') : null}
    {tab === 'files' && ready(view) ? <PullFiles data={view.data} /> : null}
    {tab === 'checks' && ready(view) ? <PullChecks data={view.data} /> : null}
    {tab !== 'conversation' && ready(view) ? pager(number, view.data?.hasMore, view.data?.paginationUnknown, value => setPage(old => ({ ...old, [tab]: value }))) : null}
    {tab === 'checks' && !view.loading ? <button className="co-quiet-action" onClick={() => { writeCache(old => { const next = { ...old }; delete next[keys.view]; return next }) }}>Refresh checks</button> : null}
    </div>
  </div>
}
