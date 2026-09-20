const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const { createRunStore } = require('../electron/run-store.cjs');

const root = path.resolve(__dirname, '..');
const file = (name) => path.resolve(root, name);
const profile = { id: 'lifecycle', baseUrl: 'http://lifecycle.test/v1', name: 'lifecycle', hasSecret: false, extraHeaders: {}, createdAt: 0 };

function response(events, text = '', calls = []) {
  events.onContent(text);
  events.onToolCalls(calls);
  events.onStop({ reason: calls.length ? 'tool_calls' : 'stop', droppedCalls: 0 });
  events.onUsage({ prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 });
  events.onDone();
}

function call(id, name, args) {
  return { id, name, arguments: JSON.stringify(args) };
}

function history() {
  const goal = {
    id: 'goal', role: 'user', createdAt: 1,
    content: '原始目标：处理资料，并在后续更正后只交付允许的说明。',
    attachments: [{ id: 'brief', kind: 'text', name: 'brief.txt', text: 'ORIGINAL_EVIDENCE: 原始附件证据，只能通过来源 ID 取回。' }],
  };
  const correction = {
    id: 'correction', role: 'user', createdAt: 2,
    content: '用户更正：不要写入原文件，改为只解释已读取的证据。',
  };
  const messages = [goal, correction];
  for (let i = 0; i < 10; i++) {
    const readCall = { id: `history-call-${i}`, name: 'read_file', arguments: JSON.stringify({ path: `history-${i}.txt` }) };
    messages.push({ id: `history-assistant-${i}`, role: 'assistant', createdAt: 10 + i * 2,
      content: `历史读取 ${i}；` + '保留原始上下文。'.repeat(700), toolCalls: [readCall] });
    messages.push({ id: `history-tool-${i}`, role: 'tool', createdAt: 11 + i * 2,
      toolCallId: readCall.id, toolName: 'read_file', content: `历史证据 ${i}；` + '可检索资料。'.repeat(700) });
  }
  return messages;
}

function config(local, model) {
  const cfg = local(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(cfg, {
    model,
    toolsEnabled: true,
    enabledTools: ['read_file', 'write_file'],
    approvalMode: 'all',
    maxToolRounds: 8,
    runtime: {
      ...cfg.runtime,
      contextTokens: 22000,
      contextMode: 'manual',
      maxTokens: 100000,
      maxMinutes: 1,
      semanticCompression: true,
    },
  });
  return cfg;
}

function compactResponse(init, events, stage) {
  const payload = JSON.parse(init.body.messages.at(-1).content);
  const source = payload.source ?? [];
  assert.ok(source.length > 0, 'compaction request should carry source messages');
  const sourceId = source.at(-1).id;
  response(events, JSON.stringify({
    facts: [{ text: `阶段 ${stage} 的可核对历史已保留`, sources: [sourceId] }],
    decisions: [],
    unresolved: [{ text: '仍需遵守最新更正并核对原始证据', sources: [sourceId] }],
    nextSteps: ['继续使用已有证据'],
  }));
}

/** Run the real agent loop with only a deterministic transport boundary. */
function runStage({ dir, stage, model, resume, history: runHistory, compactBeforeRun = false, resolveUncertain, previousModel }) {
  const activeProfile = { ...profile, id: `provider-${stage}`, baseUrl: `http://provider-${stage}.test/v1` };
  let serial = 0;
  let finish;
  let settled = false;
  const finished = new Promise((resolve) => { finish = resolve; });
  const log = { requests: [], tools: [], states: [], paused: 0, done: 0, error: undefined };
  let agentRequests = 0;
  const transport = {
    chat: async (init, events) => {
      log.requests.push(init);
      if (init.purpose === 'compaction') {
        compactResponse(init, events, stage);
      } else if (stage === 1) {
        agentRequests++;
        if (agentRequests === 1) {
          response(events, '先记录当前要求并完成一个已确认的安全写入。', [
            call('record-requirement', 'update_requirements', {
              requirements: [{
                id: 'latest-correction',
                title: '只解释，不写入原文件',
                sourceId: 'correction',
                sourceQuote: '不要写入原文件',
                check: { kind: 'answer_contains', contains: ['不要写入原文件'] },
              }],
            }),
            call('write-complete', 'write_file', { path: 'C:/safe/explanation.txt', content: 'confirmed safe output' }),
          ]);
        } else {
          response(events, '执行现场需要核实。', [
            call('write-unknown', 'write_file', { path: 'C:/pending/unknown.txt', content: 'effect may have happened' }),
          ]);
        }
      } else {
        agentRequests++;
        if (agentRequests === 1) {
          const body = JSON.stringify(init.body);
          assert.match(body, /不要写入原文件/, 'latest negated correction must be in the switched-model prompt');
          assert.match(body, /read_context\(id=goal\)/, 'archived original source must have an explicit retrieval reference');
          response(events, '先读取原始证据。', [call('read-original', 'read_context', { id: 'goal', offset: 0, limit: 12000 })]);
        } else {
          const body = JSON.stringify(init.body);
          assert.match(body, /ORIGINAL_EVIDENCE/, 'the original archived evidence must be returned before completion');
          assert.match(body, /不要写入原文件/, 'the correction must remain active after evidence retrieval');
          response(events, '遵循最新要求：不要写入原文件；ORIGINAL_EVIDENCE 已读取并核对。');
        }
      }
    },
    callTool: async (name, args) => {
      log.tools.push({ name, args: structuredClone(args) });
      if (name === 'write_file' && args.path === 'C:/safe/explanation.txt') {
        return {
          ok: true,
          content: 'safe write committed',
          resultRef: 'safe-result',
          files: [{ path: args.path, name: 'explanation.txt', size: 21, direction: 'output', verifiedAt: Date.now() }],
        };
      }
      if (name === 'write_file' && args.path === 'C:/pending/unknown.txt') {
        return { ok: false, content: '', error: '执行已开始但结果未知', uncertain: true };
      }
      if (name === 'read_file') return { ok: true, content: 'safe write committed' };
      return { ok: true, content: '' };
    },
    abort: async () => {},
  };
  const local = loader({
    [file('src/lib/transport.ts')]: { getTransport: () => transport },
    [file('src/lib/store.ts')]: { uid: () => `lifecycle-${++serial}` },
  });
  const cfg = config(local, model);
  const question = runHistory.find((message) => message.role === 'user') ?? { id: 'goal', role: 'user', content: 'task', createdAt: 1 };
  const persist = async (state) => {
    if (!state) return;
    const checkpoint = structuredClone(state);
    log.states.push(checkpoint);
    log.latest = checkpoint;
    const store = createRunStore(dir);
    store.save({ id: checkpoint.runId || `lifecycle-${stage}`, conversationId: 'lifecycle-conversation', answerId: 'lifecycle-answer',
      question, config: cfg, keyProfileId: activeProfile.id, title: 'lifecycle', state: checkpoint });
  };
  const args = {
    requestId: `lifecycle-stage-${stage}`,
    profile: activeProfile,
    apiKey: 'test-only',
    config: cfg,
    history: runHistory,
    resume,
    previousModel,
    compactBeforeRun,
    resolveUncertain,
    toolCtx: () => ({ workspaceRoots: [] }),
    effortMappings: [],
    extraSystem: '',
    timeoutMs: 1000,
    canRunHostTools: true,
    autoRetry: 0,
    confirm: async () => true,
    grantAccess: async () => ({ ok: true, content: '' }),
    events: {
      onContentDelta() {}, onReasoningDelta() {}, onStep() {}, onSources() {}, onUsage() {}, onRound() {}, onNotice() {}, onStopReason() {},
      onRunState: persist,
      onPaused(reason) { log.paused++; log.reason = reason; if (!settled) { settled = true; finish(); } },
      onDone() { log.done++; if (!settled) { settled = true; finish(); } },
      onError(message) { log.error = message; if (!settled) { settled = true; finish(); } },
    },
  };
  const handle = local(file('src/lib/agent.ts')).runAgent(args);
  return { ...log, log, finished, handle, local, cfg };
}

test('runAgent lifecycle preserves corrections, semantic compactions, durable evidence, and safe replay across a model switch', async (t) => {
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tempRoot, 'wickrun-context-lifecycle-'));
  t.after(() => {
    assert.equal(path.dirname(dir), tempRoot);
    assert.ok(path.basename(dir).startsWith('wickrun-context-lifecycle-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const fullHistory = history();
  const first = runStage({ dir, stage: 1, model: 'model-a', history: fullHistory, compactBeforeRun: true });
  await first.finished;
  assert.equal(first.log.error, undefined);
  assert.equal(first.log.paused, 1);
  assert.equal(first.log.done, 0);
  const paused = first.log.latest;
  assert.equal(paused.status, 'paused');
  assert.equal(paused.phase, 'tools');
  assert.equal(paused.uncertainCallId, 'write-unknown');
  assert.equal(paused.pendingCalls[0].id, 'write-unknown');
  assert.ok(paused.compactions.length >= 1, 'first run must perform semantic compaction');
  assert.equal(first.log.tools.filter((item) => item.name === 'write_file' && item.args.path === 'C:/safe/explanation.txt').length, 1);
  assert.equal(first.log.tools.filter((item) => item.name === 'write_file' && item.args.path === 'C:/pending/unknown.txt').length, 1);

  const reloadedStore = createRunStore(dir);
  const durableRecord = reloadedStore.list()[0];
  assert.ok(durableRecord, 'paused state must be present in the durable store');
  const reloaded = JSON.parse(JSON.stringify(durableRecord.state));

  // Simulate the normal archive handoff: the first source is durable, while
  // the active working window retains only the correction and later work.
  const original = reloaded.working.find((message) => message.id === 'goal');
  assert.ok(original);
  reloaded.contextArchive = [...(reloaded.contextArchive ?? []), original];
  reloaded.working = reloaded.working.filter((message) => message.id !== 'goal');
  for (const compaction of reloaded.compactions ?? []) compaction.throughIndex -= 1;

  const second = runStage({ dir, stage: 2, model: 'model-b', history: fullHistory.slice(0, 2), resume: reloaded,
    compactBeforeRun: true, resolveUncertain: 'skip', previousModel: 'model-a' });
  await second.finished;
  assert.equal(second.log.error, undefined);
  assert.equal(second.log.paused, 0);
  assert.equal(second.log.done, 1);

  const completed = second.log.latest;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.handoff.fromModel, 'model-a');
  assert.equal(completed.handoff.toModel, 'model-b');
  assert.ok(completed.requestStats.some(stat => stat.profileId === 'provider-1' && stat.model === 'model-a'));
  assert.ok(completed.requestStats.some(stat => stat.profileId === 'provider-2' && stat.model === 'model-b'));
  assert.ok(completed.compactions.length >= 2, `expected at least two semantic compactions, got ${completed.compactions.length}`);
  assert.ok(completed.compactions.every((item) => item.strategy === 'semantic'));
  assert.ok(completed.compactions[1].throughIndex > completed.compactions[0].throughIndex);

  const requirement = completed.requirements.find((item) => item.id === 'latest-correction');
  assert.ok(requirement);
  assert.equal(requirement.revision, 1);
  assert.equal(requirement.sourceId, 'correction');
  assert.equal(requirement.sourceQuote, '不要写入原文件');

  const toolMessages = completed.working.filter((message) => message.role === 'tool');
  const originalRead = toolMessages.find((message) => message.toolCallId === 'read-original');
  assert.ok(originalRead, 'the continuation should execute read_context');
  assert.match(originalRead.content, /ORIGINAL_EVIDENCE/);

  const allTools = [...first.log.tools, ...second.log.tools];
  assert.equal(allTools.filter((item) => item.name === 'write_file' && item.args.path === 'C:/safe/explanation.txt').length, 1,
    'a completed write must not replay after reload');
  assert.equal(allTools.filter((item) => item.name === 'write_file' && item.args.path === 'C:/pending/unknown.txt').length, 1,
    'an unknown write may be attempted once, but must not be replayed by skip');
  assert.equal(second.log.tools.filter((item) => item.name === 'write_file').length, 0,
    'resolveUncertain=skip must stop unsafe replay');

  const contract = second.local(file('src/lib/task-contract.ts')).taskContractFromState(completed);
  assert.equal(contract.sources[0].id, 'goal');
  assert.ok(contract.sources.some((source) => source.id === 'correction'));
  assert.equal(contract.summary.semanticStatus, 'unverifiable');
  assert.match(contract.limitations[0], /不能自动证明/);

  const finalStore = createRunStore(dir);
  assert.equal(finalStore.list()[0].state.status, 'completed');
});
