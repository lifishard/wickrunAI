const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { activateTaskNotification, createTaskNotifier, validateTaskNotification } = require('../electron/task-notifications.cjs');

class FakeNotification extends EventEmitter {
  static supported = true;
  static shown = [];
  static isSupported() { return this.supported; }
  constructor(options) { super(); this.options = options; this.closed = false; }
  show() { FakeNotification.shown.push(this); }
  close() { this.closed = true; this.emit('close'); }
}

function fixture(state = {}) {
  FakeNotification.supported = true;
  FakeNotification.shown = [];
  const windowState = { visible: true, focused: false, minimized: false, destroyed: false, ...state };
  const win = {
    isVisible: () => windowState.visible,
    isFocused: () => windowState.focused,
    isMinimized: () => windowState.minimized,
    isDestroyed: () => windowState.destroyed,
  };
  const clicks = [];
  const notifier = createTaskNotifier({ Notification: FakeNotification, getWindow: () => win, activateWindow: value => clicks.push(value) });
  const input = { id: 'event-1', conversationId: 'conversation-1', title: 'Needs attention', body: 'Please answer the question.', kind: 'question' };
  return { notifier, input, clicks, windowState };
}

test('validation accepts only bounded task notification payloads', () => {
  const valid = { id: 'event-1', conversationId: 'conversation-1', title: 'Line one\nline two', body: 'Message', kind: 'completed', silent: true };
  assert.deepEqual(validateTaskNotification(valid), { ...valid, title: 'Line one line two' });
  for (const invalid of [
    null,
    { ...valid, id: '' },
    { ...valid, conversationId: 'x'.repeat(161) },
    { ...valid, title: 'x'.repeat(121) },
    { ...valid, body: 'x'.repeat(601) },
    { ...valid, kind: 'running' },
    { ...valid, silent: 'false' },
    { ...valid, body: 'bad\u0000body' },
  ]) assert.equal(validateTaskNotification(invalid), null);
});

test('focused visible window suppresses notifications while background states deliver', () => {
  const focused = fixture({ focused: true });
  assert.equal(focused.notifier.notify(focused.input), false);
  assert.equal(FakeNotification.shown.length, 0);

  for (const state of [
    { focused: false },
    { visible: false, focused: true },
    { minimized: true, focused: true },
  ]) {
    const f = fixture(state);
    assert.equal(f.notifier.notify(f.input), true);
    assert.equal(FakeNotification.shown.length, 1);
  }
});

test('event ids are deduplicated and click activation keeps only routing fields', () => {
  const f = fixture();
  assert.equal(f.notifier.notify(f.input), true);
  assert.equal(f.notifier.notify({ ...f.input, title: 'Duplicate' }), false);
  assert.equal(FakeNotification.shown.length, 1);
  assert.deepEqual(FakeNotification.shown[0].options, { title: f.input.title, body: f.input.body, silent: false });
  FakeNotification.shown[0].emit('click');
  assert.deepEqual(f.clicks, [{ id: f.input.id, conversationId: f.input.conversationId, kind: f.input.kind }]);
});

test('click activation restores, shows and focuses before sending the route', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    isVisible: () => false,
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    webContents: {
      isDestroyed: () => false,
      send: (channel, value) => calls.push([channel, value]),
    },
  };
  const payload = { id: 'event-1', conversationId: 'conversation-1', kind: 'error' };
  assert.equal(activateTaskNotification(win, payload), true);
  assert.deepEqual(calls, [
    'restore',
    'show',
    'focus',
    ['snc:taskNotificationClick', payload],
  ]);
});

test('dedupe cache is bounded and failed delivery can be retried', () => {
  const f = fixture();
  for (let index = 0; index < 257; index += 1) {
    assert.equal(f.notifier.notify({ ...f.input, id: `event-${index}` }), true);
  }
  assert.equal(f.notifier.notify({ ...f.input, id: 'event-0' }), true);

  FakeNotification.supported = false;
  const retry = fixture();
  FakeNotification.supported = false;
  assert.equal(retry.notifier.notify(retry.input), false);
  FakeNotification.supported = true;
  assert.equal(retry.notifier.notify(retry.input), true);
});
