import { reviewSteps } from '../review-steps.js'

export function ReviewSteps({ standing, itemState }) {
  const steps = reviewSteps(standing, { itemState })
  if (!steps.length) return null
  return <ol className="co-review-steps" aria-label="Where this PR is">
    {steps.map(step => <li key={step.label} className={'is-' + step.at} aria-current={step.at === 'current' ? 'step' : undefined}>{step.label}</li>)}
  </ol>
}
