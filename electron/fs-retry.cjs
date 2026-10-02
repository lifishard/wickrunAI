'use strict';

/**
 * Windows briefly refuses to rename over (or delete) a file that another
 * process holds open, typically an antivirus or indexer scanning a file that
 * was just written. Those refusals clear on their own, so retry them a few
 * times with backoff before reporting failure. Other errors fail at once.
 */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameWithRetry(from, to, { fs = require('node:fs'), platform = process.platform, delays = [20, 50, 100, 200, 400, 800, 1500], wait = sleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { fs.renameSync(from, to); return attempt; }
    catch (error) {
      if (platform !== 'win32' || !TRANSIENT.has(error.code) || attempt >= delays.length) throw error;
      wait(delays[attempt]);
    }
  }
}

module.exports = { renameWithRetry, TRANSIENT };
