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
  const pull = /^pull-request:([^/#\s]+)\/([^/#\s]+)#([1-9][0-9]{0,9})$/.exec(String(intent || ''))
  if (!pull) return null
  const [, owner, name, number] = pull
  if (![owner, name].every(part => REPOSITORY_PART.test(part) && !/^\.+$/.test(part))) return null
  const value = Number(number)
  return Number.isSafeInteger(value) ? { kind: 'pull', repo: `${owner}/${name}`, number: value } : null
}

// The chat card (prepared_block.py). Its block intent is the same for every
// card, so the chat host can tell which card is the newest of its chat; its
// one action covers what the ledger says this chat has ready at the moment of
// Confirm. The card's items are a static fallback for hosts that cannot run
// the card, and the record ids they name are only hints of where to look.
export const CHAT_INTENT = 'chat:contributions'
export const CHAT_ACTION = 'chat-contribute:all'
const OLD_SEND = /^chat-send:(.+)$/
const OLD_BATCH = /^chat-send-batch:[0-9a-f]{16}$/
const REVIEW_ITEM = /^review:(.+)$/

// The record ids a card's items name (`review:<id>` intents, in card order).
export function hintedIds(items) {
  return [...new Set((Array.isArray(items) ? items : []).map(item => REVIEW_ITEM.exec(String(item?.intent || ''))?.[1])
    .filter(validRecordId))].slice(0, MAX_BATCH)
}

// What kind of card this is, from the actions and items the host sends:
// `chat` (this card), `old` (a card printed before it, read-only status; a
// one-record card printed before items named records names its record in its
// action), or null (nothing Contribute prints).
export function cardKind(actions, items) {
  const keys = (Array.isArray(actions) ? actions : []).map(action => String(action?.key || ''))
  if (keys.includes(CHAT_ACTION)) return { kind: 'chat', key: CHAT_ACTION, hints: hintedIds(items) }
  const key = keys.find(value => OLD_SEND.test(value) || OLD_BATCH.test(value))
  if (!key) return null
  const hints = hintedIds(items)
  const legacy = OLD_SEND.exec(key)?.[1]
  return { kind: 'old', key, hints: hints.length || !validRecordId(legacy) ? hints : [legacy] }
}

// A record belongs to a chat when that chat created it or reconciled it
// (`chat_id`, `chat_ids`; contributing/ledger.md).
export const inChat = (record, chatId) => Boolean(chatId) && (record?.chat_id === chatId
  || (Array.isArray(record?.chat_ids) && record.chat_ids.includes(chatId)))
