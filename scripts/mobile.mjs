#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, configureMobile } from './mobile-config.mjs';

const [command = 'prepare', platform = 'android', variant = 'debug'] = process.argv.slice(2);
function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, {cwd, stdio: 'inherit', env: process.env});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} failed (${result.status}).`);
}
function node(script, args = []) { run(process.execPath, [script, ...args]); }
try {
  if (!['android','ios'].includes(platform)) throw new Error('Choose android or ios.');
  if (!['prepare','build','configure'].includes(command)) throw new Error('Choose prepare, configure or build.');
  if (command === 'configure') { configureMobile(platform); }
  else {
    if (command === 'build' && (platform !== 'android' || !['debug','release','bundle'].includes(variant))) throw new Error('Android build variant must be debug, release or bundle.');
    if (command === 'build' && variant !== 'debug') {
      for (const key of ['ANDROID_KEYSTORE_PATH','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD']) {
        if (!process.env[key]?.trim()) throw new Error(`Missing ${key}; release builds never fall back to a debug key.`);
      }
      if (!fs.existsSync(process.env.ANDROID_KEYSTORE_PATH)) throw new Error('Android release keystore not found.');
    }
    node('node_modules/typescript/bin/tsc', ['--noEmit']);
    node('node_modules/vite/bin/vite.js', ['build']);
    if (!fs.existsSync(path.join(root, platform))) node('node_modules/@capacitor/cli/bin/capacitor', ['add', platform]);
    node('node_modules/@capacitor/cli/bin/capacitor', ['sync', platform]);
    configureMobile(platform);
    if (command === 'build') {
      const args = [{debug:'assembleDebug',release:'assembleRelease',bundle:'bundleRelease'}[variant], '--no-daemon'];
      const cwd = path.join(root, 'android');
      if (process.platform === 'win32') run('cmd.exe', ['/d','/s','/c',`gradlew.bat ${args.join(' ')}`], cwd);
      else run('sh', ['./gradlew', ...args], cwd);
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
