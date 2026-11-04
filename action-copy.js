// The words on an action's confirm sheet: what it does, what GitHub shows now,
// and what it cannot undo. Pure, so the sheet states exactly what the PR's own
// data says and the tests can hold it to that.
import { checkSummary } from './collaboration.js'

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
    done: { title: 'Open for review', text: 'Reviewers can see it now.' },
  }
}

// The sheet's words for each of the owner's own actions, by menu intent.
export const ACTION_COPY = { open_review: openForReviewCopy }
