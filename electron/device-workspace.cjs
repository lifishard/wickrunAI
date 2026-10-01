'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');

const profilePath=(base,id)=>path.join(base,'cloud-profiles',createHash('sha256').update(id).digest('hex'));
function readJSON(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
/** Defaults do not count as user work. Unknown or malformed records prevent automatic adoption. */
function hasLocalWork(directory,{safeStorage}={}){
  const store=readJSON(path.join(directory,'store.json'));
  if(store){
    if(!store.kv||!store.secrets||typeof store.kv!=='object'||typeof store.secrets!=='object')throw Error('本地存储结构无效，未切换工作区。');
    if(Object.keys(store.secrets).length)return true;
    for(const key of ['snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1']){
      const rows=JSON.parse(store.kv[key]??'[]');if(!Array.isArray(rows))throw Error('本地记录结构无效，未切换工作区。');
      if(rows.length)return true;
    }
    const settings=JSON.parse(store.kv['snc:settings:v1']??'{}');
    if(settings.keyProfiles?.length)return true;
    const brain=JSON.parse(store.kv['wickrun:butler:brain:v1']??'null');
    if(brain&&['signals','goals','briefs','jobs','skillProposals','feedback','audit','actionGrants'].some(key=>brain[key]?.length))return true;
  }
  const collaboration=readJSON(path.join(directory,'collaboration-v1.json'));
  if(collaboration&&Object.values(collaboration.projects??{}).some(p=>['members','workflows','tasks','runs','memories','schedules','files'].some(key=>p[key]?.length)))return true;
  const meetings=readJSON(path.join(directory,'meetings-v1.json'));
  if(meetings&&(!Array.isArray(meetings.rooms)||meetings.rooms.length))return true;
  // These are independent device records. An account profile containing only
  // one of them must not be mistaken for the empty 3.0.1 profile.
  for(const name of ['brain-sessions.json','brain-global.json','cloud-relay.json','chrome-connection.json']){
    if(readJSON(path.join(directory,name))!==null)return true;
  }
  const butler=readJSON(path.join(directory,'butler-local','collector.json'));
  if(butler&&(
    Object.values(butler.consent??{}).some(Boolean)||
    ['allowlist','denylist'].some(key=>Object.values(butler[key]??{}).some(value=>Array.isArray(value)&&value.length))||
    ['excludedTerms','encryptedOnlyTerms'].some(key=>butler.privacy?.[key]?.length)||
    Object.entries({contact:'redact',financial:'redact',health:'exclude'}).some(([key,value])=>butler.privacy?.categories?.[key]&&butler.privacy.categories[key]!==value)
  ))return true;
  const butlerEvents=readJSON(path.join(directory,'butler-local','events.json'));
  if(Array.isArray(butlerEvents)){if(butlerEvents.length)return true;}
  else if(butlerEvents!==null){
    if(butlerEvents?.encrypted===true&&butlerEvents.unavailable===true&&!('data' in butlerEvents)){
      // No ciphertext exists when the OS encryption backend was unavailable.
    }else if(butlerEvents?.version===1&&butlerEvents.encrypted===true&&typeof butlerEvents.data==='string'&&butlerEvents.data.length){
      // Initialization encrypts [] too. Decode rather than treating every
      // ciphertext as user work or, worse, silently ignoring saved history.
      if(!safeStorage?.isEncryptionAvailable?.()||safeStorage.getSelectedStorageBackend?.()==='basic_text'||typeof safeStorage.decryptString!=='function')
        throw Error('本机加密记录无法检查，未切换工作区。');
      if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(butlerEvents.data))
        throw Error('本机加密记录格式无效，未切换工作区。');
      let history;
      try{history=JSON.parse(safeStorage.decryptString(Buffer.from(butlerEvents.data,'base64')));}
      catch{throw Error('本机加密记录无法解密，未切换工作区。');}
      if(!Array.isArray(history))throw Error('本机加密记录结构无效，未切换工作区。');
      if(history.length)return true;
    }else throw Error('本机加密记录结构无效，未切换工作区。');
  }
  for(const name of ['runtime-v2','attachments','team-files','artifact-versions','artifact-binary-versions','code-versions-v1','native-ai','cloud-relay-runs','chrome-profile','conversation-clients','client-work','butler-local/browser-extension']){
    try{if(fs.readdirSync(path.join(directory,name)).length)return true;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return false;
}
function profileDirectories(base){try{return fs.readdirSync(path.join(base,'cloud-profiles'),{withFileTypes:true}).filter(e=>e.isDirectory()&&/^[a-f0-9]{64}$/.test(e.name)).map(e=>e.name);}catch(error){if(error.code==='ENOENT')return [];throw error;}}

/** Rebind only the unclaimed local Butler identity; another signed-in identity is never rewritten. */
function adoptLocalButler(base,accountId){
  const file=path.join(base,'store.json'),store=readJSON(file);if(!store?.kv)return false;
  const brain=JSON.parse(store.kv['wickrun:butler:brain:v1']??'null');
  if(!brain||brain.schema!==1||typeof brain.accountId!=='string'||!(brain.accountId==='guest'||/^local:/.test(brain.accountId)))return false;
  const previous=brain.accountId;
  const rewrite=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){if(key==='accountId'&&child===previous)value[key]=accountId;else rewrite(child);}
  };
  rewrite(brain);store.kv['wickrun:butler:brain:v1']=JSON.stringify(brain);
  for(const key of Object.keys(store.kv).filter(key=>/^wickrun:butler:.*checkpoint/i.test(key))){
    const saved=JSON.parse(store.kv[key]);if(saved?.accountId===previous){rewrite(saved);store.kv[key]=JSON.stringify(saved);}
  }
  const backup=file+'.before-account-workspace';
  if(!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
  const temporary=file+'.account-workspace.tmp';
  fs.writeFileSync(temporary,JSON.stringify(store),{mode:0o600});fs.renameSync(temporary,file);
  return true;
}

/** The first identity owns this device's existing workspace. Later identities stay separate. */
function chooseDeviceWorkspace(base,registry,active,{firstLogin=false,safeStorage}={}){
  if(registry.deviceWorkspaceOwner){
    return {directory:registry.deviceWorkspaceOwner===active?base:profilePath(base,active),changed:false};
  }
  const directory=profilePath(base,active),profiles=profileDirectories(base);
  const singleIdentity=Object.keys(registry.accounts).length===1&&Object.hasOwn(registry.accounts,active);
  const matchingProfile=createHash('sha256').update(active).digest('hex');
  const noOtherProfile=profiles.every(name=>name===matchingProfile);
  // Repair the old first-login blank view only while the new account has no
  // local user work. Both existing directories remain untouched.
  if(singleIdentity&&noOtherProfile&&(firstLogin||hasLocalWork(base,{safeStorage}))&&!hasLocalWork(directory,{safeStorage})){
    registry.deviceWorkspaceOwner=active;
    return {directory:base,changed:true};
  }
  return {directory,changed:false};
}
module.exports={chooseDeviceWorkspace,hasLocalWork,profilePath,adoptLocalButler};
