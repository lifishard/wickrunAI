'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const { createCollaborationStore } = require('../electron/collaboration-store.cjs');

function fixture(t, execute = async (args) => args.events.onDone()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-team-governance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createCollaborationStore(root);
  const calls = [];
  const bridge = {
    collaborationRead: async () => store.read(),
    collaborationUpdate: async (revision, project) => store.update(revision, project),
    collaborationClaim: async (projectId, runId) => store.claim(projectId, runId),
    toolAbort: async () => {},
  };
  let serial = 0;
  const load = loader({
    './store': {
      uid: (prefix = 'id') => `${prefix}-${++serial}`,
      secretGet: async () => 'fake-local-fixture-key',
      toolContextOf: () => ({ grants: { extraRoots: [], screen: false, admin: false } }),
    },
    './transport': { desktop: () => bridge },
    './agent': {
      runAgent(args) {
        calls.push(args);
        queueMicrotask(() => void execute(args, calls.length));
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
    keyProfiles: [{ id: 'key', name: 'Fixture', baseUrl: 'https://fixture.invalid/v1' }],
    effortMappings: [], requestTimeoutMs: 1000, autoRetry: 0,
  });
  return { store, calls, load, runtime, domain, config };
}

function project(domain, id, memories = []) {
  const value = domain.emptyTeamProject(id);
  value.members = [{
    id: 'member', name: 'Member', instructions: 'Do the assigned work.', connectionId: 'key',
    model: 'fixture-model', effort: 'medium', enabled: true, tools: [], maxTokens: 100000, maxMinutes: 2,
  }];
  const flow = domain.newWorkflow(`Flow ${id}`);
  const start = flow.draft.nodes[0];
  const end = flow.draft.nodes[1];
  const agent = domain.newNode('agent');
  agent.memberId = 'member';
  agent.instructions = 'Return evidence.';
  agent.outputRequirement = 'Evidence text.';
  end.outputRequirement = 'Review the evidence.';
  flow.draft.nodes = [start, agent, end];
  flow.draft.edges = [[start, agent], [agent, end]].map(([from, to], index) => ({
    id: `${id}-edge-${index}`, from: from.id, to: to.id, port: 'next', label: 'next', maxTraversals: 5,
  }));
  flow.draft.maxTokens = 400000;
  flow.versions = [{ id: `${id}-version`, number: 1, createdAt: 1, graph: structuredClone(flow.draft) }];
  value.settings.maxTokens = 400000;
  value.workflows = [flow];
  value.tasks = [{ id: `${id}-task`, title: 'Fixture', goal: 'Explain the result', acceptance: 'Return evidence', entries: [], status: 'ready', createdAt: 1 }];
  value.memories = structuredClone(memories);
  return value;
}

function memory(id, text, status = 'adopted') {
  return { id, title: id, text, applicability: 'This project only', evidence: 'Reviewed fixture', status, revision: 1, history: [] };
}

async function install(runtime, value) {
  await runtime.update(value.id, (target) => Object.assign(target, value));
}

async function createRun(f, projectId) {
  const p = f.runtime.project(projectId);
  return f.runtime.createRun(projectId, `${projectId}-task`, p.workflows[0].id, `${projectId}-version`, f.config);
}

test('member checkpoints preserve token attribution by request purpose', async (t) => {
  const stats = [
    { requestId: 'req-agent', route: 'key::fixture-model', effort: 'medium', purpose: 'agent', estimatedInput: 90, actualInput: 80, reservedOutput: 20, output: 20, at: 1, outcome: 'accepted' },
    { requestId: 'req-compaction', route: 'key::fixture-model', effort: 'medium', purpose: 'compaction', estimatedInput: 30, actualInput: 25, reservedOutput: 10, output: 10, at: 2, outcome: 'accepted' },
    { requestId: 'req-final', route: 'key::fixture-model', effort: 'medium', purpose: 'final', estimatedInput: 35, actualInput: 30, reservedOutput: 10, output: 10, at: 3, outcome: 'accepted' },
  ];
  const f = fixture(t, async (args) => {
    args.events.onContentDelta('evidence');
    await args.events.onRunState({
      working: [], round: 3, at: 3, stoppedBy: 'unknown', status: 'completed', content: 'evidence',
      spentTokens: 175, usage: { prompt_tokens: 135, completion_tokens: 40, total_tokens: 175 },
      requestStats: structuredClone(stats),
    });
    args.events.onDone();
  });
  await f.runtime.load();
  await install(f.runtime, project(f.domain, 'p'));
  const runId = await createRun(f, 'p');
  await f.runtime.start('p', runId);

  const memoryState = f.runtime.project('p').runs[0].attempts.find((attempt) => attempt.routeLog)?.memberStates.member;
  const diskState = f.store.read().projects.p.runs[0].attempts.find((attempt) => attempt.routeLog)?.memberStates.member;
  assert.deepEqual(diskState.requestStats, stats);
  assert.deepEqual(Object.fromEntries(memoryState.requestStats.map((stat) => [stat.purpose, (stat.actualInput ?? 0) + (stat.output ?? 0)])), {
    agent: 100, compaction: 35, final: 40,
  });
  assert.equal(f.runtime.project('p').runs[0].tokens, 175);
  assert.equal(memoryState.spentTokens, 175);
});

test('invalidated memory is excluded from future runs while active snapshots stay frozen and project-local', async (t) => {
  const f = fixture(t);
  await f.runtime.load();
  await install(f.runtime, project(f.domain, 'alpha', [
    memory('alpha-adopted', 'alpha durable guidance'),
    memory('alpha-candidate', 'not approved yet', 'candidate'),
  ]));
  await install(f.runtime, project(f.domain, 'beta', [memory('beta-adopted', 'beta-only guidance')]));

  const activeId = await createRun(f, 'alpha');
  const betaId = await createRun(f, 'beta');
  assert.deepEqual(f.runtime.project('alpha').runs.find((run) => run.id === activeId).memoryIds, ['alpha-adopted@1']);
  assert.deepEqual(f.runtime.project('beta').runs.find((run) => run.id === betaId).memorySnapshot.map((item) => item.text), ['beta-only guidance']);

  await f.runtime.update('alpha', (p) => {
    const item = p.memories.find((entry) => entry.id === 'alpha-adopted');
    item.status = 'invalid';
    item.revision = 2;
    item.history.push({ at: 2, text: item.text, status: 'invalid' });
  });
  const futureId = await createRun(f, 'alpha');
  const alpha = f.runtime.project('alpha');
  const active = alpha.runs.find((run) => run.id === activeId);
  const future = alpha.runs.find((run) => run.id === futureId);
  assert.deepEqual(active.memorySnapshot.map((item) => [item.id, item.status, item.revision]), [['alpha-adopted', 'adopted', 1]]);
  assert.deepEqual(active.memoryIds, ['alpha-adopted@1']);
  assert.deepEqual(future.memorySnapshot, []);
  assert.deepEqual(future.memoryIds, []);
  assert.equal(JSON.stringify(alpha.runs).includes('beta-only guidance'), false);
  assert.equal(JSON.stringify(f.runtime.project('beta').runs).includes('alpha durable guidance'), false);
});

test('runtime injects only the bounded selection from frozen memory after project metadata changes', async t=>{
 const f=fixture(t,async args=>{args.events.onContentDelta('evidence');args.events.onDone();});await f.runtime.load();
 const entries=[memory('a','PROJECT_SELECTED'),{...memory('b','TASK_SELECTED'),scope:'task',keywords:['evidence']},
 {...memory('c','OMIT_MISMATCH'),scope:'task',keywords:['volcano']},{...memory('d','OMIT_EXPIRED'),expiresAt:1},
 memory('e','OMIT_OVERSIZED'+'.'.repeat(6000)),memory('f','OMIT_CANDIDATE','candidate')];
 await install(f.runtime,project(f.domain,'p',entries));const id=await createRun(f,'p');
 const frozen=f.runtime.project('p').runs.find(r=>r.id===id);assert.equal(frozen.memorySnapshot.length,5);
 await f.runtime.update('p',p=>{p.memories[0].status='invalid';p.memories[1].expiresAt=1;p.memories[1].keywords=['unrelated'];});
 await f.runtime.start('p',id);const system=f.calls[0].extraSystem;
 const select=f.load(path.resolve('src/lib/team-memory.ts')).selectTeamMemories;
 const expected=select(frozen.memorySnapshot,frozen,{now:frozen.createdAt});
 assert.ok(system.includes(expected.prompt));assert.match(system,/PROJECT_SELECTED/);assert.match(system,/TASK_SELECTED/);assert.doesNotMatch(system,/OMIT_/);
 assert.equal(expected.snapshots.length,2);assert.ok(expected.totalChars<=6000);
 const disk=f.store.read().projects.p.runs.find(r=>r.id===id);assert.deepEqual(disk.memorySnapshot,frozen.memorySnapshot);
});

test('scheduler creates one run per trigger and skip policy prevents a later overlap', async (t) => {
  const f = fixture(t, async () => { /* Hold the first scheduled member until the test pauses it. */ });
  await f.runtime.load();
  const p = project(f.domain, 'p');
  const firstAt = Date.parse('2026-09-18T09:00:00Z');
  p.schedules = [{
    id: 'daily', name: 'Daily fixture', workflowId: p.workflows[0].id, versionId: 'p-version',
    goal: 'Explain the result', acceptance: 'Return evidence', timezone: 'UTC', hour: 9, minute: 0,
    catchUp: true, overlap: 'skip', enabled: true, nextAt: firstAt, triggers: [],
  }];
  await install(f.runtime, p);

  await Promise.all([f.runtime.tick(firstAt + 1000), f.runtime.tick(firstAt + 1000)]);
  for (let i = 0; i < 100 && f.calls.length < 1; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  let current = f.runtime.project('p');
  assert.equal(current.schedules[0].triggers.length, 1);
  assert.equal(current.runs.length, 1);
  assert.equal(current.tasks.filter((task) => task.id.startsWith('scheduled-')).length, 1);
  assert.equal(current.runs[0].status, 'running');
  const scheduleKey = current.runs[0].scheduleKey;
  await assert.rejects(
    f.runtime.createRun('p', current.runs[0].taskId, current.runs[0].workflowId, 'p-version', f.config, scheduleKey),
    /触发.*创建运行/,
  );

  const secondAt = Date.parse('2026-09-19T09:00:00Z');
  await f.runtime.tick(secondAt + 1000);
  await f.runtime.tick(secondAt + 1000);
  current = f.runtime.project('p');
  assert.equal(current.runs.length, 1, 'overlap=skip must not create a second run while the first is active');
  assert.equal(current.schedules[0].triggers.length, 2);
  assert.match(current.schedules[0].triggers[1].reason, /前次运行未结束.*跳过/);
  assert.equal(current.schedules[0].triggers[1].runId, undefined);

  await f.runtime.pause('p', current.runs[0].id);
  for(const [offset,status] of [[2,'paused'],[3,'uncertain']]){
    await f.runtime.update('p',p=>{p.runs[0].status=status;});
    await f.runtime.tick(firstAt+offset*86400000+1000);
    const next=f.runtime.project('p');assert.equal(next.runs.length,1);
    assert.match(next.schedules[0].triggers.at(-1).reason,/前次运行未结束.*跳过/);
  }
});
