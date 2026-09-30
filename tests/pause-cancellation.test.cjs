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
});
