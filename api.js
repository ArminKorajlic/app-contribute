// Same-origin fetch helpers for the platform's GitHub surface. The GitHub
// token never reaches this app: /api/github/* holds it server-side, and the
// manifest's github_access permission gates data/reviewed-submit calls, while
// github_connect separately gates credential status and mutation. Read helpers
// degrade to a quiet fallback
// so the feed still renders from the ledger when GitHub is unreachable; the
// connect helpers return the raw Response so the connection card can branch
// on res.ok and surface the server's error detail verbatim.

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token }
}

// Background reads must never hold the interface in "checking" forever when
// the platform restarts mid-request. Public mutation calls deliberately do NOT
// use this helper: aborting a Send client-side could hide a successful upstream
// action and invite an unsafe retry.
async function fetchRead(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function responseDetail(response, fallback) {
  const body = await response.json().catch(() => ({}))
  if (typeof body?.detail === 'string' && body.detail.trim()) {
    return body.detail.trim()
  }
  if (typeof body?.detail?.message === 'string' && body.detail.message.trim()) {
    return body.detail.message.trim()
  }
  return fallback
}

// The instance GitHub account, owned by Möbius Settings. Contribute needs only
// whether it is connected, as whom, and whether review follow-up is available.
export async function fetchGithubStatus(token) {
  try {
    const r = await fetchRead('/api/github/status', { headers: authHeaders(token) })
    if (!r.ok) {
      return {
        state: 'unknown',
        message: await responseDetail(r, `Could not check GitHub connection (HTTP ${r.status}).`),
      }
    }
    const s = await r.json()
    return {
      state: s.connected ? 'connected' : 'disconnected',
      login: s.login || '',
      autopilotAvailable: s.autopilot_available === true,
      // The server binds a Send to the exact record the owner confirmed.
      frozenBinding: Array.isArray(s.frozen_publication_binding?.record_fields),
    }
  } catch (error) {
    // Network failure (offline, backend restarting) — not a platform verdict.
    return {
      state: 'unknown',
      message: error?.name === 'AbortError'
        ? 'The GitHub connection check timed out.'
        : 'Could not reach the GitHub connection service.',
    }
  }
}

// Fetch-free local Git metadata for the Projects view. The endpoint returns
// refs, ancestry/diff magnitudes, working-tree counts, and bounded path names,
// plus which local paths moved since each active proposal's recorded source.
export async function fetchSourceStatus(token, since = []) {
  const query = new URLSearchParams()
  for (const sha of since) query.append('since', sha)
  const suffix = since.length ? '?' + query.toString() : ''
  try {
    const r = await fetchRead('/api/github/source-status' + suffix, {
      headers: authHeaders(token),
    })
    if (!r.ok) {
      return {
        ok: false,
        unsupported: r.status === 404,
        status: r.status,
      }
    }
    const body = await r.json()
    return { ok: true, data: body }
  } catch {
    return { ok: false, offline: true, status: 0 }
  }
}

// Source contents remain behind an explicit, project-bound read. The caller
// supplies only the opaque project key + endpoint commits it already inspected;
// the platform chooses the repository/ref and caps the returned unified patch.
export async function fetchSourceDiff(token, project) {
  if (!project?.key || !project?.head_sha) {
    return { ok: false, status: 422 }
  }
  const query = new URLSearchParams({
    project: project.key,
    head: project.head_sha,
  })
  const comparison = project.comparison_sha || project.base_sha
  if (comparison) query.set('comparison', comparison)
  try {
    const response = await fetchRead('/api/github/source-diff?' + query, {
      headers: authHeaders(token),
    })
    if (!response.ok) {
      return {
        ok: false,
        stale: response.status === 409,
        unsupported: response.status === 404,
        status: response.status,
      }
    }
    return { ok: true, data: await response.json() }
  } catch {
    return { ok: false, offline: true, status: 0 }
  }
}

// Read-only local validation for every prepared review. This catches branch,
// worktree, and stored-diff drift before the owner reaches the public Send
// action. A failed check keeps the feed usable and preserves any stronger
// submit error already persisted on the record.
// `recordIds` asks for exactly those records and their stacks, however old;
// without it the platform checks its recent records.
export async function fetchReviewStatus(token, appId, recordIds = []) {
  const query = recordIds.length ? '?' + recordIds.map(id => 'record_id=' + encodeURIComponent(id)).join('&') : ''
  try {
    const r = await fetchRead(
      '/api/github/contributions/' + encodeURIComponent(appId) + '/review-status' + query,
      { headers: authHeaders(token) },
    )
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
      }
    }
    const body = await r.json()
    return { ok: true, data: body }
  } catch {
    return { ok: false, offline: true, status: 0 }
  }
}

function base64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

// One staged screenshot of a prepared record, as a data:image/png URL for the
// review card, or null when it cannot be read. The route serves the record's
// current entry for that name, which a restage can replace while this plan is on
// screen, so the bytes are shown only when they hash to the plan's own sha256.
// Send uploads from the platform's own copy.
export async function fetchContributionScreenshot(token, appId, recordId, shot) {
  try {
    const r = await fetchRead(
      '/api/github/contributions/' + encodeURIComponent(appId) + '/' +
        encodeURIComponent(recordId) + '/screenshots/' + encodeURIComponent(shot.name),
      { headers: authHeaders(token) },
      20000,
    )
    if (!r.ok) return null
    const bytes = new Uint8Array(await r.arrayBuffer())
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
    const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
    if (hex !== shot.sha256) return null
    return 'data:image/png;base64,' + base64(bytes)
  } catch {
    return null
  }
}

// POSTs one read-only GraphQL document; returns response.data or null.
// Callers leave records stale on null — the refresh is best-effort polish,
// and GitHub returns null nodes (not errors) for anything inaccessible.
export async function fetchLiveStates(token, query) {
  try {
    const r = await fetchRead('/api/github/graphql', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!r.ok) return null
    const body = await r.json()
    return body && typeof body === 'object' ? body.data || null : null
  } catch {
    return null
  }
}

// Open pull requests that involve the viewer (the source of "On GitHub" projects),
// each flagged when it actually asks for the viewer's review. GitHub's
// "involves" search does not cover review requests, so both are read at once.
export async function fetchIncomingReviews(token) {
  const fields = 'id number title url headRefOid baseRefName baseRefOid isDraft author { login } assignees(first:100) { nodes { login } } repository { nameWithOwner viewerPermission } reviewDecision mergeable'
  const query = `query ContributeIncomingReviews {
    involved: search(query: "is:pr is:open involves:@me", type: ISSUE, first: 50) { nodes { ... on PullRequest { ${fields} } } }
    requested: search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 50) { nodes { ... on PullRequest { ${fields} } } }
  }`
  const data = await fetchLiveStates(token, query)
  const valid = nodes => (Array.isArray(nodes) ? nodes : []).filter((item) => item?.repository?.nameWithOwner && item?.number && item?.url)
  const requested = valid(data?.requested?.nodes)
  const requestedUrls = new Set(requested.map(item => item.url))
  const involved = valid(data?.involved?.nodes).filter(item => !requestedUrls.has(item.url))
  return [...requested.map(item => ({ ...item, reviewRequested: true })), ...involved]
}

export async function assignIncomingReview({ appId, token, repo, number }) {
  try {
    const response = await fetch(
      `/api/github/contributions/${encodeURIComponent(appId)}/assign-review`,
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, number }),
      },
    )
    if (!response.ok) {
      return { ok: false, error: await responseDetail(response, 'Could not assign this review.') }
    }
    return { ok: true, data: await response.json() }
  } catch {
    return { ok: false, error: 'Could not confirm the assignment. Refresh before trying again.' }
  }
}

// Send button path: the platform claims the prepared PR record, recomputes the
// actual branch diff, adapts it to a strictly-behind reusable fork without
// changing that fork's default branch, pushes the topic branch, opens the PR on
// GitHub, and writes the URL back to the record. The token stays server-side;
// this app receives only the updated ledger record or an actionable error plus
// the rolled-back record when available.
export async function submitContribution({
  appId,
  token,
  rec,
  autopilot = true,
  publicationStage = 'ready',
  expectedRecord = null,
}) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/submit',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        // The one-click grant: a successful submit authorizes the background
        // review-response loop for this PR (see review-followup.md). The owner
        // can flip the global default off in the app's Autopilot setting.
        body: JSON.stringify({
          autopilot: !!autopilot,
          publication_stage: publicationStage === 'draft' ? 'draft' : 'ready',
          ...(expectedRecord ? { expected_record: expectedRecord } : {}),
        }),
      }
    )
    let body = null
    try {
      body = await r.json()
    } catch {
      body = null
    }
    if (r.ok) {
      if (!body?.record) {
        return {
          uncertain: true,
          error: 'We could not confirm the result. Checking the saved contribution now…',
          failure: { owner: 'automatic' },
        }
      }
      return {
        ok: body.record,
        url: body?.url || '',
      }
    }
    const detail = body?.detail
    if (
      r.status === 409
      && detail === 'This contribution is no longer waiting for approval.'
    ) {
      return { alreadyHandled: true }
    }
    if (approvalRefusal(detail)) return approvalRefusal(detail)
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not submit this PR.',
        record: detail.record || null,
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string' ? detail : 'Could not submit this PR.',
      failure: { status: r.status, code: '' },
    }
  } catch (err) {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contribution before offering a retry…',
      failure: { owner: 'automatic' },
    }
  }
}

// A server refusal that the confirmed snapshot changed. Only its certified
// `not_attempted` releases the action for a fresh confirmation.
function approvalRefusal(detail) {
  if (detail?.code !== 'approval_changed') return null
  return {
    ...(detail.not_attempted === true ? { notAttempted: true } : {}),
    // The current rows the server compared, so the app shows them at once.
    ...(detail.record && typeof detail.record === 'object' ? { record: detail.record } : {}),
    ...(Array.isArray(detail.records) ? { records: detail.records } : {}),
    error: detail.not_attempted === true
      ? 'The saved proposal changed. Review its current version and confirm again; nothing was sent.'
      : 'The saved proposal changed after an earlier attempt. Check Contribute before trying again.',
    // Without the certificate the request may already have been attempted:
    // its outcome is unknown (owned by automatic reconciliation), never an
    // ordinary refusal that releases the action.
    failure: detail.not_attempted === true
      ? { owner: 'agent', code: 'approval_changed' }
      : { owner: 'automatic', code: 'approval_changed', maybeAttempted: true },
  }
}

// Owner-approved fast-forward of an already-open pull request. A prepared
// `pr_update` record carries the exact new head and complete reviewed diff; the
// platform verifies the live PR identity before it pushes anything.
export async function updateContribution({ appId, token, rec, expectedRecord = null }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/update-existing',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(expectedRecord ? { expected_record: expectedRecord } : {}),
      },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) {
      return { ok: body.record, url: body?.url || '' }
    }
    const detail = body?.detail
    if (
      r.status === 409 &&
      detail === 'This contribution is no longer waiting for approval.'
    ) {
      return { alreadyHandled: true }
    }
    if (r.status === 404) {
      return {
        unsupported: true,
        error: 'Restart Möbius to load the reviewed PR update action.',
        failure: { owner: 'owner', status: r.status },
      }
    }
    if (approvalRefusal(detail)) return approvalRefusal(detail)
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not update this PR.',
        record: detail.record || null,
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string' ? detail : 'Could not update this PR.',
      failure: { status: r.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contribution before offering a retry…',
      failure: { owner: 'automatic' },
    }
  }
}

// Launcher path: the scoped app token reaches only the platform BFF. The BFF
// rechecks the reviewed record, asks the root-owned identity broker for one
// body-bound contribution capability, and sends an always-draft request to the
// configured GitHub App target. No personal GitHub token enters this frame.
export async function submitContributionViaMobius({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/contribution-relay/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/submit',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm_publication: true,
          public_identity: 'anonymous',
          submitter: 'contribute-button',
        }),
      },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) {
      if (body.record.url) {
        return { ok: body.record, url: body.record.url, viaMobius: true }
      }
      return { pending: body.record, viaMobius: true }
    }
    const detail = body?.detail
    if (
      r.status === 409 &&
      detail === 'This contribution is no longer waiting for approval.'
    ) {
      return { alreadyHandled: true, viaMobius: true }
    }
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || 'Could not submit this draft through Möbius.',
        record: detail.record || null,
        viaMobius: true,
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string'
        ? detail
        : 'Could not submit this draft through Möbius.',
      viaMobius: true,
      failure: { status: r.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contribution before offering a retry…',
      viaMobius: true,
      failure: { owner: 'automatic' },
    }
  }
}

export async function fetchMobiusContributionStatus({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/contribution-relay/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/status',
      { headers: authHeaders(token) },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) return { ok: body.record }
    const detail = body?.detail
    return {
      error: detail && typeof detail === 'object'
        ? detail.message
        : (typeof detail === 'string' ? detail : 'Could not check the Möbius draft.'),
    }
  } catch {
    return { error: 'Could not reach the Möbius contribution service.' }
  }
}

export async function withdrawMobiusContribution({ appId, token, rec }) {
  try {
    const r = await fetch(
      '/api/contribution-relay/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) +
        '/withdraw',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_withdrawal: true }),
      },
    )
    const body = await r.json().catch(() => null)
    if (r.ok && body?.record) return { ok: body.record }
    const detail = body?.detail
    return {
      error: detail && typeof detail === 'object'
        ? detail.message
        : (typeof detail === 'string'
            ? detail
            : 'Could not withdraw this contribution.'),
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Refresh Contribute before trying again.',
    }
  }
}

// Batch approval paths for one immutable PR stack. recordIds carries the full
// ordered chain so the server can revalidate topology, while operation binds
// the confirmation to only its current action phase. Deferred records remain
// prepared and receive no claim. Publishing new PRs and updating existing PRs
// stay distinct guarded writes even though their partial-result handling is
// identical here.
async function writeContributionStack({
  appId,
  token,
  recordIds,
  operation,
  publicationStage = 'ready',
  expectedRecords = null,
}) {
  const updating = operation === 'update'
  try {
    const r = await fetch(
      '/api/github/contributions/' + encodeURIComponent(appId) +
        (updating ? '/update-stack' : '/submit-stack'),
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          record_ids: recordIds,
          ...(updating ? {} : {
            publication_stage: publicationStage === 'draft' ? 'draft' : 'ready',
          }),
          ...(expectedRecords ? { expected_records: expectedRecords } : {}),
        }),
      }
    )
    let body = null
    try { body = await r.json() } catch { body = null }
    if (r.ok) {
      if (!Array.isArray(body?.records) || body.records.length === 0) {
        return {
          uncertain: true,
          error: 'We could not confirm the result. Checking the saved contributions now…',
          failure: { owner: 'automatic' },
        }
      }
      return {
        ok: body.records,
        submitted: Array.isArray(updating ? body?.updated : body?.submitted)
          ? (updating ? body.updated : body.submitted)
          : [],
      }
    }
    const detail = body?.detail
    if (
      r.status === 409
      && detail === (updating
        ? 'Every PR in this stack already has the reviewed update.'
        : 'Every PR in this stack has already been submitted.')
    ) {
      return { alreadyHandled: true }
    }
    if (approvalRefusal(detail)) return approvalRefusal(detail)
    if (detail && typeof detail === 'object') {
      return {
        error: detail.message || (updating
          ? 'Could not update this PR stack.'
          : 'Could not submit this PR stack.'),
        records: Array.isArray(detail.records) ? detail.records : [],
        submitted: Array.isArray(updating ? detail.updated : detail.submitted)
          ? (updating ? detail.updated : detail.submitted)
          : [],
        failure: { status: r.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string' ? detail : (updating
        ? 'Could not update this PR stack.'
        : 'Could not submit this PR stack.'),
      failure: { status: r.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved contributions before offering a retry…',
      failure: { owner: 'automatic' },
    }
  }
}

export function submitContributionStack(args) {
  return writeContributionStack({ ...args, operation: 'submit' })
}

export function updateContributionStack(args) {
  return writeContributionStack({ ...args, operation: 'update' })
}

// Move one exact personal-GitHub draft into review. The platform journals the
// approved repo/PR/head before the mutation and turns a repeated call after a
// lost response into read-only reconciliation, so the client may safely call
// this once more only when the first response is explicitly uncertain.
export async function markContributionReady({ appId, token, rec }) {
  try {
    const response = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(rec.id) + '/ready',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_head_sha: rec.last_submit_push_sha || '',
        }),
      },
    )
    const body = await response.json().catch(() => null)
    if (response.ok) {
      if (body?.record) {
        return { ok: body.record, url: body.url || body.record.url || '' }
      }
      return {
        uncertain: true,
        error: 'GitHub may have accepted the review request. Checking the saved action before offering another try…',
        failure: { owner: 'automatic', status: response.status, code: 'ready_response_missing' },
      }
    }
    const detail = body?.detail
    if (detail && typeof detail === 'object') {
      return {
        uncertain: response.status === 503 && detail.code === 'ready_unconfirmed',
        error: detail.message || 'Could not request review for this pull request.',
        record: detail.record || null,
        failure: { status: response.status, code: detail.code || '' },
      }
    }
    return {
      error: typeof detail === 'string'
        ? detail
        : 'Could not request review for this pull request.',
      failure: { status: response.status, code: '' },
    }
  } catch {
    return {
      uncertain: true,
      error: 'The response was lost. Checking the saved public action before offering another try…',
      failure: { owner: 'automatic' },
    }
  }
}

// Pause / resume autopilot for one shipped PR. This is a platform endpoint, NOT
// a ledger write — the grant lives in a platform DB row the app can't edit, so
// flipping the (display-only) ledger `autopilot` block could never actually stop
// the loop. Resume also clears any human_required flag and resets the round and
// failure counters. Returns { ok } or { error }.
export async function setAutopilot({ appId, token, recordId, enabled }) {
  try {
    const r = await fetch(
      '/api/github/contributions/' +
        encodeURIComponent(appId) + '/' +
        encodeURIComponent(recordId) + '/autopilot',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled }),
      }
    )
    if (r.ok) return { ok: true }
    let body = null
    try { body = await r.json() } catch { body = null }
    return { error: body?.detail || 'Could not update autopilot.' }
  } catch {
    return { error: 'The response was lost. Try again in a moment.' }
  }
}
