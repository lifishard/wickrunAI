const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const source=p=>path.join(__dirname,'..',p);
const stub=(p,exports)=>{const id=require.resolve(p);require.cache[id]={id,filename:id,loaded:true,exports};};
let hostSettings={};
stub('../electron/store.cjs',{kvGet:()=>JSON.stringify(hostSettings),secretGet:()=>null});
stub('../electron/hooks.cjs',{runHooks:async()=>''});
const {runTool}=require('../electron/tools/index.cjs');
const call=(id,name,args)=>({id,name,arguments:JSON.stringify(args)});

async function exercise(t,approve){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-butler-work-'));
  t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const output=path.join(root,'brief.md');hostSettings={tools:{reviewCodeChanges:true}};
  const states=[],steps=[],requests=[],approvals=[];
  let rounds=0,finish;const finished=new Promise(resolve=>{finish=resolve;});
  const transport={abort:async()=>{},callTool:async(name,args,ctx)=>runTool(name,args,{...ctx,execution:undefined}),
    chat:async(init,h)=>{requests.push(init);rounds++;
      if(rounds===1){h.onContent('Creating the requested artifact.');
        h.onToolCalls([call('write-artifact','write_file',{path:output,content:'# AI tool shortlist\n\nReviewed sources and open questions.\n'})]);
        h.onStop({reason:'tool_calls',droppedCalls:0});}
      else {h.onContent(approve?'The reviewable file is ready.':'The file change was not approved.');h.onToolCalls([]);h.onStop({reason:'stop',droppedCalls:0});}
      h.onUsage({prompt_tokens:100,completion_tokens:50,total_tokens:150});h.onDone();}};
  const load=loader({[source('src/lib/transport.ts')]:{getTransport:()=>transport}});
  const defaults=load(source('src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(defaults,{model:'old',enabledTools:['write_file'],approvalMode:'all',maxToolRounds:3,
    runtime:{contextTokens:50000,maxMinutes:1,maxTokens:100000}});
  const settings={defaultConfig:defaults,routeGroups:[{id:'chosen',routes:[{profileId:'key',model:'mock'}]}]};
  const prefs={backend:{kind:'route-group',routeGroupId:'chosen',effort:'medium'}};
  const {butlerWorkConfig,butlerWorkPrompt}=load(source('src/lib/butler-work.ts'));
  const brain={schema:1,accountId:'own',signals:[{id:'evidence',accountId:'own',source:'wickrun',sourceLabel:'Chat',topic:'AI tools',intent:'compare',
    summary:'Find useful AI tools',observedAt:1,confidence:'high',basis:'user-stated',modelSafe:true}],goals:[],briefs:[],skillProposals:[],actionGrants:[],updatedAt:1};
  const goal={id:'goal',accountId:'own',title:'Make a useful AI tool shortlist',hypothesis:'Make a shortlist with sources',evidenceIds:['evidence'],confidence:'high',status:'confirmed',updatedAt:2};
  brain.goals=[goal];
  const {config}=butlerWorkConfig(settings,prefs),prompt=butlerWorkPrompt(brain,goal);
  assert.equal(config.runtime.harness,'guided');assert.equal(config.runtime.semanticCompression,true);
  assert.equal(config.runtime.autoHandoff,true);assert.match(prompt,/Make a useful AI tool shortlist/);
  const ctx={workspaceRoots:[root],reviewCodeChanges:true};
  load(source('src/lib/agent.ts')).runAgent({requestId:`work-${approve}`,profile:{id:'key',name:'Test',baseUrl:'http://localhost/v1'},apiKey:'test',config,
    history:[{id:'user-request',role:'user',content:prompt,createdAt:1}],toolCtx:()=>ctx,extraSystem:'',effortMappings:[],timeoutMs:1000,
    canRunHostTools:true,autoRetry:0,
    confirm:async step=>{approvals.push(structuredClone(step));assert.equal(fs.existsSync(output),false);return approve;},
    grantAccess:async()=>({ok:false,content:''}),
    events:{onContentDelta(){},onReasoningDelta(){},onSources(){},onUsage(){},onRound(){},onNotice(){},onStopReason(){},
      onStep:s=>steps.push(structuredClone(s)),onRunState:async state=>{if(state)states.push(structuredClone(state));},
      onDone:()=>finish('done'),onPaused:reason=>finish(reason),onError:error=>finish(error)}});
  const outcome=await finished;
  assert.ok(approvals.length>=1,'the normal Work engine requests approval for a file write');
  assert.equal(approvals[0].codeChanges[0].status,'pending');
  assert.ok(states.some(state=>state.working.some(message=>message.id==='user-request')),'original user request is checkpointed');
  assert.ok(states.some(state=>state.steps?.some(step=>step.name==='write_file')),'file operation is checkpointed');
  assert.ok(requests[0].body.tools.some(tool=>tool.function.name==='write_file'),'normal Work tool is available');
  assert.equal(fs.existsSync(output),approve);
  if(approve)assert.match(fs.readFileSync(output,'utf8'),/AI tool shortlist/);
  assert.equal(steps.filter(step=>step.name==='write_file').at(-1).status,approve?'ok':'denied');
  return {outcome,states,steps};
}

test('confirmed Butler goal executes through real Work engine and writes an approved artifact',async t=>{
  const result=await exercise(t,true);
  assert.ok(result.states.some(s=>s.harness?.mode==='guided'));
});

test('real Work approval rejection preserves the workspace and the denial in its checkpoint',async t=>{
  const result=await exercise(t,false);
  assert.ok(result.steps.some(s=>s.name==='write_file'&&s.status==='denied'));
});
