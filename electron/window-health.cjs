'use strict';
const fs = require('node:fs');
const path = require('node:path');

/*
 * Keeps the main window painted and alive.
 *
 * Reported on Windows: after another app covered the window (not minimized),
 * switching back showed an empty window until Ctrl+R. Two things can cause it:
 *  - Chromium's native window occlusion tracking marks a covered window as
 *    hidden and drops its frames; coming back, nothing repaints until the next
 *    change. Disabled on Windows, and the window is told to repaint whenever it
 *    regains focus or is shown.
 *  - The page itself is gone (renderer crash or out of memory). That is now
 *    logged and reloaded automatically; task state is checkpointed and resumes.
 * Events are written to logs/window.log in the data directory so a recurrence
 * can be diagnosed from the person's machine.
 */
function configureCompositing(app, platform = process.platform) {
  if (platform !== 'win32') return false;
  const existing = app.commandLine.getSwitchValue('disable-features');
  app.commandLine.appendSwitch('disable-features', [existing, 'CalculateNativeWinOcclusion'].filter(Boolean).join(','));
  return true;
}

function createLog(dir, { maxBytes = 512 * 1024, now = () => new Date() } = {}) {
  const file = path.join(dir, 'window.log');
  return (line) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      try { if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file + '.1'); } catch { /* first line */ }
      fs.appendFileSync(file, `${now().toISOString()} ${line}\n`);
    } catch { /* logging never breaks the window */ }
  };
}

const PROBE = 'document.readyState==="complete"?(document.getElementById("root")?.childElementCount??0):-1';

function watchWindow(win, { log = () => {}, now = Date.now, probeTimeoutMs = 4000, settleMs = 8000 } = {}) {
  const wc = win.webContents;
  let loadedAt = now(), lastReload = 0, probing = false;
  const alive = () => !win.isDestroyed() && !wc.isDestroyed();
  const reload = (why) => {
    if (now() - lastReload < 15000) { log(`reload skipped (${why}): reloaded moments ago`); return false; }
    lastReload = now(); log(`reload: ${why}`); wc.reload(); return true;
  };
  wc.on('did-finish-load', () => { loadedAt = now(); });
  wc.on('render-process-gone', (_event, details) => {
    log(`render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`);
    if (details?.reason !== 'clean-exit' && alive()) reload(`renderer ${details?.reason}`);
  });
  wc.on('unresponsive', () => log('renderer unresponsive'));
  wc.on('responsive', () => log('renderer responsive again'));

  async function check(trigger) {
    if (!alive()) return;
    wc.invalidate();
    // A busy renderer (a long task) answers late; never reload it for being busy.
    if (probing || now() - loadedAt < settleMs) return;
    probing = true;
    try {
      const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), probeTimeoutMs));
      const children = await Promise.race([wc.executeJavaScript(PROBE, true), timeout]);
      if (children === 0) reload(`empty page after ${trigger}`);
      else if (children === 'timeout') log(`probe timeout after ${trigger}`);
    } catch (error) { log(`probe failed after ${trigger}: ${error?.message ?? error}`); }
    finally { probing = false; }
  }
  for (const event of ['focus', 'show', 'restore']) win.on(event, () => { void check(event); });
  return { check };
}

function watchGpu(app, { log = () => {}, windows = () => [] } = {}) {
  app.on('child-process-gone', (_event, details) => {
    if (details?.type !== 'GPU') return;
    log(`gpu process gone reason=${details.reason} exitCode=${details.exitCode}`);
    for (const win of windows()) if (win && !win.isDestroyed()) win.webContents.invalidate();
  });
}

module.exports = { configureCompositing, createLog, watchWindow, watchGpu, PROBE };
