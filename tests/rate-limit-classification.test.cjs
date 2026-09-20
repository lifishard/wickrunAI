const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const load = loader();
const { classifyError } = load(path.resolve(__dirname, '../src/lib/errors.ts'));
const { createStreamConsumer } = load(path.resolve(__dirname, '../src/lib/sse.ts'));

const senseNovaTpm = 'inference exceeds tpm limit (code insufficient_quota)';

test('explicit minute-window signals override the generic insufficient_quota code', () => {
  const http = classifyError(senseNovaTpm, 429);
  assert.equal(http.kind, 'rate_limit');
  assert.equal(http.retryable, true);

  let sseMessage = '';
  const consumer = createStreamConsumer({
    onContent() {}, onReasoning() {}, onToolCallDelta() {}, onUsage() {},
    onError(message) { sseMessage = message; },
  });
  consumer.chunk(`data: ${JSON.stringify({ error: { message: senseNovaTpm } })}\n\n`);
  const statelessSse = classifyError(sseMessage, undefined);
  assert.equal(statelessSse.kind, 'rate_limit');
  assert.equal(statelessSse.retryable, true);

  const rpm = classifyError('RPM limit reached; retry after 1.5 seconds (code insufficient_quota)', 429);
  assert.equal(rpm.kind, 'rate_limit');
  assert.equal(rpm.retryable, true);
  assert.equal(rpm.retryAfterMs, 1500);
});

test('billing and unqualified quota failures stay non-retryable over HTTP and stateless SSE', () => {
  for (const [message, status] of [
    ['insufficient_quota', 429],
    ['insufficient_quota', undefined],
    ['daily rate limit exceeded (insufficient_quota)', 429],
    ['daily rate limit exceeded (insufficient_quota)', undefined],
    ['account balance exhausted', 429],
    ['account balance exhausted; RPM unavailable', undefined],
    [senseNovaTpm, 402],
  ]) {
    const info = classifyError(message, status);
    assert.equal(info.kind, 'quota', `${status ?? 'SSE'}: ${message}`);
    assert.equal(info.retryable, false);
  }
});

test('explicit authentication status is not hidden by rate-limit wording', () => {
  const info = classifyError('credential is rate limited', 401);
  assert.equal(info.kind, 'auth');
  assert.equal(info.retryable, false);
  assert.equal(classifyError('invalid key; account balance unavailable',403).kind,'auth');
});
