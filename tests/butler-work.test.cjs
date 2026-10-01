const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {loader}=require('./load-ts.cjs');const load=loader();
const {butlerWorkConfig,butlerWorkPrompt}=load(path.join(__dirname,'../src/lib/butler-work.ts'));
const {emptyButlerBrain,DEFAULT_BUTLER_PREFERENCES}=load(path.join(__dirname,'../src/lib/proactive-butler.ts'));
test('Butler Work inherits user tool permissions and config while using real group handoff and core context',()=>{
 const settings={defaultConfig:{model:'old',client:{kind:'codex'},enabledTools:['web_search'],approvalMode:'ask',maxToolRounds:31,runtime:{maxMinutes:17,maxTokens:90000}},routeGroups:[{id:'group',routes:[{profileId:'key',model:'first'},{profileId:'backup',model:'second'}]}]};
 const prefs={...DEFAULT_BUTLER_PREFERENCES,backend:{kind:'route-group',routeGroupId:'group',effort:'high'}};
 const {config,keyProfileId}=butlerWorkConfig(settings,prefs);
 assert.equal(keyProfileId,'key');assert.equal(config.client,undefined);assert.equal(config.model,'first');assert.equal(config.effortLevel,'high');
 assert.equal(config.runtime.maxMinutes,17);assert.equal(config.runtime.semanticCompression,true);assert.equal(config.runtime.harness,'guided');assert.equal(config.approvalMode,'ask');
 assert.ok(config.enabledTools.includes('write_document'));assert.ok(config.enabledTools.includes('run_command'));assert.equal(config.failover.groupId,'group');assert.equal(config.failover.routes[1].model,'second');assert.equal(settings.defaultConfig.model,'old');
});
test('Work starts only from reviewed goals and carries the user correction plus financial boundary',()=>{
 const brain=emptyButlerBrain('user');const goal={id:'goal',accountId:'user',title:'Build a report',hypothesis:'Maybe a report',userCorrection:'Make a spreadsheet with sources',status:'proposed',evidenceIds:[],updatedAt:1};
 assert.throws(()=>butlerWorkPrompt(brain,goal),/确认/);goal.status='corrected';
 const prompt=butlerWorkPrompt(brain,goal);assert.match(prompt,/Make a spreadsheet with sources/);assert.match(prompt,/禁止支付/);assert.match(prompt,/不要只交付分析或计划/);
});
