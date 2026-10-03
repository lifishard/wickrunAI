const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const {learnButlerHabits}=loader()(path.resolve(__dirname,'../src/lib/butler-habits.ts'));

const HOUR=3600000,DAY=24*HOUR,now=Date.UTC(2026,9,2,12);
function conversations(){
  const list=[];
  for(let d=1;d<=6;d++)for(let c=0;c<2;c++){
    const start=now-d*DAY-3*HOUR+c*HOUR; // 09:00 and 10:00 UTC
    list.push({id:`c${d}-${c}`,title:c?'周报整理':'学习 Rust',updatedAt:start,workspace:c?{id:'w',root:'/r',isolatedRoot:'/i'}:undefined,
      messages:[0,1,2].map(i=>({id:`m${d}${c}${i}`,role:'user',content:'secret text that must not leave',createdAt:start+i*60000}))});
  }
  list.push({id:'butler',title:'管家 · 私有',privacy:'personal-butler',updatedAt:now,messages:[{id:'b',role:'user',content:'x',createdAt:now-HOUR}]});
  return list;
}

test('habits summarise rhythm, topics and use without message text',()=>{
  const habits=learnButlerHabits(conversations(),now,'UTC');
  assert.deepEqual(habits.map(h=>h.id),['wickrun:habit-rhythm','wickrun:habit-topics','wickrun:habit-modes']);
  assert.match(habits[0].summary,/6 天/);assert.match(habits[0].summary,/上午/);assert.match(habits[0].summary,/9 点/);
  assert.match(habits[1].summary,/学习 Rust/);assert.match(habits[2].summary,/Work/);
  assert.ok(habits.every(h=>!h.summary.includes('secret')&&!h.summary.includes('管家')));
});

test('a forgotten habit is learned again only from later activity',()=>{
  const habits=learnButlerHabits(conversations(),now,'UTC',id=>id==='wickrun:habit-rhythm'?now-2*DAY:0);
  assert.ok(!habits.some(h=>h.id==='wickrun:habit-rhythm'),'too little activity after the forget');
  assert.ok(habits.some(h=>h.id==='wickrun:habit-topics'));
  assert.deepEqual(learnButlerHabits(conversations(),now,'UTC',()=>now),[]);
});

test('privacy rules keep sensitive titles out of topic habits',()=>{
  const list=conversations().map(c=>c.title==='学习 Rust'?{...c,title:'病历复查'}:c);
  const habits=learnButlerHabits(list,now,'UTC',()=>0,{excludedTerms:['病历'],encryptedOnlyTerms:[],categories:{contact:'redact',financial:'redact',health:'exclude'}});
  assert.ok(!habits.some(h=>h.summary.includes('病历')));
});
