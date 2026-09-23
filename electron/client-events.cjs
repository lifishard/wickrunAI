'use strict';

/** A native turn can finish after its renderer closes. Keep the durable result
 * in the host, but never send progress into a destroyed WebContents. */
function sendClientEvent(sender, message) {
  if (sender.isDestroyed()) return false;
  try {
    sender.send('snc:clientEvent', message);
    return true;
  } catch (error) {
    // The renderer can disappear between the check and Electron's send.
    if (sender.isDestroyed() || /object has been destroyed/i.test(String(error?.message))) return false;
    throw error;
  }
}

module.exports = { sendClientEvent };
