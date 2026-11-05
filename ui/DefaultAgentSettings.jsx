import { AgentModelSettings } from './AgentModelSettings.jsx'
import { Icon } from './Icons.jsx'

// Where a Review, Re-review or Fix window starts. Each window still lets the
// owner pick another agent for that one run; this never changes a run by itself.
// With no agent saved the windows follow the Möbius background agent setting.
export function DefaultAgentSettings({ token, agent, onChange }) {
  if (typeof onChange !== 'function') return null
  return <section className="co-settings-agent" aria-label="Default agent">
    <h3>Default agent</h3>
    <div className="co-set-card">
      <div className="co-set-row">
        <span className="co-set-tile" aria-hidden="true"><Icon name="prepare" size={18} /></span>
        <div className="co-set-text">
          <strong>Agent for reviews and fixes</strong>
          <small>Suggested each time you review, re-review or fix. Each window still lets you pick a different agent for that run.</small>
        </div>
      </div>
      <div className="co-set-picker">
        <AgentModelSettings token={token} choice={agent} defaultHint="Your background agent setting" onChange={next => { onChange(next); return true }} />
      </div>
    </div>
  </section>
}
