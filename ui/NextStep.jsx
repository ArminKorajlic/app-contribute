import { nextStepModel, stateLine } from '../next-step.js'

// "Draft → In review → Approved → Merged": where this PR is on its way, from the PR's
// own data. The current step carries aria-current, so it reads without colour.
export function StateLine({ pr, decision }) {
  const line = stateLine(pr, decision)
  if (!line) return null
  return <ol className="co-state-line" aria-label={`Where this PR is: ${line.current}`}>
    {line.steps.map(step => <li key={step.label} className={(step.done ? 'is-done ' : '') + (step.current ? 'is-current' : '')} aria-current={step.current ? 'step' : undefined}>{step.label}</li>)}
  </ol>
}

// What is true (a pill), the machine's own sentence, and the one filled button for the
// next step, together under the facts line. The Actions menu and the Review tab keep
// their own copies of the sentence, each worded for its place.
export function NextStep({ decision, record, capabilities, disabled = false, onChoose, onReviewTab, onSync }) {
  const model = nextStepModel(decision, { record, capabilities })
  if (!model) return null
  const run = { menu: () => onChoose?.(model.primary.intent), review: () => onReviewTab?.(), sync: () => onSync?.() }
  return <section className="co-next-step" data-turn={decision.turn} aria-label="Next step">
    <span className={'co-desk-chip is-' + model.pill.tone}>{model.pill.label}</span>
    <p className="co-next-hint">{model.hint}</p>
    {model.primary ? <button type="button" className="co-btn co-btn-primary" disabled={disabled} onClick={run[model.primary.route]}>{model.primary.title}</button> : null}
  </section>
}
