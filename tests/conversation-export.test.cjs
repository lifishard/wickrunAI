'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const file = (p) => path.join(__dirname, '..', p);
const X = loader({
  [file('src/lib/transport.ts')]: { getTransport: () => ({ kvGet: async () => null, kvSet: async () => {} }), desktop: () => null },
})(file('src/lib/conversation-export.ts'));

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

const conv = (patch = {}) => ({
  id: 'c1',
  title: '季度报告',
  projectId: 'p1',
  createdAt: NOW - 86400000,
  updatedAt: NOW,
  keyProfileId: 'kp-1',
  config: { model: 'kimi-k3', params: {} },
  messages: [
    { id: 'm1', role: 'user', content: '帮我算一下 Q3', createdAt: 1 },
    { id: 'm2', role: 'assistant', content: '算完了', createdAt: 2, model: 'kimi-k3',
      reasoning: '先看营收再看成本', steps: [{ id: 's1', callId: 'x', name: 'read_file', args: {}, status: 'ok', summary: '读取 q3.csv', startedAt: 1, filePath: '/data/q3.csv' }] },
  ],
  ...patch,
});

/* ---------------- 文件名 ---------------- */

test('文件名带标题和日期，扩展名跟格式走', () => {
  assert.equal(X.exportFileName(conv(), 'markdown', { now: NOW }), 'wickrunAI-季度报告-2026-09-19.md');
  assert.equal(X.exportFileName(conv(), 'json', { now: NOW }), 'wickrunAI-季度报告-2026-09-19.json');
});

test('标题里的路径字符和控制字符不能进文件名', () => {
  for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
    const name = X.exportFileName(conv({ title: bad }), 'markdown', { now: NOW });
    assert.ok(!/[\\/:*?"<>|]/.test(name.replace(/^wickrunAI-/, '')), `${bad} -> ${name}`);
  }
  const ctrl = X.exportFileName(conv({ title: 'a\u0000b\nc' }), 'markdown', { now: NOW });
  assert.ok(!/[\u0000-\u001f]/.test(ctrl));
});

test('Windows 的保留名退回默认标题，不生成一个打不开的文件', () => {
  for (const bad of ['CON', 'nul', 'COM1', 'lpt9']) {
    assert.equal(X.exportFileName(conv({ title: bad }), 'markdown', { now: NOW }), 'wickrunAI-对话-2026-09-19.md');
  }
});

test('空标题和结尾的点或空格都处理掉 —— Windows 上这两种都存不了', () => {
  assert.equal(X.exportFileName(conv({ title: '' }), 'markdown', { now: NOW }), 'wickrunAI-对话-2026-09-19.md');
  assert.ok(!X.exportFileName(conv({ title: '报告...' }), 'markdown', { now: NOW }).includes('...-2026'));
  assert.ok(!/[. ]-2026/.test(X.exportFileName(conv({ title: '报告 ' }), 'markdown', { now: NOW })));
});

test('超长标题截断，文件名不会顶到系统上限', () => {
  const name = X.exportFileName(conv({ title: '很长的标题'.repeat(40) }), 'markdown', { now: NOW });
  assert.ok(name.length < 80, name.length);
});

/* ---------------- Markdown ---------------- */

test('Markdown 有标题、时间和两边的发言', () => {
  const md = X.toMarkdown(conv(), { now: NOW });
  assert.ok(md.startsWith('# 季度报告'));
  assert.ok(md.includes('帮我算一下 Q3'));
  assert.ok(md.includes('算完了'));
  assert.ok(md.includes('kimi-k3'));
});

test('执行步骤和思考过程默认都不带，打开开关才带', () => {
  const plain = X.toMarkdown(conv(), { now: NOW });
  assert.ok(!plain.includes('read_file'));
  assert.ok(!plain.includes('先看营收'));
  const full = X.toMarkdown(conv(), { now: NOW, includeSteps: true, includeReasoning: true });
  assert.ok(full.includes('read_file'));
  assert.ok(full.includes('/data/q3.csv'));
  assert.ok(full.includes('先看营收'));
});

test('system 和 tool 消息不进 Markdown —— 那是内部指令，不是对话', () => {
  const md = X.toMarkdown(conv({ messages: [
    { id: 's', role: 'system', content: '内部系统提示词', createdAt: 1 },
    { id: 'u', role: 'user', content: '你好', createdAt: 2 },
    { id: 't', role: 'tool', content: '工具返回的一大坨', createdAt: 3, toolName: 'read_file' },
  ] }), { now: NOW });
  assert.ok(!md.includes('内部系统提示词'));
  assert.ok(!md.includes('工具返回的一大坨'));
  assert.ok(md.includes('你好'));
});

test('附件只列名字和大小，正文和图片本体不出现', () => {
  const md = X.toMarkdown(conv({ messages: [
    { id: 'u', role: 'user', content: '看这个', createdAt: 1, attachments: [
      { id: 'a', kind: 'text', name: '合同.txt', mime: 'text/plain', size: 2048, text: '这是合同全文机密内容' },
      { id: 'b', kind: 'image', name: '图.png', mime: 'image/png', size: 900, dataUrl: 'data:image/png;base64,AAAA' },
    ] },
  ] }), { now: NOW });
  assert.ok(md.includes('合同.txt'));
  assert.ok(md.includes('2048'));
  assert.ok(!md.includes('这是合同全文机密内容'));
  assert.ok(!md.includes('base64'));
});

test('报错和非正常结束原因会写进去 —— 那是读者需要知道的', () => {
  const md = X.toMarkdown(conv({ messages: [
    { id: 'a', role: 'assistant', content: '半截', createdAt: 1, error: '额度用完了', stopReason: 'length' },
  ] }), { now: NOW });
  assert.ok(md.includes('额度用完了'));
  assert.ok(md.includes('length'));
});

test('正常结束原因不写 —— 每条都标 stop 只会变成噪音', () => {
  const md = X.toMarkdown(conv({ messages: [
    { id: 'a', role: 'assistant', content: '好了', createdAt: 1, stopReason: 'stop' },
  ] }), { now: NOW });
  assert.ok(!md.includes('stop'));
});

test('空对话也能导出，不抛错', () => {
  const md = X.toMarkdown(conv({ messages: [] }), { now: NOW });
  assert.ok(md.includes('# 季度报告'));
});

/* ---------------- JSON ---------------- */

test('JSON 能解析，带格式和版本号', () => {
  const j = JSON.parse(X.toJson(conv(), { now: NOW }));
  assert.equal(j.format, 'wickrunAI-conversation');
  assert.equal(j.schemaVersion, 1);
  assert.equal(j.conversation.title, '季度报告');
  assert.equal(j.conversation.messages.length, 2);
});

test('keyProfileId 不出门 —— 它是本机凭据记录的编号，对别人没意义', () => {
  const text = X.toJson(conv(), { now: NOW });
  assert.ok(!text.includes('kp-1'));
  assert.equal(JSON.parse(text).conversation.keyProfileId, undefined);
});

test('凭据形状的字段被过滤掉，哪怕藏在 config 深处', () => {
  const text = X.toJson(conv({ config: { model: 'm', params: {}, extraHeaders: { Authorization: 'Bearer sk-LEAK' } } }), { now: NOW });
  assert.ok(!text.includes('sk-LEAK'));
  assert.ok(!text.includes('Authorization'));
});

test('runState 不导出 —— 那是断线保护的现场，几百 KB 而且没人会读', () => {
  const text = X.toJson(conv({ messages: [
    { id: 'a', role: 'assistant', content: 'x', createdAt: 1, runState: { working: ['一大坨现场数据'] } },
  ] }), { now: NOW });
  assert.ok(!text.includes('一大坨现场数据'));
  assert.equal(JSON.parse(text).conversation.messages[0].runState, undefined);
});

test('JSON 里附件同样只留元信息', () => {
  const text = X.toJson(conv({ messages: [
    { id: 'u', role: 'user', content: 'x', createdAt: 1, attachments: [
      { id: 'a', kind: 'text', name: 'n.txt', mime: 'text/plain', size: 10, text: '机密正文' },
    ] },
  ] }), { now: NOW });
  assert.ok(!text.includes('机密正文'));
  const a = JSON.parse(text).conversation.messages[0].attachments[0];
  assert.deepEqual(a, { name: 'n.txt', kind: 'text', size: 10 });
});

test('JSON 的步骤和思考也跟着开关走', () => {
  const plain = JSON.parse(X.toJson(conv(), { now: NOW }));
  assert.equal(plain.conversation.messages[1].steps, undefined);
  assert.equal(plain.conversation.messages[1].reasoning, undefined);
  const full = JSON.parse(X.toJson(conv(), { now: NOW, includeSteps: true, includeReasoning: true }));
  assert.equal(full.conversation.messages[1].steps.length, 1);
  assert.ok(full.conversation.messages[1].reasoning);
});

test('renderExport 按格式分流', () => {
  assert.ok(X.renderExport(conv(), 'markdown', { now: NOW }).startsWith('#'));
  assert.equal(JSON.parse(X.renderExport(conv(), 'json', { now: NOW })).schemaVersion, 1);
});
