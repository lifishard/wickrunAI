'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loader } = require('../load-ts.cjs');
const { createCollaborationStore } = require('../../electron/collaboration-store.cjs');
const { createRunStore } = require('../../electron/run-store.cjs');
const { createTeamExecutionGuard } = require('../../electron/team-execution-guard.cjs');

const [mode, root, baseUrl] = process.argv.slice(2);
if (!['first', 'recover'].includes(mode) || !root || !baseUrl) throw new Error('usage: worker <first|recover> <root> <baseUrl>');

const markerFile = path.join(root, 'unknown-started');
const resultFile = path.join(root, 'result.json');
const effectsFile = path.join(root, 'effects.jsonl');
const runtimeStorePath = require.resolve('../../electron/run-store.cjs');
const knowledgePath = require.resolve('../../electron/tools/knowledge.cjs');
const filesPath = require.resolve('../../electron/tools/files.cjs');
const toolsIndexPath = require.resolve('../../electron/tools/index.cjs');
const nativeRuntimeStore = createRunStore(path.join(root, 'runtime-v2'));

// Keep the production operation journal and dispatcher, while replacing only
// the external side-effect backends with deterministic local implementations.
require.cache[runtimeStorePath] = {
  id: runtimeStorePath, filename: runtimeStorePath, loaded: true,
  exports: { createRunStore, runtimeStore: () => nativeRuntimeStore },
};
const appendEffect = (kind, ctx) => fs.appendFileSync(effectsFile, `${JSON.stringify({ kind, callId: ctx.execution?.callId, at: Date.now() })}\n`);
require.cache[knowledgePath] = {
  id: knowledgePath, filename: knowledgePath, loaded: true,
  exports: {
    projectMemoryRead: async () => ({ ok: true, content: '[]' }),
    projectDocRead: async () => ({ ok: true, content: '' }),
    skillList: async () => ({ ok: true, content: '[]' }),
    projectDocWrite: async () => ({ ok: true, content: 'unused' }),
    skillWrite: async () => ({ ok: true, content: 'unused' }),
    projectMemoryWrite: async (args, ctx) => {
      if (args.text === 'SAFE_EFFECT_ONCE') {
        appendEffect('safe-completed', ctx);
        return { ok: true, content: 'safe side effect committed' };
      }
      if (args.text === 'UNKNOWN_EFFECT') {
        appendEffect(ctx.execution?.retryUncertain ? 'unknown-retried' : 'unknown-dispatched', ctx);
        if (!ctx.execution?.retryUncertain) {
          fs.writeFileSync(markerFile, 'started', 'utf8');
          await new Promise(() => {});
        }
        return { ok: true, content: 'unknown operation explicitly retried and completed' };
      }
      return { ok: false, content: '', error: 'unexpected memory write' };
    },
  },
};
require.cache[filesPath] = {
  id: filesPath, filename: filesPath, loaded: true,
  exports: {
    listDir: async () => ({ ok: true, content: '[]' }),
    readFile: async (args) => ({ ok: true, content: `EVIDENCE:${args.path}:` + 'long-context-evidence '.repeat(1700) }),
    editFile: async () => ({ ok: false, content: '', error: 'unused' }),
    writeFile: async () => ({ ok: false, content: '', error: 'unused' }),
    searchFiles: async () => ({ ok: true, content: '[]' }),
  },
};
delete require.cache[toolsIndexPath];
const { runTool } = require('../../electron/tools/index.cjs');

const store = createCollaborationStore(root);
const listeners = new Set();
const controllers = new Map();
const emit = (event) => { for (const listener of listeners) listener(event); };
const bridge = {
  platform: 'electron',
  collaborationRead: async () => store.read(),
  collaborationUpdate: async (revision, project) => store.update(revision, project),
  collaborationClaim: async (projectId, runId) => store.claim(projectId, runId),
  toolAbort: async () => {},
  onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async chat(init) {
    const controller = new AbortController(); controllers.set(init.requestId, controller);
    try {
      const response = await fetch(init.url, { method: 'POST', headers: init.headers, body: JSON.stringify(init.body), signal: controller.signal });
      const headers = {}; for (const [key, value] of response.headers) if (/^(content-type|retry-after|x-request-id|request-id)$/i.test(key)) headers[key] = value;
      emit({ requestId: init.requestId, type: 'response', data: headers, status: response.status });
      const text = await response.text();
      if (!response.ok) {
        emit({ requestId: init.requestId, type: 'raw', data: text, status: response.status });
        let parsed = text; try { parsed = JSON.parse(text); } catch {}
        const message = parsed?.error?.message || `HTTP ${response.status}`;
        emit({ requestId: init.requestId, type: 'error', data: message, status: response.status }); return;
      }
      emit({ requestId: init.requestId, type: 'body', data: text }); emit({ requestId: init.requestId, type: 'done' });
    } catch (error) { emit({ requestId: init.requestId, type: 'error', data: error.message }); }
    finally { controllers.delete(init.requestId); }
  },
  async abort(requestId) { controllers.get(requestId)?.abort(); },
  async tool(name, args, ctx) {
    const guarded = createTeamExecutionGuard({ collaboration: { read: () => store.read() }, teamFiles: {} }).tool(name, ctx);
    return runTool(name, args, guarded);
  },
};
global.window = { snc: bridge };

let serial = 0;
const projectFile = (name) => path.resolve(__dirname, '..', '..', name);
const load = loader({
  './store': {
    uid: (prefix = 'id') => `${prefix}-${process.pid}-${++serial}`,
    secretGet: async () => 'fake-local-key',
    toolContextOf: () => ({ grants: { extraRoots: [], screen: false, admin: false } }),
  },
});
const { TeamRuntime } = load(projectFile('src/lib/team-runtime.ts'));
const domain = load(projectFile('src/lib/collaboration.ts'));
const config = load(projectFile('src/lib/paramSchema.ts')).defaultGenerationConfig();
Object.assign(config, {
  stream: false,
  maxToolRounds: 24,
  runtime: { ...config.runtime, contextTokens: 14000, maxTokens: 100000, maxMinutes: 5, semanticCompression: true },
});

function configure(runtime) {
  runtime.settings = () => ({
    defaultConfig: config,
    keyProfiles: [
      { id: 'primary', name: 'Primary local', baseUrl: `${baseUrl}/primary/v1` },
      { id: 'fallback', name: 'Fallback local', baseUrl: `${baseUrl}/fallback/v1` },
    ],
    effortMappings: [], requestTimeoutMs: 30000, autoRetry: 0, modelHealth: {},
    failover: { enabled: true, routes: [
      { profileId: 'primary', model: 'primary-model' },
      { profileId: 'fallback', model: 'fallback-model' },
    ] },
  });
}

async function setup(runtime) {
  const project = domain.emptyTeamProject('p');
  project.settings.maxTokens = 400000; project.settings.maxMinutes = 30; project.settings.approvalMode = 'all';
  project.members = [{
    id: 'member-prep', name: 'Checkpoint worker', instructions: 'Record the initial checkpoint without tools.',
    connectionId: 'primary', model: 'primary-model', effort: 'medium', enabled: true,
    tools: [], maxTokens: 100000, maxMinutes: 5,
  }, {
    id: 'member-a', name: 'Long task worker', instructions: 'Preserve evidence and obey the correction.',
    connectionId: 'primary', model: 'primary-model', effort: 'medium', enabled: true,
    tools: ['read_file', 'project_memory_write'], maxTokens: 100000, maxMinutes: 5,
  }];
  const flow = domain.newWorkflow('Long lifecycle');
  const start = flow.draft.nodes[0], end = flow.draft.nodes[1], prep = domain.newNode('agent'), approval = domain.newNode('approval'), agent = domain.newNode('agent');
  prep.id = 'prep'; prep.memberId = 'member-prep'; prep.instructions = 'Record the explicitly allowed initial checkpoint.'; prep.outputRequirement = 'A durable initial checkpoint.';
  approval.id = 'correction-gate'; approval.instructions = 'Review the initial checkpoint before adding any correction.';
  agent.id = 'agent'; agent.memberId = 'member-a'; agent.maxVisits = 6;
  agent.instructions = 'Process the long evidence chain and preserve the original evidence.';
  agent.outputRequirement = 'Return ORIGINAL_EVIDENCE and confirm the latest correction.';
  end.id = 'end'; end.outputRequirement = 'Return ORIGINAL_EVIDENCE and confirm the latest correction.';
  start.id = 'start';
  flow.draft.nodes = [start, prep, approval, agent, end];
  flow.draft.edges = [
    { id: 'start-prep', from: 'start', to: 'prep', port: 'next', label: 'next', maxTraversals: 5 },
    { id: 'prep-gate', from: 'prep', to: 'correction-gate', port: 'next', label: 'review', maxTraversals: 5 },
    { id: 'gate-pass', from: 'correction-gate', to: 'agent', port: 'pass', label: 'approved', maxTraversals: 5 },
    { id: 'gate-fail', from: 'correction-gate', to: 'agent', port: 'fail', label: 'continue with correction', maxTraversals: 5 },
    { id: 'gate-default', from: 'correction-gate', to: 'agent', port: 'default', label: 'continue with correction', maxTraversals: 5 },
    { id: 'agent-end', from: 'agent', to: 'end', port: 'next', label: 'next', maxTraversals: 5 },
  ];
  flow.draft.maxSteps = 20; flow.draft.maxTokens = 400000; flow.draft.maxMinutes = 20;
  flow.versions = [{ id: 'v1', number: 1, createdAt: 1, graph: structuredClone(flow.draft) }];
  project.workflows = [flow];
  project.tasks = [{ id: 'task', title: 'Long acceptance',
    goal: 'Original request says perform all work. ORIGINAL_EVIDENCE: alpha-42 must remain retrievable.',
    acceptance: 'Use the latest correction, retain ORIGINAL_EVIDENCE, and do not repeat completed side effects.',
    entries: [], status: 'ready', createdAt: 1 }];
  await runtime.update('p', target => Object.assign(target, project));
  const runId = await runtime.createRun('p', 'task', flow.id, 'v1', config);
  fs.writeFileSync(path.join(root, 'run-id'), runId, 'utf8');
  return runId;
}

async function main() {
  const runtime = new TeamRuntime(); configure(runtime); await runtime.load();
  if (mode === 'first') {
    const runId = await setup(runtime);
    await runtime.start('p', runId);
    const gate = runtime.project('p').runs.find(r => r.id === runId);
    if (gate.status !== 'waiting_user' || gate.pendingApproval?.nodeId !== 'correction-gate') throw new Error('initial checkpoint did not reach correction gate');
    // The correction is appended after real work completed in this same run,
    // then the human gate explicitly releases the corrected continuation.
    await runtime.update('p', p => p.tasks[0].entries.push({ id: 'correction', at: Date.now(), author: '你 → 所有成员', kind: 'instruction',
      text: '用户更正：不要执行原计划中的额外动作，只保留证据并完成已明确允许的两项本机记录。' }));
    await runtime.approve('p', runId, true);
    await runtime.start('p', runId);
    throw new Error('first process unexpectedly completed');
  }

  const runId = fs.readFileSync(path.join(root, 'run-id'), 'utf8');
  const recovered = runtime.project('p').runs.find(r => r.id === runId);
  const result = { recoveredStatus: recovered.status, recoveryEvents: recovered.events.filter(e => e.kind === 'recovery').length };
  try { await runtime.start('p', runId); } catch (error) { result.claimError = String(error); }

  await runtime.resolveUncertain('p', runId, 'retry', '已检查本机记录：中断操作没有完成记录，明确进入受保护重试');
  await runtime.start('p', runId);
  let run = runtime.project('p').runs.find(r => r.id === runId);
  result.firstRetryStatus = run.status;
  result.firstRetryUncertainCallId = [...run.attempts].reverse().find(a => a.state?.uncertainCallId)?.state?.uncertainCallId;

  await runtime.resolveUncertain('p', runId, 'retry', '工具账本确认原调用仅开始未完成，明确允许再次执行该操作');
  await runtime.start('p', runId);
  run = runtime.project('p').runs.find(r => r.id === runId);
  result.beforeApprovalStatus = run.status;
  result.beforeApprovalNode = run.pendingApproval?.nodeId;
  result.beforeApprovalQueue = run.approvalQueue;
  result.attemptsBeforeApproval = run.attempts.map(a => ({ nodeId: a.nodeId, status: a.status, outcome: a.outcome, resolution: a.resolution }));
  await runtime.approve('p', runId, true);
  run = runtime.project('p').runs.find(r => r.id === runId);
  const states = run.attempts.flatMap(a => Object.values(a.memberStates || {}));
  result.finalStatus = run.status;
  result.finalPendingNode = run.pendingApproval?.nodeId;
  result.finalQueue = run.queue;
  result.compactions = Math.max(0, ...states.map(s => s.compactions?.length || 0));
  result.durableOriginalEvidence = states.some(s => [...(s.contextArchive || []), ...(s.working || [])].some(m => String(m.content).includes('ORIGINAL_EVIDENCE')));
  result.requestProfiles = [...new Set(states.flatMap(s => (s.requestStats || []).map(stat => `${stat.profileId}:${stat.model}`)))];
  result.routeLog = run.attempts.flatMap(a => a.routeLog || []).map(x => ({ profileId: x.profileId, model: x.model, status: x.status }));
  result.tokens = run.tokens;
  result.verifications = run.events.filter(e => e.kind === 'verified').map(e => e.text);
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf8');
}

main().then(() => process.exit(0)).catch(error => { console.error(error?.stack || error); process.exit(1); });
