import { bootSteps } from '../boot-steps.js'

// One full-screen load, as before, now with the step it is on and how far along it is.
export function BootProgress(props) {
  const { steps, done, total, current } = bootSteps(props)
  return <div className="co-boot" role="status">
    <span className="ma-spinner" aria-hidden="true" />
    <strong>Opening Contribute…</strong>
    <span>{current ? `Reading ${current.toLowerCase()} from GitHub and your Möbius.` : 'Almost ready.'}</span>
    <div className="co-boot-bar" role="progressbar" aria-label="Opening Contribute" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><i style={{ width: `${(done / total) * 100}%` }} /></div>
    <ol className="co-boot-steps">
      {steps.map(step => <li key={step.key} className={step.done ? 'is-done' : step.label === current ? 'is-current' : ''}>
        <span>{step.label}</span><em>{step.done ? (step.detail || 'ready') : step.label === current ? 'reading' : 'waiting'}</em>
      </li>)}
    </ol>
  </div>
}
