// The words on an action's confirm sheet: what it does, what GitHub shows now,
// and what it cannot undo. Pure, so the sheet states exactly what the PR's own
// data says and the tests can hold it to that.
import { checkSummary, reviewItemProgress } from './collaboration.js'

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// One line about the PR's checks, as GitHub counts them; null when GitHub has
// reported none. A failing or running check is not a blocker for opening a PR
// for review, so it is a warning there.
function checksFact(pr, { blocking = false } = {}) {
  const checks = checkSummary(pr)
  if (!checks?.total) return null
  if (checks.failed) return { tone: blocking ? 'bad' : 'warn', text: `${plural(checks.failed, 'check is', 'checks are')} failing` }
  if (checks.state === 'pending') return { tone: 'warn', text: 'Checks are still running' }
  // Like GitHub's own "21/21", skipped runs count as passed.
  return { tone: 'ok', text: `${plural(checks.passed, 'check', 'checks')} passed` }
}

function conflictFact(pr) {
  const base = pr.baseRefName || 'the target branch'
  if (pr.mergeable === 'CONFLICTING') return { tone: 'bad', text: `It conflicts with ${base}` }
  return pr.mergeable === 'MERGEABLE' ? { tone: 'ok', text: `No conflicts with ${base}` } : null
}

const short = sha => String(sha || '').slice(0, 7)

// Open a draft for review: reviewers are notified, and Contribute cannot take
// it back to a draft. The exact version is pinned by the platform's action.
export function openForReviewCopy(pr) {
  return {
    icon: 'send',
    title: `Open #${pr.number} for review?`,
    confirm: 'Open for review',
    working: 'Opening…',
    facts: [
      { tone: 'ok', text: 'Reviewers are asked to look at it' },
      checksFact(pr),
      conflictFact(pr),
      { tone: 'warn', text: 'Contribute cannot turn it back into a draft yet' },
    ].filter(Boolean),
    footnote: `Opens the version you are looking at (${short(pr.headRefOid)}). Nothing merges.`,
    // GitHub cannot pin a version on this write, so the platform reports the head it saw afterwards.
    done: outcome => ({
      title: 'Open for review',
      text: outcome?.observedHead && outcome.observedHead !== pr.headRefOid
        ? `Reviewers can see it now. It changed while you were looking: GitHub shows ${short(outcome.observedHead)} now, so check what they will read.`
        : 'Reviewers can see it now.',
    }),
  }
}

// Post what a finished private review found, as a plain comment review on the PR. The words are the
// platform's own, shown as they will appear; nothing is posted until the owner confirms here. Until the
// words have arrived (or when the platform refuses) the button stays off and the sheet says why.
export function postFindingsCopy(pr, { preview = null, error = '', own = false } = {}) {
  const base = {
    icon: 'globe',
    title: `Post this review on #${pr.number}?`,
    confirm: 'Post to GitHub',
    working: 'Posting…',
  }
  if (error) return { ...base, disabled: true, facts: [{ tone: 'bad', text: error }], footnote: 'Nothing was posted.', done: { title: 'Posted', text: '' } }
  if (!preview) return { ...base, disabled: true, facts: [{ tone: 'warn', text: 'Reading what it would post…' }], footnote: 'Nothing is posted until you confirm.', done: { title: 'Posted', text: '' } }
  return {
    ...base,
    facts: [
      { tone: 'ok', text: own ? 'A comment on your own PR, from your GitHub account' : 'A comment on this PR, from your GitHub account' },
      { tone: 'ok', text: 'Not an approval and not a request for changes' },
      { tone: 'warn', text: 'Anyone who can see this PR can read it' },
    ],
    says: { label: 'What it would post', markdown: preview.body },
    footnote: `Posts exactly this text, once, at the version you reviewed (${short(preview.head_sha || pr.headRefOid)}). If anyone pushes first, nothing is posted and you are told. Contribute cannot take it back: on GitHub you can edit or hide it.`,
    done: outcome => ({
      title: 'Posted on GitHub',
      text: `Your review is on #${pr.number} now.`,
      ...(outcome?.url ? { link: { href: outcome.url, label: 'View the review on GitHub' } } : {}),
    }),
  }
}

// How a repository lets a PR land, in the platform's own order of preference
// (squash, then a merge commit, then rebase). Only the ways the repository
// allows are offered; with none reported the platform picks and nothing is asked.
const MERGE_METHODS = {
  squash: { label: 'Squash and merge', action: 'Squash and merge', detail: base => `All commits become one commit on ${base}.` },
  merge: { label: 'Create a merge commit', action: 'Merge', detail: () => 'Keeps every commit and adds a merge commit.' },
  rebase: { label: 'Rebase and merge', action: 'Rebase and merge', detail: base => `Replays the commits on top of ${base}.` },
}
const ALLOWED = { squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' }
export const allowedMergeMethods = repository => Object.keys(MERGE_METHODS).filter(key => repository?.[ALLOWED[key]] === true)
// The method to name in the merge call: none while the owner stays on the first allowed one, which is
// also what the platform picks. A repository that merges through a queue chooses for itself and refuses a named method.
export const methodToSend = (repository, choice) => (choice && choice !== allowedMergeMethods(repository)[0] ? choice : '')

// What GitHub says about approval. A review-less branch rule reads as no decision, which is not a
// missing approval, so it says exactly that.
function decisionFact(pr) {
  switch (pr.reviewDecision) {
    case 'APPROVED': return { tone: 'ok', text: 'Approved on GitHub' }
    case 'CHANGES_REQUESTED': return { tone: 'bad', text: 'Changes are requested' }
    case 'REVIEW_REQUIRED': return { tone: 'bad', text: 'GitHub still needs a review' }
    default: return pr.reviewDecision === null || pr.reviewDecision === '' ? { tone: 'ok', text: 'GitHub is not asking for an approval here' } : null
  }
}

// What the owner's own agent review of this exact version said, if there is one.
function reviewFact(status, ignored) {
  if (!status) return null
  const progress = reviewItemProgress(status.run, status.item, { ignored })
  if (status.item.state === 'all_clear') return { tone: 'ok', text: 'Your agent’s review is clear for this version' }
  if (progress.turn === 'owner') return { tone: 'warn', text: status.item.state === 'needs_you' ? 'Your agent’s review found problems on this version' : 'Your agent’s review is waiting on you' }
  return null
}

// Merge: lands this exact version. Contribute cannot undo it.
export function mergeCopy(pr, { status = null, ignored = null, method = '' } = {}) {
  const base = pr.baseRefName || 'the target branch'
  const allowed = allowedMergeMethods(pr.repository)
  const chosen = allowed.includes(method) ? method : allowed[0] || ''
  return {
    icon: 'merge',
    title: `Merge #${pr.number} into ${base}?`,
    confirm: chosen ? MERGE_METHODS[chosen].action : 'Merge',
    working: 'Merging…',
    facts: [decisionFact(pr), checksFact(pr, { blocking: true }), conflictFact(pr), reviewFact(status, ignored)].filter(Boolean),
    choices: allowed.length > 1 ? { label: 'How should it land?', value: chosen, options: allowed.map(key => ({ key, label: MERGE_METHODS[key].label, action: MERGE_METHODS[key].action, detail: MERGE_METHODS[key].detail(base) })) } : null,
    footnote: `Merges the version you are looking at (${short(pr.headRefOid)}). If anyone pushes first, nothing is merged and you are told. Contribute cannot undo a merge: to take it back you would open a revert on GitHub.`,
    done: outcome => outcome?.state === 'queued'
      ? { title: 'Added to the merge queue', text: `GitHub merges #${pr.number} into ${base} when the queue reaches it.` }
      : { title: 'Merged', text: `#${pr.number} is now in ${base}.` },
  }
}

// The sheet's words for each of the owner's own actions, by menu intent.
export const ACTION_COPY = { open_review: openForReviewCopy, merge_now: mergeCopy }
