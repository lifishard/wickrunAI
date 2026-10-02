'use strict';

const windowHealth = require('./window-health.cjs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog, Notification, powerMonitor, safeStorage, Tray, nativeImage, protocol } = require('electron');
require('./app-identity.cjs').configureIdentity(app);
const cloudAccount = require('./cloud-account.cjs').createCloudAccount({ app, safeStorage, openExternal: url => shell.openExternal(url) });
const store = require('./store.cjs');
const { extractErrorMessage } = require('./sse.cjs');
const { runTool } = require('./tools/index.cjs');
const remote = require('./remote-server.cjs');
const syncFolder = require('./sync-folder.cjs');
const chromeLaunch = require('./chrome-launch.cjs');
const skillFolder = require('./skill-folder.cjs');
const attachments = require('./attachments.cjs');
const { runtimeStore } = require('./run-store.cjs');
const { runtimeVersions, reconcileRuns, reconcileRunSummaries } = require('./code-versions.cjs');
const { sendClientEvent } = require('./client-events.cjs');
const { verifyFiles } = require('./file-records.cjs');
const { createMediaTokens, fileResponse } = require('./media-files.cjs');

// Local videos, audio and large images are streamed to the window by byte
// range instead of being read into memory. The window never names a path: it
// receives an unguessable handle from snc:mediaUrl, issued only for files
// inside the authorised work folders.
protocol.registerSchemesAsPrivileged([{ scheme: 'wickrun-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const mediaRoots = () => {
  const fromSettings = JSON.parse(store.kvGet('snc:settings:v1') || '{}').tools?.workspaceRoots ?? [];
  const data = app.getPath('userData');
  return [...fromSettings, path.join(data, 'team-files'), path.join(data, 'conversation-clients'), path.join(data, 'generated-media')];
};
const mediaTokens = createMediaTokens({ roots: mediaRoots });
function serveMedia(request) {
  const url = new URL(request.url);
  const file = url.hostname === 'f' ? mediaTokens.resolve(url.pathname.split('/')[1]) : null;
  if (!file) return new Response('Not found', { status: 404 });
  const result = fileResponse(file, request.headers.get('range'));
  const body = result.body ? require('node:stream').Readable.toWeb(result.body) : null;
  return new Response(body, { status: result.status, headers: result.headers });
}

const DEV_URL = process.env.SNC_DEV_URL || '';
const isDev = Boolean(DEV_URL);

/** requestId -> { controller, timer } */
const inflight = new Map();

let mainWindow = null;
let appUpdates = null;
async function prepareRendererQuit(){
 if(!mainWindow||mainWindow.isDestroyed())return;
 const sender=mainWindow.webContents,id=require('node:crypto').randomUUID();
 await new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);ipcMain.removeListener('snc:quitPrepared',listener);};
  const listener=(e,response)=>{if(e.sender!==sender||e.senderFrame!==sender.mainFrame||response?.id!==id)return;cleanup();response.error?reject(Error(response.error)):resolve();};
  const timer=setTimeout(()=>{cleanup();reject(Error('保存界面记录超时，未安装更新。'));},30000);
  ipcMain.on('snc:quitPrepared',listener);sender.send('snc:prepareQuit',id);
 });
}

const backgroundWindow = require('./background-window.cjs').createBackgroundWindow({
  app, Tray, Menu, nativeImage, getWindow: () => mainWindow, createWindow,
  iconPath: path.join(__dirname, '..', 'dist', 'brand', 'icon.png'),
});
let dataBackup = null;
let restoringData = false;
let storageStartupError = null;
let localClients = null;
let conversationClients = null;
let brainProxy = null;
let nativeAiBridge = null;
let cloudRelay = null;
let taskNotifier = null;
let butlerSources = null;
const activeToolControllers = new Map();
const activeRunIds = new Set();
function dataAvailable(){if(storageStartupError)throw Error('本地记录需要恢复，已停止读写：'+storageStartupError);if(restoringData)throw Error('正在恢复数据，请等待重启');const error=dataBackup?.recoveryError;if(error)throw Error('数据恢复未完成，已停止读写：'+error);}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */

/*
 * 窗口大小和位置要记住。
 *
 * 不记的话每次启动都回到 1280×860 —— 用户把窗口拉成竖条挂在副屏上，
 * 更新一次就得重摆一次。它跟设置、授权一样属于「我调过的东西」，
 * 凭什么一次更新就没了。
 *
 * 存在同一个 store.json 里，所以应用改名时的迁移逻辑对它一样生效。
 */
const BOUNDS_KEY = 'snc:window-bounds:v1';

function savedBounds() {
  try {
    dataAvailable();
    const raw = store.kvGet(BOUNDS_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (typeof b?.width !== 'number' || typeof b?.height !== 'number') return null;
    // 屏幕拔掉之后，上次那个坐标可能落在虚空里。挑一块真的存在的屏幕验证一下
    const { screen } = require('electron');
    const area = screen.getDisplayMatching({
      x: b.x ?? 0,
      y: b.y ?? 0,
      width: b.width,
      height: b.height,
    }).workArea;
    const onScreen =
      typeof b.x === 'number' &&
      typeof b.y === 'number' &&
      b.x < area.x + area.width - 80 &&
      b.y < area.y + area.height - 80 &&
      b.x + b.width > area.x + 80 &&
      b.y + b.height > area.y + 80;
    return {
      width: Math.max(420, Math.min(b.width, area.width)),
      height: Math.max(520, Math.min(b.height, area.height)),
      ...(onScreen ? { x: b.x, y: b.y } : {}),
      maximized: Boolean(b.maximized),
    };
  } catch {
    return null;
  }
}

let boundsTimer = null;
let quitFlushed=false,quitFlushing=false;
function rememberBounds(win) {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    try {
      dataAvailable();
      if (!win || win.isDestroyed()) return;
      const maximized = win.isMaximized();
      // 最大化时存「还原后」的尺寸，否则取消最大化会得到一个全屏大小的小窗口
      const b = maximized ? win.getNormalBounds() : win.getBounds();
      void Promise.resolve(store.kvSet(BOUNDS_KEY, JSON.stringify({ ...b, maximized }))).catch(error=>console.error('Window bounds save:',error.message));
    } catch {
      /* 存不上就算了，不值得为它崩一个窗口 */
    }
  }, 400);
}

let windowLogger;
function windowLog() {
  windowLogger ||= windowHealth.createLog(path.join(app.getPath('userData'), 'logs'));
  return windowLogger;
}

function createWindow() {
  const saved = savedBounds();
  mainWindow = new BrowserWindow({
    title: '灯芯AI · wickrunAI',
    icon: path.join(__dirname, '..', 'dist', 'brand', 'icon.png'),
    width: saved?.width ?? 1280,
    height: saved?.height ?? 860,
    ...(saved && 'x' in saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 420,
    minHeight: 520,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171c' : '#f5f6f8',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Task execution currently lives in this renderer; hiding must not throttle it.
      backgroundThrottling: false,
    },
  });

  windowHealth.watchWindow(mainWindow, { log: windowLog() });

  mainWindow.once('ready-to-show', () => {
    if (saved?.maximized) mainWindow.maximize();
    mainWindow.show();
  });

  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) {
    mainWindow.on(ev, () => rememberBounds(mainWindow));
  }
  // 关窗那一下也存一次：防抖的 400ms 可能还没到就退出了
  mainWindow.on('close', (event) => {
    if(quitFlushed)return;
    if (boundsTimer) clearTimeout(boundsTimer);
    try {
      dataAvailable();
      const maximized = mainWindow.isMaximized();
      const b = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
      void Promise.resolve(store.kvSet(BOUNDS_KEY, JSON.stringify({ ...b, maximized }))).catch(error=>console.error('Window bounds save:',error.message));
    } catch {
      /* 同上 */
    }
    backgroundWindow.close(event, mainWindow);
  });
  mainWindow.on('query-session-end', () => {appUpdates?.suspendInstall();backgroundWindow.beginQuit();});

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev && url.startsWith(DEV_URL);
    if (!allowed) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          { label: '打开数据目录', click: () => shell.showItemInFolder(store.filePath()) },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
        ],
      },
    ]),
  );
}

/* ------------------------------------------------------------------ *
 * HTTP：只负责搬字节。
 * SSE 切分、tool_calls 累积、字段归一化全在渲染进程的 src/lib/sse.ts 里，
 * 三个平台共用一份实现，主进程不重复造。
 * ------------------------------------------------------------------ */

function emit(sender, requestId, type, data, status) {
  if (sender.isDestroyed()) return;
  // status 只在 type === 'error' 时有意义：渲染层要靠它把「限流」和
  // 「这条路由坏了」区分开，光看报错文案是分不出来的
  sender.send('snc:event', { requestId, type, data, status });
}

async function handleChat(evt, init) {
  dataAvailable();
  const sender = evt.sender;
  const { requestId, url, headers, body, stream, timeoutMs } = init;
  const controller = new AbortController();
  const exchange = { requestId, runId: init.runId, round: init.round, attempt: init.attempt,
    purpose: init.purpose || 'agent', at: Date.now(), url, stream, request: body,
    raw: '', truncated: false, responseHeaders: {}, status: undefined };
  const save = () => { try { runtimeStore().saveExchange(exchange); } catch (e) { console.error('请求诊断保存失败', e.message); } };
  const raw = (text) => {
    const room = 256000 - exchange.raw.length;
    exchange.raw += text.slice(0, Math.max(0, room));
    if (text.length > room) exchange.truncated = true;
  };
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort('timeout'), timeoutMs || 180000);
    inflight.set(requestId, { controller, timer });
  };
  touch(); save();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    exchange.status = res.status;
    // Only response metadata useful for diagnostics; never cookies or credentials.
    for (const [key, value] of res.headers) {
      if (/^(content-type|retry-after|x-request-id|request-id|x-ratelimit-[a-z-]+|anthropic-ratelimit-[a-z-]+)$/i.test(key)) exchange.responseHeaders[key] = value;
    }
    emit(sender, requestId, 'response', exchange.responseHeaders, res.status);
    touch();
    const isSse = (res.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
    if (!res.ok) {
      const text = await res.text(); raw(text);
      emit(sender, requestId, 'raw', text, res.status);
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* preserve original error */ }
      exchange.error = extractErrorMessage(parsed, `HTTP ${res.status}`);
      emit(sender, requestId, 'error', exchange.error, res.status);
      return;
    }
    if (!stream || !isSse || !res.body) {
      const text = await res.text(); raw(text);
      emit(sender, requestId, 'body', text);
      emit(sender, requestId, 'done'); return;
    }
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      const text = decoder.decode(value, { stream: true }); raw(text);
      emit(sender, requestId, 'chunk', text);
    }
    const tail = decoder.decode();
    if (tail) { raw(tail); emit(sender, requestId, 'chunk', tail); }
    emit(sender, requestId, 'done');
  } catch (err) {
    exchange.error = controller.signal.aborted
      ? controller.signal.reason === 'timeout' ? '响应等待超时（连续无数据）' : '请求已停止'
      : err?.message || String(err);
    emit(sender, requestId, 'error', exchange.error);
  } finally {
    clearTimeout(timer); inflight.delete(requestId);
    exchange.endedAt = Date.now(); save();
  }
}

async function handleGetJson(_evt, { url, headers, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs || 30000);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 保持原文 */
    }
    if (!res.ok) throw new Error(extractErrorMessage(parsed, `HTTP ${res.status}`));
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('snc:butlerSources',(event,{action,input}={})=>{
    if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw Error('Untrusted Butler source request');
    dataAvailable();
    butlerSources??=require('./butler-sources.cjs').createButlerSources({userData:app.getPath('userData'),safeStorage,openPath:target=>shell.openPath(target)});
    return butlerSources.action(action,input);
  });
  ipcMain.handle('snc:cloudState', () => cloudAccount.state());
  ipcMain.handle('snc:cloudLogin', () => cloudAccount.login());
  ipcMain.handle('snc:cloudPoll', () => cloudAccount.poll());
  ipcMain.handle('snc:cloudCall', (_e, { action, input }) => cloudAccount.call(action, input));
  ipcMain.handle('snc:cloudGuestData', () => cloudAccount.guestData());
  ipcMain.handle('snc:cloudSwitch', async (_e, logout) => {
    dataAvailable();
    if (inflight.size || activeToolControllers.size || cloudRelay?.busy()) throw new Error('Stop running tasks before switching accounts.');
    await store.flush();
    if (logout) await cloudAccount.logout(); else cloudAccount.activate();
    app.relaunch(); app.quit();
  });
  const { activateTaskNotification, createTaskNotifier } = require('./task-notifications.cjs');
  taskNotifier = createTaskNotifier({
    Notification,
    getWindow: () => mainWindow,
    activateWindow: payload => activateTaskNotification(mainWindow, payload),
  });
  ipcMain.handle('snc:notifyTask',(event,input)=>{
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
    return taskNotifier.notify(input);
  });
  dataBackup = require('./data-backup.cjs').createDataBackup(app.getPath('userData'));
  const importedBackups = new Map();
  ipcMain.handle('snc:backupStatus',()=>({...dataBackup.status(),storePath:path.join(app.getPath('userData'),'store.json')}));
  ipcMain.handle('snc:backupList',()=>dataBackup.list());
  ipcMain.handle('snc:backupCreate',async(_e,mode)=>{
    await store.flush();
    if(mode==='local')return dataBackup.create({mode});
    if(mode!=='export')throw Error('备份类型无效');
    const chosen=await dialog.showSaveDialog(mainWindow,{defaultPath:path.join(app.getPath('downloads'),'wickrunAI-backup.json'),filters:[{name:'wickrunAI 备份',extensions:['json']}]});
    if(chosen.canceled||!chosen.filePath)return null;
    const result=dataBackup.create({mode:'export'});require('node:fs').writeFileSync(chosen.filePath,result.bundle,{mode:0o600});const {bundle,...summary}=result;return {...summary,path:chosen.filePath};
  });
  ipcMain.handle('snc:backupPreview',async(_e,id)=>{
    if(id)return {input:{id},summary:dataBackup.preview({id})};
    const chosen=await dialog.showOpenDialog(mainWindow,{properties:['openFile'],filters:[{name:'wickrunAI 备份',extensions:['json']}]});
    if(chosen.canceled||!chosen.filePaths[0])return null;
    const fs=require('node:fs'),file=chosen.filePaths[0];if(fs.statSync(file).size>dataBackup.status().limits.bundleBytes)throw Error('备份文件超过大小限制');
    const bundle=fs.readFileSync(file,'utf8'),summary=dataBackup.preview({bundle}),token=require('node:crypto').randomUUID();importedBackups.clear();importedBackups.set(token,bundle);return {input:{token},summary};
  });
  ipcMain.handle('snc:backupRestore',async(_e,input)=>{
    if(inflight.size||activeToolControllers.size||localClients?.busy()||conversationClients?.busy()||nativeAiBridge?.busy()||cloudRelay?.busy())throw Error('还有模型或工具操作正在结束，请等待完成后恢复');
    const source=input?.id?{id:input.id}:input?.token&&importedBackups.has(input.token)?{bundle:importedBackups.get(input.token)}:null;if(!source)throw Error('请先预览要恢复的备份');
    restoringData=true;try{await store.flush();dataBackup.restore(source);app.relaunch();app.exit(0);}catch(error){restoringData=false;throw error;}
  });
  ipcMain.handle('snc:toolAbort',(_e,runId)=>{conversationClients?.abort(runId);localClients?.abort(runId);for(const rec of activeToolControllers.values())if(rec.runId===runId||rec.teamRunId===runId)rec.controller.abort();});
  const collaboration = require('./collaboration-store.cjs').createCollaborationStore(app.getPath('userData'));
  const meetingRooms = require('./meeting-room.cjs').createMeetingRooms({userData:app.getPath('userData'),onQuestion:question=>{
    mainWindow?.webContents.send('snc:meetingQuestion',question);
    const preferences=JSON.parse(store.kvGet('snc:settings:v1')||'{}').notifications;
    if(preferences?.enabled!==false)taskNotifier?.notify({id:question.messageId,conversationId:`meeting:${question.projectId}:${question.roomId}`,kind:'question',title:'会议需要你决定',body:question.text.slice(0,600),silent:preferences?.sound===false});
  }});
  const gatewayRecovery = require('./gateway-recovery.cjs').createGatewayRecovery({getSettings:()=>JSON.parse(store.kvGet('snc:settings:v1')||'{}'),secretGet:id=>store.secretGet(id),getClaudeConnection:()=>require('./claude-connection.cjs').readClaudeConnection()});
  const nativeBridge=()=>{dataAvailable();if(!nativeAiBridge)nativeAiBridge=require('./native-ai-bridge.cjs').createNativeAiBridge({userData:app.getPath('userData'),appData:app.getPath('appData'),getSettings:()=>JSON.parse(store.kvGet('snc:settings:v1')||'{}'),secretGet:id=>store.secretGet(id),openExternal:url=>shell.openExternal(url),memory:require('./tools/knowledge.cjs').nativeMemory,meetings:meetingRooms});return nativeAiBridge;};
  const meetingSender=e=>{dataAvailable();if(!mainWindow||e.sender!==mainWindow.webContents||e.senderFrame!==e.sender.mainFrame)throw Error('会议主持操作只能来自主窗口');};
  app.on('will-quit',()=>meetingRooms.close());
  ipcMain.handle('snc:meetingState',(e,projectId)=>{meetingSender(e);return meetingRooms.state(projectId);});
  ipcMain.handle('snc:meetingAction',(e,{action,input})=>{meetingSender(e);return meetingRooms.host(action,input);});
  ipcMain.handle('snc:meetingPrompt',(e,{roomId,provider})=>{meetingSender(e);return meetingRooms.prompt(roomId,provider);});
  ipcMain.handle('snc:meetingConnection',async(e,provider)=>{meetingSender(e);const config=await nativeBridge().config(provider);return {...config,args:[...config.args,'--meetings-only']};});
  const updaterSender=e=>{if(!mainWindow||e.sender!==mainWindow.webContents||e.senderFrame!==e.sender.mainFrame)throw Error('Update request must come from the main window.');if(!appUpdates)throw Error('更新器尚未就绪。');};
  ipcMain.handle('snc:updateState',e=>{updaterSender(e);return appUpdates.state();});
  ipcMain.handle('snc:updateCheck',e=>{updaterSender(e);return appUpdates.check();});
  ipcMain.handle('snc:updateSetEnabled',(e,value)=>{updaterSender(e);return appUpdates.setEnabled(value);});
  ipcMain.handle('snc:updateInstall',e=>{updaterSender(e);return appUpdates.install();});
  ipcMain.handle('snc:updateOpenRelease',e=>{updaterSender(e);return appUpdates.openRelease();});
  ipcMain.handle('snc:nativeAiState',async()=>{const bridge=nativeBridge();await bridge.start();return bridge.state();});
  ipcMain.handle('snc:nativeAiConfigure',(_e,options)=>nativeBridge().configureClaude({replace:options?.replace===true}));
  ipcMain.handle('snc:nativeAiExtension',async()=>{
    const result=await nativeBridge().buildExtension({version:app.getVersion(),iconFile:path.join(__dirname,'..','dist','brand','icon.png')});
    // 双击 .mcpb 由 Claude Desktop 接管，弹出它自己的安装界面；打不开时退回在文件夹中显示
    const failed=await shell.openPath(result.file);
    if(failed)shell.showItemInFolder(result.file);
    return {...result,opened:!failed};
  });
  ipcMain.handle('snc:nativeAiCreate',(_e,input)=>nativeBridge().create(input));
  ipcMain.handle('snc:nativeAiOpen',(_e,{provider,taskId})=>nativeBridge().open(provider,taskId));
  ipcMain.handle('snc:nativeAiCancel',(_e,id)=>nativeBridge().cancel(id));
  ipcMain.handle('snc:nativeAiRemove',(_e,id)=>nativeBridge().remove(id));
  // Existing MCP clients can reconnect before the user opens the connection panel.
  if(require('node:fs').existsSync(path.join(app.getPath('userData'),'native-ai')))try{void nativeBridge().start().catch(error=>console.error('Native AI bridge:',error.message));}catch(error){console.error('Native AI bridge:',error.message);}
  ipcMain.handle('snc:gatewayRepair',(_event,profileId)=>{dataAvailable();return gatewayRecovery.repair(profileId);});
  const teamFiles = require('./team-files.cjs').createTeamFiles(app.getPath('userData'));
  const conversationWorkspaces=require('./conversation-workspaces.cjs').createConversationWorkspaces({teamFiles,conversations:()=>JSON.parse(store.kvGet('snc:conversations:v1')||'[]'),settings:()=>JSON.parse(store.kvGet('snc:settings:v1')||'{}')});
  ipcMain.handle('snc:conversationWorkspaceCreate',(_e,{id,root})=>{dataAvailable();return conversationWorkspaces.create(id,root);});
  try{if(!dataBackup.recoveryError)localClients=require('./local-clients.cjs').createLocalClients({userData:app.getPath('userData'),collaboration,teamFiles,getSettings:()=>JSON.parse(store.kvGet('snc:settings:v1')||'{}'),openExternal:url=>shell.openExternal(url)});}catch(error){storageStartupError=String(error);}
  ipcMain.handle('snc:pickClientBinary',async()=>{const chosen=await dialog.showOpenDialog(mainWindow,{title:'选择官方原生客户端',properties:['openFile'],...(process.platform==='win32'?{filters:[{name:'原生程序',extensions:['exe']}]}:{})});return chosen.canceled?null:chosen.filePaths[0];});
  ipcMain.handle('snc:clientCheck',(_e,kind)=>{dataAvailable();if(!['codex','claude'].includes(kind))throw Error('未知客户端');return localClients.check(kind);});
  ipcMain.handle('snc:clientLogin',()=>{dataAvailable();return localClients.login();});
  // 大脑代理：Claude Code / Codex 通过它用 wickrunAI 里登记的任意路由；只监听 127.0.0.1
  brainProxy=require('./brain-proxy.cjs').createBrainProxy({userData:app.getPath('userData'),getSettings:()=>JSON.parse(store.kvGet('snc:settings:v1')||'{}'),secretGet:id=>store.secretGet(id)});
  const brainGlobal=require('./brain-config.cjs').createBrainGlobal({userData:app.getPath('userData')});
  conversationClients=require('./conversation-clients.cjs').createConversationClients({userData:app.getPath('userData'),getSettings:()=>JSON.parse(store.kvGet('snc:settings:v1')||'{}'),store:runtimeStore(),openExternal:url=>shell.openExternal(url),deps:{brainProxy,workspaceForRun:record=>conversationWorkspaces.resolve(record.conversationId)?.isolatedRoot,claudeGatewayCheck:()=>gatewayRecovery.checkClaude(),repairClaudeGateway:()=>gatewayRecovery.repairClaude()}});
  // 允许网页版使用本机 AI：独立执行记录目录，不混进本机会话；默认关闭
  const relayRunStore=require('./run-store.cjs').createRunStore(path.join(app.getPath('userData'),'cloud-relay-runs'));
  cloudRelay=require('./cloud-relay.cjs').createCloudRelay({userData:app.getPath('userData'),account:cloudAccount,clients:conversationClients,store:relayRunStore,
    runner:require('./conversation-clients.cjs').createConversationClients({userData:app.getPath('userData'),getSettings:()=>JSON.parse(store.kvGet('snc:settings:v1')||'{}'),store:relayRunStore,openExternal:url=>shell.openExternal(url),deps:{brainProxy}}),
    log:message=>console.error('Cloud relay:',message)});
  ipcMain.handle('snc:cloudRelayState',()=>cloudRelay.state());
  ipcMain.handle('snc:cloudRelaySet',(_e,enabled)=>{dataAvailable();return cloudRelay.setEnabled(enabled===true);});
  const brainPublic=scope=>{const g=brainProxy.getGlobal(scope);return g?{profileId:g.profileId,model:g.model,baseUrl:scope==='claude'?g.anthropicBaseUrl:g.openaiBaseUrl}:null;};
  ipcMain.handle('snc:brainGlobalStatus',async()=>{dataAvailable();await brainProxy.start();return {applied:brainGlobal.status(),claude:brainPublic('claude'),codex:brainPublic('codex'),port:brainProxy.port()};});
  ipcMain.handle('snc:brainGlobalApply',async(_e,{client,mode,brain,effort})=>{
    dataAvailable();
    if(!['claude','codex'].includes(client)||!['route','subscription','restore'].includes(mode))throw Error('参数无效');
    let session=null;
    if(mode==='route'){const b=require('./brain-config.cjs').cleanBrain(brain);if(b.source!=='route'||typeof brain.model!=='string')throw Error('请选择路由和模型');session=await brainProxy.setGlobal(client,{profileId:b.profileId,model:brain.model,extras:b.extras,outputField:b.outputField});}
    else await brainProxy.setGlobal(client,null);
    const result=client==='claude'?brainGlobal.applyClaude(mode,session,effort):brainGlobal.applyCodex(mode,session,effort);
    return {...result,applied:brainGlobal.status(),claude:brainPublic('claude'),codex:brainPublic('codex')};
  });
  ipcMain.handle('snc:claudeRepair',()=>{dataAvailable();return conversationClients.repairClaude();});
  ipcMain.handle('snc:conversationClientCheck',(_e,kind)=>{dataAvailable();return conversationClients.check(kind);});
  ipcMain.handle('snc:conversationClientConnect',(_e,kind)=>{dataAvailable();return conversationClients.connect(kind);});
  ipcMain.handle('snc:conversationClientRun',(event,args)=>{dataAvailable();return conversationClients.run(args,message=>sendClientEvent(event.sender,message));});
  ipcMain.handle('snc:conversationClientTitle',(_event,args)=>{dataAvailable();return conversationClients.title(args);});
  ipcMain.handle('snc:butlerNativeRun',(event,args)=>{
    if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw Error('Untrusted Butler request');
    dataAvailable();return conversationClients.background(args);
  });
  ipcMain.handle('snc:conversationClientApprove',(_e,{requestId,id,approved})=>conversationClients.approve(requestId,id,approved));
  ipcMain.handle('snc:conversationClientRecover',(_e,{runId,callId})=>{dataAvailable();return conversationClients.recover(runId,callId);});
  ipcMain.handle('snc:clientRun',(_e,args)=>{dataAvailable();return localClients.run(args);});
  ipcMain.handle('snc:clientApprove',(_e,{id,approved})=>localClients.approve(id,approved));
  ipcMain.handle('snc:teamFilesCreate', (_e,args) => { dataAvailable();return require('./team-execution-guard.cjs').createTeamExecutionGuard({collaboration,teamFiles}).createFileSession(args); });
  ipcMain.handle('snc:teamFilesDiff', (_e,id) => {dataAvailable();return teamFiles.diff(id);});
  const artifactGuard=()=>require('./team-execution-guard.cjs').createTeamExecutionGuard({collaboration,teamFiles});
  ipcMain.handle('snc:teamArtifactsPublish',(_e,{scope,sessionId})=>{dataAvailable();return artifactGuard().publishArtifact(scope,sessionId);});
  ipcMain.handle('snc:teamArtifactsReceive',(_e,{scope,sessionId,ids})=>{dataAvailable();return artifactGuard().receiveArtifacts(scope,sessionId,ids);});
  ipcMain.handle('snc:teamArtifactsValidate',(_e,{scope,ids})=>{dataAvailable();return artifactGuard().validateArtifacts(scope,ids);});
  ipcMain.handle('snc:teamFilesRecover', (_e,id) => {dataAvailable();return teamFiles.recover(id);});
  ipcMain.handle('snc:teamFilesPreview', (_e,{id,path}) => teamFiles.preview(id,path));
  ipcMain.handle('snc:teamFilesMerge', (_e,{id,files}) => {dataAvailable();return teamFiles.merge(id,files);});
  ipcMain.handle('snc:teamFilesList', () => teamFiles.list());
  ipcMain.handle('snc:collaborationRead', () => {dataAvailable();return collaboration.read();});
  ipcMain.handle('snc:collaborationUpdate', (_e, {revision,project}) => {dataAvailable();return collaboration.update(revision,project);});
  ipcMain.handle('snc:collaborationClaim', (_e, {projectId,runId}) => {dataAvailable();return collaboration.claim(projectId,runId);});
  ipcMain.handle('snc:runSave', (_e, record) => {dataAvailable();const result=runtimeStore().save(record);if(['running','waiting'].includes(record.state?.status))activeRunIds.add(record.id);else activeRunIds.delete(record.id);return result;});
  // The renderer gets run summaries only (no model context); a run's full record is fetched by id when its conversation is opened.
  ipcMain.handle('snc:runList', async () => {dataAvailable();return reconcileRunSummaries(runtimeStore(),runtimeVersions());});
  ipcMain.handle('snc:runGet', (_e, id) => {dataAvailable();if(typeof id!=='string'||!id)throw Error('执行记录编号无效');return runtimeStore().get(id);});
  ipcMain.handle('snc:codeVersion', async (_e,{action,ids,path:filePath}) => {
    dataAvailable();const versions=runtimeVersions();
    if(action==='details')return versions.details(ids);
    if(action==='file')return versions.file(ids,filePath);
    if(!['preview','keep','revert'].includes(action))throw Error('未知代码版本操作');
    if(inflight.size||activeToolControllers.size||localClients?.busy()||conversationClients?.busy()||nativeAiBridge?.busy()||cloudRelay?.busy())throw Error('任务仍在执行，请停止或等待结束后审阅版本');
    if(activeRunIds.size||Object.values(collaboration.read().projects).some(p=>p.runs.some(r=>['running','pausing','waiting_approval','waiting_user'].includes(r.status))))throw Error('还有未结束的任务，请先暂停任务再审阅版本');
    const roots=JSON.parse(store.kvGet('snc:settings:v1')||'{}').tools?.workspaceRoots??[];
    const result=action==='keep'?versions.keep(ids):action==='preview'?versions.preview(ids,roots):versions.revert(ids,roots);
    if(action==='revert')await reconcileRunSummaries(runtimeStore(),versions);
    return result;
  });
  ipcMain.handle('snc:runRemove', (_e, id) => {dataAvailable();activeRunIds.delete(id);return runtimeStore().remove(id);});
  ipcMain.handle('snc:exchanges', (_e, runId) => runtimeStore().exchanges(runId));
  ipcMain.handle('snc:saveAnalysisExport', async (_e,{name,bytes}) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 32*1024*1024 || bytes.length < 22 || !/^wickrunAI-[a-z-]+-\d{4}-\d{2}-\d{2}\.zip$/.test(name)) throw new Error('分析导出包无效');
    const chosen = await dialog.showSaveDialog(mainWindow,{defaultPath:path.join(app.getPath('downloads'),name),filters:[{name:'ZIP 分析包',extensions:['zip']}]});
    if(chosen.canceled || !chosen.filePath)return null;
    require('node:fs').writeFileSync(chosen.filePath,Buffer.from(bytes));
    return verifyFiles([chosen.filePath],[path.dirname(chosen.filePath)]).files[0] ?? null;
  });
  ipcMain.handle('snc:verifyFiles', (_e, { paths, roots }) => verifyFiles(paths, roots));
  ipcMain.handle('snc:saveArtifact', async (_e, { name, text, sourcePath }) => {
    const chosen = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('downloads'), path.basename(name || 'output.txt')) });
    if (chosen.canceled || !chosen.filePath) return null;
    const fs = require('node:fs');
    // A finished video can be gigabytes; copy it off the main thread.
    if (sourcePath) await fs.promises.copyFile(sourcePath, chosen.filePath);
    else await fs.promises.writeFile(chosen.filePath, String(text ?? ''), 'utf8');
    return verifyFiles([chosen.filePath], [path.dirname(chosen.filePath)]).files[0];
  });
  ipcMain.handle('snc:chat', handleChat);
  ipcMain.handle('snc:getJson', handleGetJson);

  ipcMain.handle('snc:abort', (_e, requestId) => {
    const rec = inflight.get(requestId);
    if (rec) {
      clearTimeout(rec.timer);
      rec.controller.abort('user');
      inflight.delete(requestId);
    }
  });

  ipcMain.handle('snc:tool', async (_e, { name, args, ctx }) => {
    dataAvailable();
    if(ctx?.conversationId)ctx=conversationWorkspaces.tool(ctx);
    if(ctx?.teamExecution){
      ctx=require('./team-execution-guard.cjs').createTeamExecutionGuard({collaboration,teamFiles}).tool(name==='preview_code_change'?args?.name:name,ctx);
    }
    const id=require('node:crypto').randomUUID(),controller=new AbortController();
    activeToolControllers.set(id,{controller,runId:ctx?.execution?.runId,teamRunId:ctx?.teamExecution?.runId});
    try{return await runTool(name,args,{...ctx,signal:controller.signal});}finally{activeToolControllers.delete(id);}
  });

  ipcMain.handle('snc:kvGet', (_e, key) => {dataAvailable();return store.kvGet(key);});
  ipcMain.handle('snc:kvSet', (_e, { key, value }) => {dataAvailable();return store.kvSet(key, value);});
  ipcMain.handle('snc:secretGet', (_e, id) => {dataAvailable();return store.secretGet(id);});
  ipcMain.handle('snc:secretSet', (_e, { id, value }) => {dataAvailable();return store.secretSet(id, value);});
  ipcMain.handle('snc:secretDelete', (_e, id) => {dataAvailable();return store.secretDelete(id);});

  ipcMain.handle('snc:info', () => ({
    encryptionAvailable: store.encryptionAvailable(),
    storePath: store.filePath(),
    version: app.getVersion(),
    platform: process.platform,
  }));

  // 选目录：工作目录必须用户亲手点，不接受模型或渲染进程指定
  ipcMain.handle('snc:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择允许工具访问的工作目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // 选文件带进对话
  ipcMain.handle('snc:pickFiles', async (_e, mode) => {
    const filters =
      mode === 'image'
        ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
        : [
            { name: '文档、表格、演示文稿、文本与代码', extensions: ['pdf', 'docx', 'xlsx', 'xlsm', 'xls', 'pptx', 'potx', 'txt', 'md', 'json', 'csv', 'yaml', 'yml', 'ts', 'tsx', 'js', 'py', 'go', 'rs', 'java', 'sql', 'html', 'css', 'log'] },
            { name: '所有文件', extensions: ['*'] },
          ];
    const r = await dialog.showOpenDialog(mainWindow, {
      title: mode === 'image' ? '选择图片' : '选择文件',
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    if (r.canceled || !r.filePaths.length) return [];
    return attachments.readFiles(r.filePaths);
  });

  // 产物：在文件夹里定位 / 用默认程序打开 / 读回来预览
  ipcMain.handle('snc:revealPath', (_e, p) => {
    if (!require('node:fs').existsSync(p)) throw new Error('文件不存在或已被移动：' + p);
    shell.showItemInFolder(p);
  });
  ipcMain.handle('snc:openPath', async (_e, p) => {
    const err = await shell.openPath(p);
    return err || null; // 空字符串表示成功
  });
  ipcMain.handle('snc:readArtifact', (_e, { path: p, maxBytes }) => {
    const fsx = require('node:fs');
    try {
      const st = fsx.statSync(p);
      const cap = Number(maxBytes) || 2 * 1024 * 1024;
      if (st.size > cap) {
        return { ok: false, error: `文件 ${(st.size / 1048576).toFixed(1)}MB，超过预览上限。` };
      }
      return { ok: true, text: fsx.readFileSync(p, 'utf8'), size: st.size };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  const artifacts = require('./artifact-workspace.cjs');
  const artifactWorkspace = artifacts.createArtifactWorkspace(path.join(app.getPath('userData'), 'artifact-versions'));
  const binaryWorkspace = require('./artifact-binary.cjs').createBinaryWorkspace(path.join(app.getPath('userData'), 'artifact-binary-versions'));
  const artifactSender = e => {
    if (!mainWindow || e.sender !== mainWindow.webContents || e.senderFrame !== mainWindow.webContents.mainFrame) throw Error('请在应用的文件预览中操作。');
    dataAvailable();
  };
  ipcMain.handle('snc:artifactDocument', (e, p) => { artifactSender(e); return artifacts.readDocument(p); });
  const generatedMedia = require('./generated-media.cjs').createGeneratedMedia({ dir: path.join(app.getPath('userData'), 'generated-media') });
  ipcMain.handle('snc:saveGeneratedMedia', async (e, parts) => {
    artifactSender(e);
    if (!Array.isArray(parts) || parts.length > 20) throw Error('生成的媒体数量无效');
    const clean = parts.map(p => ({ kind: ['image', 'audio', 'video'].includes(p?.kind) ? p.kind : 'image',
      mime: typeof p?.mime === 'string' ? p.mime.slice(0, 100) : undefined, name: typeof p?.name === 'string' ? p.name.slice(0, 80) : undefined,
      base64: typeof p?.base64 === 'string' ? p.base64 : undefined, url: typeof p?.url === 'string' ? p.url.slice(0, 4000) : undefined }));
    return generatedMedia.save(clean);
  });
  // Cloud file library: only the main process talks to the server, and only for files inside the authorised folders.
  const mediaUploader = require('./media-upload.cjs').createMediaUploader({ call: (operation, input) => cloudAccount.media(operation, input) });
  const mediaUploads = new Map();
  ipcMain.handle('snc:cloudMedia', async (e, { action, input } = {}) => {
    artifactSender(e);
    if (action === 'upload') {
      const { inspectFile } = require('./file-records.cjs');
      const file = inspectFile(input?.path, mediaRoots());
      const requestId = typeof input?.requestId === 'string' ? input.requestId.slice(0, 80) : null;
      if (requestId && mediaUploads.has(requestId)) throw Error('这个文件正在上传。');
      const controller = new AbortController();
      if (requestId) mediaUploads.set(requestId, controller);
      try {
        return await mediaUploader.upload({ filePath: file.path, name: file.name, source: 'desktop', signal: controller.signal,
          onProgress: progress => { if (requestId && !e.sender.isDestroyed()) e.sender.send('snc:event', { requestId, type: 'media-progress', data: progress }); } });
      } finally { if (requestId) mediaUploads.delete(requestId); }
    }
    if (action === 'cancel') { mediaUploads.get(input?.requestId)?.abort(); return { ok: true }; }
    if (!['status', 'list', 'downloadUrl', 'remove', 'get'].includes(action)) throw Error('不支持的云文件操作');
    return cloudAccount.media(action, input ?? {});
  });
  ipcMain.handle('snc:mediaUrl', (e, p) => {
    artifactSender(e);
    const issued = mediaTokens.issue(p);
    return { url: `wickrun-media://f/${issued.token}/${encodeURIComponent(issued.name)}`, name: issued.name, size: issued.size, kind: issued.kind, mime: issued.mime };
  });
  ipcMain.handle('snc:readSharedFile', (e, p) => { artifactSender(e); return require('./shared-file-read.cjs').readSharedFile(p); });
  ipcMain.handle('snc:artifactWordPreview', (e, p) => { artifactSender(e); return require('./office-preview.cjs').previewWord(p); });
  ipcMain.handle('snc:artifactBinary', (e, { action, input }) => {
    artifactSender(e);
    if (action === 'read') return binaryWorkspace.read(input.path);
    if (inflight.size || activeToolControllers.size || activeRunIds.size) throw Error('请等待正在运行的任务结束后保存文档。');
    if (action === 'save') return binaryWorkspace.save(input);
    if (action === 'restore') return binaryWorkspace.restore(input);
    throw Error('不支持的文档操作。');
  });
  ipcMain.handle('snc:artifactEdit', (e, { action, input }) => {
    artifactSender(e);
    if (action === 'read') return artifactWorkspace.read(input.path);
    if (inflight.size || activeToolControllers.size || activeRunIds.size) throw Error('请等待正在运行的任务结束后保存文件。');
    if (action === 'save') return artifactWorkspace.save(input);
    if (action === 'restore') return artifactWorkspace.restore(input);
    throw Error('不支持的文件操作。');
  });

  // 技能文件夹同步。刻意只走 IPC，不进 registry ——
  // 那个目录在工作目录白名单之外，做成模型工具等于给它一条绕过白名单的路。
  ipcMain.handle('snc:skillsRead', (_e, dir) => skillFolder.read(dir));
  ipcMain.handle('snc:skillsWrite', (_e, { dir, items }) => skillFolder.write(dir, items));
  ipcMain.handle('snc:skillsDefaultDir', () => skillFolder.defaultDir());

  // Chrome：起一个带调试端口的实例
  ipcMain.handle('snc:chromeLaunch', (_e, { port, path: p }) => chromeLaunch.launch(port, p));
  ipcMain.handle('snc:chromeStatus', (_e, port) => chromeLaunch.status(port));

  ipcMain.handle('snc:remoteStart', async (_e, { port, token }) => {
    dataAvailable();const t = token || remote.newToken();
    await store.kvSet('snc:remote:token', t);
    return remote.start(port, t);
  });
  ipcMain.handle('snc:remoteStop', () => remote.stop());
  ipcMain.handle('snc:remoteStatus', () => remote.status());

  /* ---------------- 跨设备同步 ----------------
   * 主进程这边只做三件事：认领一个设备号、封包/拆包、往落点目录读写。
   * 「哪些数据能同步」和「两份数据怎么合」都在渲染进程（sync-policy.ts /
   * sync-merge.ts），那边有完整的用例。这样分是因为密钥桶从来不进渲染进程，
   * 而同步包里本来就不该有密钥 —— 两条约束刚好对得上。
   */
  const DEVICE_KEY = 'snc:device:id';
  async function deviceId() {
    dataAvailable();
    let id = store.kvGet(DEVICE_KEY);
    // 随机 UUID，不含任何机器信息：这个字符串会变成落点目录里的文件名。
    if (!id || typeof id !== 'string') { id = require('node:crypto').randomUUID(); await store.kvSet(DEVICE_KEY, id); }
    return id;
  }
  ipcMain.handle('snc:syncDeviceId', () => deviceId());
  ipcMain.handle('snc:syncPickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择同步文件夹（网盘 / Syncthing / 共享目录都行）',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('snc:syncPeek', (_e, { dir }) => syncFolder.peek(dir));
  ipcMain.handle('snc:syncPush', async (_e, { dir, payload, passphrase }) =>
    syncFolder.push(dir, await deviceId(), payload, passphrase));
  ipcMain.handle('snc:syncPull', async (_e, { dir, passphrase }) =>
    syncFolder.pull(dir, await deviceId(), passphrase));
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */

windowHealth.configureCompositing(app);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => backgroundWindow.show());

  app.setAppUserModelId('dev.anyai.desktop');

  app.whenReady().then(async () => {
    windowHealth.watchGpu(app, { log: windowLog(), windows: () => [mainWindow] });
    protocol.handle('wickrun-media', serveMedia);
    registerIpc();
    if(!storageStartupError){
      void chromeLaunch.restore().catch(error=>console.error('Chrome connection restore:',error.message));
      void conversationClients?.restore().catch(error=>console.error('Native connection restore:',error.message));
      cloudRelay?.start();
      // 全局大脑写进了 Claude Code / Codex 配置时，终端里的 claude / codex 需要代理在线
      if(require('node:fs').existsSync(path.join(app.getPath('userData'),'brain-sessions.json')))void brainProxy?.start().catch(error=>console.error('Brain proxy:',error.message));
    }
    buildMenu();
    createWindow();
    backgroundWindow.install();
    appUpdates=require('./app-updates.cjs').createAppUpdates({updater:require('electron-updater').autoUpdater,packaged:app.isPackaged,version:app.getVersion(),
      isBusy:()=>activeRunIds.size>0||inflight.size>0||activeToolControllers.size>0||localClients?.busy()||conversationClients?.busy()||nativeAiBridge?.busy()||cloudRelay?.busy()||false,
      beforeInstall:async()=>{await prepareRendererQuit();await store.flush();},persist:enabled=>store.kvSet('wickrun:auto-update:v1',JSON.stringify(enabled)),openExternal:url=>shell.openExternal(url),
      notify:body=>{if(Notification.isSupported())new Notification({title:'wickrunAI 更新',body}).show();}});
    let updateEnabled=true;try{updateEnabled=(await store.kvGet('wickrun:auto-update:v1'))!=='false';}catch{updateEnabled=false;}
    appUpdates.start(updateEnabled);
    powerMonitor.on('shutdown',()=>appUpdates?.suspendInstall());

    app.on('activate', () => {
      backgroundWindow.show();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    backgroundWindow.beginQuit();
    if(quitFlushed)return;
    event.preventDefault();
    if(quitFlushing)return;
    quitFlushing=true;
    nativeAiBridge?.close();
    localClients?.close();
    conversationClients?.close();
    brainProxy?.close();
    cloudRelay?.close();
    butlerSources?.close();
    for (const [, rec] of inflight) {
      clearTimeout(rec.timer);
      rec.controller.abort('quit');
    }
    inflight.clear();
    remote.stop();
    void (async()=>{
      try{
        await prepareRendererQuit();
        if(mainWindow&&!mainWindow.isDestroyed()&&!restoringData){
          const maximized=mainWindow.isMaximized(),b=maximized?mainWindow.getNormalBounds():mainWindow.getBounds();
          await store.kvSet(BOUNDS_KEY,JSON.stringify({...b,maximized}));
        }
        await store.flush();quitFlushed=true;app.quit();
      }catch(error){
        quitFlushing=false;
        // Show the dialog on top of the window: hidden behind other apps it left the app running with no visible way out.
        const owner=mainWindow&&!mainWindow.isDestroyed()?mainWindow:null;if(owner){owner.show();owner.focus();}
        const result=await (owner?dialog.showMessageBox(owner,{type:'error',title:'尚有记录未保存',message:'保存记录失败，应用尚未退出。',detail:String(error.message||error),buttons:['重试保存','退出，仅保留已保存记录'],defaultId:0,cancelId:0}):dialog.showMessageBox({type:'error',title:'尚有记录未保存',message:'保存记录失败，应用尚未退出。',detail:String(error.message||error),buttons:['重试保存','退出，仅保留已保存记录'],defaultId:0,cancelId:0}));
        if(result.response===1){quitFlushed=true;app.quit();}else app.quit();
      }
    })();
  });
  app.on('will-quit', () => {appUpdates?.close();backgroundWindow.destroy();});
}
