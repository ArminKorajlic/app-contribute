import { contributionScopeHash } from './review.js'

// Chat blocks are destinations, never approval. Opening one navigates to an
// exact identity in the project workspace; nothing starts or is sent. A send
// key only names records; the owner's Confirm on the card is the approval.
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const MAX_BATCH = 12
export const validRecordId = id => typeof id === 'string' && RECORD_ID.test(id)

export function chatBlockTarget(intent) {
  // A review run opens in the full project workspace; opening never starts one.
  const run = /^review-run:([A-Za-z0-9_-]{8,64})$/.exec(String(intent || ''))
  if (run) return { kind: 'run', id: run[1] }
  const pull = /^pull-request:([^/#\s]+)\/([^/#\s]+)#([1-9][0-9]{0,9})$/.exec(String(intent || ''))
  if (!pull) return null
  const [, owner, name, number] = pull
  if (![owner, name].every(part => REPOSITORY_PART.test(part) && !/^\.+$/.test(part))) return null
  const value = Number(number)
  return Number.isSafeInteger(value) ? { kind: 'pull', repo: `${owner}/${name}`, number: value } : null
}

const SEND = /^chat-send:(.+)$/
const BATCH = /^chat-send-batch:([0-9a-f]{16})$/

// A short, content-addressed handle for the records a batch card lists. It
// binds the exact set (prepared_block.py computes the same value) and keeps
// the intent bounded however long the record ids are. It is a reference, not
// an approval token.
export const batchHandle = ids => contributionScopeHash(['contribute-batch-v1', ...[...new Set(ids)].sort()].join('\n'))

// The records a card names, from the item intents the host sends with the
// session (`init.items`, in card order, deduplicated by the host). Every item
// must be a ledger entry (`review:<id>`); any other item makes the card
// unresolvable rather than silently narrowing it. null means the host sent no
// items (an older Möbius), so the card's action names nothing.
const REVIEW_ITEM = /^review:(.+)$/
export function itemRecordIds(items) {
  if (!Array.isArray(items)) return null
  const ids = items.map(item => REVIEW_ITEM.exec(String(item?.intent || ''))?.[1])
  return ids.every(validRecordId) ? [...new Set(ids)] : []
}

// Resolve the card's one action against the records its items name. The
// action is `chat-send:<id>` for a one-item card or `chat-send-batch:<handle>`
// over every item; either must match the items exactly, or it is refused. The
// items, never the action, are the source of the record set.
export function sendTarget(key, items) {
  const single = SEND.exec(String(key || ''))
  const batch = BATCH.exec(String(key || ''))
  if (!(single ? validRecordId(single[1]) : batch)) return null
  const kind = single ? 'record' : 'batch'
  const ids = itemRecordIds(items)
  if (!ids) return { kind, ids: [], needsItems: true }
  const matches = ids.length >= 1 && ids.length <= MAX_BATCH
    && (single ? ids.length === 1 && ids[0] === single[1] : batchHandle(ids) === batch[1])
  return matches ? { kind, ids } : { kind, ids: [], invalid: true }
}

// Every record a card's action names, for read-only status requests.
export const cardRecordIds = (keys, items) => [...new Set(keys.flatMap(key => sendTarget(key, items)?.ids || []))]
