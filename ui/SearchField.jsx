import { Icon } from './Icons.jsx'
import { NAMES } from '../names.js'

// The one search field of Contribute: Needs you, Repositories, the PR list, the changed-files filter and the
// Assign window all use it, so a search never looks like a different control on another screen. A magnifier
// that only decorates (the label names the field), a Clear button while there is text (focus goes back to the
// field), one purple edge and soft ring on focus. The input is 16px: a smaller one makes iPhones zoom the page on focus.
// `className` only places it (flex, width), `inputRef` lets a toggle focus it.
export function SearchField({ label, value, onChange, placeholder = label, disabled = false, inputRef = null, className = '' }) {
  return (
    <label className={'co-search' + (className ? ' ' + className : '')}>
      <Icon name="search" size={16} />
      <input ref={inputRef} type="search" placeholder={placeholder} aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
      {value && !disabled ? <button type="button" className="co-search-clear" aria-label={NAMES.clearSearch} onClick={event => { onChange(''); event.currentTarget.parentElement.querySelector('input')?.focus() }}><Icon name="close" size={16} /></button> : null}
    </label>
  )
}
