import { Icon } from './Icons.jsx'

// The one search field of the Desk: Needs you and Repositories both use it, in the same place
// (under their filter line), with the same magnifier, so a search never looks like two different things.
export function DeskSearch({ label, value, onChange }) {
  return (
    <label className="co-desk-search">
      <Icon name="search" size={16} />
      <input type="search" placeholder={label} aria-label={label} value={value} onChange={event => onChange(event.target.value)} />
    </label>
  )
}
