// Approved continuous project workspace. Theme remains owned by the shell.
export const WORKSPACE_CSS = `
.co-header-shell { width:100%; max-width:none; }
.co-header { position:relative; width:100%; max-width:1192px; padding:8px 36px; border-bottom:0; }
.co-header::after { content:''; position:absolute; left:44px; right:44px; bottom:0; height:1px; background:var(--border); }
.co-title { font-size:18px; font-weight:600; letter-spacing:-.015em; }
.co-brand-icon { width:34px; height:34px; }
.co-header-back { display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:6px 4px; border:0; background:none; color:var(--text); font:600 16px var(--font); cursor:pointer; }
.co-header-back:hover { color:var(--accent); }
.co-icon-action { display:inline-grid; place-items:center; flex:0 0 44px; width:44px; height:44px; padding:0; border:0; border-radius:10px; background:transparent; color:var(--muted); cursor:pointer; }
.co-icon-action:hover { color:var(--text); background:var(--surface-2); }
.co-icon-action:disabled { cursor:default; opacity:.5; }
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
.co-workspace-title h2 { font-size:24px; font-weight:600; line-height:1.25; letter-spacing:-.025em; margin:0; overflow-wrap:anywhere; }
.co-workspace-title p { display:flex; flex-wrap:wrap; align-items:center; gap:0 12px; font-size:14px; color:var(--muted); margin:4px 0 0; overflow-wrap:anywhere; }
.co-workspace-body,.co-workspace-inventory { display:block; padding:0; overflow:visible; }
.co-task-content { position:relative; margin:18px 0 24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow-wrap:anywhere; outline-offset:4px; }
.co-inline-close { position:absolute; right:12px; top:10px; width:44px; justify-content:center; }
/* The close X shares its row with a pane's heading. A focused contribution
   opens with a notice box instead, so it starts below the X. */
.co-task-content > .co-run-focus-layout { margin-top:36px; }
.co-task-content > h3,.co-task-content > section > h3 { padding-right:32px; }
.co-task-content h3 { font-size:19px; font-weight:600; line-height:1.4; letter-spacing:-.015em; margin:0 0 14px; }
.co-task-content p { font-size:16px; color:var(--muted); line-height:1.6; margin:10px 0 18px; max-width:72ch; }
.co-task-scope { display:flex; flex-wrap:wrap; align-items:center; gap:16px; padding:8px 0; }
.co-task-scope > span { font-size:14px; color:var(--muted); }
.co-task-primary { margin-top:16px; white-space:normal; width:auto; }
.co-task-content .co-workflow-option { align-items:flex-start; gap:12px; padding:0; border:0; background:none; font-size:15px; margin:16px 0; }
.co-workflow-option small { display:block; margin-top:4px; font-size:14px; color:var(--muted); line-height:1.55; }
.co-task-content .co-task-footnote { font-size:14px; margin:10px 0 20px; }
.co-task-details { margin-top:20px; border-top:1px solid var(--border); padding-top:10px; }
.co-task-details summary { min-height:44px; cursor:pointer; color:var(--muted); font-size:14px; align-content:center; }
.co-task-steps { padding-left:20px; color:var(--muted); font-size:15px; }
.co-task-steps li { padding:5px 0; }
.co-local-work > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
.co-local-work > header h3 { font-size:16px; font-weight:600; margin:0; letter-spacing:-.01em; }
.co-prepare-scope { display:grid; grid-template-columns:minmax(0,1fr) 18px; align-items:center; gap:12px; width:100%; min-height:64px; padding:10px 0; border:0; border-block:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; }
.co-prepare-scope span { min-width:0; }
.co-prepare-scope small,.co-prepare-scope strong { display:block; }
.co-prepare-scope small { color:var(--muted); font-size:14px; margin-bottom:2px; }
.co-prepare-scope strong { font-size:16px; font-weight:600; }
.co-task-content .co-task-primary { width:100%; justify-content:center; margin-top:18px; }
.co-work-progress-row { display:flex; width:100%; align-items:center; gap:10px; padding:14px 0; background:none; color:var(--accent); border:0; font-size:15px; cursor:pointer; }
.co-work-progress-row > span:not(.co-working-icon) { min-width:0; text-align:left; }
.co-work-progress-row strong,.co-work-progress-row small { display:block; overflow-wrap:anywhere; }
.co-work-progress-row strong { font-size:15px; font-weight:600; color:var(--text); }
.co-work-progress-row small { margin-top:4px; font-size:14px; line-height:1.5; color:var(--muted); }
.co-work-progress-row > .co-icon:last-child { margin-left:auto; flex-shrink:0; }
.co-working-icon { display:inline-flex; align-items:center; flex:0 0 auto; color:var(--accent); animation:co-work-breathe 1.6s ease-in-out infinite; }
.co-inventory-note { margin:8px 0 14px; max-width:72ch; color:var(--muted); font-size:14px; line-height:1.55; }
@keyframes co-work-breathe { 0%,100% { opacity:1; } 50% { opacity:.55; } }
@media(prefers-reduced-motion:reduce) { .co-working-icon { animation:none; } }

.co-workspace .co-run { margin-top:32px; padding-top:0; }
.co-workspace .co-run > * { margin-top:16px; }
.co-workspace .co-run > :first-child { margin-top:0; }
.co-workspace .co-run-primary { border:0; border-radius:0; border-bottom:1px solid var(--border); background:none; padding:6px 0; min-height:52px; }
.co-workspace .co-local-summary { display:grid; grid-template-columns:24px minmax(0,1fr) 16px; align-items:center; gap:10px; width:100%; min-height:62px; padding:10px 0; border:0; border-bottom:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; }
.co-workspace .co-local-summary > span { min-width:0; }
.co-workspace .co-local-summary strong,.co-workspace .co-local-summary small { display:block; min-width:0; }
.co-workspace .co-local-summary strong { font-size:15px; line-height:1.35; font-weight:650; }
.co-workspace .co-local-summary small { margin-top:2px; overflow:hidden; color:var(--muted); font-size:14px; line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
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
.co-workspace .co-task-dock { position:fixed; left:50%; right:auto; top:auto; bottom:max(16px,env(safe-area-inset-bottom)); width:calc(100% - 48px); max-width:800px; margin:0; z-index:20; background:var(--surface); border:1px solid color-mix(in srgb,var(--border) 72%,var(--text)); border-radius:16px; box-shadow:0 18px 58px color-mix(in srgb,#000 34%,transparent); transform:translateX(-50%); }

.co-workspace .co-task-dock { width:min(720px,calc(100% - 48px)); padding:28px; max-height:78dvh; overflow:auto; overscroll-behavior:contain; }
.co-task-dock .co-inline-close { position:sticky; top:0; float:right; margin:-12px -10px 0 12px; background:var(--surface); z-index:1; }
.co-workspace .co-task-dock > .co-run-approval { margin:0; overflow:visible; border:0; border-radius:0; background:transparent; }
.co-workspace .co-task-dock > .co-run-approval > header { padding:0 36px 16px 0; }
.co-workspace .co-task-dock > .co-run-approval h3 { margin:0; font-size:22px; line-height:1.3; letter-spacing:-.02em; }
.co-workspace .co-task-dock > .co-run-approval header p { margin:8px 0 0; font-size:16px; line-height:1.55; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list { max-height:min(35dvh,320px); border:1px solid var(--border); border-radius:10px; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list li { background:var(--surface-2); }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list strong { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-actions { padding:16px 0 0; }
.co-workspace .co-btn { border-radius:7px; }
.co-workspace .co-btn:not(.co-btn-primary):hover:not(:disabled) { background:var(--surface-2); border-color:color-mix(in srgb,var(--accent) 35%,var(--border)); }


.co-detail-tabs { width:fit-content; max-width:100%; background:none; padding:0; gap:16px; border-bottom:1px solid var(--border); }
/* Assign: title, a one-line subtitle, then people in three equal columns.
   The grid scrolls when it is long, without showing a scrollbar. */
.co-pr-assignment h3 { margin:0; }
.co-task-content .co-pr-assignment-note { margin:4px 0 0; font-size:15px; line-height:1.5; }
.co-person-search { width:100%; margin:16px 0 12px; }
.co-person-list { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px 12px; max-height:248px; overflow-y:auto; scrollbar-width:none; }
.co-person-list::-webkit-scrollbar { display:none; }
.co-person-option { display:flex; align-items:center; gap:12px; width:100%; min-width:0; min-height:56px; padding:8px 10px; background:none; border:0; border-radius:8px; color:var(--text); text-align:left; cursor:pointer; font-size:16px; }
.co-person-option:hover { background:var(--surface-2); }
.co-person-text { display:grid; min-width:0; }
.co-person-text > span,.co-person-text > small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.co-person-text > small { color:var(--muted); font-size:14px; }
@media(max-width:680px) { .co-person-list { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:420px) { .co-person-list { grid-template-columns:minmax(0,1fr); } }
.co-avatar { flex:none; display:inline-grid; place-items:center; width:32px; height:32px; background:var(--accent-dim); color:var(--accent); border-radius:50%; }
.co-pr-detail { width:100%; padding:0; min-width:0; }
.co-detail-tabs { display:flex; margin-bottom:20px; }
.co-detail-tabs button { background:none; border:0; border-bottom:2px solid transparent; border-radius:0; color:var(--muted); min-height:48px; font-size:14px; cursor:pointer; padding:8px 0; }
.co-detail-tabs button[aria-pressed=true] { color:var(--text); border-bottom-color:var(--text); }
.co-pr-detail .co-markdown { font-size:16px; line-height:1.65; max-width:72ch; }
.co-pr-detail .co-board-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
.co-detail-stats { display:flex; gap:8px 16px; flex-wrap:wrap; color:var(--muted); font-size:14px; margin:12px 0; font-variant-numeric:tabular-nums; }
.co-file-disclosure { padding:8px 0; border-bottom:1px solid var(--border); }
.co-file-disclosure summary { cursor:pointer; overflow-wrap:anywhere; font-size:14px; min-height:44px; align-content:center; }
.co-file-disclosure pre { overflow:auto; max-height:480px; padding:16px; background:var(--surface); font:13px/1.6 var(--mono,monospace); }
.co-activity-item { padding:14px 0; border-bottom:1px solid var(--border); }
.co-activity-item > header { font-size:14px; color:var(--muted); }
.co-group-members { margin-top:20px; }
.co-group-member { border-bottom:1px solid var(--border); padding:10px 0; }
.co-group-member > summary { cursor:pointer; min-height:44px; font-size:16px; align-content:center; }
.co-group-count { color:var(--muted); font-size:14px; margin:6px 0; }
.co-workspace input:not([type=checkbox]) { font-size:16px; min-height:44px; color:var(--text); background:var(--surface); padding:8px 12px; border:1px solid var(--border); border-radius:8px; }
.co-workspace input[type=checkbox] { width:18px; height:18px; accent-color:var(--accent); flex-shrink:0; }
.co-workspace .co-quiet-action,.co-workspace summary { min-height:44px; }
.co-workspace :is(button,a,summary) { text-underline-offset:3px; }
.co-workspace ::selection { color:var(--text); background:var(--accent-dim); }
.co-workspace :is(input,textarea) { caret-color:var(--accent); }
.co-page { scrollbar-width:thin; scrollbar-color:var(--border) transparent; }
.co-review-history > p { padding:0 12px; }
.co-review-history-entry { display:block; box-sizing:border-box; width:100%; min-height:44px; padding:12px; border:0; border-bottom:1px solid var(--border); background:none; color:inherit; font:inherit; text-align:left; overflow-wrap:anywhere; cursor:pointer; }
.co-review-history-entry > span,.co-review-history-entry small { display:block; margin-top:4px; }
.co-review-history-entry small { color:var(--muted); }
.co-task-pulls > div { padding:14px 0; border-bottom:1px solid var(--border); }
.co-task-pulls strong { font-size:16px; display:block; }
.co-task-pulls .co-markdown { margin-top:8px; font-size:15px; }
.co-task-pulls a { display:inline-flex; align-items:center; font-size:14px; color:var(--accent); min-height:44px; }
.co-task-secondary { margin:12px 10px 0 0; }
.co-scope-row { display:grid; grid-template-columns:1fr auto; gap:6px 12px; width:100%; padding:16px 0; border:0; border-bottom:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; min-height:64px; }
.co-scope-row strong { font-size:16px; }
.co-scope-row span { font-size:14px; color:var(--muted); grid-column:1; }
.co-scope-row .co-icon { grid-column:2; grid-row:1 / 3; align-self:center; }
.co-workspace .co-run-list { border:0; border-radius:0; background:none; }
.co-workspace .co-run-row { background:none; border-bottom:1px solid var(--border); padding:12px 0; }
.co-workspace .co-run-row-main { grid-template-columns:minmax(0,1fr); }
.co-workspace .co-run-row-icon { display:none; }
.co-workspace .co-run-row-main strong { font-size:15px; font-weight:500; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.co-workspace .co-run-row-main small { white-space:normal; }
.co-workspace .co-run-row-action { min-height:44px; border-radius:7px; font-weight:500; }
.co-workspace .co-run-fold { background:none; }
.co-directory { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:16px; }
.co-directory .co-project-search { margin:0; }
.co-directory > :not(.co-project-search):not(.co-directory-filters) { grid-column:1/-1; }
.co-directory-filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.co-directory-filters button { display:inline-flex; align-items:center; gap:7px; min-height:44px; padding:8px 14px; border:1px solid var(--border); border-radius:18px; background:var(--surface); color:var(--muted); font:600 14px var(--font); cursor:pointer; }
.co-directory-filters button[aria-pressed=true],.co-directory-filters button:hover { color:var(--text); border-color:color-mix(in srgb,var(--accent) 34%,var(--border)); background:var(--accent-dim); }
.co-directory-filters button span { min-width:20px; padding:1px 6px; border-radius:10px; background:var(--bg); color:var(--muted); font-variant-numeric:tabular-nums; }
.co-task-dock:focus-visible,.co-task-dock [tabindex="-1"]:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
/* Inline panes take focus only so keyboard users land in them; their border
   already marks them, so the browser ring would trace a second, tight frame. */
.co-task-content:not(.co-task-dock):focus,.co-task-content:not(.co-task-dock) [tabindex="-1"]:focus { outline:none; }
.co-workspace .co-task-dock { animation:co-dock-arrive .18s cubic-bezier(.16,1,.3,1); }
.co-connect-banner { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:0 0 20px; padding:16px 18px; border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border)); border-radius:12px; background:color-mix(in srgb,var(--accent-dim) 42%,var(--surface)); }
.co-connect-banner strong { display:block; font-size:16px; font-weight:650; }
.co-connect-banner p { margin:4px 0 0; max-width:64ch; color:var(--muted); font-size:14px; line-height:1.5; }
@media(max-width:680px) { .co-connect-banner { align-items:stretch; flex-direction:column; gap:12px; margin-bottom:16px; } .co-connect-banner .co-btn { width:100%; justify-content:center; } }
@keyframes co-dock-arrive { from { transform:translate(-50%,12px); } to { transform:translate(-50%,0); } }
@keyframes co-dock-arrive-mobile { from { transform:translateY(12px); } to { transform:translateY(0); } }
@media(prefers-reduced-motion:reduce) { .co-workspace .co-task-dock { animation:none; } }
@media(max-width:680px) {
 .co-header { padding:6px 18px; }
 .co-header::after { left:18px; right:18px; }
 .co-projects-view { padding:20px 18px 60px; }
 .co-workspace-head { gap:14px; }
 .co-workspace-title h2 { font-size:22px; }
 .co-task-content { padding:20px; }
 .co-pr-detail { padding:12px 0; }
 .co-workspace .co-task-dock { left:8px; right:8px; width:auto; bottom:max(8px,env(safe-area-inset-bottom)); border-radius:18px; transform:none; }
 .co-workspace .co-task-dock { padding:20px; max-height:76dvh; animation-name:co-dock-arrive-mobile; }
 .co-directory { grid-template-columns:1fr; }
 .co-directory-filters { width:100%; }
}
.co-other-repositories { margin-top:28px; border-top:1px solid var(--border); }
.co-other-repositories > summary { display:flex; align-items:center; gap:12px; min-height:56px; font-size:16px; cursor:pointer; }
.co-other-repositories > summary span { color:var(--muted); font-size:14px; }
.co-other-repositories > p { max-width:72ch; margin:0 0 12px; color:var(--muted); font-size:14px; line-height:1.55; text-wrap:pretty; }
/* Agent picker: the chat composer's model rows and effort track (sizes kept in
   step with the shell's ChatSettingsPanel/EffortStepper), behind a compact trigger. */
.co-agent-picker { max-width:440px; margin:4px 0 18px; }
.co-agent-trigger { display:flex; align-items:center; gap:10px; width:100%; min-height:48px; padding:6px 10px; border:1px solid var(--border); border-radius:10px; background:var(--surface); color:var(--text); font:inherit; text-align:left; cursor:pointer; }
.co-agent-trigger:hover { background:var(--surface-2,var(--surface)); }
.co-agent-trigger:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-agent-trigger-label { color:var(--muted); font-size:14px; min-width:44px; }
.co-agent-trigger-value { flex:1; min-width:0; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.co-agent-trigger-value strong { font-size:14px; font-weight:500; }
.co-agent-trigger-value small { color:var(--muted); font-size:14px; }
.co-agent-trigger-chevron { color:var(--muted); transition:transform .15s; }
.co-agent-trigger[aria-expanded="true"] .co-agent-trigger-chevron { transform:rotate(180deg); }
.co-model-list { margin-top:6px; padding:6px; border:1px solid var(--border); border-radius:12px; background:var(--bg); max-height:min(50vh,380px); overflow:auto; overscroll-behavior:contain; }
.co-model-row { display:flex; align-items:center; gap:12px; width:100%; padding:8px 10px; border:0; border-radius:8px; background:none; color:var(--text); font:inherit; text-align:left; cursor:pointer; }
@media (hover:hover) and (pointer:fine) { .co-model-row:hover { background:var(--surface); } .co-model-row.is-selected:hover { background:color-mix(in srgb,var(--accent) 12%,var(--surface)); } }
.co-model-row.is-selected { background:color-mix(in srgb,var(--accent) 9%,var(--surface)); }
.co-model-row:disabled { opacity:.4; cursor:not-allowed; }
.co-model-row:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-model-mark { width:30px; height:30px; flex-shrink:0; display:grid; place-items:center; border-radius:8px; background:var(--surface); border:1px solid rgba(255,255,255,.07); color:var(--text); font-size:14px; font-weight:600; }
[data-theme="light"] .co-model-mark { border-color:rgba(15,18,25,.10); }
.co-model-row.is-selected .co-model-mark { background:var(--surface-2,var(--surface)); }
.co-model-mark-mobius { display:block; width:23px; height:23px; }
[data-theme="light"] .co-model-mark-mobius { filter:invert(1); }
.co-model-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.co-model-title { font-size:14px; font-weight:500; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.co-model-sub { font-size:14px; color:var(--muted); line-height:1.4; }
.co-model-dot { position:relative; width:16px; height:16px; flex-shrink:0; border:1.5px solid var(--border); border-radius:50%; transition:border-color .12s; }
.co-model-row.is-selected .co-model-dot { border-color:var(--accent); background:var(--accent); }
.co-model-row.is-selected .co-model-dot::after { content:''; position:absolute; left:4px; top:2px; width:5px; height:8px; border:1.5px solid var(--accent-fg,#fff); border-top:0; border-left:0; transform:rotate(45deg); }
.co-effort-indent { margin:4px 12px 8px 52px; }
.co-effort { display:flex; flex-wrap:wrap; align-items:center; gap:0 12px; min-width:0; }
.co-effort.is-disabled { opacity:.55; }
/* The track never squeezes its 44px stops: when the row is too narrow the
   label moves to its own line instead (phones, six effort levels). */
.co-effort-track { position:relative; flex:1 1 auto; min-width:min-content; height:44px; display:flex; align-items:center; justify-content:space-between; }
.co-effort-track::before { content:''; position:absolute; left:22px; right:22px; top:50%; height:2px; background:var(--border); border-radius:2px; transform:translateY(-50%); }
/* Each stop is a 44px target; the 13px dot is only its visible mark. */
.co-effort-stop { position:relative; width:44px; height:44px; flex-shrink:0; padding:0; border:0; border-radius:50%; background:none; cursor:pointer; }
.co-effort-stop::before { content:''; position:absolute; left:50%; top:50%; box-sizing:border-box; width:13px; height:13px; border:1.5px solid var(--border); border-radius:50%; background:var(--surface); transform:translate(-50%,-50%); transition:background .15s,border-color .15s,transform .15s; }
@media (hover:hover) and (pointer:fine) { .co-effort-stop:hover:not(:disabled)::before { border-color:var(--accent); } }
.co-effort-stop.is-filled::before,.co-effort-stop.is-on::before { background:var(--accent); border-color:var(--accent); }
.co-effort-stop.is-on::before { transform:translate(-50%,-50%) scale(1.3); box-shadow:0 0 0 3px var(--accent-dim); }
.co-effort-stop:disabled { cursor:not-allowed; }
.co-effort-stop:focus-visible { outline:2px solid var(--accent); outline-offset:-8px; }
.co-effort-label { min-width:70px; font-size:14px; font-weight:500; color:var(--text); white-space:nowrap; text-align:right; }
.co-model-note { margin:8px 10px; color:var(--muted); font-size:14px; }
.co-model-note button { margin-left:6px; border:0; background:none; color:var(--accent); font:inherit; cursor:pointer; text-decoration:underline; }
@media (max-width:520px) { .co-model-row { min-height:44px; gap:10px; padding:7px 8px; } .co-effort-indent { margin-left:8px; margin-right:8px; } .co-effort-label { order:-1; flex-basis:100%; min-width:0; text-align:left; } }
@media (prefers-reduced-motion:reduce) { .co-effort-stop::before,.co-agent-trigger-chevron { transition:none; } }
.co-change-total { display:inline-flex; align-items:baseline; gap:7px; font-variant-numeric:tabular-nums; }
.co-change-total b { color:var(--green); font-weight:650; }
.co-change-total em { color:var(--danger); font-style:normal; font-weight:650; }
.co-root { user-select:text; -webkit-user-select:text; }
.co-source-row,.co-card-title,.co-run-row-main,.co-run-quiet-row { user-select:text; -webkit-user-select:text; }
/* Disclosure content can inherit content-box through the browser’s details pseudo-element. */
.co-source-row { box-sizing:border-box; min-height:88px; padding:13px 12px; border-radius:12px; }
.co-source-row .co-source-glyph { grid-row:1; align-self:center; }
.co-btn > .co-icon,.co-quiet-action > .co-icon,.co-icon-btn > .co-icon,.co-source-row-cue > .co-icon { flex:0 0 auto; align-self:center; margin:0; }
.co-icon-btn { line-height:0; }
.co-repository-picker { position:relative; }
.co-repository-trigger { white-space:nowrap; }
.co-repository-picker form { position:absolute; right:0; top:100%; z-index:5; width:min(500px,calc(100vw - 36px)); padding:20px; background:var(--bg); border:1px solid var(--border); border-radius:12px; }
.co-repository-picker form > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.co-repository-picker form > header strong { font-size:16px; }
.co-repository-picker form > header .co-quiet-action { padding-inline:4px; }
.co-repository-picker label { display:block; margin-bottom:8px; font-size:15px; }
.co-repository-picker form > div { display:flex; align-items:center; gap:12px; }
.co-repository-picker input { min-width:0; width:100%; min-height:44px; padding:10px 12px; font-size:16px; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; }
.co-repository-picker p { color:var(--muted); font-size:14px; line-height:1.5; }
.co-repository-note { position:absolute; right:0; top:100%; z-index:5; width:min(320px,calc(100vw - 36px)); padding:16px; border:1px solid var(--border); border-radius:12px; background:var(--bg); }
@media(max-width:520px) {
 .co-view-heading { display:flex; align-items:center; gap:8px; }
 .co-view-heading h2 { white-space:nowrap; }
 .co-project-view-actions { flex-direction:row; align-items:center; gap:8px; }
 .co-project-view-actions { margin-left:auto; }
 .co-repository-picker form { position:fixed; left:8px; right:8px; top:auto; bottom:max(8px,env(safe-area-inset-bottom)); z-index:70; width:auto; max-height:calc(100dvh - 16px); overflow:auto; box-sizing:border-box; border-radius:18px; box-shadow:0 18px 58px color-mix(in srgb,#000 34%,transparent); }
 .co-repository-note { position:fixed; left:8px; right:8px; top:auto; bottom:max(8px,env(safe-area-inset-bottom)); width:auto; box-sizing:border-box; border-radius:18px; }
 .co-repository-picker form > div { display:grid; grid-template-columns:minmax(0,1fr) auto; }
}
.co-selection-page { width:100%; max-width:760px; margin:0 auto; padding:28px; }
.co-selection-page > .co-quiet-action { min-height:44px; margin-bottom:20px; }
.co-selection-page h2,.co-selection-page h3 { font-size:26px; line-height:1.25; letter-spacing:-.02em; }
.co-selection-page p { font-size:16px; line-height:1.6; color:var(--muted); }
.co-selection-page .co-board-actions { margin-top:24px; }
@media(max-width:680px) { .co-selection-page { padding:20px; } }

/* Compact project position leaves the PR inventory as the primary surface. */
.co-project-position { border-block:1px solid var(--border); margin:0 0 18px; padding:4px 0; }
.co-position-line { display:flex; align-items:center; gap:12px; min-height:52px; }
.co-position-line + .co-position-line { margin-top:8px; }
.co-position-line > .co-icon { flex-shrink:0; color:var(--muted); }
.co-position-line > .co-btn { flex:0 0 auto; min-height:44px; padding:8px 12px; font-size:14px; }
.co-workspace .co-pr-assignment { padding:0; background:none; border:0; border-radius:0; }
.co-workspace .co-run { margin-top:0; }
.co-workspace .co-public-work { margin-top:0; }
.co-workspace .co-run-primary { display:flex; align-items:center; gap:16px; padding:12px 0; margin:0; border:0; border-bottom:1px solid var(--border); border-radius:0; background:none; }
.co-workspace .co-run-primary-mark { display:none; }
.co-workspace .co-run-primary > div { flex:1; min-width:0; }
.co-workspace .co-run-primary strong { font-size:15px; font-weight:600; }
.co-workspace .co-run-primary p { font-size:14px; margin:4px 0 0; }
.co-workspace .co-run-primary .co-btn { min-height:44px; font-size:14px; padding:8px 12px; background:var(--surface-2); color:var(--text); border:1px solid var(--border); }
.co-workspace .co-run-fold { margin:0; padding:0; border:0; border-bottom:1px solid var(--border); }
.co-workspace .co-run-fold > summary { min-height:52px; font-size:14px; font-weight:500; }
.co-workspace .co-run-fold > summary b { font-weight:500; color:var(--muted); }
.co-work-progress-row { border:0; border-bottom:1px solid var(--border); border-radius:0; padding:10px 0; margin:0 0 14px; }
.co-work-progress-row > span > strong { font-size:14px; }
.co-work-progress-row small { font-size:14px; }
@media(max-width:680px) {
 .co-projects-view { padding:14px 16px 40px; }
 .co-position-line { gap:8px; }
 .co-position-line > .co-icon { display:none; }
 .co-position-line > .co-btn { padding-inline:10px; }
 .co-workspace .co-run-primary { align-items:flex-start; gap:12px; }
 .co-workspace .co-run-primary .co-btn { max-width:42%; white-space:normal; }
}

.co-pr-detail-actions .co-btn { min-height:44px; display:inline-flex; align-items:center; justify-content:center; gap:7px; }
.co-public-work > .co-task-content { width:100%; min-width:0; margin:12px 0 18px; padding:20px; border:1px solid var(--border); border-radius:10px; background:var(--surface); }
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
 .co-project-position { padding:8px 0; margin-bottom:8px; }
 .co-public-work > .co-task-content { padding:16px; }
 .co-pr-detail-body { height:clamp(280px,42dvh,440px); }
}

.co-prepared-work > h3 { font-size:16px; margin:0 0 12px; }
.co-workspace-title p a { color:var(--muted); text-decoration:none; }
.co-workspace-title p a:hover { color:var(--accent); text-decoration:underline; }

/* Pull requests, GitHub-style: one bordered list box, compact rows with
   colored labels beside the title, "#123 · author opened … · ✓ 18/18" meta,
   and quiet right-hand actions. Detail follows GitHub's PR page. */
.co-workspace .co-public-work { margin-top:20px; }
.co-pr-list-controls { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
.co-pr-search { display:flex; align-items:center; gap:8px; flex:1; min-width:0; min-height:40px; padding:0 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--muted); }
.co-pr-search:focus-within { border-color:var(--accent); }
.co-workspace .co-pr-search input { flex:1; min-width:0; min-height:38px; padding:0; border:0; background:none; font-size:14px; }
.co-pr-search input:focus { outline:none; }
.co-pr-search-toggle { display:none; }
.co-pr-filters { display:flex; flex:none; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.co-pr-filters button { min-height:40px; padding:0 12px; border:0; border-left:1px solid var(--border); background:var(--surface); color:var(--muted); font:500 14px var(--font); cursor:pointer; }
.co-pr-filters button:first-child { border-left:0; }
.co-pr-filters button[aria-pressed=true] { background:var(--surface-2,var(--surface)); color:var(--text); }
.co-pr-filters button:hover { color:var(--text); }
.co-pr-filters button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
/* The box does not clip, so an Agent menu can open past its bottom edge even
   with one PR; the header and the last row round their own corners instead. */
.co-pr-box { border:1px solid var(--border); border-radius:8px; }
.co-pr-box-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-height:52px; padding:4px 12px 4px 4px; background:var(--surface); border-radius:7px 7px 0 0; }
.co-pr-list > .co-pr-row:last-child { border-radius:0 0 7px 7px; }
.co-pr-box-count { display:inline-flex; align-items:center; gap:6px; margin-right:auto; font-size:14px; font-weight:600; }
.co-pr-box-actions { display:flex; align-items:center; gap:8px; }
.co-pr-box-actions .co-btn { min-height:36px; padding:6px 12px; font-size:14px; display:inline-flex; align-items:center; gap:6px; }
.co-pr-box-head > p { flex-basis:100%; margin:0 0 6px 40px; color:var(--muted); font-size:14px; }
.co-pr-box > .co-task-content { margin:0; border:0; border-top:1px solid var(--border); border-radius:0; }
.co-pr-empty { padding:28px 16px; border-top:1px solid var(--border); text-align:center; color:var(--muted); font-size:14px; }
.co-pr-empty strong { display:block; color:var(--text); font-size:16px; margin-bottom:4px; }
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
.co-pr-title { font-size:16px; font-weight:600; overflow-wrap:anywhere; }
.co-pr-open:hover .co-pr-title { color:var(--accent); }
.co-pr-open:focus-visible { outline:2px solid var(--accent); outline-offset:3px; border-radius:4px; }
.co-pr-meta { display:flex; align-items:center; flex-wrap:wrap; gap:2px 10px; margin-top:2px; color:var(--muted); font-size:14px; }
.co-pr-meta > span { white-space:nowrap; }
.co-pr-agent-state { display:inline-flex; align-items:center; gap:4px; min-height:28px; padding:0 8px; border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border)); border-radius:999px; background:var(--accent-dim); color:var(--text); font:500 14px var(--font); cursor:pointer; }
.co-pr-agent-state.needs-you { border-color:#cf9526; background:color-mix(in srgb,#cf9526 16%,transparent); }
.co-pr-aside { display:flex; align-items:center; gap:2px; padding-top:2px; }
.co-pr-comments { display:inline-flex; align-items:center; gap:4px; padding:0 8px; color:var(--muted); font-size:14px; font-variant-numeric:tabular-nums; }
.co-pr-requested { display:inline-flex; align-items:center; min-height:24px; padding:0 8px; border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border)); border-radius:999px; background:var(--accent-dim); color:var(--text); font:500 13px var(--font); }
.co-pr-row > .co-task-content { grid-column:1/-1; margin:8px 0 6px 40px; padding:18px 20px 20px; border:1px solid var(--border); border-radius:8px; background:var(--bg); }
.co-gh-avatars { display:inline-flex; align-items:center; }
.co-gh-avatars > .co-gh-avatar + .co-gh-avatar { margin-left:-6px; }
.co-gh-avatar { display:inline-grid; place-items:center; flex:none; border-radius:50%; background:var(--surface-2,var(--surface)); color:var(--text); font-weight:600; box-shadow:0 0 0 2px var(--bg); }
.co-gh-label { display:inline-block; padding:0 8px; border:1px solid var(--co-label-dark-border,var(--border)); border-radius:2em; background:var(--co-label-dark-bg,var(--surface)); color:var(--co-label-dark-fg,var(--text)); font-size:14px; font-weight:500; line-height:20px; white-space:nowrap; }
[data-theme="light"] .co-gh-label { border-color:var(--co-label-light-border,var(--border)); background:var(--co-label-light-bg,var(--surface)); color:var(--co-label-light-fg,var(--text)); }
.co-gh-labels { display:flex; flex-wrap:wrap; gap:4px; margin-top:10px; }
.co-gh-state { display:inline-flex; color:var(--green); }
.co-gh-state.is-draft { color:var(--muted); }
.co-gh-state.is-merged { color:#a371f7; }
.co-gh-state.is-closed { color:var(--danger); }
.co-gh-badge { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:2em; background:#238636; color:#fff; font-size:14px; font-weight:500; white-space:nowrap; }
.co-gh-badge.is-draft { background:#6e7781; }
.co-gh-badge.is-merged { background:#8957e5; }
.co-gh-badge.is-closed { background:#da3633; }
.co-gh-checks { display:inline-flex; align-items:center; gap:3px; font-variant-numeric:tabular-nums; }
.co-gh-checks.is-success .co-icon { color:var(--green); }
.co-gh-checks.is-failure .co-icon { color:var(--danger); }
.co-gh-checks.is-pending .co-icon { color:#cf9526; }
.co-gh-pr-head { padding-right:36px; }
.co-gh-pr-title { margin:0; font-size:20px; font-weight:500; line-height:1.35; overflow-wrap:anywhere; }
.co-gh-pr-title > span { color:var(--muted); font-weight:400; }
.co-gh-pr-sub { display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px; margin-top:10px; color:var(--muted); font-size:14px; }
.co-gh-pr-sub b { color:var(--text); font-weight:600; }
.co-gh-pr-sub code { padding:1px 6px; border-radius:6px; background:color-mix(in srgb,var(--accent) 12%,var(--surface)); color:var(--text); font:14px var(--mono,monospace); }
.co-pr-detail-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:16px 0 4px; }
.co-pr-detail-actions .co-btn { min-height:40px; display:inline-flex; align-items:center; gap:6px; }
.co-gh-provenance { display:flex; align-items:center; flex-wrap:wrap; gap:0 4px; margin:4px 0 0; color:var(--muted); font-size:14px; }
.co-gh-chat-link { min-height:44px; min-width:44px; padding:0 8px; border:0; border-radius:8px; background:none; color:var(--accent); font:inherit; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
.co-gh-chat-link:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.co-pr-detail .co-detail-tabs { display:flex; width:100%; gap:20px; margin:14px 0 0; border-bottom:1px solid var(--border); overflow-x:auto; }
.co-pr-detail .co-detail-tabs button { display:inline-flex; align-items:center; gap:6px; flex:none; min-height:44px; font-size:14px; }
.co-tab-count { min-width:22px; padding:0 7px; border-radius:2em; background:var(--surface-2,var(--surface)); color:var(--text); font-size:14px; line-height:20px; text-align:center; }
.co-pr-detail-body { max-height:min(60dvh,560px); overflow:auto; overscroll-behavior:contain; padding:14px 2px 6px; }
.co-gh-comment { margin:0 0 14px; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.co-gh-comment > header { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:8px 14px; background:var(--surface); border-bottom:1px solid var(--border); color:var(--muted); font-size:14px; }
.co-gh-comment > header b { color:var(--text); }
.co-gh-comment > header a { margin-left:auto; }
.co-gh-comment > .co-markdown,.co-gh-comment > div { padding:12px 14px; font-size:15px; }
.co-gh-merge-state { margin:6px 0 10px; color:var(--muted); font-size:14px; }
.co-gh-merge-state:empty { display:none; }
@media (max-width:680px) {
 .co-pr-list-controls { flex-wrap:wrap; }
 .co-pr-search { flex-basis:100%; }
 .co-pr-filters { flex:1; }
 .co-pr-filters button { flex:1; padding:0 6px; }
 .co-pr-row { grid-template-columns:36px 18px minmax(0,1fr); column-gap:4px; padding-right:4px; }
 /* Labelled row actions wrap under the title instead of squeezing it. */
 .co-pr-aside { grid-column:3; justify-content:flex-start; margin-left:-10px; padding-top:0; }
 .co-pr-select { width:36px; }
 .co-pr-comments { display:none; }
 .co-pr-meta > span:first-child { white-space:normal; }
 .co-pr-row > .co-task-content { margin-left:0; padding:16px; }
 .co-gh-pr-title { font-size:18px; }
}
@media (prefers-reduced-motion:reduce) { .co-pr-row { transition:none; } }

/* Owner decisions above the PR list: one bordered box, one row per kind. */
.co-decisions { border:1px solid var(--border); border-radius:8px; overflow:clip; }
.co-decisions:empty { display:none; }
.co-workspace .co-decisions > .co-run-primary,.co-workspace .co-decisions > .co-run-fold > summary,.co-workspace .co-decisions > .co-local-summary { padding-inline:14px; }
.co-workspace .co-decisions > .co-run-primary { min-height:56px; padding-block:8px; }
.co-workspace .co-decisions > :last-child,.co-workspace .co-decisions > .co-run-fold:last-child { border-bottom:0; }
.co-workspace .co-decisions > .co-run-fold > .co-run-list,.co-workspace .co-decisions > .co-run-fold > p { padding:0 14px 8px; }
.co-workspace .co-decisions .co-run-primary strong { font-size:15px; font-weight:600; }
.co-workspace .co-decisions .co-run-fold > summary { font-size:15px; font-weight:600; }
/* Plain status lines: one fact about the project and its next step. */
.co-position-text { flex:1; min-width:0; padding:8px 0; }
.co-position-text p { margin:0; font-size:15px; color:var(--text); overflow-wrap:anywhere; }
.co-position-text p strong { font-weight:650; }
.co-position-text small { display:block; margin-top:2px; color:var(--muted); font-size:14px; }
.co-position-line.is-ok > .co-icon { color:var(--green); }
.co-position-line.is-warn > .co-icon { color:#cf9526; }
.co-link-action { padding:0; border:0; background:none; color:var(--accent); font:inherit; text-decoration:underline; text-underline-offset:2px; cursor:pointer; }
.co-link-action:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }

/* Check GitHub: a labelled reload with the last answer under it. */
.co-check-github { display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
.co-check-github .co-btn { gap:8px; }
.co-check-note { margin:0; max-width:40ch; color:var(--muted); font-size:14px; text-align:right; }
.co-icon.is-spinning { animation:co-spin 1s linear infinite; }
@keyframes co-spin { to { transform:rotate(360deg); } }
.co-workspace-head { align-items:flex-start; }
.co-project-view-actions { align-items:flex-start; }
.co-repository-trigger { gap:8px; }

/* Row actions are words: "Assign" and "Agent ▾", quiet until the row is in use. */
.co-pr-assign,.co-agent-menu-button { display:inline-flex; align-items:center; gap:6px; min-height:40px; padding:6px 10px; border:1px solid transparent; border-radius:8px; background:none; color:var(--muted); font:500 14px var(--font); white-space:nowrap; cursor:pointer; }
.co-pr-assign:hover,.co-agent-menu-button:hover,.co-agent-menu-button[aria-expanded=true] { border-color:var(--border); background:var(--surface); color:var(--text); }
.co-pr-row:hover .co-pr-assign,.co-pr-row:hover .co-agent-menu-button,.co-pr-row:focus-within .co-agent-menu-button { color:var(--text); }
.co-pr-assign:focus-visible,.co-agent-menu-button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.co-agent-menu-button.is-button { min-height:36px; padding:6px 12px; border-color:var(--border); background:var(--surface); color:var(--text); }
.co-agent-menu-button.is-active { border-color:color-mix(in srgb,var(--accent) 45%,var(--border)); background:var(--accent-dim); color:var(--text); }
.co-agent-menu-button:disabled { opacity:.5; cursor:default; }
.co-agent-menu-button > .co-icon:last-child { transition:transform .15s; }
.co-agent-menu-button[aria-expanded=true] > .co-icon:last-child { transform:rotate(180deg); }
.co-agent-menu { position:relative; display:inline-flex; }
.co-agent-menu-list { position:absolute; z-index:30; top:calc(100% + 6px); right:0; width:min(340px,calc(100vw - 32px)); padding:6px; border:1px solid var(--border); border-radius:12px; background:var(--surface); box-shadow:0 12px 32px rgba(0,0,0,.28); }
.co-agent-menu.is-align-start .co-agent-menu-list { right:auto; left:0; }
.co-agent-menu-list button { display:flex; align-items:flex-start; gap:10px; width:100%; padding:10px; border:0; border-radius:8px; background:none; color:var(--text); text-align:left; font:inherit; cursor:pointer; }
.co-agent-menu-list button:hover,.co-agent-menu-list button:focus-visible { background:var(--surface-2,var(--surface)); outline:none; }
.co-agent-menu-list .co-icon { flex:none; margin-top:2px; color:var(--muted); }
.co-agent-menu-list strong { display:block; font-size:15px; font-weight:600; }
.co-agent-menu-list small { display:block; margin-top:2px; color:var(--muted); font-size:14px; line-height:1.45; }

/* The agent review window: protected focus for a consent with public effects. */
.co-dialog-backdrop { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.6); }
.co-dialog { width:min(580px,100%); max-height:calc(100% - 40px); overflow:auto; overscroll-behavior:contain; border:1px solid var(--border); border-radius:16px; background:var(--surface); box-shadow:0 24px 60px rgba(0,0,0,.45); animation:co-dialog-in .16s ease-out; }
@keyframes co-dialog-in { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:none; } }
.co-review-window { outline:none; }
.co-rw-head { display:grid; grid-template-columns:44px minmax(0,1fr) auto; gap:14px; align-items:start; padding:20px 20px 16px; border-bottom:1px solid var(--border); }
.co-rw-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:12px; background:var(--accent-dim); color:var(--accent); }
.co-rw-head h3 { margin:0; font-size:20px; font-weight:680; letter-spacing:-.015em; line-height:1.25; }
.co-rw-pr { margin:4px 0 0; font-size:15px; line-height:1.45; }
.co-rw-pr strong { display:block; font-weight:600; overflow-wrap:anywhere; }
.co-rw-pr span,.co-rw-list li span { display:block; color:var(--muted); font-size:14px; }
.co-rw-list { margin:6px 0 0; padding-left:18px; font-size:14px; }
.co-rw-close { display:grid; place-items:center; width:40px; height:40px; }
.co-rw-body { display:flex; flex-direction:column; gap:18px; padding:18px 20px 4px; }
.co-rw-options { border:1px solid var(--border); border-radius:12px; background:var(--bg); }
.co-rw-option { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:center; padding:14px 16px; cursor:pointer; }
.co-rw-option + .co-rw-option { border-top:1px solid var(--border); }
.co-rw-option strong { display:block; font-size:15px; font-weight:600; }
.co-rw-option small { display:block; margin-top:2px; color:var(--muted); font-size:14px; line-height:1.45; }
.co-rw-option.is-off { cursor:default; }
.co-rw-option.is-off strong { color:var(--muted); }
input[type=checkbox].co-switch { appearance:none; -webkit-appearance:none; position:relative; flex:none; width:44px; height:26px; margin:0; border:1px solid var(--border); border-radius:999px; background:var(--surface-2,var(--surface)); cursor:pointer; transition:background .15s,border-color .15s; }
input[type=checkbox].co-switch::after { content:''; position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:var(--muted); transition:transform .15s,background .15s; }
input[type=checkbox].co-switch:checked { border-color:var(--accent); background:var(--accent); }
input[type=checkbox].co-switch:checked::after { transform:translateX(18px); background:#fff; }
input[type=checkbox].co-switch:disabled { opacity:.45; cursor:default; }
input[type=checkbox].co-switch:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.co-rw-note,.co-rw-blocker { margin:0; padding:12px 14px; border-radius:12px; font-size:15px; }
.co-rw-note { border:1px dashed var(--border); color:var(--muted); }
.co-rw-blocker { background:color-mix(in srgb,#cf9526 12%,transparent); color:var(--text); }
.co-rw-label { margin:0 0 -8px; color:var(--muted); font-size:14px; font-weight:650; }
.co-rw-steps { margin:0; padding:0; list-style:none; }
.co-rw-steps li { position:relative; display:grid; grid-template-columns:26px minmax(0,1fr); gap:12px; align-items:start; padding:0 0 12px; font-size:15px; line-height:1.45; }
.co-rw-steps li:last-child { padding-bottom:0; }
.co-rw-steps li:not(:last-child)::before { content:''; position:absolute; left:12px; top:28px; bottom:2px; width:2px; border-radius:2px; background:var(--border); }
.co-rw-steps b { display:grid; place-items:center; width:26px; height:26px; border:1px solid var(--border); border-radius:50%; background:var(--bg); font-size:14px; font-weight:700; }
.co-rw-steps li.is-added b { border-color:var(--accent); color:var(--accent); }
.co-rw-steps span { padding-top:2px; }
.co-rw-public { display:grid; grid-template-columns:20px minmax(0,1fr); gap:10px; align-items:start; margin:0; padding:12px 14px; border-radius:12px; font-size:15px; line-height:1.45; }
.co-rw-public.is-private { border:1px solid color-mix(in srgb,var(--green) 35%,transparent); background:color-mix(in srgb,var(--green) 11%,transparent); }
.co-rw-public.is-private .co-icon { color:var(--green); }
.co-rw-public.is-public { border:1px solid color-mix(in srgb,#cf9526 42%,transparent); background:color-mix(in srgb,#cf9526 11%,transparent); }
.co-rw-public.is-public .co-icon { color:#cf9526; }
.co-rw-foot { display:flex; flex-direction:column; gap:12px; margin-top:14px; padding:16px 20px 20px; border-top:1px solid var(--border); }
.co-rw-foot > p { margin:0; color:var(--muted); font-size:14px; line-height:1.45; }
.co-rw-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; }
.co-rw-versions { margin:0; font-size:14px; color:var(--muted); }
.co-rw-versions p { margin:6px 0 0; }
.co-selection-page .co-review-window { border:1px solid var(--border); border-radius:16px; background:var(--surface); }
@media(max-width:680px) {
 .co-dialog-backdrop { align-items:flex-end; padding:0; }
 .co-dialog { width:100%; max-height:92%; border-bottom:0; border-radius:16px 16px 0 0; }
 .co-rw-head { grid-template-columns:40px minmax(0,1fr) auto; gap:12px; padding:16px; }
 .co-rw-icon { width:40px; height:40px; }
 .co-rw-body { padding:16px 16px 4px; }
 .co-rw-foot { padding:14px 16px 18px; }
 .co-rw-actions { flex-direction:column-reverse; align-items:stretch; }
 .co-check-github { align-items:flex-start; }
 .co-check-note { text-align:left; }
 .co-pr-assign,.co-agent-menu-button { min-height:44px; }
}
@media(prefers-reduced-motion:reduce) {
 .co-dialog,.co-icon.is-spinning { animation:none; }
 input[type=checkbox].co-switch,input[type=checkbox].co-switch::after,.co-agent-menu-button > .co-icon:last-child { transition:none; }
}
`
