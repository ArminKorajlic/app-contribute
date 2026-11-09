// One row of text filters, shared by Needs you and Repositories so both screens read and sit the same:
// the count first in the accent colour, then the word, the chosen one underlined. `count` may be left
// off (an "All" filter has none); a zero is shown, because "0 behind GitHub" is an answer.
// A tap area is still the full control height (see .co-filter-line in workspace-theme.js).
export function FilterLine({ label, items, active, onPick }) {
  return (
    <div className="co-filter-line" role="group" aria-label={label}>
      {items.map(item => (
        <button key={item.key} type="button" aria-pressed={active === item.key} onClick={() => onPick(item.key)}>
          {item.count == null ? null : <b>{item.count}</b>}<span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
