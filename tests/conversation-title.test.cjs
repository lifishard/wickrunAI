'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { loader } = require('./load-ts.cjs');
const file = (p) => path.join(__dirname, '..', p);

/*
 * 会话名字是数据，不是界面文案。
 *
 * 以前新建会话时把「新对话」四个字直接存进 title，于是切到英文之后侧栏里
 * 那条依然写着中文 —— 因为那就是这条记录存着的名字，翻译在渲染时插不进去
 * （t(c.title) 会把用户自己取名叫「新对话」的会话也一起翻掉）。
 *
 * 现在的约定：没取名 = 空串，显示时才落到当前语言。这组用例守住这条线。
 */

let store;
function load() {
  if (!store) {
    store = loader({
      [file('src/lib/transport.ts')]: { getTransport: () => ({ kvGet: async () => null, kvSet: async () => {} }), desktop: () => null },
    })(file('src/lib/store.ts'));
  }
  return store;
}

const zh = (s) => s;
const en = (s) => (s === '新对话' ? 'New chat' : s);

test('新建的会话不带名字，而不是带一个中文字面量', () => {
  const s = load();
  const c = s.newConversation(s.defaultSettings().defaultConfig, null);
  assert.equal(c.title, '');
  assert.equal(c.title, s.UNTITLED);
});

test('没取名的会话显示时跟着当前语言走', () => {
  const s = load();
  assert.equal(s.conversationTitle('', zh), '新对话');
  assert.equal(s.conversationTitle('', en), 'New chat');
});

test('用户自己取的名字不翻译 —— 哪怕他就叫它「新对话」', () => {
  const s = load();
  assert.equal(s.conversationTitle('新对话', en), '新对话');
  assert.equal(s.conversationTitle('My research', en), 'My research');
  assert.equal(s.conversationTitle('修一下日期 bug', en), '修一下日期 bug');
});

test('从首条消息推导名字：推不出来就保持「还没取名」，不落中文字面量', () => {
  const s = load();
  assert.equal(s.titleFrom(''), '');
  assert.equal(s.titleFrom('   \n\t '), '');
  assert.equal(s.titleFrom('帮我改一下日期'), '帮我改一下日期');
});

test('推导出来的长名字仍然截断', () => {
  const s = load();
  const long = s.titleFrom('x'.repeat(40));
  assert.equal(long.length, 25);
  assert.ok(long.endsWith('…'));
});

test('源码里不该再有把「新对话」写进 title 的地方', () => {
  // 加个新入口时忘了这条约定，这里会拦下来。
  const bad = [];
  for (const p of ['src/lib/store.ts', 'src/App.tsx']) {
    const src = fs.readFileSync(file(p), 'utf8');
    for (const line of src.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue; // 注释里提到它是可以的
      if (/title\s*[:=]\s*['"]新对话['"]/.test(line)) bad.push(`${p}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], `会话名字是数据，不能存界面文案：\n${bad.join('\n')}`);
});

test('老记录里存着的「新对话」在读取时归一 —— 已经存在的空会话也要跟着语言走', async () => {
  const stored = [
    { id: 'c1', title: '新对话', messages: [], config: {}, createdAt: 1, updatedAt: 1 },
    { id: 'c2', title: '新对话', messages: [{ id: 'm', role: 'user', content: '你好', createdAt: 1 }], config: {}, createdAt: 1, updatedAt: 1 },
    { id: 'c3', title: '季度报告', messages: [], config: {}, createdAt: 1, updatedAt: 1 },
  ];
  const kv = { 'snc:conversations:v1': JSON.stringify(stored) };
  const s = loader({
    [file('src/lib/transport.ts')]: {
      getTransport: () => ({ kvGet: async (k) => kv[k] ?? null, kvSet: async () => {} }),
      desktop: () => null,
    },
  })(file('src/lib/store.ts'));
  const list = await s.loadConversations();
  // 空会话叫「新对话」只可能是那个默认值 —— 归一，之后跟着语言走
  assert.equal(list[0].title, '');
  // 有消息的不动：那可能是用户自己取的名字
  assert.equal(list[1].title, '新对话');
  // 别人的名字一律不动
  assert.equal(list[2].title, '季度报告');
});
