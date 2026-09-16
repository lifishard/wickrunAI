const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const root = path.resolve(__dirname, '..');
const file = (name) => path.resolve(root, name);

function makeConfig(local, toolsEnabled = true) {
  const cfg = local(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(cfg, {
    model: 'live-input-test',
    toolsEnabled,
    enabledTools: toolsEnabled ? ['read_file', 'write_file'] : [],
    approvalMode: 'all',
    maxToolRounds: 6,
    runtime: { contextTokens: 50000, maxMinutes: 1, maxTokens: 100000 },
  });
  return cfg;
}

function argsFor(local, transport, events, config, history = [{ id: 'goal', role: 'user', content: '完成这个任务', createdAt: 1 }], canRunHostTools = false) {
  return {
    requestId: 'live-input-run',
    profile: { id: 'test', baseUrl: 'http://localhost/v1', name: 'test', hasSecret: false, extraHeaders: {}, createdAt: 0 },
    apiKey: 'test-only',
    config,
    history,
    toolCtx: () => ({ workspaceRoots: [] }),
    effortMappings: [],
    extraSystem: '',
    timeoutMs: 1000,
    canRunHostTools,
    autoRetry: 0,
    confirm: async () => true,
    grantAccess: async () => ({ ok: true, content: '' }),
    events: {
      onContentDelta() {}, onReasoningDelta() {}, onSources() {}, onUsage() {}, onRound() {}, onNotice() {},
      onStopReason() {}, onStep() {}, onRunState: events.onRunState,
      onPaused: events.onPaused, onDone: events.onDone, onError: events.onError,
    },
  };
}

function fixture(makeTransport, configOptions = {}) {
  let serial = 0;
  const transport = makeTransport();
  const local = loader({
    [file('src/lib/transport.ts')]: { getTransport: () => transport },
    [file('src/lib/store.ts')]: { uid: () => `live-${++serial}` },
  });
  const states = [];
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const log = { states, requests: [], tools: [], paused: 0, done: 0, error: null };
  const events = {
    onRunState: (state) => { if (state) states.push(structuredClone(state)); },
    onPaused: (reason) => { log.paused++; log.reason = reason; finish(); },
    onDone: () => { log.done++; finish(); },
    onError: (message) => { log.error = message; finish(); },
  };
  const config = makeConfig(local, configOptions.toolsEnabled ?? true);
  const args = argsFor(local, transport, events, config, undefined, configOptions.canRunHostTools ?? false);
  return { local, transport, config, args, events, finished, log };
}

function questionCall(id = 'ask') {
  return {
    id,
    name: 'request_user_input',
    arguments: JSON.stringify({
      blocking: false,
      questions: [{ id: 'preference', question: '保留当前方案吗？', options: [{ label: '保留' }, { label: '调整' }] }],
    }),
  };
}

test('nonblocking question stays attached while the agent completes independent work', async () => {
  let requests = 0;
  let readCalls = 0;
  const f = fixture(() => ({
    chat: async (init, events) => {
      f.log.requests.push(init);
      requests++;
      if (requests === 1) {
        events.onContent('先询问偏好，同时读取资料');
        events.onToolCalls([
          questionCall(),
          { id: 'read-1', name: 'read_file', arguments: JSON.stringify({ path: 'notes.txt' }) },
        ]);
        events.onStop({ reason: 'tool_calls', droppedCalls: 0 });
      } else {
        assert.match(JSON.stringify(init.body), /独立资料已读取/);
        events.onContent('独立工作已完成，等待你的偏好。');
        events.onToolCalls([]);
        events.onStop({ reason: 'stop', droppedCalls: 0 });
      }
      events.onUsage({ total_tokens: 3 });
      events.onDone();
    },
    callTool: async (name) => {
      f.log.tools.push(name);
      if (name === 'read_file') { readCalls++; return { ok: true, content: '独立资料已读取' }; }
      return { ok: true, content: '' };
    },
    abort: async () => {},
  }), { canRunHostTools: true });
  // The transport callback needs the fixture after construction, so resolve the
  // circular reference only after the object has been created.
  f.log.requests = [];
  const handle = f.local(file('src/lib/agent.ts')).runAgent(f.args);
  await f.finished;

  assert.equal(handle.abort instanceof Function, true);
  assert.equal(f.log.paused, 1);
  assert.equal(f.log.done, 0);
  assert.equal(requests, 2);
  assert.equal(readCalls, 1);
  const state = f.log.states.at(-1);
  assert.equal(state.status, 'paused');
  assert.equal(state.waitKind, 'question');
  assert.equal(state.userQuestion.nonBlocking, true);
  assert.equal(state.userQuestion.request.questions[0].id, 'preference');
  assert.ok(state.steps.some((step) => step.name === 'read_file' && step.status === 'ok'));
  assert.match(state.content, /等待你的偏好/);
});

test('answerQuestion persists a draft and injects the validated answer at a safe request boundary', async () => {
  let requests = 0;
  let releaseSecond;
  const secondRequest = new Promise((resolve) => { releaseSecond = resolve; });
  let markSecondStarted;
  const secondStarted = new Promise((resolve) => { markSecondStarted = resolve; });
  let questionReady;
  let markQuestionReady;
  questionReady = new Promise((resolve) => { markQuestionReady = resolve; });
  const f = fixture(() => ({
    chat: async (init, events) => {
      f.log.requests.push(init);
      requests++;
      if (requests === 1) {
        events.onToolCalls([questionCall('ask-1')]);
        events.onStop({ reason: 'tool_calls', droppedCalls: 0 });
      } else if (requests === 2) {
        // Keep the active request alive while the user answers. The answer must
        // be saved without allowing a second agent attempt to overlap this one.
        markSecondStarted();
        await secondRequest;
        events.onContent('继续整理结果');
        events.onToolCalls([]);
        events.onStop({ reason: 'stop', droppedCalls: 0 });
      } else {
        assert.match(JSON.stringify(init.body), /选择：保留/);
        events.onContent('已按你的偏好完成。');
        events.onToolCalls([]);
        events.onStop({ reason: 'stop', droppedCalls: 0 });
      }
      events.onUsage({ total_tokens: 3 });
      events.onDone();
    },
    callTool: async () => ({ ok: true, content: '' }),
    abort: async () => {},
  }), { canRunHostTools: true });
  f.args.events.onRunState = (state) => {
    if (state?.userQuestion?.request.id === 'question-live-input-run-ask-1' || state?.userQuestion?.request.questions[0].id === 'preference') {
      markQuestionReady(state);
    }
    if (state) f.log.states.push(structuredClone(state));
  };
  const handle = f.local(file('src/lib/agent.ts')).runAgent(f.args);
  await questionReady;
  await secondStarted;
  await handle.questionDraft('question-live-input-run-ask-1', { preference: { selected: [], text: '先暂存这段说明' } });
  await handle.answerQuestion('question-live-input-run-ask-1', { preference: { selected: ['保留'], text: '' } });
  releaseSecond();
  await f.finished;

  assert.equal(f.log.error, null);
  assert.equal(f.log.paused, 0);
  assert.equal(f.log.done, 1);
  assert.equal(requests, 3);
  const completed = f.log.states.at(-1);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.userQuestion, undefined);
  assert.equal(completed.userQuestionHistory[0].answers.preference.selected[0], '保留');
  assert.ok(completed.supplementalInputs.some((input) => /选择：保留/.test(input.content)));
});

test('interrupt captures streamed output and queues a new input before stopping', async () => {
  let release;
  let streamStarted;
  const streamed = new Promise((resolve) => { streamStarted = resolve; });
  const f = fixture(() => ({
    chat: async (init, events) => {
      f.log.requests.push(init);
      events.onContent('已经输出一半');events.onReasoning('已返回的思考片段');
      streamStarted();
      await new Promise((resolve) => { release = () => {
        events.onStop({ reason: null, droppedCalls: 0 });
        events.onDone();
        resolve();
      }; });
    },
    callTool: async () => ({ ok: true, content: '' }),
    abort: async () => { release?.(); },
  }), { toolsEnabled: false });
  const handle = f.local(file('src/lib/agent.ts')).runAgent(f.args);
  await streamed;
  handle.interrupt({ id: 'new-input', role: 'user', content: '改为解释刚才的结果', createdAt: 2 });
  await f.finished;

  assert.equal(f.log.paused, 1);
  assert.equal(f.log.done, 0);
  assert.equal(f.log.requests.length, 1);
  const state = f.log.states.at(-1);
  assert.equal(state.status, 'paused');
  assert.equal(state.stoppedBy, 'user');
  assert.match(state.content, /已经输出一半/);
  assert.match(state.reasoning,/已返回的思考片段/);
  assert.match(state.working.at(-2).content,/中断前的部分回复.*\n已经输出一半/);
  assert.equal(state.working.at(-1).content, '改为解释刚才的结果');
});

test('interrupt during a tool leaves the in-flight cursor and replan input durable, ignoring the late tool result', async () => {
  let releaseTool;
  let toolStarted;
  const started = new Promise((resolve) => { toolStarted = resolve; });
  const f = fixture(() => ({
    chat: async (init, events) => {
      f.log.requests.push(init);
      events.onToolCalls([{ id: 'write-1', name: 'write_file', arguments: JSON.stringify({ path: 'old.txt', content: 'old' }) }]);
      events.onStop({ reason: 'tool_calls', droppedCalls: 0 });
      events.onDone();
    },
    callTool: async (name) => {
      f.log.tools.push(name);
      toolStarted();
      await new Promise((resolve) => { releaseTool = resolve; });
      return { ok: true, content: 'late write result' };
    },
    abort: async () => {},
  }), { canRunHostTools: true });
  const handle = f.local(file('src/lib/agent.ts')).runAgent(f.args);
  await started;
  handle.interrupt({ id: 'replan-input', role: 'user', content: '不要写旧文件，改为说明原因', createdAt: 3 });
  await f.finished;
  releaseTool();

  assert.equal(f.log.paused, 1);
  assert.equal(f.log.requests.length, 1);
  const state = f.log.states.at(-1);
  assert.equal(state.status, 'paused');
  assert.equal(state.phase, 'tools');
  assert.equal(state.replanPending, true);
  assert.equal(state.pendingInputMessages[0].content, '不要写旧文件，改为说明原因');
  assert.equal(state.pendingCalls[0].id, 'write-1');
  assert.equal(state.toolCursor, 0);
  assert.equal(state.steps[0].status, 'running');
  assert.doesNotMatch(JSON.stringify(state), /late write result/);
});


test('a direct correction replaces stale completion demands while preserving previous context',()=>{
  const local=loader();
  const {addRunInput}=local(file('src/lib/delivery.ts'));
  const {taskSeed}=local(file('src/lib/harness.ts'));
  const cfg={toolsEnabled:true};const original={id:'old-goal',role:'user',content:'修改文件并测试',createdAt:1};
  const old={working:[original],steps:[],harness:taskSeed([original],cfg)};
  assert.equal(old.harness.action,true);
  const next=addRunInput(old,{id:'correction',role:'user',content:'解释原因即可，不要再修改文件',createdAt:2});
  const updated=taskSeed(next.working,cfg,next.harness);
  assert.equal(updated.sourceId,'correction');assert.equal(updated.action,false);
  assert.equal(next.working[0].content,original.content);
});
