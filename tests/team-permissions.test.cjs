const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const ts=loader()(path.resolve(__dirname,'../src/lib/team-permissions.ts')),native=require('../electron/team-permissions.cjs');
const {TOOL_BY_NAME}=loader()(path.resolve(__dirname,'../src/lib/tools/registry.ts'));

test('renderer and main process enforce the same tool lists',()=>{
 assert.deepEqual([...ts.TEAM_READ_ONLY_TOOLS],[...native.TEAM_READ_ONLY_TOOLS]);
 assert.deepEqual([...ts.TEAM_SCOPED_FILE_TOOLS],[...native.TEAM_SCOPED_FILE_TOOLS]);
 const run={accessGrants:[{memberId:'a',scope:'path',target:'/data',reason:'x',at:1},{memberId:'a',scope:'path',target:'/data',reason:'again',at:2},{memberId:'b',scope:'admin',reason:'y',at:3}]};
 assert.deepEqual(ts.teamGrants(run,'a'),native.teamGrants(run,'a'));
 assert.deepEqual(ts.teamGrants(run,'a'),{extraRoots:['/data'],screen:false,admin:false});
});

test('read-only tools never change anything; every other registry tool that exists is a real tool',()=>{
 for(const name of ts.TEAM_READ_ONLY_TOOLS){const def=TOOL_BY_NAME[name];if(def)assert.notEqual(def.dangerous,true,name);}
 for(const name of ['write_file','edit_file','run_command','delete_file','request_access','chrome_click','computer_click'])assert.ok(!ts.TEAM_READ_ONLY_TOOLS.includes(name),name);
});

test('the store accepts only well-formed grants for members of this run, and none for explorations',()=>{
 const run={members:[{id:'a'}]},ok={memberId:'a',scope:'path',target:path.resolve('docs'),reason:'read reference docs',at:1};
 native.validateGrant(ok,run);native.validateGrant({memberId:'a',scope:'screen',reason:'check the UI',at:2},run);
 for(const bad of [{...ok,memberId:'z'},{...ok,scope:'root'},{...ok,target:'relative/dir'},{...ok,reason:' '},{memberId:'a',scope:'admin',target:'/x',reason:'r',at:1},{...ok,at:NaN}])assert.throws(()=>native.validateGrant(bad,run),/授权记录无效/);
 assert.throws(()=>native.validateGrant(ok,{...run,intent:'explore'}),/想法梳理/);
});
