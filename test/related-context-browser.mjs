// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      CHROMIUM_PATH=/opt/agent-browser/browsers/chrome-154.0.8037.92/chrome \
//      node test/related-context-browser.mjs
// Actual detail component, seeded cache, native Chromium DOM, and a mocked
// context transport only. CSP/CDP block external network; the profile is disposable.
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
const fixture = String.raw`import React from 'react';
import {createRoot} from 'react-dom/client';
import {PullRequestDetail} from './ui/PullRequestDetail.jsx';
import {CSS} from './theme.js';
import {WORKSPACE_CSS} from './workspace-theme.js';
const pr={number:7,title:'Example',repository:{nameWithOwner:'team/repo'},headRefOid:'a'.repeat(40),baseRefOid:'b'.repeat(40),baseRefName:'main',url:'https://github.com/team/repo/pull/7'};
const item={__typename:'Issue',number:2,title:'Usable issue',url:'https://github.com/team/repo/issues/2',repository:{nameWithOwner:'team/repo'},relationships:['May close']};
const cache=items=>({entries:{'description:1':{data:{body:'Description'},loading:false},'activity:1':{data:{items:[]},loading:false},'threads:':{data:{threads:[]},loading:false},related:{data:{items,errors:['Cross-references are unavailable.']},loading:false}}});
const calls=[];
window.fetch=(url,options)=>{calls.push({url,query:JSON.parse(options.body).query});if(url!=='/api/github/graphql'||!options.body.includes('closingIssuesReferences'))throw Error('Unexpected read: '+url);return Promise.resolve({ok:true,json:async()=>({data:{repository:{pullRequest:{headRefOid:pr.headRefOid,baseRefOid:pr.baseRefOid,baseRefName:pr.baseRefName,closingIssuesReferences:{pageInfo:{hasNextPage:false},nodes:[item]},timelineItems:{pageInfo:{hasNextPage:false},nodes:[]}}}}})})};
const root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(r=>setTimeout(r,50));
const wait=async(p,label)=>{let end=Date.now()+3000;while(!p()){if(Date.now()>end)throw Error('timeout '+label+' '+document.body.innerText);await new Promise(r=>setTimeout(r,10))}};
const check=(condition,message)=>{if(!condition)throw Error(message+'; DOM='+document.body.innerText)};
const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label);
const response=(data,ok=true)=>({ok,json:async()=>data});
const description=(body,head=pr.headRefOid)=>({body,head:{sha:head},base:{sha:pr.baseRefOid,ref:pr.baseRefName}});
const relatedResponse=partial=>({data:{repository:{pullRequest:{headRefOid:pr.headRefOid,baseRefOid:pr.baseRefOid,baseRefName:pr.baseRefName,
  closingIssuesReferences:{nodes:[item],pageInfo:{hasNextPage:false}},...(partial?{}:{timelineItems:{nodes:[],pageInfo:{hasNextPage:false}}})}}}});
const unexpectedReads=[];
function delayedContext({failure='error',ignoreAbort=false}={}) {
  const store=cache([]);delete store.entries['description:1'];delete store.entries.related;
  store.entries['files:1']={data:{files:[],totals:{files:101,additions:0,deletions:0},page:1,hasMore:true},loading:false};
  const descriptions=[],files=[],related=[],activity=[];
  let relatedCalls=0;
  const hold=(requests,signal)=>new Promise((resolve,reject)=>{
    const request={aborted:false,resolve:data=>resolve(response(data))};requests.push(request);
    signal.addEventListener('abort',()=>{request.aborted=true;if(!ignoreAbort)reject(new DOMException('Aborted','AbortError'))},{once:true});
  });
  window.fetch=(url,options)=>{
    if(options.signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
    if(/\/(comments|reviews)\?/.test(url))return hold(activity,options.signal);
    if(url==='/api/github/api/repos/team/repo/pulls/7') {
      if(failure==='description'&&!descriptions.length) {descriptions.push({failed:true});return Promise.resolve(response({},false))}
      return hold(descriptions,options.signal);
    }
    if(url.includes('/files?'))return hold(files,options.signal);
    if(url==='/api/github/graphql'&&options.body.includes('closingIssuesReferences')) {
      relatedCalls++;
      if(failure==='description')return hold(related,options.signal);
      if(relatedCalls===1&&failure==='error')return Promise.resolve(response({},false));
      return Promise.resolve(response(relatedResponse(relatedCalls===1&&failure==='partial')));
    }
    unexpectedReads.push(url);
    throw Error('Successful sibling was refetched or unexpected transport: '+url);
  };
  const mount=key=>root.render(<div className='co-root'><style>{CSS+WORKSPACE_CSS}</style><PullRequestDetail key={key} pr={pr} token='mock-token' cacheStore={store} /></div>);
  return {store,descriptions,files,related,activity,get relatedCalls(){return relatedCalls},mount};
}
window.runWorkspaceChecks=async()=>{const reports=[];try{for(const count of [0,1]){
  calls.length=0;
  root.render(<div className='co-root'><style>{CSS+WORKSPACE_CSS}</style><PullRequestDetail key={count} pr={pr} token='mock-token' cacheStore={cache(count?[item]:[])} /></div>);
  await pause();
  check(document.body.innerText.includes('Cross-references are unavailable.'),'partial warning missing with '+count+' items');
  check(!!document.querySelector('[role="alert"] button'),'related Retry missing');
  check(!![...document.querySelectorAll('a')].find(a=>a.textContent.includes('Open on GitHub')),'fallback missing');
  check(count===0||!![...document.querySelectorAll('a')].find(a=>a.textContent.includes('Usable issue')),'usable link missing');
  check(calls.length===0,'seeded reads unexpectedly fetched');
  document.querySelector('[role="alert"] button').click();
  await wait(()=>!document.body.innerText.includes('Cross-references are unavailable.'),'related retry');
  check(calls.length===1 && calls[0].url==='/api/github/graphql' && calls[0].query.includes('closingIssuesReferences'),'retry not isolated to related read');
  check(!![...document.querySelectorAll('a')].find(a=>a.textContent.includes('Usable issue')),'link absent after retry');
  reports.push({case:count?'partial-items':'zero-items',relatedCalls:calls.length});
}
for(const failure of ['error','partial']) {
  root.render(null);await pause();
  const scenario=delayedContext({failure});scenario.mount('sibling-'+failure);
  await wait(()=>scenario.descriptions.length===1&&document.querySelector('[role="alert"] button'),'delayed description and related failure');
  document.querySelector('[role="alert"] button').click();
  await wait(()=>scenario.relatedCalls===2&&document.body.innerText.includes('Usable issue'),'related retry completed');
  check(!scenario.descriptions[0].aborted,'Related retry aborted its pending description sibling');
  check(scenario.descriptions.length===1,'Related retry duplicated description');
  scenario.descriptions[0].resolve(description('Delayed description survives '+failure));
  await wait(()=>document.body.innerText.includes('Delayed description survives '+failure),'description settled after sibling retry');
  check(!document.body.innerText.includes('Loading description'),'description stranded in loading');
  check(scenario.store.entries['activity:1']&&scenario.store.entries['threads:'],'successful sibling cache lost');
  reports.push({case:'pending-description-related-'+failure,descriptionCalls:scenario.descriptions.length,relatedCalls:scenario.relatedCalls});
}
root.render(null);await pause();
{
 const scenario=delayedContext({failure:'description'});scenario.mount('general-retry');
 await wait(()=>scenario.related.length===1&&button('Try again'),'description error and pending related');
 button('Try again').click();await wait(()=>scenario.descriptions.length===2,'description retry');
 check(!scenario.related[0].aborted&&scenario.relatedCalls===1,'General retry aborted or duplicated a healthy pending sibling');
 scenario.descriptions[1].resolve(description('Recovered description'));scenario.related[0].resolve(relatedResponse(false));
 await wait(()=>document.body.innerText.includes('Recovered description')&&document.body.innerText.includes('Usable issue'),'independent retries settled');
 reports.push({case:'pending-related-description-retry',descriptionCalls:scenario.descriptions.length,relatedCalls:scenario.relatedCalls});
}
root.render(null);await pause();
{
 const scenario=delayedContext({failure:'none'});scenario.store.entries['activity:1'].data.hasMore=true;scenario.mount('conversation-pages');
 await wait(()=>scenario.descriptions.length===1&&button('Next page'),'conversation page offer');
 button('Next page').click();await wait(()=>scenario.activity.length===2,'second activity page');
 check(!scenario.descriptions[0].aborted&&scenario.descriptions.length===1,'Conversation paging aborted its pending description');
 scenario.activity[0].resolve([{id:1,body:'Second page comment',created_at:'2026-10-09T00:00:00Z'}]);scenario.activity[1].resolve([]);
 await wait(()=>document.body.innerText.includes('Second page comment')&&button('Previous page'),'second activity page settled');
 button('Previous page').click();await wait(()=>!!button('Next page'),'first activity page restored');
 scenario.descriptions[0].resolve(description('Paged conversation description'));await wait(()=>document.body.innerText.includes('Paged conversation description'),'description after paging');
 button('Next page').click();await wait(()=>document.body.innerText.includes('Second page comment'),'cached second activity page');
 check(scenario.activity.length===2&&scenario.descriptions.length===1,'Paging refetched successful sibling context');
 reports.push({case:'conversation-paging-preserves-pending-sibling',activityCalls:scenario.activity.length,descriptionCalls:scenario.descriptions.length});
}
root.render(null);await pause();
{
 // Deliberately deliver responses after abort to prove request ownership, not
 // transport cooperation, keeps stale completions out of a replacement read.
 const scenario=delayedContext({failure:'none',ignoreAbort:true});scenario.mount('navigation');
 await wait(()=>scenario.descriptions.length===1&&document.body.innerText.includes('Usable issue'),'navigation initial reads');
 button('Files changed').click();await wait(()=>scenario.descriptions[0].aborted,'leaving conversation cancels description');
 button('Next page').click();await wait(()=>scenario.files.length===1,'second file page read');
 button('Conversation').click();await wait(()=>scenario.files[0].aborted&&scenario.descriptions.length===2,'tab change cancels file page and resumes description');
 scenario.descriptions[1].resolve(description('Replacement description'));
 await wait(()=>document.body.innerText.includes('Replacement description'),'replacement description');
 scenario.descriptions[0].resolve(description('Late obsolete description','c'.repeat(40)));scenario.files[0].resolve([]);await pause();
 check(document.body.innerText.includes('Replacement description')&&!document.body.innerText.includes('This PR changed'),'aborted stale completion overwrote current read');
 button('Files changed').click();await wait(()=>button('Previous page')===undefined&&scenario.files.length===2,'cancelled page restarts instead of caching loader');
 scenario.files[1].resolve([]);await wait(()=>scenario.descriptions.length===3,'file page version read');
 scenario.descriptions[2].resolve(description('File version'));await wait(()=>!!button('Previous page'),'file page completion');
 button('Previous page').click();await wait(()=>!!button('Next page'),'cached first file page restored');
 check(scenario.files.length===2,'successful first page refetched');
 button('Conversation').click();await wait(()=>document.body.innerText.includes('Replacement description'),'cached conversation restored');
 check(scenario.descriptions.length===3&&scenario.relatedCalls===1,'successful context refetched during navigation');
 reports.push({case:'tab-page-cancellation-and-late-completion',descriptionCalls:scenario.descriptions.length,filesCalls:scenario.files.length});
}
root.render(null);await pause();
{
 const scenario=delayedContext({failure:'none',ignoreAbort:true});scenario.mount('close');
 await wait(()=>scenario.descriptions.length===1&&document.body.innerText.includes('Usable issue'),'close initial reads');
 root.render(null);await wait(()=>scenario.descriptions[0].aborted,'close cancels in-flight read');
 check(!scenario.store.entries['description:1'],'close persisted an incomplete loader');
 scenario.mount('reopen');await wait(()=>scenario.descriptions.length===2,'reopen resumes incomplete description');
 scenario.descriptions[1].resolve(description('Reopened description'));await wait(()=>document.body.innerText.includes('Reopened description'),'reopen settles');
 scenario.descriptions[0].resolve(description('Closed obsolete description'));await pause();
 check(document.body.innerText.includes('Reopened description')&&!document.body.innerText.includes('Closed obsolete description'),'closed request contaminated reopened cache');
 check(scenario.relatedCalls===1,'reopen refetched successful related context');
 root.render(null);await pause();scenario.mount('cached-reopen');await wait(()=>document.body.innerText.includes('Reopened description'),'settled description cache reused');
 check(scenario.descriptions.length===2,'successful description refetched on reopen');
 reports.push({case:'close-reopen-request-ownership',descriptionCalls:scenario.descriptions.length,relatedCalls:scenario.relatedCalls});
}
root.render(null);await pause();
{
 const scenario=delayedContext({failure:'none'});scenario.mount('stale');
 await wait(()=>scenario.descriptions.length===1,'stale version read');
 scenario.descriptions[0].resolve(description('Wrong version','c'.repeat(40)));
 await wait(()=>!!button('Refresh PR list'),'stale version guard');
 check(document.querySelector('.co-pr-detail .co-agent-menu-button').disabled&&!document.body.innerText.includes('Wrong version'),'stale context enabled review or rendered mismatched body');
 reports.push({case:'active-version-mismatch-blocks-review'});
}
check(unexpectedReads.length===0,'Successful cached siblings were refetched: '+unexpectedReads.join(', '));
return{status:'pass',reports};}catch(e){return{status:'fail',error:e.stack,reports,dom:document.body.innerText}}};`;

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
