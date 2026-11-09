import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { NAMES, rerunName } from '../names.js'
import { decide } from '../pr-machine.js'

const root = new URL('../', import.meta.url)
const sources = [...readdirSync(root).filter(name => /\.(js|jsx)$/.test(name)),
  ...readdirSync(new URL('ui/', root)).filter(name => /\.(js|jsx)$/.test(name)).map(name => `ui/${name}`)]
  // review.js holds the agents' own instructions, not screen text.
  .filter(name => name !== 'review.js')

// Names the app used for one meaning before the standard names list (critique, 2026-11-05).
const RETIRED = ['Mark ready', 'Review and send', 'Re-review', 'Start again', 'Source chat', 'Saved work',
  'Review chats', 'review conversation', 'Check my PR', 'Address feedback', 'Close PR', 'Contribution actions',
  'Contribution approval', 'Refresh PR list', 'Refresh checks', 'Refresh Contribute', 'Your edits', 'My work', 'PR reviews',
  'To confirm', 'Merged this week', 'Make PRs from my edits']

// Screen text: a quoted string or JSX text. Comments may still name the old words.
const screenText = line => !/^\s*(\/\/|\*|\/\*)/.test(line)
const quotedOrJsx = word => new RegExp(`(['"\`>]|\\. )${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

test('no retired name is left in screen text, so one meaning keeps one name', () => {
  const found = []
  for (const file of sources) {
    readFileSync(new URL(file, root), 'utf8').split('\n').forEach((line, index) => {
      if (!screenText(line)) return
      for (const word of RETIRED) if (quotedOrJsx(word).test(line)) found.push(`${file}:${index + 1} ${word}`)
    })
  }
  assert.deepEqual(found, [])
})

test('a stopped review runs again as Review again, a stopped fix job as Run it again', () => {
  assert.equal(rerunName('review'), NAMES.reviewAgain)
  assert.equal(rerunName('review_merge'), NAMES.reviewAgain)
  for (const kind of ['respond', 'fix', 'review_fix_merge']) assert.equal(rerunName(kind), NAMES.runAgain)
  const facts = { author: 'sam', head: 'h', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'WRITE', reviews: [],
    openThreads: 0, myReview: null, result: null, outbox: null, readComplete: true, role: 'reviewer' }
  const rerun = job => decide({ ...facts, job }).actions.find(action => action.id === 'rerun_job')
  assert.equal(rerun({ kind: 'review', state: 'stalled' }).title, 'Review again')
  assert.equal(rerun({ kind: 'respond', state: 'stalled' }).title, 'Run it again')
})

test('the PR machine names every action from the standard names', () => {
  const reviewer = decide({ author: 'sam', head: 'h', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'ADMIN', reviews: [],
    openThreads: 0, myReview: null, job: null, result: null, outbox: null, readComplete: true, role: 'reviewer' })
  const titles = Object.fromEntries(reviewer.actions.map(action => [action.id, action.title]))
  assert.equal(titles.close, NAMES.closePr)
  assert.equal(titles.merge, NAMES.merge)
  assert.equal(titles.take_over, NAMES.takeOver)
  assert.equal(titles.review, NAMES.review)
})

test('the app\'s repository list and its settings take their own names, not the shell\'s words', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const rail = read('ui/Desk.jsx'), picker = read('ui/RepositoryPicker.jsx')
  assert.equal(NAMES.repositories, 'Repositories')
  assert.equal(NAMES.settings, 'Contribute settings')
  assert.match(rail, /\{NAMES\.repositories\}<\/h2>/)
  assert.match(rail, /<span>\{NAMES\.moreRepositories\}<\/span>/)
  assert.match(picker, /<span>\{NAMES\.addRepository\}<\/span>/)
  assert.match(read('ui/ConnectionCard.jsx'), /<h2>\{NAMES\.settings\}<\/h2>/)
})

test('an icon means one thing: the sparkle marks agent work only, never the mixed Actions menu', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.doesNotMatch(read('ui/ActionsMenu.jsx'), /name="prepare"/, 'Actions holds your own steps too')
  assert.doesNotMatch(read('ui/PullRequestDetail.jsx'), /Open prepared PR[^>]*><Icon name="prepare"/, 'a prepared PR is a draft, not an agent')
  const rail = read('desk.js')
  const icons = [...rail.matchAll(/key: '[a-z]+', label: NAMES\.\w+, short: [^,]+, icon: '(\w+)'/g)].map(match => match[1])
  assert.equal(new Set(icons).size, icons.length, 'the four views each have their own icon')
})
