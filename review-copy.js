// The words of the agent review window, derived from the exact choice the
// owner is about to approve. One place decides them so the steps, the "Seen on
// GitHub" summary and the start button can never disagree with each other.
//
// mode: 'review' | 'review_merge' | 'review_fix_merge' (the platform modes).
// posting: the review may post one comment (only valid with mode 'review').
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
function reviewPublicEffect({ merge, posting, count }) {
  const each = count === 1 ? '' : ' per PR'
  if (merge) return { tone: 'public', text: `${count === 1 ? 'the merge' : 'the merge of each PR'}. No comments and no code changes.` }
  // Posting is a grant, not a promise: only a verdict the agent marks public is posted.
  if (posting) return { tone: 'public', text: `at most one review comment${each} from your account, only for a verdict the agent marks as public. Questions to you and unverified results stay private. It never approves or asks for changes.` }
  return { tone: 'private', text: 'nothing. Only you see the review.' }
}

function postingStep(count) {
  if (count === 1) return 'If it is sure about its verdict, it posts one comment on GitHub from your account.'
  return 'For each PR whose verdict it is sure about, it posts one comment on that PR from your account.'
}

function reviewStartLabel({ merge, posting }) {
  if (merge) return 'Start review, merge when safe'
  if (posting) return 'Start review, allow comment'
  return 'Start private review'
}

export function reviewWindowCopy({ mode, posting = false, draftScope = false, count = 1, bindCurrentTarget = false }) {
  if (mode === 'review_fix_merge') return takeoverCopy({ count, draftScope, bindCurrentTarget })
  const merge = mode === 'review_merge'
  const commenting = posting && !merge
  const it = count === 1 ? 'the PR' : 'each PR'
  const steps = [
    { text: `The agent reads ${it}: the code, the checks and the discussion.` },
    { text: 'It writes its findings for you in a private conversation.' },
    ...(commenting ? [{ text: postingStep(count), added: true }] : []),
    ...(merge ? [{ text: `If the review is clean and all required checks pass, it merges ${it} or adds it to the merge queue.`, added: true }] : []),
    { text: 'If it has a question, it asks you first.' },
  ]
  return {
    title: 'Review only',
    steps,
    publicEffect: reviewPublicEffect({ merge, posting: commenting, count }),
    startLabel: reviewStartLabel({ merge, posting: commenting }),
    footnote: versionNote(count, bindCurrentTarget, merge),
  }
}

// The hints under the two Review only switches, per selected PR for a batch.
export function reviewSwitchHints(count = 1) {
  if (count === 1) return {
    posting: 'One comment from your account, only for a verdict the agent is sure about. It never approves or asks for changes. Questions to you stay private.',
    merge: 'Merges or queues the PR after a clean review and passing checks. It does not change any code.',
  }
  return {
    posting: 'Up to one comment per PR from your account, only for a verdict the agent is sure about. It never approves or asks for changes. Questions to you stay private.',
    merge: 'Merges or queues each PR after a clean review and passing checks. It does not change any code.',
  }
}

// Why "Merge when safe" cannot be switched on right now, or '' when it can.
export function mergeWhenSafeBlocker({ drafts, mayMergeAll, posting }) {
  if (drafts) return 'Not available for drafts.'
  if (!mayMergeAll) return 'Needs merge rights on this repository.'
  if (posting) return 'Turn off posting to merge when safe.'
  return ''
}
