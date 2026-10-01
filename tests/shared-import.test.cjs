const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');

const lib=path.resolve(__dirname,'../src/lib');
const shared=loader({[path.join(lib,'cloud-api.ts')]:{cloudCall:async()=>({})}})(path.join(lib,'shared-resources.ts'));
const imported=loader({[path.join(lib,'shared-resources.ts')]:shared})(path.join(lib,'shared-import.ts'));
const policy={visibility:'private',linkRole:'viewer',invites:[]};
const item=(id,kind,payload,parentId)=>({id,kind,title:id,ownerId:'someone-else',revision:1,payload,policy,createdAt:1,updatedAt:1,...(parentId?{parentId}:{})});

test('shared tree is read completely before import and never traverses duplicate children',async()=>{
  const root=item('project','project',{instructions:'Read the brief'});
  const child=item('conversation','conversation',{messages:[]},root.id);
  const grandchild=item('file','file',{name:'notes.txt',text:'Notes'},child.id);
  const seen=[];
  const descendants=await imported.readSharedTree(root,'link-token',async(operation,input)=>{
    assert.equal(operation,'get');seen.push(input);
    return {children:input.itemId===root.id?[child,child]:input.itemId===child.id?[grandchild]:[]};
  });
  assert.deepEqual(descendants.map(x=>x.id),['conversation','file']);
  assert.deepEqual(seen.map(x=>x.itemId),['project','conversation']);
  assert.ok(seen.every(x=>x.token==='link-token'));
});

test('shared copy gives fresh local identities and own disabled execution settings',()=>{
  const root=item('shared-project','project',{instructions:'Public instructions',docs:[{id:'remote-doc',name:'Brief',content:'Content'}],prompts:[]});
  const conversation=item('shared-chat','conversation',{messages:[{id:'remote-message',role:'user',content:'Question',createdAt:1},{id:'private-tool',role:'tool',content:'secret',createdAt:2}]},root.id);
  const workflow=item('shared-workflow','workflow',{definition:{nodes:[{id:'start',type:'start',title:'Start',x:0,y:0,memberId:'remote-agent',inputRefs:[],ports:[]}],edges:[],maxSteps:10,maxMinutes:20,maxTokens:30000},agents:[{id:'remote-agent',name:'Agent',description:'Review'}],schedules:[{name:'Daily',goal:'Review',acceptance:'Summary',timezone:'UTC',hour:9,minute:0}],runs:[{id:'remote-run',goal:'Old result'}]},root.id);
  // Imported run evidence is ignored; the public definition and schedule alone are copied.
  const copy=imported.buildSharedCopy(root,[conversation,workflow],{model:'own-model',toolsEnabled:true,client:{id:'local'}},'own-key');
  assert.notEqual(copy.project.id,root.id);
  assert.notEqual(copy.project.docs[0].id,'remote-doc');
  assert.equal(copy.project.instructions,'Public instructions');
  assert.equal(copy.conversations.length,1);
  assert.notEqual(copy.conversations[0].id,conversation.id);
  assert.notEqual(copy.conversations[0].messages[0].id,'remote-message');
  assert.equal(copy.conversations[0].messages.length,1);
  assert.equal(copy.conversations[0].keyProfileId,'own-key');
  assert.equal(copy.conversations[0].config.toolsEnabled,false);
  assert.equal(copy.conversations[0].config.client,undefined);
  assert.equal(copy.members[0].enabled,false);
  assert.equal(copy.members[0].connectionId,'');
  assert.deepEqual(copy.members[0].tools,[]);
  assert.notEqual(copy.members[0].id,'remote-agent');
  assert.notEqual(copy.workflows[0].id,workflow.id);
  assert.equal(copy.workflows[0].draft.nodes[0].memberId,copy.members[0].id);
  assert.deepEqual(copy.workflows[0].runs,undefined);
  assert.equal(copy.schedules[0].enabled,false);
  assert.equal(copy.schedules[0].nextAt,0);
  assert.equal(copy.schedules[0].workflowId,copy.workflows[0].id);
  assert.equal(JSON.stringify(copy).includes('remote-run'),false);
});

test('handoff opens as a stable unsent draft without tools, client permissions or auto-run',()=>{
  const draft=imported.sharedHandoffDraft('receipt-1',{goal:'Summarize',summary:'Known context',artifacts:[{name:'evidence.txt',text:'Fact'}]},
    {model:'own-model',toolsEnabled:true,client:{butlerAutonomous:true}},'own-key','own-project');
  assert.equal(draft.id,'shared-handoff-receipt-1');
  assert.equal(draft.projectId,'own-project');
  assert.equal(draft.keyProfileId,'own-key');
  assert.deepEqual(draft.messages,[]);
  assert.match(draft.draft,/Known context/);
  assert.match(draft.draft,/Fact/);
  assert.equal(draft.config.toolsEnabled,false);
  assert.equal(draft.config.client,undefined);
});
