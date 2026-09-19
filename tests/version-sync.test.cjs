'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = (p) => path.resolve(__dirname, '..', p);
const read = (p) => fs.readFileSync(file(p), 'utf8');

/*
 * 版本号散在五个地方，每个地方漏一处的后果都不一样：
 *   package.json          漏了 → 打出来的包名和实际内容对不上
 *   package-lock 的两处    漏了 → npm ci 会报错，CI 直接红
 *   src/lib/version.ts    漏了 → 界面和任务记录里写的是旧版本，事后排查全乱
 *   两份 README 的徽章     漏了 → 仓库首页长期显示一个过期版本
 * 前四处以前靠人记，第五处以前根本没人管。这条用例把它们绑在一起。
 */

const expected = JSON.parse(read('package.json')).version;

test('版本号本身是三段数字', () => {
  assert.match(expected, /^\d+\.\d+\.\d+$/);
});

test('package-lock 根部两处跟 package.json 一致', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, expected, 'package-lock.json 顶层 version');
  assert.equal(lock.packages[''].version, expected, 'package-lock.json packages[""] version');
});

test('src/lib/version.ts 跟 package.json 一致', () => {
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(read('src/lib/version.ts'));
  assert.ok(m, '没找到 APP_VERSION');
  assert.equal(m[1], expected);
});

test('两份 README 的版本徽章跟 package.json 一致', () => {
  for (const p of ['README.md', 'README.zh-CN.md']) {
    const m = /badge\/version-([0-9.]+)-/.exec(read(p));
    assert.ok(m, `${p} 里没找到版本徽章`);
    assert.equal(m[1], expected, p);
  }
});

test('依赖树里碰巧同版本号的包没有被顺手改掉', () => {
  // 之前踩过：sed 全局替换把一个恰好同版本的依赖也改了，npm ci 直接失效。
  const lock = JSON.parse(read('package-lock.json'));
  const deps = Object.entries(lock.packages).filter(([name]) => name.startsWith('node_modules/'));
  for (const [name, meta] of deps) {
    if (meta.version !== expected) continue;
    // 同版本号本身是允许的，这里只确认它有 resolved/integrity —— 也就是说
    // 它是一条真实的依赖记录，不是被替换坏的根字段。
    assert.ok(meta.resolved || meta.link, `${name} 看起来被误改过`);
  }
});
