'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const {randomUUID}=require('node:crypto');
const { discoverClient, KINDS, readClientState, rememberClientState } = require('./client-discovery.cjs');
const { createCodexClient, subscriptionEnvironment } = require('./codex-client.cjs');
const { claudeCode } = require('./tools/claudecode.cjs');
const { readClaudeConnection, describeConnection } = require('./claude-connection.cjs');
const { guardPath } = require('./tools/common.cjs');
const { normalizeImages } = require('./client-images.cjs');

const GROK_FALLBACK_MODELS = [
  { id: 'grok-4.6', label: 'Grok 4.6', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
  { id: 'grok-4.5', label: 'Grok 4.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
];
const KIMI_WORK_SCOPE_MESSAGE = 'Kimi Work 已禁用：ACP 未提供可验证的文件编辑范围；只允许在授权工作目录内的一次性文件编辑，执行、终端、网络和未知操作均被拒绝。';
const KIMI_WORK_PATH_MESSAGE = 'Kimi Work 已禁用：ACP 请求的文件路径不在授权工作目录内，或存在符号链接越界；无法安全批准此操作。';
const GROK_WORK_SCOPE_MESSAGE = '本次 Grok 操作未执行：客户端未提供完整的命令内容或可核实的文件编辑范围，或请求了尚未支持的工具类型。已有进度和被拒绝的请求已保留。';
const GROK_WORK_PATH_MESSAGE = '本次 Grok 文件编辑未执行：目标路径不在授权工作目录内，或符号链接指向目录外。请检查工作目录后继续。';

function acpKind(kind) { return kind === 'kimi' || kind === 'grok'; }
function workMessages(kind) {
  return kind === 'grok'
    ? { scope: GROK_WORK_SCOPE_MESSAGE, path: GROK_WORK_PATH_MESSAGE }
    : { scope: KIMI_WORK_SCOPE_MESSAGE, path: KIMI_WORK_PATH_MESSAGE };
}

function validateKimiWorkPermission(event, root, messages = workMessages('kimi')) {
  const toolCall = event?.toolCall;
  const kind = typeof toolCall?.kind === 'string' ? toolCall.kind.toLowerCase() : '';
  // ACP's standard `edit` kind is the only native mutation that can be
  // reviewed safely here.  The ACP client has no OS-level sandbox that we
  // can verify for terminal, command, network, delete, move, or unknown work.
  if (kind !== 'edit') return { ok: false, message: messages.scope };
  if (toolCall.locationsUnsafe || !Array.isArray(toolCall.locations) || toolCall.locations.length === 0) {
    return { ok: false, message: messages.scope };
  }
  const paths = [];
  try {
    for (const location of toolCall.locations) {
      const candidate = location?.path;
      // ACP ToolCallLocation.path is an absolute path.  Do not let the host
      // process's cwd resolve a relative or URI-like value for us.
      if (typeof candidate !== 'string' || !candidate || !path.isAbsolute(candidate)) return { ok: false, message: messages.scope };
      const guarded = guardPath(candidate, Array.isArray(root) ? root : [root]);
      if (fs.existsSync(guarded) && fs.statSync(guarded).isDirectory()) return { ok: false, message: messages.path };
      paths.push(guarded);
    }
  } catch {
    return { ok: false, message: messages.path };
  }
  return { ok: true, paths };
}

function validateWorkPermission(event, root, clientKind, scratchDir) {
  if (clientKind === 'grok' && event?.toolCall?.kind === 'fetch') {
    const call=event.toolCall;
    if (!call.fetchUnsafe && call.rawInput?.variant==='WebFetch' && typeof call.rawInput.url==='string') {
      try { const url=new URL(call.rawInput.url);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return {ok:true,approvalClass:'read'}; } catch { /* invalid URL */ }
    }
    return {ok:false,message:'Grok 网页读取请求缺少可核实的 HTTP(S) 地址，已拒绝该次读取；这不是运行超时。'};
  }
  if (clientKind === 'grok' && event?.toolCall?.kind === 'execute') {
    const call = event.toolCall, input = call.rawInput;
    // Only the Grok adapter's complete Bash input reaches this branch.
    // cwd is the starting directory, not an OS sandbox or a path guarantee.
    if (!call.commandUnsafe && input?.variant === 'Bash'
      && typeof input.command === 'string' && input.command.trim() && input.command.length <= 20000) {
      return { ok: true, requiresExplicitApproval: true };
    }
    return { ok: false, message: workMessages(clientKind).scope };
  }
  const roots = [root];
  if (clientKind === 'grok' && scratchDir) {
    try { if (fs.realpathSync(scratchDir) === scratchDir) roots.push(scratchDir); } catch { /* no longer available */ }
  }
  const result = validateKimiWorkPermission(event, roots, workMessages(clientKind));
  if(result.ok && clientKind==='grok')result.approvalClass='edit';
  if (!result.ok && clientKind === 'grok' && result.message === GROK_WORK_PATH_MESSAGE) {
    const target = event?.toolCall?.locations?.map(location => location.path).join('、');
    result.message = `Grok 文件编辑被拦截：${target || '未知路径'}。本次允许的项目目录：${root}。${scratchDir ? `临时脚本请写入：${scratchDir}。` : ''}已有成功操作已保留，请从未完成的步骤继续。`;
  }
  return result;
}

function createConversationClients({ userData, getSettings, store, openExternal, deps = {} }) {
  const scratch = path.join(userData, 'conversation-clients'); fs.mkdirSync(scratch, { recursive:true });
  const active = new Map(), logins = new Map(), approvals=new Map();
  const discover = kind => {
    const remembered=readClientState(userData).clients[kind]?.binary || '';
    const binary=(deps.discoverClient || discoverClient)(kind,getSettings(),deps.env || process.env,deps.platform || process.platform,remembered);
    rememberClientState(userData,kind,{binary});
    return binary;
  };
  const rememberedResult=(kind,binary,result)=>{rememberClientState(userData,kind,{binary,status:result.status});return result;};
  const codex = (binary,options={}) => (deps.createCodexClient || createCodexClient)({binary, cwd:scratch,...options});
  const acp = (binary, kind, cwd = scratch, options = {}) => (deps.createAcpClient || require('./acp-client.cjs').createAcpClient)({
    binary,
    cwd,
    args: kind === 'grok' ? ['agent', 'stdio'] : ['acp'],
    label: kind === 'grok' ? 'Grok ACP' : 'Kimi ACP',
    ...options,
  });
  const cleanModels = data => (data || []).slice(0,500).filter(m => typeof (m.model || m.id) === 'string').map(m => ({id:(m.model || m.id).slice(0,160),label:String(m.displayName || m.name || m.model || m.id).slice(0,160),efforts:(m.supportedReasoningEfforts || []).map(e=>e.reasoningEffort).filter(e=>typeof e==='string').slice(0,12),defaultEffort:m.defaultReasoningEffort}));
  async function check(kind) {
    if (!KINDS.includes(kind)) throw Error('未知连接器');
    let binary; try { binary = discover(kind); } catch(error) { return {kind,status:error.code === 'DESKTOP_ONLY' ? 'installed' : 'missing',models:[],message:error.message}; }
    let client;
    try {
      if (kind === 'codex') {
        client = codex(binary); const account = await client.readAccount();
        if (account.account?.type !== 'chatgpt') return rememberedResult(kind,binary,{kind,binary,status:'login_required',models:[],message:'连接官方 ChatGPT 账号后即可选择订阅提供的模型。'});
        let all=[], cursor; const seen = new Set();
        do { const page=await client.listModels({cursor}); all.push(...(page.data||[])); cursor=page.nextCursor; if(seen.has(cursor))break;seen.add(cursor); } while(cursor && all.length<500);
        return rememberedResult(kind,binary,{kind,binary,status:'ready',message:'已连接官方 ChatGPT 账号，模型列表来自本机 Codex。',models:cleanModels(all)});
      }
      if (kind === 'claude') {
        (deps.validateClaudeBinary || require('./claude-program.cjs').assertClaudeCodeBinary)(binary);
        const connection=(deps.readClaudeConnection || readClaudeConnection)();
        const connectionInfo=describeConnection(connection);
        const gateway=await deps.claudeGatewayCheck?.();
        if(gateway && gateway.state!=='ready') return rememberedResult(kind,binary,{kind,binary,status:'error',connection:connectionInfo,models:[],message:`Claude Code 配置的本机服务需要检查。${gateway.message}`});
        const loggedIn = await new Promise(resolve => {
          const child=(deps.spawn || spawn)(binary,['--setting-sources','','--settings','{"disableAllHooks":true}','auth','status'],{cwd:scratch,env:{...subscriptionEnvironment(),...connection.env},shell:false,windowsHide:true,stdio:['ignore','ignore','ignore']});
          const timer=setTimeout(()=>{child.kill();resolve(false);},15000);
          child.on('error',()=>{clearTimeout(timer);resolve(false);});child.on('close',code=>{clearTimeout(timer);resolve(code===0);});
        });
        const source=connectionInfo.type==='custom_api'?`自定义 API：${connection.baseUrl}`:connectionInfo.type==='api_key'?'API 凭据':'Claude 账号登录';
        return rememberedResult(kind,binary,{kind,binary,status:loggedIn?'ready':'login_required',connection:connectionInfo,message:loggedIn?`Claude Code CLI 已就绪。连接来源：${source}。${gateway?'已配置的本机网关已响应。':''}尚未发送模型请求；可用模型以你的服务配置为准。`:'Claude Code 授权未通过检查，请检查现有账号或 API 配置后重新检测。',models:loggedIn?[{id:'default',label:'Claude Code 配置的默认模型',efforts:[]},...['sonnet','opus','haiku'].map(id=>({id,label:`${id} · 配置别名${connection.env['ANTHROPIC_DEFAULT_'+id.toUpperCase()+'_MODEL']?' → '+connection.env['ANTHROPIC_DEFAULT_'+id.toUpperCase()+'_MODEL']:''}`,efforts:id==='haiku'?[]:['low','medium','high','xhigh','max']}))]:[]});
      }
      client=acp(binary, kind); const info=await client.inspect();
      return rememberedResult(kind,binary,{kind,binary,status:'ready',message:kind==='grok'?'已连接官方 Grok 账号，模型列表来自本机 Grok Desktop。':'已连接 Kimi ACP；执行范围受客户端能力与授权限制。',models:info.models?.length?info.models.map(m=>({id:m.id,label:m.name || m.id,efforts:(info.efforts || []).map(e=>e.id),defaultEffort:info.current?.effort || undefined})):(kind==='grok'?GROK_FALLBACK_MODELS:[{id:'default',label:'官方客户端默认模型',efforts:[]}]),capabilities:info.capabilities});
    } catch(error) {
      if(acpKind(kind) && error?.authRequired) return {kind,binary,status:'login_required',models:[],message:kind==='grok'?'Grok ACP 要求登录；请先完成官方 grok login，或点击登录 Grok，再重新检测。':'Kimi ACP 要求登录；请先在官方客户端运行 kimi login，再重新检测。'};
      return {kind,binary,status:'error',models:[],message:'客户端未完成连接，请检查官方客户端版本、登录或网络后重新检测。'};
    }
    finally { client?.close(); }
  }
  async function connect(kind) {
    if (kind === 'grok') {
      const status=await check(kind);
      if(status.status!=='login_required')return status;
      const binary=discover(kind);
      logins.get(kind)?.close();
      const {safeEnvironment}=require('./acp-client.cjs');
      let child;
      try {
        child=(deps.spawn || spawn)(binary,['login'],{cwd:scratch,env:safeEnvironment(deps.env || process.env),shell:false,windowsHide:true,stdio:['ignore','ignore','ignore']});
      } catch { throw Error('无法发起官方登录，请检查 Grok 客户端。'); }
      const closer={close(){ try { child.kill(); } catch { /* already exited */ } }};
      logins.set(kind,closer);
      child.on?.('error',()=>{ if(logins.get(kind)===closer){ closer.close(); logins.delete(kind); } });
      const timer=setTimeout(()=>{if(logins.get(kind)===closer){closer.close();logins.delete(kind);}},10*60*1000);timer.unref?.();
      const result={kind,status:'waiting_login',models:[],message:'已启动官方 grok login，完成登录后点击重新检测。'};
      rememberClientState(userData,kind,{binary,status:result.status});return result;
    }
    if (kind !== 'codex') return check(kind);
    const status=await check(kind);
    if(status.status!=='login_required')return status;
    logins.get(kind)?.close(); const client=codex(discover(kind)); logins.set(kind,client);
    try {
      const reply=await client.login();const url=new URL(reply.authUrl);
      if(url.protocol!=='https:' || !['auth.openai.com','auth.chatgpt.com','chatgpt.com'].includes(url.hostname) || url.username || url.password)throw Error('无效登录地址');
      await openExternal(url.href);
      const timer=setTimeout(()=>{if(logins.get(kind)===client){client.close();logins.delete(kind);}},10*60*1000);timer.unref?.();
      const result={kind,status:'waiting_login',models:[],message:'已打开官方登录页面，完成登录后点击重新检测。'};
      rememberClientState(userData,kind,{binary:discover(kind),status:result.status});return result;
    } catch {client.close();logins.delete(kind);throw Error('无法发起官方登录，请检查 Codex 客户端。');}
  }
  async function restore() {
    const saved=readClientState(userData).clients;
    const kinds=KINDS.filter(kind=>saved[kind]?.binary && ['ready','waiting_login','available','installed'].includes(saved[kind]?.status));
    const settled=await Promise.allSettled(kinds.map(check));
    return settled.map((result,index)=>result.status==='fulfilled'?result.value:{kind:kinds[index],status:'error',models:[],message:'重启后连接检查失败，请手动重新检测。'});
  }
  async function run(args={},notify=()=>{}) {
    require('./code-versions.cjs').runtimeVersions()?.assertReady();
    if(!/^[\w-]{1,160}$/.test(args.requestId || '') || !/^[\w-]{1,160}$/.test(args.runId || ''))throw Error('执行编号无效');
    const record=store.list().find(r=>r.id===args.runId), selection=record?.config?.client;
    if(!record || record.state.status!=='running' || !KINDS.includes(selection?.kind))throw Error('请先保存本轮会话和连接配置');
    if(typeof selection.model!=='string'||!/^[\w./:-]{1,160}$/.test(selection.model)||(selection.effort!==undefined && (typeof selection.effort!=='string'||!/^[\w-]{1,30}$/.test(selection.effort))))throw Error('模型或思考强度格式无效');
    if(typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>2000000)throw Error('上下文为空或过长');
    const jobId='native-'+args.requestId, prior=store.job(args.runId,jobId);
    if(prior){if(prior.result)return prior.result;throw Error('此调用已派发但结果未确认，请先核实，不会重复执行。');}
    const images=normalizeImages(args.images).map(image=>image.dataUrl);
    if(active.has(args.runId))throw Error('当前会话正在执行');
    const settings=getSettings(), work=record.config.toolsEnabled===true;
    if(work && settings.tools?.reviewCodeChanges === true)throw Error('审核后生效已开启：本机客户端无法保证逐项预审，请切换 API 连接使用文件工具，或由用户关闭审核模式。');
    let cwd=scratch;
    if(work && args.cwd){
      const requested=fs.realpathSync(args.cwd);
      const allowed=(settings.tools?.workspaceRoots||[]).some(root=>{try{guardPath(requested,[fs.realpathSync(root)],{mustExist:true});return true;}catch{return false;}});
      if(!allowed)throw Error('请先将工作目录加入应用的授权目录');
      if(!fs.statSync(requested).isDirectory())throw Error('工作目录无效');cwd=requested;
    }
    const codeAudit=require('./code-changes.cjs'), before=work ? codeAudit.snapshot([cwd]) : null;
    let scratchDir;
    if(work && selection.kind==='grok') {
      const scratchBase=path.join(scratch,'grok-work');fs.mkdirSync(scratchBase,{recursive:true});
      scratchDir=fs.realpathSync(fs.mkdtempSync(path.join(scratchBase,'run-')));
    }
    const binary=discover(selection.kind), controller=new AbortController(), job={controller,client:null};
    active.set(args.runId,job);
    let acpWorkCapabilityFailure=null;
    const onApproval=event=>{
      if(!work || controller.signal.aborted)return Promise.resolve('decline');
      let scopedPaths;
      if(acpKind(selection.kind)){
        const scope=validateWorkPermission(event,cwd,selection.kind,scratchDir);
        if(!scope.ok){
          acpWorkCapabilityFailure=scope.message;
          try { store.saveJob(args.runId,'rejected-'+randomUUID(),{at:Date.now(),requestId:args.requestId,event,status:'rejected',reason:scope.message}); }
          catch { controller.abort(); }
          return Promise.resolve('decline');
        }
        scopedPaths=scope.paths;
        if(scope.approvalClass)event={...event,approvalClass:scope.approvalClass};
        if(scope.requiresExplicitApproval)event={...event,requiresExplicitApproval:true,execution:{cwd,scope:'host'}};
      }
      return new Promise(resolve=>{
        const id=randomUUID();
        const finish=approved=>{if(!approvals.has(id))return;approvals.delete(id);clearTimeout(timer);controller.signal.removeEventListener('abort',stop);
          // Recheck after the user has reviewed the request: a directory may
          // have become a junction/symlink while the approval card was open.
          const scopeStillValid=!acpKind(selection.kind)||validateWorkPermission(event,cwd,selection.kind,scratchDir).ok;
          const permitted=approved===true&&scopeStillValid&&!controller.signal.aborted&&active.get(args.runId)===job;
          try{store.saveJob(args.runId,'approval-'+id,{at:Date.now(),requestId:args.requestId,event,...(scopedPaths?{scopedPaths}:{}),approved:permitted});resolve(permitted?'accept':'decline');}catch{controller.abort();resolve('decline');}};
        const stop=()=>finish(false),timer=selection.kind==='grok'?null:setTimeout(stop,180000);
        approvals.set(id,{requestId:args.requestId,finish});controller.signal.addEventListener('abort',stop,{once:true});
        try{store.saveJob(args.runId,'approval-'+id,{at:Date.now(),requestId:args.requestId,event,status:'waiting'});notify({type:'approval',requestId:args.requestId,id,event});}catch{finish(false);controller.abort();}
      });
    };
    try {
      store.saveJob(args.runId,jobId,{status:'dispatched',at:Date.now(),kind:selection.kind,cwd,...(scratchDir?{scratchDir}:{})});
      let result;
      if(selection.kind==='codex'){
        job.client=codex(binary,{turnTimeoutMs:Math.min(3600000,Math.max(10000,(record.config.runtime?.maxMinutes || 30)*60000))});
        let partial='',lastSave=0;
        const raw=await job.client.run({prompt:args.prompt,images,model:selection.model==='default'?undefined:selection.model,effort:selection.effort||undefined,cwd,sandbox:work?'workspaceWrite':'readOnly',signal:controller.signal,onApproval,isolateTools:true,
          onEvent:event=>{if(event.type==='thread/ready')store.saveJob(args.runId,jobId,{status:'running',threadId:event.threadId,at:Date.now(),kind:selection.kind,cwd});
            if(event.type==='item/agentMessage/delta' && typeof event.delta==='string'){partial=(partial+event.delta).slice(-2000000);if(Date.now()-lastSave>500){store.saveJob(args.runId,jobId,{status:'running',partial,at:Date.now(),kind:selection.kind,cwd});lastSave=Date.now();}notify({type:'delta',requestId:args.requestId,text:event.delta});}}});
        result={status:raw.status,text:raw.text,error:raw.error,sessionId:raw.threadId};
      }else if(selection.kind==='claude'){
        const extra=[selection.model==='default'?'':`--model ${selection.model}`,selection.effort?`--effort ${selection.effort}`:''].filter(Boolean).join(' ');
        const raw=await (deps.claudeCode || claudeCode)({prompt:args.prompt,images,cwd},{workspaceRoots:[cwd],claudeBin:binary,claudeExtraArgs:extra,claudeTimeoutMs:Math.min(3600000,(record.config.runtime?.maxMinutes || 10)*60000),signal:controller.signal,chatOnly:!work});
        result={status:raw.uncertain?'unknown':raw.ok?'completed':'failed',text:raw.content||'',error:raw.error,sessionId:raw.execution?.sessionId};
      }else{
        job.client=acp(binary, selection.kind, cwd, scratchDir ? {env:{...(deps.env || process.env),TEMP:scratchDir,TMP:scratchDir,TMPDIR:scratchDir}} : {});
        let partial='',reasoning='',lastSave=0;
        const activity=new Map();
        const onEvent=event=>{
          if(['reasoning','activity','plan','waiting'].includes(event?.type)){
            if(event.type==='reasoning')reasoning=(reasoning+(event.delta||'')).slice(-200000);
            if(event.type==='activity' && event.toolCall?.toolCallId){
              activity.set(event.toolCall.toolCallId,event.toolCall);
              if(activity.size>100)activity.delete(activity.keys().next().value);
            }
            if(event.type!=='waiting' && (event.type!=='reasoning'||Date.now()-lastSave>500)){
              store.saveJob(args.runId,jobId,{status:'running',partial,reasoning,activity:[...activity.values()],at:Date.now(),kind:selection.kind,cwd,...(scratchDir?{scratchDir}:{})});lastSave=Date.now();
            }
            notify({type:event.type,requestId:args.requestId,...(event.type==='reasoning'?{text:event.delta}:{event})});
            return;
          }
          if(event?.type!=='text' || typeof event.delta!=='string' || !event.delta)return;
          partial=(partial+event.delta).slice(-2000000);
          if(Date.now()-lastSave>500){
            store.saveJob(args.runId,jobId,{status:'running',partial,reasoning,activity:[...activity.values()],at:Date.now(),kind:selection.kind,cwd,...(scratchDir?{scratchDir}:{})});
            lastSave=Date.now();
          }
          notify({type:'delta',requestId:args.requestId,text:event.delta});
        };
        const scopePrompt=scratchDir ? `Host execution scope for this turn: project directory ${JSON.stringify(cwd)}; dedicated temporary directory ${JSON.stringify(scratchDir)}. Put temporary scripts, screenshots, logs and verification helpers in that dedicated temporary directory (also set as TEMP, TMP and TMPDIR), not in the user's general temporary folder or an old turn's temporary folder. File edits outside these two directories are rejected. These are file-tool boundaries, not an OS sandbox for commands. Preserve successful work and continue unfinished steps.\n\n` : '';
        result=await job.client.run({prompt:scopePrompt+args.prompt,images,model:selection.model==='default'?undefined:selection.model,effort:selection.effort && selection.effort!=='default'?selection.effort:undefined,mode:work?'work':'chat',signal:controller.signal,onEvent,onApproval});
        if(acpWorkCapabilityFailure){
          const terminalFailure=['unknown','failed','cancelled'].includes(result?.status);
          result={...result,status:terminalFailure?result.status:'permission_required',error:terminalFailure&&result.error?`${result.error}\n另有请求被拒绝：${acpWorkCapabilityFailure}`:acpWorkCapabilityFailure};
        }
      }
      if(before)Object.assign(result,codeAudit.compare(before,codeAudit.snapshot([cwd])));
      store.saveJob(args.runId,jobId,{status:result.status,result,at:Date.now(),kind:selection.kind,cwd,...(scratchDir?{scratchDir}:{})});return result;
    }catch(error){
      const saved=store.job(args.runId,jobId);
      const result={status:'unknown',text:saved?.partial||'',error:String(error.message||error),...(before?codeAudit.compare(before,codeAudit.snapshot([cwd])):{})};
      store.saveJob(args.runId,jobId,{status:result.status,result,at:Date.now(),kind:selection.kind,cwd});
      return result;
    }finally{controller.abort();job.client?.close();active.delete(args.runId);}
  }
  return {check,connect,restore,run,async repairClaude(){ try { const binary=discover('claude');(deps.validateClaudeBinary || require('./claude-program.cjs').assertClaudeCodeBinary)(binary); const recovery=await deps.repairClaudeGateway?.(); if(recovery && recovery.state!=='ready') return {kind:'claude',status:'error',models:[],message:recovery.message}; return await check('claude'); } catch { return {kind:'claude',status:'error',models:[],message:'Claude 恢复检查失败，请核对程序路径和用户路由配置。'}; } },recover(runId,callId){if(!/^native-[\w-]{1,160}$/.test(callId || '')||!store.list().some(r=>r.id===runId))throw Error('执行记录无效');const saved=store.job(runId,callId);return saved?.result || (saved?{status:'unknown',text:saved.partial || '',error:'先前操作未留下可靠的完成记录，请核实后再继续。'}:null);},approve(requestId,id,approved){const entry=approvals.get(id);if(!entry||entry.requestId!==requestId)throw Error('此操作已结束或授权已过期');entry.finish(approved===true);},abort:id=>active.get(id)?.controller.abort(),busy:()=>active.size>0,close(){for(const job of active.values())job.controller.abort();for(const client of logins.values())client.close();logins.clear();}};
}
module.exports={createConversationClients};
