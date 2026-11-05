import { WORKSPACE_CSS } from './workspace-theme.js'
import { BUTTON_CSS } from './button-theme.js'
// One module-level stylesheet rendered once at the app root as
// <style>{CSS}</style>. Semantic co-* classNames; state rides is-*
// modifier classes; every color is a theme token so the app follows the
// owner's light/dark theme. Shared chrome blocks carry mobius-ui fences
// so a future library harvest can find them.
export const CSS = `
/* mobius-ui:Root v1 — app-owned copy; library candidate. */
/* The one token sheet (DESIGN.md): 5 corner radii and 4 type sizes, none under
   14 px. Every rule names a token, never a raw value (test/style-tokens.test.mjs). */
:root {
  --co-radius-pill: 6px;      /* status pills and small chips */
  --co-radius-field: 8px;     /* inputs and inner boxes */
  --co-radius-control: 10px;  /* buttons and rows */
  --co-radius-panel: 12px;    /* cards, panels and windows */
  --co-radius-round: 999px;   /* state pills, labels and counts */
  --co-text-meta: 14px;
  --co-text-body: 16px;
  --co-text-section: 22px;
  --co-text-title: 28px;
  --co-control-height: 44px;
  /* "Your move" purple text on its tinted fill: the plain accent read 4.1:1 there; mixed
     toward the text colour it reads about 6:1 in dark and light, same look. */
  --co-you-text: color-mix(in srgb, var(--accent) 65%, var(--text));
}
.co-root {
  box-sizing: border-box; position: relative; min-height: 0; height: 100%;
  /* clip, not hidden: a hidden box is still a scroll container, so opening a
     panel with scrollIntoView could scroll the whole app up and leave a blank
     band below. Only .co-page scrolls. */
  display: flex; flex-direction: column; overflow: hidden; overflow: clip;
  background: var(--bg); color: var(--text); font-family: var(--font); font-size: var(--co-text-body); line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  /* Caution amber for advisory/attention states that are NOT errors, so real
     failures keep --danger to themselves and nothing benign shouts in red. */
  --co-warn: var(--warning, #b38235);
}
.co-root *, .co-root *::before, .co-root *::after { box-sizing: inherit; }
.co-visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
/* /mobius-ui:Root */

/* mobius-ui:Scrollskin v1 — app-owned copy. */
.co-page { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.co-page::-webkit-scrollbar { width: 8px; height: 8px; }
.co-page::-webkit-scrollbar-thumb { background: var(--border); border-radius: var(--co-radius-field); border: 2px solid transparent; background-clip: padding-box; }
.co-page::-webkit-scrollbar-thumb:hover { background-color: var(--muted); }
/* /mobius-ui:Scrollskin */

/* mobius-ui:Focus v1 — one keyboard-focus ring for every interactive
   control, so nothing ships without a visible focus indicator. */
:where(button, a, input, textarea, select, summary, [role="button"],
       [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* /mobius-ui:Focus */

/* mobius-ui:ReducedMotion v1 — collapse motion to ~instant for
   motion-sensitive users. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
/* /mobius-ui:ReducedMotion */

.co-page {
  flex: 1; min-height: 0; width: min(100%, 1240px); margin: 0 auto;
  padding: 0 20px max(56px, calc(28px + env(safe-area-inset-bottom)));
  overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
}

/* The contribution Run keeps a focused reading measure while Projects uses
   the wider canvas. */
.co-contributions-view {
  width: 100%; margin-inline: auto;
}

.co-header-shell {
  flex: 0 0 auto; width: 100%; background: var(--bg);
}
.co-header {
  position: relative; display: grid;
  grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px 16px;
  width: min(100%, 1040px); margin-inline: auto;
  padding: max(18px, env(safe-area-inset-top)) 20px 12px;
}
.co-header-main { min-width: 0; display: flex; align-items: center; gap: 12px; }
.co-brand-copy { min-width: 0; }
.co-brand-icon {
  width: 34px; height: 34px; border-radius: var(--co-radius-field);
  object-fit: cover; flex-shrink: 0; display: block;
}
.co-brand-fallback {
  width: 34px; height: 34px; border-radius: var(--co-radius-field); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--co-text-body); font-weight: 700;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.co-title { margin: 0; font-size: var(--co-text-section); font-weight: 720; letter-spacing: -0.02em; }
.co-subtitle { display: block; margin-top: 2px; font-size: var(--co-text-meta); color: var(--muted); }

.co-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 7px; }
.co-project-control {
  min-height: 44px; display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--co-radius-panel);
  background: transparent; color: var(--text); font: inherit;
  font-size: var(--co-text-meta); font-weight: 600; cursor: pointer; white-space: nowrap;
}
.co-project-control > .co-icon { color: var(--muted); }
.co-project-control b {
  min-width: 18px; height: 18px; display: inline-flex; align-items: center;
  justify-content: center; padding: 0 5px; border-radius: var(--co-radius-round);
  background: var(--surface-2, var(--surface)); color: var(--muted);
  font-size: var(--co-text-meta); font-variant-numeric: tabular-nums;
}
@media (hover: hover) {
  .co-project-control:hover { background: var(--surface); border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); }
}
.co-toolbar-check {
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--muted);
}
.co-toolbar-refresh { gap: 7px; white-space: nowrap; }
.co-label-short { display: none; }
.co-sync-note { color: var(--muted); font-size: var(--co-text-meta); white-space: nowrap; }
.co-boot {
  min-height: 70dvh; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 10px; color: var(--muted); text-align: center; padding: 24px;
}
.co-boot strong { color: var(--text); font-size: var(--co-text-body); }
.co-boot > span:not(.ma-spinner) { font-size: var(--co-text-meta); }
.co-boot .ma-spinner { width: 28px; height: 28px; margin-bottom: 6px; }
.co-boot-bar { width:min(280px,80%); height:6px; margin-top:12px; border-radius:var(--co-radius-round); background:var(--surface-2); overflow:hidden; }
.co-boot-bar i { display:block; height:100%; border-radius:inherit; background:var(--accent); transition:width .3s ease; }
.co-boot-steps { width:min(280px,80%); margin:10px 0 0; padding:0; list-style:none; text-align:left; font-size:var(--co-text-meta); }
.co-boot-steps li { display:flex; justify-content:space-between; gap:12px; padding:3px 0; color:var(--muted); }
.co-boot-steps li.is-done { color:var(--text); }
.co-boot-steps li.is-current { color:var(--text); font-weight:600; }
.co-boot-steps em { font-style:normal; }
.ma-spinner.is-compact { width: 15px; height: 15px; border-width: 2px; }
.co-offline-note {
  grid-column: 1 / -1; display: block; margin: -2px 0 0 46px;
  font-size: var(--co-text-meta); color: var(--muted); text-wrap: pretty;
}

/* One project overview, with scoped reviews one step away. */
.co-page.is-sources {
  padding-bottom: 12px;
  display: block; overflow-y: auto; overflow-x: hidden;
}
.co-project-icon {
  display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
  background: var(--surface-2, var(--surface)); color: var(--muted);
  font-size: var(--co-text-meta); font-weight: 700;
}
.co-project-icon.has-image {
  background: var(--surface-2, var(--surface)); color: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 76%, transparent);
}
.co-project-icon img { display: block; width: 100%; height: 100%; object-fit: cover; }
.co-quality-pill { display: inline-flex; align-items: center; gap: 4px; width: max-content; color: var(--muted); font-size: var(--co-text-meta); font-weight: 650; }
.co-quality-pill.is-all_clear { color: var(--green); }
.co-quality-pill.is-changes_needed { color: var(--co-warn); }
.co-quality-pill.is-reviewing, .co-quality-pill.is-queued { color: var(--accent); }
/* Project position and publication progress stay separate and scannable. */
.co-projects-view {
  width: 100%; margin-inline: auto; padding: 4px 0 32px;
}
.co-view-heading {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 20px; margin: 0 0 18px;
}
.co-view-heading > div { min-width: 0; }
.co-view-heading h2 {
  margin: 0; font-size: var(--co-text-section); line-height: 1.2;
  letter-spacing: -.03em; text-wrap: balance;
}
.co-view-heading p {
  max-width: 58ch; margin: 7px 0 0; color: var(--muted);
  font-size: var(--co-text-meta); line-height: 1.55; text-wrap: pretty;
}
.co-focus-back {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
  min-height: 44px; padding: 8px 2px; border: 0; background: transparent;
  color: var(--muted); font: inherit; font-size: var(--co-text-meta); font-weight: 650;
  cursor: pointer;
}
.co-view-note,
.co-view-warning {
  margin: -12px 0 18px; padding: 9px 11px; border-left: 2px solid var(--border);
  color: var(--muted); font-size: var(--co-text-meta); line-height: 1.5;
}
.co-view-warning { border-left-color: var(--co-warn); color: var(--text); }
.co-project-search { display: block; margin: 0 0 10px; }
.co-project-search input {
  width: 100%; min-height: 46px; padding: 10px 13px;
  border: 1px solid var(--border); border-radius: var(--co-radius-panel);
  background: var(--surface); color: var(--text); caret-color: var(--accent);
  font: inherit; font-size: var(--co-text-body);
}
.co-project-search input::placeholder { color: var(--muted); }
.co-project-search input:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
}
.co-lens-nav {
  display: flex; align-items: stretch; gap: 22px; min-height: 44px;
  margin: 0 0 26px; overflow-x: auto; overflow-y: hidden;
  border-bottom: 1px solid var(--border); scrollbar-width: none;
  overscroll-behavior-inline: contain;
}
.co-lens-nav::-webkit-scrollbar { display: none; }
.co-lens-nav button {
  position: relative; flex: 0 0 auto; display: inline-flex; align-items: center;
  gap: 7px; min-height: 44px; padding: 5px 0 10px; border: 0;
  background: transparent; color: var(--muted); font: inherit;
  font-size: var(--co-text-meta); font-weight: 650; white-space: nowrap; cursor: pointer;
}
.co-lens-nav button::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 2px; border-radius: var(--co-radius-pill) var(--co-radius-pill) 0 0; background: transparent;
}
.co-lens-nav button.is-active { color: var(--text); }
.co-lens-nav button.is-active::after { background: var(--accent); }
.co-lens-nav b {
  min-width: 18px; height: 18px; display: inline-flex; align-items: center;
  justify-content: center; padding: 0 5px; border-radius: var(--co-radius-round);
  background: var(--surface-2, var(--surface)); color: var(--muted);
  font-size: var(--co-text-meta); font-variant-numeric: tabular-nums;
}
.co-stage-intro {
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
  min-height: 76px; margin: 0 0 13px; padding: 3px 1px 17px;
}
.co-stage-intro > div:first-child { min-width: 0; }
.co-stage-intro h3 { margin: 0; font-size: var(--co-text-body); line-height: 1.3; letter-spacing: -.015em; }
.co-stage-intro p { max-width: 55ch; margin: 4px 0 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.5; text-wrap: pretty; }
.co-stage-empty {
  min-height: 230px; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 6px; border: 1px solid var(--border);
  border-radius: var(--co-radius-panel); background: var(--surface); color: var(--muted);
  text-align: center; padding: 28px;
}
.co-stage-empty .co-icon { margin-bottom: 8px; color: var(--muted); }
.co-stage-empty.is-clear .co-icon { color: var(--green); }
.co-stage-empty strong { color: var(--text); font-size: var(--co-text-meta); }
.co-stage-empty span { max-width: 42ch; font-size: var(--co-text-meta); line-height: 1.5; text-wrap: pretty; }
.co-feed-loading {
  min-height: 42dvh; display: flex; align-items: center; justify-content: center;
  gap: 9px; color: var(--muted); font-size: var(--co-text-meta);
}
.co-project-index,
.co-review-list {
  overflow: hidden; border: 0; border-radius: 0; background: transparent;
}
.co-source-group { min-width: 0; }
.co-source-group + .co-source-group { border-top: 1px solid var(--border); }
.co-source-group-label {
  min-height: 36px; display: flex; align-items: center; padding: 8px 14px;
  background: var(--surface-2, var(--surface)); color: var(--muted);
  font-size: var(--co-text-meta); font-weight: 600;
}
.co-source-row-wrap.is-quiet .co-source-row-facts { color: var(--muted); }
.co-source-row-wrap + .co-source-row-wrap { border-top: 1px solid var(--border); }
.co-source-row {
  display: grid; grid-template-columns: 36px minmax(0, 1fr) auto;
  grid-template-rows: auto auto; align-items: center; gap: 3px 11px;
  width: 100%; min-height: 106px; padding: 18px 4px; border: 0;
  background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer;
  transition: background .14s ease, box-shadow .14s ease;
}
.co-source-glyph {
  grid-column: 1; grid-row: 1 / 3; width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--co-radius-control); background: color-mix(in srgb, var(--accent) 11%, var(--surface-2, var(--surface)));
  color: var(--accent); font-size: var(--co-text-meta); font-weight: 750;
}
.co-source-row-id { grid-column: 2; grid-row: 1; min-width: 0; }
.co-source-row-id strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: normal; font-size: var(--co-text-body); font-weight: 650; }
.co-source-row-facts { grid-column: 2; grid-row: 2; min-width: 0; display: grid; gap: 4px; color: var(--text); font-size: var(--co-text-body); line-height: 1.5; }
.co-source-row-facts > span { min-width: 0; overflow-wrap: anywhere; }
.co-source-row-facts > small { color: var(--muted); font-size: var(--co-text-meta); font-variant-numeric: tabular-nums; }
.co-source-row-cue {
  grid-column: 3; grid-row: 1 / 3; display: inline-flex; align-items: center;
  justify-content: flex-end; gap: 8px; color: var(--muted);
}
.co-source-row-cue .co-icon { transition: transform .14s ease; }
.co-focus-view { width: 100%; margin-inline: auto; }
.co-focus-back { margin: 5px 0 14px; color: var(--accent); }
.co-source-error,
.co-source-unavailable {
  border: 1px solid var(--border); border-radius: var(--co-radius-panel); background: var(--surface);
  color: var(--muted); font-size: var(--co-text-meta); line-height: 1.5;
}
.co-source-error {
  display: flex; flex-direction: column; align-items: flex-start; gap: 7px;
  max-width: 520px; margin: 60px auto; padding: 18px;
}
.co-source-error strong { color: var(--text); font-size: var(--co-text-body); }
.co-source-error p { margin: 0; }
.co-source-unavailable { margin: 12px 0 0; padding: 12px; }
@media (hover: hover) {
  .co-lens-nav button:hover { color: var(--text); }
  .co-source-row:hover { background: color-mix(in srgb, var(--accent) 7%, transparent);  }
  .co-source-row:hover .co-source-row-cue .co-icon { transform: translateX(2px); }
}

.co-source-status {
  flex: 0 0 auto; max-width: 128px; padding: 5px 8px; border-radius: var(--co-radius-round);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: var(--surface-2, var(--bg)); color: var(--muted);
  font-size: var(--co-text-meta); line-height: 1; font-weight: 680;
}
.co-source-status.tone-accent { background: color-mix(in srgb, var(--accent) 13%, transparent); color: color-mix(in srgb, var(--accent) 80%, var(--text)); }
.co-source-status.tone-ok { background: color-mix(in srgb, var(--green) 12%, transparent); color: var(--green); }
.co-source-status.tone-warn { background: color-mix(in srgb, var(--accent) 11%, transparent); color: var(--text); }
.co-source-status.tone-danger { background: color-mix(in srgb, var(--danger) 12%, transparent); color: color-mix(in srgb, var(--danger) 80%, var(--text)); }

.co-source-detail {
  min-width: 0; padding: 0; border: 0; background: transparent;
}
.co-source-detail-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding-bottom: 12px; border-bottom: 1px solid var(--border);
}

.co-project-controls { margin: 20px 0 28px; }
.co-board-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.co-board-actions > .co-btn { padding: 10px 16px; gap: 8px; }
.co-control-note { margin: 10px 0 0; color: var(--muted); font-size: var(--co-text-meta); }
.co-cycle-progress { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 14px; }
.co-cycle-progress > span { flex: 1 1 200px; }
.co-source-shared { color: var(--muted); }
.co-source-attention { color: var(--accent); }
.co-project-detail-fold { margin-top: 20px; border-top: 1px solid var(--border); }
.co-project-detail-fold > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 52px; color: var(--muted); font-size: var(--co-text-meta); cursor: pointer; list-style: none; }
.co-project-detail-fold > summary::-webkit-details-marker { display: none; }
.co-project-detail-fold[open] > summary .co-icon { transform: rotate(180deg); }
.co-board-position { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin: 22px 0; }
.co-board-position > div { min-width: 0; }
.co-board-position dt { color: var(--muted); font-size: var(--co-text-meta); margin-bottom: 5px; }
.co-board-position dd { margin: 0; font-size: var(--co-text-body); line-height: 1.5; overflow-wrap: anywhere; }
.co-review-scope { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
.co-review-scope strong { font-size: var(--co-text-meta); }
.co-review-scope span { color: var(--muted); font-size: var(--co-text-meta); }
@media (max-width: 560px) {
  .co-board-position { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .co-board-actions > .co-btn { flex: 1 1 auto; }
}

.co-project-reviews { margin-top: 24px; overflow: hidden; }
.co-project-reviews > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 0; background: transparent; }
.co-project-reviews > header strong { font-size: var(--co-text-meta); }
.co-project-reviews > header small { color: var(--muted); font-size: var(--co-text-meta); font-variant-numeric: tabular-nums; }
.co-project-reviews > button { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 0; border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.co-project-reviews > button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: normal; font-size: var(--co-text-meta); line-height: 1.5; }
.co-project-reviews > button small { flex: none; color: var(--muted); font-size: var(--co-text-meta); text-transform: capitalize; }
.co-project-request-summary { display: flex; margin-top: 12px; color: var(--muted); font-size: var(--co-text-meta); font-variant-numeric: tabular-nums; }
.co-source-detail-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
.co-source-detail-title > div { min-width: 0; }
.co-source-detail-title h3 { margin: 0; font-size: var(--co-text-section); line-height: 1.3; overflow-wrap: anywhere; }
.co-source-overview-copy { margin: 12px 0 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.55; text-wrap: pretty; }
.co-project-handoff {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  margin-top: 14px; padding: 12px 0;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.co-project-handoff > span {
  max-width: 54ch; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.5;
}
.co-project-files { border-top: 1px solid var(--border); }
.co-project-files > header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 48px; padding: 4px 2px; color: var(--muted); font-size: var(--co-text-meta); font-weight: 650;
}
.co-project-files > header small { font-size: var(--co-text-meta); font-weight: 500; }
.co-project-diff-loading,
.co-project-diff-empty,
.co-project-diff-note {
  margin: 0; padding: 14px 2px; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.5;
}
.co-project-diff-loading { display: flex; align-items: center; gap: 9px; }
.co-project-diff-note { padding-top: 4px; }
.co-project-files-toggle { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; margin-top: 3px; padding: 7px; }
.co-btn.co-project-files-toggle { color: var(--accent); }
.co-project-files-toggle .co-icon { transition: transform .16s ease; }
.co-project-files-toggle[aria-expanded="true"] .co-icon { transform: rotate(180deg); }

.co-local-position {
  display: flex; flex-direction: column; gap: 3px; margin-top: 14px;
  padding: 13px 2px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.co-local-position strong { font-size: var(--co-text-meta); }
.co-local-position span { color: var(--muted); font-size: var(--co-text-meta); line-height: 1.5; }

.co-position-details { border-top: 1px solid var(--border); }
.co-position-details > summary {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 46px; padding: 4px 2px; list-style: none; cursor: pointer;
  color: var(--muted); font-size: var(--co-text-meta); font-weight: 650;
}
.co-position-details > summary::-webkit-details-marker { display: none; }
.co-position-details > summary .co-icon { transition: transform .16s ease; }
.co-position-details[open] > summary .co-icon { transform: rotate(180deg); }
.co-position-details dl { margin: 0 0 12px; }
.co-position-details dl > div {
  display: grid; grid-template-columns: minmax(92px, .45fr) minmax(0, 1fr);
  gap: 12px; padding: 7px 2px;
}
.co-position-details dl > div + div { border-top: 1px solid var(--border); }
.co-position-details dt { color: var(--muted); font-size: var(--co-text-meta); }
.co-position-details dd { min-width: 0; margin: 0; text-align: right; }
.co-position-details code {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-family: var(--mono, var(--font)); font-size: var(--co-text-meta);
}
.co-source-loading { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 48dvh; color: var(--muted); }
.co-source-loading > div { display: flex; flex-direction: column; gap: 3px; }
.co-source-loading strong { color: var(--text); font-size: var(--co-text-meta); }
.co-source-loading span:last-child { font-size: var(--co-text-meta); }
@keyframes co-spin { to { transform: rotate(360deg); } }
.ma-spinner { width: 24px; height: 24px; flex: 0 0 auto; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 18%, transparent); border-top-color: var(--accent); animation: co-spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .ma-spinner { animation: none; } }

/* Connection card. The dot is decorative — the text always carries the
   state, so color is never the only signal. */
.co-conn {
  display: flex; align-items: flex-start; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--co-radius-panel); padding: 13px 14px;
}
.co-conn-dot {
  flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%;
  margin-top: 6px; background: var(--muted);
}
.co-conn-dot.is-ok { background: var(--green); }
.co-conn-dot.is-warn { background: var(--co-warn); }
.co-conn-dot.is-accent { background: var(--accent); }
.co-conn-body { min-width: 0; flex: 1; }
.co-conn-title { font-size: var(--co-text-meta); font-weight: 650; margin: 0 0 2px; }
.co-conn-text { margin: 0; font-size: var(--co-text-meta); line-height: 1.55; color: var(--muted); }
.co-conn-text strong { color: var(--text); font-weight: 650; }
.co-conn-text a { color: var(--accent); }
.co-conn.is-connected {
  display: block; padding: 0; border: 0; border-radius: 0; background: transparent;
}
.co-conn.is-toolbar { position: relative; }
.co-github-menu {
  min-height: 44px; max-width: 520px; display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--co-radius-panel);
  background: transparent; color: var(--muted); font: inherit; cursor: pointer;
  transition: color .14s ease, border-color .14s ease, background .14s ease;
}
.co-github-menu > .co-icon:first-child { flex: 0 0 auto; color: var(--text); }
.co-github-menu > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-size: var(--co-text-meta); font-weight: 650;
}
.co-github-menu > .co-icon:last-child {
  flex: 0 0 auto; color: var(--muted); transition: transform .18s cubic-bezier(.16, 1, .3, 1);
}
.co-conn.is-open .co-github-menu {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  background: var(--surface);
}
.co-conn.is-open .co-github-menu > .co-icon:last-child { transform: rotate(180deg); }
@media (hover: hover) {
  .co-github-menu:hover {
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
    background: var(--surface);
  }
}
.co-setting-switch { position: relative; flex: 0 0 auto; width: 34px; height: 20px; display: block !important; }
.co-setting-switch input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0 !important; opacity: 0; cursor: pointer; }
.co-setting-switch i {
  position: absolute; inset: 0; border-radius: var(--co-radius-round); background: var(--border);
  transition: background .14s ease;
}
.co-setting-switch i::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--surface); box-shadow: 0 1px 3px color-mix(in srgb, #000 30%, transparent);
  transition: transform .18s cubic-bezier(.16, 1, .3, 1);
}
.co-setting-switch input:checked + i { background: var(--accent); }
.co-setting-switch input:checked + i::after { transform: translateX(14px); }
.co-setting-switch input:focus-visible + i { outline: 2px solid var(--accent); outline-offset: 2px; }
.co-method-setting {
  display: flex; flex-direction: column; gap: 7px; padding: 10px 8px;
  border-bottom: 1px solid var(--border);
}
.co-method-setting > strong { font-size: var(--co-text-meta); font-weight: 650; color: var(--muted); }
.co-method-options {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 3px;
  border: 0; border-radius: var(--co-radius-control);
  background: var(--surface-2, var(--bg));
}
.co-method-options > button {
  min-width: 0; min-height: 44px; padding: 8px; overflow: hidden;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  text-overflow: ellipsis; white-space: nowrap; border: 0; border-radius: var(--co-radius-field);
  background: transparent; color: var(--muted); font: inherit;
  font-size: var(--co-text-meta); font-weight: 650; cursor: pointer;
}
.co-method-options > button > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.co-method-options > button > .co-icon { flex: 0 0 auto; }
.co-method-options > button.is-active {
  background: var(--surface); color: var(--text);
  box-shadow: 0 1px 4px color-mix(in srgb, #000 20%, transparent);
}

/* Account summary in the settings panel. The disconnected card switches to a
   column layout; every control uses the shared theme tokens and a 44px min
   touch target. */
.co-conn.is-column { flex-direction: column; align-items: stretch; gap: 13px; }
.co-conn-row { display: flex; align-items: flex-start; gap: 10px; }
.co-conn-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.co-conn-body .co-conn-actions { margin-top: 10px; }
.co-settings { position: relative; flex: none; }
.co-settings > summary { gap: 8px; min-width: 44px; padding: 0 10px; min-height: 44px; display: flex; align-items: center; justify-content: center; color: var(--muted); cursor: pointer; border-radius: var(--co-radius-control); list-style: none; }
.co-settings > summary > span { font-size: var(--co-text-meta); white-space: nowrap; }
.co-settings > summary::-webkit-details-marker { display: none; }
.co-settings > summary:hover, .co-settings[open] > summary { background: var(--surface); color: var(--text); }
.co-settings-panel { position: absolute; top: 52px; right: 0; z-index: 60; width: min(360px, calc(100vw - 32px)); max-height: calc(100dvh - 120px); overflow-y: auto; overscroll-behavior: contain; padding: 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--co-radius-panel); }
.co-settings-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.co-settings-panel h2 { margin: 0; font-size: var(--co-text-body); }
.co-settings-panel .co-conn { border: 0; padding: 0; margin: 0; background: transparent; }
.co-settings-panel .co-conn.is-connected { display: block; }
.co-account-default { display: flex; gap: 10px; align-items: center; }
.co-account-default > .co-icon { color: var(--accent); }
.co-account-default > div { display: grid; gap: 4px; }
.co-account-default strong { font-size: var(--co-text-meta); }
.co-account-default small { font-size: var(--co-text-meta); color: var(--muted); }
.co-github-upgrade { padding-top: 18px; margin-top: 5px; border-top: 1px solid var(--border); }
.co-github-upgrade strong { font-size: var(--co-text-meta); }
.co-github-upgrade .co-conn-note { margin: 5px 0 0; }



.co-agent-handoff { flex: 0 0 auto; display: flex; flex-direction: column; align-items: stretch; gap: 5px; }
.co-agent-handoff-error {
  max-width: 230px; margin: 0; color: var(--danger); font-size: var(--co-text-meta);
  line-height: 1.35; text-align: right;
}
.co-agent-started {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; padding-top: 2px;
}
.co-agent-started > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-agent-started strong { color: var(--green); font-size: var(--co-text-meta); line-height: 1.35; }
.co-agent-started small { max-width: 48ch; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.4; }
.co-agent-chat-link {
  flex: 0 0 auto; min-height: 40px; padding: 7px 3px; border: 0;
  background: transparent; color: var(--accent); font: inherit;
  font-size: var(--co-text-meta); font-weight: 680; cursor: pointer;
}

.co-conn-error { margin: 2px 0 0; font-size: var(--co-text-meta); color: var(--danger); line-height: 1.45; }
.co-conn-note { margin: 2px 0 0; font-size: var(--co-text-meta); color: var(--muted); line-height: 1.45; }
/* mobius-ui:Card v1 — app-owned copy; library candidate. */
.co-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--co-radius-panel); padding: 14px 15px; margin-top: 9px;
}
.co-card.is-blocked { border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
/* /mobius-ui:Card */

.co-card-top {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 10px;
}
.co-card-heading { min-width: 0; margin: 0; font: inherit; }
.co-card-title {
  font-size: var(--co-text-body); font-weight: 650; line-height: 1.35; color: var(--text);
  text-decoration: none; min-width: 0; overflow-wrap: anywhere;
  /* generous tap area for the text link without shifting layout */
  padding: 4px 0; margin: -4px 0;
}
@media (hover: hover) {
  a.co-card-title:hover { text-decoration: underline; }
}
.co-chip {
  flex: 0 0 auto; font-size: var(--co-text-meta); font-weight: 650; line-height: 1;
  padding: 5px 9px; border-radius: var(--co-radius-round);
  background: var(--surface-2, var(--surface)); color: var(--muted);
}
.co-chip.is-prepared,
.co-chip.is-submitting,
.co-chip.is-open {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.co-chip.is-merged,
.co-chip.is-superseded {
  background: color-mix(in srgb, var(--green) 14%, transparent);
  color: var(--green);
}
.co-chip.is-needs-refresh {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
/* The one plain-language line under the chip: what this state means for the
   owner, in a calm muted voice below the title. */
.co-card-status { margin: 5px 0 0; font-size: var(--co-text-meta); line-height: 1.5; color: var(--muted); }
.co-card-summary { margin: 6px 0 0; font-size: var(--co-text-meta); line-height: 1.5; text-wrap: pretty; }
.co-card-summary.is-clamped {
  display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; color: var(--muted);
}
.co-card-meta {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
  font-size: var(--co-text-meta); color: var(--muted);
}
/* Collapsed prepared card: one muted meta line + one mono diffline. */
.co-technical-summary {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; gap: 7px 12px;
  margin-top: 9px;
}
.co-plan-meta {
  grid-column: 1 / -1;
  display: flex; align-items: baseline; gap: 6px; min-width: 0;
  font-size: var(--co-text-meta); line-height: 1.4; color: var(--muted);
}
.co-plan-meta-repo,
.co-plan-meta-time { flex: 0 0 auto; white-space: nowrap; }
.co-plan-meta-branch {
  flex: 0 1 auto; min-width: 0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  font-family: var(--mono, var(--font));
  color: color-mix(in srgb, var(--muted) 85%, var(--text));
}
.co-plan-meta-sep {
  flex: 0 0 auto; color: color-mix(in srgb, var(--muted) 55%, transparent);
}
.co-diffline {
  display: inline-flex; align-items: baseline; gap: 9px;
  font-family: var(--mono, var(--font)); font-size: var(--co-text-meta); line-height: 1.3;
}
.co-diffline-files { color: var(--muted); }
.co-diffline-add { color: color-mix(in srgb, var(--green) 82%, var(--text)); font-weight: 650; }
.co-diffline-del { color: color-mix(in srgb, var(--danger) 80%, var(--text)); font-weight: 650; }

/* Persisted submit error — calm, actionable, with technical detail secondary. */
.co-alert {
  align-self: stretch; margin-top: 10px; padding: 9px 11px;
  display: flex; flex-direction: column; gap: 6px;
  border-radius: var(--co-radius-control);
  border: 1px solid color-mix(in srgb, var(--co-warn) 26%, var(--border));
  background: color-mix(in srgb, var(--co-warn) 6%, var(--surface));
}
.co-alert-text {
  margin: 0; font-size: var(--co-text-meta); line-height: 1.45; overflow-wrap: anywhere;
  color: var(--muted);
}
.co-alert > strong { color: var(--text); font-size: var(--co-text-meta); line-height: 1.35; }
.co-alert-reassurance { margin: 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.45; }
.co-alert .co-btn { align-self: flex-start; }
.co-alert.is-follow-up {
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-alert.is-follow-up .co-alert-text {
  color: color-mix(in srgb, var(--accent) 72%, var(--text));
}
.co-alert.is-passed {
  border-color: color-mix(in srgb, var(--green) 32%, var(--border));
  background: color-mix(in srgb, var(--green) 7%, var(--surface));
}
.co-alert.is-passed > strong { color: var(--green); }
/* The raw Git message, tucked behind a Details disclosure under the headline. */
.co-alert-details > summary {
  cursor: pointer; font-size: var(--co-text-meta); color: var(--muted); min-height: 38px;
  display: inline-flex; align-items: center; list-style: none;
}
.co-alert-details > summary::-webkit-details-marker { display: none; }
.co-alert-details[open] > summary { margin-bottom: 5px; }
.co-alert-details > .co-alert-text { margin: 0; }

.co-attention {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  margin-top: 10px; padding: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: var(--co-radius-field);
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-attention-copy {
  min-width: 0; display: flex; flex-direction: column; gap: 4px;
}
.co-attention-title {
  font-size: var(--co-text-meta); font-weight: 700; color: var(--text); line-height: 1.3;
}
.co-attention-text {
  margin: 0; font-size: var(--co-text-meta); line-height: 1.45; color: var(--muted);
  overflow-wrap: anywhere;
}

.co-reconciliation-hint {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  margin-bottom: 10px; padding: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: var(--co-radius-field);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-reconciliation-hint > div {
  min-width: 0; display: flex; flex-direction: column; gap: 4px;
}
.co-reconciliation-hint strong {
  font-size: var(--co-text-meta); line-height: 1.35; color: var(--text);
}
.co-reconciliation-hint p {
  margin: 0; font-size: var(--co-text-meta); line-height: 1.45; color: var(--muted);
}
.co-reconciliation-hint a {
  align-self: flex-start; font-size: var(--co-text-meta); color: var(--accent);
  text-underline-offset: 2px;
}
.co-reconciliation-hint .co-btn { flex: 0 0 auto; }

/* Review view: the staged plan a prepared card expands into. Prose stays in
   the app font; the diff is monospace and scrolls INSIDE its own block (both
   axes) so a wide hunk never stretches the card or the page. */
.co-review {
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--border);
}
.co-review-badge {
  font-size: var(--co-text-meta); font-weight: 650; line-height: 1; padding: 5px 9px;
  border-radius: var(--co-radius-round);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.co-review-title { font-size: var(--co-text-meta); font-weight: 650; line-height: 1.4; }
.co-publication-review {
  align-self: stretch; display: grid; grid-template-columns: auto minmax(0, 1fr);
  gap: 10px; padding: 11px 12px; border: 1px solid var(--border);
  border-radius: var(--co-radius-control);
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-publication-review > span {
  align-self: start; padding: 4px 7px; border-radius: var(--co-radius-round);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  color: var(--accent); font-size: var(--co-text-meta); font-weight: 750;
  line-height: 1.2; letter-spacing: .035em; text-transform: uppercase;
  white-space: nowrap;
}
.co-publication-review > div { min-width: 0; }
.co-publication-review strong {
  display: block; font-size: var(--co-text-meta); line-height: 1.35; color: var(--text);
}
.co-publication-review p {
  margin: 3px 0 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.45;
}
.co-prior-work {
  align-self: stretch; display: flex; flex-direction: column; gap: 9px;
  padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--co-radius-control);
  background: color-mix(in srgb, var(--green) 6%, var(--surface));
}
.co-prior-work-head { display: flex; align-items: flex-start; gap: 9px; }
.co-prior-work-check {
  width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center;
  border-radius: var(--co-radius-field); background: color-mix(in srgb, var(--green) 14%, transparent);
  color: var(--green); font-size: var(--co-text-meta); font-weight: 800;
}
.co-prior-work-head > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-prior-work-head strong { font-size: var(--co-text-meta); line-height: 1.35; }
.co-prior-work-head span { color: var(--muted); font-size: var(--co-text-meta); line-height: 1.4; }
.co-prior-work > p { margin: 0; color: var(--text); font-size: var(--co-text-meta); line-height: 1.5; }
.co-prior-work-details { border-top: 1px solid var(--border); }
.co-prior-work-details > summary {
  min-height: 38px; display: flex; align-items: center; cursor: pointer;
  list-style: none; color: var(--muted); font-size: var(--co-text-meta);
}
.co-prior-work-details > summary::-webkit-details-marker { display: none; }
.co-prior-work-chevron {
  margin-left: auto; color: var(--muted); width: 18px; height: 18px;
  transform: rotate(0); transition: transform .14s ease;
}
.co-prior-work-details[open] .co-prior-work-chevron { transform: rotate(90deg); }
.co-prior-work-details > div { display: flex; flex-direction: column; gap: 8px; padding-bottom: 2px; }
.co-prior-work-query {
  display: flex; align-items: baseline; gap: 8px; min-width: 0;
  color: var(--muted); font-size: var(--co-text-meta);
}
.co-prior-work-query code {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-family: var(--mono, var(--font)); font-size: var(--co-text-meta);
}
.co-prior-work-links { margin: 0; padding-left: 20px; font-size: var(--co-text-meta); }
.co-prior-work-links li + li { margin-top: 6px; }
.co-prior-work-links a { color: var(--accent); overflow-wrap: anywhere; }
.co-prior-work-links span { display: block; margin-top: 1px; color: var(--muted); line-height: 1.4; }
.co-prior-work-more { color: var(--muted); font-size: var(--co-text-meta); }
.co-plan-labels {
  display: flex; flex-direction: column; align-items: stretch; gap: 7px; margin: 10px 0 14px;
  color: var(--muted); font-size: var(--co-text-meta);
}
.co-plan-labels-row { display: flex; align-items: center; gap: 10px; }
.co-plan-labels-row > div { display: flex; flex-wrap: wrap; gap: 6px; }
.co-plan-label {
  display: inline-flex; align-items: center; min-height: 24px; padding: 2px 9px;
  max-width: 100%; overflow-wrap: anywhere;
  border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border));
  border-radius: var(--co-radius-round);
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  color: color-mix(in srgb, var(--accent) 72%, var(--text));
  font-weight: 650;
}
.co-plan-label.is-muted {
  border-color: var(--border);
  background: color-mix(in srgb, var(--text) 5%, transparent);
  color: var(--muted);
}
.co-label-outcome {
  align-self: stretch; display: flex; flex-direction: column; gap: 8px;
  margin: 10px 0 14px; padding: 10px 11px; border-radius: var(--co-radius-control);
  background: color-mix(in srgb, var(--green) 7%, var(--surface));
}
.co-label-outcome.needs-attention {
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-label-outcome > strong { font-size: var(--co-text-meta); line-height: 1.35; }
.co-label-outcome-row {
  display: flex; align-items: flex-start; gap: 10px; color: var(--muted);
  font-size: var(--co-text-meta); line-height: 24px;
}
.co-label-outcome-row > span { flex: 0 0 92px; white-space: nowrap; }
.co-label-outcome-row > div { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.co-label-outcome-note,
.co-label-outcome-guidance {
  margin: 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.45;
  overflow-wrap: anywhere;
}
.co-label-outcome-guidance { color: var(--text); }
/* One calm reassurance line above the diff, backed by the source-only
   allowlist. Muted, not a banner — it states what is already guaranteed. */
.co-review-assurance {
  align-self: stretch; margin: 0; font-size: var(--co-text-meta); line-height: 1.5;
  color: var(--muted);
}
.co-review-changes-head { align-self: stretch; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 2px 0 8px; }
.co-review-changes-head strong { font-size: var(--co-text-meta); }
.co-review-changes-head span {
  flex: 0 0 auto; max-width: 62%; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; padding: 4px 8px; border-radius: var(--co-radius-round);
  background: var(--surface-2, var(--surface)); color: var(--muted);
  font-size: var(--co-text-meta); font-weight: 650; line-height: 1.2;
}
.co-pr-metadata { align-self: stretch; width: 100%; margin-top: 12px; border-top: 1px solid var(--border); }
.co-pr-metadata > summary { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 8px; list-style: none; color: var(--muted); font-size: var(--co-text-meta); font-weight: 650; cursor: pointer; }
.co-pr-metadata > summary::-webkit-details-marker { display: none; }
.co-pr-metadata > summary .co-icon { transition: transform .16s ease; }
.co-pr-metadata[open] > summary .co-icon { transform: rotate(180deg); }
.co-pr-metadata-body { padding-bottom: 4px; }
.co-review-section {
  align-self: stretch; display: flex; flex-direction: column; gap: 8px;
}
.co-review-section-title {
  font-size: var(--co-text-meta); font-weight: 650; color: var(--muted);
}
.co-markdown {
  align-self: stretch; min-width: 0;
  font-size: var(--co-text-meta); line-height: 1.58; color: var(--text);
  overflow-wrap: anywhere;
}
.co-markdown > * { margin: 0; }
.co-markdown > * + * { margin-top: 9px; }
.co-markdown h1,
.co-markdown h2,
.co-markdown h3 {
  font-size: var(--co-text-meta); line-height: 1.35; font-weight: 700; text-wrap: balance;
}
.co-markdown ul,
.co-markdown ol { padding-left: 20px; }
.co-markdown li + li { margin-top: 4px; }
.co-markdown a { color: var(--accent); }
.co-markdown code {
  font-family: var(--mono, var(--font)); font-size: var(--co-text-meta);
  padding: 1px 5px; border-radius: var(--co-radius-pill);
  background: color-mix(in srgb, var(--text) 9%, transparent);
}
.co-markdown pre {
  overflow: auto; padding: 10px 12px; border-radius: var(--co-radius-field);
  border: 1px solid var(--border); background: var(--surface-2, var(--bg));
}
.co-markdown pre code {
  display: block; padding: 0; background: transparent; white-space: pre;
}
.co-markdown blockquote {
  margin: 0; padding: 0 0 0 12px; border-left: 1px solid var(--border);
  color: var(--muted);
}
/* Before/after screenshots usually arrive in a table: columns share the card
   width and every image scales down to its cell, on a phone too. */
.co-markdown table {
  width: 100%; table-layout: fixed; border-collapse: collapse;
}
.co-markdown th,
.co-markdown td {
  padding: 6px; border: 1px solid var(--border);
  text-align: left; vertical-align: top;
}
.co-markdown img { max-width: 100%; height: auto; }
.co-markdown-shot {
  display: block; border: 1px solid var(--border); border-radius: var(--co-radius-field);
  background: var(--surface-2, var(--surface));
}
.co-markdown-shot-pending {
  display: flex; align-items: center; justify-content: center;
  min-height: 72px; padding: 10px 12px; border-radius: var(--co-radius-field);
  border: 1px dashed var(--border); background: var(--surface-2, var(--surface));
  color: var(--muted); font-size: var(--co-text-meta); line-height: 1.4; text-align: center;
}
.co-shot-note {
  margin: 0; font-size: var(--co-text-meta); line-height: 1.45; color: var(--muted);
}
/* Stored contribution totals frame the canonical diff viewer, whose
   disclosures and line styles are injected by ui/diff. */
.co-files {
  align-self: stretch;
  border: 1px solid var(--border); border-radius: var(--co-radius-control); overflow: hidden;
  background: var(--surface);
}
.co-files-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 40px; padding: 9px 12px; border-bottom: 1px solid var(--border);
  background: var(--surface-2, var(--bg));
  font-family: var(--mono, var(--font)); font-size: var(--co-text-meta);
}
.co-files-count { color: var(--muted); font-weight: 650; }
.co-file-stat {
  display: inline-flex; align-items: baseline; gap: 6px;
  font-family: var(--mono, var(--font)); font-size: var(--co-text-meta);
}
.co-file-add { color: var(--green); font-weight: 650; }
.co-file-del { color: var(--danger); font-weight: 650; }
.co-files-note {
  margin: 0; padding: 9px 12px; border-top: 1px solid var(--border);
  font-size: var(--co-text-meta); line-height: 1.45; color: var(--muted);
}

.co-review-link {
  display: inline-flex; align-items: center; min-height: 44px;
  margin-block: -7px; padding-block: 7px; font-size: var(--co-text-meta); color: var(--accent);
}
/* Compact card footer: details stay readable while the three familiar actions
   remain real 44px tap targets instead of stretching into unlabeled bars. */
.co-card-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-top: 11px; padding-top: 9px; border-top: 1px solid var(--border);
}
.co-card-footer.is-actions-only { justify-content: flex-end; }
.co-card-footer.is-reconciliation {
  align-items: stretch; flex-direction: column;
}
.co-card-footer.is-reconciliation .co-details-toggle { align-self: flex-start; }
.co-card-footer.is-reconciliation .co-action-block { width: 100%; align-items: stretch; }
.co-action-block {
  min-width: 0; display: flex; flex: 0 1 auto; flex-direction: column;
  align-items: flex-end; gap: 7px;
}
.co-details-toggle { display: inline-flex; align-items: center; gap: 5px; margin: -7px 0; padding: 7px 4px; }
.co-details-toggle > span:last-child {
  display: inline-flex; transition: transform .16s ease;
}
.co-details-toggle > span:last-child.is-open { transform: rotate(180deg); }
.co-review-actions {
  align-self: auto; display: flex; align-items: center; justify-content: flex-end;
  flex-wrap: wrap; gap: 7px; margin-left: auto;
}
.co-send-btn { min-width: 76px; gap: 7px; }
.co-refresh-btn { min-width: 132px; gap: 7px; }
.co-secondary-action { gap: 7px; }
.co-review-btn { min-width: 92px; gap: 7px; }
.co-icon { display: block; pointer-events: none; }
.co-action-label { position: relative; display: inline-block; white-space: nowrap; }
.co-action-label-sweep { display: none; }
@media (prefers-reduced-motion: no-preference) {
  @supports ((-webkit-mask-image: linear-gradient(#000, #000)) or (mask-image: linear-gradient(#000, #000))) {
    .is-sending .co-action-label-sweep {
      display: block; position: absolute; inset: 0; overflow: hidden;
      pointer-events: none; white-space: nowrap;
      color: color-mix(in srgb, var(--text) 88%, var(--accent));
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 32%, transparent 50%);
      mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 32%, transparent 50%);
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      -webkit-mask-size: 300% 100%; mask-size: 300% 100%;
      animation: co-action-sweep 2.4s steps(48, end) infinite;
    }
    .co-btn-primary.is-sending .co-action-label-sweep {
      color: color-mix(in srgb, var(--accent-fg) 86%, white);
    }
  }
}
@keyframes co-action-sweep {
  0% { -webkit-mask-position: 120% 0; mask-position: 120% 0; }
  42% { -webkit-mask-position: -50% 0; mask-position: -50% 0; }
  100% { -webkit-mask-position: -50% 0; mask-position: -50% 0; }
}
@media (forced-colors: active) {
  .co-action-label-sweep { display: none !important; }
}
/* Two-tap confirmation before a consequential lifecycle action. History is
   reversible; bot withdrawal is not, so both keep the safe choice focused. */
.co-confirm {
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border-radius: var(--co-radius-control);
  border: 1px solid color-mix(in srgb, var(--co-warn) 34%, var(--border));
  background: color-mix(in srgb, var(--co-warn) 7%, var(--surface));
}
.co-published-action {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.co-published-action .co-review-error {
  flex: 1 0 100%;
  margin: 0;
}
.co-card > .co-confirm { margin-top: 12px; }
.co-confirm-text { margin: 0; font-size: var(--co-text-meta); line-height: 1.45; color: var(--text); }
.co-confirm-actions { display: flex; gap: 8px; }
.co-confirm-actions .co-btn { flex: 1 1 0; min-width: 0; }
.co-confirm.is-safe {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
/* Restore lives on an archived card in History — a single, content-width button. */
.co-history-actions { display: flex; gap: 8px; margin-top: 2px; }
.co-publication-action {
  display: flex; flex-direction: column; align-items: flex-start; gap: 5px;
  margin: 10px 0 2px; padding: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  border-radius: var(--co-radius-control);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-publication-action > span {
  color: var(--accent); font-size: var(--co-text-meta); font-weight: 750;
  letter-spacing: .055em; line-height: 1.2; text-transform: uppercase;
}
.co-publication-action > strong {
  color: var(--text); font-size: var(--co-text-meta); line-height: 1.4;
}
.co-publication-action > p:not(.co-review-error) {
  margin: 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.48;
}
.co-publication-action > .co-btn { margin-top: 4px; }
.co-publication-action.is-connected {
  border-color: color-mix(in srgb, var(--green) 35%, var(--border));
  background: color-mix(in srgb, var(--green) 7%, var(--surface));
}
.co-publication-action.is-connected > span { color: var(--green); }
.co-publication-action.has-conflicts {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-publication-action.has-conflicts > span { color: var(--accent); }
.co-review-note {
  margin: 0; font-size: var(--co-text-meta); line-height: 1.5; color: var(--muted);
  user-select: text; -webkit-user-select: text; cursor: text;
}
.co-review-error {
  margin: 0; font-size: var(--co-text-meta); line-height: 1.5; color: var(--danger);
  white-space: pre-wrap; overflow-wrap: anywhere;
  user-select: text; -webkit-user-select: text; cursor: text;
}
.co-autopilot {
  margin: 8px 0; padding: 10px 12px; border-radius: var(--co-radius-control);
  border: 1px solid var(--border); background: var(--surface-2, var(--surface));
}
.co-autopilot.is-escalated { border-color: var(--danger); }
.co-autopilot.is-responding { border-color: var(--accent, #3b7); }
.co-autopilot-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.co-autopilot-badge { font-size: var(--co-text-meta); font-weight: 600; }
.co-autopilot-toggle { display: inline-flex; align-items: center; padding: 6px 12px; }
.co-autopilot-line { margin: 6px 0 0; font-size: var(--co-text-meta); line-height: 1.5; }
.co-autopilot-error { margin: 6px 0 0; font-size: var(--co-text-meta); color: var(--danger); }
.co-autopilot-rounds { margin: 8px 0 0; padding: 0; list-style: none; }
.co-autopilot-rounds li {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;
  font-size: var(--co-text-meta); padding: 3px 0; border-top: 1px solid var(--border);
}
.co-autopilot-round-label { font-weight: 600; }
.co-autopilot-round-summary { color: var(--muted); overflow-wrap: anywhere; }
.co-autopilot-round-when { margin-left: auto; color: var(--muted); }

/* One Contribution Run. The ledger remains the source of truth; this surface
   only orders its current decisions, motion, and recent outcomes. */
.co-run {
  width: min(100%, 1120px); margin-inline: auto; padding: 10px 0 34px;
}
.co-run-head {
  margin: 0 0 14px;
}
.co-run-head > div > small {
  display: block; margin-bottom: 4px; color: var(--muted);
  font-size: var(--co-text-meta); font-weight: 720; letter-spacing: .055em;
  text-transform: uppercase;
}
.co-run-head h2 {
  margin: 0; font-size: var(--co-text-title); line-height: 1.14;
  letter-spacing: -.035em; text-wrap: balance;
}
.co-run-head p {
  max-width: 58ch; margin: 7px 0 0; color: var(--muted);
  font-size: var(--co-text-meta); line-height: 1.5; text-wrap: pretty;
}
.co-run-primary {
  display: grid; grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center; gap: 12px; min-height: 92px; margin-bottom: 10px;
  padding: 13px 14px; border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));
  border-radius: var(--co-radius-panel); background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-run-primary.is-ready {
  border-color: color-mix(in srgb, var(--green) 34%, var(--border));
  background: color-mix(in srgb, var(--green) 5%, var(--surface));
}
.co-run-primary-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: var(--co-radius-panel);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface)); color: var(--accent);
}
.co-run-primary.is-ready .co-run-primary-mark {
  background: color-mix(in srgb, var(--green) 12%, var(--surface)); color: var(--green);
}
.co-run-primary > div { min-width: 0; }
.co-run-primary small {
  display: block; margin-bottom: 2px; color: var(--accent); font-size: var(--co-text-meta);
  font-weight: 750; letter-spacing: .045em; text-transform: uppercase;
}
.co-run-primary.is-ready small { color: var(--green); }
.co-run-primary strong { display: block; font-size: var(--co-text-body); line-height: 1.35; text-wrap: pretty; }
.co-run-primary p { margin: 3px 0 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.4; }
.co-run-primary > .co-btn { min-width: 112px; }
.co-run-error { color: var(--danger) !important; }
.co-run-approval {
  margin-bottom: 12px; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: var(--co-radius-panel); background: var(--surface);
}
.co-run-approval > header { padding: 14px 14px 11px; }
.co-run-approval > header small {
  color: var(--accent); font-size: var(--co-text-meta); font-weight: 750;
  letter-spacing: .05em; text-transform: uppercase;
}
.co-run-approval h3 { margin: 3px 0 0; font-size: var(--co-text-body); line-height: 1.35; }
.co-run-approval header p { margin: 4px 0 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.45; }
.co-run-approval-list {
  max-height: min(46vh, 380px); margin: 0; padding: 0; overflow: auto;
  list-style: none; border-block: 1px solid var(--border); scrollbar-width: thin;
}
.co-run-approval-list li {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px;
  padding: 9px 14px; background: var(--bg);
}
.co-run-approval-list li + li { border-top: 1px solid var(--border); }
.co-run-approval-list li > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-run-approval-list strong {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--co-text-meta); line-height: 1.35;
}
.co-run-approval-list small { color: var(--muted); font-size: var(--co-text-meta); }
.co-run-approval-list em { color: var(--muted); font-size: var(--co-text-meta); font-style: normal; white-space: nowrap; }
.co-run-approval-list code {
  grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--muted); font-size: var(--co-text-meta);
}
.co-run-approval-list li > button {
  grid-column: 2; justify-self: end; min-height: 44px; display: inline-flex;
  align-items: center; padding: 0; border: 0; background: transparent;
  color: var(--accent); cursor: pointer; font: inherit; font-size: var(--co-text-meta); font-weight: 700;
}
.co-run-approval-actions { display: flex; justify-content: flex-end; gap: 7px; padding: 11px 14px; }
.co-run-approval-actions .co-btn { min-width: 104px; }
.co-run-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; gap: 8px; min-height: 64px; padding: 7px 9px 7px 11px;
}
.co-run-row + .co-run-row { border-top: 1px solid var(--border); }
.co-run-row-main {
  min-width: 0; min-height: 48px; display: grid;
  grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 9px;
  padding: 0; border: 0; background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer;
}
.co-run-row-icon { width: 32px; height: 32px; border-radius: var(--co-radius-control); }
.co-run-row-main > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-run-row-main strong {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--co-text-meta); line-height: 1.35;
}
.co-run-row-main small {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--muted); font-size: var(--co-text-meta);
}
.co-run-row-main > .co-icon { color: var(--muted); transition: transform .14s ease; }
.co-run-row-main em {
  padding: 4px 6px; border-radius: var(--co-radius-round); background: var(--surface-2, var(--bg));
  color: var(--muted); font-size: var(--co-text-meta); font-style: normal; font-weight: 700; white-space: nowrap;
}
.co-run-row.is-publish .co-run-row-main em { color: var(--green); }
.co-run-row.is-public_attention .co-run-row-main em { color: var(--co-warn); }
.co-run-row-action { min-width: 62px; padding: 0 9px; white-space: nowrap; }
.co-run-row > .co-agent-handoff { min-width: 0; }
.co-run-row > .co-agent-handoff .co-run-row-action { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.co-run-row > .co-agent-handoff-error,
.co-run-row-error { grid-column: 1 / -1; margin: 0; color: var(--danger); font-size: var(--co-text-meta); }
.co-run-empty {
  min-height: 78px; display: grid; grid-template-columns: 28px minmax(0, 1fr);
  align-items: center; gap: 2px 10px; padding: 12px 13px;
  border: 1px solid var(--border); border-radius: var(--co-radius-panel); background: var(--surface);
}
.co-run-empty > .co-icon { grid-row: 1 / 3; color: var(--muted); }
.co-run-empty strong { font-size: var(--co-text-meta); }
.co-run-empty span { color: var(--muted); font-size: var(--co-text-meta); line-height: 1.4; }
.co-run-empty.is-clear > .co-icon, .co-run-empty.is-clear strong { color: var(--green); }
.co-run-fold {
  margin-top: 12px; border: 1px solid var(--border); border-radius: var(--co-radius-panel);
  background: color-mix(in srgb, var(--surface) 72%, transparent); overflow: hidden;
}
.co-run-fold > summary {
  min-height: 44px; display: grid; grid-template-columns: minmax(0, 1fr) auto 14px;
  align-items: center; gap: 8px; padding: 0 12px; cursor: pointer;
  color: var(--muted); font-size: var(--co-text-meta); font-weight: 650; list-style: none;
}
.co-run-fold > summary::-webkit-details-marker { display: none; }
.co-run-fold > summary b {
  min-width: 19px; padding: 3px 5px; border-radius: var(--co-radius-round);
  background: var(--surface-2, var(--bg)); font-size: var(--co-text-meta); text-align: center;
}
.co-run-fold > summary .co-icon { transition: transform .16s ease; }
.co-run-fold[open] > summary .co-icon { transform: rotate(180deg); }
.co-run-fold > div { border-top: 1px solid var(--border); }
.co-run-quiet-row {
  width: 100%; min-height: 48px; display: grid;
  grid-template-columns: 8px minmax(0, 1fr) 14px; align-items: center; gap: 9px;
  padding: 7px 12px; border: 0; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.co-run-quiet-row + .co-run-quiet-row { border-top: 1px solid var(--border); }
.co-run-dot { width: 7px; height: 7px; border-radius: var(--co-radius-round); background: var(--muted); opacity: .55; }
.co-run-dot.is-review_in_progress, .co-run-dot.is-publishing, .co-run-dot.is-autopilot, .co-run-dot.is-connecting { background: var(--accent); opacity: .85; }
.co-run-dot.is-recent { background: var(--green); opacity: .8; }
.co-run-quiet-row > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.co-run-quiet-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--co-text-meta); }
.co-run-quiet-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: var(--co-text-meta); }
.co-run-quiet-row > .co-icon { color: var(--muted); }
.co-run-maintenance { margin: 10px 2px 0; color: var(--muted); font-size: var(--co-text-meta); }
.co-run-focus { padding-top: 2px; }
.co-run-focus > .co-focus-back { margin-bottom: 8px; }
.co-run-focus-layout { display: block; }
.co-run-focus-detail { min-width: 0; }
.co-run-ready-focus {
  padding: 13px; border: 1px solid color-mix(in srgb, var(--green) 35%, var(--border));
  border-radius: var(--co-radius-panel); background: color-mix(in srgb, var(--green) 6%, var(--surface));
}
.co-run-ready-focus > small { color: var(--green); font-size: var(--co-text-meta); font-weight: 750; text-transform: uppercase; }
.co-run-ready-focus h3 { margin: 3px 0 0; font-size: var(--co-text-meta); }
.co-run-ready-focus p { margin: 5px 0 10px; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.45; }
.co-run-focus-summary {
  padding: 14px; border: 1px solid var(--border); border-radius: var(--co-radius-panel);
  background: var(--surface);
}
.co-run-focus-summary > small {
  display: block; color: var(--accent); font-size: var(--co-text-meta); font-weight: 750;
  letter-spacing: .045em; text-transform: uppercase;
}
.co-run-focus-summary h3 { margin: 3px 0 0; font-size: var(--co-text-body); line-height: 1.35; }
.co-run-focus-summary p { margin: 5px 0 0; color: var(--muted); font-size: var(--co-text-meta); line-height: 1.45; }
.co-run-focus-summary > .co-btn,
.co-run-focus-summary > .co-review-link { margin-top: 10px; }
.co-run-focus-summary.is-public_attention,
.co-run-focus-summary.is-ready_attention,
.co-run-focus-summary.is-route_attention {
  border-color: color-mix(in srgb, var(--co-warn) 38%, var(--border));
}
.co-run-source-choices,
.co-run-focus-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.co-run-source-choices small { flex-basis: 100%; }
.co-run-stack-records { display: grid; gap: 9px; margin-top: 9px; }
.co-run-stack-records > div { min-width: 0; }
.co-project-view-actions { display: flex; align-items: center; gap: 12px; }

@media (hover: hover) {
  .co-run-row:hover, .co-run-quiet-row:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
  .co-run-row-main:hover > .co-icon { transform: translateX(2px); }
  .co-run-projects button:hover { color: var(--text); }
  .co-run-focus-list > button:hover { background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
}

/* Legacy detail components remain shared by the focused Run. */
.co-contributions-view { width: 100%; }
.co-run.co-run-focus { width: 100%; }
.co-review-project + .co-review-project { border-top: 1px solid var(--border); }
.co-review-project > header {
  min-height: 40px; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center; gap: 8px; padding: 8px 13px;
  background: var(--surface-2, var(--surface));
}
.co-review-project > header .co-project-icon { width: 22px; height: 22px; border-radius: var(--co-radius-field); }
.co-review-project > header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--co-text-meta); }
.co-review-project > header span { color: var(--muted); font-size: var(--co-text-meta); font-variant-numeric: tabular-nums; }
.co-review-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  gap: 12px; width: 100%; min-height: 67px; padding: 11px 14px;
  border: 0; border-top: 1px solid var(--border); background: transparent;
  color: var(--text); font: inherit; text-align: left;
}
.co-review-row.is-compact { min-height: 58px; }
.co-review-row-main {
  min-width: 0; min-height: 44px; padding: 0; border: 0; background: transparent;
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.co-review-row-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.co-review-row-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--co-text-meta); line-height: 1.35; }
.co-review-row-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: var(--co-text-meta); }
.co-review-state {
  padding: 4px 7px; border-radius: var(--co-radius-round); background: var(--surface-2, var(--bg));
  color: var(--muted); font-size: var(--co-text-meta); font-weight: 690; white-space: nowrap;
}
.co-review-state.is-action { color: var(--co-warn); }
.co-review-state.is-working { color: var(--accent); }
.co-review-state.is-clear { color: color-mix(in srgb, var(--green) 78%, var(--text)); }
.co-review-default {
  position: relative; min-width: 64px; min-height: 36px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: var(--co-radius-field); background: transparent;
  color: var(--muted); font: inherit; font-size: var(--co-text-meta); font-weight: 680; cursor: pointer;
}
.co-review-default::before { content: ''; position: absolute; inset: -4px 0; }
.co-review-default.is-primary {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: color-mix(in srgb, var(--accent) 78%, var(--text));
}
.co-review-default:disabled { opacity: .58; cursor: default; }
.co-focus-unit { display: flex; flex-direction: column; gap: 10px; }
.co-decision-surface {
  padding: 0; border: 0; background: transparent;
}
.co-decision-surface > .co-alert,
.co-decision-surface > .co-attention,
.co-decision-surface > .co-publication-action,
.co-decision-surface > .co-published-action { margin: 0; }
.co-decision-surface > .co-alert + .co-action-block,
.co-decision-surface > .co-attention + .co-action-block { margin-top: 10px; }
.co-focus-view > .co-card { margin-top: 0; }

/* Requests is an owner decision inbox, deliberately warmer and more spacious
   than the review pipeline. The stage rail already names and counts each lens. */
.co-request-list { display: flex; flex-direction: column; gap: 9px; }
.co-request-card {
  display: grid; grid-template-columns: 38px minmax(0, 1fr) auto 15px;
  align-items: center; gap: 12px; width: 100%; min-height: 96px; padding: 14px;
  border: 1px solid var(--border); border-radius: var(--co-radius-panel); background: var(--surface);
  color: var(--text); font: inherit; text-align: left; cursor: pointer;
  transition: border-color .14s ease, background .14s ease, transform .12s ease;
}
.co-request-card.is-history { min-height: 76px; padding-block: 10px; }
.co-request-card.is-history .co-request-copy { gap: 3px; }
.co-request-project { width: 38px; height: 38px; border-radius: var(--co-radius-panel); }
.co-request-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.co-request-copy small { color: var(--muted); font-size: var(--co-text-meta); font-weight: 650; }
.co-request-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--co-text-meta); line-height: 1.35; }
.co-request-copy > span {
  display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; overflow-wrap: anywhere;
  color: var(--muted); font-size: var(--co-text-meta); line-height: 1.4;
}
.co-request-card em { padding: 4px 7px; border-radius: var(--co-radius-round); background: var(--surface-2, var(--bg)); color: var(--muted); font-size: var(--co-text-meta); font-style: normal; font-weight: 700; }
.co-request-card em.is-action { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.co-request-card em.is-open { color: var(--green); }
.co-request-card > .co-icon { color: var(--muted); }
.co-request-focus { width: min(100%, 700px); }
.co-request-history {
  min-height: 44px; padding: 8px 2px; border: 0; background: transparent;
  color: var(--muted); font: inherit; font-size: var(--co-text-meta); cursor: pointer;
}
.co-list-continuation {
  display: grid; grid-template-columns: minmax(0, 1fr) auto 16px;
  align-items: center; gap: 8px; width: 100%; min-height: 44px;
  margin-top: 8px; padding: 8px 12px; border: 0; border-radius: var(--co-radius-control);
  background: transparent; color: var(--muted); font: inherit;
  text-align: left; cursor: pointer;
}
.co-list-continuation > span { color: var(--text); font-size: var(--co-text-meta); font-weight: 650; }
.co-list-continuation > small { font-size: var(--co-text-meta); font-variant-numeric: tabular-nums; }
.co-list-continuation > .co-icon { transform: rotate(0); }
@media (hover: hover) {
  .co-review-row:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
  .co-review-default:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); color: var(--text); }
  .co-request-card:hover { border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); background: color-mix(in srgb, var(--accent) 3%, var(--surface)); transform: translateY(-1px); }
  .co-request-history:hover { color: var(--text); }
  .co-list-continuation:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
}

/* mobius-ui:Empty v1 — app-owned copy; library candidate. */
.co-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center; gap: 8px;
  min-height: 46dvh; max-width: 440px; margin: 0 auto; padding: 40px 24px;
  color: var(--muted);
}
.co-empty-mark {
  width: 64px; height: 64px; margin-bottom: 10px; border-radius: var(--co-radius-panel);
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.co-empty-title { margin: 0; font-size: var(--co-text-body); font-weight: 700; color: var(--text); }
.co-empty-text { margin: 0; font-size: var(--co-text-meta); line-height: 1.6; }
/* /mobius-ui:Empty */

@media (max-width: 760px) {
  .co-run-focus-layout { display: block; }
  .co-page.is-sources { padding-bottom: 32px; }
  .co-projects-view { padding-top: 2px; }
  .co-lens-nav { margin-inline: -2px; }
  .co-source-detail { padding: 15px; }
}

@media (max-width: 520px) {
  .co-page { padding-inline: 12px; }
  .co-header { padding-inline: 1px; gap: 7px; }
  .co-header-main { gap: 9px; }
  .co-brand-icon, .co-brand-fallback { width: 32px; height: 32px; }
  .co-title { font-size: var(--co-text-body); }
  .co-toolbar { gap: 3px; }
  .co-toolbar-check { width: 32px; padding: 0; justify-content: center; }
  /* Sync and Settings keep a word on a phone: an icon alone is not a label (DESIGN.md). */
  .co-toolbar .co-label-long, .co-sync-note { display: none; }
  .co-toolbar .co-label-short { display: inline; }
  .co-toolbar-refresh { min-width: 40px; justify-content: center; }
  .co-project-control { max-width: 108px; padding-inline: 8px; }
  .co-project-control > span { overflow: hidden; text-overflow: ellipsis; }
  .co-project-control b { display: none; }
  .co-github-menu { max-width: 148px; min-height: 44px; padding-inline: 9px; }
  .co-github-menu > span { font-size: var(--co-text-meta); }
  .co-offline-note { margin-left: 41px; }
  .co-run { padding-top: 5px; }
  .co-run-head { margin-bottom: 10px; }
  .co-run-head h2 { font-size: var(--co-text-section); }
  .co-run-head p { font-size: var(--co-text-meta); }
  .co-run-private { grid-template-columns: 32px minmax(0, 1fr); align-items: start; padding: 10px; }
  .co-run-private > span { width: 32px; height: 32px; }
  .co-run-private-actions { grid-column: 1 / -1; padding-left: 42px; }
  .co-run-private-items { grid-column: 1 / -1; }
  .co-run-primary {
    grid-template-columns: 36px minmax(0, 1fr); align-items: start;
    gap: 10px; min-height: 0; padding: 12px;
  }
  .co-run-primary-mark { width: 36px; height: 36px; }
  .co-run-primary > .co-btn { grid-column: 1 / -1; width: 100%; margin-top: 2px; }
  .co-run-approval > header { padding: 12px; }
  .co-run-approval-list li { grid-template-columns: minmax(0, 1fr); padding: 9px 12px; }
  .co-run-approval-list em { white-space: normal; }
  .co-run-approval-list li > button { grid-column: 1; justify-self: start; }
  .co-run-approval-actions { display: grid; grid-template-columns: 1fr 1fr; padding: 10px 12px; }
  .co-run-approval-actions .co-btn { min-width: 0; }
  .co-run-row { min-height: 69px; padding: 8px; }
  .co-run-row-main { grid-template-columns: 30px minmax(0, 1fr); gap: 8px; }
  .co-run-row-icon { width: 30px; height: 30px; }
  .co-run-row-main em { grid-column: 2; width: max-content; }
  .co-run-row-main strong {
    display: block; white-space: normal; overflow-wrap: anywhere;
  }
  .co-run-row-main small { white-space: normal; }
  .co-run-row-action { min-width: 64px; min-height: 44px; padding-inline: 8px; }
  .co-run-projects { align-items: flex-start; flex-direction: column; gap: 0; }
  .co-project-view-actions { align-items: flex-end; flex-direction: column; gap: 0; }
  .co-tabs { gap: 13px; margin-top: 2px; margin-bottom: 18px; overflow-x: auto; scrollbar-width: none; }
  .co-tabs::-webkit-scrollbar { display: none; }
  .co-tabs button { flex: 0 0 auto; padding-inline: 1px; font-size: var(--co-text-meta); }
  .co-tabs button span { min-width: 17px; height: 17px; margin-left: 3px; font-size: var(--co-text-meta); }
  .co-view-heading { gap: 14px; margin-bottom: 12px; }
  .co-view-heading p { margin-top: 5px; font-size: var(--co-text-meta); }
  .co-project-view-actions .co-btn-quiet { width: 44px; padding-inline: 0; justify-content: center; font-size: 0; }
  .co-lens-nav { gap: 8px; margin-bottom: 20px; }
  .co-lens-nav button { gap: 5px; min-height: 41px; padding-bottom: 9px; font-size: var(--co-text-meta); }
  .co-stage-intro { align-items: flex-start; min-height: 0; margin-bottom: 11px; padding-bottom: 13px; }
  .co-stage-intro h3 { font-size: var(--co-text-body); }
  .co-stage-intro p { font-size: var(--co-text-meta); }
  .co-project-index, .co-review-list { border-radius: var(--co-radius-panel); }
  .co-source-group-label { padding-inline: 11px; }
  .co-source-row { min-height: 106px; padding: 18px 0; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 2px 9px; }
  .co-source-glyph { width: 34px; height: 34px; }
  .co-source-row-facts { align-items: flex-start; white-space: normal; line-height: 1.35; }
  .co-source-row-facts > span {
    display: block; white-space: normal; overflow-wrap: anywhere;
  }
  .co-source-row-facts > small { display: block; }
  .co-source-detail { padding: 0; }
  .co-project-handoff { align-items: stretch; flex-direction: column; }
  .co-project-handoff .co-agent-handoff .co-btn { width: 100%; }
  .co-project-handoff .co-agent-handoff-error { max-width: none; text-align: left; }
  .co-review-row { min-height: 72px; padding: 10px 11px; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .co-review-row.is-compact { min-height: 64px; }
  .co-review-row-copy strong {
    display: block; white-space: normal; overflow-wrap: anywhere;
  }
  .co-review-state { padding-inline: 5px; font-size: var(--co-text-meta); }
  .co-review-default { min-width: 58px; padding-inline: 8px; font-size: var(--co-text-meta); }
  .co-cycle-card { grid-template-columns: 36px minmax(0, 1fr); align-items: start; padding: 12px 11px; }
  .co-cycle-mark { width: 36px; height: 36px; }
  .co-cycle-actions { grid-column: 1 / -1; justify-content: flex-start; flex-wrap: wrap; padding-left: 48px; }
  .co-cycle-progress { align-items: flex-start; flex-direction: column; gap: 5px; }
  .co-cycle-progress > span { width: min(100%, 210px); }
  .co-request-card { min-height: 80px; padding: 11px; grid-template-columns: 36px minmax(0, 1fr) 14px; gap: 10px; }
  .co-request-project { width: 36px; height: 36px; }
  .co-request-copy strong {
    display: block; white-space: normal; overflow-wrap: anywhere;
  }
  .co-request-card em { display: none; }
  .co-request-copy > span { display: none; }
  .co-card { padding: 13px; }
  .co-plan-meta { gap: 4px; font-size: var(--co-text-meta); }
  .co-plan-meta.has-branch .co-plan-meta-repo {
    max-width: 36%; overflow: hidden; text-overflow: ellipsis;
  }
  .co-card.is-blocked .co-card-footer { align-items: stretch; flex-direction: column; }
  .co-card.is-blocked .co-details-toggle { align-self: flex-start; }
  .co-card.is-blocked .co-action-block,
  .co-card.is-blocked .co-review-actions { width: 100%; }
  .co-card.is-blocked .co-refresh-btn { flex: 1 1 auto; }
  .co-focus-view .co-card-footer { align-items: stretch; flex-direction: column; }
  .co-focus-view .co-details-toggle { align-self: flex-start; }
  .co-focus-view .co-action-block,
  .co-focus-view .co-review-actions { width: 100%; }
  .co-focus-view .co-review-actions {
    display: grid; grid-template-columns: minmax(112px, 1fr) auto auto;
    align-items: center; gap: 7px; margin: 0;
  }
  .co-focus-view .co-review-btn,
  .co-focus-view .co-send-btn { width: 100%; min-width: 0; }
  .co-focus-view .co-secondary-action { width: auto; flex: 0 0 auto; padding-inline: 11px; }
  .co-card-footer:has(.co-confirm) { align-items: stretch; flex-direction: column; }
  .co-card-footer:has(.co-confirm) .co-details-toggle { align-self: flex-start; }
  .co-action-block:has(.co-confirm) { width: 100%; align-items: stretch; }
  .co-action-block .co-review-note,
  .co-action-block .co-review-error { width: 100%; }
  .co-agent-started { align-items: flex-start; flex-direction: column; }
  .co-agent-chat-link { min-height: 36px; padding-inline: 0; }
  .co-attention { flex-direction: column; align-items: stretch; }
}


/* mobius-ui:CenteredRail v1 */
@media (min-width: 900px) {
  .co-header-shell { width: min(100%, 1040px); margin-inline: auto; }
}
/* /mobius-ui:CenteredRail */

/* PR work stays inside its project; selection reveals the batch action. */
.co-workflow-option { display:flex; align-items:center; gap:12px; min-height:44px; margin:8px 0; font-size:var(--co-text-body); cursor:pointer; }
.co-workflow-option input { width:20px; height:20px; accent-color:var(--accent); }
.co-pr-detail > summary { cursor:pointer; list-style:none; min-height:44px; }
.co-pr-detail > summary::-webkit-details-marker { display:none; }
.co-pr-workspace { margin: 16px 0 24px; border-block: 1px solid var(--border); }
.co-pr-workspace > summary { display:flex; align-items:center; flex-wrap:wrap; gap:8px 16px; min-height:52px; cursor:pointer; font-size:var(--co-text-body); font-weight:650; }
.co-pr-note { color:var(--muted); font-size:var(--co-text-meta); font-weight:400; }
.co-pr-link { color:var(--accent); font-size:var(--co-text-meta); min-height:44px; display:inline-flex; align-items:center; }
@media (max-width:560px) { .co-pr-context { margin-left:0; width:100%; } .co-pr-workspace > summary { padding:10px 0; } }
/* Precision workbench pass: contribution work stays easy to scan and decide on
   the DESIGN.md readable floor (body 16, label 14/650, row-title 17/600,
   button 14/500), without changing its existing accent or status colours. */
.co-root { letter-spacing: -0.004em; }
.co-page { width: min(100%, 1100px); padding-inline: 24px; }
.co-header { width: min(100%, 1100px); min-height: 78px; padding: max(20px, env(safe-area-inset-top)) 24px 14px; }
.co-title { font-size: var(--co-text-title); font-weight: 680; letter-spacing: -0.045em; }
.co-project-control { border-radius: var(--co-radius-field); font-weight: 650; }
.co-view-heading { margin-bottom: 22px; }
.co-view-heading h2 { font-size: var(--co-text-title); font-weight: 680; letter-spacing: -.045em; }
.co-card { border-radius: var(--co-radius-panel); padding: 17px 18px; margin-top: 10px; box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 5%, transparent); }
.co-card.is-blocked { border-width: 1px; }
.co-card-title { font-size: var(--co-text-body); font-weight: 680; letter-spacing: -.018em; line-height: 1.38; }
.co-card-meta { margin-top: 10px; }
.co-run-row { padding-block: 15px; }
.co-run-row-main strong { font-weight: 680; letter-spacing: -.012em; }
.co-pr-workspace { margin-top: 20px; }
@media (max-width: 680px) { .co-view-heading h2 { font-size: var(--co-text-title); } }
@media (max-width: 640px) {
  .co-page { padding-inline: 16px; }
  .co-header { min-height: 68px; padding-inline: 16px; padding-bottom: 10px; }
  .co-title { font-size: var(--co-text-section); }
  .co-card { padding: 15px; border-radius: var(--co-radius-control); }
}

${WORKSPACE_CSS}
${BUTTON_CSS}
`
