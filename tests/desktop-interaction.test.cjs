const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const { createBackgroundWindow } = require('../electron/background-window.cjs');
const { isCompositionKey } = loader()(path.resolve(__dirname, '../src/lib/composer-keyboard.ts'));

test('IME confirmation is ignored while the very next ordinary Enter remains available', () => {
  assert.equal(isCompositionKey({ isComposing: true }, false), true);
  assert.equal(isCompositionKey({ isComposing: false }, true), true);
  assert.equal(isCompositionKey({ keyCode: 229 }, false), true);
  assert.equal(isCompositionKey({ isComposing: false, keyCode: 13 }, false), false);
  assert.equal(isCompositionKey({ keyCode: 13 }, false), false);
});

function fixture({ emptyIcon = false, platform = 'win32' } = {}) {
  const state = { visible: true, minimized: false, destroyed: false, focused: false, prevented: 0, quits: 0, creates: 0 };
  const win = { isDestroyed: () => state.destroyed, isMinimized: () => state.minimized,
    hide: () => { state.visible = false; }, minimize: () => { state.minimized = true; },
    restore: () => { state.minimized = false; }, show: () => { state.visible = true; }, focus: () => { state.focused = true; } };
  let tray;
  class FakeTray extends EventEmitter {
    constructor() { super(); tray = this; }
    setToolTip() {} setContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
    displayBalloon() { this.balloons = (this.balloons || 0) + 1; }
  }
  const bg = createBackgroundWindow({ app: { quit: () => { state.quits++; } }, Tray: FakeTray,
    Menu: { buildFromTemplate: menu => menu }, nativeImage: { createFromPath: () => ({ isEmpty: () => emptyIcon, resize: () => ({}) }) },
    iconPath: 'fixture.png', getWindow: () => win, createWindow: () => { state.creates++; }, platform, onError() {} });
  bg.install();
  return { bg, state, get tray() { return tray; }, close: () => bg.close({ preventDefault: () => { state.prevented++; } }, win) };
}

test('closing keeps the window alive; tray activation restores the same window; explicit quit remains available', () => {
  const f = fixture(); f.close();
  assert.equal(f.state.prevented, 1); assert.equal(f.state.visible, false); assert.equal(f.state.destroyed, false); assert.equal(f.state.quits, 0);
  f.tray.emit('click'); assert.equal(f.state.visible, true); assert.equal(f.state.focused, true); assert.equal(f.state.creates, 0);
  f.close(); assert.equal(f.tray.balloons, 1);
  f.tray.menu.at(-1).click(); assert.equal(f.state.quits, 1);
  f.bg.beginQuit(); f.close(); assert.equal(f.state.prevented, 2);
  f.bg.destroy(); assert.equal(f.tray.destroyed, true);
});

test('tray failure leaves a taskbar entry, and activation restores a minimized window', () => {
  const f = fixture({ emptyIcon: true }); f.close();
  assert.equal(f.state.visible, true); assert.equal(f.state.minimized, true); assert.equal(f.state.quits, 0);
  f.bg.show(); assert.equal(f.state.minimized, false); assert.equal(f.state.focused, true);
});

test('macOS retains a dock-restorable window; shutdown does not hide it again', () => {
  const f = fixture({ emptyIcon: true, platform: 'darwin' }); f.close();
  assert.equal(f.state.visible, false); f.bg.show(); assert.equal(f.state.visible, true);
  f.bg.beginQuit(); f.close(); assert.equal(f.state.prevented, 1);
});
