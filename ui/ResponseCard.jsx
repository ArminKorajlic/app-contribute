import { ReviewFrame } from './ReviewFrame.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { PullFiles } from './PullFiles.jsx'
import { openAgentConversation } from './BatchAction.jsx'
import { Icon } from './Icons.jsx'
import { RunTag } from './RunTag.jsx'
import { NAMES } from '../names.js'
import { chatStarting, planSteps, stepDone } from '../respond-result.js'

// A saved Respond-to-feedback answer on its PR's Review tab: what each point came to, the replies word for word, the commits and
// changed files, and what Post will do. Reading it is the owner's side of the approval; Post only writes the decision (respond-flow.js).
// How each point ended, in the Desk's own chips (green, plain, amber): their text is already checked for contrast.
const ENDINGS = { fixed: ['Fixed', ' is-ready'], not_valid: ['Not valid', ''], out_of_scope: ['Out of scope', ' is-waiting'] }
const HEADINGS = { ready: 'Replies ready', approved: 'Not started yet', posting: 'Posting…', failed: 'Posting stopped', stale: 'Out of date', posted: 'Posted' }
// Amber while it waits on you, travelling while it posts, plain once it is out of date or done.
const FRAMES = { ready: 'verdict', approved: 'verdict', failed: 'verdict', posting: 'reviewing', stale: 'idle', posted: 'idle' }
// For the first 30 s after Post the chat is only starting: the card says so (a spinner, the travelling frame) and offers no Send again.
const STARTING = { heading: 'Sent to the chat', line: 'The chat is starting. This takes a few seconds.' }
const PLAN_HEADINGS = { posting: 'What Post is doing', failed: 'What Post is doing', posted: 'What went out' }
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
const short = sha => String(sha).slice(0, 7)
const sentence = text => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)
const sum = (files, key) => files.reduce((total, file) => total + file[key], 0)

// The changed files in the shape the Files tab shows them.
const filesData = result => ({
  files: result.files.map(file => ({ filename: file.path, status: file.status, additions: file.added, deletions: file.removed, patch: file.patch, previous_filename: file.previous_path })),
  totals: { files: result.files.length, additions: sum(result.files, 'added'), deletions: sum(result.files, 'removed') },
})

function statusLine({ status, result }, pr, starting) {
  switch (status) {
    case 'ready': return `${plural(result.points.length, 'point', 'points')} answered · built on ${short(result.pr.head_sha)}`
    case 'stale': return `The PR changed after this answer (${short(result.pr.head_sha)} → ${short(pr.headRefOid)}). Nothing was posted.`
    case 'approved': return starting ? STARTING.line : 'The chat has not started yet. Send it again, or open the chat.'
    case 'posting': return 'The chat is posting this now. Each step is ticked as it is done. If nothing changes for a few minutes, open the chat and ask it to continue.'
    case 'failed': return `Stopped at ${result.error?.step || 'a step'}: ${sentence(result.error?.message || 'unknown error')} The ticked steps went out and a second try skips them. The step it stopped at may or may not have reached GitHub, so look at the PR there before you try again.`
    default: return 'Everything below went out.'
  }
}

// Why Post is off while the answer is otherwise ready.
function holdReason(chat) {
  if (chat?.state === 'needs_answer') return 'The conversation is waiting for your answer to its own card. Answer it in the chat first.'
  return chat?.state === 'running' ? 'The agent is working on this PR right now.' : ''
}

function Points({ points }) {
  return <ul className="co-response-points" aria-label="Points answered">
    {points.map((point, index) => <li key={index}>
      <span className={'co-desk-chip' + ENDINGS[point.ending][1]} data-ending={point.ending}>{ENDINGS[point.ending][0]}</span>
      <span className="co-response-point">
        <span><b>{point.reviewer}</b> · {point.title}</span>
        {point.answer ? <small>{point.answer}</small> : null}
        {point.commit ? <small>Commit <code>{short(point.commit)}</code></small> : null}
      </span>
    </li>)}
  </ul>
}

function Details({ result, open }) {
  const { commits, files, replies, description } = result
  return <>
    <details className="co-task-details" open={open}><summary>{plural(replies.length, 'reply', 'replies')}, word for word</summary>
      {replies.map((reply, index) => <div className="co-response-reply" key={index}>
        {reply.reply_to ? <small>In reply to comment {reply.reply_to}</small> : null}<MarkdownView markdown={reply.body} /></div>)}
    </details>
    {description !== null ? <details className="co-task-details"><summary>New description</summary><MarkdownView markdown={description} /></details> : null}
    {commits.length || files.length ? <details className="co-task-details"><summary>Changes: {plural(commits.length, 'commit', 'commits')} · {plural(files.length, 'file', 'files')} · +{sum(files, 'added')} −{sum(files, 'removed')}</summary>
      <ul className="co-response-commits">{commits.map(commit => <li key={commit.sha}><code>{short(commit.sha)}</code> {commit.title}</li>)}</ul>
      <PullFiles data={filesData(result)} />
    </details> : null}
    {result.tests ? <p className="co-review-note">Checked: {result.tests}</p> : null}
  </>
}

// The steps, ticked as the helper records them once Post has started; otherwise just the plan.
function Steps({ result, status }) {
  const going = ['posting', 'failed', 'posted'].includes(status)
  return <div className="co-response-plan">
    <h5>{PLAN_HEADINGS[status] || 'What Post will do, in this order'}</h5>
    <ol className={'co-response-steps' + (going ? ' is-going' : '')}>
      {planSteps(result).map(step => {
        const done = status === 'posted' || stepDone(result, step.key)
        return <li key={step.key} className={going ? 'is-' + (done ? 'done' : 'todo') : undefined}>
          {going ? <span className="co-step-mark" aria-hidden="true">{done ? <Icon name="check" size={13} /> : null}</span> : null}
          <span>{step.text}{going ? <span className="co-visually-hidden">{done ? ' — done' : ' — not done yet'}</span> : null}</span>
        </li>
      })}
    </ol>
    {status === 'posted' ? <ul className="co-response-links">
      {result.receipts.replies.map(reply => <li key={reply.index}><a href={reply.url} target="_blank" rel="noopener noreferrer">Reply {reply.index + 1}</a></li>)}
    </ul> : null}
  </div>
}

function Actions({ view, chat, busy, readOnly, starting, onPost, onDiscard, onRespondAgain }) {
  const { status, result } = view
  const blocked = holdReason(chat)
  const chatButton = label => <button key={label} type="button" className="co-btn" onClick={() => openAgentConversation(result.chat_id)}>{label}</button>
  if (readOnly || status === 'posted') return null
  const buttons = {
    ready: [<button key="post" type="button" className="co-btn co-btn-primary" disabled={busy || !!blocked} onClick={() => onPost(false)}>{busy ? 'Working…' : NAMES.postAnswer}</button>, chatButton(NAMES.replyInChat),
      <button key="discard" type="button" className="co-btn co-btn-quiet" disabled={busy} onClick={onDiscard}>{NAMES.discard}</button>],
    approved: starting ? [chatButton(NAMES.openChat)] : [<button key="again" type="button" className="co-btn co-btn-primary" disabled={busy} onClick={() => onPost(true)}>{busy ? 'Working…' : NAMES.sendAgain}</button>, chatButton(NAMES.openChat)],
    failed: [<button key="retry" type="button" className="co-btn co-btn-primary" disabled={busy} onClick={() => onPost(true)}>{busy ? 'Working…' : NAMES.tryAgain}</button>, chatButton(NAMES.openChat)],
    posting: [chatButton(NAMES.openChat)],
    // A second pass is offered only when the PR logic still allows one.
    stale: [onRespondAgain ? <button key="again" type="button" className="co-btn co-btn-primary" disabled={busy} onClick={onRespondAgain}>{NAMES.respondAgain}</button> : null,
      <button key="discard" type="button" className="co-btn co-btn-quiet" disabled={busy} onClick={onDiscard}>{NAMES.discard}</button>],
  }[status]
  return <>
    {status === 'ready' && blocked ? <p className="co-review-note" role="status">{blocked}</p> : null}
    <div className="co-review-actions">{buttons}</div>
  </>
}

// `now` is the time the card judges "just sent" by (the tests set it).
export function ResponseCard({ pr, response: view, chat = null, busy = false, error = '', readOnly = false, now = Date.now(), onPost, onDiscard, onRespondAgain }) {
  const { status, result } = view
  // While the chat holds the PR (it works, or waits on a card of its own) its box above is the one that asks for you.
  const held = status === 'ready' && Boolean(holdReason(chat))
  // A failed message to the chat is no "starting": Send again is offered at once, with the error.
  const starting = chatStarting(view, now) && !error
  const asks = ['ready', 'approved', 'failed'].includes(status) && !held && !starting
  return <ReviewFrame state={held ? 'idle' : starting ? 'reviewing' : FRAMES[status]} radius={12}>
    <div className={'co-review-box co-response is-' + status + (asks ? ' is-verdict' : '')} aria-label="Answer to the feedback">
      <RunTag kind={NAMES.respond} at={result.created_at} />
      <div className="co-review-head">
        {status === 'posting' || starting ? <span className="co-arc" aria-hidden="true" /> : null}
        <h4>{starting ? STARTING.heading : HEADINGS[status]}</h4>
        <span className="co-review-version">{short(result.pr.head_sha)}{status === 'posted' && result.tip_sha ? ` → ${short(result.tip_sha)}` : ''}</span>
      </div>
      <p className="co-review-note">{statusLine(view, pr, starting)}</p>
      {status === 'ready' ? <p className="co-response-fresh">The PR has not changed since this answer.</p> : null}
      {status === 'posted' ? null : <Points points={result.points} />}
      {status === 'posted' ? null : <Details result={result} open={['ready', 'approved', 'stale'].includes(status)} />}
      {status === 'stale' ? null : <Steps result={result} status={status} />}
      {error ? <p role="alert" className="co-run-error">{error}</p> : null}
      <Actions view={view} chat={chat} busy={busy} readOnly={readOnly} starting={starting} onPost={onPost} onDiscard={onDiscard} onRespondAgain={onRespondAgain} />
    </div>
  </ReviewFrame>
}
