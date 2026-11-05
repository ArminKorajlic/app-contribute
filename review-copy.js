import { NAMES } from './names.js'
// The words of the agent review window, derived from the exact choice the
// owner is about to approve. One place decides them so the steps, the "Seen on
// GitHub" summary and the start button can never disagree with each other.
//
// mode: 'review' | 'review_merge' | 'review_fix_merge' (the platform modes).
// intent: the PR machine's action that opened the window (review, check_my_pr,
//   finish_it, take_over).
// posting + verdict: the agent drafts approve, request changes or comment for
//   you to send; with agentPosts it sends that verdict itself, as you allowed.
// posting alone: an older saved grant that may post one plain comment.

// A live list binds unchanged PR heads to the current tip of their target
// branch at the start; a saved selection stays pinned to its exact versions.
function versionNote(count, bindCurrentTarget, merges) {
  if (!bindCurrentTarget) return 'It uses these exact versions. Changed code needs a fresh approval.'
  const prs = count === 1 ? 'the PR exactly as it is' : 'the PRs exactly as they are'
  const code = count === 1 ? 'its code changes' : 'their code changes'
  const target = merges ? ' and merges into the newest version of the target branch' : ''
  return `It uses ${prs} now${target}. If ${code} before the start, you confirm again.`
}

// Finish it for me (your PR) and Take over (theirs): the agent fixes, but every
// push waits for your approval, and only you merge or open a draft for review.
function takeoverCopy({ count, bindCurrentTarget, intent = '' }) {
  const it = count === 1 ? 'the PR' : 'each PR'
  const theirs = intent === 'take_over'
  const steps = [
    ...(theirs ? [{ text: 'Your reason is posted on the PR when you start, so its author knows.' }] : []),
    { text: `The agent reviews ${it}${theirs ? '' : ' and answers its feedback'}.` },
    { text: 'It prepares fixes, and a second agent reviews every fix.' },
    { text: 'Each push waits for your approval: you see what it will push, then tap Push.', added: true },
    { text: `When it is clean, it stops. You merge ${it} yourself.` },
  ]
  const scope = count === 1 ? 'this PR' : 'these PRs'
  return {
    title: theirs ? 'Take over' : 'Finish it for me',
    steps,
    publicEffect: { tone: 'public', text: `${theirs ? 'your reason as a comment, then ' : ''}only the fixes you approve, pushed to ${scope}. It never merges and never changes a draft.` },
    startLabel: theirs ? 'Take it over' : 'Start, ask me before each push',
    footnote: `You can stop it at any time. A push you already approved may finish. ${versionNote(count, bindCurrentTarget, false)}`,
  }
}

// The grant covers every selected PR, so a batch can merge or comment on each one.
function reviewPublicEffect({ merge, posting, verdict, agentPosts, count }) {
  const each = count === 1 ? '' : ' per PR'
  const merges = count === 1 ? 'the merge' : 'the merge of each PR'
  if (verdict && agentPosts) return { tone: 'public', text: `one approve, request changes or comment${each}, posted by the agent from your account as you allowed. No code changes.` }
  if (verdict) return { tone: 'public', text: `only the verdict${each} you send, from your account${merge ? `, then ${merges}` : ''}. Nothing is posted before you send it. No code changes.` }
  // An older saved grant: only a verdict the agent marks public is posted.
  if (posting) return { tone: 'public', text: `at most one review comment${each} from your account, only for a verdict the agent marks as public${merge ? `, then ${merges}` : ''}. Questions to you and unverified results stay private. It never approves or asks for changes.` }
  if (merge) return { tone: 'public', text: `${merges}. No comments and no code changes.` }
  return { tone: 'private', text: 'nothing. Only you see the review.' }
}

function postingStep(count) {
  if (count === 1) return 'If it is sure about its verdict, it posts one comment on GitHub from your account.'
  return 'For each PR whose verdict it is sure about, it posts one comment on that PR from your account.'
}

function verdictStep(count, agentPosts) {
  const it = count === 1 ? 'the PR' : 'each PR'
  if (agentPosts) return `It posts its verdict on ${it} from your account: approve, request changes or comment.`
  return `It drafts a verdict for ${it}, with the words it would post. You send it, change it to a comment, or throw it away; nothing is posted before that.`
}

function mergeStep({ count, posting, verdict }) {
  const it = count === 1 ? 'the PR' : 'each PR'
  if (verdict) return `Only after you submit an approval, and once all required checks pass, it merges ${it} or adds it to the merge queue.`
  if (posting) return `If the review is clean, it posts it first. Once GitHub shows that review and all required checks pass, it merges ${it} or adds it to the merge queue.`
  return `If the review is clean and all required checks pass, it merges ${it} or adds it to the merge queue.`
}

function reviewStartLabel({ merge, posting, verdict, agentPosts }) {
  if (merge && verdict) return 'Start review, merge after your approval'
  if (verdict && agentPosts) return 'Start review, agent posts its verdict'
  if (merge && posting) return 'Start review, post and merge when safe'
  if (merge) return 'Start review, merge when safe'
  if (verdict) return 'Start review, draft a verdict for me'
  if (posting) return 'Start review, allow comment'
  return 'Start private review'
}

const INTENT_TITLES = { review: NAMES.review, check_my_pr: NAMES.review }

export function reviewWindowCopy({ mode, intent = '', posting = false, verdict = false, agentPosts = false, count = 1, bindCurrentTarget = false }) {
  if (mode === 'review_fix_merge') return takeoverCopy({ count, bindCurrentTarget, intent })
  const merge = mode === 'review_merge'
  const proposing = posting && verdict
  const agent = proposing && agentPosts && !merge
  const it = count === 1 ? 'the PR' : 'each PR'
  const steps = [
    { text: `The agent reads ${it}: the code, the checks and the discussion.` },
    { text: 'It writes its findings for you in a private conversation.' },
    ...(proposing ? [{ text: verdictStep(count, agent), added: true }] : posting ? [{ text: postingStep(count), added: true }] : []),
    ...(merge ? [{ text: mergeStep({ count, posting, verdict: proposing }), added: true }] : []),
    { text: 'If it has a question, it asks you first.' },
  ]
  return {
    title: INTENT_TITLES[intent] || 'Review',
    steps,
    publicEffect: reviewPublicEffect({ merge, posting, verdict: proposing, agentPosts: agent, count }),
    startLabel: reviewStartLabel({ merge, posting, verdict: proposing, agentPosts: agent }),
    footnote: versionNote(count, bindCurrentTarget, merge),
  }
}

// The hint under the "Merge after I approve" switch, per selected PR for a batch.
export function reviewSwitchHints(count = 1) {
  return { merge: count === 1
    ? 'Once you send an approval and all required checks pass, it merges or queues the PR. It does not change any code.'
    : 'Once you send an approval and all required checks pass, it merges or queues each PR. It does not change any code.' }
}

// Why "Merge when safe" cannot be switched on right now, or '' when it can.
// postingBlocks: this Möbius cannot yet post and merge in one run.
export function mergeWhenSafeBlocker({ drafts, mayMergeAll, postingBlocks = false, notDrafting = false }) {
  if (drafts) return 'Not available for drafts.'
  if (notDrafting) return 'Merging follows your own approval: choose “Draft for me”.'
  if (!mayMergeAll) return 'Needs merge rights on this repository.'
  if (postingBlocks) return 'Posting and merging together needs a newer Möbius.'
  return ''
}

// Words for a proposed verdict waiting on you, and what submitting does.
const VERDICT_WORDS = { APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes', COMMENT: 'Comment' }
export function verdictCopy(proposal, mode) {
  const approve = proposal?.event === 'APPROVE'
  const action = VERDICT_WORDS[proposal?.event] || 'Request changes'
  const states = {
    proposed: `Proposed verdict: ${action}. Nothing is on GitHub yet.`,
    posting: `Submitting ${action.toLowerCase()} on GitHub…`,
    posted: `${action} submitted on GitHub.`,
    unknown: 'GitHub did not confirm the verdict. Contribute keeps checking, and nothing will be sent again. If GitHub shows nothing an hour after you submitted, it is dropped.',
    not_dispatched: proposal?.summary || 'The verdict was not sent.',
    discarded: mode === 'review_merge' ? 'You discarded the verdict. Nothing was posted or merged.' : 'You discarded the verdict. Nothing was posted.',
  }
  return {
    status: states[proposal?.state] || '',
    submit: approve ? 'Approve on GitHub' : proposal?.event === 'COMMENT' ? 'Comment on GitHub' : 'Request changes on GitHub',
    comment: 'Send as a comment instead',
    note: approve && mode === 'review_merge'
      ? 'Submitting posts this approval from your account. The review then merges the PR only if all required checks pass.'
      : 'Submitting posts this from your account, exactly as shown.',
  }
}
