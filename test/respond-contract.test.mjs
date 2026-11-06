// The Respond-to-feedback contract between the two languages: the real respond_result.py saves and posts against a fake GitHub
// and a local Git remote, while the app's own JavaScript reads what it saved, writes the owner's decision and names the command.
// A change on either side that the other cannot read fails here, not on the owner's PR.
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POST_COMMAND, planSteps, postMessage, responseView, stepDone } from '../respond-result.js'
import { loadResponses, writeDecision } from '../respond-store.js'

const here = dirname(fileURLToPath(import.meta.url))
const HELPER = join(here, '..', 'respond_result.py')
const FAKE_GH = join(here, 'fixtures', 'fake_gh.py')
const REPO = 'owner/repo'
const HEAD_REF = 'stack/example/02-feature'
const AWKWARD_REPLY = '@alex both findings were real — fixed \u{1F680} שלום\r\n\r\n1. **Lost write** (`write.js`) said "done" and \\o/\n\tindented   \n'

// ---- the world: a PR on a fake GitHub, its branch on a bare remote, the agent's private copy, the app's storage folder
function git(cwd, ...args) {
  const done = spawnSync('git', args, { cwd, encoding: 'utf8', env: process.env })
  assert.equal(done.status, 0, `git ${args.join(' ')} failed: ${done.stderr}`)
  return done.stdout.trim()
}

function commit(work, message, files = {}) {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, name)), { recursive: true })
    writeFileSync(join(work, name), content)
  }
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', message)
  return git(work, 'rev-parse', 'HEAD')
}

function buildWorld(t) {
  const root = mkdtempSync(join(tmpdir(), 'respond-contract-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const world = { root, app: join(root, 'app'), remote: join(root, 'remote.git'), work: join(root, 'work'), log: join(root, 'gh-calls.jsonl') }
  writeFileSync(join(root, 'gitconfig'), '[user]\n\tname = Test Agent\n\temail = agent@example.test\n[init]\n\tdefaultBranch = main\n')
  mkdirSync(join(root, 'bin'))
  copyFileSync(FAKE_GH, join(root, 'bin', 'gh'))
  chmodSync(join(root, 'bin', 'gh'), 0o755)
  world.env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    RESPOND_APP_DIR: world.app, RESPOND_GIT_REMOTE: world.remote, FAKE_GH_CONFIG: join(root, 'gh-config.json'), CHAT_ID: 'chat-under-test' }
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: world.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1' })
  git(root, 'init', '-q', '--bare', world.remote)
  git(world.remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  git(root, 'init', '-q', world.work)
  commit(world.work, 'Root', { 'app.js': 'one\ntwo\nthree\n', 'old_name.js': 'export const a = 1\nexport const b = 2\n', 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]) })
  world.head = commit(world.work, 'The PR head', { 'README.md': 'docs\n' })
  git(world.work, 'push', '-q', world.remote, `HEAD:refs/heads/${HEAD_REF}`)
  writeFileSync(world.env.FAKE_GH_CONFIG, JSON.stringify({ log: world.log, watch: join(world.app, 'respond-results', 'owner__repo__7.json'), remote: world.remote, writes: 0, fail_at: null, ref_sha: null,
    pr: { repo: REPO, number: 7, state: 'open', author: 'contributor', head_repo: REPO, head_ref: HEAD_REF, base_ref: 'stack/example/01-base', head_sha: null } }))
  return world
}

// The agent's finished work: two commits, one of them a rename, a new file and a binary, then the input of `save`.
function finishWork(world) {
  const first = commit(world.work, 'Public writes: a lost answer is unresolved', { 'app.js': 'one\ntwo\nthree, fixed\n', 'new.js': 'export const sync = () => {}\n' })
  git(world.work, 'mv', 'old_name.js', 'renamed.js')
  const second = commit(world.work, 'Sync reads the live state again', { 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 2]) })
  const input = {
    points: [{ reviewer: 'alex', title: 'A lost write answer is unresolved', ending: 'fixed', commit: first.slice(0, 7), answer: 'One shared path.' },
      { reviewer: 'alex', title: 'Sync shows a stale list', ending: 'fixed', commit: second.slice(0, 10), answer: 'Sync reads live state.' },
      { reviewer: 'sam', title: 'Rename the helper', ending: 'not_valid', commit: null, answer: 'It matches its siblings.' }],
    replies: [{ body: AWKWARD_REPLY, reply_to: null }, { body: '@sam the name stays.', reply_to: 4242 }],
    description: 'Adds one shared write path.\n\n## Changes\n- A lost answer is unresolved.\n', rerequest: ['alex'], tests: '803 pass, 0 fail (node)',
  }
  writeFileSync(join(world.root, 'input.json'), JSON.stringify(input))
  return { first, second, input }
}

// ---- the app's storage over the helper's folder: a .json file is the document itself, and a listing carries the body of each
// valid .json file; every other file (a lock, a bundle) is listed without content, as the platform does.
function folderStorage(app) {
  const file = path => join(app, path)
  const read = path => JSON.parse(readFileSync(file(path), 'utf8'))
  return {
    async listWithStatus(prefix, { includeContent = false } = {}) {
      const names = existsSync(file(prefix)) ? readdirSync(file(prefix)).filter(name => !name.startsWith('.')).sort() : []
      const entries = names.map(name => ({ type: 'file', name, path: prefix + name, ...(includeContent && name.endsWith('.json') ? { content: read(prefix + name) } : {}) }))
      return { complete: true, entries }
    },
    async get(path) { return read(path) },
    async getWithVersion(path) { return { value: read(path), version: '1' } },
    async durableWrite(path, value) { mkdirSync(dirname(file(path)), { recursive: true }); writeFileSync(file(path), JSON.stringify(value)); return { durability: 'synced' } },
    async remove(path) { rmSync(file(path), { force: true }) },
  }
}

const helper = (world, ...args) => spawnSync('python3', [HELPER, ...args], { env: world.env, encoding: 'utf8' })
const save = world => helper(world, 'save', '--pr', `${REPO}#7`, '--repo-path', world.work, '--input', join(world.root, 'input.json'))
const writes = world => (existsSync(world.log) ? readFileSync(world.log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(call => call.method !== 'GET') : [])
const pullOf = headRefOid => ({ number: 7, headRefOid, repository: { nameWithOwner: REPO } })

// The command Post names, as the chat would run it, with the helper's local path in place of the installed one.
function postArgs(result, ...extra) {
  const command = POST_COMMAND(result)
  assert.match(command, /^python3 \/data\/apps\/contribute\/respond_result\.py post --pr owner\/repo#7 --id r-[0-9a-f]{12}$/)
  assert.ok(postMessage(result).includes(`    ${command}`), 'the message to the chat carries exactly this command')
  return command.split(' ').slice(2).concat(extra)
}

test('what the helper saves is what the app reads, and Post posts exactly what the card showed', async t => {
  const world = buildWorld(t)
  const { first, second, input } = finishWork(world)
  const saved = save(world)
  assert.equal(saved.status, 0, saved.stderr)
  const storage = folderStorage(world.app)
  const [entry, ...others] = await loadResponses(storage)
  assert.equal(others.length, 0, 'a lock file and a bundle are not responses')
  const { result } = entry
  assert.deepEqual(result.commits.map(item => item.sha), [first, second])
  assert.deepEqual(result.points.map(point => point.commit), [first, second, null], 'the agent’s short commit ids are full SHAs')
  assert.deepEqual(result.replies, input.replies, 'the replies are stored word for word')
  const byPath = Object.fromEntries(result.files.map(file => [file.path, file]))
  assert.equal(byPath['renamed.js'].previous_path, 'old_name.js')
  assert.deepEqual([byPath['logo.png'].binary, byPath['logo.png'].patch, byPath['logo.png'].patch_omitted], [true, null, true])
  assert.match(byPath['new.js'].patch, /^@@ -0,0 \+1 @@\n\+export const sync/)
  assert.equal(responseView([entry], pullOf(world.head)).status, 'ready')
  assert.equal(responseView([entry], pullOf('c'.repeat(40))).status, 'stale')

  assert.deepEqual(await writeDecision(entry.slug, { result_id: result.id, digest: result.digest, decision: 'approved', at: '2026-11-06T09:30:00Z' }, storage), { ok: true })
  const dry = helper(world, ...postArgs(result, '--dry-run'))
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /push 2 commits[\s\S]*post reply 1 of 2 as a PR comment[\s\S]*post reply 2 of 2 as a reply in review thread 4242[\s\S]*replace the PR description[\s\S]*ask alex/)
  assert.deepEqual(writes(world), [], 'a dry run writes nothing')

  const posted = helper(world, ...postArgs(result))
  assert.equal(posted.status, 0, posted.stderr)
  const [after] = await loadResponses(storage)
  assert.equal(after.result.state, 'posted')
  assert.ok(planSteps(after.result).every(step => stepDone(after.result, step.key)), 'every step the card listed is ticked by what the helper recorded')
  assert.equal(responseView([after], pullOf(result.tip_sha)).status, 'posted')
  assert.equal(git(world.remote, 'rev-parse', `refs/heads/${HEAD_REF}`), result.tip_sha, 'the branch is at the approved tip')
  assert.deepEqual(git(world.remote, 'rev-list', '--reverse', `${world.head}..${result.tip_sha}`).split('\n'), [first, second], 'the commits keep their SHAs')
  const sent = writes(world).map(call => [call.method, call.path, JSON.parse(call.body)])
  assert.deepEqual(sent, [
    ['POST', 'repos/owner/repo/issues/7/comments', { body: AWKWARD_REPLY }],
    ['POST', 'repos/owner/repo/pulls/7/comments/4242/replies', { body: '@sam the name stays.' }],
    ['PATCH', 'repos/owner/repo/pulls/7', { body: input.description }],
    ['POST', 'repos/owner/repo/pulls/7/requested_reviewers', { reviewers: ['alex'] }],
  ], 'each reply reaches GitHub byte for byte, then the description, then the re-review')
})

test('a discarded answer, or an approval of other content, posts nothing', async t => {
  const world = buildWorld(t)
  finishWork(world)
  assert.equal(save(world).status, 0)
  const storage = folderStorage(world.app)
  const [{ slug, result }] = await loadResponses(storage)
  const refused = async (decision, digest = result.digest) => {
    await writeDecision(slug, { result_id: result.id, digest, decision, at: '2026-11-06T09:30:00Z' }, storage)
    const done = helper(world, ...postArgs(result))
    assert.equal(done.status, 3, done.stderr)
    assert.deepEqual(writes(world), [], 'nothing reached GitHub')
    assert.equal(git(world.remote, 'rev-parse', `refs/heads/${HEAD_REF}`), world.head, 'the branch was not touched')
    return done.stderr
  }
  assert.match(await refused('discarded'), /not approved/)
  assert.match(await refused('approved', 'f'.repeat(64)), /different content/)
})
