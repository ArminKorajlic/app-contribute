import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../mobius.json', import.meta.url), 'utf8'))
const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

test('package metadata matches the install manifest version', () => {
  assert.equal(packageMetadata.version, manifest.version)
})

test('install manifest ships the refresh coordinator imported by the entry point', () => {
  assert.ok(manifest.source_files.includes('refresh.js'))
})

test('install manifest ships the prepared-record reconciliation pass', () => {
  assert.ok(manifest.source_files.includes('prepared_reconcile.py'))
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /prepared_reconcile\.py/)
})

test('scheduled refresh retries cleanup for every terminal staging checkout', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /TERMINAL_STAGING_STATUSES = frozenset/)
  for (const status of [
    'merged', 'closed', 'superseded', 'commented', 'abandoned',
  ]) {
    assert.match(source, new RegExp(`"${status}"`))
  }
  assert.match(source, /cleanup-staging/)
  assert.ok(
    source.indexOf('_reconcile_terminal_staging()') < source.indexOf('if not targets:'),
    'cleanup must still run when there are no live GitHub records to refresh',
  )
})

test('install manifest ships the one-call agent contribution snapshot', () => {
  assert.ok(manifest.source_files.includes('agent_snapshot.py'))
})

test('install manifest ships the label outcome helper imported by the review card', () => {
  assert.ok(manifest.source_files.includes('labels.js'))
})

test('install manifest ships the shared batch action used by Projects and PRs', () => {
  assert.ok(manifest.source_files.includes('ui/BatchAction.jsx'))
})

test('install manifest ships the run model and omits retired view modules', () => {
  assert.ok(manifest.source_files.includes('run.js'))
  assert.ok(!manifest.source_files.includes('ui/ContributionStack.jsx'))
  assert.ok(!manifest.source_files.includes('ui/SourceOverview.jsx'))
})

test('install manifest ships the project policy and canonical diff workspace', () => {
  for (const sourceFile of [
    'contribution-policy.js',
    'ui/ProjectIcon.jsx',
    'ui/diff/DiffView.jsx',
    'ui/diff/FileDiffList.jsx',
    'ui/diff/UnifiedDiff.jsx',
    'ui/diff/parseUnifiedDiff.js',
    'ui/diff/styles.js',
  ]) {
    assert.ok(manifest.source_files.includes(sourceFile), `${sourceFile} is installable`)
  }
  assert.ok(!manifest.source_files.includes('parse-unified-diff.js'))
  assert.ok(!manifest.source_files.includes('ui/DiffView.jsx'))
})

test('install manifest ships the GitHub connection-attempt controller', () => {
  assert.ok(manifest.source_files.includes('github-connection.js'))
})

test('GitHub data and credential management are separately reviewable grants', () => {
  assert.equal(manifest.permissions.github_access, true)
  assert.equal(manifest.permissions.github_connect, true)
})

test('install manifest ships the autopilot module imported by the card', () => {
  assert.ok(manifest.source_files.includes('autopilot.js'))
})

test('install manifest ships the review-followup skill for the background loop', () => {
  assert.ok(manifest.skills.includes('review-followup.md'))
  assert.ok(manifest.source_files.includes('review-followup.md'))
})

test('schedule runs often enough for a responsive review loop', () => {
  // The autopilot loop keys off this cadence to detect + respond to reviews.
  assert.equal(manifest.schedule.default, '*/15 * * * *')
})

test('scheduled autopilot retries durable attention after a lost respond call', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /A prior pass may have durably written the attention/)
  assert.match(source, /_respond_autopilot\(rec, pending\)/)
  assert.match(source, /result\.get\("status"\) == "not_granted"/)
  assert.match(source, /400 <= exc\.code < 500 and exc\.code not in \(409, 429\)/)
})

test('scheduled autopilot ignores exact own replies, not all owner activity', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /ignored_event_urls/)
  // The classifier lives in github_events.py (behavior: test_github_events.py).
  const events = readFileSync(new URL('../github_events.py', import.meta.url), 'utf8')
  assert.match(events, /comment\.get\("url"\) not in ignored/)
  assert.match(events, /review\.get\("url"\) not in ignored/)
  assert.doesNotMatch(source, /gh", "api", "user"/)
  assert.doesNotMatch(source, /ignore_login/)
})

test('merge conflicts remain a human handoff, not an authorized rewrite', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  const actionable = source.match(
    /ACTIONABLE_ATTENTION = frozenset\(\(([^]*?)\)\)/,
  )?.[1] || ''
  assert.doesNotMatch(actionable, /merge_conflict/)
  const skill = readFileSync(
    new URL('../review-followup.md', import.meta.url), 'utf8',
  )
  assert.doesNotMatch(skill, /"rewrite"/)
  assert.doesNotMatch(skill, /re_request_review/)
  assert.match(skill, /merge conflict[\s\S]*escalate it/)
})

test('install manifest ships every module the shipped UI imports', () => {
  const shipped = new Set(manifest.source_files)
  const pending = [manifest.entry]
  const seen = new Set()
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      pending.push(new URL(specifier, new URL(`../${file}`, import.meta.url)).pathname
        .slice(new URL('../', import.meta.url).pathname.length))
    }
    assert.ok(file === manifest.entry || shipped.has(file), `${file} is imported but not shipped`)
  }
})

test('the chat-card capability says plainly that it can send after Confirm', () => {
  const capability = manifest.capabilities['chat.blocks.passive']
  assert.equal(capability.version, 1)
  assert.match(capability.reason, /sends them to GitHub only after you press Confirm/)
  assert.doesNotMatch(capability.reason, /without sending/)
  assert.ok(manifest.source_files.includes('prepared_block.py'))
})
