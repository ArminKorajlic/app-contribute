// The opening screen's progress (finding 11). Contribute opens only after five reads have
// finished; this names each one and says how far along it is, from the app's own state, so
// the owner sees movement instead of one static sentence. Pure, so it is tested without a browser.

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// `ready` holds the same five conditions index.jsx's bootReady joins. A step's detail shows
// only once its read has produced something to count.
export function bootSteps({ ledgerReady, projectsReady, accountReady, accountConnected, pullsReady, runsReady, projectCount = 0, pullCount = 0 }) {
  const steps = [
    { key: 'saved', label: 'Prepared PRs', done: !!ledgerReady },
    { key: 'projects', label: 'Repositories', done: !!projectsReady, detail: projectsReady ? plural(projectCount, 'repository', 'repositories') : '' },
    { key: 'account', label: 'GitHub account', done: !!accountReady },
    { key: 'pulls', label: 'Pull requests', done: !!pullsReady || !accountConnected, detail: pullsReady && accountConnected ? plural(pullCount, 'PR', 'PRs') : '' },
    { key: 'runs', label: 'Agent runs', done: !!runsReady },
  ]
  const done = steps.filter(step => step.done).length
  return { steps, done, total: steps.length, current: steps.find(step => !step.done)?.label || '' }
}
