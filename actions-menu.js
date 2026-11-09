// What the Actions menu offers for the PR(s) in front of it. It only lays out
// the PR machine's decision (pr-machine.js): the header says where the PR
// stands, then what you can do yourself ("You") and what an agent can do
// ("Agent"). The highlighted choice comes first; a choice that cannot run stays
// in place, dimmed, with the machine's reason.
import { checkSummary, conversationCount } from './collaboration.js'
import { isPersonalDraft } from './domain.js'

// The agent jobs and your own actions the menu shows, by machine action id, in
// their fixed order. Take over sits apart at the bottom: it is rare and deliberate.
export const AGENT_MENU = { check_my_pr: 'review', respond: 'reply', finish_it: 'fix', review: 'review', take_over: 'takeover' }
const YOUR_MENU = { open_for_review: 'send', back_to_draft: 'draft', ask_rereview: 'person', ask_approval: 'person', merge: 'merge', close: 'close' }
// Each of your actions exists only where this Möbius can do it for you.
const CAPABILITY = { open_for_review: 'mark_ready_now', back_to_draft: 'back_to_draft_now', ask_rereview: 'request_rereview_now', ask_approval: 'ask_approval_now', merge: 'merge_now', close: 'close_now' }
export const YOUR_INTENTS = new Set(Object.keys(YOUR_MENU))
export const AGENT_INTENTS = new Set(Object.keys(AGENT_MENU))

// One line of facts about a PR: draft, checks and conflicts. Who approved what is the
// machine's headline below it, so GitHub's own review summary is not repeated here.
export function pullHeader(pr) {
  const checks = checkSummary(pr)
  const parts = [
    pr?.isDraft ? 'draft' : '',
    conversationCount(pr) ? '' : 'no reviews',
    checks?.failed > 0 ? `${checks.failed} failing ${checks.failed === 1 ? 'check' : 'checks'}`
      : checks?.state === 'success' ? 'checks passing' : checks?.state === 'pending' ? 'checks running' : '',
    pr?.mergeable === 'CONFLICTING' ? `conflicts with ${pr.baseRefName || 'the target branch'}` : '',
  ]
  return { label: `#${pr.number}`, text: parts.filter(Boolean).join(' · ') }
}

// Closing is the one destructive row: it is set apart, last, and never takes the first focus.
const DESTRUCTIVE = new Set(['close'])
const asItem = (action, icon) => ({ intent: action.id, icon, title: action.title, detail: action.detail, rec: action.highlighted, off: !action.enabled, reason: action.reason, danger: DESTRUCTIVE.has(action.id) })

// Whether this Möbius can run one of your own actions for you (the menu lists it, the next-step button offers it).
export const mayRunYourAction = (id, { record, capabilities }) => !!YOUR_MENU[id]
  && (capabilities?.[CAPABILITY[id]] === true || (id === 'open_for_review' && isPersonalDraft(record)))

function yourItems(decision, { record, capabilities }) {
  return decision.actions.filter(action => mayRunYourAction(action.id, { record, capabilities }))
    .map(action => asItem(action, YOUR_MENU[action.id]))
    .sort((a, b) => Number(a.danger) - Number(b.danger) || Number(b.rec) - Number(a.rec))
}

function agentItems(decision) {
  const items = decision.actions.filter(action => AGENT_MENU[action.id]).map(action => asItem(action, AGENT_MENU[action.id]))
  const rare = items.filter(item => item.intent === 'take_over')
  return [...items.filter(item => item.intent !== 'take_over').sort((a, b) => Number(b.rec) - Number(a.rec)), ...rare]
}

// Several PRs at once: only a review (a private check on your own PRs) can run
// as a batch, and only when every selected PR allows it.
function batchItems(decisions) {
  const reasons = decisions.map(decision => decision.actions.find(action => ['review', 'check_my_pr'].includes(action.id))?.reason || '')
  const reason = reasons.find(Boolean) || ''
  return [{ intent: 'review', icon: 'review', title: 'Review each', detail: 'Your own PRs are only checked privately.', rec: false, off: !!reason, reason }]
}

// `decisions` line up with `pulls` (one machine decision each). Returns { header, headline, you, agent }.
export function actionsMenuModel(pulls, decisions, { record = null, capabilities = null } = {}) {
  const list = (Array.isArray(pulls) ? pulls : []).filter(Boolean)
  if (list.length !== 1) return { header: list.length ? { label: `${list.length} PRs`, text: 'selected' } : null, headline: '', you: [], agent: list.length ? batchItems(decisions) : [] }
  const decision = decisions?.[0]
  if (!decision) return { header: pullHeader(list[0]), headline: '', you: [], agent: [] }
  return { header: pullHeader(list[0]), headline: decision.headline, you: yourItems(decision, { record, capabilities }), agent: agentItems(decision) }
}
