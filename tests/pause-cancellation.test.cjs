const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const load = loader();
const root = path.resolve(__dirname, '..');
const { awaitAbortable } = load(path.join(root, 'src/lib/abortable.ts'));

test('an unresolved provider call stops waiting immediately and ignores its late result', async () => {
  const control = new AbortController();
  let resolveProvider;
  const provider = new Promise(resolve => { resolveProvider = resolve; });
  const waiting = awaitAbortable(provider, control.signal);
  control.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  resolveProvider('late answer');
  await provider;
  await assert.rejects(awaitAbortable(Promise.resolve('new answer'), control.signal), { name: 'AbortError' });
  await assert.rejects(awaitAbortable(Promise.reject(Error('late provider failure')), control.signal), { name: 'AbortError' });
});

test('transport cancellation settles without a chunk or native completion and drops late callbacks', async () => {
  const { withPacing } = load(path.join(root, 'src/lib/transport.ts'));
  const streams = new Map();
  const seen = [];
  const fake = withPacing({
    kind: 'test',
    chat(request, handlers) {
      return new Promise(resolve => { streams.set(request.requestId, { handlers, resolve }); });
    },
    async abort() {},
  });
  const request = fake.chat({ requestId: 'pause-no-chunk', url: 'https://example.test/chat', headers: {}, body: {}, stream: true, timeoutMs: 120000 }, {
    onContent: text => seen.push(text), onReasoning: text => seen.push(text), onToolCalls() {},
    onUsage() {}, onStop() {}, onDone: () => seen.push('done'), onError: error => seen.push(error),
  });
  for (let i = 0; i < 20 && !streams.has('pause-no-chunk'); i++) await new Promise(setImmediate);
  const first = streams.get('pause-no-chunk');
  assert.ok(first, 'provider request dispatched');
  await fake.abort('pause-no-chunk');
  await Promise.race([request, new Promise((_, reject) => setTimeout(() => reject(Error('cancel did not settle')), 200))]);
  const next = fake.chat({ requestId: 'next-run', url: 'https://example.test/chat', headers: {}, body: {}, stream: true, timeoutMs: 120000, paceKey: 'pause-next-run' }, {
    onContent: text => seen.push(text), onReasoning: text => seen.push(text), onToolCalls() {},
    onUsage() {}, onDone: () => seen.push('done'), onError: error => seen.push(error),
  });
  for (let i = 0; i < 20 && !streams.has('next-run'); i++) await new Promise(setImmediate);
  const second = streams.get('next-run');
  assert.ok(second, 'next request dispatched');
  first.handlers.onContent('late'); first.handlers.onReasoning('late thought'); first.handlers.onDone();
  first.resolve();
  second.handlers.onContent('new answer'); second.handlers.onDone(); second.resolve();
  await next;
  assert.deepEqual(seen, ['new answer', 'done']);
});

test('recovered orphan spinner becomes a paused response with partial text intact', () => {
  const { pauseOrphanedPending } = load(path.join(root, 'src/lib/runs.ts'));
  const original = [{ id: 'chat', messages: [{ id: 'answer', role: 'assistant', content: 'partial', reasoning: 'thinking', pending: true,
    runState: { status: 'running', working: [], at: 1 } }] }];
  const [conversation] = pauseOrphanedPending(original);
  assert.equal(conversation.messages[0].pending, false);
  assert.equal(conversation.messages[0].content, 'partial');
  assert.equal(conversation.messages[0].reasoning, 'thinking');
  assert.equal(conversation.messages[0].runState.status, 'paused');
  assert.equal(original[0].messages[0].pending, true);
  const [completed] = pauseOrphanedPending([{ id: 'done', messages: [{ id: 'a', role: 'assistant', content: 'finished', pending: true,
    runState: { status: 'completed', working: [], at: 2 } }] }]);
  assert.equal(completed.messages[0].pending, false);
  assert.equal(completed.messages[0].runState, undefined);
  assert.equal(completed.messages[0].content, 'finished');
});

test('pausing during the final checkpoint cannot turn into a completed run', async () => {
  let reachedCompletion, releaseCompletion;
  const completionReached = new Promise(resolve => { reachedCompletion = resolve; });
  const completionSave = new Promise(resolve => { releaseCompletion = resolve; });
  let finish, done = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const fakeTransport = { chat: async (_request, handlers) => {
    handlers.onContent('partial answer'); handlers.onToolCalls([]); handlers.onStop({ reason: 'stop', droppedCalls: 0 }); handlers.onDone();
  }, abort: async () => {}, callTool: async () => ({ ok: true, content: '' }) };
  const local = loader({ [path.join(root, 'src/lib/transport.ts')]: { getTransport: () => fakeTransport },
    [path.join(root, 'src/lib/store.ts')]: { uid: () => 'test-id' } });
  const config = local(path.join(root, 'src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(config, { model: 'mock', toolsEnabled: false, runtime: { contextTokens: 50000, maxMinutes: 1, maxTokens: 100000 } });
  const states = [];
  const handle = local(path.join(root, 'src/lib/agent.ts')).runAgent({
    requestId: 'completion-race', profile: { id: 'test', baseUrl: 'http://localhost/v1' }, apiKey: 'test', config,
    history: [{ id: 'question', role: 'user', content: 'Say hello', createdAt: 1 }],
    toolCtx: () => ({ workspaceRoots: [] }), effortMappings: [], extraSystem: '', timeoutMs: 1000,
    canRunHostTools: false, autoRetry: 0, confirm: async () => true, grantAccess: async () => ({ ok: true, content: '' }),
    events: { onContentDelta() {}, onReasoningDelta() {}, onSources() {}, onUsage() {}, onRound() {}, onNotice() {}, onStopReason() {}, onStep() {},
      async onRunState(state) {
        if (state?.status === 'completed') { reachedCompletion(); await completionSave; }
        if (state) states.push(structuredClone(state));
      },
      onDone() { done++; finish(); }, onPaused() { finish(); }, onError() { finish(); },
    },
  });
  await Promise.race([completionReached, new Promise((_, reject) => setTimeout(() => reject(Error('completion checkpoint not reached')), 2000))]);
  handle.abort(); releaseCompletion();
  await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(Error('pause did not settle')), 2000))]);
  assert.equal(done, 0);
  assert.equal(states.at(-1).status, 'paused');
});

test('pausing during output-card completion keeps the run paused', async () => {
  let reachedCompletion, releaseCompletion;
  const completionReached = new Promise(resolve => { reachedCompletion = resolve; });
  const completionSave = new Promise(resolve => { releaseCompletion = resolve; });
  let finish, done = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const fakeTransport = { chat: async (_request, handlers) => {
    handlers.onToolCalls([{ id: 'output-1', name: 'present_output', arguments: JSON.stringify({ text: 'Finished draft' }) }]);
    handlers.onStop({ reason: 'tool_calls', droppedCalls: 0 }); handlers.onDone();
  }, abort: async () => {}, callTool: async () => { throw Error('unexpected host tool'); } };
  const local = loader({ [path.join(root, 'src/lib/transport.ts')]: { getTransport: () => fakeTransport } });
  const config = local(path.join(root, 'src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(config, { model: 'mock', toolsEnabled: false, runtime: { contextTokens: 50000, maxMinutes: 1, maxTokens: 100000 } });
  const states = [];
  const handle = local(path.join(root, 'src/lib/agent.ts')).runAgent({
    requestId: 'output-race', profile: { id: 'test', baseUrl: 'http://localhost/v1' }, apiKey: 'test', config,
    history: [{ id: 'question', role: 'user', content: 'Write a greeting', createdAt: 1 }],
    toolCtx: () => ({ workspaceRoots: [] }), effortMappings: [], extraSystem: '', timeoutMs: 1000,
    canRunHostTools: false, autoRetry: 0, confirm: async () => true, grantAccess: async () => ({ ok: true, content: '' }),
    events: { onContentDelta() {}, onReasoningDelta() {}, onSources() {}, onUsage() {}, onRound() {}, onNotice() {}, onStopReason() {}, onStep() {},
      async onRunState(state) {
        if (state?.status === 'completed') { reachedCompletion(); await completionSave; }
        if (state) states.push(structuredClone(state));
      },
      onDone() { done++; finish(); }, onPaused() { finish(); }, onError() { finish(); },
    },
  });
  await Promise.race([completionReached, new Promise((_, reject) => setTimeout(() => reject(Error('output completion not reached')), 2000))]);
  handle.abort(); releaseCompletion();
  await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(Error('output pause did not settle')), 2000))]);
  assert.equal(done, 0);
  assert.equal(states.at(-1).status, 'paused');
  assert.equal(states.at(-1).content, 'Finished draft');
});

test('native client paused while saving completion keeps a resumable checkpoint', async () => {
  let reachedCompletion, releaseCompletion;
  const completionReached = new Promise(resolve => { reachedCompletion = resolve; });
  const completionSave = new Promise(resolve => { releaseCompletion = resolve; });
  let finish, done = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const bridge = { onClientEvent: () => () => {}, toolAbort: async () => {},
    conversationClientRun: async () => ({ status: 'completed', text: 'Hello from native client' }) };
  const local = loader({ [path.join(root, 'src/lib/transport.ts')]: { desktop: () => bridge },
    [path.join(root, 'src/lib/review-guard.ts')]: { reviewGuard: async () => null } });
  const config = local(path.join(root, 'src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(config, { model: 'native', toolsEnabled: false, client: { kind: 'codex', model: 'native' } });
  const states = [];
  const handle = local(path.join(root, 'src/lib/connected-agent.ts')).runConnectedAgent({
    requestId: 'native-race', profile: { id: 'native', baseUrl: '' }, apiKey: 'official-client', config,
    history: [{ id: 'q', role: 'user', content: 'Say hello', createdAt: 1 }],
    toolCtx: () => ({ workspaceRoots: [] }), extraSystem: '',
    events: { onContentReplace() {}, onContentDelta() {}, onReasoningDelta() {}, onStep() {}, onUsage() {}, onNotice() {}, onStopReason() {}, onSources() {}, onRound() {},
      async onRunState(state) {
        if (state?.status === 'completed') { reachedCompletion(); await completionSave; }
        if (state) states.push(structuredClone(state));
      },
      onDone() { done++; finish(); }, onPaused() { finish(); }, onError() { finish(); },
    },
  });
  await Promise.race([completionReached, new Promise((_, reject) => setTimeout(() => reject(Error('native completion checkpoint not reached')), 2000))]);
  handle.abort(); releaseCompletion();
  await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(Error('native pause did not settle')), 2000))]);
  assert.equal(done, 0);
  assert.equal(states.at(-1).status, 'paused');
});

test('Claude task created after Pause is cancelled when its IPC call finally returns', async () => {
  let createStarted, resolveCreate;
  const started = new Promise(resolve => { createStarted = resolve; });
  const created = new Promise(resolve => { resolveCreate = resolve; });
  const cancelled = [];
  let paused;
  const stopped = new Promise(resolve => { paused = resolve; });
  const bridge = { nativeAiCreate: () => { createStarted(); return created; },
    nativeAiCancel: async id => { cancelled.push(id); }, nativeAiState: async () => ({ connections: [], tasks: [] }) };
  const local = loader({ [path.join(root, 'src/lib/transport.ts')]: { desktop: () => bridge },
    [path.join(root, 'src/lib/review-guard.ts')]: { reviewGuard: async () => null } });
  const config = local(path.join(root, 'src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(config, { model: 'claude', toolsEnabled: false, client: { kind: 'claude-desktop', model: 'claude' } });
  const handle = local(path.join(root, 'src/lib/desktop-conversation.ts')).runDesktopConversation({
    requestId: 'claude-late', profile: { id: 'claude', baseUrl: '' }, apiKey: 'official-client', config,
    history: [{ id: 'q', role: 'user', content: 'Say hello', createdAt: 1 }],
    toolCtx: () => ({ workspaceRoots: [] }), extraSystem: '',
    events: { onRunState: async () => {}, onContentReplace() {}, onStep() {}, onNotice() {}, onDone() {}, onPaused: paused },
  });
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(Error('Claude creation not reached')), 2000))]);
  handle.abort();
  await Promise.race([stopped, new Promise((_, reject) => setTimeout(() => reject(Error('Claude pause did not settle')), 2000))]);
  resolveCreate({ task: { id: 'late-task', status: 'waiting' }, prompt: '' });
  await new Promise(setImmediate);
  assert.deepEqual(cancelled, ['late-task']);
});
