// Approved continuous project workspace. Theme remains owned by the shell.
export const WORKSPACE_CSS = `
.co-header-shell { width:100%; max-width:none; }
.co-header { position:relative; width:100%; max-width:1192px; padding:8px 36px; border-bottom:0; }
.co-header::after { content:''; position:absolute; left:44px; right:44px; bottom:0; height:1px; background:var(--border); }
.co-title { font-size:var(--co-text-body); font-weight:600; letter-spacing:-.015em; }
.co-brand-icon { width:34px; height:34px; }
.co-header-back { display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:6px 4px; border:0; background:none; color:var(--text); font:600 var(--co-text-body) var(--font); cursor:pointer; }
.co-header-back:hover { color:var(--accent); }
.co-page.is-sources { width:100%; max-width:none; padding:0; overflow:auto; }
.co-projects-view { width:100%; max-width:1192px; margin:auto; padding:20px 36px 64px; }
.co-projects-view.is-focus { height:auto; }
.co-project-layout { display:block; }
.co-workspace { min-width:0; background:var(--bg); }
.co-workspace-head { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:2px 0 12px; }
.co-workspace-title { display:flex; align-items:center; gap:14px; flex:1; min-width:0; }
.co-workspace-title > div { flex:1; min-width:0; }
.co-workspace-name-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.co-workspace-title .co-source-glyph { display:none; }
.co-workspace-title h2 { font-size:var(--co-text-section); font-weight:600; line-height:1.25; letter-spacing:-.025em; margin:0; overflow-wrap:anywhere; }
.co-workspace-title p { display:flex; flex-wrap:wrap; align-items:center; gap:0 12px; font-size:var(--co-text-meta); color:var(--muted); margin:4px 0 0; overflow-wrap:anywhere; }
.co-workspace-body,.co-workspace-inventory { display:block; padding:0; overflow:visible; }
.co-task-content { position:relative; margin:18px 0 24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:var(--co-radius-panel); overflow-wrap:anywhere; outline-offset:4px; }
.co-inline-close { position:absolute; right:12px; top:10px; width:44px; justify-content:center; }
/* The close X shares its row with a pane's heading. A focused contribution
   opens with a notice box instead, so it starts below the X. */
.co-task-content > .co-run-focus-layout { margin-top:36px; }
.co-task-content > h3,.co-task-content > section > h3 { padding-right:32px; }
.co-task-content h3 { font-size:var(--co-text-section); font-weight:600; line-height:1.4; letter-spacing:-.015em; margin:0 0 14px; }
.co-task-content p { font-size:var(--co-text-body); color:var(--muted); line-height:1.6; margin:10px 0 18px; max-width:72ch; }
.co-task-scope { display:flex; flex-wrap:wrap; align-items:center; gap:16px; padding:8px 0; }
.co-task-scope > span { font-size:var(--co-text-meta); color:var(--muted); }
.co-task-primary { margin-top:16px; white-space:normal; width:auto; }
.co-task-content .co-workflow-option { align-items:flex-start; gap:12px; padding:0; border:0; background:none; font-size:var(--co-text-body); margin:16px 0; }
.co-workflow-option small { display:block; margin-top:4px; font-size:var(--co-text-meta); color:var(--muted); line-height:1.55; }
.co-task-content .co-task-footnote { font-size:var(--co-text-meta); margin:10px 0 20px; }
.co-task-details { margin-top:20px; border-top:1px solid var(--border); padding-top:10px; }
.co-task-details summary { min-height:44px; cursor:pointer; color:var(--muted); font-size:var(--co-text-meta); align-content:center; }
.co-task-steps { padding-left:20px; color:var(--muted); font-size:var(--co-text-body); }
.co-task-steps li { padding:5px 0; }
.co-local-work > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
.co-local-work > header h3 { font-size:var(--co-text-body); font-weight:600; margin:0; letter-spacing:-.01em; }
.co-prepare-scope { display:grid; grid-template-columns:minmax(0,1fr) 18px; align-items:center; gap:12px; width:100%; min-height:64px; padding:10px 0; border:0; border-block:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; }
.co-prepare-scope span { min-width:0; }
.co-prepare-scope small,.co-prepare-scope strong { display:block; }
.co-prepare-scope small { color:var(--muted); font-size:var(--co-text-meta); margin-bottom:2px; }
.co-prepare-scope strong { font-size:var(--co-text-body); font-weight:600; }
.co-task-content .co-task-primary { width:100%; justify-content:center; margin-top:18px; }
.co-work-progress-row { display:flex; width:100%; align-items:center; gap:10px; padding:14px 0; background:none; color:var(--accent); border:0; font-size:var(--co-text-body); cursor:pointer; }
.co-work-progress-row > span:not(.co-working-icon) { min-width:0; text-align:left; }
.co-work-progress-row strong,.co-work-progress-row small { display:block; overflow-wrap:anywhere; }
.co-work-progress-row strong { font-size:var(--co-text-body); font-weight:600; color:var(--text); }
.co-work-progress-row small { margin-top:4px; font-size:var(--co-text-meta); line-height:1.5; color:var(--muted); }
.co-work-progress-row > .co-icon:last-child { margin-left:auto; flex-shrink:0; }
.co-working-icon { display:inline-flex; align-items:center; flex:0 0 auto; color:var(--accent); animation:co-work-breathe 1.6s ease-in-out infinite; }
.co-inventory-note { margin:8px 0 14px; max-width:72ch; color:var(--muted); font-size:var(--co-text-meta); line-height:1.55; }
@keyframes co-work-breathe { 0%,100% { opacity:1; } 50% { opacity:.55; } }
@media(prefers-reduced-motion:reduce) { .co-working-icon { animation:none; } }

.co-workspace .co-run { margin-top:32px; padding-top:0; }
.co-workspace .co-run > * { margin-top:16px; }
.co-workspace .co-run > :first-child { margin-top:0; }
.co-workspace .co-run-primary { border:0; border-radius:0; border-bottom:1px solid var(--border); background:none; padding:6px 0; min-height:52px; }
.co-workspace .co-local-summary { display:grid; grid-template-columns:24px minmax(0,1fr) 16px; align-items:center; gap:10px; width:100%; min-height:62px; padding:10px 0; border:0; border-bottom:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; }
.co-workspace .co-local-summary > span { min-width:0; }
.co-workspace .co-local-summary strong,.co-workspace .co-local-summary small { display:block; min-width:0; }
.co-workspace .co-local-summary strong { font-size:var(--co-text-body); line-height:1.35; font-weight:650; }
.co-workspace .co-local-summary small { margin-top:2px; overflow:hidden; color:var(--muted); font-size:var(--co-text-meta); line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
.co-workspace .co-local-summary:hover { color:var(--accent); background:color-mix(in srgb,var(--surface) 65%,transparent); }
.co-workspace .co-run-focus-layout { display:block; }
.co-workspace .co-run-focus-summary { padding:0; background:none; border:0; }
.co-workspace .co-run-focus-summary > small { display:none; }
.co-workspace .co-run-focus-detail { min-width:0; }
.co-workspace .co-run-focus-detail .co-card { border:0; background:none; }
.co-workspace .co-run-fold { border-radius:0; border:0; border-bottom:1px solid var(--border); }
.co-public-work { margin-top:22px; }
/* Non-modal selection shelf; fixed only within this mini-app iframe. */
.co-page.is-sources { padding-bottom:max(var(--co-selection-height,0px),var(--co-task-height,0px)); scroll-padding-bottom:max(var(--co-selection-height,0px),var(--co-task-height,0px)); }
.co-workspace .co-task-dock { position:fixed; left:50%; right:auto; top:auto; bottom:max(16px,env(safe-area-inset-bottom)); width:calc(100% - 48px); max-width:800px; margin:0; z-index:20; background:var(--surface); border:1px solid color-mix(in srgb,var(--border) 72%,var(--text)); border-radius:var(--co-radius-panel); box-shadow:0 18px 58px color-mix(in srgb,#000 34%,transparent); transform:translateX(-50%); }

.co-workspace .co-task-dock { width:min(720px,calc(100% - 48px)); padding:28px; max-height:78dvh; overflow:auto; overscroll-behavior:contain; }
.co-task-dock .co-inline-close { position:sticky; top:0; float:right; margin:-12px -10px 0 12px; background:var(--surface); z-index:1; }
.co-workspace .co-task-dock > .co-run-approval { margin:0; overflow:visible; border:0; border-radius:0; background:transparent; }
.co-workspace .co-task-dock > .co-run-approval > header { padding:0 36px 16px 0; }
.co-workspace .co-task-dock > .co-run-approval h3 { margin:0; font-size:var(--co-text-section); line-height:1.3; letter-spacing:-.02em; }
.co-workspace .co-task-dock > .co-run-approval header p { margin:8px 0 0; font-size:var(--co-text-body); line-height:1.55; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list { max-height:min(35dvh,320px); border:1px solid var(--border); border-radius:var(--co-radius-control); }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list li { background:var(--surface-2); }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list strong { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-actions { padding:16px 0 0; }


.co-detail-tabs { width:fit-content; max-width:100%; background:none; padding:0; gap:16px; border-bottom:1px solid var(--border); }
/* Assign: title, a one-line subtitle, then people in three equal columns.
   The grid scrolls when it is long, without showing a scrollbar. */
.co-pr-assignment h3 { margin:0; }
.co-task-content .co-pr-assignment-note { margin:4px 0 0; font-size:var(--co-text-body); line-height:1.5; }
.co-person-search { width:100%; margin:16px 0 12px; }
.co-person-list { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px 12px; max-height:248px; overflow-y:auto; scrollbar-width:none; }
.co-person-list::-webkit-scrollbar { display:none; }
.co-person-option { display:flex; align-items:center; gap:12px; width:100%; min-width:0; min-height:56px; padding:8px 10px; background:none; border:0; border-radius:var(--co-radius-field); color:var(--text); text-align:left; cursor:pointer; font-size:var(--co-text-body); }
.co-person-option:hover { background:var(--surface-2); }
.co-person-text { display:grid; min-width:0; }
.co-person-text > span,.co-person-text > small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.co-person-text > small { color:var(--muted); font-size:var(--co-text-meta); }
@media(max-width:680px) { .co-person-list { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:420px) { .co-person-list { grid-template-columns:minmax(0,1fr); } }
.co-avatar { flex:none; display:inline-grid; place-items:center; width:32px; height:32px; background:var(--accent-dim); color:var(--accent); border-radius:50%; }
.co-pr-detail { width:100%; padding:0; min-width:0; }
.co-detail-tabs { display:flex; margin-bottom:20px; }
.co-detail-tabs button { background:none; border:0; border-bottom:2px solid transparent; border-radius:0; color:var(--muted); min-height:48px; font-size:var(--co-text-meta); cursor:pointer; padding:8px 0; }
.co-detail-tabs button[aria-pressed=true] { color:var(--text); border-bottom-color:var(--text); }
.co-pr-detail .co-markdown { font-size:var(--co-text-body); line-height:1.65; max-width:72ch; }
.co-pr-detail .co-board-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
.co-detail-stats { display:flex; gap:8px 16px; flex-wrap:wrap; color:var(--muted); font-size:var(--co-text-meta); margin:12px 0; font-variant-numeric:tabular-nums; }
.co-file-disclosure { padding:8px 0; border-bottom:1px solid var(--border); }
.co-file-disclosure summary { cursor:pointer; overflow-wrap:anywhere; font-size:var(--co-text-meta); min-height:44px; align-content:center; }
.co-file-disclosure pre { overflow:auto; max-height:480px; padding:16px; background:var(--surface); font:var(--co-text-meta)/1.6 var(--mono,monospace); }
.co-activity-item { padding:14px 0; border-bottom:1px solid var(--border); }
.co-activity-item > header { font-size:var(--co-text-meta); color:var(--muted); }
.co-group-members { margin-top:20px; }
.co-group-member { border-bottom:1px solid var(--border); padding:10px 0; }
.co-group-member > summary { cursor:pointer; min-height:44px; font-size:var(--co-text-body); align-content:center; }
.co-group-count { color:var(--muted); font-size:var(--co-text-meta); margin:6px 0; }
.co-workspace input:not([type=checkbox]) { font-size:var(--co-text-body); min-height:44px; color:var(--text); background:var(--surface); padding:8px 12px; border:1px solid var(--border); border-radius:var(--co-radius-field); }
.co-workspace input[type=checkbox] { width:18px; height:18px; accent-color:var(--accent); flex-shrink:0; }
.co-workspace summary { min-height:44px; }
.co-workspace :is(button,a,summary) { text-underline-offset:3px; }
.co-workspace ::selection { color:var(--text); background:var(--accent-dim); }
.co-workspace :is(input,textarea) { caret-color:var(--accent); }
.co-page { scrollbar-width:thin; scrollbar-color:var(--border) transparent; }
.co-review-history > p { padding:0 12px; }
.co-review-history-entry { display:block; box-sizing:border-box; width:100%; min-height:44px; padding:12px; border:0; border-bottom:1px solid var(--border); background:none; color:inherit; font:inherit; text-align:left; overflow-wrap:anywhere; cursor:pointer; }
.co-review-history-entry > span,.co-review-history-entry small { display:block; margin-top:4px; }
.co-review-history-entry small { color:var(--muted); }
.co-task-pulls > div { padding:14px 0; border-bottom:1px solid var(--border); }
.co-task-pulls strong { font-size:var(--co-text-body); display:block; }
.co-task-pulls .co-markdown { margin-top:8px; font-size:var(--co-text-body); }
.co-task-pulls a { display:inline-flex; align-items:center; font-size:var(--co-text-meta); color:var(--accent); min-height:44px; }
.co-task-secondary { margin:12px 10px 0 0; }
.co-verdict { margin-top:12px; padding:12px 14px; border-radius:var(--co-radius-panel); border:1px solid color-mix(in srgb,var(--co-warn) 42%,transparent); background:color-mix(in srgb,var(--co-warn) 8%,transparent); }
.co-verdict.is-approve { border-color:color-mix(in srgb,var(--green) 40%,transparent); background:color-mix(in srgb,var(--green) 8%,transparent); }
.co-verdict-status { margin:0; font-size:var(--co-text-body); font-weight:600; }
.co-verdict .co-task-details { margin-top:8px; }
.co-verdict-actions { display:flex; flex-wrap:wrap; gap:10px; }
.co-scope-row { display:grid; grid-template-columns:1fr auto; gap:6px 12px; width:100%; padding:16px 0; border:0; border-bottom:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; min-height:64px; }
.co-scope-row strong { font-size:var(--co-text-body); }
.co-scope-row span { font-size:var(--co-text-meta); color:var(--muted); grid-column:1; }
.co-scope-row .co-icon { grid-column:2; grid-row:1 / 3; align-self:center; }
.co-workspace .co-run-list { border:0; border-radius:0; background:none; }
.co-workspace .co-run-row { background:none; border-bottom:1px solid var(--border); padding:12px 0; }
.co-workspace .co-run-row-main { grid-template-columns:minmax(0,1fr); }
.co-workspace .co-run-row-icon { display:none; }
.co-workspace .co-run-row-main strong { font-size:var(--co-text-body); font-weight:500; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.co-workspace .co-run-row-main small { white-space:normal; }

.co-workspace .co-run-fold { background:none; }
.co-directory { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:16px; }
.co-directory .co-project-search { margin:0; }
.co-directory > :not(.co-project-search):not(.co-directory-filters) { grid-column:1/-1; }
.co-directory-filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.co-directory-filters button { display:inline-flex; align-items:center; gap:7px; min-height:44px; padding:8px 14px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); color:var(--muted); font:600 var(--co-text-meta) var(--font); cursor:pointer; }
.co-directory-filters button[aria-pressed=true],.co-directory-filters button:hover { color:var(--text); border-color:color-mix(in srgb,var(--accent) 34%,var(--border)); background:var(--accent-dim); }
.co-directory-filters button span { min-width:20px; padding:1px 6px; border-radius:var(--co-radius-control); background:var(--bg); color:var(--muted); font-variant-numeric:tabular-nums; }
.co-task-dock:focus-visible,.co-task-dock [tabindex="-1"]:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
/* Inline panes take focus only so keyboard users land in them; their border
   already marks them, so the browser ring would trace a second, tight frame. */
.co-task-content:not(.co-task-dock):focus,.co-task-content:not(.co-task-dock) [tabindex="-1"]:focus { outline:none; }
.co-workspace .co-task-dock { animation:co-dock-arrive .18s cubic-bezier(.16,1,.3,1); }
.co-connect-banner { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:0 0 20px; padding:16px 18px; border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border)); border-radius:var(--co-radius-panel); background:color-mix(in srgb,var(--accent-dim) 42%,var(--surface)); }
.co-connect-banner strong { display:block; font-size:var(--co-text-body); font-weight:650; }
.co-connect-banner p { margin:4px 0 0; max-width:64ch; color:var(--muted); font-size:var(--co-text-meta); line-height:1.5; }
@media(max-width:680px) { .co-connect-banner { align-items:stretch; flex-direction:column; gap:12px; margin-bottom:16px; } .co-connect-banner .co-btn { width:100%; justify-content:center; } }
@keyframes co-dock-arrive { from { transform:translate(-50%,12px); } to { transform:translate(-50%,0); } }
@keyframes co-dock-arrive-mobile { from { transform:translateY(12px); } to { transform:translateY(0); } }
@media(prefers-reduced-motion:reduce) { .co-workspace .co-task-dock { animation:none; } }
@media(max-width:680px) {
 .co-header { padding:6px 18px; }
 .co-header::after { left:18px; right:18px; }
 .co-projects-view { padding:20px 18px 60px; }
 .co-workspace-head { gap:14px; }
 .co-workspace-title h2 { font-size:var(--co-text-section); }
 .co-task-content { padding:20px; }
 .co-pr-detail { padding:12px 0; }
 .co-workspace .co-task-dock { left:8px; right:8px; width:auto; bottom:max(8px,env(safe-area-inset-bottom)); border-radius:var(--co-radius-panel); transform:none; }
 .co-workspace .co-task-dock { padding:20px; max-height:76dvh; animation-name:co-dock-arrive-mobile; }
 .co-directory { grid-template-columns:1fr; }
 .co-directory-filters { width:100%; }
}
.co-other-repositories { margin-top:28px; border-top:1px solid var(--border); }
.co-other-repositories > summary { display:flex; align-items:center; gap:12px; min-height:56px; font-size:var(--co-text-body); cursor:pointer; }
.co-other-repositories > summary span { color:var(--muted); font-size:var(--co-text-meta); }
.co-other-repositories > p { max-width:72ch; margin:0 0 12px; color:var(--muted); font-size:var(--co-text-meta); line-height:1.55; text-wrap:pretty; }
/* Agent picker: the chat composer's model rows and effort track (sizes kept in
   step with the shell's ChatSettingsPanel/EffortStepper), behind a compact trigger. */
.co-agent-picker { max-width:440px; margin:4px 0 18px; }
.co-review-window .co-agent-picker { max-width:none; }
.co-agent-trigger { display:flex; align-items:center; gap:10px; width:100%; min-height:48px; padding:6px 10px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--surface); color:var(--text); font:inherit; text-align:left; cursor:pointer; }
.co-agent-trigger:hover { background:var(--surface-2,var(--surface)); }
.co-agent-trigger:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-agent-trigger-label { color:var(--muted); font-size:var(--co-text-meta); min-width:44px; }
.co-agent-trigger-value { flex:1; min-width:0; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.co-agent-trigger-value strong { font-size:var(--co-text-meta); font-weight:500; }
.co-agent-trigger-value small { color:var(--muted); font-size:var(--co-text-meta); }
.co-agent-trigger-chevron { color:var(--muted); transition:transform .15s; }
.co-agent-trigger[aria-expanded="true"] .co-agent-trigger-chevron { transform:rotate(180deg); }
.co-model-list { margin-top:6px; padding:6px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--bg); max-height:min(50vh,380px); overflow:auto; overscroll-behavior:contain; scrollbar-width:none; }
.co-model-list::-webkit-scrollbar { display:none; }
.co-model-row { display:flex; align-items:center; gap:12px; width:100%; padding:8px 10px; border:0; border-radius:var(--co-radius-field); background:none; color:var(--text); font:inherit; text-align:left; cursor:pointer; }
@media (hover:hover) and (pointer:fine) { .co-model-row:hover { background:var(--surface); } .co-model-row.is-selected:hover { background:color-mix(in srgb,var(--accent) 12%,var(--surface)); } }
.co-model-row.is-selected { background:color-mix(in srgb,var(--accent) 9%,var(--surface)); }
.co-model-row:disabled { opacity:.4; cursor:not-allowed; }
.co-model-row:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-model-mark { width:30px; height:30px; flex-shrink:0; display:grid; place-items:center; border-radius:var(--co-radius-field); background:var(--surface); border:1px solid rgba(255,255,255,.07); color:var(--text); font-size:var(--co-text-meta); font-weight:600; }
[data-theme="light"] .co-model-mark { border-color:rgba(15,18,25,.10); }
.co-model-row.is-selected .co-model-mark { background:var(--surface-2,var(--surface)); }
.co-model-mark-mobius { display:block; width:23px; height:23px; }
[data-theme="light"] .co-model-mark-mobius { filter:invert(1); }
.co-model-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.co-model-title { font-size:var(--co-text-meta); font-weight:500; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.co-model-sub { font-size:var(--co-text-meta); color:var(--muted); line-height:1.4; }
.co-model-dot { position:relative; width:16px; height:16px; flex-shrink:0; border:1.5px solid var(--border); border-radius:50%; transition:border-color .12s; }
.co-model-row.is-selected .co-model-dot { border-color:var(--accent); background:var(--accent); }
.co-model-row.is-selected .co-model-dot::after { content:''; position:absolute; left:4px; top:2px; width:5px; height:8px; border:1.5px solid var(--accent-fg,#fff); border-top:0; border-left:0; transform:rotate(45deg); }
.co-effort-indent { margin:4px 12px 8px 52px; }
.co-effort { display:flex; flex-wrap:wrap; align-items:center; gap:0 12px; min-width:0; }
.co-effort.is-disabled { opacity:.55; }
/* The track never squeezes its 44px stops: when the row is too narrow the
   label moves to its own line instead (phones, six effort levels). */
.co-effort-track { position:relative; flex:1 1 auto; min-width:min-content; height:44px; display:flex; align-items:center; justify-content:space-between; }
.co-effort-track::before { content:''; position:absolute; left:22px; right:22px; top:50%; height:2px; background:var(--border); border-radius:var(--co-radius-pill); transform:translateY(-50%); }
/* Each stop is a 44px target; the 13px dot is only its visible mark. */
.co-effort-stop { position:relative; width:44px; height:44px; flex-shrink:0; padding:0; border:0; border-radius:50%; background:none; cursor:pointer; }
.co-effort-stop::before { content:''; position:absolute; left:50%; top:50%; box-sizing:border-box; width:13px; height:13px; border:1.5px solid var(--border); border-radius:50%; background:var(--surface); transform:translate(-50%,-50%); transition:background .15s,border-color .15s,transform .15s; }
@media (hover:hover) and (pointer:fine) { .co-effort-stop:hover:not(:disabled)::before { border-color:var(--accent); } }
.co-effort-stop.is-filled::before,.co-effort-stop.is-on::before { background:var(--accent); border-color:var(--accent); }
.co-effort-stop.is-on::before { transform:translate(-50%,-50%) scale(1.3); box-shadow:0 0 0 3px var(--accent-dim); }
.co-effort-stop:disabled { cursor:not-allowed; }
.co-effort-stop:focus-visible { outline:2px solid var(--accent); outline-offset:-8px; }
.co-effort-label { min-width:70px; font-size:var(--co-text-meta); font-weight:500; color:var(--text); white-space:nowrap; text-align:right; }
.co-model-note { margin:8px 10px; color:var(--muted); font-size:var(--co-text-meta); }
.co-model-note button { margin-left:6px; border:0; background:none; color:var(--accent); font:inherit; cursor:pointer; text-decoration:underline; }
@media (max-width:520px) { .co-model-row { min-height:44px; gap:10px; padding:7px 8px; } .co-effort-indent { margin-left:8px; margin-right:8px; } .co-effort-label { order:-1; flex-basis:100%; min-width:0; text-align:left; } }
@media (prefers-reduced-motion:reduce) { .co-effort-stop::before,.co-agent-trigger-chevron { transition:none; } }
.co-change-total { display:inline-flex; align-items:baseline; gap:7px; font-variant-numeric:tabular-nums; }
.co-change-total b { color:var(--green); font-weight:650; }
.co-change-total em { color:var(--danger); font-style:normal; font-weight:650; }
.co-root { user-select:text; -webkit-user-select:text; }
.co-source-row,.co-card-title,.co-run-row-main,.co-run-quiet-row { user-select:text; -webkit-user-select:text; }
/* Disclosure content can inherit content-box through the browser’s details pseudo-element. */
.co-source-row { box-sizing:border-box; min-height:88px; padding:13px 12px; border-radius:var(--co-radius-panel); }
.co-source-row .co-source-glyph { grid-row:1; align-self:center; }
.co-source-row-cue > .co-icon { flex:0 0 auto; align-self:center; margin:0; }
.co-repository-picker { position:relative; }
.co-repository-trigger { white-space:nowrap; }
.co-repository-picker form { position:absolute; right:0; top:100%; z-index:5; width:min(500px,calc(100vw - 36px)); padding:20px; background:var(--bg); border:1px solid var(--border); border-radius:var(--co-radius-panel); }
.co-repository-picker form > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.co-repository-picker form > header strong { font-size:var(--co-text-body); }
.co-repository-picker form > header .co-btn-quiet { padding-inline:4px; }
.co-repository-picker label { display:block; margin-bottom:8px; font-size:var(--co-text-body); }
.co-repository-picker form > div { display:flex; align-items:center; gap:12px; }
.co-repository-picker input { min-width:0; width:100%; min-height:44px; padding:10px 12px; font-size:var(--co-text-body); color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:var(--co-radius-field); }
.co-repository-picker p { color:var(--muted); font-size:var(--co-text-meta); line-height:1.5; }
.co-repository-note { position:absolute; right:0; top:100%; z-index:5; width:min(320px,calc(100vw - 36px)); padding:16px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--bg); }
@media(max-width:520px) {
 .co-view-heading { display:flex; align-items:center; gap:8px; }
 .co-view-heading h2 { white-space:nowrap; }
 .co-project-view-actions { flex-direction:row; align-items:center; gap:8px; }
 .co-project-view-actions { margin-left:auto; }
 .co-repository-picker form { position:fixed; left:8px; right:8px; top:auto; bottom:max(8px,env(safe-area-inset-bottom)); z-index:70; width:auto; max-height:calc(100dvh - 16px); overflow:auto; box-sizing:border-box; border-radius:var(--co-radius-panel); box-shadow:0 18px 58px color-mix(in srgb,#000 34%,transparent); }
 .co-repository-note { position:fixed; left:8px; right:8px; top:auto; bottom:max(8px,env(safe-area-inset-bottom)); width:auto; box-sizing:border-box; border-radius:var(--co-radius-panel); }
 .co-repository-picker form > div { display:grid; grid-template-columns:minmax(0,1fr) auto; }
}
.co-selection-page { width:100%; max-width:760px; margin:0 auto; padding:28px; }
.co-selection-page > .co-btn-quiet { margin-bottom:20px; }
.co-selection-page h2,.co-selection-page h3 { font-size:var(--co-text-title); line-height:1.25; letter-spacing:-.02em; }
.co-selection-page p { font-size:var(--co-text-body); line-height:1.6; color:var(--muted); }
.co-selection-page .co-board-actions { margin-top:24px; }
@media(max-width:680px) { .co-selection-page { padding:20px; } }

/* Project status under To look at: one box per fact, side by side when they
   fit and stacked on a phone. The 1px gap over a border-coloured box draws the
   divider in either layout. */
.co-project-position { margin:12px 0 16px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); overflow:hidden; }
.co-status-row { display:flex; align-items:center; gap:12px; min-height:56px; padding:8px 12px; }
.co-status-row + .co-status-row { border-top:1px solid var(--border); }
.co-status-icon { flex:0 0 auto; display:grid; place-items:center; width:36px; height:36px; border-radius:var(--co-radius-control); background:var(--surface-2,var(--bg)); color:var(--muted); }
.co-status-row.is-ok .co-status-icon { color:var(--green); background:color-mix(in srgb,var(--green) 14%,transparent); }
.co-status-row.is-warn .co-status-icon { color:var(--co-warn); background:color-mix(in srgb,var(--co-warn) 16%,transparent); }
.co-status-text { flex:1; min-width:0; margin:0; font-size:var(--co-text-body); overflow-wrap:anywhere; }
.co-status-text strong { font-weight:650; }
.co-status-sub { color:var(--muted); font-size:var(--co-text-meta); }
.co-status-actions { flex:0 0 auto; display:flex; gap:8px; }
.co-status-actions .co-btn { gap:8px; padding:0 12px; }
.co-workspace .co-pr-assignment { padding:0; background:none; border:0; border-radius:0; }
.co-workspace .co-run { margin-top:0; }
.co-workspace .co-public-work { margin-top:0; }
.co-workspace .co-run-primary { display:flex; align-items:center; gap:16px; padding:12px 0; margin:0; border:0; border-bottom:1px solid var(--border); border-radius:0; background:none; }
.co-workspace .co-run-primary-mark { display:none; }
.co-workspace .co-run-primary > div { flex:1; min-width:0; }
.co-workspace .co-run-primary strong { font-size:var(--co-text-body); font-weight:600; }
.co-workspace .co-run-primary p { font-size:var(--co-text-meta); margin:4px 0 0; }
.co-workspace .co-run-primary .co-btn { padding:8px 12px; }
.co-workspace .co-run-fold { margin:0; padding:0; border:0; border-bottom:1px solid var(--border); }
.co-workspace .co-run-fold > summary { min-height:52px; font-size:var(--co-text-meta); font-weight:500; }
.co-workspace .co-run-fold > summary b { font-weight:500; color:var(--muted); }
.co-work-progress-row { border:0; border-bottom:1px solid var(--border); border-radius:0; padding:10px 0; margin:0 0 14px; }
.co-work-progress-row > span > strong { font-size:var(--co-text-meta); }
.co-work-progress-row small { font-size:var(--co-text-meta); }
@media(max-width:680px) {
 .co-projects-view { padding:14px 16px 40px; }
 .co-workspace .co-run-primary { align-items:flex-start; gap:12px; }
 .co-workspace .co-run-primary .co-btn { max-width:42%; white-space:normal; }
}

.co-pr-detail-actions .co-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; }
.co-public-work > .co-task-content { width:100%; min-width:0; margin:12px 0 18px; padding:20px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--surface); }
.co-pr-detail-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:12px 0 14px; }
.co-pr-detail .co-detail-tabs { display:flex; flex-wrap:nowrap; width:100%; gap:18px; margin:0; overflow-x:auto; }
.co-pr-detail .co-detail-tabs button { flex:none; min-height:44px; }
.co-pr-detail-body { min-height:280px; height:clamp(280px,45dvh,520px); overflow:auto; overscroll-behavior:contain; padding:12px 3px 16px; scrollbar-width:thin; }
.co-pr-detail-body .co-markdown { overflow-wrap:anywhere; }
@media(max-width:680px) {
 .co-header { min-height:52px; padding:4px 16px; }
 .co-projects-view { padding-top:8px; }
 .co-workspace-head { padding:0 0 6px; }
 .co-workspace-title p { margin-top:0; line-height:20px; }
 .co-project-position { margin:10px 0 8px; }
 .co-status-row { flex-wrap:wrap; padding-block:10px; }
 .co-status-actions { flex:1 0 100%; padding-left:48px; }
 .co-public-work > .co-task-content { padding:16px; }
 .co-pr-detail-body { height:clamp(280px,42dvh,440px); }
}

.co-prepared-work > h3 { font-size:var(--co-text-body); margin:0 0 12px; }
.co-workspace-title p a { color:var(--muted); text-decoration:none; }
.co-workspace-title p a:hover { color:var(--accent); text-decoration:underline; }

/* Pull requests, GitHub-style: one bordered list box, compact rows with
   colored labels beside the title, "#123 · author opened … · ✓ 18/18" meta,
   and quiet right-hand actions. Detail follows GitHub's PR page. */
.co-workspace .co-public-work { margin-top:20px; }
.co-pr-list-controls { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
.co-pr-search { display:flex; align-items:center; gap:8px; flex:1; min-width:0; min-height:40px; padding:0 12px; border:1px solid var(--border); border-radius:var(--co-radius-field); background:var(--surface); color:var(--muted); }
.co-pr-search:focus-within { border-color:var(--accent); }
.co-workspace .co-pr-search input { flex:1; min-width:0; min-height:38px; padding:0; border:0; background:none; font-size:var(--co-text-meta); }
.co-pr-search input:focus { outline:none; }
/* The search field is always on screen, so its icon toggle stays out of sight (it must outrank .co-btn's own display). */
.co-pr-list-controls .co-pr-search-toggle { display:none; }
/* The box does not clip, so an Agent menu can open past its bottom edge even
   with one PR; the header and the last row round their own corners instead. */
.co-pr-box { border:1px solid var(--border); border-radius:var(--co-radius-field); }
.co-pr-box-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-height:52px; padding:4px 12px 4px 4px; background:var(--surface); border-radius:var(--co-radius-field) var(--co-radius-field) 0 0; }
.co-pr-list > .co-frame:last-child > .co-pr-row { border-radius:0 0 var(--co-radius-field) var(--co-radius-field); }
.co-pr-box-count { display:inline-flex; align-items:center; gap:6px; margin-right:auto; font-size:var(--co-text-meta); font-weight:600; }
.co-pr-box-actions { display:flex; align-items:center; gap:8px; }
.co-pr-box-actions .co-btn { padding:6px 12px; display:inline-flex; align-items:center; gap:6px; }
.co-pr-box-head > p { flex-basis:100%; margin:0 0 6px 40px; color:var(--muted); font-size:var(--co-text-meta); }
.co-pr-box > .co-task-content { margin:0; border:0; border-top:1px solid var(--border); border-radius:0; }
.co-pr-empty { padding:28px 16px; border-top:1px solid var(--border); text-align:center; color:var(--muted); font-size:var(--co-text-meta); }
.co-pr-empty strong { display:block; color:var(--text); font-size:var(--co-text-body); margin-bottom:4px; }
.co-pr-empty p { margin:0; }
.co-pr-row { display:grid; grid-template-columns:40px 20px minmax(0,1fr) auto; column-gap:6px; align-items:start; padding:8px 12px 8px 4px; border-top:1px solid var(--border); transition:background .12s; }
.co-pr-row:hover { background:color-mix(in srgb,var(--surface) 60%,transparent); }
.co-pr-row.is-selected { background:var(--accent-dim); }
.co-pr-row.is-highlighted { box-shadow:inset 3px 0 var(--accent); }
.co-pr-select { display:grid; place-items:center; width:40px; min-height:40px; cursor:pointer; }
.co-pr-select input,.co-pr-box-head input[type=checkbox] { width:16px; height:16px; accent-color:var(--accent); cursor:pointer; }
.co-pr-row > .co-gh-state { padding-top:11px; }
.co-pr-content { min-width:0; padding:7px 0 2px; }
.co-pr-open { display:block; width:100%; padding:0; border:0; background:none; color:var(--text); text-align:left; font:inherit; line-height:1.5; cursor:pointer; user-select:text; -webkit-user-select:text; }
.co-pr-open .co-gh-label { margin-left:4px; vertical-align:2px; }
.co-pr-title { font-size:var(--co-text-body); font-weight:600; overflow-wrap:anywhere; }
.co-pr-open:hover .co-pr-title { color:var(--accent); }
.co-pr-open:focus-visible { outline:2px solid var(--accent); outline-offset:3px; border-radius:var(--co-radius-pill); }
.co-pr-meta { display:flex; align-items:center; flex-wrap:wrap; gap:2px 10px; margin-top:2px; color:var(--muted); font-size:var(--co-text-meta); }
.co-pr-meta > span { white-space:nowrap; }
.co-pr-agent-state { display:inline-flex; align-items:center; gap:4px; min-height:28px; padding:0 8px; border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border)); border-radius:var(--co-radius-round); background:var(--accent-dim); color:var(--text); font:500 var(--co-text-meta) var(--font); cursor:pointer; }
.co-pr-agent-state.needs-you { border-color:var(--co-warn); background:color-mix(in srgb,var(--co-warn) 16%,transparent); }
.co-pr-agent-state.is-waiting { border-color:var(--border); background:transparent; color:var(--muted); }
.co-pr-aside { display:flex; align-items:center; gap:2px; padding-top:2px; }
.co-pr-comments { display:inline-flex; align-items:center; gap:4px; padding:0 8px; color:var(--muted); font-size:var(--co-text-meta); font-variant-numeric:tabular-nums; }
.co-pr-requested { display:inline-flex; align-items:center; min-height:24px; padding:0 8px; border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border)); border-radius:var(--co-radius-round); background:var(--accent-dim); color:var(--text); font:500 var(--co-text-meta) var(--font); }
.co-pr-row > .co-task-content { grid-column:1/-1; margin:8px 0 6px 40px; padding:18px 20px 20px; border:1px solid var(--border); border-radius:var(--co-radius-field); background:var(--bg); }
.co-gh-avatars { display:inline-flex; align-items:center; }
.co-gh-avatars > .co-gh-avatar + .co-gh-avatar { margin-left:-6px; }
.co-gh-avatar { display:inline-grid; place-items:center; flex:none; border-radius:50%; background:var(--surface-2,var(--surface)); color:var(--text); font-size:var(--co-text-meta); font-weight:600; box-shadow:0 0 0 2px var(--bg); }
.co-gh-label { display:inline-block; padding:0 8px; border:1px solid var(--co-label-dark-edge,var(--border)); border-radius:var(--co-radius-round); background:var(--co-label-dark-bg,var(--surface-2,var(--surface))); color:var(--co-label-dark-fg,var(--text)); font-size:var(--co-text-meta); font-weight:500; line-height:20px; white-space:nowrap; }
[data-theme="light"] .co-gh-label { border-color:var(--co-label-light-edge,var(--border)); background:var(--co-label-light-bg,var(--surface-2,var(--surface))); color:var(--co-label-light-fg,var(--text)); }
.co-gh-labels { display:flex; flex-wrap:wrap; gap:4px; margin-top:10px; }
.co-gh-state { display:inline-flex; color:var(--green); }
.co-gh-state.is-draft { color:var(--muted); }
.co-gh-state.is-merged { color:#a371f7; }
.co-gh-state.is-closed { color:var(--danger); }
.co-gh-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border:1px solid var(--co-label-dark-edge,transparent); border-radius:var(--co-radius-round); background:var(--co-label-dark-bg,var(--surface-2)); color:var(--co-label-dark-fg,var(--text)); font-size:var(--co-text-meta); font-weight:500; white-space:nowrap; }
[data-theme="light"] .co-gh-badge { border-color:var(--co-label-light-edge,transparent); background:var(--co-label-light-bg,var(--surface-2)); color:var(--co-label-light-fg,var(--text)); }
.co-gh-checks { display:inline-flex; align-items:center; gap:3px; font-variant-numeric:tabular-nums; }
.co-gh-checks.is-success .co-icon { color:var(--green); }
.co-gh-checks.is-failure .co-icon { color:var(--danger); }
.co-gh-checks.is-pending .co-icon { color:var(--co-warn); }
.co-gh-pr-head { padding-right:36px; }
.co-gh-pr-title { margin:0; font-size:var(--co-text-section); font-weight:500; line-height:1.35; overflow-wrap:anywhere; }
.co-gh-pr-title > span { color:var(--muted); font-weight:400; }
.co-gh-pr-sub { display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px; margin-top:10px; color:var(--muted); font-size:var(--co-text-meta); }
.co-gh-pr-sub b { color:var(--text); font-weight:600; }
.co-gh-pr-sub code { padding:1px 6px; border-radius:var(--co-radius-pill); background:color-mix(in srgb,var(--accent) 12%,var(--surface)); color:var(--text); font:var(--co-text-meta) var(--mono,monospace); }
.co-branch-flow { display:inline-flex; align-items:center; gap:7px; min-width:0; }
.co-branch-flow code { overflow-wrap:anywhere; }
.co-branch-flow .co-icon { flex:0 0 auto; color:var(--muted); }
.co-tab-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
.co-tab-dot.is-success { background:var(--green); }
.co-tab-dot.is-failure { background:var(--danger); }
.co-tab-dot.is-pending { background:var(--co-warn,#b38235); }
.co-pr-detail-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:16px 0 4px; }
.co-pr-detail-actions .co-btn { gap:6px; }
.co-pr-detail-actions .co-tip { min-width:44px; min-height:44px; padding:0; justify-content:center; }
/* An icon-only button names itself in a tooltip: after the pointer rests on it for 2 s, at once on keyboard focus, and while a finger holds it. */
.co-tip { position:relative; }
.co-tip::after { content:attr(data-tip); position:absolute; top:calc(100% + 6px); left:50%; z-index:40; transform:translateX(-50%); padding:5px 9px; border-radius:var(--co-radius-pill); background:var(--text); color:var(--bg); font:600 var(--co-text-meta)/1.2 var(--font); white-space:nowrap; max-width:min(360px,70vw); overflow:hidden; text-overflow:ellipsis; opacity:0; pointer-events:none; transition:opacity .12s 0s; }
/* In the PR page's action row the facts line sits right below the buttons, so their tooltip opens above. */
.co-pr-detail-actions .co-tip::after { top:auto; bottom:calc(100% + 6px); }
.co-tip:hover::after { opacity:1; transition-delay:2s; }
.co-tip:focus-visible::after { opacity:1; transition-delay:0s; }
.co-pr-detail-actions.is-tips-off .co-tip::after { opacity:0; transition-delay:0s; }
@media (hover:none) { .co-tip:hover::after { opacity:0; transition-delay:0s; } .co-tip:active::after { opacity:1; transition-delay:0s; } }
@media (prefers-reduced-motion:reduce) { .co-tip::after { transition-duration:0s; } }
.co-gh-provenance { display:contents; }
.co-chat-group { position:relative; display:inline-flex; }
.co-chat-group-list { position:absolute; z-index:30; top:calc(100% + 6px); left:0; width:min(320px,calc(100vw - 32px)); padding:6px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); box-shadow:0 12px 32px rgba(0,0,0,.28); }
.co-chat-group-list button { display:flex; flex-direction:column; gap:2px; width:100%; padding:9px 10px; border:0; border-radius:var(--co-radius-field); background:none; color:var(--text); text-align:left; font:inherit; cursor:pointer; }
.co-chat-group-list button:hover { background:var(--surface-2,var(--surface)); }
.co-chat-group-list small { color:var(--muted); font-size:var(--co-text-meta); overflow-wrap:anywhere; }
.co-gh-chat-link { gap:6px; }
.co-gh-chat-link .co-icon { color:var(--muted); }
.co-pr-detail .co-detail-tabs { display:flex; width:100%; gap:20px; margin:14px 0 0; border-bottom:1px solid var(--border); overflow-x:auto; }
.co-pr-detail .co-detail-tabs button { display:inline-flex; align-items:center; gap:6px; flex:none; min-height:44px; font-size:var(--co-text-meta); }
.co-tab-count { min-width:22px; padding:0 7px; border-radius:var(--co-radius-round); background:var(--surface-2,var(--surface)); color:var(--text); font-size:var(--co-text-meta); line-height:20px; text-align:center; }
.co-pr-detail-body { max-height:min(60dvh,560px); overflow:auto; overscroll-behavior:contain; padding:14px 2px 6px; }
.co-gh-comment { margin:0 0 14px; border:1px solid var(--border); border-radius:var(--co-radius-field); overflow:hidden; }
.co-gh-comment > header { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:8px 14px; background:var(--surface); border-bottom:1px solid var(--border); color:var(--muted); font-size:var(--co-text-meta); }
.co-gh-comment > header b { color:var(--text); }
.co-gh-comment > header a { margin-left:auto; }
.co-gh-comment > .co-markdown,.co-gh-comment > div { padding:12px 14px; font-size:var(--co-text-body); }
.co-gh-comment.is-changes { border-color:color-mix(in srgb,var(--danger) 55%,var(--border)); }
.co-gh-comment.is-changes > header { border-bottom-color:color-mix(in srgb,var(--danger) 35%,var(--border)); }
.co-gh-comment.is-approved { border-color:color-mix(in srgb,var(--green) 55%,var(--border)); }
.co-gh-comment.is-approved > header { border-bottom-color:color-mix(in srgb,var(--green) 35%,var(--border)); }
.co-gh-comment.is-reviewed { border-color:color-mix(in srgb,var(--accent) 45%,var(--border)); }
.co-gh-comment.is-dismissed { opacity:.75; }
.co-comment-body { --co-clamp-fade:var(--bg); }
.co-comment-body .co-desc-body { max-height:13em; }
.co-comment-body .co-btn-quiet { display:block; width:fit-content; margin:4px 0 0 auto; }
.co-gh-merge-state { margin:6px 0 10px; color:var(--muted); font-size:var(--co-text-meta); }
.co-gh-merge-state:empty { display:none; }
@media (max-width:680px) {
 .co-pr-list-controls { flex-wrap:wrap; }
 .co-pr-search { flex-basis:100%; }
 .co-pr-row { grid-template-columns:36px 18px minmax(0,1fr); column-gap:4px; padding-right:4px; }
 /* Labelled row actions wrap under the title instead of squeezing it. */
 .co-pr-aside { grid-column:3; justify-content:flex-start; margin-left:-10px; padding-top:0; }
 .co-pr-select { width:36px; }
 .co-pr-comments { display:none; }
 .co-pr-meta > span:first-child { white-space:normal; }
 .co-pr-row > .co-task-content { margin-left:0; padding:16px; }
 .co-gh-pr-title { font-size:var(--co-text-body); }
}
@media (prefers-reduced-motion:reduce) { .co-pr-row { transition:none; } }

/* Owner decisions above the PR list: one bordered box, one row per kind. */
.co-decisions { border:1px solid var(--border); border-radius:var(--co-radius-field); overflow:clip; }
.co-decisions:empty { display:none; }
.co-workspace .co-decisions > .co-run-primary,.co-workspace .co-decisions > .co-run-fold > summary,.co-workspace .co-decisions > .co-local-summary { padding-inline:14px; }
.co-workspace .co-decisions > .co-run-primary { min-height:56px; padding-block:8px; }
.co-workspace .co-decisions > :last-child,.co-workspace .co-decisions > .co-run-fold:last-child { border-bottom:0; }
.co-workspace .co-decisions > .co-run-fold > .co-run-list,.co-workspace .co-decisions > .co-run-fold > p { padding:0 14px 8px; }
.co-workspace .co-decisions .co-run-primary strong { font-size:var(--co-text-body); font-weight:600; }
.co-workspace .co-decisions .co-run-fold > summary { font-size:var(--co-text-body); font-weight:600; }
/* The attention bar: what needs you, counted by reason, folding open to rows that share its left edge. */
.is-changes, .is-conflict { --tone:var(--danger,#f87171); }
.is-checks { --tone:var(--co-warn); }
.is-ready, .is-route { --tone:var(--co-warn); }
.is-feedback, .is-decision { --tone:var(--accent); }
.co-attn { margin:0 0 10px; border:1px solid color-mix(in srgb,var(--accent) 42%,var(--border)); border-radius:var(--co-radius-panel); background:color-mix(in srgb,var(--accent) 8%,transparent); overflow:hidden; }
.co-attn > summary { display:flex; align-items:center; gap:12px; min-height:60px; padding:10px 12px; list-style:none; cursor:pointer; }
.co-attn > summary::-webkit-details-marker { display:none; }
.co-attn > summary:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.co-attn-count { flex:0 0 auto; display:grid; place-items:center; width:36px; height:36px; border-radius:50%; background:var(--accent); color:var(--accent-fg,#fff); font-size:var(--co-text-body); font-weight:700; }
.co-attn-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.co-attn-text strong { font-size:var(--co-text-body); font-weight:650; }
.co-attn-sum { display:flex; flex-wrap:wrap; gap:2px 14px; color:var(--muted); font-size:var(--co-text-meta); }
.co-attn-rs { display:inline-flex; align-items:center; gap:6px; }
.co-attn-rs i { width:8px; height:8px; border-radius:50%; background:var(--tone,var(--accent)); }
.co-attn-rs b { color:color-mix(in srgb,var(--tone,var(--accent)) 60%,var(--text)); font-weight:650; }
.co-attn-toggle { flex:0 0 auto; display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:var(--co-text-meta); font-weight:600; }
.co-attn > summary:hover .co-attn-toggle { color:var(--text); }
.co-attn-hide, .co-attn[open] .co-attn-show { display:none; }
.co-attn[open] .co-attn-hide { display:inline; }
.co-attn-toggle .co-icon { transition:transform .15s; }
.co-attn[open] .co-attn-toggle .co-icon { transform:rotate(180deg); }
.co-attn > .co-run-list { border-top:1px solid color-mix(in srgb,var(--accent) 22%,transparent); }
.co-attention-row { box-sizing:border-box; display:grid; grid-template-columns:36px minmax(0,1fr) 20px; align-items:center; gap:12px; width:100%; padding:10px 12px; border:0; border-top:1px solid color-mix(in srgb,var(--accent) 16%,transparent); background:none; color:var(--text); font:inherit; text-align:left; cursor:pointer; }
.co-attention-row:first-child { border-top:0; }
.co-attention-row:hover { background:color-mix(in srgb,var(--accent) 7%,transparent); }
.co-attention-row:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.co-attention-row > .co-icon:first-child { justify-self:center; color:var(--tone,var(--muted)); }
.co-attention-go { color:var(--muted); }
.co-attention-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.co-attention-main strong { font-size:var(--co-text-body); font-weight:600; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.co-attention-main small { color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.co-attention-reason, .co-attn-tag { display:inline-block; margin-right:8px; padding:1px 8px; border-radius:var(--co-radius-round); background:color-mix(in srgb,var(--tone,var(--accent)) 14%,transparent); color:color-mix(in srgb,var(--tone,var(--accent)) 60%,var(--text)); font-size:var(--co-text-meta); font-weight:600; line-height:22px; }
.co-attn-more { box-sizing:border-box; display:flex; align-items:center; gap:12px; width:100%; padding:0 12px; border-top:1px solid color-mix(in srgb,var(--accent) 16%,transparent); }
.co-attn-more .co-icon { margin-inline:11px; }
.co-desk-row > .co-desk-attention-icon { color:var(--tone,var(--muted)); }
.co-desk-chip.is-tone { background:color-mix(in srgb,var(--tone,var(--accent)) 14%,transparent); color:color-mix(in srgb,var(--tone,var(--accent)) 60%,var(--text)); }
.co-decisions:has(> .co-attn:only-child) { border:0; overflow:visible; }
.co-decisions > .co-attn:not(:only-child) { margin:0; border:0; border-bottom:1px solid var(--border); border-radius:0; }
@media (prefers-reduced-motion:reduce) { .co-attn-toggle .co-icon { transition:none; } }
@media (max-width:680px) {
 .co-attention-main strong, .co-attention-main small { white-space:normal; }
}
/* Plain status lines: one fact about the project and its next step. */

.co-icon.is-spinning { animation:co-spin 1s linear infinite; }
@keyframes co-spin { to { transform:rotate(360deg); } }
.co-workspace-head { align-items:flex-start; }
.co-project-view-actions { align-items:flex-start; }
.co-repository-trigger { gap:8px; }

/* Row actions are words: "Assign" and "Agent ▾", quiet until the row is in use. */
.co-pr-assign,.co-agent-menu-button { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; white-space:nowrap; }
.co-pr-row:hover .co-pr-assign,.co-pr-row:hover .co-agent-menu-button,.co-pr-row:focus-within .co-agent-menu-button { color:var(--text); }
.co-agent-menu-button.is-button { padding:6px 12px; }
.co-agent-menu-button > .co-icon:last-child { transition:transform .15s; }
.co-agent-menu-button[aria-expanded=true] > .co-icon:last-child { transform:rotate(180deg); }
.co-agent-menu { position:relative; display:inline-flex; }
.co-agent-menu-list { position:absolute; z-index:30; top:calc(100% + 6px); right:0; width:min(340px,calc(100vw - 32px)); padding:6px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); box-shadow:0 12px 32px rgba(0,0,0,.28); }
.co-agent-menu.is-align-start .co-agent-menu-list { right:auto; left:0; }
.co-agent-menu-list button { display:flex; align-items:flex-start; gap:10px; width:100%; padding:10px; border:0; border-radius:var(--co-radius-field); background:none; color:var(--text); text-align:left; font:inherit; cursor:pointer; }
.co-agent-menu-list button:hover,.co-agent-menu-list button:focus-visible { background:var(--surface-2,var(--surface)); outline:none; }
.co-agent-menu-list .co-icon { flex:none; margin-top:2px; color:var(--muted); }
.co-agent-menu-head { margin:0 0 4px; padding:8px 10px; border-bottom:1px solid var(--border); color:var(--muted); font-size:var(--co-text-meta); }
.co-agent-menu-head b { color:var(--text); font-weight:650; }
.co-agent-menu-standing { margin:0 0 6px; padding:0 10px 8px; color:var(--text); font-size:var(--co-text-meta); line-height:1.4; border-bottom:1px solid var(--border); }
.co-rw-reason { display:grid; gap:6px; margin:0 0 14px; }
.co-rw-reason textarea { font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:var(--co-radius-control); padding:10px 12px; resize:vertical; min-height:72px; }
.co-rw-reason small { color:var(--muted); font-size:var(--co-text-meta); }
.co-agent-menu-apart { margin-top:6px; padding-top:6px; border-top:1px solid var(--border); }
/* The Commits tab: GitHub's list, plus where the last review stopped. */
@media(max-width:680px) { .co-commits-again.is-pinned { display:none; } }
.co-commits-banner { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 12px; margin:0 0 14px; padding:10px 14px; border:1px solid color-mix(in srgb,var(--co-warn,#b38235) 45%,var(--border)); border-radius:var(--co-radius-panel); background:color-mix(in srgb,var(--co-warn,#b38235) 10%,var(--surface)); font-size:var(--co-text-meta); }
.co-commit-day h4 { margin:18px 0 8px; color:var(--muted); font-size:var(--co-text-meta); font-weight:600; }
.co-commit-day ul { margin:0; padding:0; list-style:none; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); overflow:hidden; }
.co-commit { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 16px; padding:12px 14px; }
.co-commit + .co-commit, .co-commit-seen + .co-commit { border-top:1px solid var(--border); }
.co-commit-main { flex:1 1 320px; min-width:0; }
.co-commit-title { display:inline; overflow-wrap:anywhere; font-size:var(--co-text-body); font-weight:600; }
.co-commit-body { display:inline-block; margin-left:6px; vertical-align:middle; }
.co-commit-body > summary { display:inline-grid; place-items:center; width:32px; height:24px; border-radius:var(--co-radius-pill); background:var(--surface-2); color:var(--muted); cursor:pointer; list-style:none; }
.co-commit-body > summary::-webkit-details-marker { display:none; }
.co-commit-body > div { margin-top:8px; padding:10px 12px; border-radius:var(--co-radius-field); background:var(--bg); color:var(--muted); font-size:var(--co-text-meta); white-space:pre-wrap; overflow-wrap:anywhere; }
.co-commit-meta { display:flex; flex-wrap:wrap; align-items:center; gap:2px 10px; margin:4px 0 0; color:var(--muted); font-size:var(--co-text-meta); }
.co-commit-agent { display:inline-flex; align-items:center; gap:4px; padding:0 8px; border-radius:var(--co-radius-pill); background:var(--accent-dim,var(--surface-2)); color:var(--co-you-text); font-weight:600; }
.co-commit-checks.is-ok { color:var(--green,#10b981); }
.co-commit-checks.is-bad { color:var(--danger,#f87171); }
.co-commit-checks.is-warn { color:var(--co-warn,#b38235); }
.co-commit-side { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; }
.co-commit-side code { color:var(--muted); font:var(--co-text-meta) var(--mono,monospace); }
.co-commit-seen { display:flex; align-items:center; gap:10px; padding:6px 14px; border-top:1px dashed var(--accent); color:var(--co-you-text); font-size:var(--co-text-meta); font-weight:600; background:var(--accent-dim,var(--surface-2)); }
@media(max-width:680px) { .co-commit-side { width:100%; } }
.co-state-line { display:flex; flex-wrap:wrap; gap:6px 4px; margin:12px 0 0; padding:0; list-style:none; font-size:var(--co-text-meta); color:var(--muted); }
.co-state-line li { display:inline-flex; align-items:center; gap:4px; }
.co-state-line li + li::before { content:'→'; margin-right:4px; color:var(--border); }
.co-state-line li.is-done { color:var(--text); }
.co-state-line li.is-current { color:var(--text); font-weight:700; }
.co-state-line li.is-current::after { content:''; width:6px; height:6px; border-radius:50%; background:var(--accent); }
/* The next step: pill, the machine's sentence, then the one filled button. */
.co-next-step { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; margin:12px 0 4px; padding:12px 14px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); }
.co-next-step .co-desk-chip { flex:0 0 auto; }
.co-next-hint { flex:1 1 220px; margin:0; color:var(--text); font-size:var(--co-text-meta); line-height:1.45; }
.co-next-step .co-btn { flex:0 0 auto; }
/* Phone: the button leaves the panel and pins to the foot of the page, above the safe area. */
.co-decision-bar { display:none; }
@media(max-width:680px) {
 .co-next-step .co-btn { display:none; }
 .co-decision-bar { display:flex; position:sticky; bottom:0; z-index:5; order:99; margin-top:12px; padding:12px 0 calc(12px + env(safe-area-inset-bottom)); background:var(--bg); border-top:1px solid var(--border); }
 .co-decision-bar .co-btn { flex:1 1 auto; }
}
.co-agent-menu-tile { flex:none; display:grid; place-items:center; width:32px; height:32px; border-radius:var(--co-radius-field); background:var(--surface-2,var(--bg)); }
.co-agent-menu-list .co-agent-menu-tile .co-icon { margin:0; }
.co-agent-menu-list button.is-rec { background:color-mix(in srgb,var(--accent) 12%,transparent); }
.co-agent-menu-list button.is-rec .co-agent-menu-tile { background:var(--accent); }
.co-agent-menu-list button.is-rec .co-agent-menu-tile .co-icon { color:var(--accent-fg,#fff); }
/* A row that cannot run dims its title and tile only: the reason below it keeps the muted text colour (4.5:1 and up). */
.co-agent-menu-list button.is-off { cursor:default; }
.co-agent-menu-list button.is-off strong,.co-agent-menu-list button.is-off .co-agent-menu-tile { opacity:.6; }
.co-agent-menu-list button.is-danger strong,.co-agent-menu-list button.is-danger .co-icon { color:var(--danger); }
.co-agent-menu-list button.is-danger:hover,.co-agent-menu-list button.is-danger:focus-visible { background:color-mix(in srgb,var(--danger) 10%,transparent); }
.co-agent-menu-list:focus { outline:none; }
.co-rw-option.is-line { display:block; margin:0; padding:14px 16px; cursor:default; }
.co-rw-option.is-line small { display:block; margin-top:2px; color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; }
.co-agent-menu-list button.is-off:hover { background:none; }
.co-agent-menu-list strong { display:block; font-size:var(--co-text-body); font-weight:600; }
.co-agent-menu-list small { display:block; margin-top:2px; color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; }

/* The agent review window: protected focus for a consent with public effects. */
.co-dialog-backdrop { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.6); }
.co-dialog { width:min(580px,100%); max-height:calc(100% - 40px); overflow:auto; overscroll-behavior:contain; scrollbar-width:none; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); box-shadow:0 24px 60px rgba(0,0,0,.45); animation:co-dialog-in .16s ease-out; }
.co-dialog::-webkit-scrollbar { display:none; }
@keyframes co-dialog-in { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:none; } }
.co-review-window { outline:none; }
.co-rw-head { display:grid; grid-template-columns:44px minmax(0,1fr) auto; gap:14px; align-items:start; padding:20px 20px 16px; border-bottom:1px solid var(--border); }
.co-rw-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:var(--co-radius-panel); background:var(--accent-dim); color:var(--accent); }
.co-rw-head h3 { margin:0; font-size:var(--co-text-section); font-weight:680; letter-spacing:-.015em; line-height:1.25; }
.co-rw-pr { margin:4px 0 0; font-size:var(--co-text-body); line-height:1.45; }
.co-rw-pr strong { display:block; font-weight:600; overflow-wrap:anywhere; }
.co-rw-pr span,.co-rw-list li span { display:block; color:var(--muted); font-size:var(--co-text-meta); }
.co-rw-list { margin:6px 0 0; padding-left:18px; font-size:var(--co-text-meta); }
.co-rw-close { display:grid; place-items:center; width:40px; height:40px; }
.co-rw-body { display:flex; flex-direction:column; gap:18px; padding:18px 20px 4px; }
.co-rw-options { border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--bg); }
.co-rw-who { display:flex; flex-direction:column; gap:12px; }
.co-rw-who-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px 16px; }
.co-rw-who .co-rw-label { margin:0; }
.co-rw-checks { list-style:none; margin:0; padding:0; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--bg); }
.co-rw-checks li + li { border-top:1px solid var(--border); }
.co-rw-check { display:flex; align-items:flex-start; gap:12px; padding:10px 14px; cursor:pointer; }
.co-rw-check input { flex:none; width:18px; height:18px; margin-top:2px; accent-color:var(--accent); cursor:pointer; }
.co-rw-check strong { display:block; font-size:var(--co-text-body); font-weight:600; }
.co-rw-check small { display:block; color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; }
.co-rw-rungs { display:grid; gap:8px; }
.co-rw-rung { display:flex; align-items:flex-start; gap:12px; width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--bg); color:var(--text); text-align:left; font:inherit; cursor:pointer; }
.co-rw-rung i { flex:none; width:16px; height:16px; margin-top:3px; border:2px solid var(--muted); border-radius:50%; }
.co-rw-rung.is-on { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,var(--bg)); }
.co-rw-rung.is-on i { border-color:var(--accent); background:radial-gradient(circle,var(--accent) 45%,transparent 50%); }
.co-rw-rung strong { display:block; font-size:var(--co-text-body); font-weight:600; }
.co-rw-rung small { display:block; color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; }
.co-rw-rung:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-seg { display:flex; width:max-content; max-width:100%; padding:3px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--bg); }
.co-seg button { min-height:var(--co-control-height); padding:0 14px; border:0; border-radius:var(--co-radius-field); background:none; color:var(--muted); font:500 var(--co-text-meta) var(--font); cursor:pointer; }
.co-seg button.is-on { background:var(--surface-2,var(--surface)); color:var(--text); font-weight:600; }
.co-seg button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.co-rw-option { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:center; padding:14px 16px; cursor:pointer; }
.co-rw-option + .co-rw-option { border-top:1px solid var(--border); }
.co-rw-option strong { display:block; font-size:var(--co-text-body); font-weight:600; }
.co-rw-option small { display:block; margin-top:2px; color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; }
.co-rw-option.is-off { cursor:default; }
.co-rw-option.is-off strong { color:var(--muted); }
input[type=checkbox].co-switch { appearance:none; -webkit-appearance:none; position:relative; flex:none; width:44px; height:26px; margin:0; border:1px solid var(--border); border-radius:var(--co-radius-round); background:var(--surface-2,var(--surface)); cursor:pointer; transition:background .15s,border-color .15s; }
input[type=checkbox].co-switch::after { content:''; position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:var(--muted); transition:transform .15s,background .15s; }
input[type=checkbox].co-switch:checked { border-color:var(--accent); background:var(--accent); }
input[type=checkbox].co-switch:checked::after { transform:translateX(18px); background:#fff; }
input[type=checkbox].co-switch:disabled { opacity:.45; cursor:default; }
input[type=checkbox].co-switch:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-rw-note,.co-rw-blocker { margin:0; padding:12px 14px; border-radius:var(--co-radius-panel); font-size:var(--co-text-body); }
.co-rw-note { border:1px dashed var(--border); color:var(--muted); }
.co-rw-blocker { background:color-mix(in srgb,var(--co-warn) 12%,transparent); color:var(--text); }
.co-rw-label { margin:0 0 -8px; color:var(--muted); font-size:var(--co-text-meta); font-weight:650; }
.co-rw-steps { margin:0; padding:0; list-style:none; }
.co-rw-steps li { position:relative; display:grid; grid-template-columns:26px minmax(0,1fr); gap:12px; align-items:start; padding:0 0 18px; font-size:var(--co-text-body); line-height:1.45; }
.co-rw-steps li:last-child { padding-bottom:0; }
.co-rw-steps li:not(:last-child)::before { content:''; position:absolute; left:12px; top:28px; bottom:2px; width:2px; border-radius:var(--co-radius-pill); background:var(--border); }
.co-rw-steps b { display:grid; place-items:center; width:26px; height:26px; border:1px solid var(--border); border-radius:50%; background:var(--bg); font-size:var(--co-text-meta); font-weight:700; }
.co-rw-steps li.is-added b { border-color:var(--accent); color:var(--accent); }
.co-rw-steps span { padding-top:2px; }
.co-rw-tools { display:flex; align-items:center; gap:2px; }
.co-rw-seen { position:relative; display:grid; }
.co-rw-seen.is-public { --seen:var(--co-warn); }
.co-rw-seen.is-private { --seen:var(--green); }
/* The lock (green: nothing reaches GitHub) and the globe (amber: something does) keep their own colour over the quiet button's. */
.co-rw-seen { --co-btn-tone:var(--seen); --co-btn-tone-fill:color-mix(in srgb,var(--seen) 14%,transparent); }
.co-btn.co-rw-seen-btn { display:grid; place-items:center; cursor:help; }
.co-rw-seen-card { position:absolute; z-index:3; top:calc(100% + 10px); right:0; width:min(300px,calc(100vw - 56px)); padding:12px 14px; border:1px solid color-mix(in srgb,var(--seen) 40%,var(--border)); border-radius:var(--co-radius-panel); background:var(--surface-2,var(--surface)); box-shadow:0 14px 36px rgba(0,0,0,.4); color:var(--text); font-size:var(--co-text-meta); line-height:1.5; opacity:0; visibility:hidden; transform:translateY(-4px); pointer-events:none; transition:opacity .14s ease,transform .14s ease,visibility 0s .14s; }
.co-rw-seen-card::before { content:''; position:absolute; top:-6px; right:15px; width:10px; height:10px; border-top:1px solid color-mix(in srgb,var(--seen) 40%,var(--border)); border-left:1px solid color-mix(in srgb,var(--seen) 40%,var(--border)); background:var(--surface-2,var(--surface)); transform:rotate(45deg); }
.co-rw-seen-btn:focus-visible + .co-rw-seen-card,.co-rw-seen.is-pinned .co-rw-seen-card { opacity:1; visibility:visible; transform:none; transition-delay:0s; }
@media (hover:hover) and (pointer:fine) { .co-rw-seen-btn:hover + .co-rw-seen-card { opacity:1; visibility:visible; transform:none; transition-delay:0s; } }
.co-rw-facts { margin:0; padding:0; list-style:none; display:grid; gap:10px; }
.co-rw-facts li { display:grid; grid-template-columns:20px minmax(0,1fr); gap:10px; align-items:start; font-size:var(--co-text-body); line-height:1.45; }
.co-rw-facts .co-icon { margin-top:2px; }
.co-rw-facts .is-ok .co-icon { color:var(--green); }
.co-rw-facts .is-warn .co-icon { color:var(--co-warn); }
.co-rw-facts .is-bad .co-icon { color:var(--danger,#e5534b); }
.co-rw-head.is-done .co-rw-icon { background:color-mix(in srgb,var(--green) 16%,transparent); color:var(--green); }
.co-rw-result { margin:0 0 4px; font-size:var(--co-text-body); line-height:1.5; }
.co-split { position:relative; display:inline-flex; }
.co-split .co-split-main { border-top-right-radius:0; border-bottom-right-radius:0; }
.co-split .co-split-more { min-width:40px; padding:0 10px; border-top-left-radius:0; border-bottom-left-radius:0; border-left:1px solid color-mix(in srgb,var(--accent-fg,#fff) 35%,transparent); }
.co-split .co-split-more > .co-icon { transition:transform .15s; }
.co-split .co-split-more[aria-expanded=true] > .co-icon { transform:rotate(180deg); }
.co-split-list { right:0; left:auto; }
.co-split .co-split-main { white-space:nowrap; min-height:42px; }
.co-run-primary > .co-split { min-width:112px; }
@media(max-width:680px) { .co-run-primary > .co-split { grid-column:1 / -1; width:100%; margin-top:2px; } .co-run-primary > .co-split .co-split-main { flex:1; } .co-split-list { left:0; right:0; width:auto; } }
.co-agent-menu-group { margin:8px 0 2px; padding:4px 10px 0; color:var(--muted); font-size:var(--co-text-meta); font-weight:650; }
.co-agent-menu-group:first-child { margin-top:2px; }
.co-rw-reasons { display:grid; gap:8px; }
.co-rw-reason { display:block; width:100%; min-height:48px; padding:0 16px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--bg); color:var(--text); font:600 var(--co-text-body) var(--font); text-align:left; cursor:pointer; }
.co-rw-reason:hover { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,var(--bg)); }
.co-rw-reason:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-rw-foot { display:flex; flex-direction:column; gap:12px; margin-top:14px; padding:16px 20px 20px; border-top:1px solid var(--border); }
.co-rw-foot > p { margin:0; color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; }
.co-rw-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; }
.co-rw-versions { margin:0; font-size:var(--co-text-meta); color:var(--muted); }
.co-rw-versions p { margin:6px 0 0; }
.co-selection-page .co-review-window { border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); }
@media(max-width:680px) {
 .co-dialog-backdrop { align-items:flex-end; padding:0; }
 .co-dialog { width:100%; max-height:92%; border-bottom:0; border-radius:var(--co-radius-panel) var(--co-radius-panel) 0 0; }
 .co-rw-head { grid-template-columns:40px minmax(0,1fr) auto; gap:12px; padding:16px; }
 .co-rw-icon { width:40px; height:40px; }
 .co-rw-body { padding:16px 16px 4px; }
 /* The review window's button stays on screen: the sheet scrolls, its footer does not (finding 3). */
 .co-rw-foot { position:sticky; bottom:0; z-index:1; margin-top:0; padding:14px 16px calc(18px + env(safe-area-inset-bottom)); background:var(--surface); }
 .co-rw-actions { flex-direction:column-reverse; align-items:stretch; }
}
/* Too narrow for the label beside the choices: the choices take their own full line. */
@media(max-width:450px) {
 .co-rw-who-row .co-seg { width:100%; }
 .co-rw-who-row .co-seg button { flex:1; padding:0 8px; }
}
@media(prefers-reduced-motion:reduce) {
 .co-dialog,.co-icon.is-spinning { animation:none; }
 .co-rw-seen-card { transition:none; }
 input[type=checkbox].co-switch,input[type=checkbox].co-switch::after,.co-agent-menu-button > .co-icon:last-child { transition:none; }
}
/* Project tabs: one tab per job under the status card and Needs you. */
.co-project-tabs { display:flex; gap:4px; margin:20px 0 0; border-bottom:1px solid var(--border); overflow-x:auto; scrollbar-width:none; }
.co-project-tabs::-webkit-scrollbar { display:none; }
.co-project-tab { position:relative; display:inline-flex; align-items:center; gap:8px; min-height:48px; padding:12px 14px; border:0; background:none; color:var(--muted); font:500 var(--co-text-body) var(--font); white-space:nowrap; cursor:pointer; }
.co-project-tab[aria-selected=true] { color:var(--text); }
.co-project-tab[aria-selected=true]::after { content:''; position:absolute; left:10px; right:10px; bottom:-1px; height:2px; border-radius:var(--co-radius-pill); background:var(--accent); }
.co-project-tab:hover { color:var(--text); }
.co-project-tab:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; border-radius:var(--co-radius-field); }
.co-tab-count { min-width:22px; padding:0 7px; border-radius:var(--co-radius-round); background:var(--surface-2,var(--surface)); color:var(--muted); font-size:var(--co-text-meta); font-weight:600; line-height:22px; text-align:center; font-variant-numeric:tabular-nums; }
.co-tab-count.is-you { background:var(--accent-dim); color:var(--co-you-text); }
.co-project-tabpanel { padding-top:16px; }
.co-workspace .co-project-tabpanel > .co-public-work { margin-top:0; }
.co-project-tabpanel > .co-cycle-outlet { margin-top:0; }
.co-project-tabpanel > .co-work-progress-row { margin-bottom:8px; }
.co-pr-intro,.co-mywork-empty { margin:0 0 14px; color:var(--muted); font-size:var(--co-text-body); }
.co-pr-filters { display:flex; gap:4px; overflow-x:auto; scrollbar-width:none; margin:0 0 10px; padding:2px; }
.co-pr-filters::-webkit-scrollbar { display:none; }
.co-pr-filters button { flex:0 0 auto; display:inline-flex; align-items:center; gap:7px; min-height:var(--co-control-height); padding:0 12px; border:1px solid transparent; border-radius:var(--co-radius-round); background:none; color:var(--muted); font:500 var(--co-text-meta) var(--font); cursor:pointer; }
.co-pr-filters button:hover { color:var(--text); background:var(--surface); }
.co-pr-filters button[aria-pressed=true] { color:var(--text); background:var(--surface-2,var(--surface)); border-color:var(--border); }
.co-pr-filters button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.co-pr-filter-count { color:var(--muted); font-variant-numeric:tabular-nums; }

/* Projects list: what kind each project is, and quiet apps folded away. */
.co-source-row-id { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.co-source-tag { padding:0 8px; border:1px solid var(--border); border-radius:var(--co-radius-round); color:var(--muted); font-size:var(--co-text-meta); font-weight:500; line-height:22px; }
.co-quiet-projects { border-top:1px solid var(--border); }
.co-quiet-projects > summary { display:flex; align-items:center; gap:10px; min-height:52px; padding:0 12px; color:var(--muted); font-size:var(--co-text-body); font-weight:500; list-style:none; cursor:pointer; }
.co-quiet-projects > summary::-webkit-details-marker { display:none; }
.co-quiet-projects > summary b { min-width:22px; padding:0 7px; border-radius:var(--co-radius-round); background:var(--surface-2,var(--surface)); font-size:var(--co-text-meta); font-weight:600; line-height:22px; text-align:center; }
.co-quiet-projects > summary .co-icon { margin-left:auto; transition:transform .15s; }
.co-quiet-projects[open] > summary .co-icon { transform:rotate(180deg); }
.co-quiet-projects > summary:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; border-radius:var(--co-radius-field); }
@media(max-width:680px) {
 .co-project-tabs { gap:0; }
 .co-project-tab { padding:12px 9px; font-size:var(--co-text-meta); gap:6px; }
 .co-project-tab[aria-selected=true]::after { left:6px; right:6px; }
}
@media(prefers-reduced-motion:reduce) { .co-quiet-projects > summary .co-icon { transition:none; } }

/* ---- The Desk home: side rail, views, one card per app ---- */
.co-desk { display:grid; grid-template-columns:248px minmax(0,1fr); gap:28px; align-items:start; }
.co-desk-pane { min-width:0; }
.co-rail { position:sticky; top:8px; display:flex; flex-direction:column; gap:2px; max-height:calc(100vh - 16px); overflow-y:auto; scrollbar-width:none; padding:2px; }
.co-rail::-webkit-scrollbar { display:none; }
.co-rail-item { display:flex; align-items:center; gap:10px; width:100%; min-height:var(--co-control-height); padding:6px 10px; border:0; border-radius:var(--co-radius-control); background:none; color:var(--text); font:500 var(--co-text-body) var(--font); text-align:left; cursor:pointer; }
.co-rail-item:hover { background:var(--surface-2); }
.co-rail-item[aria-current] { background:var(--accent-dim, var(--surface-2)); color:var(--accent); font-weight:600; }
.co-rail-item .co-icon { color:var(--muted); flex:0 0 auto; }
.co-rail-item[aria-current] .co-icon { color:var(--accent); }
.co-rail-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.co-rail-count { flex:0 0 auto; min-width:22px; padding:0 7px; border-radius:var(--co-radius-round); background:var(--surface-2); color:var(--text); font:600 var(--co-text-meta)/22px var(--font); text-align:center; }
.co-rail-count.is-you { background:var(--accent-dim, var(--surface-2)); color:var(--co-you-text); }
.co-rail-glyph { width:20px; height:20px; border-radius:var(--co-radius-pill); flex:0 0 auto; }
.co-rail-views,.co-rail-projects { display:flex; flex-direction:column; gap:2px; }
/* The projects are a block of their own under the four views (finding 2). */
.co-rail-projects { margin-top:22px; padding-top:6px; border-top:1px solid var(--border); }
.co-rail-head { margin:0; padding:14px 10px 6px; color:var(--muted); font:700 var(--co-text-meta) var(--font); letter-spacing:.05em; text-transform:uppercase; }
.co-rail-add { margin-top:6px; }
.co-rail-add .co-repository-trigger { width:100%; justify-content:flex-start; padding-inline:10px; }
.co-desk-counts button[aria-pressed=true] { border-color:var(--accent); background:var(--accent-dim, var(--surface-2)); }
.co-desk-quiet-line { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; margin:0 0 12px; color:var(--muted); font-size:var(--co-text-meta); }
.co-rail-quiet > summary { display:flex; align-items:center; gap:8px; min-height:38px; padding:6px 10px; border-radius:var(--co-radius-control); color:var(--muted); font:500 var(--co-text-meta) var(--font); cursor:pointer; list-style:none; }
.co-rail-quiet > summary::-webkit-details-marker { display:none; }
.co-rail-quiet > summary:hover { background:var(--surface-2); }
.co-rail-quiet > summary span { flex:1; }
.co-rail-quiet > summary b { font-weight:600; }
.co-rail-item.is-all { color:var(--muted); font-size:var(--co-text-meta); }
/* Phone only: the four views as one segmented bar, all on screen, count above the word. */
.co-desk-chips { display:none; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; position:sticky; top:0; z-index:5; margin:0 0 14px; padding:6px 0; background:var(--bg); }
.co-desk-chips button { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-height:var(--co-control-height); padding:4px 2px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--surface); color:var(--text); font:500 var(--co-text-meta) var(--font); cursor:pointer; }
.co-desk-chips button span { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.co-desk-chips button[aria-pressed=true] { border-color:var(--accent); background:var(--accent-dim, var(--surface-2)); color:var(--co-you-text); font-weight:600; }
.co-desk-chips button b { min-height:1.5em; font-weight:650; font-variant-numeric:tabular-nums; }
.co-desk-chips .co-desk-chips-projects { grid-column:1 / -1; flex-direction:row; gap:8px; min-height:36px; border-color:transparent; background:transparent; color:var(--muted); }
.co-desk-counts { display:flex; flex-wrap:wrap; gap:8px; margin:2px 0 10px; }
.co-desk-counts button { display:inline-flex; align-items:center; gap:8px; min-height:var(--co-control-height); padding:6px 12px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--surface); color:var(--text); font:500 var(--co-text-meta) var(--font); cursor:pointer; }
.co-desk-counts button:hover { border-color:var(--accent); }
.co-desk-counts button b { color:var(--accent); font-weight:700; font-variant-numeric:tabular-nums; }
.co-desk-legend { display:none; align-items:center; gap:7px; margin:0 0 14px; color:var(--muted); font-size:var(--co-text-meta); }
.co-desk-pane:has(.co-desk-row .co-newdot) .co-desk-legend { display:flex; }
.co-newdot { display:inline-block; flex:0 0 auto; width:7px; height:7px; border-radius:50%; background:var(--accent); }
.co-desk-search { display:flex; align-items:center; gap:9px; margin:0 0 16px; padding:0 12px; min-height:42px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--surface); color:var(--muted); }
.co-desk-search input { flex:1; min-width:0; border:0; background:none; color:var(--text); font:400 var(--co-text-body) var(--font); outline:none; }
.co-desk-envelopes { display:flex; flex-direction:column; gap:16px; }
.co-envelope { border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); overflow:hidden; }
.co-envelope-head { display:flex; align-items:center; gap:10px; padding:10px 14px; }
.co-envelope-head strong { min-width:0; font-size:var(--co-text-body); font-weight:650; overflow-wrap:anywhere; }
.co-envelope-head .co-project-icon,.co-envelope-head .co-source-tag,.co-envelope-head .co-rail-count { flex:none; }
.co-envelope-head .co-rail-count { margin-left:2px; }
.co-envelope-head .co-btn-quiet:not(.co-envelope-toggle) { margin-left:auto; }
.co-envelope-toggle { display:inline-flex; align-items:center; justify-content:center; width:44px; margin:-6px -8px -6px 0; padding:0; }
.co-envelope-toggle .co-icon { transition:transform .15s; }
.co-envelope-toggle[aria-expanded="true"] .co-icon { transform:rotate(180deg); }
@media (prefers-reduced-motion:reduce) { .co-envelope-toggle .co-icon { transition:none; } }
.co-envelope.is-folded .co-envelope-body { display:none; }
.co-envelope-glyph { width:22px; height:22px; border-radius:var(--co-radius-pill); }
.co-envelope-body { border-top:1px solid var(--border); }
.co-envelope-body > * + * { border-top:1px solid var(--border); }
.co-desk-row { display:flex; align-items:flex-start; gap:10px; width:100%; padding:12px 14px; border:0; background:none; color:var(--text); font:inherit; text-align:left; cursor:pointer; }
.co-desk-row:hover { background:var(--surface-2); }
.co-desk-row-split { display:flex; align-items:center; gap:10px; padding-right:14px; }
.co-desk-row-split > .co-desk-row { flex:1; min-width:0; }
.co-desk-row-action { flex:none; min-height:44px; }
@media(max-width:680px) { .co-desk-row-split { flex-direction:column; align-items:stretch; gap:0; padding:0 14px 12px; } .co-desk-row-split > .co-desk-row { padding-left:0; padding-right:0; } .co-desk-row-action { width:100%; } }
.co-desk-row.is-static { cursor:default; }
.co-desk-row.is-static:hover { background:none; }
.co-desk-row > .co-icon, .co-desk-row > .co-gh-state { margin-top:2px; }
.co-desk-row-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
.co-desk-row-title { font-size:var(--co-text-body); font-weight:600; line-height:1.4; overflow-wrap:anywhere; }
.co-desk-row-title .co-newdot { margin-right:7px; vertical-align:2px; }
.co-desk-row-labels { display:flex; flex-wrap:wrap; gap:4px; }
.co-desk-row-main > .co-pr-labels, .co-desk-row-main > .co-row-pills { margin-top:0; }
.co-desk-row-meta { display:flex; flex-wrap:wrap; align-items:center; gap:4px 12px; color:var(--muted); font-size:var(--co-text-meta); }
.co-desk-order { font-variant-numeric:tabular-nums; }
.co-desk-chip { padding:1px 8px; border-radius:var(--co-radius-pill); font-size:var(--co-text-meta); font-weight:600; background:var(--surface-2); color:var(--text); }
.co-desk-chip.is-you { background:var(--accent-dim, var(--surface-2)); color:var(--co-you-text); }
.co-desk-chip.is-blocker { background:color-mix(in srgb, var(--danger, #f87171) 14%, transparent); color:var(--co-blocker-text); }
.co-desk-chip.is-waiting { background:color-mix(in srgb, var(--co-warn,#b38235) 16%, transparent); color:var(--co-warn-text); }
.co-desk-chip.is-ready { background:color-mix(in srgb, var(--green, #10b981) 14%, transparent); color:var(--co-ready-text); }
.co-desk-merged-icon { color:var(--muted); margin-top:3px; }
.co-desk-row .co-pr-comments { margin-top:2px; }
.co-directory-add { margin:18px 0 0; }
.co-desk-back { display:inline-flex; align-items:center; gap:7px; min-height:40px; padding:6px 10px 6px 4px; margin:0 0 6px -4px; border:0; border-radius:var(--co-radius-field); background:none; color:var(--muted); font:600 var(--co-text-body) var(--font); cursor:pointer; }
.co-desk-back:hover { color:var(--text); background:var(--surface-2); }
.co-public-work.is-page .co-pr-detail { border:0; padding:0; }
/* The page scrolls as one: the PR page's comments never get their own inner
   scrollbar, and long comment lists fold behind Show all instead. */
.co-public-work.is-page .co-pr-detail-body { height:auto; min-height:0; max-height:none; overflow:visible; }
.co-comments-toggle { display:block; width:fit-content; margin:2px auto 10px; padding:8px 16px; }
.co-gh-description { margin:4px 0 2px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--surface); overflow:hidden; }
.co-gh-description > summary { display:flex; flex-direction:column; gap:2px; padding:11px 14px; cursor:pointer; list-style:none; }
.co-gh-description > summary::-webkit-details-marker { display:none; }
.co-gh-description > summary:hover { background:color-mix(in srgb,var(--surface-2) 50%,var(--surface)); }
.co-desc-title { display:flex; align-items:center; gap:8px; font:650 var(--co-text-body) var(--font); }
.co-desc-title .co-icon { transition:transform .15s; }
.co-gh-description:not([open]) .co-desc-title .co-icon { transform:rotate(-90deg); }
.co-gh-description > summary small { color:var(--muted); font-size:var(--co-text-meta); padding-left:22px; }
.co-pr-feedback-flag { display:flex; align-items:center; gap:8px; margin:8px 0 2px; padding:9px 13px; border-radius:var(--co-radius-control); font:500 var(--co-text-meta) var(--font); border:1px solid var(--border); }
.co-pr-feedback-flag b { font-weight:650; }
.co-pr-feedback-flag span { color:var(--muted); }
.co-pr-feedback-flag.is-blocker { border-color:color-mix(in srgb,var(--danger,#d4504c) 35%,var(--border)); background:color-mix(in srgb,var(--danger,#d4504c) 7%,var(--surface)); }
.co-pr-feedback-flag.is-blocker b, .co-pr-feedback-flag.is-blocker .co-icon { color:var(--danger,#d4504c); }
.co-pr-feedback-flag.is-news { border-color:color-mix(in srgb,var(--accent) 30%,var(--border)); background:color-mix(in srgb,var(--accent) 6%,var(--surface)); }
.co-pr-feedback-flag.is-news b, .co-pr-feedback-flag.is-news .co-icon { color:var(--accent); }
.co-pr-feedback-flag.is-clear { border-color:color-mix(in srgb,var(--green) 40%,var(--border)); background:color-mix(in srgb,var(--green) 7%,var(--surface)); }
.co-pr-feedback-flag.is-clear b, .co-pr-feedback-flag.is-clear .co-icon { color:var(--green); }
.co-copy-id { white-space:nowrap; flex:0 0 auto; border:1px solid var(--border); border-radius:var(--co-radius-pill); padding:1px 7px; background:var(--surface-2,var(--surface)); color:var(--muted); font:500 var(--co-text-meta) var(--mono,monospace); cursor:pointer; }
.co-copy-id:hover { color:var(--text); border-color:color-mix(in srgb,var(--accent) 34%,var(--border)); }
/* List rows at rest: the checkbox and Assign only when wanted. Labels are the same filled pills as on the PR page. */
.co-label-more { color:var(--muted); font-size:var(--co-text-meta); white-space:nowrap; }
.co-pr-row .co-pr-select { opacity:0; transition:opacity .12s; }
.co-pr-row:hover .co-pr-select, html[data-input="keyboard"] .co-pr-row:has(:focus-visible) .co-pr-select, .co-pr-row.is-selected .co-pr-select, .co-pr-box.has-selection .co-pr-row .co-pr-select { opacity:1; }
.co-pr-assign.is-quiet { opacity:0; transition:opacity .12s; }
.co-pr-row:hover .co-pr-assign.is-quiet, html[data-input="keyboard"] .co-pr-row:has(:focus-visible) .co-pr-assign.is-quiet, .co-pr-row.is-assigning .co-pr-assign.is-quiet { opacity:1; }
.co-pr-aside { gap:2px; }
.co-pr-headline { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.co-pr-headline .co-pr-open { flex:1; min-width:0; }
.co-pr-assign.is-quiet span { display:none; }
.co-pr-labels { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px; margin-top:4px; }
.co-pr-labels:empty { display:none; }
/* Pills (state, whose turn, agent) sit on the line after the labels, never inside the facts line. */
.co-row-pills { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px; margin-top:4px; }
.co-row-pills:empty { display:none; }
@media (hover:none) { .co-pr-row .co-pr-select, .co-pr-assign.is-quiet { opacity:1; } .co-pr-assign.is-quiet span { display:inline; } }
@media (prefers-reduced-motion:reduce) { .co-pr-row .co-pr-select, .co-pr-assign.is-quiet { transition:none; } }
.co-edits-head { display:flex; align-items:center; justify-content:space-between; gap:10px 16px; flex-wrap:wrap; margin:0 0 12px; }
.co-edits-head p { margin:0; font-size:var(--co-text-body); }
.co-edits-head small { display:block; color:var(--muted); font-size:var(--co-text-meta); }
.co-edits-head .co-btn { gap:8px; }
.co-project-edits .co-project-files { border-top:0; }
.co-rail-total { flex:0 0 auto; padding-right:7px; color:var(--muted); font:500 var(--co-text-meta)/22px var(--font); font-variant-numeric:tabular-nums; }
.co-desk-row-why { color:var(--muted); font-size:var(--co-text-meta); line-height:1.45; overflow-wrap:anywhere; }
.co-desk-row > .co-desk-attention-icon { margin-top:2px; color:var(--muted); }
.co-desk-row > .co-desk-attention-icon.is-blocker { color:var(--danger); }
.co-pr-detail .co-detail-tabs button { font-size:var(--co-text-body); }
.co-desc-content > .co-branch-flow { margin:0 0 10px; }
.co-file-tools { display:flex; align-items:center; gap:10px; margin:8px 0 6px; }
.co-file-tools input { flex:1; min-width:0; min-height:40px; padding:0 12px; border:1px solid var(--border); border-radius:var(--co-radius-field); background:var(--surface); color:var(--text); font:inherit; font-size:var(--co-text-meta); }
.co-file-disclosure > summary { display:flex; align-items:center; gap:10px; }
.co-file-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.co-file-status { flex:0 0 auto; color:var(--muted); font-size:var(--co-text-meta); font-style:normal; }
.co-file-stat { display:inline-flex; gap:8px; flex:0 0 auto; font:600 var(--co-text-meta) var(--mono,monospace); font-variant-numeric:tabular-nums; }
.co-file-add { color:var(--green); }
.co-file-del { color:var(--danger); }
@media(max-width:680px) {
 .co-pr-detail-actions { flex-wrap:nowrap; }
 .co-pr-detail .co-tab-more { display:none; }
 .co-pr-detail .co-detail-tabs { gap:14px; }
 .co-pr-detail .co-detail-tabs button { font-size:var(--co-text-meta); }
}
.co-markdown .co-md-image { display:inline-flex; align-items:center; gap:6px; margin:4px 0; padding:4px 10px; border:1px solid var(--border); border-radius:var(--co-radius-field); background:var(--surface); color:var(--accent); font-size:var(--co-text-meta); text-decoration:none; }
.co-markdown .co-md-image::before { content:'🖼'; font-size:var(--co-text-meta); }
.co-markdown .co-md-image:hover { border-color:color-mix(in srgb,var(--accent) 40%,var(--border)); }
/* Inline discussions and Related issues & PRs are not comments: a rule and a
   quiet heading separate each from the conversation above it. */
.co-related-section { margin-top:18px; padding-top:16px; border-top:1px solid var(--border); }
.co-related-section > h4 { margin:0 0 10px; color:var(--muted); font:650 var(--co-text-meta) var(--font); text-transform:uppercase; letter-spacing:.04em; }
.co-related-list { display:flex; flex-direction:column; gap:8px; margin:8px 0 4px; }
.co-related-row { display:flex; align-items:flex-start; gap:10px; padding:10px 13px; border:1px solid var(--border); border-radius:var(--co-radius-control); background:var(--surface); color:var(--text); text-decoration:none; overflow-wrap:anywhere; }
a.co-related-row:hover { border-color:color-mix(in srgb,var(--accent) 36%,var(--border)); background:color-mix(in srgb,var(--surface-2,var(--surface)) 55%,var(--surface)); }
.co-related-row .co-related-icon { flex:0 0 auto; margin-top:2px; }
.co-related-icon.is-pull { color:var(--green); }
.co-related-icon.is-issue { color:var(--co-warn,#b38235); }
.co-related-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.co-related-main strong { font-size:var(--co-text-body); font-weight:620; }
.co-related-main small { color:var(--muted); font-size:var(--co-text-meta); }
.co-desc-content { padding:12px 14px 12px; border-top:1px solid var(--border); }
.co-desc-body { position:relative; overflow:hidden; max-height:16em; }
.co-desc-body.is-open { max-height:none; }
.co-desc-body:not(.is-open)::after { content:''; position:absolute; left:0; right:0; bottom:0; height:30px; background:linear-gradient(transparent,var(--co-clamp-fade,var(--surface))); pointer-events:none; }
.co-skel { display:flex; flex-direction:column; gap:9px; padding:10px 2px; }
.co-skel span { display:block; height:12px; border-radius:var(--co-radius-pill); background:color-mix(in srgb,var(--muted) 14%,transparent); animation:co-skel-pulse 1.4s ease-in-out infinite; }
.co-skel span:nth-child(2) { animation-delay:.15s; }
.co-skel span:nth-child(3) { animation-delay:.3s; }
.co-skel span:nth-child(4) { animation-delay:.45s; }
@keyframes co-skel-pulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }
.co-pr-skel { padding:14px 16px; display:flex; flex-direction:column; gap:18px; border-top:1px solid var(--border); }
.co-pr-skel .co-skel { padding:0; }
@keyframes co-pane-in { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
.co-workspace,.co-pull-page,.co-desk-envelopes,.co-directory,.co-stage-empty { animation:co-pane-in .16s ease-out; }
@media(prefers-reduced-motion:reduce) { .co-skel span { animation:none; } .co-workspace,.co-pull-page,.co-desk-envelopes,.co-directory,.co-stage-empty { animation:none; } }
@media(prefers-reduced-motion:reduce) { .co-desc-title .co-icon { transition:none; } }
.co-pull-page .co-gh-pr-title { font-size:var(--co-text-section); letter-spacing:-.015em; }
.co-gh-labels { margin-top:8px; }
/* The comet frame: a faint base frame, with one comet travelling along it while an agent works. */
.co-frame { position:relative; border-radius:var(--frame-radius,12px); }
.co-frame[data-frame="reviewing"] { background:color-mix(in srgb,var(--accent) 5%,transparent); }
.co-frame-svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; z-index:2; }
.co-frame-track { fill:none; stroke:var(--accent); stroke-opacity:.26; }
.co-frame[data-frame="verdict"] .co-frame-track { stroke:var(--co-warn,#b38235); stroke-opacity:1; }
.co-frame[data-frame="reviewing"] .co-frame-svg { filter:drop-shadow(0 0 3px color-mix(in srgb,var(--accent) 80%,transparent)); }
.co-frame-comet { fill:none; stroke:var(--accent); stroke-linecap:butt; animation:co-comet 15s linear infinite; }
@keyframes co-comet { from { stroke-dashoffset:var(--L); } to { stroke-dashoffset:calc(var(--L) - var(--lap)); } }
@media(prefers-reduced-motion:reduce) { .co-frame-comet { animation:none; } .co-arc { animation:none; } }
/* A smooth gradient ring that fades out behind its head, like the comet. */
.co-arc { display:inline-block; width:14px; height:14px; flex:none; border-radius:50%; background:conic-gradient(from 0deg,transparent 0%,color-mix(in srgb,var(--accent) 35%,transparent) 40%,var(--accent) 100%); -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2.6px),#000 calc(100% - 2.2px)); mask:radial-gradient(farthest-side,transparent calc(100% - 2.6px),#000 calc(100% - 2.2px)); animation:co-arc-spin 1.05s linear infinite; will-change:transform; }
/* Both ends are the same kind of transform, so the browser turns it by rotating. */
@keyframes co-arc-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
/* The Review tab. */
.co-review-box { display:grid; gap:12px; padding:16px 18px; border:1px solid var(--border); border-radius:var(--co-radius-panel); background:var(--surface); }
.co-review-box > h4, .co-review-head h4 { margin:0; font-size:var(--co-text-body); letter-spacing:-.01em; }
.co-review-head { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; }
.co-review-head .co-review-version { margin-left:auto; color:var(--muted); font:var(--co-text-meta) var(--mono,monospace); }
.co-review-elapsed { color:var(--muted); font-variant-numeric:tabular-nums; font-size:var(--co-text-meta); }
.co-review-note { margin:0; color:var(--muted); font-size:var(--co-text-meta); }
.co-review-actions { display:flex; flex-wrap:wrap; justify-content:flex-start; gap:8px; }
.co-review-box > .co-btn, .co-review-box .co-review-actions .co-btn { margin-left:0; }
.co-review-box.is-clear { border-color:color-mix(in srgb,var(--green) 40%,var(--border)); }
.co-review-box.is-changes { border-color:color-mix(in srgb,var(--danger) 40%,var(--border)); }
.co-review-box.is-verdict { border-color:color-mix(in srgb,var(--co-warn,#b38235) 45%,var(--border)); }
.co-tab-dot.is-waiting { background:var(--co-warn,#b38235); }

@media(max-width:980px) {
  .co-desk { display:block; }
  .co-rail { display:none; }
  .co-desk-chips { display:grid; }
  .co-view-heading { flex-wrap:wrap; }
  .co-view-heading h2 { white-space:normal; }
}

/* Phone layout: full titles at a calmer size, details on one line, and edges
   that look scrollable on purpose. Rules above 680px are untouched. */
.co-pr-sub-num { display:none; }
.co-branch-to { display:inline-flex; align-items:center; flex:none; gap:7px; white-space:nowrap; }
.co-flag-text { display:flex; flex-wrap:wrap; align-items:baseline; gap:0 8px; min-width:0; }
.co-pr-feedback-flag { align-items:flex-start; }
.co-pr-feedback-flag > .co-icon { margin-top:3px; flex:0 0 auto; }
.co-copy-id { display:inline-grid; place-items:center; width:32px; height:32px; margin-left:auto; padding:0; border:0; border-radius:var(--co-radius-field); background:none; }
.co-copy-id:hover { background:var(--surface-2,var(--surface)); }
.co-pr-sticky { display:none; }
@property --co-fade-end { syntax:'<length>'; inherits:false; initial-value:0px; }
@keyframes co-fade-end { 0%,96% { --co-fade-end:28px; } 100% { --co-fade-end:0px; } }
@media(max-width:680px) {
 .co-pr-detail { display:flex; flex-direction:column; }
 .co-pr-detail .co-gh-pr-sub { order:-2; margin:2px 0 0; }
 .co-pr-detail .co-gh-pr-head { order:-1; padding-right:0; }
 .co-pr-detail .co-pr-title-num { display:none; }
 .co-pr-detail .co-pr-sub-num { display:inline; }
 .co-pull-page .co-gh-pr-title { margin-top:8px; font-size:var(--co-text-body); font-weight:600; line-height:1.32; letter-spacing:-.01em; }
 .co-pr-detail .co-gh-labels { margin-top:8px; }
 .co-pr-detail-actions { flex-wrap:wrap; margin:12px 0 10px; }
 .co-pr-detail .co-markdown { font-size:var(--co-text-body); line-height:1.5; }
 .co-gh-comment > .co-markdown, .co-gh-comment > div { padding:10px 12px; }
 .co-gh-comment > header { padding:6px 8px 6px 12px; }
 .co-pr-title { font-size:var(--co-text-body); line-height:1.38; }
 .co-desk-row-title { font-size:var(--co-text-body); line-height:1.38; }
 .co-branch-flow { display:flex; flex-direction:column; align-items:flex-start; gap:3px; }
 .co-attn-show, .co-attn-hide, .co-attn[open] .co-attn-hide { display:none; }
 .co-status-row { gap:6px 10px; min-height:0; padding:10px 12px; }
 .co-status-icon { width:32px; height:32px; }
 .co-status-actions { flex-basis:100%; padding-left:42px; }
 .co-pr-sticky { display:block; position:sticky; top:0; z-index:6; order:-3; height:0; margin-inline:-16px; }
 .co-pr-sticky > button { position:absolute; inset:0 0 auto 0; display:flex; align-items:center; gap:8px; width:100%; min-height:44px; padding:0 16px; border:0; border-bottom:1px solid var(--border); background:var(--surface); color:var(--text); font:600 var(--co-text-body) var(--font); text-align:left; cursor:pointer; opacity:0; visibility:hidden; transform:translateY(-6px); transition:opacity .14s ease-out,transform .14s ease-out,visibility 0s .14s; }
 .co-pr-sticky[data-shown=true] > button { opacity:1; visibility:visible; transform:none; transition-delay:0s; }
 .co-sticky-text { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
 .co-sticky-text i { margin-right:6px; color:var(--muted); font-style:normal; font-weight:500; }
 .co-sticky-mark { flex:0 0 auto; color:var(--muted); }
 .co-sticky-mark.is-blocker { color:var(--danger,#d4504c); }
 .co-sticky-mark.is-news { color:var(--accent); }
}
@supports (animation-timeline: scroll()) {
 @media(max-width:680px) {
  .co-project-tabs, .co-pr-filters, .co-pr-detail .co-detail-tabs { -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - var(--co-fade-end)),transparent); mask-image:linear-gradient(90deg,#000 calc(100% - var(--co-fade-end)),transparent); animation:co-fade-end linear both; animation-timeline:scroll(self inline); }
 }
}
@media(prefers-reduced-motion:reduce) { .co-pr-sticky > button { transition:none; } }
`
