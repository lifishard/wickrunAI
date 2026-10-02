'use strict';
const path = require('node:path');
const { spawn: nativeSpawn } = require('node:child_process');

/**
 * Stop a native client and everything it started.
 *
 * `child.kill()` ends only the root process. On Windows the children of an
 * agent (a transcoder, a script, a headless browser) keep running and keep
 * their CPU and memory after the turn has failed or been cancelled. Windows
 * therefore uses the system `taskkill /T`, called directly and never through
 * a shell. Elsewhere the client is started in its own process group and the
 * whole group is signalled.
 */
function killProcessTree(child, {
  platform = process.platform,
  spawn = nativeSpawn,
  env = process.env,
  killGroup = process.kill,
  signal = 'SIGTERM',
} = {}) {
  if (!child) return false;
  // A process that already exited may have its PID reused. Never signal it.
  if (child.exitCode != null || child.signalCode != null) return false;
  const pid = child.pid;
  const fallback = () => { try { child.kill(); } catch { /* already exited */ } };
  if (!Number.isInteger(pid) || pid <= 0) { fallback(); return true; }
  if (platform === 'win32') {
    const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
    try {
      const killer = spawn(path.join(root, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], {
        shell: false, windowsHide: true, stdio: 'ignore', env: { SystemRoot: root },
      });
      killer.on?.('error', fallback);
      killer.unref?.();
    } catch { fallback(); }
    return true;
  }
  try { killGroup(-pid, signal); } catch { try { child.kill(signal); } catch { /* already exited */ } }
  return true;
}

module.exports = { killProcessTree };
