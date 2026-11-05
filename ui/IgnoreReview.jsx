import { useEffect, useId, useRef } from 'react'
import { IGNORE_REASONS } from '../review-actions.js'
import { focusActionRegion } from './TaskPane.jsx'
import { CloseWindowButton, WindowHead } from './WindowHead.jsx'

// "Ignore": set a review's findings aside for this exact version, with one tap
// on why. The note stays inside Contribute and posts nothing; the X is the only
// way out. Opened inside a ReviewDialog.
export function IgnoreReview({ pr, onPick, onClose }) {
  const region = useRef(null)
  const titleId = useId()
  useEffect(() => { focusActionRegion(region.current) }, [])
  return <section ref={region} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <WindowHead icon="review" title="Ignore this review?" titleId={titleId} pulls={[pr]} tools={<CloseWindowButton onClick={onClose} />} />
    <div className="co-rw-body">
      <h4 className="co-rw-label">Why?</h4>
      <div className="co-rw-reasons">{IGNORE_REASONS.map(reason => <button key={reason} type="button" className="co-rw-reason" onClick={() => onPick(reason)}>{reason}</button>)}</div>
    </div>
    <footer className="co-rw-foot"><p>Kept inside Contribute for this version of the PR. Nothing is posted to GitHub, and it comes back if the PR changes.</p></footer>
  </section>
}
