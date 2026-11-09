// How a new pull request opens from Contribute: as a draft nobody is asked to
// review yet, or ready for review. A shipped default of 'ready' keeps the
// product's documented normal publication (PRODUCT.md); an owner who works
// draft-first sets 'draft' in Settings. Only a new PR on the owner's own GitHub
// account has a choice: an update edits an existing PR, and a relay draft is
// always a draft.
import { contributionPath } from './contribution-policy.js'

export const DEFAULT_STAGE = 'ready'
export const stageOf = value => value === 'draft' ? 'draft' : DEFAULT_STAGE
export const otherStage = stage => stage === 'draft' ? 'ready' : 'draft'

// True when every record about to be sent opens a new PR on the personal path,
// so one stage describes the whole batch.
export const stageApplies = (records, preference, githubState) => records.length > 0 && records.every(record => (
  record?.plan?.action !== 'pr_update' && contributionPath(record, preference, githubState) === 'github'
))

const COUNTED = count => count === 1
const WORDS = {
  draft: {
    action: count => COUNTED(count) ? 'Open as draft' : `Open ${count} as drafts`,
    onGithub: count => COUNTED(count) ? 'Open as draft on GitHub' : `Open ${count} as drafts on GitHub`,
    heading: count => `Open ${count} reviewed ${COUNTED(count) ? 'pull request as a draft' : 'pull requests as drafts'}?`,
    line: 'Open as a draft',
    menu: 'Nobody is asked to review it yet.',
    icon: 'edit',
    description: 'New pull requests use your connected GitHub account and open as drafts: nobody is asked to review them until you open them for review. Each line shows exactly where its change goes. Nothing merges.',
  },
  ready: {
    action: count => COUNTED(count) ? 'Open for review' : `Open ${count} for review`,
    onGithub: count => COUNTED(count) ? 'Open for review on GitHub' : `Open ${count} for review on GitHub`,
    heading: count => `Send ${count} reviewed ${COUNTED(count) ? 'pull request' : 'pull requests'}?`,
    line: 'Open ready for review',
    menu: 'Reviewers are asked right away.',
    icon: 'send',
    description: 'New pull requests use your connected GitHub account and open ready for review. Each line shows exactly where its change goes. Nothing merges.',
  },
}
export const stageWords = stage => WORDS[stageOf(stage)]
