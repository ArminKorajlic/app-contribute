import { useEffect, useState } from 'react'
import { ActionConfirm } from './ActionConfirm.jsx'
import { postFindings, previewPostedFindings } from '../collaboration.js'
import { postFindingsCopy } from '../action-copy.js'

// The sheet for "Post to GitHub" on a finished private review. It first asks the platform for the exact
// words (and a hash that binds the post to them), so what the owner reads is what is posted. While the
// words load, or when the platform refuses (nothing to post, the PR moved), the sheet says so with the
// button off and the X as its only way out. A post GitHub may have taken is read back the way a finished one is.
export function PostFindings({ pr, run, item, own = false, token, appId, onClose, onDone }) {
  const [state, setState] = useState({ preview: null, error: '' })
  useEffect(() => {
    let live = true
    previewPostedFindings(token, appId, run, item).then(
      preview => { if (live) setState({ preview, error: '' }) },
      error => { if (live) setState({ preview: null, error: error.message }) })
    return () => { live = false }
  }, [token, appId, run.id, item.repo, item.number, item.head_sha])
  const copy = postFindingsCopy(pr, { preview: state.preview, error: state.error, own })
  return <ActionConfirm key={state.preview ? 'ready' : state.error ? 'refused' : 'loading'} pr={pr} copy={copy} onClose={onClose} onDone={onDone} onUnconfirmed={onDone}
    onConfirm={() => postFindings(token, appId, run, item, state.preview)} />
}
