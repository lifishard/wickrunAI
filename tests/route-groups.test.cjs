'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);
const load=loader();
const groups=load(file('src/lib/route-groups.ts'));
const {nextRoute}=load(file('src/lib/failover.ts'));
const policy=load(file('src/lib/sync-policy.ts'));

const R=(profileId,model)=>({profileId,model});
const FREE={id:'rg-free',name:'免费',routes:[R('omni','glm-4.7'),R('omni','qwen-free')],createdAt:1};
const CODE={id:'rg-code',name:'写代码',routes:[R('paid','claude-5'),R('omni','glm-4.7')],createdAt:2};

test('selecting a group links the failover list and snapshots its current order',()=>{
  const config=groups.failoverFromGroup(FREE);
  assert.deepEqual(config,{enabled:true,groupId:'rg-free',routes:FREE.routes});
  assert.notEqual(config.routes[0],FREE.routes[0],'snapshot must not alias the group entries');
});

test('a linked list follows later edits to the group, in the user order',()=>{
  const config=groups.failoverFromGroup(FREE);
  const edited=[{...FREE,routes:[R('omni','qwen-free'),R('omni','glm-4.7'),R('omni','mimo')]}];
  assert.deepEqual(groups.effectiveRoutes(config,edited).map(r=>r.model),['qwen-free','glm-4.7','mimo']);
  const decision=nextRoute({current:R('omni','qwen-free'),order:groups.expandFailover(config,edited).routes,health:{},
    info:{kind:'rate_limit',title:'',detail:'',fixes:[],retryable:true,blameModel:false}});
  assert.equal(decision.route.model,'glm-4.7');
});

test('a deleted group falls back to the snapshot instead of an empty list',()=>{
  const config=groups.failoverFromGroup(CODE);
  assert.equal(groups.orphanedGroup(config,[FREE]),true);
  assert.deepEqual(groups.effectiveRoutes(config,[FREE]),CODE.routes);
  assert.equal(groups.orphanedGroup(config,[FREE,CODE]),false);
  assert.deepEqual(groups.effectiveRoutes({enabled:true,routes:[R('a','b')]},[FREE]),[R('a','b')]);
  assert.deepEqual(groups.effectiveRoutes(undefined,[FREE]),[]);
});

test('stored groups are sanitized without reordering what the user chose',()=>{
  const clean=groups.sanitizeRouteGroups([
    {id:'g1',name:'A',routes:[R('p','m2'),R('p','m1'),R('p','m2'),{profileId:'',model:'x'},{profileId:'p',model:'  '},null],createdAt:5,note:''},
    {id:'g1',name:'duplicate id',routes:[]},
    {name:'no id',routes:[]},
    'junk',
  ]);
  assert.equal(clean.length,1);
  assert.deepEqual(clean[0],{id:'g1',name:'A',routes:[R('p','m2'),R('p','m1')],createdAt:5});
  assert.deepEqual(groups.sanitizeRouteGroups(undefined),[]);
});

test('route groups sync across devices with the rest of the routing preferences',()=>{
  assert.ok(policy.SYNCABLE_SETTINGS.includes('routeGroups'));
  assert.ok(policy.SYNCABLE_SETTINGS.includes('failover'));
});
