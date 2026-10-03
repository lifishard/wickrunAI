'use strict';

/** Keep the existing renderer and its task handles alive when the window closes. */
function createBackgroundWindow({ app, Tray, Menu, nativeImage, iconPath, getWindow, createWindow, platform = process.platform, onError = console.error }) {
  let tray = null;
  let quitting = false;
  let explained = false;
  function show() {
    if (quitting) return;
    const win = getWindow();
    if (!win || win.isDestroyed()) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  function install() {
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) throw Error('Tray icon unavailable');
      tray = new Tray(icon.resize({ width: platform === 'darwin' ? 18 : 24, height: platform === 'darwin' ? 18 : 24 }));
      tray.setToolTip('灯芯AI · 关闭窗口后继续在后台运行');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开灯芯AI', click: show },
        { type: 'separator' },
        // Mark the quit before anything else: a window closing during the quit
        // must not hide to the tray and say the app keeps running.
        { label: '退出灯芯AI', click: () => { quitting = true; app.quit(); } },
      ]));
      tray.on('click', show);
      tray.on('double-click', show);
    } catch (error) {
      tray?.destroy(); tray = null;
      onError('Background tray:', error.message);
    }
  }
  function close(event, win) {
    if (quitting) return;
    event.preventDefault();
    // Keep an accessible taskbar entry if this desktop cannot create a tray.
    if (tray || platform === 'darwin') win.hide();
    else win.minimize();
    if (!explained && platform === 'win32' && tray?.displayBalloon) {
      explained = true;
      tray.displayBalloon({ title: '灯芯AI 仍在后台运行', content: '任务会继续执行。点击托盘图标可返回；右键选择“退出灯芯AI”可结束应用。', noSound: true });
    }
  }
  return {
    install, show, close,
    beginQuit() { quitting = true; },
    destroy() { tray?.destroy(); tray = null; },
  };
}

module.exports = { createBackgroundWindow };
