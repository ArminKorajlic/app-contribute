// Pure PR-stack helpers shared by the review feed and Sources visualization.
// Stack metadata is intentionally additive: older contribution records remain
// standalone, while a complete plan.stack object opts into ordered rendering
// and the batch submit endpoint.

export function stackMeta(rec) {
  const stack = rec?.plan?.stack
  if (!stack || typeof stack !== 'object') return null
  const id = typeof stack.id === 'string' ? stack.id.trim() : ''
  const position = Number(stack.position)
  const total = Number(stack.total)
  const baseBranch = typeof stack.base_branch === 'string'
    ? stack.base_branch.trim()
    : ''
  if (!id || !Number.isInteger(position) || !Number.isInteger(total)) return null
  if (total < 2 || position < 1 || position > total || !baseBranch) return null
  return {
    id,
    name: typeof stack.name === 'string' && stack.name.trim()
      ? stack.name.trim()
      : id,
    position,
    total,
    baseBranch,
    parentRecordId: typeof stack.parent_record_id === 'string'
      ? stack.parent_record_id
      : '',
  }
}

// At a publication boundary, absent metadata is standalone; present but
// malformed metadata is still a chain intent and must remain blocked.
export function stackIntent(rec) {
  if (rec?.plan?.stack === undefined || rec.plan.stack === null) return { kind: 'standalone' }
  const meta = stackMeta(rec)
  return meta ? { kind: 'stack', meta } : { kind: 'invalid' }
}

// The complete chain one stacked record belongs to, from the given records.
export function publicationStackUnit(record, records) {
  const intent = stackIntent(record)
  if (intent.kind === 'standalone') return null
  if (intent.kind === 'invalid') {
    const stack = record.plan.stack
    return {
      type: 'stack', id: `invalid:${record.id}`,
      name: [stack?.name, stack?.id].find(value => typeof value === 'string' && value.trim()) || 'Invalid PR chain',
      total: Number(stack?.total) || 2, records: [record],
    }
  }
  const { meta } = intent
  const members = sortStackRecords((records || []).filter(item => stackMeta(item)?.id === meta.id))
  return { type: 'stack', id: meta.id, name: meta.name, total: meta.total, records: members }
}

export function sortStackRecords(records) {
  return [...(records || [])].sort((a, b) => {
    const left = stackMeta(a)?.position || Number.MAX_SAFE_INTEGER
    const right = stackMeta(b)?.position || Number.MAX_SAFE_INTEGER
    return left - right
  })
}

export function groupContributionUnits(records) {
  const units = []
  const stacks = new Map()
  for (const rec of records || []) {
    const meta = stackMeta(rec)
    if (!meta) {
      units.push({ type: 'record', id: rec.id, record: rec, records: [rec] })
      continue
    }
    let unit = stacks.get(meta.id)
    if (!unit) {
      unit = {
        type: 'stack',
        id: meta.id,
        name: meta.name,
        total: meta.total,
        records: [],
      }
      stacks.set(meta.id, unit)
      units.push(unit)
    }
    unit.records.push(rec)
    unit.total = Math.max(unit.total, meta.total)
  }
  for (const unit of units) {
    if (unit.type === 'stack') unit.records = sortStackRecords(unit.records)
  }
  return units
}

// Ready stacks may have an already-open parent after a durable partial retry.
// Include every known layer in that stack so the confirmation still names the
// complete chain, while standalone prepared records remain individual cards.
export function preparedContributionUnits(ready, allRecords) {
  const readyStackIds = new Set(
    (ready || []).map(stackMeta).filter(Boolean).map((meta) => meta.id)
  )
  // Once any layer is prepared, that active unit owns every known sibling.
  // Terminal and dismissed layers are part of why a chain may need repair;
  // omitting them would both fragment the UI and hide the actual blocker.
  const stackRecords = (allRecords || []).filter((rec) => {
    const meta = stackMeta(rec)
    return meta && readyStackIds.has(meta.id)
  })
  const stackUnits = groupContributionUnits(stackRecords)
    .filter((unit) => unit.type === 'stack')
  const invalidStackUnits = (ready || [])
    .filter((rec) => stackIntent(rec).kind === 'invalid')
    .map((rec) => publicationStackUnit(rec, [rec]))
  const standalone = (ready || [])
    .filter((rec) => stackIntent(rec).kind === 'standalone')
    .map((rec) => ({ type: 'record', id: rec.id, record: rec, records: [rec] }))
  return [...stackUnits, ...invalidStackUnits, ...standalone].sort((a, b) => {
    const aRec = a.records.find((rec) => rec.status === 'prepared') || a.records[0]
    const bRec = b.records.find((rec) => rec.status === 'prepared') || b.records[0]
    return String(bRec?.updated_at || bRec?.created_at || '').localeCompare(
      String(aRec?.updated_at || aRec?.created_at || ''))
  })
}

// Public stacks stay grouped after Send so one related change remains legible
// while GitHub owns its acceptance. Include an already-settled layer while any
// sibling is still live, which keeps a recovered partial ledger write
// understandable rather than scattering the chain.
export function publicContributionUnits(live, allRecords) {
  const liveStackIds = new Set(
    (live || []).map(stackMeta).filter(Boolean).map((meta) => meta.id)
  )
  // A live stack likewise owns every known sibling, including a terminal or
  // dismissed layer. This keeps one exact chain visible and prevents a sibling
  // from disappearing when Recent/Archive suppress records owned by live work.
  const stackRecords = (allRecords || []).filter((rec) => {
    const meta = stackMeta(rec)
    return meta && liveStackIds.has(meta.id)
  })
  const stackUnits = groupContributionUnits(stackRecords)
    .filter((unit) => unit.type === 'stack')
  const standalone = (live || [])
    // Malformed additive stack metadata must never make an already-public PR
    // disappear. It cannot safely participate in grouped stack actions, so it
    // degrades to one visible, non-grouped public record instead.
    .filter((rec) => !rec?.plan?.stack || !stackMeta(rec))
    .map((rec) => ({ type: 'record', id: rec.id, record: rec, records: [rec] }))
  return [...stackUnits, ...standalone].sort((a, b) => {
    const aRec = a.records.find((rec) => ['open', 'landing'].includes(rec.status)) || a.records[0]
    const bRec = b.records.find((rec) => ['open', 'landing'].includes(rec.status)) || b.records[0]
    return String(bRec?.updated_at || bRec?.created_at || '').localeCompare(
      String(aRec?.updated_at || aRec?.created_at || ''))
  })
}

function recordBranch(rec) {
  return rec?.plan?.branch || rec?.branch || ''
}

// Client-side review guard. The platform remains authoritative, but catching
// an incomplete or stale chain here avoids presenting a publish button that is
// guaranteed to fail after confirmation.
export function stackReadiness(unit) {
  const records = sortStackRecords(unit?.records || [])
  const total = Number(unit?.total || records.length)
  const ready = records.filter((rec) => rec.status === 'prepared')
  const fail = (code, message) => ({ ok: false, code, message, ready })
  const metas = records.map(stackMeta)
  if (metas.some((meta) => !meta)) {
    return fail('invalid', 'This chain has invalid layer metadata.')
  }
  if (!Number.isInteger(total) || total < 2 || records.length !== total) {
    return fail(
      'incomplete',
      `This chain is incomplete: ${records.length} of ${total || '?'} layers are available.`,
    )
  }
  if (metas.some((meta, index) => (
    meta.id !== metas[0].id || meta.total !== total || meta.position !== index + 1
  ))) {
    return fail('invalid', 'This chain has duplicate, missing, or mismatched layer positions.')
  }
  const repo = records[0]?.plan?.repo || records[0]?.repo || ''
  for (let index = 0; index < records.length; index += 1) {
    const rec = records[index]
    const meta = metas[index]
    const recRepo = rec?.plan?.repo || rec?.repo || ''
    if (
      rec.type !== 'pr'
      || !['pr', 'pr_update'].includes(rec?.plan?.action)
      || recRepo !== repo
    ) {
      return fail('invalid', 'Every layer must use a supported pull-request action and the same repository.')
    }
    if (!['prepared', 'draft', 'open', 'merged'].includes(rec.status)) {
      return fail('invalid', 'One layer is not in a publishable stack state.')
    }
    if (!recordBranch(rec).startsWith(`stack/${meta.id}/`)) {
      return fail('invalid', 'A layer branch does not belong to this chain.')
    }
    if (index === 0) {
      if (meta.parentRecordId) {
        return fail('invalid', 'The first layer points at an unexpected parent.')
      }
      continue
    }
    const previous = records[index - 1]
    if (
      meta.parentRecordId !== previous.id ||
      meta.baseBranch !== recordBranch(previous) ||
      (
        rec.status === 'prepared' &&
        String(rec?.plan?.base_sha || '') !== String(previous?.plan?.head_sha || '')
      )
    ) {
      return fail('invalid', 'A layer no longer matches its reviewed parent.')
    }
    if (rec.status === 'prepared' && previous.status === 'merged') {
      return fail(
        'refresh',
        'A parent PR has merged. Sync, then update the remaining layers on the repository’s main branch before publishing.',
      )
    }
  }
  if (ready.length === 0) {
    return fail('settled', 'Every layer in this chain is already public or merged.')
  }
  let sawCreate = false
  for (const rec of ready) {
    if (rec?.plan?.action === 'pr') sawCreate = true
    else if (sawCreate) {
      return fail(
        'invalid',
        'An existing pull-request update cannot follow a new private layer.',
      )
    }
  }
  const action = ready[0]?.plan?.action
  const phaseReady = ready.filter((rec) => rec?.plan?.action === action)
  return {
    ok: true,
    code: 'ready',
    message: '',
    ready: phaseReady,
    deferred: ready.slice(phaseReady.length),
    action,
    updating: action === 'pr_update',
  }
}

// A stack can have a reviewed existing-PR prefix followed by unpublished
// children. Keep it one visible chain, but expose only the next safe public
// phase: update the existing prefix first, then offer the new suffix after the
// ledger refresh proves those parent updates settled.
export function stackPublicationRecords(unit) {
  const prepared = sortStackRecords(unit?.records || []).filter(
    (record) => record?.status === 'prepared',
  )
  const action = prepared[0]?.plan?.action
  if (!['pr', 'pr_update'].includes(action)) return []
  const boundary = prepared.findIndex(
    (record) => record?.plan?.action !== action,
  )
  return boundary === -1 ? prepared : prepared.slice(0, boundary)
}
