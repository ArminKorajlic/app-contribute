// Project-local progress over the project's one durable agent conversation.
import { useCallback, useEffect, useRef, useState } from 'react'
import { beginProjectCycle, freezeStartAction, loadCurrentCycle, loadCycleState, updateCurrentCycle } from '../storage.js'
import { openAgentConversation } from './BatchAction.jsx'
import { useSyncHub } from './useReviewList.js'

// Run statuses the platform still owns (models.NONTERMINAL_RUN_STATUSES).
const NONTERMINAL_RUN_STATUSES = ['running', 'parked', 'resume_pending']

// A conversation that is not running a turn still has work it will resume on
// its own while the platform reports any of these. `recovery_run_id` is not
// among them: it names the latest attempt of every idle conversation so a
// manual Resume can target it. Only a non-terminal run status counts.
export function pendingContinuation(runtime) {
  const count = value => Array.isArray(value) ? value.length : 0
  return count(runtime.waits) > 0 || count(runtime.pending_messages) > 0 || Boolean(runtime.continuation_wait)
    || Boolean(runtime.compacting) || NONTERMINAL_RUN_STATUSES.includes(runtime.run_status)
    || Number(runtime.background_helpers?.count) > 0
}

// Observe explicit runtime facts; an unavailable or incomplete status is not
// evidence that the owner paused, stopped, or completed the work.
export function projectCyclePhase(runtime) {
  if (!runtime || typeof runtime !== 'object' || runtime.error) return 'unknown'
  if (runtime.running === true) return 'running'
  if (runtime.pending_question_id) return 'waiting'
  // Checked before any goal status: work that will resume is not finished.
  if (pendingContinuation(runtime)) return 'scheduled'
  const status = runtime.goal?.status || runtime.status
  if (status === 'failed') return 'failed'
  if (status === 'paused') return 'paused'
  if (['stopped', 'cancelled', 'canceled'].includes(status)) return 'stopped'
  if (['completed', 'complete', 'succeeded'].includes(status)) return 'complete'
  return runtime.running === false ? 'inactive' : 'unknown'
}

// The platform positively reports work in progress. Only these block a new
// cycle, and only as guidance: the project has one conversation, so a new
// cycle's message can at worst queue behind the current one.
export const BUSY_PHASES = ['starting', 'running', 'waiting', 'scheduled', 'stopping']

export function useProjectCycle(projectKey, deliver) {
  const hub = useSyncHub()
  const [cycle, setCycle] = useState({ phase: 'restoring', chatId: '', history: [], error: '' })
  const alive = useRef(true)
  const identity = useRef(projectKey)
  identity.current = projectKey
  const sending = useRef(false)
  const observation = useRef(0)
  const isCurrent = (requestedProject, generation) => alive.current && identity.current === requestedProject
    && (generation === undefined || generation === observation.current)
  const refresh = useCallback(async (chatId, { afterStop = false, generation } = {}) => {
    const requestedProject = projectKey
    let runtime = null
    try { runtime = await window.mobius.chat.status(chatId) } catch { runtime = null }
    if (!isCurrent(requestedProject, generation)) return
    const phase = projectCyclePhase(runtime)
    setCycle(current => current.chatId !== chatId || (current.phase === 'stopping' && !afterStop) ? current : ({
      ...current, phase, runtime,
      chatTitle: runtime?.title || runtime?.chat_title || runtime?.chat?.title || current.chatTitle,
      error: phase === 'unknown' ? 'Progress is unavailable. Open the conversation to check.' : current.unsent ? current.error : '',
    }))
  }, [projectKey])
  const recheck = useCallback(async () => {
    const requestedProject = projectKey
    const generation = ++observation.current
    let saved = null, unavailable = false
    try { saved = await loadCycleState(requestedProject) } catch { unavailable = true }
    if (!isCurrent(requestedProject, generation)) return
    if (!saved) {
      setCycle(unavailable ? current => ({ ...current, phase: 'unknown', error: 'Saved work could not be checked. Refresh to try again.' })
        : { phase: 'idle', chatId: '', history: [], error: '' })
      return
    }
    const current = saved.cycle && !saved.cycle.delivered && !saved.cycle.closed ? { ...saved.cycle, scope: saved.scope || saved.cycle.cid.replace(/:\d+$/, '') } : null
    setCycle({
      chatId: saved.chat_id || '', k: saved.k || 0, title: saved.title, event: saved.event, startedAt: saved.started_at, history: saved.history || [],
      unsent: current, phase: saved.chat_id ? 'checking' : 'idle', error: current ? 'This start was not confirmed. Send it again; a message that already arrived is not sent twice.' : '',
    })
    if (saved.chat_id) await refresh(saved.chat_id, { afterStop: true, generation })
  }, [projectKey, refresh])
  useEffect(() => {
    alive.current = true
    void recheck()
    return () => { alive.current = false; observation.current++ }
  }, [projectKey, recheck])
  // The conversation is durable; this mounted view only observes it: every five
  // seconds while it is shown and not complete, and once more when shown again
  // (the sync hub owns the timer, so a hidden view reads nothing).
  useEffect(() => {
    if (!cycle.chatId || !hub) return undefined
    return hub.every(() => refresh(cycle.chatId), cycle.phase === 'complete' ? null : 5000)
  }, [hub, cycle.chatId, cycle.phase, refresh])
  // No conversation holds the cycle: its first request never reached Möbius
  // (the usual case), or the owner deleted the conversation it created.
  const NEVER_REACHED = 'This start isn’t in any conversation. Start it again.'
  const CONVERSATION_DELETED = 'Its conversation was deleted, so this start was not sent again. Start it again.'
  // Deliver cycle k, only while the project record names k as its current,
  // unconfirmed cycle. Everything else (a superseded or delivered cycle, an
  // unreadable record) sends nothing and changes nothing.
  // - The first attempt is recorded before it is made, and is the only one
  //   that may create the project's conversation.
  // - A retry is bound to the conversation that cycle went to (recorded, or
  //   the scope's one live conversation). With none, the conversation was
  //   deleted or never created; the retry is refused rather than recreating
  //   the scope, and the owner can start new work instead.
  // - Model and effort are applied until one attempt applied them.
  // Whenever a delivery settles or closes the durable cycle, or finds it
  // already settled elsewhere, this mount shows exactly what the record says.
  async function settleFromRecord(requestedProject, error = '') {
    await recheck()
    if (error && isCurrent(requestedProject)) setCycle(current => ({ ...current, error }))
  }
  async function send(requestedProject, planned) {
    // The cycle stays unconfirmed: offer it again, and observe whichever
    // conversation is known so the phase never stays on 'starting'.
    const keepUnsent = (error, extra = {}) => {
      const known = extra.chatId || cycle.chatId
      if (isCurrent(requestedProject)) setCycle(current => ({ ...current, unsent: planned, ...extra, phase: known ? 'checking' : 'idle', error }))
      if (known) void refresh(known)
      return { ok: false, unsent: true, error }
    }
    let fresh
    try { fresh = await loadCurrentCycle(requestedProject) } catch { return keepUnsent('The project record could not be checked, so nothing was sent. Send again.') }
    const current = fresh.cycle
    if (fresh.k !== planned.k || current?.cid !== planned.cid || current.delivered || current.closed) {
      await settleFromRecord(requestedProject)
      return { ok: false, superseded: true, error: '' }
    }
    let chatId = current.chat_id || ''
    if (current.attempted && !chatId) {
      let rows = null
      try { rows = await window.mobius.chat.list({ scope: planned.scope }) } catch { rows = null }
      if (!Array.isArray(rows)) return keepUnsent('Möbius could not check this start, so nothing was sent. Send again.')
      if (rows.length > 1) return keepUnsent('More than one conversation answers this project. Open them before continuing.')
      if (!rows.length) {
        await updateCurrentCycle(requestedProject, planned.k, planned.cid, { closed: true })
        await settleFromRecord(requestedProject, NEVER_REACHED)
        return { ok: false, closed: true, error: NEVER_REACHED }
      }
      chatId = String(rows[0].id)
    }
    if (!current.attempted && !await updateCurrentCycle(requestedProject, planned.k, planned.cid, { attempted: true })) {
      return keepUnsent('This start could not be saved before sending, so nothing was sent. Send again.')
    }
    let outcome
    try { outcome = await deliver({ ...current.action, scope: planned.scope, cid: current.cid, ...(chatId ? { chatId } : {}), applyModel: !current.model_applied }) }
    catch { outcome = { ok: false, error: 'Could not reach Möbius. Send again.' } }
    const reached = outcome?.chatId ? String(outcome.chatId) : ''
    if (reached || outcome?.modelApplied || outcome?.gone) await updateCurrentCycle(requestedProject, planned.k, planned.cid,
      { chatId: reached, modelApplied: outcome.modelApplied, delivered: Boolean(outcome.ok && reached), closed: Boolean(outcome.gone) })
    if (!isCurrent(requestedProject)) return outcome
    if (outcome?.gone) {
      await settleFromRecord(requestedProject, CONVERSATION_DELETED)
      return { ok: false, closed: true, error: CONVERSATION_DELETED }
    }
    if (!outcome?.ok || !reached) {
      return keepUnsent(outcome?.error || 'This start was not confirmed. Send it again.', reached ? { chatId: reached } : {})
    }
    setCycle(current => ({ ...current, unsent: null, chatId: reached, title: planned.action.title, event: planned.action.event, phase: 'running', error: '' }))
    return { ok: true, chatId: reached }
  }
  async function start(action) {
    if (!action || sending.current) return { ok: false, error: 'Work is already starting.' }
    if (['restoring', ...BUSY_PHASES].includes(cycle.phase)) return { ok: false, error: 'The current work must finish or be cancelled before another cycle starts.' }
    const frozen = freezeStartAction(action)
    if (!frozen) return { ok: false, error: 'This agent handoff is incomplete.' }
    sending.current = true
    observation.current++
    const requestedProject = projectKey
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try {
      let planned
      try { planned = await beginProjectCycle(requestedProject, frozen, previous.k || 0) }
      catch { planned = { ok: false, error: 'Could not save this start. Refresh and try again.' } }
      if (!planned.ok) {
        if (isCurrent(requestedProject)) setCycle({ ...previous, error: planned.error })
        if (planned.changed) void recheck().then(() => { if (isCurrent(requestedProject)) setCycle(current => ({ ...current, error: current.error || planned.error })) })
        return planned
      }
      if (isCurrent(requestedProject)) setCycle(current => ({ ...current, k: planned.k }))
      if (isCurrent(requestedProject)) setCycle(current => ({ ...current, history: previous.chatId && previous.title ? [{ chat_id: previous.chatId, title: previous.title, event: previous.event, started_at: previous.startedAt }, ...(previous.history || [])] : previous.history || [], startedAt: new Date().toISOString() }))
      return await send(requestedProject, planned)
    } finally { sending.current = false }
  }
  // Send the unconfirmed cycle again: the same id, work and model.
  async function sendAgain() {
    const planned = cycle.unsent
    if (!planned || sending.current) return { ok: false, error: 'There is nothing to send again.' }
    sending.current = true
    observation.current++
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try { return await send(projectKey, planned) }
    finally { sending.current = false }
  }
  async function stop() {
    const chatId = cycle.chatId
    const requestedProject = projectKey
    if (!chatId) return
    observation.current++
    setCycle(current => current.chatId === chatId ? ({ ...current, phase: 'stopping' }) : current)
    let stopped = null
    try { stopped = await window.mobius.chat.stop(chatId) } catch { stopped = null }
    if (identity.current !== requestedProject) return
    if (stopped?.stopped === true) await refresh(chatId, { afterStop: true })
    else setCycle(current => current.chatId === chatId ? ({ ...current, phase: 'unknown', error: 'Could not confirm Stop. Open the conversation to check; nothing was restarted.' }) : current)
  }
  return { cycle, start, stop, recheck, sendAgain, open: (chatId = cycle.chatId) => openAgentConversation(chatId) }
}
