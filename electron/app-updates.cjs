"use strict";
const RELEASES='https://github.com/lifishard/wickrunAI/releases/latest';
function updateMode({packaged,platform,env}){
 if(!packaged)return 'development';
 if(platform==='win32'&&!env.PORTABLE_EXECUTABLE_DIR)return 'automatic';
 if(platform==='linux'&&env.APPIMAGE)return 'automatic';
 return 'manual'; // macOS builds are unsigned; portable / deb use the release download.
}
function createAppUpdates({updater,packaged,platform=process.platform,env=process.env,isBusy=()=>false,beforeInstall=()=>{},persist=async()=>{},notify=()=>{},openExternal,version}){
 const mode=updateMode({packaged,platform,env});let timer,initial,pending,downloadToken;
 let state={enabled:true,mode,status:'idle',currentVersion:version,version:null,percent:0,error:null,checkedAt:null};
 const set=patch=>{state={...state,...patch};};
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;
 updater.on('checking-for-update',()=>set({status:'checking',error:null}));
 updater.on('update-not-available',()=>set({status:'current',checkedAt:Date.now(),error:null}));
 updater.on('update-available',info=>set({status:'available',version:info.version,error:null,checkedAt:Date.now()}));
 updater.on('download-progress',p=>set({status:'downloading',percent:Math.min(100,Math.max(0,p.percent||0))}));
 updater.on('update-downloaded',info=>{set({status:'downloaded',version:info.version,percent:100,error:null});updater.autoInstallOnAppQuit=state.enabled&&mode==='automatic';notify('更新已下载，正常退出应用时安装。关闭窗口会继续在后台运行。');});
 updater.on('error',error=>set({status:'error',error:String(error.message||error).slice(0,500)}));
 async function check(){
  if(mode==='development')return {...state};if(pending)return pending;
  if(['downloading','downloaded'].includes(state.status))return {...state};
  pending=(async()=>{try{
   const result=await updater.checkForUpdates();
   if(state.status==='available'&&state.enabled&&mode==='automatic'){
    downloadToken=result?.cancellationToken;set({status:'downloading'});await updater.downloadUpdate(downloadToken);
   }
  }catch(e){set({status:'error',error:String(e.message||e).slice(0,500)});}finally{pending=null;downloadToken=null;}return {...state};})();return pending;
 }
 async function setEnabled(enabled){if(typeof enabled!=='boolean')throw Error('Invalid update preference.');await persist(enabled);set({enabled});updater.autoInstallOnAppQuit=enabled&&mode==='automatic'&&state.status==='downloaded';if(!enabled)downloadToken?.cancel();else if(state.status==='downloaded'&&mode==='automatic'){try{await updater.downloadUpdate();}catch(e){set({status:'error',error:String(e.message||e)});}}else void check();return {...state};}
 function start(enabled=true){state.enabled=enabled;if(mode==='development')return;initial=setTimeout(()=>{if(state.enabled)void check();},20000);initial.unref?.();timer=setInterval(()=>{if(state.enabled)void check();},4*60*60*1000);timer.unref?.();}
 async function install(){if(mode!=='automatic')throw Error('请从正式发布页下载此平台安装包。');if(state.status!=='downloaded')throw Error('更新尚未下载完成。');if(isBusy())throw Error('任务仍在运行，请完成或停止后再安装。');await beforeInstall();if(isBusy())throw Error('任务已开始，请稍后安装。');updater.quitAndInstall(true,true);}
 return {suspendInstall:()=>{updater.autoInstallOnAppQuit=false;},start,check,setEnabled,state:()=>({...state}),install,openRelease:()=>openExternal(RELEASES),close:()=>{clearTimeout(timer);clearTimeout(initial);},mode};
}
module.exports={createAppUpdates,updateMode};
