// The three button types of DESIGN.md, plus one danger modifier and one icon-only shape.
// Every button takes its look from here: `.co-btn` (secondary) with at most one of
// `.co-btn-primary` / `.co-btn-quiet`, optionally `.co-btn-danger` and `.co-btn-icon`.
// Any other class on a button sets layout only (spacing, width, a turning chevron), never
// its border, fill, colour, corner, type or height. Loaded last, after the workspace sheet.
export const BUTTON_CSS = `
/* mobius-ui:Button v2 — app-owned copy; library candidate. */
.co-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: var(--co-control-height); padding: 8px 14px; border-radius: var(--co-radius-control);
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  font: 600 var(--co-text-meta)/1.25 var(--font); text-decoration: none; white-space: nowrap; cursor: pointer;
  transition: background .14s ease, border-color .14s ease, color .14s ease;
}
.co-btn:disabled { opacity: .5; cursor: default; }
.co-btn.is-sending:disabled { opacity: 1; cursor: progress; }
.co-btn-primary { border-color: var(--accent-hover, var(--accent)); background: var(--accent-hover, var(--accent)); color: var(--accent-fg); }
.co-btn-quiet { border-color: transparent; background: transparent; color: var(--co-btn-tone, var(--muted)); padding-inline: 8px; }
/* A quiet button can carry a tone (--co-btn-tone and its fill) without any rule of its own overriding the type. */
.co-btn-quiet.is-toned[aria-pressed=true] { background: var(--co-btn-tone-fill, var(--surface-2, var(--surface))); color: var(--co-btn-tone, var(--text)); }
.co-btn-danger { color: var(--danger); }
.co-btn-danger:not(.co-btn-quiet) { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
.co-btn-icon { flex: 0 0 auto; width: var(--co-control-height); min-width: var(--co-control-height); padding: 0; }
.co-btn-block { width: 100%; }
/* A button that is also a name: the repository's icon and name on a card header (the owner's choice, 2026-11-06).
   Fully rounded with a faint fill so it reads as pressable; the accent shows while it is pressed. */
.co-btn-chip { min-width: 0; max-width: 100%; padding: 0 14px 0 8px; border-radius: var(--co-radius-round); background: var(--surface-2, var(--bg)); text-align: left; white-space: normal; }
.co-btn-chip:not(:disabled):active { border-color: var(--accent); background: var(--accent-dim, var(--surface-2)); }
.co-btn > .co-icon { flex: 0 0 auto; align-self: center; margin: 0; }
@media (hover: hover) {
  .co-btn:not(:disabled):hover { border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); background: var(--surface-2, var(--surface)); }
  .co-btn-primary:not(:disabled):hover {
    border-color: color-mix(in srgb, var(--accent-hover, var(--accent)) 88%, #000);
    background: color-mix(in srgb, var(--accent-hover, var(--accent)) 88%, #000); color: var(--accent-fg);
  }
  .co-btn-quiet:not(:disabled):hover { border-color: transparent; background: var(--co-btn-tone-fill, var(--surface-2, var(--surface))); color: var(--co-btn-tone, var(--text)); }
  .co-btn-danger:not(:disabled):hover { background: color-mix(in srgb, var(--danger) 8%, var(--surface)); color: var(--danger); }
}
/* The Actions button is on every PR, on every screen width. Its edge is the strong one (--co-edge), so a quiet one in a row still
   reads as a button; the Actions menu is drawn in workspace-theme.js with the same edge. */
.co-agent-menu-button { border-color: var(--co-edge); }
/* /mobius-ui:Button */
`
