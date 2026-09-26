const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const M=loader()(path.join(__dirname,'..','src','lib','memory-core.ts'));
const NOW=Date.UTC(2026,8,26);

test('legacy project memory text becomes items with deterministic ids, so two devices migrate to the same items',()=>{
  const legacy='[2026/9/1 10:00:00] 部署用 Railway，不用 Vercel\n\n[2026/9/2 11:00:00] 纠错（来自任务「导出」）：CSV 用 UTF-8 BOM\n\n…（中间部分已归档，未展示）\n\n部署用 Railway，不用 Vercel';
  const a=M.migrateLegacyMemory(legacy,NOW),b=M.migrateLegacyMemory(legacy,NOW+5);
  assert.equal(a.length,2,'重复的一段合并，归档提示不算记忆');
  assert.deepEqual(a.map(m=>m.id),b.map(m=>m.id));
  assert.equal(a[0].text,'部署用 Railway，不用 Vercel');assert.equal(a[0].source,'legacy');
  assert.equal(a[1].kind,'lesson');assert.equal(a[1].source,'correction');
  assert.deepEqual(M.memoryItemsOf({memory:legacy},NOW).map(m=>m.id),a.map(m=>m.id));
  assert.deepEqual(M.memoryItemsOf({memory:'ignored',memoryItems:[{id:'m_1',text:'x',kind:'weird',source:'user',createdAt:1,updatedAt:1}]}).map(m=>[m.id,m.kind]),[['m_1','note']]);
});

test('BM25 with Chinese bigrams finds relevant items; English plural folding',()=>{
  const idx=M.createSearchIndex([{id:'a',text:'部署用 Railway，不用 Vercel'},{id:'b',text:'CSV 导出用 UTF-8 BOM'},{id:'c',text:'用户偏好简洁的回答'},{id:'d',text:'Use tabs for indentation in all projects'}]);
  assert.equal(idx.search('怎么部署到云端')[0].id,'a');
  assert.equal(idx.search('导出表格 csv')[0].id,'b');
  assert.equal(idx.search('project indentation')[0].id,'d');
  assert.deepEqual(idx.search('完全无关的词语 xyzzy'),[]);
});

test('add, dedupe, redact, update, forget and never re-propose a forgotten sentence',()=>{
  let r=M.addMemory([], {text:'以后导出都用 UTF-8 BOM，API key: sk-proj-abcdefghijklmnopqrstuv',kind:'preference',source:'user'},NOW);
  assert.ok(r.redacted);assert.doesNotMatch(r.item.text,/sk-proj/);assert.match(r.item.text,/\[REDACTED\]/);
  let items=r.items;
  r=M.addMemory(items,{text:'以后导出都用 UTF-8 BOM， API key: sk-proj-abcdefghijklmnopqrstuv',source:'model'},NOW+1);
  assert.ok(r.duplicate);assert.equal(r.items.length,1);
  r=M.updateMemory(items,items[0].id,{pinned:true,text:'导出统一用 UTF-8 BOM'},NOW+2);items=r.items;
  assert.equal(items[0].pinned,true);assert.equal(items[0].text,'导出统一用 UTF-8 BOM');
  r=M.forgetMemory(items,items[0].id,NOW+3);items=r.items;
  assert.equal(items[0].text,'');assert.equal(items[0].deletedAt,NOW+3);assert.equal(M.activeItems(items,NOW+4).length,0);
  r=M.addMemory(items,{text:'导出统一用 UTF-8 BOM',source:'candidate',status:'candidate'},NOW+5);
  assert.ok(r.duplicate,'删掉过的一句不再作为候选出现');
  assert.equal(M.addMemory([], {text:'  ',source:'user'}).error,'记忆内容不能为空');
});

test('prompt selection keeps everything in stable order when it fits, ranks by relevance and pins when it does not',()=>{
  let items=[];
  for(let i=0;i<40;i++)items=M.addMemory(items,{text:`第${i}条普通记录，关于项目的杂项说明 ${'内容'.repeat(20)}`,source:'user'},NOW+i).items;
  items=M.addMemory(items,{text:'部署统一用 Railway，数据库用 PostgreSQL',kind:'decision',source:'user'},NOW+100).items;
  const pinnedId=items[3].id;items=M.updateMemory(items,pinnedId,{pinned:true},NOW+101).items;
  const small=M.selectMemoryForPrompt(items.slice(0,3),{query:'x',now:NOW+200});
  assert.equal(small.omitted,0);assert.deepEqual(small.selected.map(m=>m.id),items.slice(0,3).map(m=>m.id));
  const big=M.selectMemoryForPrompt(items,{query:'这次部署到哪个平台',budget:600,now:NOW+200});
  assert.ok(big.omitted>0);
  const ids=big.selected.map(m=>m.id);
  assert.ok(ids.includes(pinnedId),'置顶的一定在');
  assert.ok(big.selected.some(m=>/Railway/.test(m.text)),'相关的优先');
  assert.ok(big.prompt.length<=600);
  assert.deepEqual([...big.selected].sort((a,b)=>a.createdAt-b.createdAt).map(m=>m.id),ids,'输出按创建时间，前缀尽量稳定');
  const cand=M.addMemory(items,{text:'这条是候选，还没批准',source:'candidate',status:'candidate'},NOW+300).items;
  assert.ok(!M.selectMemoryForPrompt(cand,{now:NOW+400,budget:100000}).prompt.includes('候选'));
});

test('merging is order-independent, deletes win at equal time, three-way merge never conflicts',()=>{
  const base=[{id:'m1',text:'a',kind:'note',source:'user',createdAt:1,updatedAt:1,hash:'h1'}];
  const l=[{...base[0],text:'a (local)',updatedAt:5},{id:'m2',text:'only local',kind:'note',source:'user',createdAt:4,updatedAt:4,hash:'h2'}];
  const r=[{...base[0],text:'',deletedAt:5,updatedAt:5},{id:'m3',text:'only remote',kind:'note',source:'user',createdAt:4,updatedAt:4,hash:'h3'}];
  assert.deepEqual(M.mergeMemoryItems(l,r),M.mergeMemoryItems(r,l));
  const merged=M.mergeMemoryItems(l,r);
  assert.equal(merged.find(m=>m.id==='m1').deletedAt,5);assert.equal(merged.length,3);
  const three=M.mergeMemoryItems3(base,[{...base[0],text:'edited here',updatedAt:9}],[{...base[0]},{id:'m4',text:'added there',kind:'note',source:'user',createdAt:8,updatedAt:8,hash:'h4'}]);
  assert.deepEqual(three.map(m=>[m.id,m.text]),[['m1','edited here'],['m4','added there']]);
});

test('memory candidates come only from clear preference or decision sentences in user text, without secrets',()=>{
  const c=M.memoryCandidatesFrom(['帮我看看这个报错。以后回答都用中文，代码注释用英文。你觉得呢？','We decided to standardize on pnpm. Can you check it?','密码: hunter2hunter 以后别再问我要密码']);
  assert.deepEqual(c.map(x=>x.kind),['preference','decision','preference']);
  assert.match(c[0].text,/以后回答都用中文/);
  assert.ok(!c.some(x=>/hunter2/.test(x.text)));
  assert.deepEqual(M.memoryCandidatesFrom(['以后要不要换成 Postgres？','今天天气不错']),[]);
});

test('read_context 按关键词找历史：整串命中的先列，换说法的按相关度补上',()=>{
  const {readContext}=loader()(path.join(__dirname,'..','src','lib','context-memory.ts'));
  const msg=(id,content)=>({id,role:'user',content,createdAt:1});
  const state={working:[msg('a','把导出日期改成 ISO 格式'),msg('b','今天天气不错'),msg('c','日期导出的时候要带时区')]};
  const list=JSON.parse(JSON.parse(readContext(state,{query:'导出日期'}).content).text);
  assert.deepEqual(list.map(m=>m.id),['a','c'],'a 整串命中在前，c 靠相关度补上，b 不相关');
});

test('经验字段：每改一次版本加一，限定关键词的只在问题里出现那个词时进提示词',()=>{
  let {items}=M.addMemory([],{text:'导出 CSV 要带 BOM',kind:'lesson',source:'user',keywords:['CSV','导出'],evidence:'用 Excel 打开核对过'},NOW);
  const id=items[0].id;
  assert.deepEqual(items[0].keywords,['CSV','导出']);assert.equal(items[0].revision,undefined);
  items=M.updateMemory(items,id,{applicability:'Windows 上用 Excel 打开时'},NOW+1).items;
  assert.equal(items[0].revision,2);assert.equal(items[0].applicability,'Windows 上用 Excel 打开时');
  items=M.updateMemory(items,id,{evidence:'token: '+['sk','abcdefghijklmnopqrstuvwxyz123456'].join('-')},NOW+2).items;
  assert.equal(items[0].revision,3);assert.match(items[0].evidence,/REDACTED/);
  assert.equal(M.selectMemoryForPrompt(items,{query:'部署到 Railway',now:NOW+3}).selected.length,0);
  assert.equal(M.selectMemoryForPrompt(items,{query:'把报表导出成 csv',now:NOW+3}).selected.length,1);
  assert.match(M.selectMemoryForPrompt(items,{query:'csv',now:NOW+3}).prompt,/适用：Windows/);
  items=M.updateMemory(items,id,{keywords:[]},NOW+4).items;
  assert.equal(items[0].keywords,undefined,'清空关键词就是项目通用');
});

test('协作空间旧经验迁移：已失效的不带过来，候选仍要批准，镜像只含在用的和候选',()=>{
  const T=loader()(path.join(__dirname,'..','src','lib','team-memory.ts'));
  const e=(o)=>({title:'',text:'x',applicability:'',evidence:'',status:'adopted',revision:1,history:[],...o});
  const {items,added}=T.migrateTeamMemories([],[e({id:'a',title:'部署',text:'用 Railway'}),e({id:'b',text:'先写测试',status:'validated',kind:'preference'}),e({id:'c',text:'过时了',status:'invalid'}),e({id:'m_x',text:'已经是镜像'})],NOW);
  assert.equal(added,2);
  assert.deepEqual(items.map(m=>[m.id,m.text,m.status??'active']),[['m_team_a','部署：用 Railway','active'],['m_team_b','先写测试','candidate']]);
  assert.equal(T.migrateTeamMemories(items,[e({id:'a',title:'部署',text:'用 Railway'})],NOW).added,0,'重复迁移无害');
  const mirror=T.memoryItemsToTeamEntries(items,NOW);
  assert.deepEqual(mirror.map(m=>[m.id,m.status,m.kind,m.revision]),[['m_team_a','adopted','experience',1],['m_team_b','candidate','preference',1]]);
});

test('记忆候选评测集：调规则用的一组和没拿来调的一组都要守住召回和误报',()=>{
  const c=require('./fixtures/memory-candidates.json');
  const score=(pos,neg)=>({hit:pos.filter(([s])=>M.memoryCandidatesFrom([s]).length).length,fp:neg.filter(s=>M.memoryCandidatesFrom([s]).length).length});
  const tuned=score(c.positive,c.negative),held=score(c.holdout_positive,c.holdout_negative);
  // 2.20.1 实测：调参组 39/40、误报 0/40；留出组 20/20、误报 2/20（2.20.0 旧规则：31/40、11/40；17/20、6/20）
  assert.ok(tuned.hit>=38&&tuned.fp<=1,`调参组 召回 ${tuned.hit}/40 误报 ${tuned.fp}/40`);
  assert.ok(held.hit>=18&&held.fp<=3,`留出组 召回 ${held.hit}/20 误报 ${held.fp}/20`);
});
