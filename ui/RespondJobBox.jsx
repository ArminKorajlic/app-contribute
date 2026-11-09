import { ReviewFrame } from './ReviewFrame.jsx'
import { openAgentConversation } from './BatchAction.jsx'
import { frameOf } from '../pr-standing.js'
import { REVIEW_STATE_NAMES } from '../collaboration.js'
import { NAMES } from '../names.js'

// The Review tab's box while a Respond-to-feedback conversation holds the PR. That conversation is no review
// run, so without this box the tab would read "No review yet" with an agent at work or waiting on you. It uses the
// words and button of a review that waits on you (REVIEW_STATE_NAMES.awaiting_owner, "Answer in chat"): the
// question itself, with the context it points to, lives in the conversation.
export function RespondJobBox({ chat, pr, standing }) {
  const asks = chat.state === 'needs_answer'
  const name = `${NAMES.respond} on #${pr.number}`
  return <ReviewFrame state={frameOf(standing)} radius={12}>
    <div className={'co-review-box' + (asks ? ' is-verdict' : '')} aria-label={name}>
      <div className="co-review-head">
        {asks ? null : <span className="co-arc" aria-hidden="true" />}
        <h4>{asks ? REVIEW_STATE_NAMES.awaiting_owner : 'Working on feedback'}</h4>
      </div>
      <p className="co-review-note">“{name}” {asks ? 'stopped on a question. The question, its answers and anything it wants to post are in the conversation.' : 'is working. Open the conversation to follow it.'}</p>
      <div className="co-review-actions">
        <button type="button" className="co-btn co-btn-primary" onClick={() => openAgentConversation(chat.chat_id)}>{asks ? NAMES.answerInChat : NAMES.openChat}</button>
      </div>
    </div>
  </ReviewFrame>
}
