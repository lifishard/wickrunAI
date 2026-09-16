'use strict';

const KINDS = new Set(['question', 'paused', 'error', 'completed']);
const MAX_SEEN = 256;
const MAX_ACTIVE = 32;

function boundedText(value, max, singleLine = false) {
  if (typeof value !== 'string') return null;
  const text = (singleLine ? value.replace(/[\r\n\t]+/g, ' ') : value).trim();
  if (!text || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

function validateTaskNotification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = boundedText(value.id, 160, true);
  const conversationId = boundedText(value.conversationId, 160, true);
  const title = boundedText(value.title, 120, true);
  const body = boundedText(value.body, 600);
  if (!id || !conversationId || !title || !body || !KINDS.has(value.kind)) return null;
  if (value.silent !== undefined && typeof value.silent !== 'boolean') return null;
  return { id, conversationId, title, body, kind: value.kind, silent: value.silent === true };
}

function activateTaskNotification(win, payload) {
  if (!win || win.isDestroyed?.()) return false;
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    if (!win.webContents?.isDestroyed?.()) {
      win.webContents.send('snc:taskNotificationClick', {
        id: payload.id,
        conversationId: payload.conversationId,
        kind: payload.kind,
      });
    }
    return true;
  } catch {
    return false;
  }
}

function createTaskNotifier({ Notification, getWindow, activateWindow }) {
  const seen = new Map();
  const active = new Map();

  function remember(id) {
    seen.set(id, true);
    while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
  }

  function shouldNotify(win) {
    if (!win || win.isDestroyed?.()) return false;
    try {
      return win.isMinimized() || !win.isVisible() || !win.isFocused();
    } catch {
      return false;
    }
  }

  function notify(value) {
    const payload = validateTaskNotification(value);
    if (!payload || seen.has(payload.id)) return false;
    const win = getWindow();
    if (!shouldNotify(win) || !Notification?.isSupported?.()) return false;

    let notification;
    try {
      notification = new Notification({
        title: payload.title,
        body: payload.body,
        silent: payload.silent,
      });
      notification.once('click', () => {
        active.delete(payload.id);
        try {
          activateWindow({ id: payload.id, conversationId: payload.conversationId, kind: payload.kind });
        } catch {
          /* Notification activation must not crash the main process. */
        }
      });
      notification.once('close', () => active.delete(payload.id));
      remember(payload.id);
      active.set(payload.id, notification);
      while (active.size > MAX_ACTIVE) {
        const [oldestId, oldest] = active.entries().next().value;
        active.delete(oldestId);
        try { oldest.close(); } catch { /* already closed by the OS */ }
      }
      notification.show();
      return true;
    } catch {
      seen.delete(payload.id);
      active.delete(payload.id);
      try { notification?.close(); } catch { /* best effort */ }
      return false;
    }
  }

  return { notify };
}

module.exports = { activateTaskNotification, createTaskNotifier, validateTaskNotification };
