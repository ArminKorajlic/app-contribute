import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

// The skill is the `contributing/` folder: a short SKILL.md core plus mode
// files beside it that agents open, by relative link, only when that mode
// applies. The rules below may live in any of them, so assert the whole set.
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const core = read('contributing/SKILL.md')
const modeFiles = readdirSync(new URL('../contributing', import.meta.url))
  .filter((name) => name !== 'SKILL.md' && name.endsWith('.md'))
  .sort()
const mode = (name) => read(`contributing/${name}`)
const skill = [core, ...modeFiles.map(mode)].join('\n')
const prose = skill.replace(/\s+/g, ' ')
const manifest = JSON.parse(read('mobius.json'))

test('folder skill core stays small and links every mode file relatively', () => {
  assert.ok(Buffer.byteLength(core) <= 12 * 1024, `core is ${Buffer.byteLength(core)} bytes`)
  assert.match(core, /^---\nname: contributing\ndescription: /)
  const routed = [...core.matchAll(/\]\(([a-z-]+\.md)\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(routed)].sort(), modeFiles)
  assert.ok(modeFiles.length >= 6)
  assert.ok(manifest.skills.includes('contributing/'))
  for (const name of ['SKILL.md', ...modeFiles]) {
    assert.ok(manifest.source_files.includes(`contributing/${name}`), `${name} ships with the skill`)
  }
  for (const name of modeFiles) {
    const body = mode(name)
    assert.match(body, /\[SKILL\.md\]\(SKILL\.md\)/, `${name} points back to the core`)
    assert.doesNotMatch(body, /\/data\/apps\/contribute\/contributing/, `${name} has no stale app path`)
    for (const [, ref] of body.matchAll(/\]\(([a-z-]+\.md)\)/g)) {
      assert.ok(existsSync(new URL(`../contributing/${ref}`, import.meta.url)), `${name} links missing ${ref}`)
    }
  }
})

test('hard stops, the privacy allowlist, and the approval gate live only in the core', () => {
  for (const heading of ['## Hard stops', '## What may leave — the privacy allowlist', '## The approval gate']) {
    assert.ok(core.includes(heading), heading)
    for (const name of modeFiles) assert.ok(!mode(name).includes(heading), `${heading} duplicated in ${name}`)
  }
})

test('CI diagnosis prefers the failure summarizer over full log dumps', () => {
  assert.match(core, /scripts\/ci-failures\.sh <owner\/repo> <pr-number\\\|run-id>/)
  assert.match(mode('ci.md'), /scripts\/ci-failures\.sh <owner\/repo> <pr-number\|run-id>/)
  assert.match(mode('ci.md'), /saves the full logs to a file and prints only the failing jobs/)
})

test('explicit exact chat approval does not need a second Contribute approval', () => {
  assert.match(prose, /An explicit, unambiguous instruction in chat is a valid yes/)
  assert.match(prose, /The partner does not need to repeat that same approval in Contribute/)
  assert.match(prose, /Proceed without requiring the matching Contribute press/)
  assert.match(prose, /chat approval changes the approval surface, not the safety preflight/)
  assert.match(prose, /do not require both approval surfaces/)
})

test('app publication is one reviewed outcome with an automatic local connection', () => {
  assert.match(prose, /one publication outcome, not a later public or destructive action/)
  assert.match(prose, /never present a second \*\*Link app\*\* decision/)
  assert.match(prose, /Do not call the publication complete until the local connection is recorded/)
})

test('scoped instructions authorize dependent publication steps but not merging or new scope', () => {
  assert.match(prose, /"create a PR for this fix" authorizes its private preparation, necessary fork and push, and PR creation/)
  assert.match(prose, /Neither instruction authorizes merging/)
  assert.match(prose, /Ask again for a different target, materially changed scope, risk, or public message/)
  assert.match(prose, /when the owner limited approval to a pinned version/)
  assert.match(prose, /A changed commit requires fresh review, not automatically a new owner decision/)
  assert.match(prose, /Never submit stale work/)
  assert.match(prose, /The broad cycle request alone still does not authorize an unenumerated push/)
  assert.match(prose, /Preparing is still private/)
})

test('ordinary CI verification is not an approval loop and read-only requests stay read-only', () => {
  assert.match(prose, /Ordinary read-only checks and bounded CI monitoring are verification, not another permission request/)
  assert.match(prose, /Do not invent indefinite monitoring/)
  assert.match(prose, /Keep a monitor-only request read-only/)
})

test('existing PR updates require exact public metadata without mutating it', () => {
  assert.match(prose, /For every `pr_update`/)
  assert.match(prose, /plan\.pr_metadata\.old_title/)
  assert.match(prose, /plan\.pr_metadata\.old_body/)
  assert.match(prose, /copy those same exact bytes/)
  assert.match(prose, /plan\.title/)
  assert.match(prose, /plan\.body_draft/)
  assert.match(prose, /Do not normalize, summarize, or reconstruct the text/)
  assert.match(prose, /publication precondition rather than a request to edit public metadata/)
  assert.match(prose, /exactly match `plan\.title` and `plan\.body_draft` before any branch mutation/)
  assert.match(prose, /does not PATCH the pull request's title or body/)
  assert.match(prose, /GitHub does not expose an expected-version guard/)
  assert.match(prose, /Any mismatch stops for a fresh private review/)
  assert.match(prose, /a restarted attempt must prove the same metadata precondition again/)
  assert.doesNotMatch(prose, /match either the exact recorded old values or the already-reviewed desired values/)
  assert.doesNotMatch(prose, /applies `plan\.title`\/`plan\.body_draft` once after the branch update/)
})

test('retired attached-work settlement is gone; Changes is informational only', () => {
  assert.doesNotMatch(prose, /settle_chat_changes|Changes ready to organize|--work-json|attached-work/)
  assert.match(core, /\*\*Changes\*\* view only lists its edits; it is never a request or approval/)
  assert.equal(existsSync(new URL('../settle_chat_changes.py', import.meta.url)), false)
})

// For one release window an older Möbius may still start the retired helper
// from Changes. The stub makes that helper stop and report; remove it after.
test('the attached-work stub tells an older helper the flow is retired and to change nothing', () => {
  const stub = read('attached-work.md').replace(/\s+/g, ' ')
  assert.match(stub, /Attached-work preparation is retired/)
  assert.match(stub, /Make no changes/)
  assert.match(stub, /Report back to the owner/)
  assert.match(stub, /Remove it after that window/)
  assert.doesNotMatch(stub, /agent_snapshot\.py|--work-json|restage|CAS/i, 'the stub gives no work instructions')
})

// The owner-facing docs outside the skill no longer describe Changes as a
// place where preparation or settlement happens.
test('product docs describe Changes as informational, not as a preparation flow', () => {
  const docs = ['README.md', 'PRODUCT.md', 'contributing/ledger.md'].map(name => read(name).replace(/\s+/g, ' ')).join(' ')
  assert.doesNotMatch(docs, /continue in its existing \*\*Changes\*\* view|settled work belongs in the chat's persistent Changes view|Recorded edits may prompt one lightweight preparation card|Changes preserve that lifecycle|Changes view settle/)
  const ui = read('ui/SourceConversations.jsx')
  assert.doesNotMatch(ui, /view: 'changes'|Open Changes|choose Changes/)
  assert.match(ui, /ask it to prepare its changes/, 'the error fallback still explains it')
  // One tap: the request is drafted in the conversation's composer, never sent.
  assert.match(ui, /type: 'moebius:open-chat', chatId: chat\.chat_id, draft: PREPARE_DRAFT \}/)
  assert.match(ui, /PREPARE_DRAFT = 'Prepare this conversation’s changes for review\.'/)
})

test('linked private reviews are locked until verified terminal cleanup', () => {
  assert.match(prose, /worktree lock/)
  assert.match(prose, /Contribute review <record-id>/)
  assert.match(prose, /Lock every linked review immediately after creation/)
  assert.match(prose, /`git worktree prune` from stranding reviewed owner work/)
  assert.match(prose, /cleanup verifies the reciprocal Git pointer and releases that exact lock/)
})

test('verification reuses exact environments and owns exceptional installs', () => {
  assert.match(prose, /scripts\.wt-pytest\.sh|scripts\/wt-pytest\.sh/)
  assert.match(prose, /scripts\.wt-npm\.sh|scripts\/wt-npm\.sh/)
  assert.match(prose, /exact `package-lock\.json` match|`package-lock\.json` matches exactly/)
  assert.match(prose, /Do not run a direct `npm ci`/)
  assert.match(prose, /checkout-local `\.venv`/)
})

test('mixed-action stacks advance through separately approved public phases', () => {
  assert.match(prose, /existing pull requests whose branches need an update/)
  assert.match(prose, /first confirm and update the consecutive `pr_update` prefix/)
  assert.match(prose, /separately confirm and open the `pr` suffix/)
  assert.match(prose, /full chain remains visible and is revalidated on both calls/)
  assert.match(prose, /never let one phase claim, hide, or inherit approval for the deferred phase/i)
})



test('private publication and local installation have separate ownership', () => {
  assert.match(prose, /An ordinary PR may remain uninstalled/)
  assert.match(prose, /Never install private work or invent a source witness/)
  assert.match(prose, /Missing proof means no witness/)
  assert.match(prose, /Exact head, diff, approval, public target and retry checks remain mandatory/)
  assert.match(prose, /app-connection promise still requires its installed-source proof/)
  assert.doesNotMatch(prose, /The submit path proves `base_sha\.\.head_sha` is present in that source commit/)
})

test('a Goal does not manufacture permission or duplicate the owning decision surface', () => {
  assert.match(prose, /An open Goal does not create a new permission requirement/)
  assert.match(prose, /If permission is genuinely missing, use one decision surface/)
  assert.match(prose, /Do not ask for the same decision on both surfaces/)
  assert.match(prose, /A saved approval card claims its work key itself/)
})

test('the general layer is project-shaped and Möbius facts live in its adapter', () => {
  const cycle = mode('cycle.md')
  const mobius = mode('adapter-mobius.md')
  const github = mode('adapter-github.md')
  for (const adapter of ['adapter-mobius.md', 'adapter-github.md']) {
    assert.ok(cycle.includes(`](${adapter})`), `cycle registers ${adapter}`)
  }
  assert.doesNotMatch(cycle, /## Current Möbius adapter/)
  assert.match(core, /under a project root its adapter registers/)
  assert.doesNotMatch(core, /the platform \(`\/data\/platform\/`\), and the shell/)
  assert.match(mobius, /the platform \(`\/data\/platform\/`\), and the shell/)
  for (const [name, body] of [['SKILL.md', core], ...['ci.md', 'prepare.md', 'branch.md'].map((n) => [n, mode(n)])]) {
    assert.doesNotMatch(body, /mobius-os\/mobius|area: ui|playwright-local|catalog\.json/, `${name} stays general`)
    // Send's screenshot hosting is documented with the stage call; capture tools and sizes belong to an adapter.
    assert.doesNotMatch(body, /mobius-screenshots|screenshot_upload|agent-screenshot|VIEWPORT_WIDTH|390 px/, `${name} leaves screenshot mechanics to ledger.md and the adapter`)
  }
  assert.match(github, /never assume\s+`main`/)
  assert.match(github, /defaultBranchRef/)
  assert.match(github, /\/data\/contrib\/<record-id>\/worktree/)
  assert.match(mode('ci.md'), /target repository's required checks are the final gate/)
})

test('legacy bot and maintainer-only material each have one owner', () => {
  const legacy = mode('legacy-bot.md')
  const maintainer = mode('maintainer.md')
  for (const name of modeFiles.filter((n) => n !== 'legacy-bot.md')) {
    assert.doesNotMatch(mode(name), /relay_contribution_id|relay_revision/, `${name} leaves relay fields to the legacy file`)
  }
  assert.match(legacy, /relay_contribution_id/)
  assert.match(maintainer, /permissions\.push/)
  assert.match(maintainer, /review_prs\.py/)
  assert.match(maintainer, /connect_app/)
  assert.ok(!existsSync(new URL('../contributing/review-merge.md', import.meta.url)))
  assert.doesNotMatch(mode('ledger.md'), /"repo_path": "\/data\/apps\/<slug>"/)
})

test('the co-author trailer is the default and an opt-out is explicit and disclosed', () => {
  assert.match(prose, /`coauthor_trailer: false` is the only way to omit that trailer/)
  assert.match(prose, /Contribute's review shows the omission; give the reason/)
  assert.match(prose, /unless the reviewed plan set `coauthor_trailer: false`/)
})

test('skill text states rules rather than incident history', () => {
  assert.doesNotMatch(prose, /second doorway|Older platforms may still require|parallel Möbius-maintainer roster|chat-settlement|older boot cleaners|baked boot cleaner|ecosystem is young/)
})

test('pull-request records are staged and reviewed through Contribute, never hand-written', () => {
  assert.match(prose, /contributions\/<id>\/<record-id>\/stage/)
  assert.match(prose, /contributions\/<id>\/<record-id>\/review/)
  assert.match(prose, /never recompute or hand-write those fields/)
  assert.doesNotMatch(prose, /CAS-(store|mark|update) `?quality_review/)
})

test('the retired-flow stub ships with the app for its one release window', () => {
  const manifest = JSON.parse(read('mobius.json'))
  assert.ok(manifest.source_files.includes('attached-work.md'))
})

test('the read-only PR link helper has its own routing row outside maintainer rights', () => {
  const skill = readFileSync(new URL('../contributing/SKILL.md', import.meta.url), 'utf8')
  const rows = skill.split('\n').filter(line => line.startsWith('|'))
  const rights = rows.find(line => line.includes('upstream push or merge rights'))
  assert.ok(rights && !rights.includes('pr_block.py'), 'pr_block.py is not filed under maintainer rights')
  assert.ok(rows.some(line => line.includes('pr_block.py') && /no rights needed/.test(line)))
})

test('the Send-in-chat guidance describes one item per contribution and exactly one card action', () => {
  const publish = read('contributing/publish.md').replace(/\s+/g, ' ')
  assert.match(publish, /one item \(its PR title, opening that exact entry in Contribute, with its \*\*Project\*\* and \*\*Change\*\* size\) and has exactly one action/)
  assert.match(publish, /Items have no buttons of their own/)
  assert.match(publish, /at most 12 items; with more, it says how many more are in Contribute and offers no action/)
  assert.doesNotMatch(publish, /a \*\*Contribute\*\* per item/)
  assert.match(publish, /Naming any layer of a stack lists every prepared layer of that stack/)
  const readme = read('README.md').replace(/\s+/g, ' ')
  assert.match(readme, /session `items`/)
  assert.match(readme, /"expand": false/)
})

test('prepared PRs name the bug cause and show visible changes with attached screenshots', () => {
  const prepare = mode('prepare.md').replace(/\s+/g, ' ')
  const ledger = mode('ledger.md').replace(/\s+/g, ' ')
  const mobius = mode('adapter-mobius.md').replace(/\s+/g, ' ')
  assert.match(prepare, /A bug fix's `body_draft` names the cause/)
  assert.match(prepare, /you cannot name the cause it answers/)
  assert.match(prepare, /A change people can see shows it with before\/after screenshots/)
  assert.match(prepare, /Attach screenshots when you stage, never by pushing them yourself/)
  assert.match(prepare, /a visible change without screenshots or a stated reason for their absence, is not ready/)
  // Agents follow the stage call literally, so it carries the availability flag and every refusal.
  assert.match(ledger, /only when `mapi \/api\/github\/status` reports `"screenshot_upload": true`/)
  assert.match(ledger, /Staging refuses them on a `pr_update`/)
  assert.match(ledger, /legacy `mobius-bot` record/)
  assert.match(ledger, /the hosting repository is private/)
  assert.match(ledger, /regular file under `\/data` or the temp folder, not a link/)
  // The screenshot tool has no width option; the narrow capture goes through the helper.
  assert.match(mobius, /An `area: ui` PR or an app PR that changes what people see/)
  assert.match(mobius, /VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844/)
  assert.match(mobius, /bash "\$SCRIPTS_DIR\/agent-screenshot\.sh" <route>/)
  assert.doesNotMatch(mobius, /Capture them with the Möbius `screenshot` tool/)
})

test('the privacy allowlist has exactly two entries and the mode files link to the screenshot entry', () => {
  const section = core.split('## What may leave — the privacy allowlist')[1].split(/\n## /)[0]
  const [allowlist, rest] = section.split('**Never, no exceptions:**')
  assert.ok(rest, 'the exclusions follow the allowlist')
  const entries = [...allowlist.matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map((match) => match[1])
  assert.deepEqual(entries, ['Source code', 'UI screenshots of the change'])
  assert.match(allowlist, /these two, and that is the whole list/)
  const exclusions = rest.replace(/\s+/g, ' ')
  for (const item of ['`/data/shared/memory/`', 'app storage', 'the database', 'logs', '`/data/cli-auth/`', 'chat content', 'anything personal']) {
    assert.ok(exclusions.includes(item), `the allowlist still excludes ${item}`)
  }
  const hardStop = core.match(/^2\. \*\*([^*]+)\*\*/m)[1].replace(/\s+/g, ' ')
  assert.match(hardStop, /Only source code and screenshots of the change leave the instance/)
  assert.match(prose, /The allowlist below is exhaustive — never memory, storage, db, logs, creds, chat, or personal data\./)
  for (const name of ['prepare.md', 'ledger.md']) {
    assert.match(mode(name).replace(/\s+/g, ' '), /screenshot entry of the privacy allowlist in \[SKILL\.md\]\(SKILL\.md\)/, `${name} refers to the core rule`)
  }
  assert.match(mode('adapter-mobius.md').replace(/\s+/g, ' '), /attach that screenshot when you stage/)
})
