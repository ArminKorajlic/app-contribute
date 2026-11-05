// Conversations that created, reviewed or fixed one exact public PR. Both the
// repository and the number must match: equal numbers in other repositories
// are unrelated work.
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/
export const ROLE_TITLES = { source: 'Source conversation', review: 'Review conversation', fix: 'Fix conversation' }

const recordRepo = record => (record.repo || record.plan?.repo || '').toLowerCase()

export function recordsForPull(records, pr) {
  const repo = pr.repository.nameWithOwner.toLowerCase()
  return (records || []).filter(record => recordRepo(record) === repo && record.number === pr.number)
}

export function pullConversations(records, runs, pr) {
  const links = new Map()
  function add(chatId, role, title) {
    if (typeof chatId !== 'string' || !CHAT_ID.test(chatId) || links.has(chatId)) return
    links.set(chatId, { chat_id: chatId, role, title: title || ROLE_TITLES[role] })
  }
  for (const record of recordsForPull(records, pr)) {
    add(record.chat_id, 'source', record.chat_title)
    for (const id of record.chat_ids || []) add(id, 'source')
    add(record.quality_review?.chat_id, 'review')
    add(record.autopilot?.followup_chat_id || record.autopilot?.chat_id, 'fix')
    for (const round of record.autopilot?.rounds || []) add(round.chat_id, 'fix')
  }
  const repo = pr.repository.nameWithOwner.toLowerCase()
  for (const run of runs || []) {
    if (run.items?.some(item => item.repo?.toLowerCase() === repo && item.number === pr.number)) add(run.chat_id, 'review')
  }
  return [...links.values()]
}
