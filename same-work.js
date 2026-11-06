// Is a PR's own change the same at two versions of its branch? An approval was given to one commit; when
// the branch only merged its base in (to fix a conflict, say) the head is a new commit but not new work, and the
// approval still stands. The PR machine (pr-machine.js) never reads this: it is a fact (`sameWork` on an
// approval) that the fact readers fill (carried-approvals.js here, contribution_same_work.py in the platform), and both
// are held to the same cases (test/same-work.cases.json).
//
// "Own change" is what GitHub's compare shows of a version against the base's current tip: the added and removed
// lines of each file, in order. Hunk positions are ignored, because they shift whenever the base moves; context
// lines are ignored, because they are the base's. That is the line this draws: a line moved elsewhere in its file
// still compares as the same. A file with no lines to compare (a binary one) is compared by its content id instead.
// Only a full, untruncated answer can say the work is the same.

// GitHub lists at most this many files of a comparison; a list that long may have been cut off.
export const COMPARE_FILE_LIMIT = 300

const changedLines = patch => String(patch).split('\n').filter(line => line[0] === '+' || line[0] === '-')
// A patch's lines say what changed; without one only the file's content id (`sha`) can.
const content = file => (typeof file.patch === 'string' ? changedLines(file.patch).join('\n') : `blob ${file.sha ?? ''}`)
const signature = file => `${file.previous_filename || ''}>${file.filename}|${file.status}|${content(file)}`
const hasChanges = file => (file.additions || 0) + (file.deletions || 0) > 0

// True or false when both comparisons are complete; null when either cannot say (missing, cut off, or a changed
// file GitHub gave no lines for, such as a very large one).
export function sameWorkOf(approved, head) {
  const lists = [approved, head].map(compare => compare?.files)
  if (!lists.every(files => Array.isArray(files) && files.length < COMPARE_FILE_LIMIT)) return null
  if (lists.some(files => files.some(file => hasChanges(file) && typeof file.patch !== 'string'))) return null
  const [before, after] = lists.map(files => files.map(signature).sort())
  return before.length === after.length && before.every((line, index) => line === after[index])
}
