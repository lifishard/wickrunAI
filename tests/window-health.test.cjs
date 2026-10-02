const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const health = require('../electron/window-health.cjs');

function fakeWindow(probe) {
  const win = new EventEmitter(), wc = new EventEmitter();
  Object.assign(wc, { reloads: 0, invalidations: 0, isDestroyed: () => false, reload() { this.reloads++; }, invalidate() { this.invalidations++; }, executeJavaScript: () => probe() });
  Object.assign(win, { webContents: wc, isDestroyed: () => false });
  return win;
}

test('occlusion tracking is disabled only on Windows and merges existing features', () => {
  const switches = { 'disable-features': 'Foo' };
  const app = { commandLine: { getSwitchValue: k => switches[k] ?? '', appendSwitch: (k, v) => { switches[k] = v; } } };
  assert.equal(health.configureCompositing(app, 'linux'), false);
  assert.equal(switches['disable-features'], 'Foo');
  assert.equal(health.configureCompositing(app, 'win32'), true);
  assert.equal(switches['disable-features'], 'Foo,CalculateNativeWinOcclusion');
});

test('refocus repaints; an empty page reloads, a busy page does not', async () => {
  let clock = 100000, answer = 3;
  const win = fakeWindow(() => answer === 'hang' ? new Promise(() => {}) : Promise.resolve(answer));
  const lines = [];
  const watch = health.watchWindow(win, { log: l => lines.push(l), now: () => clock, probeTimeoutMs: 20, settleMs: 1000 });
  clock += 5000;
  await watch.check('focus');
  assert.equal(win.webContents.invalidations, 1);
  assert.equal(win.webContents.reloads, 0);
  answer = 'hang';
  await watch.check('focus');
  assert.equal(win.webContents.reloads, 0);
  assert.match(lines.at(-1), /probe timeout/);
  answer = 0;
  await watch.check('focus');
  assert.equal(win.webContents.reloads, 1);
  // A reload loop is prevented.
  win.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 });
  assert.equal(win.webContents.reloads, 1);
  clock += 20000;
  win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.equal(win.webContents.reloads, 2);
  win.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  assert.equal(win.webContents.reloads, 2);
});

test('window events are written to a capped log file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anyai-window-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = health.createLog(dir, { maxBytes: 60 });
  log('first event line that is long enough'); log('second event line that rotates');
  assert.ok(fs.existsSync(path.join(dir, 'window.log')));
  assert.ok(fs.existsSync(path.join(dir, 'window.log.1')));
});
