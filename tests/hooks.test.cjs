'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const storePath=require.resolve('../electron/store.cjs');
const kv=new Map();
require.cache[storePath]={id:storePath,filename:storePath,loaded:true,exports:{
  kvGet:k=>kv.get(k)??null, async kvSet(k,v){kv.set(k,v);}, secretGet:()=>null}};
const {runHooks,matches}=require('../electron/hooks.cjs');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'hooks-'));
const setHooks=list=>kv.set('snc:settings:v1',JSON.stringify({hooks:list}));
const ctx={workspaceRoots:[root]};
const ok={ok:true,content:'written',filePath:path.join(root,'package.json')};
/*
 * 检查命令一律用 node -e 写。
 *
 * 钩子跑在各平台自己的 shell 里（Windows 是 cmd.exe，其余是 sh），而
 * `echo x; exit 1` 这种 POSIX 写法在 cmd 里根本不成立：`;` 不是分隔符，
 * 整句会被当成一个 echo 原样打出来，退出码 0 —— 于是「期望不通过」的用例
 * 在 Windows 上全部误判成通过。这个坑已经踩过一次，之后别再写 shell 方言。
 */
const node=js=>`node -e "${js}"`;
const pass={id:'h1',name:'版本号三处同步',enabled:true,command:node('process.exit(0)')};
const fail={id:'h2',name:'版本号三处同步',enabled:true,
  // 命令输出保持纯 ASCII：中文要穿过 cmd.exe 的命令行再回到 stdout，
  // 中间任何一步编码不对都会让断言失败，而那跟护栏本身没关系。
  command:node("console.error('VERSION_MISMATCH package.json vs version.ts');process.exit(1)")};

test('code review blocks hooks from making unreviewed writes',async()=>{
  const target=path.join(root,'unreviewed.txt');
  setHooks([{...pass,command:node("require('fs').writeFileSync('unreviewed.txt','bad')")}]);
  const note=await runHooks({name:'write_file',result:{...ok},ctx:{...ctx,reviewCodeChanges:true}});
  assert.match(note,/护栏未执行/);assert.equal(fs.existsSync(target),false);
});

test('automatic hook writes are included in audit history',async()=>{
  setHooks([{...pass,command:node("require('fs').writeFileSync('hook-output.ts','export const n = 1;')")}]);
  const result={...ok};await runHooks({name:'write_file',result,ctx});
  assert.ok(result.codeChanges.some(c=>c.path===path.join(root,'hook-output.ts')&&c.kind==='added'));
});

test('通过就不说话 —— 每次汇报「检查通过」等于没有护栏',async()=>{
  setHooks([pass]);
  assert.equal(await runHooks({name:'write_file',result:ok,ctx}),'');
});

test('没通过就把原文摆到模型面前',async()=>{
  setHooks([fail]);
  const note=await runHooks({name:'write_file',result:ok,ctx});
  assert.match(note,/护栏未通过/);
  assert.match(note,/VERSION_MISMATCH package\.json vs version\.ts/,'命令的真实输出要原样带给模型');
  assert.match(note,/不是用户的新指令/,'要说清这是程序跑的，别被当成新指令');
});

test('只在会改东西的工具之后触发',async()=>{
  setHooks([fail]);
  assert.equal(await runHooks({name:'read_file',result:ok,ctx}),'','查阅类没有可检查的后果');
  assert.notEqual(await runHooks({name:'run_command',result:ok,ctx}),'');
});

test('配置只从应用设置读，工作目录里放钩子文件不算数',async()=>{
  setHooks([]);
  fs.writeFileSync(path.join(root,'.wickrun-hooks.json'),JSON.stringify([fail]));
  assert.equal(await runHooks({name:'write_file',result:ok,ctx}),'','仓库自带的钩子绝不能被执行');
});

test('关掉的钩子不跑',async()=>{
  setHooks([{...fail,enabled:false}]);
  assert.equal(await runHooks({name:'write_file',result:ok,ctx}),'');
});

test('路径正则不匹配就不触发',async()=>{
  setHooks([{...fail,pathPattern:'\\.md$'}]);
  assert.equal(await runHooks({name:'write_file',result:ok,ctx}),'');
  setHooks([{...fail,pathPattern:'package\\.json$'}]);
  assert.notEqual(await runHooks({name:'write_file',result:ok,ctx}),'');
});

test('限定工作目录的钩子不会跑到别的目录去',()=>{
  const other=fs.mkdtempSync(path.join(os.tmpdir(),'other-'));
  assert.equal(matches({...fail,workspaceRoot:other},{name:'write_file',paths:[],root}),false);
  assert.equal(matches({...fail,workspaceRoot:root},{name:'write_file',paths:[],root}),true);
});

test('超时的钩子如实报告，不当作通过',async()=>{
  setHooks([{...pass,command:node('setTimeout(()=>{},5000)'),timeoutMs:1000}]);
  const note=await runHooks({name:'write_file',result:ok,ctx});
  assert.match(note,/护栏未通过/);
  assert.match(note,/超时/,'跑不起来的检查比没有检查更危险，必须说出来');
});

test('没有工作目录就不跑 —— 没有可执行的地方',async()=>{
  setHooks([fail]);
  assert.equal(await runHooks({name:'write_file',result:ok,ctx:{workspaceRoots:[]}}),'');
});

test('失败的工具调用不触发护栏',async()=>{
  setHooks([fail]);
  assert.equal(await runHooks({name:'write_file',result:{ok:false,content:''},ctx}),'',
    '没改成东西就没有后果可检查')
;});
