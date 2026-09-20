'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const { createCollaborationStore } = require('../electron/collaboration-store.cjs');
const storeFixtures = require('./team-store-fixtures.cjs');

function tempRoot(t, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function runtimeFixture(t, execute) {
  const root = tempRoot(t, 'wickrun-explore-runtime-');
  const store = createCollaborationStore(root);
  const calls = [];
  const bridge = {
    collaborationRead: async () => store.read(),
    collaborationUpdate: async (revision, project) => store.update(revision, project),
    collaborationClaim: async (projectId, runId) => store.claim(projectId, runId),
    toolAbort: async () => {},
  };
  const load = loader({
    './store': {
      uid: (prefix = 'id') => `${prefix}-${crypto.randomUUID()}`,
      secretGet: async () => 'fixture-key',
      toolContextOf: () => ({ grants: { extraRoots: [], screen: false, admin: false } }),
    },
    './transport': { desktop: () => bridge },
    './agent': {
      runAgent(args) {
        calls.push(args);
        queueMicrotask(() => void Promise.resolve(execute(args)).catch((error) => args.events.onError(error.message, { kind: 'unknown' })));
        return { abort() { args.events.onPaused?.('cancelled'); } };
      },
    },
  });
  const { TeamRuntime } = load(path.resolve('src/lib/team-runtime.ts'));
  const domain = load(path.resolve('src/lib/collaboration.ts'));
  const config = load(path.resolve('src/lib/paramSchema.ts')).defaultGenerationConfig();
  const runtime = new TeamRuntime();
  runtime.settings = () => ({
    defaultConfig: config,
    keyProfiles: [{ id: 'key', name: 'Fixture', baseUrl: 'https://example.invalid' }],
    effortMappings: [], requestTimeoutMs: 1000, autoRetry: 0,
  });
  return { runtime, domain, config, calls, store };
}

async function installRuntimeProject(f, intent = 'explore', alter = () => {}) {
  await f.runtime.load();
  const project = f.domain.emptyTeamProject('p');
  project.settings.maxTokens = 10000;
  project.members = [{
    id: 'member', name: 'Planner', instructions: 'Explore only', connectionId: 'key', model: 'fixture', effort: 'medium',
    enabled: true, tools: [], skills: [], maxTokens: 4000, maxMinutes: 2, failover: { enabled: false, routes: [] },
  }];
  const flow = f.domain.newWorkflow('Explore');
  const [start, end] = flow.draft.nodes;
  const agent = f.domain.newNode('agent');
  agent.id = 'agent'; agent.memberId = 'member'; agent.instructions = 'Outline directions'; agent.outputRequirement = 'Editable proposal';
  end.outputRequirement = 'User decides';
  flow.draft.nodes = [start, agent, end];
  flow.draft.edges = [
    { id: 'start-agent', from: start.id, to: agent.id, port: 'next', label: 'next', maxTraversals: 3 },
    { id: 'agent-end', from: agent.id, to: end.id, port: 'next', label: 'next', maxTraversals: 3 },
  ];
  flow.draft.maxTokens = 10000;
  flow.versions = [{ id: 'v1', number: 1, createdAt: 1, graph: structuredClone(flow.draft) }];
  project.workflows = [flow];
  const task = { id: 'task', title: 'Idea', goal: 'Consider an event', acceptance: 'Directions and questions', status: 'ready', entries: [], createdAt: 1 };
  if (intent !== null) task.intent = intent;
  project.tasks = [task];
  alter(project, flow, agent);
  await f.runtime.update('p', (target) => Object.assign(target, project));
  return { project, flow };
}

test('runtime freezes explore intent and prefixes every model prompt with the non-execution boundary', async (t) => {
  const f = runtimeFixture(t, async (args) => { args.events.onContentDelta('proposal'); args.events.onDone(); });
  const { flow } = await installRuntimeProject(f);
  const runId = await f.runtime.createRun('p', 'task', flow.id, 'v1', f.config);
  assert.equal(f.runtime.project('p').runs[0].intent, 'explore');
  await f.runtime.start('p', runId);

  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].history[0].content, /^本次运行只梳理可选方向/);
  assert.match(f.calls[0].history[0].content, /不得调用工具、修改文件、运行命令/);
  assert.equal(f.calls[0].config.toolsEnabled, false);
});
test('continuing an exploration closes its acceptance gate and frees the single project slot',async(t)=>{
 const f=runtimeFixture(t,async(args)=>{args.events.onContentDelta('Directions and questions');args.events.onDone();});
 const {flow}=await installRuntimeProject(f);
 const first=await f.runtime.createRun('p','task',flow.id,'v1',f.config);await f.runtime.start('p',first);
 const second=await f.runtime.createRun('p','task',flow.id,'v1',f.config);
 await assert.rejects(()=>f.runtime.start('p',second),/同时运行数量/);
 const {finishDiscoveryRound}=loader()(path.resolve('src/lib/team-discovery.ts'));
 await finishDiscoveryRound(f.runtime,'p','task',first);
 assert.equal(f.runtime.project('p').runs.find(r=>r.id===first).status,'completed');
 assert.equal(f.runtime.project('p').runs.find(r=>r.id===first).intent,'explore');
 await f.runtime.start('p',second);assert.equal(f.calls.length,2);
 assert.equal(f.runtime.project('p').runs.find(r=>r.id===second).status,'waiting_user');
 const before=f.runtime.project('p').runs.find(r=>r.id===first).events.length;
 await finishDiscoveryRound(f.runtime,'p','task',first);
 assert.equal(f.runtime.project('p').runs.find(r=>r.id===first).events.length,before);
});

test('runtime rejects explore members with tools, skills, or native clients before a run is created', async (t) => {
  for (const [label, alter] of [
    ['tools', (project) => project.members[0].tools.push('write_file')],
    ['skills', (project) => project.members[0].skills.push('filesystem-skill')],
    ['native client', (project) => { project.members[0].connectionId = 'client:codex'; }],
  ]) {
    await t.test(label, async (t) => {
      const f = runtimeFixture(t, async () => {});
      const { flow } = await installRuntimeProject(f, 'explore', alter);
      await assert.rejects(() => f.runtime.createRun('p', 'task', flow.id, 'v1', f.config), /想法梳理运行只能使用/);
      assert.equal(f.runtime.project('p').runs.length, 0);
    });
  }
});

test('runtime rejects executable graph node kinds for explore but leaves legacy tasks unchanged', async (t) => {
  const blocked = runtimeFixture(t, async () => {});
  const { flow } = await installRuntimeProject(blocked, 'explore', (_project, target, agent) => {
    agent.type = 'handoff';
    target.versions[0].graph = structuredClone(target.draft);
  });
  await assert.rejects(() => blocked.runtime.createRun('p', 'task', flow.id, 'v1', blocked.config), /想法梳理运行只允许/);

  const legacy = runtimeFixture(t, async (args) => { args.events.onContentDelta('ordinary result'); args.events.onDone(); });
  const installed = await installRuntimeProject(legacy, null);
  const runId = await legacy.runtime.createRun('p', 'task', installed.flow.id, 'v1', legacy.config);
  assert.equal(legacy.runtime.project('p').runs[0].intent, undefined);
  await legacy.runtime.start('p', runId);
  assert.doesNotMatch(legacy.calls[0].history[0].content, /^本次运行只梳理可选方向/);
});

function persistNewRun(t, mutateSource = () => {}, mutateRun = () => {}) {
  const root = tempRoot(t, 'wickrun-explore-store-');
  const store = createCollaborationStore(root);
  const project = storeFixtures.project(root);
  project.tasks[0].intent = 'explore';
  mutateSource(project);
  store.update(0, project);
  const run = storeFixtures.run(project);
  run.intent = 'explore';
  mutateRun(run, project);
  project.runs.push(run);
  return { store, project, write: () => store.update(1, project) };
}

test('durable store requires intent provenance and independently rejects expanded explore authorization', async (t) => {
  await t.test('safe snapshot', (t) => {
    const fixture = persistNewRun(t);
    assert.equal(fixture.write().projects.p.runs[0].intent, 'explore');
  });
  await t.test('missing intent provenance', (t) => {
    const fixture = persistNewRun(t, () => {}, (run) => { delete run.intent; });
    assert.throws(fixture.write, /项目授权/);
  });
  for (const [label, mutate] of [
    ['tools', (project) => project.members[0].tools.push('write_file')],
    ['skills', (project) => { project.members[0].skills = ['filesystem-skill']; }],
    ['native client', (project) => {
      project.members[0].connectionId = 'client:codex';
      project.settings.allowedConnections = ['client:codex'];
    }],
    ['handoff node', (project) => { project.workflows[0].versions[0].graph.nodes[1].type = 'handoff'; }],
  ]) {
    await t.test(label, (t) => {
      const fixture = persistNewRun(t, mutate);
      assert.throws(fixture.write, /想法梳理运行/);
    });
  }
});

test('durable intent and explore authorization are immutable while legacy undefined intent remains valid', (t) => {
  const fixture = persistNewRun(t);
  fixture.write();
  let data = fixture.store.read();
  data.projects.p.runs[0].intent = 'deliver';
  assert.throws(() => fixture.store.update(data.revision, data.projects.p), /快照不可改写/);

  data = fixture.store.read();
  data.projects.p.runs[0].members[0].tools.push('write_file');
  assert.throws(() => fixture.store.update(data.revision, data.projects.p), /快照不可改写|想法梳理运行/);

  const legacyRoot = tempRoot(t, 'wickrun-legacy-intent-');
  const legacyStore = createCollaborationStore(legacyRoot);
  const legacyProject = storeFixtures.project(legacyRoot);
  legacyStore.update(0, legacyProject);
  legacyProject.runs.push(storeFixtures.run(legacyProject));
  assert.equal(legacyStore.update(1, legacyProject).projects.p.runs[0].intent, undefined);
});
