import { TimeAgo } from './GithubParts.jsx'

// Which agent run a Review-tab card came from, and when it started: the cards stack
// newest first, and this line tells a finished round from the one that needs you now.
export function RunTag({ kind, at }) {
  return <p className="co-run-tag">{kind}{at ? <> · <TimeAgo value={at} /></> : null}</p>
}
