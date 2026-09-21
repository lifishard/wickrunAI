'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');

const ORIGIN = 'https://wickrunai-web-production.up.railway.app';
function createCloudAccount({ app, safeStorage, openExternal, fetcher = fetch }) {
  const base = app.getPath('userData');
  const registryFile = path.join(base, 'cloud-accounts.json');
  let registry = { active: null, accounts: {} }, pending = null, readyAccount = null, polling = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    if (!parsed || !parsed.accounts || typeof parsed.accounts !== 'object' || Array.isArray(parsed.accounts)) throw new Error('Invalid cloud account registry.');
    registry = parsed;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const validId = id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id) && !['__proto__','prototype','constructor'].includes(id);
  const active = validId(registry.active) && Object.hasOwn(registry.accounts, registry.active) ? registry.active : null;
  if (active) {
    const directory = path.join(base, 'cloud-profiles', createHash('sha256').update(active).digest('hex'));
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
  const persist = () => {
    fs.mkdirSync(base, { recursive: true });
    const temp = registryFile + '.' + randomBytes(6).toString('hex') + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(registry), { mode: 0o600 });
    fs.renameSync(temp, registryFile);
  };
  const credential = () => {
    if (!active) return null;
    const entry = registry.accounts[active];
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable. Sign-in credentials cannot be read.');
    return safeStorage.decryptString(Buffer.from(entry.token, 'base64'));
  };
  async function request(urlPath, method = 'GET', body, token = credential()) {
    const response = await fetcher(ORIGIN + urlPath, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || `Cloud request failed (${response.status}).`); error.status = response.status; throw error; }
    return data;
  }
  return {
    activeId: active,
    basePath: base,
    state() { return { user: active ? registry.accounts[active].user : null, origin: ORIGIN, pending: pending ? { code: pending.code, expires: pending.expires } : null, ready: readyAccount?.user || null }; },
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
      registry.accounts[readyAccount.user.id] = readyAccount;
      registry.active = readyAccount.user.id;
      persist();
    },
    async logout() {
      if (active) await request('/api/cloud/desktop/logout', 'POST');
      registry.active = null;
      if (active) delete registry.accounts[active];
      persist();
    },
    async call(action, input = {}) {
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
      const paths = { status: ['/api/cloud/status','GET'], read: ['/api/cloud/data','GET'], write: ['/api/cloud/data','PUT'], keys: ['/api/cloud/keys','GET'] };
      if (Object.hasOwn(paths,action)) return request(paths[action][0],paths[action][1],action==='write'?input:undefined);
      if (['keyGet','keySet','keyDelete'].includes(action) && typeof input.id === 'string' && /^[\w:-]{1,160}$/.test(input.id)) {
        return request('/api/cloud/keys/'+encodeURIComponent(input.id),{keyGet:'GET',keySet:'PUT',keyDelete:'DELETE'}[action],action==='keySet'?{value:input.value}:undefined);
      }
      throw new Error('Unsupported cloud operation.');
    },
    guestData() {
      const file = path.join(base, 'store.json');
      let data;
      try { data = JSON.parse(fs.readFileSync(file,'utf8')); } catch (error) { if(error.code==='ENOENT') data = {}; else throw error; }
      const names = ['snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1','snc:settings:v1','anyai:observations:v1'];
      const result = Object.fromEntries(names.filter(name=>typeof data.kv?.[name]==='string').map(name=>[name,data.kv[name]]));
      const archives = require('./run-store.cjs').createRunStore(path.join(base,'runtime-v2')).list().map(record=>({id:'run:'+record.id,title:record.title||record.question.content.slice(0,80),kind:'chat',updatedAt:record.state.at,text:JSON.stringify({question:record.question.content,result:record.state.content,reasoning:record.state.reasoning,status:record.state.status,steps:record.state.steps,usage:record.state.usage},null,2)}));
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
