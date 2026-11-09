import { contributionScopeHash } from './review.js'

// Chat blocks are destinations, never approval. Opening one navigates to an
// exact identity in the project workspace; nothing starts or is sent. Only the
// owner's Confirm on the card, of the list it shows then, is the approval.
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const MAX_BATCH = 12
export const validRecordId = id => typeof id === 'string' && RECORD_ID.test(id)

export function chatBlockTarget(intent) {
  // A review run opens in the full project workspace; opening never starts one.
  const run = /^review-run:([A-Za-z0-9_-]{8,64})$/.exec(String(intent || ''))
  if (run) return { kind: 'run', id: run[1] }
  // `pr:owner:repo:123` is the same destination in the spelling a notification
  // link may carry (its intents allow no "/" or "#").
  const text = String(intent || '')
  const pull = /^pull-request:([^/#\s]+)\/([^/#\s]+)#([1-9][0-9]{0,9})$/.exec(text)
    || /^pr:([^:/#\s]+):([^:/#\s]+):([1-9][0-9]{0,9})$/.exec(text)
  if (!pull) return null
  const [, owner, name, number] = pull
  if (![owner, name].every(part => REPOSITORY_PART.test(part) && !/^\.+$/.test(part))) return null
  const value = Number(number)
  return Number.isSafeInteger(value) ? { kind: 'pull', repo: `${owner}/${name}`, number: value } : null
}

// The chat card (prepared_block.py). Its block intent is the same for every
// card, so a chat host that attests it (`rows-v2`) can tell which card is the
// newest of its chat; there the card's action covers what the ledger says this
// chat has ready at the moment of Confirm, and its items only say where to
// look. Its one action keeps the earlier card's shape, so a host without
// `rows-v2` runs it exactly as before (inline-session-v1.js): the action must
// match the items, which are then exactly what it sends.
export const CHAT_INTENT = 'chat:contributions'
const SEND = /^chat-send:(.+)$/
const BATCH = /^chat-send-batch:([0-9a-f]{16})$/
const REVIEW_ITEM = /^review:(.+)$/

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
export function itemRecordIds(items) {
  if (!Array.isArray(items)) return null
  const ids = items.map(item => REVIEW_ITEM.exec(String(item?.intent || ''))?.[1])
  return ids.every(validRecordId) ? [...new Set(ids)] : []
}

// Resolve the card's one action against the records its items name, on a
// host without `rows-v2`. The action is `chat-send:<id>` for a one-item card
// or `chat-send-batch:<handle>` over every item; either must match the items
// exactly, or it is refused. The items, never the action, are the source of
// the record set. A card printed before its items named records has no
// `review:` item: its one-record action names the record whose status it
// shows (`legacy`), but a refused target never sends (`ids` stays empty).
export function sendTarget(key, items) {
  const single = SEND.exec(String(key || ''))
  const batch = BATCH.exec(String(key || ''))
  if (!(single ? validRecordId(single[1]) : batch)) return null
  const kind = single ? 'record' : 'batch'
  const ids = itemRecordIds(items)
  if (!ids) return { kind, ids: [], needsItems: true }
  const matches = ids.length >= 1 && ids.length <= MAX_BATCH
    && (single ? ids.length === 1 && ids[0] === single[1] : batchHandle(ids) === batch[1])
  if (matches) return { kind, ids }
  const legacy = single && !items.some(item => REVIEW_ITEM.test(String(item?.intent || '')))
  return legacy ? { kind, ids: [], invalid: true, legacy: single[1] } : { kind, ids: [], invalid: true }
}

// Every record a card's action names, for read-only status requests.
export const cardRecordIds = (keys, items) => [...new Set(keys.flatMap(key => sendTarget(key, items)?.ids || []))]

// The record ids a card's items name (`review:<id>` intents, in card order).
export function hintedIds(items) {
  return [...new Set((Array.isArray(items) ? items : []).map(item => REVIEW_ITEM.exec(String(item?.intent || ''))?.[1])
    .filter(validRecordId))].slice(0, MAX_BATCH)
}

// A Contribute card's one action and the record ids it hints at: its items,
// or for a one-record card printed before items named records, the record its
// action names. null for anything Contribute does not print. Whether it is
// the chat's live card is the host's attested block intent, not the card.
export function cardKind(actions, items) {
  const keys = (Array.isArray(actions) ? actions : []).map(action => String(action?.key || ''))
  const key = keys.find(value => SEND.test(value) || BATCH.test(value))
  if (!key) return null
  const hints = hintedIds(items)
  const legacy = SEND.exec(key)?.[1]
  return { key, hints: hints.length || !validRecordId(legacy) ? hints : [legacy] }
}

// A record belongs to a chat when that chat created it or reconciled it
// (`chat_id`, `chat_ids`; contributing/ledger.md).
export const inChat = (record, chatId) => Boolean(chatId) && (record?.chat_id === chatId
  || (Array.isArray(record?.chat_ids) && record.chat_ids.includes(chatId)))
