import { useEffect, useRef, useState } from 'react'
import { discoverRepository } from '../collaboration.js'
import { followRepository } from '../repositories.js'
import { Icon } from './Icons.jsx'

export function RepositoryPicker({ token, connected, onAdded }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = event => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && rootRef.current && !rootRef.current.contains(event.target))) setOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [open])
  async function add(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const repo = await discoverRepository(token, value)
      const followed = await followRepository(repo.nameWithOwner)
      onAdded?.(repo, followed)
      setValue(''); setOpen(false)
    } catch (error) { setError(error.message || 'Could not add this repository. Try again.') }
    finally { setBusy(false) }
  }
  return <div className={'co-repository-picker' + (open ? ' is-open' : '')} ref={rootRef}>
    <button type="button" className="co-btn co-repository-trigger" aria-expanded={open} onClick={() => setOpen(value => !value)}><Icon name="plus" size={16} /><span>Add project</span></button>
    {open ? connected ? <form onSubmit={add}>
      <header><strong>Add a GitHub repository</strong><button type="button" className="co-quiet-action" onClick={() => setOpen(false)}><Icon name="close" size={17} /> Close</button></header>
      <label htmlFor="co-repository-name">Repository name or link</label>
      <div><input id="co-repository-name" value={value} onChange={event => setValue(event.target.value)} placeholder="owner/project or GitHub URL" disabled={busy} autoComplete="off" required />
      <button className="co-btn" disabled={busy || !value.trim()}>{busy ? 'Adding…' : 'Add'}</button></div>
      <p>Follow contributions here without installing the project.</p>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </form> : <p className="co-repository-note">To add a repository, go to Möbius Settings → Accounts and connect GitHub.</p> : null}
  </div>
}
