// The standard names: one name for one meaning, everywhere in Contribute.
// Every button, menu row, hint, pill and test reads its words from here, so a
// name cannot drift between screens. The rule behind them: a pill says what is
// true, a hint is one sentence, a button says what you do.
// Changing a name? Change it here only; the tests read this file too.

export const NAMES = Object.freeze({
  // Things
  pr: 'PR',
  preparedPr: 'Prepared PR',
  localChanges: 'Local changes',
  agentRun: 'Agent run',
  // The second card of an app on the Agent runs page: its prepared PRs and saved decisions, apart from its runs.
  preparedWork: 'Prepared work',
  // The pill on a prepared draft that is waiting for you to open it.
  readyToOpen: 'Ready to open',

  // Views in the side menu
  needsYou: 'Needs you',
  reviewRequests: 'Review requests',
  myPrs: 'My PRs',
  agentRuns: 'Agent runs',

  // Actions on a PR
  openForReview: 'Open for review',
  backToDraft: 'Back to draft',
  review: 'Review',
  reviewAgain: 'Review again',
  // A stopped fix job (Fix these findings, Finish it for me, Respond to feedback, Take over) starts
  // over under these words, the same words as the Agent stopped hint.
  runAgain: 'Run it again',
  // Three agent jobs on your own PR, kept apart on purpose (owner's choice, 2026-11-05).
  fixFindings: 'Fix these findings',
  finishIt: 'Finish it for me',
  respond: 'Respond to feedback',
  takeOver: 'Take over',
  approve: 'Approve',
  requestChanges: 'Request changes',
  ignore: 'Ignore',
  merge: 'Merge',
  closePr: 'Close pull request',
  assign: 'Assign',
  askRereview: 'Ask for re-review',
  // Posts a note naming the reviewers who commented but have not approved (the PR machine's ask_approval).
  askApproval: 'Ask for approval',

  // What reaches GitHub
  sendToGitHub: 'Send to GitHub',
  postToGitHub: 'Post to GitHub',
  push: 'Push',

  // Other buttons
  sync: 'Sync',
  discard: 'Discard',
  openChat: 'Open chat',
  answerInChat: 'Answer in chat',
  // A saved Respond to feedback answer on the Review tab: Post publishes it as you; Reply in chat opens its conversation to talk it
  // over first (answerInChat is for a question the agent asked); Send again re-sends an approved Post to the chat; Try again carries
  // on a post that stopped; Respond again starts a second pass that replaces the answer.
  postAnswer: 'Post',
  replyInChat: 'Reply in chat',
  sendAgain: 'Send again',
  tryAgain: 'Try again',
  respondAgain: 'Respond again',
  copyHash: 'Copy hash',
  cancel: 'Cancel',
  clearSearch: 'Clear search',
  showFullMessage: 'Show the full message',
  viewOnGitHub: 'View on GitHub',
  settings: 'Contribute settings',

  // The app's list of followed repositories. "Projects" is the Möbius shell's own word for something else.
  repositories: 'Repositories',
  moreRepositories: 'More repositories',
  allRepositories: 'All repositories',
  addRepository: 'Add repository',
})

const REVIEW_JOBS = new Set(['review', 'review_merge'])
// The words for starting a stopped agent job over: a review is reviewed again.
export const rerunName = kind => (REVIEW_JOBS.has(kind) ? NAMES.reviewAgain : NAMES.runAgain)
