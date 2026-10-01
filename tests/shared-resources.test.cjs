const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const root=path.join(__dirname,'..','src','lib');
const calls=[];
const shared=loader({[path.join(root,'cloud-api.ts')]:{cloudAccountIdentity:async()=>null,cloudCall:async(action,input)=>{calls.push({action,...input});return {item:{id:'shared-'+calls.length},token:'a'.repeat(43)};}}})(path.join(root,'shared-resources.ts'));
const conversation=(id,extra={})=>({id,title:id,config:{},messages:[{id:'m'+id,role:'assistant',content:'answer',createdAt:1}],createdAt:1,...extra});
const project={id:'p',name:'Project',instructions:'Scope',docs:[{id:'d',name:'Brief',text:'public draft',updatedAt:1}],prompts:[{id:'q',label:'Review',text:'review this'}],memory:'private memory',memoryItems:[{text:'private'}],defaultKeyProfileId:'secret-profile',createdAt:1};

test('sharing a project includes explicit content and excludes private account memory and routes',()=>{
 const seed=shared.projectShareSeed(project);
 assert.deepEqual(Object.keys(seed.payload).sort(),['docs','instructions','prompts']);
 assert.deepEqual(seed.payload.docs,[{id:'d',name:'Brief',content:'public draft'}]);
 assert.equal(JSON.stringify(seed).includes('private memory'),false);
 assert.equal(JSON.stringify(seed).includes('secret-profile'),false);
});
test('Butler work, old job-linked conversations, forks and all their artifacts stay private',()=>{
 const artifact={id:'artifact',kind:'inline',name:'private.txt',text:'private result',type:'markdown'};
 const conversations=[conversation('normal',{projectId:'p'}),conversation('butler',{privacy:'personal-butler',messages:[{id:'bm',role:'assistant',content:'private goal',createdAt:1,artifacts:[artifact]}]}),
  conversation('fork',{forkedFrom:'butler'}),conversation('old'),conversation('old-fork',{forkedFrom:'old'}),conversation('native',{config:{client:{butlerAutonomous:true}}})];
 const seeds=shared.sharedSeeds(conversations,[project],null,['old']);
 assert.deepEqual(seeds.map(s=>s.sourceId),['p','normal']);
 assert.equal(JSON.stringify(seeds).includes('private goal'),false);
});
test('workflow projection shares ordinary graphs and results without tools, credentials or local paths',()=>{
 const workflow={id:'w',name:'Review',archived:false,draft:{nodes:[{id:'start',type:'start',title:'Input',x:0,y:0,instructions:'review',inputRefs:[],outputRequirement:'summary',maxVisits:1,join:'all',tools:['shell'],roots:['C:/private']}],edges:[],maxSteps:5,maxMinutes:10,maxTokens:100}};
 const team={id:'p',members:[{id:'a',name:'Reviewer',instructions:'review the brief',connectionId:'secret-key',tools:['shell']}],workflows:[workflow],schedules:[],tasks:[],runs:[{id:'run',taskId:'task',workflowId:'w',goal:'Review brief',acceptance:'clear',status:'completed',createdAt:1,updatedAt:2,events:[{id:'e',at:2,kind:'completed',text:'review finished'}],attempts:[{id:'attempt',output:'public result',steps:[{args:'C:/private'}]}],config:{apiKey:'secret'},memorySnapshot:[{text:'private'}]}]};
 const seed=shared.workflowShareSeed(team,workflow);
 assert.equal(seed.payload.runs[0].outputs[0].text,'public result');
 assert.equal(JSON.stringify(seed).includes('C:/private'),false);
 assert.equal(JSON.stringify(seed).includes('secret-key'),false);
 assert.equal(JSON.stringify(seed).includes('memorySnapshot'),false);
});
test('nested private Butler structures and capabilities are rejected before publishing',()=>{
 for(const value of [{butler:{goals:[]}},{nested:{actionGrants:[]}},{nodes:[{kind:'butler-work'}]},{root:{authorization:'token'}},{privacy:'personal-butler'}])
  assert.throws(()=>shared.assertPublicCollaboration(value),/不能进入共享/);
 assert.doesNotThrow(()=>shared.assertPublicCollaboration({text:'Discuss whether a butler is useful.'}));
});
test('annotations never enter the AI group conversation context',()=>{
 const item={payload:{messages:[{id:'m',role:'user',authorName:'Alice',content:'visible question'}],comments:[{body:'private note'}],annotations:[{text:'public note'}]}};
 const context=shared.sharedConversationContext(item,'new question');
 assert.match(context,/Alice: visible question/);
 assert.match(context,/new question/);
 assert.equal(context.includes('private note'),false);
 assert.equal(context.includes('public note'),false);
});
test('publishing a project creates inherited children only from curated seeds',async()=>{
 calls.length=0;
 const p=shared.projectShareSeed(project),chat=shared.conversationShareSeed(conversation('c',{projectId:'p'}));
 const file=shared.artifactShareSeed({id:'f',name:'result.md',text:'result',type:'markdown'},'c');
 await shared.publishSharedSeed(p,[p,chat,file,shared.conversationShareSeed(conversation('unrelated'))]);
 assert.equal(calls.length,3);
 assert.equal(calls[1].input.parentId,'shared-1');
 assert.equal(calls[2].input.parentId,'shared-2');
 assert.equal(calls.some(c=>c.input.sourceId==='unrelated'),false);
});
