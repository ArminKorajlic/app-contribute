import test from 'node:test'
import assert from 'node:assert/strict'
import { loadWorkflowOptions, oversizedPrompt, previewWorkflow, PROMPT_BYTE_LIMIT, promptBytes, promptOverrides, reviewOptions, saveWorkflowOptions, workflowAgent, workflowSettings } from '../review-prompts.js'
import { reviewRunRequest } from '../collaboration.js'

const defaults = {review_prompt:'Review the full diff',fix_prompt:'Fix findings',merge_prompt:'Merge only when safe',max_rounds:null,autopilot:false,mandatory_instructions:'No unrelated scope'}
function storage(t, value=null, version=null, overrides={}) {
  const previous=globalThis.window
  globalThis.window={mobius:{storage:{getWithVersion:async()=>({value,version}),...overrides}}}
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous})
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(defaults)))
}
test('settings load the editable prompts and ignore retired automatic-continuation and round-cap keys',async t=>{
  storage(t)
  const fresh=await loadWorkflowOptions('fixture',80)
  assert.equal(fresh.options.review_prompt,defaults.review_prompt)
  assert.equal('autopilot' in fresh.options,false,'automatic continuation is not offered')
  assert.equal('max_rounds' in fresh.options,false)
  window.mobius.storage.getWithVersion=async()=>({value:{review_prompt:'Owner review guidance',autopilot:true,max_rounds:5},version:'v7'})
  const loaded=await loadWorkflowOptions('fixture',80)
  assert.equal(loaded.options.review_prompt,'Owner review guidance')
  assert.equal('autopilot' in loaded.options,false)
  assert.equal('max_rounds' in loaded.options,false,'a legacy budget never caps new work')
  assert.equal(loaded.version,'v7')
})
test('settings save compares the version the owner edited, never a new version read at Save',async t=>{
  const writes=[]
  storage(t,null,null,{getWithVersion:async()=>assert.fail('Save must not adopt an unseen version'),durableWrite:async(...args)=>{writes.push(args);return {durability:'synced',version:'v8'}}})
  const result=await saveWorkflowOptions({...defaults,authority:'merge any PR'},'v7')
  assert.equal(result.version,'v8')
  assert.deepEqual(writes,[['review-workflow.json',reviewOptions(defaults),{ifMatch:'v7'}]])
  await saveWorkflowOptions(defaults,null)
  assert.deepEqual(writes[1][2],{ifNoneMatch:true})
})
test('saving keeps only the prompts that differ from the current defaults; restore clears the override',async t=>{
  const writes=[]
  storage(t,null,null,{durableWrite:async(...args)=>{writes.push(args);return {durability:'synced',version:'v2'}}})
  const presets={review_prompt:'Review preset',fix_prompt:'Fix preset',merge_prompt:'Merge preset'}
  // Pressing Save on untouched settings pins no preset text.
  await saveWorkflowOptions({...presets},'v1',presets)
  assert.deepEqual(writes[0][1],{})
  // Editing one prompt saves only that prompt.
  await saveWorkflowOptions({...presets,fix_prompt:'My fix guidance'},'v2',presets)
  assert.deepEqual(writes[1][1],{fix_prompt:'My fix guidance'})
  // Restore sets the default text back, which removes the override on Save.
  await saveWorkflowOptions({...presets,fix_prompt:presets.fix_prompt},'v3',presets)
  assert.equal('fix_prompt' in writes[2][1],false)
  assert.deepEqual(promptOverrides({review_prompt:'x'},null),{review_prompt:'x'},'without known defaults nothing is dropped')
})
test('offline reads and unconfirmed saves never claim durable prompt settings',async t=>{
  storage(t,null,null,{getWithVersion:async()=>({offline:true}),durableWrite:async()=>({durability:'queued'})})
  await assert.rejects(workflowSettings(),/Go online/)
  await assert.rejects(saveWorkflowOptions(defaults,'v7'),/not confirmed saved/)
})
test('preview and admission use the same explicit model, mode and mode-accepted instructions',async t=>{
  const agent=workflowAgent({provider:'codex',model:'model-id',effort:'high'})
  const options={...reviewOptions({},defaults),max_rounds:3,autopilot:true,post_review:true},calls=[]
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({options,preview_sha256:'c'.repeat(64)}))})
  const preview=await previewWorkflow('fixture',80,options,agent,'review_fix_merge')
  const request=reviewRunRequest({request_id:'fixture-1',mode:'review_fix_merge',options,agent,preview_sha256:preview.preview_sha256,pulls:[{number:7,repository:{nameWithOwner:'owner/repo'},headRefOid:'a'.repeat(40),baseRefName:'main',baseRefOid:'b'.repeat(40),baseRef:{target:{oid:'b'.repeat(40)}}}]})
  assert.deepEqual(calls[0],{mode:'review_fix_merge',options:{review_prompt:defaults.review_prompt,merge_prompt:defaults.merge_prompt,fix_prompt:defaults.fix_prompt,max_rounds:3},agent})
  assert.deepEqual(request.agent,calls[0].agent)
  assert.deepEqual(request.options,calls[0].options,'the start sends exactly the previewed options')
  assert.equal(request.confirmation_scope,'named_pr_repairs_and_reviewed_successors')
  assert.equal(request.preview_sha256,'c'.repeat(64))
  // Review and Review & merge never carry repair options; both may carry the post-review grant.
  await previewWorkflow('fixture',80,options,agent,'review')
  assert.deepEqual(calls[1],{mode:'review',options:{review_prompt:defaults.review_prompt,merge_prompt:defaults.merge_prompt,post_review:true},agent})
  await previewWorkflow('fixture',80,{...options,propose_verdict:true},agent,'review_merge')
  assert.deepEqual(calls[2].options,{review_prompt:defaults.review_prompt,merge_prompt:defaults.merge_prompt,post_review:true,propose_verdict:true})
  // A verdict without posting is never sent.
  await previewWorkflow('fixture',80,{...options,post_review:false,propose_verdict:true},agent,'review')
  assert.deepEqual(calls[3].options,{review_prompt:defaults.review_prompt,merge_prompt:defaults.merge_prompt})
  assert.equal(workflowAgent({provider:'',model:''}),undefined)
  assert.deepEqual(workflowAgent({provider:'codex',model:'model-id',effort:''}),{provider:'codex',model:'model-id'})
})

test('served readiness capability is discovery metadata, never a prompt or saved authority',async t=>{
  storage(t)
  globalThis.fetch=async()=>new Response(JSON.stringify({presets:defaults,capabilities:{draft_takeover:true}}))
  const loaded=await loadWorkflowOptions('fixture',80)
  assert.equal(loaded.capabilities.draft_takeover,true)
  assert.equal(reviewOptions(loaded.options).draft_takeover,undefined)
  assert.equal(reviewOptions({...loaded.options,capabilities:loaded.capabilities}).capabilities,undefined)
})

test('prompts are limited in UTF-8 bytes like the platform, so non-ASCII text is counted fully',async t=>{
  assert.equal(PROMPT_BYTE_LIMIT,16384)
  assert.equal(promptBytes('é'),2); assert.equal(promptBytes('漢'),3); assert.equal(promptBytes('🚀'),4)
  const fits='漢'.repeat(5461), over='漢'.repeat(5462)
  assert.ok(fits.length < 16000 && over.length < 16000, 'both are under the old 16,000-character limit')
  assert.equal(oversizedPrompt({review_prompt:fits}),'')
  assert.equal(oversizedPrompt({fix_prompt:over}),'fix_prompt')
  const writes=[]
  storage(t,null,null,{durableWrite:async(...args)=>{writes.push(args);return {durability:'synced',version:'v2'}}})
  await assert.rejects(saveWorkflowOptions({review_prompt:over},'v1',{}),/longer than 16,384 bytes/)
  assert.equal(writes.length,0,'an oversized prompt is never saved')
  await saveWorkflowOptions({review_prompt:fits},'v1',{})
  assert.equal(writes.length,1)
})
