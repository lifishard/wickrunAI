const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');
const {loader}=require('./load-ts.cjs');const load=loader({'./transport':{desktop:()=>null}});
const domain=load(path.resolve(__dirname,'../src/lib/collaboration.ts'));
let n=0;const newId=p=>`${p}-${++n}`;

test('导入的模板换新编号、先停用，并且不覆盖现有配置',()=>{
  const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/templates/readinglog-pilot.json'),'utf8'));
  const {members,workflows}=domain.importTemplate(raw,newId);
  assert.equal(members.length,3);
  assert.equal(members.every(m=>m.enabled===false),true,'导入后必须先停用，让人确认接入和模型再跑');
  assert.equal(members.every(m=>!raw.members.some(x=>x.id===m.id)),true,'编号必须全换，不能覆盖已有成员');
  const flow=workflows[0];
  assert.equal(flow.versions.length,0,'版本是当时跑的那一份的证据，换了编号就不是它了');
  const ids=new Set(flow.draft.nodes.map(x=>x.id));
  assert.equal(flow.draft.edges.every(e=>ids.has(e.from)&&ids.has(e.to)),true,'连线必须跟着换编号');
  const byName=new Map(members.map(m=>[m.name,m.id]));
  const agents=flow.draft.nodes.filter(x=>x.type==='agent');
  assert.equal(agents.every(x=>[...byName.values()].includes(x.memberId)),true,'节点上的成员引用必须指向导入后的成员');
});

test('试点流程本身是可运行的：启用成员后校验不报错',()=>{
  const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/templates/readinglog-pilot.json'),'utf8'));
  const {members,workflows}=domain.importTemplate(raw,newId);
  const live=members.map(m=>({...m,enabled:true}));
  assert.deepEqual(domain.validateGraph(workflows[0].draft,live).filter(x=>x.severity==='error'),[]);
  // 只授权 omni 时，用本机 Claude Code 的席位必须被拦下来
  const restricted=domain.validateGraph(workflows[0].draft,live,[live[1].connectionId]);
  assert.ok(restricted.some(i=>/允许的模型接入|没有允许的模型接入/.test(i.message)));
});

test('不是模板的文件、缺名称的成员都要当场拒绝',()=>{
  assert.throws(()=>domain.importTemplate({format:'something-else',version:1,members:[],workflows:[]},newId),/配置模板/);
  assert.throws(()=>domain.importTemplate({format:'wickrunAI-project-template',version:1,members:[{id:'a',name:'  '}],workflows:[]},newId),/名称/);
});
