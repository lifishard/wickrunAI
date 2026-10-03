'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');

const ORIGIN = 'https://wickrunai.com';
function createCloudAccount({ app, safeStorage, openExternal, fetcher = fetch }) {
  const base = app.getPath('userData');
  const registryFile = path.join(base, 'cloud-accounts.json');
  let registry = { active: null, accounts: {} }, pending = null, readyAccount = null, polling = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    if (!parsed || !parsed.accounts || typeof parsed.accounts !== 'object' || Array.isArray(parsed.accounts)) throw new Error('Invalid cloud account registry.');
    registry = parsed;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const persist = () => {
    fs.mkdirSync(base, { recursive: true });
    const temp = registryFile + '.' + randomBytes(6).toString('hex') + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(registry), { mode: 0o600 });
    fs.renameSync(temp, registryFile);
  };
  const validId = id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id) && !['__proto__','prototype','constructor'].includes(id);
  const active = validId(registry.active) && Object.hasOwn(registry.accounts, registry.active) ? registry.active : null;
  if (active) {
    const workspace=require('./device-workspace.cjs').chooseDeviceWorkspace(base,registry,active,{safeStorage});
    const directory = workspace.directory;
    if(workspace.changed)persist();
    if(registry.deviceWorkspaceOwner===active)require('./device-workspace.cjs').adoptLocalButler(base,active);
    fs.mkdirSync(directory, { recursive: true });
    // Windows safeStorage ciphertext is bound to Chromium's Local State key.
    // Keep the same OS-protected key across isolated account directories so
    // credentials encrypted before switching remain readable after relaunch.
    const localState = path.join(base, 'Local State');
    if (fs.existsSync(localState) && !fs.existsSync(path.join(directory, 'Local State'))) {
      fs.copyFileSync(localState, path.join(directory, 'Local State'), fs.constants.COPYFILE_EXCL);
    }
    app.setPath('userData', directory);
    app.setPath('sessionData', directory);
  }
  const credential = () => {
    if (!active) return null;
    const entry = registry.accounts[active];
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable. Sign-in credentials cannot be read.');
    return safeStorage.decryptString(Buffer.from(entry.token, 'base64'));
  };
  const cancelled = () => Object.assign(new Error('上传已取消'), { name: 'AbortError' });
  let mediaLifetime = new AbortController();
  const mediaAccountId = () => registry.active === active && Object.hasOwn(registry.accounts, active) ? active : null;
  async function request(urlPath, method = 'GET', body, token, { signal } = {}) {
    if (signal?.aborted) throw cancelled();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Cloud request timed out.', 'TimeoutError')), 20000);
    timer.unref?.();
    try {
      if (signal?.aborted) throw cancelled();
      const authToken = token === undefined ? credential() : token;
      const response = await fetcher(ORIGIN + urlPath, {
        method, redirect: 'error', signal: controller.signal,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(error => {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
        return null;
      });
      if (!response.ok) {
        const detail = data && typeof data === 'object' ? data.error || data.message : null;
        const message = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && typeof detail.message === 'string' ? detail.message : null;
        const error = new Error(message || `Cloud request failed (${response.status}).`);
        error.status = response.status;
        error.retryAfter = response.headers?.get('Retry-After');
        if (data && typeof data.code === 'string') error.code = data.code;
        throw error;
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid cloud response.');
      if (signal?.aborted) throw cancelled();
      return data;
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  return {
    activeId: active,
    mediaAccountId,
    mediaSignal: () => mediaLifetime.signal,
    basePath: base,
    signedIn: () => Boolean(active),
    /** 云文件库（主进程内部用）：渲染进程不能指定地址或令牌 */
    async media(operation, input = {}, { signal, accountId = mediaAccountId() } = {}) {
      if (signal?.aborted) throw cancelled();
      if (!active) throw new Error('请先登录云账号，再使用云文件。');
      if (!accountId || accountId !== mediaAccountId()) throw new Error('云账号已切换，请重新上传。');
      if (typeof operation !== 'string' || !/^[a-zA-Z]{2,20}$/.test(operation)) throw new Error('Unsupported media operation.');
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const lifetime = mediaLifetime.signal;
      for (const source of [signal, lifetime]) { source?.addEventListener('abort', cancel, { once: true }); if (source?.aborted) cancel(); }
      try {
        const result = await request('/api/media', 'POST', { operation, input }, undefined, { signal: controller.signal });
        if (accountId !== mediaAccountId()) throw new Error('云账号已切换，请重新上传。');
        return result;
      } finally { for (const source of [signal, lifetime]) source?.removeEventListener('abort', cancel); }
    },
    /** 任务中继（主进程内部用，不经 IPC）：只允许 /api/cloud/relay/ 下的接口 */
    async relay(urlPath, method = 'GET', body) {
      if (!active) throw new Error('Sign in to access your cloud account.');
      if (typeof urlPath !== 'string' || !/^\/api\/cloud\/relay\/[\w/-]+$/.test(urlPath)) throw new Error('Unsupported relay operation.');
      return request(urlPath, method, body);
    },
    state() { return { user: active ? registry.accounts[active].user : null,workspaceAccountId:active??registry.deviceWorkspaceOwner??'guest', continuesLocalWorkspace:Boolean(active&&registry.deviceWorkspaceOwner===active),origin: ORIGIN, pending: pending ? { code: pending.code, expires: pending.expires } : null, ready: readyAccount?.user || null }; },
    async login() {
      if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure system storage is required to save your cloud sign-in.');
      if (pending && pending.expires > Date.now()) return { code: pending.code, expires: pending.expires };
      const verifier = randomBytes(32).toString('base64url');
      const started = await request('/api/cloud/desktop/start', 'POST', { challenge: createHash('sha256').update(verifier).digest('base64url') }, null);
      if (!/^[a-f0-9]{64}$/.test(started.requestId) || !/^[A-F0-9]{8}$/.test(started.code) || started.loginUrl !== `${ORIGIN}/api/cloud/desktop/approve?request=${started.requestId}`) throw new Error('Invalid desktop authorization response.');
      pending = { ...started, verifier, expires: Date.now() + 300000 };
      readyAccount = null;
      await openExternal(started.loginUrl);
      return { code: started.code, expires: pending.expires };
    },
    poll() {
      if (polling) return polling;
      polling = (async () => {
      if (!pending) return { ready: Boolean(readyAccount) };
      if (pending.expires <= Date.now()) { pending = null; throw new Error('Desktop sign-in expired. Please try again.'); }
      const current = pending;
      const result = await request('/api/cloud/desktop/token', 'POST', { requestId: current.requestId, verifier: current.verifier }, null);
      if (result.pending) return { pending: true };
      if (!validId(result.user?.id) || !/^[\w-]{43}$/.test(result.token)) throw new Error('Invalid desktop account response.');
      // The token never crosses IPC into the renderer.
      readyAccount = { user: result.user, token: safeStorage.encryptString(result.token).toString('base64') };
      pending = null;
      return { ready: true, user: result.user };
      })().finally(() => { polling = null; });
      return polling;
    },
    activate() {
      if (!readyAccount) throw new Error('Complete Google sign-in first.');
      mediaLifetime.abort();
      registry.accounts[readyAccount.user.id] = readyAccount;
      registry.active = readyAccount.user.id;
      require('./device-workspace.cjs').chooseDeviceWorkspace(base,registry,readyAccount.user.id,{firstLogin:!active,safeStorage});
      persist();
    },
    async logout() {
      mediaLifetime.abort();
      try {
        if (active) await request('/api/cloud/desktop/logout', 'POST');
        registry.active = null;
        if (active) delete registry.accounts[active];
        persist();
      } catch (error) { mediaLifetime = new AbortController(); throw error; }
    },
    async call(action, input = {}) {
      if (action === 'collaboration') {
        if (!input || typeof input !== 'object' || typeof input.operation !== 'string' || !input.input || typeof input.input !== 'object') throw new Error('Invalid collaboration operation.');
        if (input.expectedAccountId !== undefined) {
          if (!input.expectedAccountId || input.expectedAccountId !== mediaAccountId()) throw new Error('账号已切换，已停止传输文件。');
          try {
            const result = await request('/api/collaboration', 'POST', { operation: input.operation, input: input.input }, undefined, { signal: mediaLifetime.signal });
            if (input.expectedAccountId !== mediaAccountId()) throw new Error('账号已切换，已停止传输文件。');
            return result;
          } catch (error) {
            // Electron invoke serializes only Error.message; keep retry metadata in an explicit file-transfer envelope.
            const message = /https?:\/\/|(?:token|signature|authorization|credential|secret)\s*[=:]/i.test(error?.message ?? '') ? '文件传输请求失败，请重试。' : error?.message;
            return { fileTransferError: { message: message || '文件传输请求失败，请重试。', name: error?.name, status: error?.status, code: error?.code, retryAfter: error?.retryAfter } };
          }
        }
        // The main process chooses the endpoint; renderer input cannot supply a URL or an authorization token.
        return request('/api/collaboration', 'POST', input);
      }
      if (!active) {
        if (action === 'status') return { user: null, available: true, origin: ORIGIN };
        throw new Error('Sign in to access your cloud account.');
      }
      if (action === 'importGuestKeys') {
        let guest;
        try { guest = JSON.parse(fs.readFileSync(path.join(base,'store.json'),'utf8')); } catch(error) { if(error.code==='ENOENT')return {ids:[]};throw error; }
        const profiles = JSON.parse(guest.kv?.['snc:settings:v1'] || '{}').keyProfiles || [];
        const existing = await request('/api/cloud/keys');
        const ids = [...existing.ids];
        for (const profile of profiles) {
          if (!/^[\w:-]{1,160}$/.test(profile.id) || ids.includes(profile.id)) continue;
          const record = guest.secrets?.[profile.id];
          if (!record || typeof record.v !== 'string') continue;
          const value = record.enc ? safeStorage.decryptString(Buffer.from(record.v,'base64')) : record.v;
          if (!value) continue;
          await request('/api/cloud/keys/'+encodeURIComponent(profile.id),'PUT',{value});
          ids.push(profile.id);
        }
        return {ids};
      }
      const paths = { status: ['/api/cloud/status','GET'], read: ['/api/cloud/data','GET'], write: ['/api/cloud/data','PUT'], sync: ['/api/cloud/sync','POST'], keys: ['/api/cloud/keys','GET'] };
      if (Object.hasOwn(paths,action)) return request(paths[action][0],paths[action][1],['write','sync'].includes(action)?input:undefined);
      if (['keyGet','keySet','keyDelete'].includes(action) && typeof input.id === 'string' && /^[\w:-]{1,160}$/.test(input.id)) {
        return request('/api/cloud/keys/'+encodeURIComponent(input.id),{keyGet:'GET',keySet:'PUT',keyDelete:'DELETE'}[action],action==='keySet'?{value:input.value}:undefined);
      }
      throw new Error('Unsupported cloud operation.');
    },
    async guestData() {
      const file = path.join(base, 'store.json');
      let data;
      try { data = JSON.parse(fs.readFileSync(file,'utf8')); } catch (error) { if(error.code==='ENOENT') data = {}; else throw error; }
      const names = ['snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1','snc:settings:v1','anyai:observations:v1'];
      const result = Object.fromEntries(names.filter(name=>typeof data.kv?.[name]==='string').map(name=>[name,data.kv[name]]));
      const runStore = require('./run-store.cjs').createRunStore(path.join(base,'runtime-v2')), summaries = runStore.listSummaries ? await runStore.listSummaries() : runStore.list();
      const archives = summaries.map(record=>({id:'run:'+record.id,title:record.title||record.question.content.slice(0,80),kind:'chat',updatedAt:record.state.at,text:JSON.stringify({question:record.question.content,result:record.state.content,reasoning:record.state.reasoning,status:record.state.status,steps:record.state.steps,usage:record.state.usage},null,2)}));
      // Read the guest document without claiming or recovering its running jobs.
      let teams = {projects:{}};
      try { teams = JSON.parse(fs.readFileSync(path.join(base,'collaboration-v1.json'),'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
      for(const project of Object.values(teams.projects))for(const run of project.runs)archives.push({id:'team:'+run.id,title:run.goal,kind:'team',updatedAt:run.updatedAt,text:JSON.stringify({goal:run.goal,acceptance:run.acceptance,status:run.status,attempts:run.attempts,events:run.events,tokens:run.tokens},null,2)});
      result['wickrun:cloud:archives:v1'] = JSON.stringify(archives);
      return result;
    },
  };
}
module.exports = { createCloudAccount, ORIGIN };
