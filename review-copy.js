// The words of the agent review window, derived from the exact choice the
// owner is about to approve. One place decides them so the steps, the "Seen on
// GitHub" summary and the start button can never disagree with each other.
//
// mode: 'review' | 'review_merge' | 'review_fix_merge' (the platform modes).
// posting: the review may post one comment (Review only, with or without merge).
// verdict: instead of a comment it proposes approve or request changes, which
//   you submit or discard yourself; nothing is posted before that.
// draftScope: a takeover that may mark drafts ready for review.

// A live list binds unchanged PR heads to the current tip of their target
// branch at the start; a saved selection stays pinned to its exact versions.
function versionNote(count, bindCurrentTarget, merges) {
  if (!bindCurrentTarget) return 'It uses these exact versions. Changed code needs a fresh approval.'
  const prs = count === 1 ? 'the PR exactly as it is' : 'the PRs exactly as they are'
  const code = count === 1 ? 'its code changes' : 'their code changes'
  const target = merges ? ' and merges into the newest version of the target branch' : ''
  return `It uses ${prs} now${target}. If ${code} before the start, you confirm again.`
}

function takeoverCopy({ count, draftScope, bindCurrentTarget }) {
  const it = count === 1 ? 'the PR' : 'each PR'
  const steps = [
    { text: `The agent reviews ${it}.` },
    { text: 'It pushes fixes for what it finds to the PR’s branch.' },
    { text: 'A second agent reviews every fix.' },
    ...(draftScope ? [{ text: 'It marks the draft ready for review.' }] : []),
    { text: `When the review is clean and all required checks pass, it merges ${it} or adds it to the merge queue.` },
  ]
  const scope = count === 1 ? 'this PR' : 'these PRs'
  return {
    title: 'Review, fix and merge',
    steps,
    publicEffect: {
      tone: 'public',
      text: `the pushed fixes${draftScope ? ', the draft marked ready (this may notify reviewers)' : ''} and ${count === 1 ? 'the merge' : 'the merge of each PR'}. No comments, and nothing outside ${scope}.`,
    },
    startLabel: 'Allow fix and merge',
    footnote: `You can stop it at any time. An action already underway may finish. ${versionNote(count, bindCurrentTarget, true)}`,
  }
}

// The grant covers every selected PR, so a batch can merge or comment on each one.
function reviewPublicEffect({ merge, posting, verdict, count }) {
  const each = count === 1 ? '' : ' per PR'
  const merges = count === 1 ? 'the merge' : 'the merge of each PR'
  if (verdict) return { tone: 'public', text: `only the approve or request-changes${each} you submit, from your account${merge ? `, then ${merges}` : ''}. Nothing is posted before you submit it. No code changes.` }
  // Posting is a grant, not a promise: only a verdict the agent marks public is posted.
  if (posting) return { tone: 'public', text: `at most one review comment${each} from your account, only for a verdict the agent marks as public${merge ? `, then ${merges}` : ''}. Questions to you and unverified results stay private. It never approves or asks for changes.` }
  if (merge) return { tone: 'public', text: `${merges}. No comments and no code changes.` }
  return { tone: 'private', text: 'nothing. Only you see the review.' }
}

function postingStep(count) {
  if (count === 1) return 'If it is sure about its verdict, it posts one comment on GitHub from your account.'
  return 'For each PR whose verdict it is sure about, it posts one comment on that PR from your account.'
}

function verdictStep(count) {
  const it = count === 1 ? 'the PR' : 'each PR'
  return `It proposes approve or request changes for ${it}, with the words it would post. You submit or discard it here; nothing is posted before that.`
}

function mergeStep({ count, posting, verdict }) {
  const it = count === 1 ? 'the PR' : 'each PR'
  if (verdict) return `Only after you submit an approval, and once all required checks pass, it merges ${it} or adds it to the merge queue.`
  if (posting) return `If the review is clean, it posts it first. Once GitHub shows that review and all required checks pass, it merges ${it} or adds it to the merge queue.`
  return `If the review is clean and all required checks pass, it merges ${it} or adds it to the merge queue.`
}

function reviewStartLabel({ merge, posting, verdict }) {
  if (merge && verdict) return 'Start review, merge after your approval'
  if (merge && posting) return 'Start review, post and merge when safe'
  if (merge) return 'Start review, merge when safe'
  if (verdict) return 'Start review, propose a verdict'
  if (posting) return 'Start review, allow comment'
  return 'Start private review'
}

export function reviewWindowCopy({ mode, posting = false, verdict = false, draftScope = false, count = 1, bindCurrentTarget = false }) {
  if (mode === 'review_fix_merge') return takeoverCopy({ count, draftScope, bindCurrentTarget })
  const merge = mode === 'review_merge'
  const proposing = posting && verdict
  const it = count === 1 ? 'the PR' : 'each PR'
  const steps = [
    { text: `The agent reads ${it}: the code, the checks and the discussion.` },
    { text: 'It writes its findings for you in a private conversation.' },
    ...(proposing ? [{ text: verdictStep(count), added: true }] : posting ? [{ text: postingStep(count), added: true }] : []),
    ...(merge ? [{ text: mergeStep({ count, posting, verdict: proposing }), added: true }] : []),
    { text: 'If it has a question, it asks you first.' },
  ]
  return {
    title: 'Review only',
    steps,
    publicEffect: reviewPublicEffect({ merge, posting, verdict: proposing, count }),
    startLabel: reviewStartLabel({ merge, posting, verdict: proposing }),
    footnote: versionNote(count, bindCurrentTarget, merge),
  }
}

// The hints under the Review only switches, per selected PR for a batch.
export function reviewSwitchHints(count = 1) {
  if (count === 1) return {
    posting: 'One comment from your account, only for a verdict the agent is sure about. Questions to you stay private.',
    verdict: 'Instead of a comment, it proposes approve or request changes with its wording. You submit or discard it here. On your own PR it comments instead.',
    merge: 'Merges or queues the PR after a clean review and passing checks. It does not change any code.',
  }
  return {
    posting: 'Up to one comment per PR from your account, only for a verdict the agent is sure about. Questions to you stay private.',
    verdict: 'Instead of comments, it proposes approve or request changes for each PR with its wording. You submit or discard each one here. On your own PRs it comments instead.',
    merge: 'Merges or queues each PR after a clean review and passing checks. It does not change any code.',
  }
}

// Why "Merge when safe" cannot be switched on right now, or '' when it can.
// postingBlocks: this Möbius cannot yet post and merge in one run.
export function mergeWhenSafeBlocker({ drafts, mayMergeAll, postingBlocks = false }) {
  if (drafts) return 'Not available for drafts.'
  if (!mayMergeAll) return 'Needs merge rights on this repository.'
  if (postingBlocks) return 'Posting and merging together needs a newer Möbius.'
  return ''
}

// Words for a proposed verdict waiting on you, and what submitting does.
export function verdictCopy(proposal, mode) {
  const approve = proposal?.event === 'APPROVE'
  const action = approve ? 'Approve' : 'Request changes'
  const states = {
    proposed: `Proposed verdict: ${action}. Nothing is on GitHub yet.`,
    posting: `Submitting ${action.toLowerCase()} on GitHub…`,
    posted: `${action} submitted on GitHub.`,
    unknown: 'GitHub did not confirm the verdict. Check the PR on GitHub; nothing will be sent again.',
    not_dispatched: proposal?.summary || 'The verdict was not sent.',
    discarded: mode === 'review_merge' ? 'You discarded the verdict. Nothing was posted or merged.' : 'You discarded the verdict. Nothing was posted.',
  }
  return {
    status: states[proposal?.state] || '',
    submit: approve ? 'Approve on GitHub' : 'Request changes on GitHub',
    note: approve && mode === 'review_merge'
      ? 'Submitting posts this approval from your account. The review then merges the PR only if all required checks pass.'
      : 'Submitting posts this from your account, exactly as shown.',
  }
}
