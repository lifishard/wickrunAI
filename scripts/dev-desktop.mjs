#!/usr/bin/env node
/**
 * 开发模式：起 vite + Electron，改代码热更新。
 * 同样的理由，逻辑放在 Node 里，.bat 保持纯 ASCII。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const line = (s = '') => process.stdout.write(`${s}\n`);

/** package.json 里声明了、node_modules 里却没有的包。加了新依赖就是靠这个发现的。 */
function missingDeps() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  return declared.filter((name) => !fs.existsSync(path.join(root, 'node_modules', ...name.split('/'), 'package.json')));
}

const missing = fs.existsSync(path.join(root, 'node_modules')) ? missingDeps() : null;
if (missing === null || missing.length) {
  line(missing === null ? '首次运行，先装依赖…' : `有新依赖要装：${missing.join('、')}`);
  line();
  const r = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    line();
    line('✗ npm install 失败，往上翻看报错。');
    process.exit(1);
  }
  line();
}

line('启动开发模式 —— 改代码会热更新，关掉这个窗口就退出。');
line();

const r = spawnSync('npm', ['run', 'dev:electron'], { cwd: root, stdio: 'inherit', shell: isWin });
process.exit(r.status ?? 0);
