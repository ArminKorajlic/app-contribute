// The PR machine: the one place that decides where a PR stands for you and what
// you may do next. Every screen renders `decide(facts)`; the platform runs the
// same table (contribution_pr_machine.py) before every effect it performs, and
// both are held to the same cases (test/pr-machine.cases.json).
//
// Facts come from pr-facts.js. A fact that could not be read is 'unknown' and
// never enables anything that needs it.
//
// The rules, in plain words:
//   - Your role decides everything: your PR (author) or theirs (reviewer). An
//     author never gets a public review action; an agent's check of your PR is private.
//   - Merging needs an approval of this exact version by someone other than the
//     author (bots never count), no change request still standing, checks that
//     pass (or none exist), no conflicts, and nothing unconfirmed on its way out.
//   - Only new commits bring their PR back for re-review; replies never do.
//   - One agent job per PR at a time.
//   - A draft that deals with the open findings (a prepared fix, a ready answer built on them, a verdict
//     drafted from them) owns them while it waits or is on its way: no agent job starts and the findings are
//     not set aside until you send it or throw it away. The app marks such a draft `covers`.
// Pure: no DOM, no network.
import { NAMES, rerunName } from './names.js'

const WRITE = ['WRITE', 'MAINTAIN', 'ADMIN']
const MAINTAINER = ['MAINTAIN', 'ADMIN']
export const mayWrite = permission => WRITE.includes(permission)

// The few values every rule below is written in.
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

function derive(facts) {
  const people = (facts.reviews || []).filter(review => !review.bot && !same(review.by, facts.author))
  const atHead = review => review.commit === facts.head
  const names = test => [...new Map(people.filter(test).map(review => [String(review.by).toLowerCase(), review.by])).values()]
  const result = facts.result?.head === facts.head ? facts.result : null
  const outbox = facts.outbox?.head === facts.head ? facts.outbox : null
  return {
    approvedAtHead: names(review => review.state === 'APPROVED' && atHead(review)),
    approvedOlder: names(review => review.state === 'APPROVED' && !atHead(review)),
    changesAtHead: names(review => review.state === 'CHANGES_REQUESTED' && atHead(review)),
    changesOlder: names(review => review.state === 'CHANGES_REQUESTED' && !atHead(review)),
    mine: facts.myReview || null,
    mineAtHead: !!facts.myReview && facts.myReview.commit === facts.head,
    result,
    openFindings: result?.outcome === 'findings' && !result.setAside,
    outbox,
    coveredBy: outbox?.covers ? outbox.kind : '',
    botFindings: (facts.reviews || []).some(review => review.bot && review.state !== 'APPROVED'),
  }
}

// Every state. turn: you | agent | other | none. `label` is the short chip on a row,
// `headline` the line under a PR's title, `next` the highlighted action.
export const STATES = {
  merged: { turn: 'none', label: 'Merged', headline: 'Merged' },
  closed: { turn: 'none', label: 'Closed', headline: 'Closed' },
  unknown: { turn: 'you', label: 'Couldn’t read', headline: 'Couldn’t read this PR from GitHub. Try again', next: 'retry' },
  unconfirmed: { turn: 'you', label: 'Not confirmed', headline: 'GitHub didn’t confirm what was sent. Check GitHub before trying again', next: 'check_github' },
  sending: { turn: 'agent', label: 'Sending', headline: 'Sending to GitHub…' },
  to_confirm: { turn: 'you', label: 'Draft to send', headline: 'A draft is ready. Read it, then send it or throw it away', next: 'send_draft' },
  working: { turn: 'agent', label: 'Agent working', headline: 'An agent is working on it' },
  needs_answer: { turn: 'you', label: 'Agent asks you', headline: 'The agent has a question for you', next: 'open_job' },
  stalled: { turn: 'you', label: 'Agent stopped', headline: 'The agent stopped before it finished. Run it again', next: 'rerun_job' },

  'author.draft': { turn: 'you', label: 'Draft', headline: 'Your PR · a draft. Check it first', next: 'check_my_pr' },
  'author.draft_ready': { turn: 'you', label: 'Ready to open', headline: 'Your PR · checked and clean. Open it for review', next: 'open_for_review' },
  'author.findings': { turn: 'you', label: 'Findings', headline: 'Your PR · your check found problems. Fix them or set them aside', next: 'respond' },
  'author.blocked': { turn: 'you', label: 'Checks or conflicts', headline: 'Your PR · checks fail or it conflicts. Fix it', next: 'respond' },
  'author.feedback': { turn: 'you', label: 'Feedback to answer', headline: 'Your PR · feedback is waiting. Answer every point', next: 'respond' },
  'author.waiting_rereview': { turn: 'other', label: 'Fixes pushed', headline: 'Your PR · fixes pushed. Waiting on {who} to review again' },
  'author.approval_stale': { turn: 'other', label: 'Approval is old', headline: 'Your PR · approved on an older version. Waiting on {who} to look again' },
  'author.waiting_review': { turn: 'other', label: 'Waiting on reviewers', headline: 'Your PR · waiting on reviewers' },
  'author.approved_checks': { turn: 'other', label: 'Approved', headline: 'Your PR · approved. {checks}' },
  'author.approved': { turn: 'you', label: 'Ready to merge', headline: 'Your PR · approved by {who} at this version, {green}. Merge it', next: 'merge' },
  'author.approved_no_rights': { turn: 'other', label: 'Approved', headline: 'Your PR · approved, {green}. Waiting on someone who can merge' },

  'reviewer.draft': { turn: 'other', label: 'Draft', headline: 'Their PR · still a draft' },
  'reviewer.to_review': { turn: 'you', label: 'To review', headline: 'Their PR · your turn: review it', next: 'review' },
  'reviewer.result_ready': { turn: 'you', label: 'Review ready', headline: 'Their PR · your review is ready. Send a verdict or keep it private', next: 'draft_verdict' },
  'reviewer.waiting_author': { turn: 'other', label: 'Waiting on {author}', headline: 'Their PR · you asked for changes. Waiting on {author}' },
  'reviewer.re_review': { turn: 'you', label: 'New commits · review again', headline: 'Their PR · new commits since your review. Review again', next: 'review' },
  'reviewer.reviewed': { turn: 'none', label: 'Reviewed', headline: 'Their PR · you reviewed this version' },
  'reviewer.kept_private': { turn: 'none', label: 'Kept private', headline: 'Their PR · you kept your review of this version private' },
  'reviewer.mergeable': { turn: 'you', label: 'Ready to merge', headline: 'Their PR · approved at this version, {green}. Merge it', next: 'merge' },
}

// A drafted repair is a fix an agent prepared: the same state as any draft, in the words of a push.
// Only the app sees prepared fixes (the platform's facts never carry an outbox), so this stays here.
const FIX_WAITING = { label: 'Fix to push', headline: 'A fix is ready. Read it, then push it or don’t' }
const wordsOf = (key, d) => (key === 'to_confirm' && d.outbox?.kind === 'repair' ? { ...STATES[key], ...FIX_WAITING } : STATES[key])

// The state, by a fixed priority: the first match wins.
function stateOf(facts, d) {
  if (facts.lifecycle === 'merged' || facts.lifecycle === 'closed') return facts.lifecycle
  if (facts.lifecycle === 'unknown' || facts.readComplete === false) return 'unknown'
  const outboxState = { unconfirmed: 'unconfirmed', sending: 'sending', drafted: 'to_confirm' }[d.outbox?.state]
  if (outboxState) return outboxState
  if (facts.job) return { running: 'working', needs_answer: 'needs_answer', stalled: 'stalled' }[facts.job.state] || 'working'
  return facts.role === 'author' ? authorStanding(facts, d) : reviewerStanding(facts, d)
}

function authorStanding(facts, d) {
  if (facts.lifecycle === 'draft') return d.openFindings ? 'author.findings' : d.result?.outcome === 'clear' ? 'author.draft_ready' : 'author.draft'
  if (d.openFindings) return 'author.findings'
  if (facts.checks === 'fail' || facts.mergeable === 'conflict') return 'author.blocked'
  if (d.changesAtHead.length || facts.openThreads > 0) return 'author.feedback'
  if (d.changesOlder.length) return 'author.waiting_rereview'
  if (d.approvedAtHead.length) return approvedStanding(facts)
  if (d.approvedOlder.length) return 'author.approval_stale'
  return 'author.waiting_review'
}

function approvedStanding(facts) {
  if (!['pass', 'none'].includes(facts.checks) || facts.mergeable !== 'yes') return 'author.approved_checks'
  return mayWrite(facts.permission) ? 'author.approved' : 'author.approved_no_rights'
}

// Your verdict on this version comes first, then a finished review of this version
// (a re-review that is done is no longer "new commits"), then an older review of yours.
function reviewerStanding(facts, d) {
  if (d.mineAtHead && d.mine.state === 'CHANGES_REQUESTED') return 'reviewer.waiting_author'
  if (d.mineAtHead) return mergeBlocker(facts, d) ? 'reviewer.reviewed' : 'reviewer.mergeable'
  if (d.result) return d.result.setAside ? 'reviewer.kept_private' : 'reviewer.result_ready'
  if (d.mine) return 'reviewer.re_review'
  return facts.lifecycle === 'draft' ? 'reviewer.draft' : 'reviewer.to_review'
}

const CHECK_WORDS = { pass: '', none: '', fail: 'Checks are failing.', pending: 'Checks are still running.', unknown: 'Checks could not be read. Try again.' }
const CONFLICT_WORDS = { yes: '', conflict: 'It has merge conflicts.', unknown: 'GitHub hasn’t worked out conflicts yet. Try again.' }
const firstReason = (...reasons) => reasons.find(Boolean) || ''
// A stalled job holds nothing: starting again (or another job) is the way out of it.
const jobIdle = facts => (facts.job && facts.job.state !== 'stalled' ? 'An agent is already working on this PR.' : '')
// Something sent to GitHub but not yet confirmed: no new agent job may race it.
const nothingInFlight = d => (d.outbox && d.outbox.state !== 'drafted' ? 'Something sent to GitHub is not confirmed yet.' : '')
// A draft that deals with the open findings owns them, in every step of its way out. The fact is the app's alone:
// the platform never sees drafts, so its table has no such rule and every case it shares with this one is unchanged.
const OWNED_BY_DRAFT = {
  drafted: 'A waiting draft already deals with these findings. Send it or throw it away first.',
  sending: 'A draft that deals with these findings is being sent.',
  unconfirmed: 'A draft that deals with these findings is not confirmed yet. Check GitHub first.',
}
const draftOwnsFindings = d => (d.outbox?.covers ? OWNED_BY_DRAFT[d.outbox.state] || '' : '')
const stillOpen = facts => (['open', 'draft'].includes(facts.lifecycle) ? '' : 'This PR is no longer open.')
const readable = facts => (facts.lifecycle === 'unknown' || facts.readComplete === false ? 'This PR could not be read. Try again.' : '')

// Why Merge cannot run, in order; '' when it may.
export function mergeBlocker(facts, d = derive(facts)) {
  const standing = [...d.changesAtHead, ...d.changesOlder]
  return firstReason(
    readable(facts),
    facts.lifecycle === 'draft' ? 'Open it for review first.' : stillOpen(facts),
    mayWrite(facts.permission) ? '' : 'Needs merge rights.',
    d.approvedAtHead.length ? '' : d.approvedOlder.length ? 'The approval is for an older version.' : 'Nobody but the author has approved it yet.',
    standing.length ? `${standing.join(', ')} asked for changes and hasn’t approved since.` : '',
    CHECK_WORDS[facts.checks] ?? CHECK_WORDS.unknown,
    CONFLICT_WORDS[facts.mergeable] ?? CONFLICT_WORDS.unknown,
    nothingInFlight(d),
    jobIdle(facts),
  )
}

const somethingToAnswer = (facts, d) => d.openFindings || d.changesAtHead.length || facts.openThreads > 0
  || facts.checks === 'fail' || facts.mergeable === 'conflict' || d.botFindings
const outboxIs = (d, state) => (d.outbox?.state === state ? '' : 'Nothing like that is waiting.')

// Every action. `by` says who acts: an agent job, or your own tap (each behind a
// confirm sheet). `when` returns '' when allowed, otherwise the reason it is not.
export const ACTIONS = [
  { id: 'check_my_pr', by: 'agent', roles: ['author'], title: NAMES.review, detail: 'Private. Nothing is posted.',
    when: (facts, d) => firstReason(readable(facts), stillOpen(facts), jobIdle(facts), nothingInFlight(d), draftOwnsFindings(d)) },
  { id: 'respond', by: 'agent', roles: ['author'], title: NAMES.respond, detail: 'Answers every point, then one approval sheet for the pushes and replies.',
    when: (facts, d) => firstReason(readable(facts), stillOpen(facts), jobIdle(facts), nothingInFlight(d), draftOwnsFindings(d), somethingToAnswer(facts, d) ? '' : 'Nothing to respond to.') },
  { id: 'finish_it', by: 'agent', roles: ['author'], title: NAMES.finishIt, detail: 'Responds, checks and fixes. Stops for your approval before each push.',
    when: (facts, d) => firstReason(readable(facts), stillOpen(facts), mayWrite(facts.permission) ? '' : 'Needs write access to this repository.', jobIdle(facts), nothingInFlight(d), draftOwnsFindings(d)) },
  { id: 'review', by: 'agent', roles: ['reviewer'], title: d => (d.mine || d.result ? NAMES.reviewAgain : NAMES.review), detail: 'Private, drafted for you, or posted by the agent if you allow it.',
    when: (facts, d) => firstReason(readable(facts), stillOpen(facts), jobIdle(facts), nothingInFlight(d), draftOwnsFindings(d)) },
  { id: 'take_over', by: 'agent', roles: ['reviewer'], title: NAMES.takeOver, detail: 'Maintainers only. Needs a reason, and says so on the PR. Each push needs your approval.',
    when: (facts, d) => firstReason(readable(facts), stillOpen(facts), MAINTAINER.includes(facts.permission) ? '' : 'Only maintainers can take over someone else’s PR.', jobIdle(facts), nothingInFlight(d), draftOwnsFindings(d)) },

  { id: 'send_draft', by: 'you', roles: ['author', 'reviewer'], title: 'Send…', when: (facts, d) => outboxIs(d, 'drafted') },
  { id: 'check_github', by: 'you', roles: ['author', 'reviewer'], title: 'Check GitHub', when: (facts, d) => outboxIs(d, 'unconfirmed') },
  // Only an unconfirmed verdict can be set aside here; other outcomes settle by checking GitHub.
  { id: 'dismiss', by: 'you', roles: ['author', 'reviewer'], title: NAMES.discard, when: (facts, d) => outboxIs(d, 'unconfirmed') || (d.outbox.kind === 'verdict' ? '' : 'Only a verdict can be discarded.') },
  { id: 'draft_verdict', by: 'you', roles: ['reviewer'], title: 'Approve, request changes or comment…',
    when: (facts, d) => firstReason(readable(facts), d.result && !d.mineAtHead && !d.outbox ? '' : 'Review this version first.') },
  { id: 'set_aside', by: 'you', roles: ['author', 'reviewer'], title: 'Set aside…',
    when: (facts, d) => firstReason(readable(facts), d.result && !d.result.setAside && (facts.role === 'reviewer' || d.openFindings) ? '' : 'Nothing to set aside.', draftOwnsFindings(d)) },
  { id: 'open_for_review', by: 'you', roles: ['author'], title: NAMES.openForReview, when: facts => firstReason(readable(facts), facts.lifecycle === 'draft' ? jobIdle(facts) : 'It is already open for review.') },
  { id: 'back_to_draft', by: 'you', roles: ['author'], title: NAMES.backToDraft, when: facts => firstReason(readable(facts), facts.lifecycle === 'open' ? jobIdle(facts) : 'It is not open for review.') },
  { id: 'ask_rereview', by: 'you', roles: ['author'], title: NAMES.askRereview,
    when: (facts, d) => (d.changesOlder.length || d.approvedOlder.length ? firstReason(readable(facts), stillOpen(facts)) : 'Nobody reviewed an older version.') },
  { id: 'merge', by: 'you', roles: ['author', 'reviewer'], title: NAMES.merge, when: (facts, d) => mergeBlocker(facts, d) },
  { id: 'close', by: 'you', roles: ['author', 'reviewer'], title: NAMES.closePr, detail: 'Asks you to confirm first.',
    when: facts => firstReason(readable(facts), stillOpen(facts), facts.role === 'author' || mayWrite(facts.permission) ? '' : 'Needs write access.', jobIdle(facts)) },
  { id: 'retry', by: 'you', roles: ['author', 'reviewer'], title: 'Try again', when: facts => (readable(facts) ? '' : 'Already up to date.') },
  { id: 'open_job', by: 'you', roles: ['author', 'reviewer'], title: 'Answer the agent', when: facts => (facts.job?.state === 'needs_answer' ? '' : 'No question is waiting.') },
  { id: 'rerun_job', by: 'you', roles: ['author', 'reviewer'], title: (d, facts) => rerunName(facts.job?.kind), when: facts => (facts.job?.state === 'stalled' ? '' : 'Nothing has stalled.') },
]

// The people a headline names: who approved this version, or whose review is of an older one.
const headlineWho = (key, d) => ({ 'author.waiting_rereview': d.changesOlder, 'author.approval_stale': d.approvedOlder, 'author.approved': d.approvedAtHead }[key] || [])

function headlineFor(key, facts, d) {
  const checks = facts.mergeable === 'yes' ? CHECK_WORDS[facts.checks] || 'Checks are still running.' : CONFLICT_WORDS[facts.mergeable] || CONFLICT_WORDS.unknown
  return wordsOf(key, d).headline.replace('{who}', headlineWho(key, d).join(', ') || 'reviewers').replace('{author}', facts.author || 'the author')
    .replace('{checks}', checks).replace('{green}', facts.checks === 'none' ? 'no checks' : 'checks green')
}

// The one entry point: facts in, { role, state, turn, label, headline, next, jobKind, coveredBy, waitingOn, actions,
// approvedBy, rereviewFrom } out. `jobKind` is the kind of the PR's agent job ('' when none); `coveredBy` the kind of
// draft that owns the open findings (repair, answer, verdict; '' when none). The last two name people: who approved this version, and
// whose review is of an older one.
export function decide(facts) {
  const d = derive(facts)
  const key = stateOf(facts, d)
  const state = wordsOf(key, d)
  const actions = ACTIONS.filter(action => action.roles.includes(facts.role)).map(action => {
    const reason = action.when(facts, d)
    const title = typeof action.title === 'function' ? action.title(d, facts) : action.title
    return { id: action.id, by: action.by, title, detail: action.detail || '', enabled: !reason, reason, highlighted: action.id === state.next && !reason }
  })
  const waitingOn = state.turn !== 'other' ? '' : facts.role === 'reviewer' ? facts.author || 'the author' : headlineWho(key, d).join(', ') || 'reviewers'
  const label = state.label.replace('{author}', facts.author || 'the author')
  return { role: facts.role, state: key, turn: state.turn, label, headline: headlineFor(key, facts, d), next: state.next || '', jobKind: facts.job?.kind || '', coveredBy: d.coveredBy, waitingOn, actions,
    approvedBy: d.approvedAtHead, rereviewFrom: [...new Set([...d.changesOlder, ...d.approvedOlder])] }
}


// What the platform asks before an effect: '' when allowed, otherwise the reason.
export function actionBlocker(facts, actionId) {
  const action = decide(facts).actions.find(item => item.id === actionId)
  if (!action) return `You can’t do that as the ${facts.role === 'author' ? 'author' : 'reviewer'} of this PR.`
  return action.reason
}

export const actionOf = (decision, id) => decision.actions.find(action => action.id === id) || null
