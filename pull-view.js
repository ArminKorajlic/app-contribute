import { prKey } from './collaboration.js'

// One identity boundary for the PR list. Every read takes a generation when it
// is issued; for each PR the newest-issued successful read wins, whichever
// reader (open-PR list or exact PR) produced it and whenever it completes.
// An assignment acknowledgement is an overlay on top of that observation: a
// read issued before the acknowledgement may still carry the old assignees,
// while a read issued after it is authoritative and retires the overlay.

export const isOpenPull = pr => !pr?.state || pr.state === 'OPEN'

export const emptyPullView = () => ({ inventory: [], rows: new Map(), assigned: new Map() })

const IDENTITY = ['headRefOid', 'baseRefOid', 'baseRefName']

// `inventory` is the open-list membership and order; `pinned` keeps one exact
// destination (a focused closed or later-page PR) outside that membership.
export function observePulls(view, pulls, generation, { inventory = view.inventory, pinned = '' } = {}) {
  const rows = new Map(view.rows)
  const assigned = new Map(view.assigned)
  for (const pr of pulls) {
    const key = prKey(pr)
    if (generation < (rows.get(key)?.generation ?? -Infinity)) continue
    rows.set(key, { pr, generation })
    const overlay = (assigned.get(key) || []).filter(receipt => receipt.generation > generation)
    overlay.length ? assigned.set(key, overlay) : assigned.delete(key)
  }
  const kept = new Set([...inventory, pinned].filter(Boolean))
  for (const key of rows.keys()) if (!kept.has(key)) { rows.delete(key); assigned.delete(key) }
  return { inventory, rows, assigned }
}

export function acknowledgeAssignment(view, keys, login, generation) {
  const assigned = new Map(view.assigned)
  for (const key of keys) {
    if (!view.rows.has(key)) continue
    const others = (assigned.get(key) || []).filter(receipt => receipt.login.toLowerCase() !== login.toLowerCase())
    assigned.set(key, [...others, { login, generation }])
  }
  return { ...view, assigned }
}

function withAssignees(pr, receipts) {
  if (!receipts?.length) return pr
  const users = new Map((pr.assignees?.nodes || []).map(user => [user.login.toLowerCase(), user]))
  for (const { login } of receipts) if (!users.has(login.toLowerCase())) users.set(login.toLowerCase(), { login })
  return { ...pr, assignees: { nodes: [...users.values()] } }
}

// Inventory order first; a pinned destination outside it is appended.
export function pullsInView(view, pinned = '') {
  const keys = pinned && !view.inventory.includes(pinned) ? [...view.inventory, pinned] : view.inventory
  return keys.filter(key => view.rows.has(key)).map(key => withAssignees(view.rows.get(key).pr, view.assigned.get(key)))
}

// Selected keys whose exact version changed, closed, or left the view. A
// selection is consent input for one version and never moves to another.
export function invalidatedSelection(selected, before, after) {
  const previous = new Map(before.map(pr => [prKey(pr), pr]))
  const current = new Map(after.map(pr => [prKey(pr), pr]))
  return [...selected].filter(key => {
    const old = previous.get(key), next = current.get(key)
    return !old || !next || !isOpenPull(next) || IDENTITY.some(field => old[field] !== next[field])
  })
}

// Whether the signed-in owner wrote this PR. GitHub refuses a verdict from a
// PR's author, so reviews of one's own PRs read and act differently.
export const isOwnPull = (pr, login) => !!login && !!pr?.author?.login && pr.author.login.toLowerCase() === login.toLowerCase()
