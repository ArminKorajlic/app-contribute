// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      node test/batch-outcome-browser.mjs
// Actual app components, native Chromium DOM, and no live app/backend. The
// browser gets a disposable profile; all transports and host capabilities are
// mocked before mount, with CSP and CDP network blocking as a second boundary.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const frontendModules = process.env.MOBIUS_FRONTEND_NODE_MODULES

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ENTRY = '\0workspace-browser-fixture'
const fixture = String.raw`import React,{useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {ContributionRun} from './ui/Feed.jsx';
import {buildContributionRun} from './run.js';
import {TaskContext} from './ui/TaskPane.jsx';
import {CSS} from './theme.js';
import {WORKSPACE_CSS} from './workspace-theme.js';
window.fetch=()=>{throw Error('forbidden transport')};window.mobius={online:true};
const sha='a'.repeat(40);
const rec=(id,status='prepared')=>({id,type:'pr',status,updated_at:'2026-10-08T22:00:00Z',repo:'team/repo',title:id,plan:{action:'pr',title:id,repo:'team/repo',branch:'fix/'+id,head_sha:sha},quality_review:{state:'all_clear',reviewed_head_sha:sha}});
const canonical=(r,status='open')=>({...r,status,number:1,url:'https://github.com/team/repo/pull/1'});
const status={byId:{a:{state:'ready'},b:{state:'ready'}}};
const stack=(id,position)=>({...rec(id),plan:{...rec(id).plan,branch:'stack/chain/'+position,base_sha:position===1?undefined:sha,stack:{id:'chain',name:'Chain',total:2,position,base_branch:position===1?'main':'stack/chain/1',parent_record_id:position===1?'':'a'}}});
let controls={}, release;
function App({mode}){
 const[records,setRecords]=useState(mode==='preflight-mixed'||mode==='batch'||mode==='batch-late'||mode==='cancel'?[rec('a'),rec('b')]:(mode==='preflight-stack'||mode==='stack'||mode==='stack-failure'||mode==='stack-held-failure')?[stack('a',1),stack('b',2)]:(mode==='readyfail'||mode==='ready-stack-failure')?[{...stack('a',1),status:'draft',number:1,url:'https://github.com/team/repo/pull/1'},{...stack('b',2),status:'draft',number:2,url:'https://github.com/team/repo/pull/2'}]:(mode==='preflight-ready'||mode==='ready-failure')?[canonical(rec('a','draft'),'draft')]:mode==='ready'?[rec('a','draft')]:[rec('a')]);
 const[activeId,setActiveId]=useState('');const[activation,setActivation]=useState(0);
 const calls=useRef([]);const run=buildContributionRun({records,reviewStatus:status});
 controls={calls:calls.current,records,revision:run.revision,update:(id,patch)=>setRecords(old=>old.map(r=>r.id===id?{...r,...patch}:r)),activate:()=>setActivation(x=>x+1)};
 async function send(record){calls.current.push(record.id);
  if(mode==='success-drift-preflight'){
   const drift={...canonical(record),plan:{...record.plan,base_branch:'main',base_sha:'c'.repeat(40)}};
   setRecords(old=>old.map(r=>r.id===record.id?drift:r));
   return {notAttempted:true,error:'Approval changed. Nothing was sent.',failure:{owner:'agent',code:'approval_changed'},record:drift};
  }
  if(mode==='preflight-mixed'&&record.id==='b')return {pending:true,record:{...record,status:'submitting'}};
  if(mode==='preflight-send'||mode==='preflight-mixed')return {notAttempted:true,error:'Fresh ledger unavailable. Nothing was sent.',failure:{owner:'automatic'}};
  if((mode==='batch'||mode==='batch-late') && record.id==='a'){setRecords(old=>old.map(r=>r.id==='a'?canonical(r):r));return {ok:true,record:canonical(record)}}
  if((mode==='batch'||mode==='batch-late') && record.id==='b')return new Promise(resolve=>{release=()=>{if(mode==='batch')setRecords(old=>old.map(r=>r.id==='b'?canonical(r):r));resolve(mode==='batch-late'?{pending:true,record:{...record,status:'submitting'}}:{ok:true,record:canonical(record)})}});
  if(mode==='failure-late')return new Promise(resolve=>{release=()=>resolve({pending:true,record:{...record,status:'submitting'}})});
  if(mode==='send-throw')throw Error('Lost response');
  if(['send-failure','old-error','wrong-failure'].includes(mode))return {pending:true};
  if(mode==='pending')return {pending:true,record:{...record,status:'submitting'}};
  if(mode==='unknown')return {};
  if(mode==='closed')return {pending:true};
  if(mode==='ready')throw Error('send called for ready request');
  return {ok:true,record:canonical(record)};
 }
 async function ready(record){calls.current.push('ready:'+record.id);if(mode==='preflight-ready')return {notAttempted:true,error:'Fresh draft unavailable. Nothing changed.',failure:{owner:'automatic'}};if(mode==='readyfail')return {error:'Review changed',failure:{owner:'agent'}};if(mode==='ready-stack-failure'&&record.id==='a'){setRecords(old=>old.map(r=>r.id==='a'?canonical(r):r));return {ok:true,record:canonical(record)}};return {pending:true,record:{...record,readying:true}}}
 async function sendStack(records){calls.current.push('stack:'+records.map(r=>r.id).join(','));if(mode==='preflight-stack')return {notAttempted:true,error:'Fresh chain unavailable. Nothing was sent.',failure:{owner:'automatic'}};setRecords(old=>old.map(r=>r.id==='a'?canonical(r):r));if(mode==='stack-held-failure')return new Promise(resolve=>{release=()=>resolve({pending:true,published:1,publishing:1})});return {pending:true,published:1,publishing:1}}
 return <div className='co-root'><style>{CSS+WORKSPACE_CSS}</style><main className='co-page co-workspace'><TaskContext.Provider value={{activeId,explicit:true,open:setActiveId,close:()=>setActiveId('')}}><ContributionRun run={run} reviewStatus={status} publicationPreference='github' githubState='connected' onSend={send} onSendStack={sendStack} onMarkReady={ready}/></TaskContext.Provider></main></div>
}
const root=createRoot(document.getElementById('root'));
const wait=async(p,label)=>{let end=Date.now()+5000;while(!p()){if(Date.now()>end)throw Error('timeout '+label+' '+document.body.innerText);await new Promise(r=>setTimeout(r,10))}};
const button=prefix=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(prefix));
const sendOffer=()=>document.querySelector('.co-run-primary.is-send button');
const sendConfirmation=()=>[...document.querySelectorAll('.co-run-approval-actions button')].find(b=>/^(?:Send|Contribute)(?: |$)/.test(b.textContent.trim()));
const check=(condition,message)=>{if(!condition)throw Error(message+'; DOM='+document.body.innerText)};
const pause=()=>new Promise(r=>setTimeout(r,80));
const approval=()=>!!document.querySelector('.co-run-approval');
async function begin(mode){root.render(<App key={mode} mode={mode}/>);await pause();await wait(()=>!!sendOffer(),mode+' offer');sendOffer().click();await wait(approval,mode+' approval');}
window.runWorkspaceChecks=async()=>{const reports=[];try{

 for(const action of ['pr','pr_update']) {
  root.render(<App key={'normalization-'+action} mode='pending'/>);await pause();await wait(()=>!!sendOffer(),'normalization offer');
  controls.update('a',{...(action==='pr_update'?{number:7,url:'https://github.com/team/repo/pull/7'}:{}),plan:{...controls.records[0].plan,action,base_branch:'main',base_sha:'b'.repeat(40)}});await pause();
  const frozen=controls.records[0];sendOffer().click();await wait(approval,'normalization approval');sendConfirmation().click();
  await wait(()=>document.body.innerText.includes('Checking result'),'normalization pending');
  const normalized='d'.repeat(40);
  const published={...canonical(frozen),number:7,url:'https://github.com/team/repo/pull/7',head_sha:normalized,last_submit_push_sha:normalized,
   plan:{...frozen.plan,head_sha:normalized,attribution_normalized_from:sha}};
  for(const patch of [{plan:{...published.plan,attribution_normalized_from:undefined}},{plan:{...published.plan,attribution_normalized_from:'e'.repeat(40)}},{last_submit_push_sha:sha},{head_sha:undefined},{plan:{...published.plan,base_branch:'release'}}]) {
   controls.update('a',{...published,...patch});await pause();
   check(!button('Done')&&document.body.innerText.includes('Checking result'),'incomplete or unrelated normalization settled '+action);
  }
  controls.update('a',published);await wait(()=>!!button('Done'),'valid normalization settlement');
  check(document.body.innerText.includes('Sent to GitHub')&&controls.calls.join(',')==='a','normalization did not settle exactly once');
  reports.push({case:'normalized-'+action,calls:[...controls.calls]});root.render(null);await pause();
 }
 for(const mode of ['pending','unknown','success-drift-preflight']) {
  root.render(<App key={'success-drift-'+mode} mode={mode}/>);await pause();await wait(()=>!!sendOffer(),'drift offer');
  controls.update('a',{plan:{...controls.records[0].plan,base_branch:'release',base_sha:'b'.repeat(40)}});await pause();
  const frozen=controls.records[0];sendOffer().click();await wait(approval,'drift approval');sendConfirmation().click();
  await wait(()=>controls.calls.length===1,'drift callback');await pause();
  if(mode==='success-drift-preflight') {
   check(!!button('Done')&&document.body.innerText.includes('Not sent')&&document.body.innerText.includes('Approval changed'),'unrelated success erased known preflight failure');
  } else {
   for(const plan of [{...frozen.plan,base_branch:'main'},{...frozen.plan,base_sha:'c'.repeat(40)},{...frozen.plan,action:'pr_update'},{...frozen.plan,branch:'fix/other'},{...frozen.plan,stack:stack('b',2).plan.stack}]) {
    controls.update('a',{...canonical(frozen),plan});await pause();
    check(!button('Done')&&document.body.innerText.includes('Checking result'),'other publication settled frozen intent');
   }
   controls.update('a',{...canonical(frozen),last_submit_push_sha:sha,head_repository:'owner/repo',last_submit_base_branch:'release'});
   await wait(()=>!!button('Done'),'exact publication settlement');
   check(document.body.innerText.includes('Sent to GitHub'),'exact success not shown');
  }
  controls.activate();await pause();check(controls.calls.join(',')==='a','drift caused repeat publication');
  reports.push({case:'success-drift-'+mode,calls:[...controls.calls]});
  root.render(null);await pause();
 }


 await begin('stack');sendConfirmation().click();await wait(()=>controls.calls.length===1,'stack identity callback');
 await wait(()=>document.body.innerText.includes('Checking result'),'stack identity pending');
 const member=controls.records.find(r=>r.id==='b');
 for(const [key,value] of Object.entries({id:'other',position:1,total:3,base_branch:'main',parent_record_id:'other'})) {
  controls.update('b',{...canonical(member),number:2,url:'https://github.com/team/repo/pull/2',plan:{...member.plan,stack:{...member.plan.stack,[key]:value}}});await pause();
  check(!button('Done')&&document.querySelectorAll('.co-run-approval-list li')[1]?.innerText.includes('Checking result'),'other stack publication settled member '+key);
 }
 controls.update('b',{...canonical(member),number:2,url:'https://github.com/team/repo/pull/2',last_submit_base_branch:'stack/chain/1',head_sha:'d'.repeat(40),last_submit_push_sha:'d'.repeat(40),plan:{...member.plan,head_sha:'d'.repeat(40),attribution_normalized_from:sha}});
 await wait(()=>!!button('Done'),'exact stack identity settlement');check(controls.calls.join(',')==='stack:a,b','stack drift replayed publication');
 reports.push({case:'success-stack-drift',calls:[...controls.calls]});root.render(null);await pause();
 for(const mode of ['preflight-send','preflight-ready','preflight-stack']) {
  if(mode==='preflight-ready') {root.render(<App key={mode} mode={mode}/>);await wait(()=>!!button('Mark ready for review'),'preflight ready offer');button('Mark ready for review').click();await wait(approval,'preflight ready approval')}
  else await begin(mode);
  const confirm=mode==='preflight-ready'?button('Mark ready on GitHub'):sendConfirmation();confirm.click();confirm.click();
  await wait(()=>controls.calls.length===1,'preflight callback');controls.activate();await pause();
  check(controls.calls.length===1,'preflight rerender retried');
  check(controls.records.every(r=>r.status===(mode==='preflight-ready'?'draft':'prepared')),'preflight changed canonical status');
  check(!!button('Done')&&!button('Done').disabled,'known preflight rejection locked confirmation');
  check(document.body.innerText.includes(mode==='preflight-ready'?'Not requested':'Not sent'),'preflight outcome mislabeled');
  check(document.body.innerText.includes(mode==='preflight-ready'?'Fresh draft unavailable':mode==='preflight-stack'?'Fresh chain unavailable':'Fresh ledger unavailable'),'preflight diagnostic lost');
  check(!document.body.innerText.includes('Checking result'),'preflight falsely implies a public attempt');
  button('Done').click();await pause();
  const offer=mode==='preflight-ready'?button('Mark ready for review'):sendOffer();check(!!offer,'fresh confirmation unavailable');offer.click();await wait(approval,'fresh confirmation');
  check(controls.calls.length===1,'opening new confirmation replayed prior action');
  const again=mode==='preflight-ready'?button('Mark ready on GitHub'):sendConfirmation();again.click();await wait(()=>controls.calls.length===2,'explicit second attempt');
  check(controls.calls.length===2,'new confirmation did not own exactly one attempt');
  reports.push({case:mode,calls:[...controls.calls]});
  root.render(null);await pause();
 }

 await begin('preflight-mixed');sendConfirmation().click();await wait(()=>controls.calls.length===2,'mixed preflight and public attempt');await pause();
 check(document.body.innerText.includes('Fresh ledger unavailable')&&document.body.innerText.includes('Checking result'),'mixed results lost their distinct meaning');
 check(!button('Done')&&!sendOffer(),'not-attempted member unlocked another pending publication');
 controls.activate();await pause();check(controls.calls.join(',')==='a,b','mixed rerender replayed publication');
 controls.update('b',canonical(controls.records.find(r=>r.id==='b')));await wait(()=>!!button('Done'),'mixed canonical settlement');
 check(controls.calls.join(',')==='a,b'&&document.body.innerText.includes('Not sent'),'mixed settlement replayed preflight or erased diagnostic');
 reports.push({case:'preflight-mixed',calls:[...controls.calls]});
 await begin('cancel');check(controls.calls.length===0,'handler called before confirmation');button('Keep private').click();await pause();check(controls.calls.length===0,'handler called after cancel');reports.push({case:'cancel',calls:[...controls.calls]});
 await begin('batch');const before=controls.revision;sendConfirmation().click();await wait(()=>controls.calls.length===2,'batch b handler');await pause();check(controls.revision!==before,'canonical A did not change run revision');check(approval(),'batch ownership lost after A canonical');check(!sendOffer(),'batch reoffered while B held');check(!button('Done'),'batch completed before B canonical');check(document.body.innerText.includes('a')&&document.body.innerText.includes('b'),'frozen batch rows lost');check(document.body.innerText.includes('Sent to GitHub'),'A not shown done');check(document.body.innerText.includes('Sending'),'B not shown working');controls.activate();await pause();check(controls.calls.join(',')==='a,b','batch handler retried on rerender');check(approval(),'batch approval lost on rerender');release();await wait(()=>!!button('Done'),'batch completion');check(controls.calls.join(',')==='a,b','batch handler repeat');reports.push({case:'batch',calls:[...controls.calls],before,after:controls.revision});
 await begin('batch-late');sendConfirmation().click();await wait(()=>controls.calls.length===2,'batch-late B handler');await pause();check(approval(),'batch-late ownership lost while held');check(!button('Done'),'batch-late completed before B canonical');controls.update('b',{status:'open',number:2,url:'https://github.com/team/repo/pull/2'});await pause();check(approval(),'batch-late ownership lost after canonical');check(!button('Done'),'batch-late completed before held handler response');check(document.querySelectorAll('.co-run-approval-list li')[1]?.innerText.includes('Sending'),'batch-late B not working while handler held');release();await wait(()=>!!button('Done'),'batch-late delayed response');check(document.querySelectorAll('.co-run-approval-list li')[1]?.innerText.includes('Sent to GitHub'),'batch-late old pending receipt shadowed canonical');check(controls.calls.join(',')==='a,b','batch-late handler replayed');reports.push({case:'batch-late',calls:[...controls.calls]});
 await begin('stack');sendConfirmation().click();await wait(()=>controls.calls.length===1,'stack handler');await pause();check(approval(),'stack ownership lost');check(!button('Done'),'stack partial falsely complete');const stackRows=[...document.querySelectorAll('.co-run-approval-list li')].map(li=>li.innerText);check(stackRows.length===2,'stack lost exact rows');check(stackRows[0].includes('Sent to GitHub'),'stack canonical A not done');check(stackRows[1].includes('Checking result'),'stack unresolved B lacks checking status');check(controls.calls[0]==='stack:a,b','stack handler did not receive exact ordered pair');controls.activate();await pause();check(controls.calls.length===1,'stack handler retried');controls.update('b',{status:'open',number:2,url:'https://github.com/team/repo/pull/2'});await wait(()=>!!button('Done'),'stack late B canonical');check(controls.calls.length===1,'stack retried on late canonical');reports.push({case:'stack',calls:[...controls.calls]});
 root.render(<App key='ready' mode='ready'/>);await pause();await wait(()=>!!button('Mark ready for review'),'ready offer');button('Mark ready for review').click();await wait(approval,'ready approval');check(controls.calls.length===0,'ready handler called before confirmation');button('Mark ready on GitHub').click();await wait(()=>controls.calls.length===1,'ready handler');await pause();check(approval(),'ready ownership lost');check(!button('Done'),'ready pending falsely complete');check(document.body.innerText.includes('Checking result'),'ready pending lacks checking status');controls.activate();await pause();check(controls.calls.length===1,'ready handler retried');controls.update('a',{status:'open',number:1,url:'https://github.com/team/repo/pull/1',readying:false});await wait(()=>!!button('Done'),'ready late canonical');check(controls.calls.length===1,'ready retried on late canonical');reports.push({case:'ready',calls:[...controls.calls]});
 for(const mode of ['pending','unknown']){await begin(mode);sendConfirmation().click();await wait(()=>controls.calls.length===1,mode+' handler');await pause();check(approval(),mode+' ownership lost');check(!button('Done'),mode+' falsely complete');check(!sendConfirmation(),mode+' send offered while unresolved');check(document.body.innerText.includes('Checking result'),mode+' lacks checking status');controls.activate();await pause();check(controls.calls.length===1,mode+' handler retried on activate');controls.update('a',{status:'open',number:1,url:'https://github.com/team/repo/pull/1'});await wait(()=>!!button('Done'),mode+' late canonical');check(controls.calls.length===1,mode+' retried on late canonical');reports.push({case:mode,calls:[...controls.calls]});}
 await begin('closed');sendConfirmation().click();await wait(()=>controls.calls.length===1,'closed handler');controls.update('a',{status:'closed',number:1,url:'https://github.com/team/repo/pull/1'});await wait(()=>!!button('Done'),'closed terminal');check(document.querySelector('.co-run-approval-list li')?.innerText.includes('Pull request closed'),'closed not labeled distinctly');check(!document.querySelector('.co-run-approval-list li')?.innerText.includes('Sent to GitHub'),'closed falsely labeled sent');reports.push({case:'closed',calls:[...controls.calls]});
 root.render(<App key='readyfail' mode='readyfail'/>);await pause();await wait(()=>!!button('Mark ready for review'),'readyfail offer');button('Mark ready for review').click();await wait(approval,'readyfail approval');button('Mark 2 ready on GitHub').click();await wait(()=>!!button('Done'),'readyfail result');check(controls.calls.join(',')==='ready:a','ready known failure attempted later stack member');const failRows=[...document.querySelectorAll('.co-run-approval-list li')].map(li=>li.innerText);check(failRows.length===2&&failRows[0].includes('Review changed')&&failRows[1].includes('Not requested'),'ready failed/not attempted labels incorrect');reports.push({case:'readyfail',calls:[...controls.calls]});

 const failMessage='Branch protection rejected this exact attempt';
 const failPatch={status:'prepared',updated_at:'2026-10-08T22:00:02Z',last_submit_error:failMessage};
 for(const mode of ['send-failure','send-throw']){await begin(mode);sendConfirmation().click();await wait(()=>controls.calls.length===1,mode+' handler');await wait(()=>document.body.innerText.includes('Checking result'),mode+' checking');controls.update('a',{status:'submitting',updated_at:'2026-10-08T22:00:01Z'});await pause();check(!button('Done')&&!sendOffer(),mode+' inflight reoffered');controls.update('a',failPatch);await wait(()=>!!button('Done'),mode+' canonical failed result');check(document.querySelector('.co-run-approval-list li')?.innerText.includes(failMessage),mode+' failure hidden');check(!sendOffer(),mode+' reoffered before closing result');controls.activate();await pause();check(controls.calls.join(',')==='a',mode+' handler replayed');reports.push({case:mode,calls:[...controls.calls]});}
 root.render(<App key='ready-failure' mode='ready-failure'/>);await pause();await wait(()=>!!button('Mark ready for review'),'ready-failure offer');button('Mark ready for review').click();await wait(approval,'ready-failure approval');button('Mark ready on GitHub').click();await wait(()=>controls.calls.length===1,'ready-failure handler');await wait(()=>document.body.innerText.includes('Checking result'),'ready-failure checking');controls.update('a',{readying:true,updated_at:'2026-10-08T22:00:01Z'});await pause();check(!button('Done'),'ready-failure claim false settled');controls.update('a',{readying:false,updated_at:'2026-10-08T22:00:02Z',last_ready_error:'Connected account no longer matches',last_ready_error_code:'github_not_connected'});await wait(()=>!!button('Done'),'ready-failure canonical outcome');check(document.querySelector('.co-run-approval-list li')?.innerText.includes('Connected account no longer matches'),'ready-failure hidden');check(controls.calls.join(',')==='ready:a','ready-failure replayed');reports.push({case:'ready-failure',calls:[...controls.calls]});
 await begin('failure-late');sendConfirmation().click();await wait(()=>controls.calls.length===1,'failure-late handler');controls.update('a',failPatch);await pause();check(!button('Done')&&!sendOffer(),'failure-late lost owner while handler held');release();await wait(()=>!!button('Done'),'failure-late result');check(document.querySelector('.co-run-approval-list li')?.innerText.includes(failMessage),'stale pending receipt shadowed canonical failure');check(controls.calls.join(',')==='a','failure-late replayed');reports.push({case:'failure-late',calls:[...controls.calls]});
 await begin('stack-failure');sendConfirmation().click();await wait(()=>controls.calls.length===1,'stack-failure handler');await wait(()=>document.body.innerText.includes('Checking result'),'stack-failure pending');controls.update('b',failPatch);await wait(()=>!!button('Done'),'stack-failure mixed result');const mixed=[...document.querySelectorAll('.co-run-approval-list li')].map(x=>x.innerText);check(mixed.length===2&&mixed[0].includes('Sent to GitHub')&&mixed[1].includes(failMessage),'stack failure borrowed sibling result');check(!sendOffer()&&controls.calls.join(',')==='stack:a,b','stack-failure reoffered or replayed');reports.push({case:'stack-failure',calls:[...controls.calls]});

 root.render(<App key='ready-stack-failure' mode='ready-stack-failure'/>);await pause();await wait(()=>!!button('Mark ready for review'),'ready-stack-failure offer');button('Mark ready for review').click();await wait(approval,'ready-stack-failure approval');button('Mark 2 ready on GitHub').click();await wait(()=>controls.calls.length===2,'ready-stack-failure B handler');await wait(()=>document.body.innerText.includes('Checking result'),'ready-stack-failure pending');check(approval()&&!button('Done'),'ready-stack-failure ownership lost');controls.update('b',{readying:false,updated_at:'2026-10-08T22:00:02Z',last_ready_error:'Connected account no longer matches',last_ready_error_code:'github_not_connected'});await wait(()=>!!button('Done'),'ready-stack-failure mixed outcome');const readyMixed=[...document.querySelectorAll('.co-run-approval-list li')].map(x=>x.innerText);check(readyMixed.length===2&&readyMixed[0].includes('Review requested')&&readyMixed[1].includes('Connected account no longer matches'),'ready-stack failure borrowed sibling outcome');check(controls.calls.join(',')==='ready:a,ready:b','ready-stack-failure replayed');reports.push({case:'ready-stack-failure',calls:[...controls.calls]});
 await begin('old-error');sendConfirmation().click();await wait(()=>controls.calls.length===1,'old-error handler');await wait(()=>document.body.innerText.includes('Checking result'),'old-error checking');controls.update('a',{last_submit_error:'Prior failure',updated_at:'2026-10-08T21:59:59Z'});await pause();check(!button('Done')&&!sendOffer()&&approval(),'old error freed owner');check(controls.calls.length===1,'old error replayed');reports.push({case:'old-error',calls:[...controls.calls]});
 await begin('wrong-failure');sendConfirmation().click();await wait(()=>controls.calls.length===1,'wrong-failure handler');await wait(()=>document.body.innerText.includes('Checking result'),'wrong-failure checking');const original=controls.records[0];controls.update('a',{...failPatch,plan:{...original.plan,head_sha:'b'.repeat(40)}});await pause();check(!button('Done')&&approval(),'unrelated failed head settled');controls.update('a',{id:'different'});await pause();check(!button('Done')&&approval(),'missing record freed owner');controls.update('different',{...original,...failPatch});await wait(()=>!!button('Done'),'exact failure restored');check(controls.calls.join(',')==='a','wrong-failure replayed');reports.push({case:'wrong-failure',calls:[...controls.calls]});
 // A newer diagnostic belongs to this frozen phase only when the complete
 // stack identity still matches. Every case starts with A done and B checking.
 const stackDrifts=[
  ['base',s=>({...s,base_branch:'stack/other/1'})],
  ['parent',s=>({...s,parent_record_id:'other'})],
  ['id',s=>({...s,id:'other'})],
  ['position',s=>({...s,position:1})],
  ['total',s=>({...s,total:3})],
  ['missing',()=>undefined],
  ['malformed',s=>({...s,position:'not-a-position'})],
 ];
 for(const mode of ['send','ready'])for(const [drift,change] of stackDrifts){
  root.render(null);await pause();
  const appMode=mode==='send'?'stack-failure':'ready-stack-failure';
  if(mode==='send'){await begin(appMode);sendConfirmation().click()}
  else {root.render(<App key={appMode} mode={appMode}/>);await pause();await wait(()=>!!button('Mark ready for review'),drift+' ready offer');button('Mark ready for review').click();await wait(approval,drift+' ready confirmation');button('Mark 2 ready on GitHub').click()}
  const expected=mode==='send'?'stack:a,b':'ready:a,ready:b';
  await wait(()=>controls.calls.join(',')===expected,drift+' handlers');
  await wait(()=>document.querySelectorAll('.co-run-approval-list li').length===2,drift+' rows');
  await pause();
  const originalB=controls.records.find(r=>r.id==='b');
  check(approval()&&!button('Done'),drift+' lost pending owner');
  check(document.querySelectorAll('.co-run-approval-list li')[0].innerText.includes(mode==='send'?'Sent to GitHub':'Review requested'),drift+' A not done');
  const diagnostic='Unrelated '+mode+' '+drift+' failure';
  const badStack=change(originalB.plan.stack),badPlan={...originalB.plan};
  if(badStack===undefined)delete badPlan.stack;else badPlan.stack=badStack;
  controls.update('b',{...originalB,status:mode==='send'?'prepared':'draft',readying:false,updated_at:'2026-10-08T22:00:02Z',last_submit_error:mode==='send'?diagnostic:undefined,last_ready_error:mode==='ready'?diagnostic:undefined,last_ready_error_code:mode==='ready'?'blocked':undefined,plan:badPlan});
  await pause();
  const rows=[...document.querySelectorAll('.co-run-approval-list li')].map(x=>x.innerText);
  check(approval()&&!button('Done')&&!sendOffer(),mode+' '+drift+' unrelated diagnostic settled/reoffered');
  check(rows.length===2&&rows[0].includes(mode==='send'?'Sent to GitHub':'Review requested')&&rows[1].includes('Checking result'),mode+' '+drift+' borrowed sibling outcome');
  check(rows[1].includes('stack/chain/1 → stack/chain/2')&&!rows[1].includes('stack/other/1'),mode+' '+drift+' frozen target changed');
  check(controls.calls.join(',')===expected,mode+' '+drift+' handler replayed');
  const exactDiagnostic='Exact '+mode+' '+drift+' failure';
  controls.update('b',{...originalB,status:mode==='send'?'prepared':'draft',readying:false,updated_at:'2026-10-08T22:00:03Z',last_submit_error:mode==='send'?exactDiagnostic:undefined,last_ready_error:mode==='ready'?exactDiagnostic:undefined,last_ready_error_code:mode==='ready'?'blocked':undefined});
  await wait(()=>!!button('Done'),mode+' '+drift+' exact failure');
  const finalRows=[...document.querySelectorAll('.co-run-approval-list li')].map(x=>x.innerText);
  check(finalRows.length===2&&finalRows[0].includes(mode==='send'?'Sent to GitHub':'Review requested')&&finalRows[1].includes(exactDiagnostic),mode+' '+drift+' exact failure not isolated to B');
  check(controls.calls.join(',')===expected,mode+' '+drift+' handler repeated after exact failure');
  reports.push({case:mode+'-stack-drift-'+drift,calls:[...controls.calls]});
 }
 // A flat frozen action cannot acquire a stack identity after confirmation
 // and use its new diagnostic to settle the old standalone phase.
 for(const mode of ['send','ready']){
  root.render(null);await pause();
  const appMode=mode==='send'?'send-failure':'ready-failure';
  if(mode==='send'){await begin(appMode);sendConfirmation().click()}
  else {root.render(<App key={appMode} mode={appMode}/>);await pause();await wait(()=>!!button('Mark ready for review'),'flat ready offer');button('Mark ready for review').click();await wait(approval,'flat ready confirmation');button('Mark ready on GitHub').click()}
  const expected=mode==='send'?'a':'ready:a';
  await wait(()=>controls.calls.join(',')===expected,'flat handler');
  await wait(()=>document.body.innerText.includes('Checking result'),'flat checking');
  const original=controls.records[0],bad='Unrelated added stack failure';
  controls.update('a',{...original,status:mode==='send'?'prepared':'draft',readying:false,updated_at:'2026-10-08T22:00:02Z',last_submit_error:mode==='send'?bad:undefined,last_ready_error:mode==='ready'?bad:undefined,last_ready_error_code:mode==='ready'?'blocked':undefined,plan:{...original.plan,stack:{id:'other',name:'Other',position:1,total:2,base_branch:'main',parent_record_id:''}}});
  await pause();
  check(approval()&&!button('Done')&&!sendOffer(),mode+' added stack settled flat phase');
  check(document.querySelector('.co-run-approval-list li')?.innerText.includes('Checking result')&&!document.querySelector('.co-run-approval-list li')?.innerText.includes(bad),mode+' added stack changed frozen row');
  check(controls.calls.join(',')===expected,mode+' added stack replayed');
  const exact='Exact flat '+mode+' failure';
  controls.update('a',{...original,status:mode==='send'?'prepared':'draft',readying:false,updated_at:'2026-10-08T22:00:03Z',last_submit_error:mode==='send'?exact:undefined,last_ready_error:mode==='ready'?exact:undefined,last_ready_error_code:mode==='ready'?'blocked':undefined});
  await wait(()=>!!button('Done'),mode+' flat exact failure');
  check(document.querySelector('.co-run-approval-list li')?.innerText.includes(exact)&&controls.calls.join(',')===expected,mode+' flat exact result/replay');
  reports.push({case:mode+'-flat-added-stack',calls:[...controls.calls]});
 }
 // The exact canonical failure can arrive before a delayed stack callback.
 // A stale pending receipt must neither overrule it nor dispatch again.
 root.render(null);await pause();await begin('stack-held-failure');sendConfirmation().click();
 await wait(()=>controls.calls.join(',')==='stack:a,b','held stack handler');
 await wait(()=>controls.records.find(r=>r.id==='a')?.status==='open','held stack A canonical record');
 const heldB=controls.records.find(r=>r.id==='b');
 controls.update('b',{...heldB,...failPatch,plan:{...heldB.plan,stack:{...heldB.plan.stack,base_branch:'stack/other/1'}}});
 await pause();check(approval()&&!button('Done'),'held foreign failure settled');
 controls.update('b',{...heldB,...failPatch,updated_at:'2026-10-08T22:00:03Z'});
 await pause();check(approval()&&!button('Done'),'held exact failure released ownership before callback');
 release();await wait(()=>!!button('Done'),'held exact failure after stale callback');
 check(document.querySelectorAll('.co-run-approval-list li')[1]?.innerText.includes(failMessage)&&controls.calls.join(',')==='stack:a,b','held stale callback shadowed exact failure or replayed');
 reports.push({case:'stack-held-canonical-before-stale',calls:[...controls.calls]});
 return {status:'pass',reports};}catch(e){return{status:'fail',error:e.stack,reports,dom:document.body.innerText}}};`;

async function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  for (const path of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(path)) return path
  }
  const directory = '/opt/agent-browser/browsers'
  if (existsSync(directory)) for (const name of (await readdir(directory)).sort().reverse()) {
    const path = join(directory, name, 'chrome')
    if (existsSync(path)) return path
  }
  throw new Error('No installed Chromium found; set CHROMIUM_PATH. This test never installs a browser.')
}

function cdp(browser) {
  let serial = 0, buffer = ''
  const pending = new Map(), events = [], listeners = new Set()
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString()
    let end
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      if (message.id) {
        const entry = pending.get(message.id)
        if (!entry) continue
        pending.delete(message.id); clearTimeout(entry.timer)
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
      } else { events.push(message); for (const listener of listeners) listener(message) }
    }
  })
  return { events, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) }, send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)) }, 45000)
      pending.set(id, { resolve, reject, timer })
      browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  } }
}

async function main() {
  if (!frontendModules) throw new Error('MOBIUS_FRONTEND_NODE_MODULES is required')
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)
  const build = await rolldown({ input: ENTRY, platform: 'browser', tsconfig: false,
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    resolve: { modules: [frontendModules, 'node_modules'] },
    plugins: [{ name: 'workspace-browser-fixture',
      resolveId(id, importer) { if (id === ENTRY) return id; if (importer === ENTRY && id.startsWith('.')) return join(root, id) },
      load(id) { if (id === ENTRY) return { code: fixture, moduleType: 'jsx' } },
    }],
  })
  const { output } = await build.generate({ format: 'iife' })
  await build.close()
  const temporary = await mkdtemp(join(tmpdir(), 'contribute-workspace-browser-'))
  let browser
  try {
    const page = join(temporary, 'fixture.html')
    await writeFile(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'">' +
      '<style>:root{--bg:#fff;--surface:#f5f5f5;--surface-2:#eee;--text:#222;--muted:#666;--border:#ddd;--accent:#2454cc;--accent-dim:#eef;--font:Arial}html,body,#root{height:100%;margin:0}</style>' +
      '</head><body><div id="root"></div><script>' + output[0].code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>')
    browser = spawn(await chromiumPath(), ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--remote-debugging-pipe', '--user-data-dir=' + join(temporary, 'profile'), 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
    browser.stderr.resume()
    const protocol = cdp(browser), reports = []
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
      const { targetId } = await protocol.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await protocol.send('Target.attachToTarget', { targetId, flatten: true })
      const inputErrors = []
      const unsubscribeInput = protocol.onEvent(event => {
        if (event.sessionId !== sessionId || event.method !== 'Runtime.bindingCalled' || event.params.name !== 'workspaceNativeKey') return
        void (async () => {
          let error = ''
          try {
            const input = JSON.parse(event.params.payload)
            if (!['Space','Escape'].includes(input.code)) throw new Error('Unknown native input request')
            for (const type of ['keyDown', 'keyUp']) await protocol.send('Input.dispatchKeyEvent', {
              type, key: input.key, code: input.code, windowsVirtualKeyCode: input.keyCode, nativeVirtualKeyCode: input.keyCode,
            }, sessionId)
          } catch (failure) { error = failure.message }
          await protocol.send('Runtime.evaluate', { expression: `window.finishNativeKey(${JSON.stringify(error)})` }, sessionId)
        })().catch(error => inputErrors.push(error.message))
      })
      await protocol.send('Runtime.enable', {}, sessionId)
      await protocol.send('Runtime.addBinding', { name: 'workspaceNativeKey' }, sessionId)
      await protocol.send('Network.enable', {}, sessionId)
      await protocol.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] }, sessionId)
      await protocol.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === 'phone' }, sessionId)
      await protocol.send('Page.enable', {}, sessionId)
      await protocol.send('Page.navigate', { url: pathToFileURL(page).href }, sessionId)
      const evaluated = await protocol.send('Runtime.evaluate', { expression: `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        function ready() { if (window.runWorkspaceChecks) window.runWorkspaceChecks().then(resolve, reject);
          else if (Date.now() > deadline) reject(new Error('Fixture did not load'));
          else setTimeout(ready, 20); }
        ready();
      })`, awaitPromise: true, returnByValue: true }, sessionId)
      const report = evaluated.result?.value || { status: 'fail', error: evaluated.exceptionDetails || evaluated }
      unsubscribeInput()
      if (inputErrors.length) { report.status = 'fail'; report.nativeInputErrors = inputErrors }
      const network = protocol.events.filter(event => event.sessionId === sessionId && event.method === 'Network.requestWillBeSent'
        && !event.params.request.url.startsWith('file:')).map(event => event.params.request.url)
      if (network.length) { report.status = 'fail'; report.unexpectedNetwork = network }
      reports.push({ viewport, ...report })
      await protocol.send('Target.closeTarget', { targetId })
    }
    const passed = reports.every(report => report.status === 'pass')
    console.log(JSON.stringify({ status: passed ? 'pass' : 'fail', reports }, null, 2))
    if (!passed) process.exitCode = 1
    await protocol.send('Browser.close')
  } finally {
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      // Browser.close owns graceful shutdown, including profile writers. Do
      // not interrupt that shutdown and race its child processes during rm.
      await new Promise(resolve => {
        const timer = setTimeout(() => browser.kill('SIGKILL'), 3000)
        browser.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    await rm(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(JSON.stringify({ status: 'fail', error: error.stack })); process.exitCode = 1 })
