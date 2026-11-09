import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { frontendModules } from './render-harness.mjs'
import { launchOptions, reviewOptions, workflowAgent } from '../review-prompts.js'

const options = { review_prompt:'Exact review', fix_prompt:'Exact fix', merge_prompt:'Exact merge', max_rounds:3 }
const agent = { provider:'codex', model:'pinned-fixture-model', effort:'high' }
// Like the server's fingerprint, independent of key order.
const digest = value => createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:1)))).digest('hex')
const deferred = () => { let resolve; return { promise:new Promise(done => { resolve=done }), resolve:value => resolve(value) } }
let component
async function load() {
  if (component) return component
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)
  // Execute the real component effect, with deterministic hook scheduling and
  // observational dependencies. No browser, saved storage, or public transport.
  const build = await rolldown({ input:new URL('../ui/ReviewPromptSettings.jsx', import.meta.url).pathname,
    platform:'node', tsconfig:false, transform:{jsx:'react-jsx'}, resolve:{modules:[frontendModules,'node_modules']},
    plugins:[{ name:'preview-effect-fixture',
      resolveId(id) { if(id === 'react') return '\0preview-hooks'; if(id === '../review-prompts.js') return '\0preview-dependencies' },
      load(id) {
        if(id === '\0preview-hooks') return `export const useState = value => {const fixture=globalThis.previewEffectFixture;return [value,next=>fixture.states.push(next)]}; export const useEffect = effect => {globalThis.previewEffectFixture.cleanup=effect()}`
        if(id === '\0preview-dependencies') return `export const reviewOptions=(...args)=>globalThis.previewEffectFixture.reviewOptions(...args), launchOptions=(...args)=>globalThis.previewEffectFixture.launchOptions(...args), workflowAgent=(...args)=>globalThis.previewEffectFixture.workflowAgent(...args), loadWorkflowOptions=(...args)=>globalThis.previewEffectFixture.loadWorkflowOptions(...args), previewWorkflow=(...args)=>globalThis.previewEffectFixture.previewWorkflow(...args), saveWorkflowOptions=()=>{throw new Error('Preview cannot save settings')}, oversizedPrompt=()=>'', promptBytes=()=>0, PROMPT_BYTE_LIMIT=16384`
      },
    }],
  })
  try {
    const { output } = await build.generate({format:'cjs'}), module = {exports:{}}
    new Function('module','exports','require',output[0].code)(module,module.exports,require)
    component = module.exports.ReviewPromptPreview
    return component
  } finally { await build.close() }
}
async function fixture(t, choice, dependencies = {}) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for the native component bundler'); return null }
  const render = await load(), states=[], resolved=[], previews=[]
  const value = { states, resolved, previews, reviewOptions, launchOptions, workflowAgent,
    loadWorkflowOptions:async()=>({options:{review_prompt:'New default',fix_prompt:'Fix default',merge_prompt:'Merge default'},capabilities:{draft_takeover:true,post_review:true,propose_verdict:true}}),
    previewWorkflow:async(token,appId,sent,model,mode)=>{previews.push({token,appId,options:sent,agent:model,mode});return {preview_sha256:digest(sent)}},
    ...dependencies,
  }
  const previous=globalThis.previewEffectFixture;globalThis.previewEffectFixture=value
  t.after(()=>{value.cleanup?.(); if(previous === undefined) delete globalThis.previewEffectFixture;else globalThis.previewEffectFixture=previous})
  render({token:'fixture',appId:'fixture-app',choice,onResolved:next=>resolved.push(next)})
  // Drain only known promise continuations; no timing retry or background work.
  value.flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
  return value
}
test('a frozen takeover preview keeps its exact repair options and names its mode',async t=>{
  const f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options,agent,preview_sha256:digest(options)})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews.map(p=>({...p,options:digest(p.options)})),[{token:'fixture',appId:'fixture-app',options:digest(options),agent,mode:'review_fix_merge'}])
  assert.equal(f.resolved.length,2);assert.equal(f.resolved[0],null)
  assert.deepEqual(f.resolved[1].options,options);assert.equal(f.resolved[1].preview.preview_sha256,digest(options))
})
for(const legacy of [{autopilot:false},{autopilot:true},{post_review:false},{post_review:true}]) test(`a frozen takeover never sends ${JSON.stringify(legacy)}, which the platform does not accept for it`,async t=>{
  const f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options:{...options,...legacy},agent,preview_sha256:digest(options)})
  if(!f)return;await f.flush()
  assert.equal(digest(f.previews[0].options),digest(options));assert.equal(f.resolved[1].preview.preview_sha256,digest(options))
})
test('a new takeover sends its fix prompt but never automatic continuation or the post-review grant',async t=>{
  const f=await fixture(t,{request_id:'new-fixture',mode:'review_fix_merge',options:{autopilot:true,post_review:true},agent})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews[0].options,{review_prompt:'New default',merge_prompt:'Merge default',fix_prompt:'Fix default'})
  assert.equal(f.previews[0].mode,'review_fix_merge')
  assert.equal(f.resolved[1].preview.preview_sha256,digest(f.previews[0].options))
})
test('frozen options never import newly added defaults into their preview identity',async t=>{
  const frozen={review_prompt:'Only this'}, f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options:frozen,agent,preview_sha256:digest(frozen)})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews[0].options,frozen);assert.deepEqual(f.resolved[1].options,frozen)
})
test('drifted frozen preview stays unresolved without overriding the expected hash or starting work',async t=>{
  const f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options,agent,preview_sha256:'f'.repeat(64)})
  if(!f)return;await f.flush()
  assert.deepEqual(f.resolved,[null]);assert.match(f.states.at(-1).error,/saved instructions or model changed/)
  assert.equal(f.previews.length,1)
})
for(const outcome of ['success','drift']) test(`cancelled preview ignores late ${outcome} rather than resolving another approval`,async t=>{
  const pending=deferred(), f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options,agent,preview_sha256:digest(options)},
    {previewWorkflow:async(...args)=>{globalThis.previewEffectFixture.previews.push(args);return pending.promise}})
  if(!f)return;await f.flush();assert.equal(f.previews.length,1)
  f.cleanup();pending.resolve({preview_sha256:outcome==='success'?digest(options):'f'.repeat(64)});await f.flush()
  assert.deepEqual(f.resolved,[null]);assert.deepEqual(f.states,[{loading:true}])
})

test('a Möbius without posted review never receives the post-review grant',async t=>{
  const f=await fixture(t,{request_id:'new-review',mode:'review',options:{post_review:true},agent},
    {loadWorkflowOptions:async()=>({options:{review_prompt:'New default',post_review:true},capabilities:{}})})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews[0].options,{review_prompt:'New default'})
})
test('each mode previews with its own mode and only the options that mode accepts',async t=>{
  const sent={}
  for(const mode of ['review','review_merge','review_fix_merge']){
    const f=await fixture(t,{request_id:'new-'+mode,mode,options:{max_rounds:4,post_review:true,propose_verdict:true,autopilot:true},agent})
    if(!f)return;await f.flush()
    assert.equal(f.previews[0].mode,mode)
    sent[mode]=f.previews[0].options
  }
  assert.deepEqual(sent.review,{review_prompt:'New default',merge_prompt:'Merge default',post_review:true,propose_verdict:true})
  assert.deepEqual(sent.review_merge,{review_prompt:'New default',merge_prompt:'Merge default'})
  assert.deepEqual(sent.review_fix_merge,{review_prompt:'New default',merge_prompt:'Merge default',fix_prompt:'Fix default'},'new work has no round cap')
  for(const body of Object.values(sent)) assert.equal('autopilot' in body,false,'automatic continuation is never sent')
})

test('a new launch never asks to post a plain comment: posting without a verdict is dropped',async t=>{
  const f=await fixture(t,{request_id:'new-comment',mode:'review',options:{post_review:true},agent},
    {loadWorkflowOptions:async()=>({options:{review_prompt:'New default'},capabilities:{post_review:true,propose_verdict:true}})})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews[0].options,{review_prompt:'New default'})
})
