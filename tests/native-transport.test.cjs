'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const source = process.env.WICKRUN_NATIVE_TRANSPORT_SOURCE || path.resolve(__dirname, '../src/lib/transport.ts');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const noop = () => {};

function fixture(options = {}) {
  const listeners = new Set(), requests = [], aborts = [];
  let removed = 0;
  const emit = event => { for (const listener of listeners) listener(event); };
  const plugin = {
    async addListener(name, callback) {
      assert.equal(name, 'sncHttpEvent');
      listeners.add(callback);
      await options.listen?.();
      return { async remove() { removed += 1; listeners.delete(callback); } };
    },
    async request(input) {
      requests.push(input);
      return options.request ? options.request(input, emit) : { status: 200, body: '' };
    },
    async abort(input) {
      aborts.push(input);
      await options.abort?.(input, emit);
    },
  };
  const module = loader({
    '@capacitor/core': {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
      registerPlugin(name) { assert.equal(name, 'SncHttp'); return plugin; },
    },
    '@capacitor/preferences': { Preferences: {} },
    './native-secrets': { nativeSecretGet: async () => null, nativeSecretSet: async () => {}, nativeSecretDelete: async () => {} },
    './i18n': { tr: text => text },
    './wiretap': { beginExchange: noop, recordRaw: noop, recordResponse: noop, endExchange: noop },
    // Exercise the real public transport wrapper and SSE parser; only the clock/quota boundary is inert.
    './pacer': {
      isRateLimited: () => false, noteRateLimit: noop, noteSuccess: noop,
      reserveTokens: noop, reconcileTokens: noop, paced: async (_key, action) => action(),
      waitForTokens: () => 0, waitForQuota: () => 0, consumeQuota: noop, noteQuotaHeaders: noop,
      waitCancellable: async () => {}, abortError: () => new Error('Request aborted'),
    },
  })(source);
  const transport = module.getTransport();
  const result = { contents: [], errors: [], done: 0, stops: [] };
  const handlers = {
    onContent: content => result.contents.push(content), onReasoning: noop,
    onUsage: noop, onToolCalls: noop, onStop: stop => result.stops.push(stop),
    onError: (message, status) => result.errors.push({ message, status }),
    onDone: () => { result.done += 1; },
  };
  const input = (extra = {}) => ({ requestId: 'chat-request', url: 'https://api.example.test/v1/chat/completions',
    headers: { Authorization: 'Bearer synthetic-test-value' }, body: { messages: [] }, stream: false, timeoutMs: 1000, ...extra });
  return { transport, result, handlers, input, emit, requests, aborts, removed: () => removed };
}

test('stopping while native listener registration is pending never sends the request', async () => {
  const entered = deferred(), ready = deferred();
  const f = fixture({ listen: async () => { entered.resolve(); await ready.promise; } });
  const chat = f.transport.chat(f.input({ stream: true }), f.handlers);
  await entered.promise;
  await f.transport.abort('chat-request');
  ready.resolve();
  await chat;
  assert.equal(f.requests.length, 0);
  assert.equal(f.aborts.length, 0, 'no native request exists yet');
  assert.equal(f.result.done, 1);
  assert.deepEqual(f.result.errors, []);
  assert.equal(f.removed(), 1);
});

test('an empty successful nonstream response still completes and removes the listener', async () => {
  const f = fixture();
  await f.transport.chat(f.input(), f.handlers);
  assert.equal(f.result.done, 1);
  assert.equal(f.result.contents.join(''), '');
  assert.deepEqual(f.result.errors, []);
  assert.equal(f.removed(), 1);
});

test('native chat reports HTTP redirects and errors without claiming successful completion', async () => {
  for (const status of [0, 199, 301, 307, 401, 429, 500]) {
    const f = fixture({ request: async () => ({ status, body: JSON.stringify({ error: { message: 'Upstream refused this request' } }) }) });
    await f.transport.chat(f.input({ stream: true }), f.handlers);
    assert.equal(f.result.done, 0, `HTTP ${status} must not complete as success`);
    assert.deepEqual(f.result.errors, [{ message: 'Upstream refused this request', status }]);
    assert.equal(f.removed(), 1);
  }
});

test('abort after dispatch preserves received text and completes once when native emits done plus status 499', async () => {
  const entered = deferred(), response = deferred();
  const f = fixture({
    request: async (input, emit) => {
      emit({ requestId: input.requestId, type: 'chunk', data: 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n' });
      entered.resolve();
      return response.promise;
    },
    abort: async ({ requestId }, emit) => {
      emit({ requestId, type: 'done', status: 499 });
      response.resolve({ status: 499 });
    },
  });
  const chat = f.transport.chat(f.input({ stream: true }), f.handlers);
  await entered.promise;
  await f.transport.abort('chat-request');
  await chat;
  assert.equal(f.result.contents.join(''), 'partial');
  assert.equal(f.result.done, 1);
  assert.deepEqual(f.result.errors, []);
  assert.deepEqual(f.aborts, [{ requestId: 'chat-request' }]);
  assert.equal(f.removed(), 1);
});

test('native invocation rejection reports one error, removes the listener and releases the request ID', async () => {
  let fail = true;
  const f = fixture({ request: async () => { if (fail) throw Error('Native connection failed'); return { status: 200, body: '' }; } });
  await f.transport.chat(f.input(), f.handlers);
  assert.deepEqual(f.result.errors, [{ message: 'Native connection failed', status: undefined }]);
  assert.equal(f.result.done, 0);
  fail = false;
  await f.transport.chat(f.input(), f.handlers);
  assert.equal(f.requests.length, 2);
  assert.equal(f.result.done, 1);
  assert.equal(f.removed(), 2);
});

test('concurrent native JSON queries use distinct IDs even within the same millisecond', async () => {
  const f = fixture({ request: async () => ({ status: 200, body: '{"data":[]}' }) });
  const originalNow = Date.now;
  Date.now = () => 1000;
  try {
    const results = await Promise.all(Array.from({ length: 32 }, () => f.transport.getJson('https://api.example.test/v1/models', {}, 1000)));
    assert.equal(results.length, 32);
    assert.equal(new Set(f.requests.map(request => request.requestId)).size, 32);
    assert(f.requests.every(request => request.method === 'GET' && request.stream === false));
  } finally { Date.now = originalNow; }
});

test('native JSON queries reject redirects and failed statuses rather than returning error objects', async () => {
  for (const status of [0, 199, 302, 308, 403, 500]) {
    const f = fixture({ request: async () => ({ status, body: '{"error":{"message":"Upstream error"}}' }) });
    await assert.rejects(f.transport.getJson('https://api.example.test/v1/models', {}, 1000), /Upstream error/);
  }
});
