const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const source=p=>path.join(__dirname,'..',p);
const load=loader();
const {butlerWorkConfig,butlerWorkPrompt,BUTLER_AUTONOMOUS_TOOLS}=load(source('src/lib/butler-work.ts'));
const defaults=load(source('src/lib/paramSchema.ts')).defaultGenerationConfig();
const settings={defaultConfig:{...defaults,enabledTools:['run_command','chrome_click','mcp_any','claude_code','delete_file']},
  routeGroups:[{id:'chosen',routes:[{profileId:'key',model:'mock'}]}]};
const prefs={allowRoutineExecution:true,backend:{kind:'route-group',routeGroupId:'chosen',effort:'medium'}};
const brain={schema:1,accountId:'own',signals:[],goals:[],briefs:[],skillProposals:[],actionGrants:[],updatedAt:1};
const goal={id:'goal',accountId:'own',title:'Make a shortlist',hypothesis:'Create a reviewable draft',evidenceIds:[],confidence:'medium',status:'proposed',updatedAt:1};

test('automatic Work uses a strict file-artifact tool list and no inherited broad tools',()=>{
  const {config}=butlerWorkConfig(settings,prefs,{autonomous:true});
  assert.deepEqual(config.enabledTools,[...BUTLER_AUTONOMOUS_TOOLS]);
  assert.equal(config.approvalMode,'auto');
  for(const forbidden of ['run_command','chrome_click','mcp_any','claude_code','delete_file'])
    assert.equal(config.enabledTools.includes(forbidden),false,forbidden);
  assert.ok(config.enabledTools.includes('write_file'));
  assert.ok(config.enabledTools.includes('read_source_text'));
});

test('automatic Work requires routine permission and marks native clients for host enforcement',()=>{
  assert.throws(()=>butlerWorkConfig(settings,{...prefs,allowRoutineExecution:false},{autonomous:true}),/日常执行权限/);
  const native=butlerWorkConfig(settings,{...prefs,backend:{kind:'native',client:{kind:'codex',model:'default'}}},{autonomous:true});
  assert.equal(native.config.client.butlerAutonomous,true);
});

test('automatic proposed goal gets a bounded, cautious handoff and dismissed goal is rejected',()=>{
  const large={...brain,signals:Array.from({length:250},(_,i)=>({id:String(i),accountId:'own',source:'wickrun',sourceLabel:'Chat',topic:'a'.repeat(100),intent:'b'.repeat(100),summary:'c'.repeat(400),observedAt:i,confidence:'medium',basis:'behavior',modelSafe:true})),goals:Array.from({length:30},(_,i)=>({...goal,id:String(i),status:'confirmed',evidenceIds:[String(i)]}))};
  const prompt=butlerWorkPrompt(large,{...goal,hypothesis:'draft '.repeat(10000)},{autonomous:true});
  assert.ok(prompt.length<=16000);
  assert.match(prompt,/候选需求/);
  assert.match(prompt,/butler-brain/);
  assert.match(prompt,/隔离工作目录/);
  const memory=prompt.match(/近期线索：(\{[^\n]+\})\n/);
  assert.ok(memory,'memory excerpt is a complete JSON object');
  assert.equal(JSON.parse(memory[1]).sourceTextId,'butler-brain');
  assert.throws(()=>butlerWorkPrompt(brain,goal),/确认或纠正/);
  assert.throws(()=>butlerWorkPrompt(brain,{...goal,status:'dismissed'},{autonomous:true}),/已否定/);
});
