import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const cardRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ContributionCard, ReviewPlan } from './ui/ContributionCard.jsx'
  export function renderCard(rec) {
    return renderToStaticMarkup(React.createElement(ContributionCard, {
      rec, onSend: () => {}, onDismiss: () => {},
      onFeedback: () => ({ ok: true }),
      onConnectApp: () => {}, onWithdraw: () => ({ ok: true }),
    }))
  }
  export function renderReview(rec) {
    return renderToStaticMarkup(React.createElement(ReviewPlan, { rec }))
  }
`)

test('open and draft cards expose durable label failures without Send controls', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  for (const status of ['open', 'draft']) {
    const html = renderCard({
      id: `published-${status}`,
      type: 'pr',
      status,
      title: 'Truthful labels',
      repo: 'mobius-os/app-demo',
      url: 'https://github.com/mobius-os/app-demo/pull/42',
      plan: { labels: ['bug', 'area: ui'] },
      last_submit_labels_requested: ['bug', 'area: ui'],
      last_submit_labels_applied: [],
      last_submit_labels_note: 'GitHub did not confirm these labels were applied.',
    })

    assert.match(html, /Labels need attention/)
    assert.match(html, /Requested/)
    assert.match(html, /Not confirmed/)
    assert.match(html, /GitHub did not confirm these labels were applied\./)
    assert.match(html, /Review labels on GitHub/)
    assert.match(html, /do not send it again/)
    assert.doesNotMatch(html, /(?:Send|Open) pull request|Send for review|Contribution actions/)
  }
})

test('a prepared request keeps its source-conversation action and note', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'request-draft', type: 'issue', status: 'prepared',
    title: 'Clarify the review flow', repo: 'mobius-os/app-demo',
    plan: { action: 'issue', title: 'Clarify the review flow' },
  })
  assert.match(html, /Open this request&#x27;s source conversation/)
  assert.match(html, /Requests stay connected to their source conversation/)
})

test('request details do not render an empty pull-request changes section', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderReview } = await cardRenderer()
  const html = renderReview({
    id: 'published-request', type: 'issue', status: 'open',
    repo: 'mobius-os/mobius',
    plan: {
      action: 'issue',
      title: 'Clarify the review flow',
    },
  })
  assert.match(html, /Description/)
  assert.doesNotMatch(html, />Changes</)
  assert.doesNotMatch(html, /co-diff/)
})

test('prepared platform cards keep one explicit public action', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'platform-check', type: 'pr', status: 'prepared',
    repo: 'mobius-os/mobius', title: 'Test before sending',
    plan: {
      action: 'pr', repo: 'mobius-os/mobius', title: 'Test before sending',
      head_sha: 'reviewed-head',
    },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'reviewed-head' },
  })
  assert.doesNotMatch(html, /Check on fork|Run GitHub checks/)
  assert.match(html, /aria-label="Send pull request"/)
  assert.match(html, />Send PR</)
})

test('a settled update target blocks another public action and leads to recovery', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'settled-update', type: 'pr', status: 'prepared',
    repo: 'mobius-os/app-contribute', title: 'Preserve the follow-up',
    number: 59, chat_id: 'source-chat', needs_attention: true,
    attention: {
      type: 'review_target_settled',
      title: 'Pull request #59 already merged',
      message: 'Preserve the remaining changes in a new reviewed contribution.',
    },
    plan: {
      action: 'pr_update', repo: 'mobius-os/app-contribute',
      title: 'Preserve the follow-up', head_sha: 'reviewed-head',
    },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'reviewed-head' },
  })
  assert.match(html, /Pull request #59 already merged/)
  assert.match(html, /Fix in chat/)
  assert.doesNotMatch(html, /Update pull request|>Update PR</)
})

test('attention actions never offer a source chat that the record cannot open', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()

  const github = renderCard({
    id: 'public-attention', type: 'pr', status: 'open',
    title: 'Resolve the review', repo: 'mobius-os/app-demo', number: 42,
    needs_attention: true,
    attention: { type: 'human_required', message: 'Choose how to respond.' },
  })
  assert.match(github, /Open pull request on GitHub/)
  assert.doesNotMatch(github, /Fix in chat|Review saved details/)

  const legacy = renderCard({
    id: 'legacy-attention', type: 'pr', status: 'open',
    title: 'Older follow-up', repo: 'mobius-os/app-demo',
    needs_attention: true,
    attention: { message: 'This older record needs inspection.' },
    plan: { action: 'pr', title: 'Older follow-up', body_draft: 'Saved context.' },
  })
  assert.match(legacy, /href="#co-record-legacy-attention"/)
  assert.match(legacy, /Review saved details/)
  assert.doesNotMatch(legacy, /Fix in chat/)

  const sourceLinked = renderCard({
    id: 'source-attention', type: 'pr', status: 'open',
    title: 'Source-linked follow-up', repo: 'mobius-os/app-demo',
    chat_ids: ['source-chat'], needs_attention: true,
    attention: { message: 'Return to the source conversation.' },
  })
  assert.match(sourceLinked, /Fix in chat/)
  assert.doesNotMatch(sourceLinked, /Review saved details/)
})

test('withdrawal is offered only for a published Möbius-bot contribution', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const eligible = {
    id: 'relay-pr', type: 'pr', status: 'draft',
    title: 'Review the relay', repo: 'mobius-os/app-demo',
    submission_mode: 'mobius-bot', relay_contribution_id: 'ctr_reviewed',
  }

  const html = renderCard(eligible)
  assert.match(html, />Withdraw PR</)
  assert.doesNotMatch(html, /Confirm contribution withdrawal|Keep open/)

  for (const rec of [
    { ...eligible, submission_mode: 'personal-github' },
    { ...eligible, status: 'merged' },
    { ...eligible, relay_contribution_id: null },
  ]) {
    assert.doesNotMatch(renderCard(rec), />Withdraw PR</)
  }
})

test('fully applied published labels stay compact', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'published-success',
    type: 'pr',
    status: 'open',
    title: 'Truthful labels',
    repo: 'mobius-os/app-demo',
    url: 'https://github.com/mobius-os/app-demo/pull/42',
    plan: { labels: ['bug', 'area: ui'] },
    last_submit_labels_requested: ['bug', 'area: ui'],
    last_submit_labels_applied: ['bug', 'area: ui'],
  })

  assert.match(html, /Labels applied/)
  assert.match(html, /bug/)
  assert.match(html, /area: ui/)
  assert.doesNotMatch(html, /Labels need attention|Requested|do not send it again/)
})

test('partial reconciliation evidence suggests dismissal without settling the record', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'possible-landing',
    type: 'pr',
    status: 'prepared',
    title: 'Reconcile prepared records',
    repo: 'mobius-os/app-contribute',
    plan: { action: 'pr', title: 'Reconcile prepared records' },
    reconciliation_hint: {
      type: 'already_landed',
      title: 'Looks already landed',
      message: '2 of 4 distinctive additions are already on main.',
      landing_pr: {
        url: 'https://github.com/mobius-os/app-contribute/pull/42',
      },
    },
  })

  assert.match(html, /Looks already landed/)
  assert.match(html, /2 of 4 distinctive additions are already on main\./)
  assert.match(html, /View possible landing PR/)
  assert.match(html, />Dismiss</)
  assert.match(html, /Waiting for your OK/)
})

test('a local app publication review explains the verified after-merge handoff', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderReview } = await cardRenderer()
  const html = renderReview({
    id: 'publish-maps',
    type: 'pr',
    status: 'prepared',
    repo: 'mobius-os/app-maps',
    plan: {
      action: 'pr',
      repo: 'mobius-os/app-maps',
      after_merge: {
        action: 'connect_app',
        app_id: 101,
        manifest_url: 'https://raw.githubusercontent.com/mobius-os/app-maps/main/mobius.json',
      },
    },
  })

  assert.match(html, /After merge/)
  assert.match(html, /Link this local app to its published version/)
  assert.match(html, /app and its saved data stay in place/)
  assert.match(html, /saved data/)
})

test('a PR review names a reviewed co-author trailer opt-out and nothing else', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderReview } = await cardRenderer()
  const review = (plan, type = 'pr') => renderReview({
    id: 'attribution', type, status: 'prepared', repo: 'acme/widgets',
    plan: { action: type, repo: 'acme/widgets', body_draft: 'Fix the widget.', ...plan },
  })

  const omitted = review({ coauthor_trailer: false })
  assert.match(omitted, /Möbius Agent is not listed as co-author/)
  assert.match(omitted, /Send it only if the project&#x27;s policy forbids that line or you asked to omit it/)

  // Only an exact `false` opts out on the platform, so only it is announced.
  for (const plan of [{}, { coauthor_trailer: true }, { coauthor_trailer: 'false' }]) {
    assert.doesNotMatch(review(plan), /not listed as co-author/)
  }
  assert.doesNotMatch(review({ coauthor_trailer: false }, 'issue'), /not listed as co-author/)
})

test('a merged app publication shows its automatic connection progress', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'publish-maps',
    type: 'pr',
    status: 'merged',
    title: 'Publish Maps',
    repo: 'mobius-os/app-maps',
    plan: {
      action: 'pr',
      after_merge: {
        action: 'connect_app',
        app_id: 101,
        manifest_url: 'https://raw.githubusercontent.com/mobius-os/app-maps/main/mobius.json',
      },
    },
  })

  assert.match(html, /Finishing publication/)
  assert.match(html, /Attaching the published identity to this local app/)
  assert.doesNotMatch(html, />Link app</)
  assert.match(html, /Saved app data and newer local work stay in place/)
})

test('a completed publication connection stays visible without another button', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'publish-maps',
    type: 'pr',
    status: 'merged',
    title: 'Publish Maps',
    repo: 'mobius-os/app-maps',
    plan: {
      action: 'pr',
      after_merge: {
        action: 'connect_app',
        app_id: 101,
        manifest_url: 'https://raw.githubusercontent.com/mobius-os/app-maps/main/mobius.json',
      },
    },
    publication_connection: {
      status: 'connected',
      app_id: 101,
      slug: 'maps',
    },
  })

  assert.match(html, /App linked/)
  assert.match(html, /Future App Store updates will update this same app/)
  assert.doesNotMatch(html, />Link app</)
})

const autopilotCardRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ContributionCard } from './ui/ContributionCard.jsx'
  export function renderCard(rec) {
    return renderToStaticMarkup(React.createElement(ContributionCard, {
      rec, onSetAutopilot: () => {},
    }))
  }
`)

test('an open autopilot PR shows the autopilot panel with pause + rounds', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await autopilotCardRenderer()
  const html = renderCard({
    id: 'ap-open',
    type: 'pr',
    status: 'open',
    title: 'Autopiloted fix',
    repo: 'mobius-os/app-demo',
    url: 'https://github.com/mobius-os/app-demo/pull/9',
    autopilot: {
      enabled: true,
      state: 'idle',
      rounds_used: 1,
      max_rounds: 5,
      last_round: { outcome: 'pushed', summary: 'Addressed the review.' },
      rounds: [{ outcome: 'pushed', summary: 'Addressed the review.',
                 finished_at: '2026-07-02T00:00:00Z' }],
    },
  })
  assert.match(html, /Autopilot on/)
  assert.match(html, /Pause/)
  assert.match(html, /Pushed a fix/)
  assert.match(html, /Addressed the review\./)
})

test('an escalated autopilot PR surfaces the human_required callout', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await autopilotCardRenderer()
  const html = renderCard({
    id: 'ap-escalated',
    type: 'pr',
    status: 'open',
    title: 'Needs a decision',
    repo: 'mobius-os/app-demo',
    url: 'https://github.com/mobius-os/app-demo/pull/9',
    needs_attention: true,
    attention: { type: 'human_required', message: 'A reviewer asked for a redesign.' },
    autopilot: { enabled: true, state: 'idle', rounds: [] },
  })
  assert.match(html, /A reviewer asked for a redesign\./)
})
