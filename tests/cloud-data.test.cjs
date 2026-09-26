const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const root=path.join(__dirname,'..','src','lib');
const {emptyCloudData,mergeCloudData,projectCloudData,hydrateCloudData,CloudMergeConflict}=loader()(path.join(root,'cloud-data.ts'));

test('cloud merge keeps independent edits and propagates deletions without device timestamps',()=>{
  const base={...emptyCloudData(),projects:[{id:'p',name:'old'},{id:'deleted',name:'remove me'}]};
  const local={...base,projects:[{id:'p',name:'changed locally'}]};
  const remote={...base,skills:[{id:'s',body:'remote skill',installedAt:1}]};
  const merged=mergeCloudData(base,local,remote);
  assert.deepEqual(merged.projects,[{id:'p',name:'changed locally'}]);
  assert.equal(merged.skills[0].body,'remote skill');
  assert.deepEqual(mergeCloudData(base,remote,local),merged);
  assert.deepEqual(mergeCloudData(merged,merged,merged),merged);
});
test('same-record edits and delete-versus-edit require an explicit conflict decision',()=>{
  const base={...emptyCloudData(),projects:[{id:'p',name:'base'}]};
  const local={...base,projects:[{id:'p',name:'local'}]};
  const remote={...base,projects:[{id:'p',name:'remote'}]};
  assert.throws(()=>mergeCloudData(base,local,remote),CloudMergeConflict);
  assert.equal(mergeCloudData(base,local,remote,'remote').projects[0].name,'remote');
  assert.equal(mergeCloudData(base,local,remote,'local').projects[0].name,'local');
  assert.throws(()=>mergeCloudData(base,{...base,projects:[]},remote),CloudMergeConflict);
});
test('preferences merge per field; no timestamp can silently win a conflict',()=>{
  const base={...emptyCloudData(),preferences:{theme:'light',locale:'en'}};
  const local={...base,preferences:{theme:'dark',locale:'en'}};
  const remote={...base,preferences:{theme:'light',locale:'zh-Hans'}};
  assert.deepEqual(mergeCloudData(base,local,remote).preferences,{theme:'dark',locale:'zh-Hans'});
});

test('an empty draft added by the UI is not a conflicting edit after importing a conversation',()=>{
  const local={settings:{keyProfiles:[],defaultConfig:{}},conversations:[{id:'c',title:'Original',config:{},messages:[]}],projects:[],skills:[],tasks:[],observations:[]};
  const base=projectCloudData(local);
  const hydrated=hydrateCloudData(base,local,[]);hydrated.conversations[0].draft='';
  const remote={...base,conversations:base.conversations.map(c=>({...c,title:'Renamed elsewhere'}))};
  assert.equal(mergeCloudData(base,projectCloudData(hydrated),remote).conversations[0].title,'Renamed elsewhere');
});
test('cloud projection excludes device capabilities and secrets; imported history cannot resume tools',()=>{
  const config={model:'test',toolsEnabled:true,enabledTools:['shell'],approvalMode:'all',client:{kind:'codex'},systemPrompt:'hello'};
  const local={settings:{theme:'dark',locale:'en',tools:{roots:['C:/private']},hooks:[{command:'bad'}],defaultConfig:config,keyProfiles:[{id:'k',name:'API',baseUrl:'https://api.example.test/v1',hasSecret:true,extraHeaders:{Authorization:'secret','x-custom':'okay'},createdAt:1}],activeKeyProfileId:'k'},
    conversations:[{id:'c',title:'Chat',createdAt:1,updatedAt:2,keyProfileId:'k',config,messages:[{id:'m',role:'assistant',content:'Saved answer',createdAt:2,pending:true,runState:{working:[],status:'running'},steps:[{name:'read_file',status:'ok'}]}]}],
    projects:[{id:'p',name:'Project',roots:['C:/private'],createdAt:1}],skills:[{id:'s',name:'skill',body:'instructions',enabled:true}],tasks:[{id:'t',name:'task',prompt:'work',enabled:true,catchUp:true}],observations:[]};
  const data=projectCloudData(local);
  assert.equal(data.profiles[0].extraHeaders.Authorization,undefined);
  assert.equal(data.preferences.tools,undefined);
  assert.equal(data.preferences.hooks,undefined);
  assert.equal(data.conversations[0].config.toolsEnabled,undefined);
  assert.equal(data.conversations[0].messages[0].runState,undefined);
  assert.equal(data.tasks[0].enabled,undefined);
  const target={...local,conversations:[],projects:[],skills:[],tasks:[],settings:{...local.settings,tools:{roots:[]},hooks:[],keyProfiles:[]}};
  const imported=hydrateCloudData(data,target,['k']);
  assert.equal(imported.conversations[0].config.toolsEnabled,false);
  assert.equal(imported.conversations[0].config.approvalMode,'ask');
  assert.equal(imported.conversations[0].messages[0].cloudImported,true);
  assert.equal(imported.conversations[0].messages[0].pending,false);
  assert.equal(imported.skills[0].enabled,false);
  assert.equal(imported.tasks[0].enabled,false);
  assert.equal(imported.tasks[0].catchUp,false);
  assert.deepEqual(imported.settings.tools.roots,[]);
  assert.equal(imported.settings.keyProfiles[0].hasSecret,true);
});

test('interrupted cloud apply restores every local collection before startup',async()=>{
  const keys=['snc:settings:v1','snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1','anyai:observations:v1','wickrun:cloud:archives:v1'];
  const backup=Object.fromEntries(keys.map(key=>[key,JSON.stringify({original:key})]));
  const values=new Map(Object.entries({...Object.fromEntries(keys.map(key=>[key,'changed'])), 'wickrun:cloud:pending-apply:v1':JSON.stringify(backup)}));
  const transport={kvGet:async key=>values.get(key)??null,kvSet:async(key,value)=>{values.set(key,value);}};
  const api=loader({[path.join(root,'transport.ts')]:{getTransport:()=>transport},[path.join(root,'observations.ts')]:{}})(path.join(root,'cloud-local.ts'));
  await api.recoverCloudApply();
  for(const key of keys)assert.equal(values.get(key),backup[key]);
  assert.equal(values.get('wickrun:cloud:pending-apply:v1'),'null');
});
test('project memory merges per item: two devices adding and deleting never conflict',()=>{
  const item=(id,text,t,extra={})=>({id,text,kind:'note',source:'user',createdAt:t,updatedAt:t,hash:id,...extra});
  const row=(items)=>({id:'p',name:'P',memoryItems:items,memory:items.filter(m=>!m.deletedAt).map(m=>m.text).join('\n\n')});
  const base={...emptyCloudData(),projects:[row([item('a','A',1),item('b','B',1)])]};
  const local={...base,projects:[row([item('a','A',1),item('b','B',1),item('c','local note',2)])]};
  const remote={...base,projects:[row([item('a','A',1),{...item('b','',3),deletedAt:3},item('d','remote note',3)])]};
  const merged=mergeCloudData(base,local,remote);
  const p=merged.projects[0];
  assert.deepEqual(p.memoryItems.filter(m=>!m.deletedAt).map(m=>m.id).sort(),['a','c','d']);
  assert.ok(p.memoryItems.find(m=>m.id==='b').deletedAt,'deletion is kept as a tombstone');
  assert.match(p.memory,/local note/);assert.match(p.memory,/remote note/);assert.doesNotMatch(p.memory,/\bB\b/);
  assert.deepEqual(mergeCloudData(base,remote,local).projects[0].memoryItems,p.memoryItems);
  // 其他字段仍按原规则：两边都改名照样要用户决定
  const renamed=(x,name)=>({...x,projects:[{...x.projects[0],name}]});
  assert.throws(()=>mergeCloudData(base,renamed(local,'L'),renamed(remote,'R')),CloudMergeConflict);
});
