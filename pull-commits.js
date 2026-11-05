// The Commits tab's rows: what GitHub shows for each commit, plus the two things only Contribute
// knows: which commit the last review covered, and which commits an agent helped write.
// Pure, so every edge state is tested without a browser.

// Co-authors come from the commit itself. The agent's own account and display name both count.
const AGENT = /^m[oö]bius[- ]agent$/i
export const authorNames = commit => (commit?.authors?.nodes || []).filter(Boolean).map(author => author.user?.login || author.name).filter(Boolean)
export const madeWithAgent = commit => (commit?.authors?.nodes || []).some(author => AGENT.test(author?.user?.login || '') || AGENT.test(author?.name || ''))

// "A", "A and B", "A, B and C": the way GitHub words it.
export const authorLine = names => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

// The checks' overall result in words, never only a tick. A commit GitHub has no result for
// (an old commit, a repository without checks) says nothing: absence is not a failure.
const CHECK_WORDS = { SUCCESS: ['checks pass', 'ok'], FAILURE: ['checks fail', 'bad'], ERROR: ['checks fail', 'bad'], PENDING: ['checks running', 'warn'], EXPECTED: ['checks running', 'warn'] }
export const checkWords = commit => {
  const [text, tone] = CHECK_WORDS[commit?.statusCheckRollup?.state] || []
  return text ? { text, tone } : null
}

const dayOf = value => (Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')

// Rows grouped by the day they were committed, in the order GitHub lists them (oldest first).
export function commitGroups(commits) {
  const groups = []
  for (const commit of commits || []) {
    const day = dayOf(commit.committedDate)
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, commits: [] })
    groups[groups.length - 1].commits.push(commit)
  }
  return groups
}

// Where the last review stops: the index of the commit it covered, or -1 when it is not in this
// list (the branch was rewritten, or the page is not loaded). Commits after it are new since the review.
export function reviewMarker(commits, reviewedHead) {
  const at = reviewedHead ? (commits || []).findIndex(commit => commit.oid === reviewedHead) : -1
  return { at, newCount: at < 0 ? 0 : commits.length - at - 1 }
}
