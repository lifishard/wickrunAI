const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.join(__dirname,'..',p);
const stub=(p,exports)=>{const id=require.resolve(p);require.cache[id]={id,filename:id,loaded:true,exports};};
let settings={};
stub('../electron/store.cjs',{kvGet:()=>JSON.stringify(settings),secretGet:()=>null});
stub('../electron/hooks.cjs',{runHooks:async()=>''});
const {runTool}=require('../electron/tools/index.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-review-runtime-'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});settings={};return {root,p:path.join(root,'code.ts'),ctx:{workspaceRoots:[root],reviewCodeChanges:true}};}
test('host dispatcher enforces review even if caller omits setting and blocks shell bypass',async t=>{
  const {p,root}=fixture(t);settings={tools:{reviewCodeChanges:true}};
  const blocked=await runTool('write_file',{path:p,content:'bad'},{workspaceRoots:[root]});assert.equal(blocked.ok,false);assert.equal(fs.existsSync(p),false);
  const shell=await runTool('run_command',{command:'node -e "process.exit(1)"',cwd:root},{workspaceRoots:[root]});assert.match(shell.error,/已阻止执行/);
  const preview=await runTool('preview_code_change',{name:'write_file',args:{path:p,content:'good'}},{workspaceRoots:[root]});
  assert.equal(preview.ok,true);assert.equal(fs.existsSync(p),false);
  const applied=await runTool('write_file',{path:p,content:'good'},{workspaceRoots:[root],codeReviewToken:preview.reviewToken});assert.equal(applied.ok,true);assert.equal(fs.readFileSync(p,'utf8'),'good');
});
for(const approved of [false,true,'post'])test(approved==='post'?'post-review applies edits without repeated prompts even when other tools require approval':`agent presents real diff under all-allow policy and ${approved?'applies approved content':'preserves rejected content'}`,async t=>{
  const {p,ctx}=fixture(t);fs.writeFileSync(p,'before\n');let prompts=0, confirms=0,resolve;const finished=new Promise(r=>resolve=r),steps=[];
  const transport={abort:async()=>{},callTool:async(name,args,context)=>runTool(name,args,{...context,execution:undefined}),chat:async(_req,h)=>{
    prompts++;h.onContent(prompts===1?'':'Done');h.onToolCalls(prompts===1?[{id:'edit',name:'edit_file',arguments:JSON.stringify({path:p,old_str:'before',new_str:'after'})}]:[]);h.onStop({reason:prompts===1?'tool_calls':'stop',droppedCalls:0});h.onDone();
  }};
  const load=loader({[file('src/lib/transport.ts')]:{getTransport:()=>transport}}),cfg=load(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(cfg,{model:'mock',toolsEnabled:true,enabledTools:['edit_file'],approvalMode:'all',maxToolRounds:3,runtime:{harness:'off',contextTokens:50000,maxMinutes:1,maxTokens:100000}});
  if(approved==='post'){ctx.reviewCodeChanges=false;ctx.postReviewCodeChanges=true;cfg.approvalMode='ask';}
  load(file('src/lib/agent.ts')).runAgent({requestId:'audit-'+approved,config:cfg,profile:{id:'audit',baseUrl:'http://localhost/v1'},apiKey:'test',history:[{id:'q',role:'user',content:'Change before to after',createdAt:1}],toolCtx:()=>ctx,extraSystem:'',effortMappings:[],timeoutMs:1000,canRunHostTools:true,autoRetry:0,
    confirm:async step=>{confirms++;assert.equal(fs.readFileSync(p,'utf8'),'before\n');assert.equal(step.codeChanges[0].status,'pending');assert.ok(step.codeChanges[0].lines.some(l=>l.text==='after'));return approved;},grantAccess:async()=>({ok:false,content:''}),
    events:{onContentDelta(){},onReasoningDelta(){},onSources(){},onUsage(){},onRound(){},onNotice(){},onStopReason(){},onStep:s=>steps.push(structuredClone(s)),onRunState:async()=>{},onDone:()=>resolve('done'),onPaused:r=>resolve(r),onError:r=>resolve(r)}});
  await finished;assert.equal(confirms,approved==='post'?0:1);assert.equal(fs.readFileSync(p,'utf8'),approved?'after\n':'before\n');assert.equal(steps.at(-1).codeChanges[0].status,approved?'applied':'denied');
});
