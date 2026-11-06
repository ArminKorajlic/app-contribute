import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDiffStat } from '../diff.js'
import { parseUnifiedDiff } from '../ui/diff/parseUnifiedDiff.js'

test('parseUnifiedDiff groups files, hunks, and line numbers', () => {
  const files = parseUnifiedDiff(`diff --git a/src/a.js b/src/a.js
index 111..222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 export { a, b }
`)

  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'src/a.js')
  assert.equal(files[0].insertions, 2)
  assert.equal(files[0].deletions, 1)
  assert.deepEqual(
    files[0].hunks.flatMap((hunk) => hunk.lines)
      .filter((line) => line.type === 'add' || line.type === 'del')
      .map((line) => [line.type, line.oldNo, line.newNo, line.text]),
    [
      ['del', 2, null, 'const b = 2'],
      ['add', null, 2, 'const b = 3'],
      ['add', null, 3, 'const c = 4'],
    ],
  )
})

test('parseUnifiedDiff handles new files and no-newline notes', () => {
  const files = parseUnifiedDiff(`diff --git a/dev/null b/notes.md
--- /dev/null
+++ b/notes.md
@@ -0,0 +1,2 @@
+# Notes
+Body
\\ No newline at end of file`)

  assert.equal(files[0].oldPath, null)
  assert.equal(files[0].newPath, 'notes.md')
  assert.equal(files[0].hunks[0].lines.at(-1).type, 'meta')
})

test('parseUnifiedDiff counts hunk lines whose content begins with -- / ++', () => {
  // A removed source line "-- old" renders as the body line "--- old" and an
  // added "++ new" as "+++ new". These must not be read as ---/+++ file
  // headers: doing so clobbered the path and dropped both lines from the counts.
  const files = parseUnifiedDiff(`diff --git a/q.sql b/q.sql
index 111..222 100644
--- a/q.sql
+++ b/q.sql
@@ -1,2 +1,2 @@
--- old comment
+++ new comment
 unchanged`)

  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'q.sql')
  assert.equal(files[0].insertions, 1)
  assert.equal(files[0].deletions, 1)
  assert.deepEqual(
    files[0].hunks.flatMap((hunk) => hunk.lines)
      .filter((line) => line.type === 'add' || line.type === 'del')
      .map((line) => [line.type, line.text]),
    [['del', '-- old comment'], ['add', '++ new comment']],
  )
})

test('parseDiffStat reads authoritative totals from the summary line', () => {
  const stat = parseDiffStat(` src/a.js | 4 ++--
 ui/DiffView.jsx | 2 +-
 2 files changed, 4 insertions(+), 2 deletions(-)`)
  assert.equal(stat.totalFiles, 2)
  assert.equal(stat.additions, 4)
  assert.equal(stat.deletions, 2)
  assert.equal(stat.files.length, 2)
  assert.equal(stat.files[0].path, 'src/a.js')
  assert.equal(stat.files[1].path, 'ui/DiffView.jsx')
})

test('parseDiffStat handles a single insertions-only file', () => {
  const stat = parseDiffStat(` notes.md | 3 +++
 1 file changed, 3 insertions(+)`)
  assert.equal(stat.totalFiles, 1)
  assert.equal(stat.additions, 3)
  assert.equal(stat.deletions, 0)
})

test('parseDiffStat approximates the per-file add/del split from the bar', () => {
  const stat = parseDiffStat(` src/a.js | 10 ++++++----
 1 file changed, 6 insertions(+), 4 deletions(-)`)
  const file = stat.files[0]
  assert.equal(file.additions, 6)
  assert.equal(file.deletions, 4)
  assert.equal(file.additions + file.deletions, 10)
})

test('parseDiffStat marks binary files and skips their counts', () => {
  const stat = parseDiffStat(` icon.png | Bin 0 -> 512 bytes
 1 file changed, 0 insertions(+), 0 deletions(-)`)
  assert.equal(stat.files[0].path, 'icon.png')
  assert.equal(stat.files[0].binary, true)
  assert.equal(stat.files[0].additions, 0)
  assert.equal(stat.files[0].deletions, 0)
})

test('parseDiffStat falls back to file rows when there is no summary line', () => {
  const stat = parseDiffStat(` a.js | 2 +-
 b.js | 1 +`)
  assert.equal(stat.totalFiles, 2)
  assert.equal(stat.files.length, 2)
})

test('parseDiffStat returns null for empty or blank input', () => {
  assert.equal(parseDiffStat(''), null)
  assert.equal(parseDiffStat('   \n  '), null)
  assert.equal(parseDiffStat(null), null)
})

test('parseDiffStat keeps totals from a summary-only stat (no file rows)', () => {
  const stat = parseDiffStat(' 5 files changed, 12 insertions(+), 3 deletions(-)')
  assert.equal(stat.totalFiles, 5)
  assert.equal(stat.additions, 12)
  assert.equal(stat.deletions, 3)
  assert.equal(stat.files.length, 0)
})

test('parseDiffStat preserves rename-brace paths verbatim', () => {
  const stat = parseDiffStat(` src/{old => new}/mod.js | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)`)
  assert.equal(stat.files[0].path, 'src/{old => new}/mod.js')
})

test('parseDiffStat splits on the last pipe for paths containing " | "', () => {
  const stat = parseDiffStat(` docs/a | b.md | 2 ++
 1 file changed, 2 insertions(+)`)
  assert.equal(stat.files[0].path, 'docs/a | b.md')
  assert.equal(stat.files[0].additions, 2)
})

test('the line-number gutter grows with the file so 4-digit numbers never run together', async () => {
  const { lineNumberDigits } = await import('../ui/diff/parseUnifiedDiff.js')
  const source = (await import('node:fs')).readFileSync(new URL('../ui/diff/styles.js', import.meta.url), 'utf8')
  assert.match(source, /--diff-num: calc\(var\(--diff-digits, 3\) \* 1ch \+ 8px\)/)
  assert.match(source, /grid-template-columns: repeat\(2, var\(--diff-num\)\)/)
  assert.doesNotMatch(source, /repeat\(2, 3\.5ch\)/)
  assert.equal(lineNumberDigits([{ lines: [{ oldNo: 9, newNo: 12 }] }]), 3)
  assert.equal(lineNumberDigits([{ lines: [{ oldNo: 1084, newNo: 1504 }] }]), 4)
  assert.equal(lineNumberDigits([{ lines: [{ oldNo: 99999, newNo: null }] }]), 5)
})

test('the gutter width of a very large file is computed without a call argument per line', async () => {
  const { lineNumberDigits, parseUnifiedDiff } = await import('../ui/diff/parseUnifiedDiff.js')
  const blank = 140000
  const patch = `diff --git a/big.txt b/big.txt\nnew file mode 100644\n--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,${blank} @@\n${'+\n'.repeat(blank)}`
  const [file] = parseUnifiedDiff(patch)
  assert.equal(file.insertions, blank)
  assert.equal(lineNumberDigits(file.hunks), 6)
  // Missing, empty and non-numeric lines still fall back to the three-digit minimum.
  assert.equal(lineNumberDigits(undefined), 3)
  assert.equal(lineNumberDigits([{ lines: [{ oldNo: null, newNo: NaN }, {}] }, {}]), 3)
})
