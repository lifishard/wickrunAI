'use strict';

const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const os=require('node:os');
const {desktopSourceStatus,readForegroundText,cleanAllowlist}=require('./butler-desktop-source.cjs');

const MAX_AGE=24*60*60*1000,MAX_RECORDS=500,MAX_PENDING=100;
const SOURCES=['browser','desktop','android','integration','share'];
const SOURCE_LABEL={browser:'浏览器',desktop:'桌面应用',android:'Android 分享',integration:'已连接应用',share:'主动分享链接'};
const BLOCKED_PATH=/(?:^|\/)(?:login|log-in|sign-in|signin|auth|account|password|checkout|payment|banking|messages|inbox|direct|dm|chat|private)(?:\/|$)/i;
const BLOCKED_HOST=/(?:^|\.)(?:mail\.google\.com|outlook\.live\.com|outlook\.office\.com|web\.whatsapp\.com|messenger\.com|discord\.com|slack\.com|teams\.microsoft\.com)$/i;
const SECRET=/(?:password|passwd|pwd|api[_-]?key|secret|token|密码|口令|密钥|令牌)\s*[:=：]\s*\S+|\b(?:sk|pk|rk)-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i;
const TOPICS=[
  ['AI 工具与技能',/(?:\b(?:ai|llm|prompt|agent|model|automation)\b|人工智能|智能体|模型|提示词|自动化|技能)/i],
  ['投资与理财',/(?:\b(?:invest|stocks?|portfolio|etf|crypto|trading|finance)\b|投资|股票|基金|理财|加密货币|交易策略)/i],
  ['软件开发',/(?:\b(?:coding|programming|developer|software|typescript|python|github)\b|编程|代码|开发|软件工程)/i],
  ['设计与创作',/(?:\b(?:design|illustration|animation|creative|artwork)\b|设计|插画|动画|创作)/i],
  ['内容发布',/(?:\b(?:creator|newsletter|youtube|podcast|content|publishing)\b|自媒体|播客|内容创作|发布)/i],
  ['职业与学习',/(?:\b(?:career|resume|course|learning|education|job)\b|职业|求职|课程|学习|教育)/i],
  ['旅行与生活',/(?:\b(?:travel|hotel|flight|trip)\b|旅行|酒店|机票|旅游)/i],
];
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,24);
const safeWrite=(file,data)=>{const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(data),{encoding:'utf8',mode:0o600});fs.renameSync(tmp,file);};
const readJson=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
const sourceAllowed=(source,config,suspended,enabled)=>!suspended&&config.consent[source]===true&&enabled[source]===true;

function domainAllowlist(value){
  return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x).trim().toLowerCase()).filter(x=>
    x.length<=120&&/^(?=.{1,120}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(x)&&
    !x.endsWith('.local')&&!x.endsWith('.internal')&&!x.endsWith('.localhost')&&!BLOCKED_HOST.test(x)))].slice(0,50);
}
function publicUrl(raw,{allowQuery=false}={}){
  try {const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||(!allowQuery&&url.search)||url.hash||
    url.hostname==='localhost'||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal')||BLOCKED_HOST.test(url.hostname)||
    /^[\d.]+$/.test(url.hostname)||url.hostname.includes(':'))return null;return url;}
  catch{return null;}
}
function redactExcerpt(raw){
  return String(raw??'').replace(/https?:\/\/[^\s<>]+/gi,'[link]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]')
    .replace(/\b(?:\+?\d[\d ().-]{8,}\d)\b/g,'[phone]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g,'[number]')
    .replace(/\b(?:sk|pk|rk)-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,'[secret]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,'[secret]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,'[secret]')
    .replace(/(?:password|passwd|pwd|api[_-]?key|secret|token|密码|口令|密钥|令牌)\s*[:=：]\s*\S+/gi,'[secret]')
    .replace(/<[^>]{0,200}>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,2000);
}
function classify(record){
  const text=`${record.title||''} ${record.text||''} ${record.pathHint||''}`;
  return TOPICS.filter(([,pattern])=>pattern.test(text)).map(([topic])=>topic);
}
function signalsFor(records){
  return records.flatMap(record=>classify(record).map(topic=>{
    const view=record.source==='browser'?'浏览获准页面':record.source==='desktop'?'查看获准应用的前台静态文字':'主动分享链接';
    return {id:`${record.id}:${digest(topic)}`,source:record.source,sourceLabel:SOURCE_LABEL[record.source],sourceRef:record.id,
      topic,intent:record.source==='share'?'用户主动提交链接以供分析':'正在了解相关内容',
      summary:`${view}时出现“${topic}”主题。仅是接触线索，不证明收藏、转发、喜好或真实需求。`,
      observedAt:record.at,confidence:'low',basis:'behavior'};
  }));
}

function browserContentScript(){return `(() => {
  if (window.top !== window || location.protocol !== 'https:') return;
  let timer, lastSent = '';
  const blocked = () => /(?:^|\\/)(?:login|log-in|sign-in|signin|auth|account|password|checkout|payment|banking|messages|inbox|direct|dm|chat|private)(?:\\/|$)/i.test(location.pathname);
  const visible = rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  const capture = () => {
    if (document.visibilityState !== 'visible' || blocked()) return;
    const root = document.querySelector('article, main');
    if (!root) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = []; let length = 0;
    while (walk.nextNode() && length < 8000) {
      const node = walk.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('input,textarea,select,form,[contenteditable],script,style,[hidden],[aria-hidden="true"]')) continue;
      const css = getComputedStyle(parent);
      if (css.display === 'none' || css.visibility === 'hidden') continue;
      const range = document.createRange();range.selectNodeContents(node);
      if (![...range.getClientRects()].some(visible)) continue;
      const value = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      if (value) { parts.push(value); length += value.length; }
    }
    const text = parts.join(' ').slice(0, 8000), title = document.title.slice(0, 300);
    const signature = JSON.stringify([location.href, title, text]);
    if (text && signature !== lastSent) { lastSent = signature; chrome.runtime.sendMessage({kind:'butler-page',url:location.href,title,text}); }
  };
  const schedule = () => { clearTimeout(timer);timer = setTimeout(capture, 5000); };
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  document.addEventListener('visibilitychange',schedule);
  window.addEventListener('scroll',schedule,{passive:true});
  schedule();
})();`}
function browserBackgroundScript(port,token,allowlist){
  return `const allowed=new Set(${JSON.stringify(allowlist)});
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(message?.kind!=='butler-page'||sender.tab?.incognito)return;
  try {const url=new URL(sender.url||'');if(url.protocol!=='https:'||!allowed.has(url.hostname)||message.url!==url.href)return;
    fetch('http://127.0.0.1:${port}/ingest',{method:'POST',headers:{'content-type':'application/json','x-butler-token':${JSON.stringify(token)}},body:JSON.stringify(message)}).catch(()=>{});
  }catch{}
});`;
}
function manifest(port,allowlist){return {manifest_version:3,name:'wickrunAI Butler · Local Sources',version:'1.0.0',
  description:'On explicitly allowed sites, sends visible article text only to wickrunAI on this computer.',incognito:'not_allowed',
  permissions:[],host_permissions:[...allowlist.map(x=>`https://${x}/*`),`http://127.0.0.1:${port}/*`],
  background:{service_worker:'background.js'},content_scripts:allowlist.map(x=>({matches:[`https://${x}/*`],js:['content.js'],run_at:'document_idle',all_frames:false}))};}

function createButlerSources({userData,openPath,desktopCapturer,platform=process.platform,env=process.env,readDesktop=readForegroundText,
  desktopStatus=desktopSourceStatus,now=()=>Date.now()}={}){
  if(typeof userData!=='string'||!userData)throw Error('userData is required');
  const dir=path.join(userData,'butler-local');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const configFile=path.join(dir,'collector.json'),rawFile=path.join(dir,'events.json'),extensionDir=path.join(dir,'browser-extension');
  const initial=readJson(configFile,{});
  const config={consent:{browser:false,desktop:false,android:false,integration:false,share:false,...initial.consent},
    allowlist:{browser:domainAllowlist(initial.allowlist?.browser),desktop:cleanAllowlist(initial.allowlist?.desktop),
      integration:[],android:[],share:[]},port:Number.isInteger(initial.port)?initial.port:0,
    token:typeof initial.token==='string'&&initial.token.length>=32?initial.token:crypto.randomBytes(32).toString('hex')};
  let raw=readJson(rawFile,[]);if(!Array.isArray(raw))raw=[];
  const prune=()=>{raw=raw.filter(r=>r&&typeof r.at==='number'&&r.at>=now()-MAX_AGE).slice(-MAX_RECORDS);safeWrite(rawFile,raw);};
  prune();safeWrite(configFile,config);
  let suspended=true,mode='local-topics',enabled={},server=null,closed=false,lastError='';
  const desktopCapability=desktopStatus({platform,env});
  const persist=()=>safeWrite(configFile,config);
  const status=()=>{
    const installed=fs.existsSync(path.join(extensionDir,'manifest.json'));
    const sources={
      browser:{available:true,consented:config.consent.browser,allowlist:[...config.allowlist.browser],note:installed?'扩展已生成；更新范围后请在浏览器扩展页重新加载。':'需先设置域名并手动安装本地扩展。'},
      desktop:{available:desktopCapability.available,consented:config.consent.desktop,allowlist:[...config.allowlist.desktop],note:lastError?`${desktopCapability.note} 最近读取失败：${lastError}`:desktopCapability.note},
      android:{available:false,consented:false,note:'Android 主动分享入口尚未接入此设备。'},
      integration:{available:false,consented:false,note:'未提供已连接应用的采集器。'},
      share:{available:true,consented:config.consent.share,note:'仅解析用户提交的公开 HTTPS 链接；不读取网页正文或视频。'},
    };
    return {sources,deviceName:os.hostname()};
  };
  const accept=(event)=>{
    const id=`${event.source}:${digest(JSON.stringify([event.source,event.url||event.processName||'',event.title||'',event.text||'',event.pathHint||'']))}`;
    if(raw.some(r=>r.id===id))return false;
    raw.push({...event,id});prune();return true;
  };
  const validOrigin=origin=>/^chrome-extension:\/\/[a-p]{32}$/.test(origin||'');
  async function ensureServer(){
    if(server||closed)return;
    const handler=(req,res)=>{
      const origin=req.headers.origin;
      if(validOrigin(origin))res.setHeader('access-control-allow-origin',origin);
      res.setHeader('access-control-allow-methods','POST, OPTIONS');res.setHeader('access-control-allow-headers','content-type, x-butler-token');
      if(req.method==='OPTIONS'){res.statusCode=validOrigin(origin)?204:403;res.end();return;}
      if(closed||req.method!=='POST'||req.url!=='/ingest'||!validOrigin(origin)||req.headers['x-butler-token']!==config.token||
        !sourceAllowed('browser',config,suspended,enabled)){res.statusCode=403;res.end();return;}
      let body='';req.on('data',chunk=>{body+=chunk;if(body.length>12000)req.destroy();});
      req.on('end',()=>{try{
        if(body.length>12000)throw Error('too large');
        const data=JSON.parse(body),url=publicUrl(data.url,{allowQuery:true});
        if(!url||!config.allowlist.browser.includes(url.hostname)||BLOCKED_PATH.test(url.pathname)||
          [...url.searchParams.keys()].some(key=>/(?:token|key|password|secret|session|auth|code|state)/i.test(key))||
          typeof data.title!=='string'||typeof data.text!=='string'||!data.text.trim()||
          SECRET.test(data.text)||SECRET.test(data.title))throw Error('out of scope');
        url.search='';accept({source:'browser',at:now(),title:data.title.slice(0,300),text:data.text.slice(0,8000),url:url.toString()});
        res.statusCode=204;res.end();
      }catch{res.statusCode=400;res.end();}});
    };
    const ports=config.port?[config.port,0]:[0];
    for(const port of ports){
      const candidate=http.createServer(handler);
      try {await new Promise((resolve,reject)=>{candidate.once('error',reject);candidate.listen(port,'127.0.0.1',()=>{candidate.removeListener('error',reject);resolve();});});server=candidate;break;}
      catch(e){if(e.code!=='EADDRINUSE'||port===ports.at(-1))throw e;}
    }
    const actual=server.address().port;if(config.port!==actual){config.port=actual;config.token=crypto.randomBytes(32).toString('hex');persist();
      if(fs.existsSync(extensionDir))writeExtension();}
  }
  function writeExtension(){
    if(!config.allowlist.browser.length)throw Error('先填写允许的完整域名');
    fs.mkdirSync(extensionDir,{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(extensionDir,'manifest.json'),JSON.stringify(manifest(config.port,config.allowlist.browser),null,2));
    fs.writeFileSync(path.join(extensionDir,'background.js'),browserBackgroundScript(config.port,config.token,config.allowlist.browser));
    fs.writeFileSync(path.join(extensionDir,'content.js'),browserContentScript());
    return extensionDir;
  }
  async function poll(){
    if(sourceAllowed('desktop',config,suspended,enabled)){
      try{const result=await readDesktop({allowlist:config.allowlist.desktop,platform,env});lastError='';
        if(result?.text && config.allowlist.desktop.some(name=>name.toLowerCase()===String(result.processName).toLowerCase()) &&
          !SECRET.test(result.text) && !SECRET.test(result.title||''))accept({source:'desktop',at:now(),title:result.title,text:result.text.slice(0,8000),processName:result.processName});
      }catch(error){lastError=String(error instanceof Error?error.message:error).replace(/[\r\n]+/g,' ').slice(0,180);}
    }
    const batch=raw.filter(r=>!r.ackedAt&&sourceAllowed(r.source,config,suspended,enabled)).slice(0,MAX_PENDING);
    const signals=signalsFor(batch);
    const contexts=mode==='redacted-context'?batch.map(r=>({id:r.id,source:r.source,sourceLabel:SOURCE_LABEL[r.source],observedAt:r.at,
      text:redactExcerpt(`${r.title||''} ${r.text||''}`)})).filter(c=>c.text).slice(-20):[];
    return {...status(),signals,recordIds:batch.map(r=>r.id),...(contexts.length?{contexts}:{})};
  }
  async function action(name,input={}){
    if(closed)throw Error('collector closed');
    if(!['status','close'].includes(name))await ensureServer();
    switch(name){
      case 'status':await ensureServer();return status();
      case 'configure':case 'configure-source':{
        const source=input.source;if(!SOURCES.includes(source))throw Error('unknown source');
        if(source==='browser')config.allowlist.browser=domainAllowlist(input.allowlist);
        else if(source==='desktop')config.allowlist.desktop=cleanAllowlist(input.allowlist);
        else if(source==='integration')throw Error('integration collector unavailable');
        else if((input.allowlist||[]).length)throw Error('source does not accept an allowlist');
        if(source==='browser')raw=raw.filter(r=>r.source!=='browser'||(publicUrl(r.url,{allowQuery:true})&&config.allowlist.browser.includes(new URL(r.url).hostname)));
        if(source==='desktop')raw=raw.filter(r=>r.source!=='desktop'||config.allowlist.desktop.some(name=>name.toLowerCase()===String(r.processName).toLowerCase()));
        if(['browser','desktop'].includes(source)){if(!config.allowlist[source].length)config.consent[source]=false;prune();}
        persist();if(source==='browser'&&fs.existsSync(extensionDir)&&config.allowlist.browser.length)writeExtension();return status();
      }
      case 'consent':case 'set-device-consent':{
        const source=input.source;if(!SOURCES.includes(source)||['android','integration'].includes(source))throw Error('source unavailable');
        if(input.consented&&['browser','desktop'].includes(source)&&!config.allowlist[source].length)throw Error('explicit allowlist required');
        config.consent[source]=input.consented===true;
        if(!config.consent[source]){raw=raw.filter(r=>r.source!==source);prune();
          if(source==='browser'){config.token=crypto.randomBytes(32).toString('hex');if(fs.existsSync(extensionDir)&&config.allowlist.browser.length)writeExtension();}}
        persist();return status();
      }
      case 'suspend':{
        suspended=input.suspended!==false;
        mode=input.mode==='redacted-context'?'redacted-context':'local-topics';
        enabled=Object.fromEntries(SOURCES.map(source=>[source,input.sources?.[source]===true]));
        return status();
      }
      case 'poll':return poll();
      case 'ack':{
        const ids=new Set(Array.isArray(input.ids)?input.ids.filter(id=>typeof id==='string'&&id.length<=120).slice(0,MAX_PENDING):[]);
        if(ids.size){for(const record of raw)if(ids.has(record.id))record.ackedAt=now();prune();}
        return status();
      }
      case 'install-browser-extension':{
        const extensionPath=writeExtension();
        if(typeof openPath==='function'){const error=await openPath(extensionPath);if(error)throw Error(String(error));}
        return {...status(),extensionPath};
      }
      case 'import-link':{
        if(!sourceAllowed('share',config,suspended,enabled))throw Error('share source is off');
        const url=publicUrl(input.url);if(!url||BLOCKED_PATH.test(url.pathname))throw Error('only public HTTPS links without query or fragment are accepted');
        const text=`${url.hostname} ${url.pathname.replace(/[\/_-]+/g,' ')}`;
        accept({source:'share',at:now(),title:'',text:'',pathHint:text,url:url.toString()});
        return {...await poll(),note:'仅从公开链接路径提取主题；未读取页面正文、收藏、转发或视频。'};
      }
      default:throw Error(`unknown collector action: ${name}`);
    }
  }
  async function close(){closed=true;if(server)await new Promise(resolve=>server.close(resolve));server=null;}
  return {action,close};
}

module.exports={createButlerSources,domainAllowlist,publicUrl,redactExcerpt,signalsFor,browserContentScript,browserBackgroundScript,manifest};
