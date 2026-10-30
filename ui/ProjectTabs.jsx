import { useId, useRef, useState } from 'react'

const TABS = [['all', 'All PRs'], ['requests', 'Review requests'], ['mine', 'My work']]

// One tab per job under the project's status and Needs you. The PR list stays
// one mounted component whatever the tab, so its loaded pages, agent runs and
// selection survive a switch and GitHub is not read again. `inventory` is saved
// public work the live list cannot show (for example while GitHub is
// unreachable); it stays on All PRs so it is never hidden behind another tab.
export function ProjectTabs({ reviewCount = 0, renderPullRequests, inventory, myJobs, myWork, defaultTab = 'all' }) {
  const [tab, setTab] = useState(defaultTab)
  const [total, setTotal] = useState(null)
  const id = useId()
  const list = useRef(null)
  const counts = { all: total, requests: reviewCount, mine: null }
  function moveWithArrows(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = TABS.findIndex(([key]) => key === tab)
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]
    setTab(next)
    list.current?.querySelector(`[data-tab="${next}"]`)?.focus()
    event.preventDefault()
  }
  return <>
    <div ref={list} className="co-project-tabs" role="tablist" aria-label="Project views" onKeyDown={moveWithArrows}>
      {TABS.map(([key, label]) => <button key={key} type="button" role="tab" data-tab={key} id={`${id}-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} className="co-project-tab" onClick={() => setTab(key)}>
        {label}{counts[key] != null ? <span className={'co-tab-count' + (key === 'requests' && counts[key] > 0 ? ' is-you' : '')}>{counts[key]}</span> : null}
      </button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="co-project-tabpanel">
      {/* Fixed slots keep the PR list at one position, so React never remounts it. */}
      {tab === 'mine' ? myJobs : null}
      {renderPullRequests?.({ scope: tab, onScope: setTab, onTotal: setTotal })}
      {tab === 'all' ? inventory : null}
      {tab === 'mine' ? myWork : null}
    </div>
  </>
}
