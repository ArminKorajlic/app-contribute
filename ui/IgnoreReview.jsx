import { useEffect, useId, useRef } from 'react'
import { IGNORE_REASONS } from '../review-actions.js'
import { focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'

// "Ignore": set a review's findings aside for this exact version, with one tap
// on why. The note stays inside Contribute and posts nothing; the X is the only
// way out. Opened inside a ReviewDialog.
export function IgnoreReview({ pr, onPick, onClose }) {
  const region = useRef(null)
  const titleId = useId()
  useEffect(() => { focusActionRegion(region.current) }, [])
  return <section ref={region} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <header className="co-rw-head">
      <span className="co-rw-icon"><Icon name="review" size={22} /></span>
      <div>
        <h3 id={titleId}>Ignore this review?</h3>
        <p className="co-rw-pr"><strong>#{pr.number} {pr.title}</strong><span>{pr.repository.nameWithOwner}</span></p>
      </div>
      <button type="button" className="co-quiet-action co-rw-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
    </header>
    <div className="co-rw-body">
      <h4 className="co-rw-label">Why?</h4>
      <div className="co-rw-reasons">{IGNORE_REASONS.map(reason => <button key={reason} type="button" className="co-rw-reason" onClick={() => onPick(reason)}>{reason}</button>)}</div>
    </div>
    <footer className="co-rw-foot"><p>Kept inside Contribute for this version of the PR. Nothing is posted to GitHub, and it comes back if the PR changes.</p></footer>
  </section>
}
