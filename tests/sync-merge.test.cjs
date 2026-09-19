'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const file = (p) => path.resolve(__dirname, '..', p);
const M = loader()(file('src/lib/sync-merge.ts'));

const stampOf = (x) => x.updatedAt ?? 0;
const C = (items, tombstones = []) => ({ items, tombstones });
const conv = (id, updatedAt, title = 't') => ({ id, updatedAt, title });
const merge = (a, b, o = {}) => M.mergeCollection(a, b, { stampOf, now: 1_000_000, ...o });

test('两边各有的记录并起来', () => {
  const out = merge(C([conv('a', 1)]), C([conv('b', 2)]));
  assert.deepEqual(out.items.map((x) => x.id), ['a', 'b']);
});

test('同一条取更新的那一版', () => {
  const out = merge(C([conv('a', 1, '旧')]), C([conv('a', 5, '新')]));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].title, '新');
});

/*
 * 下面这条是整个模块最重要的性质：谁先谁后合并，结果必须一样。
 * 做不到的话用户会看到会话在两台机器之间来回抖。
 */
test('合并方向无关：A 合 B 和 B 合 A 结果相同', () => {
  const a = C([conv('x', 3, 'A'), conv('y', 9)], [{ id: 'z', deletedAt: 4 }]);
  const b = C([conv('x', 7, 'B'), conv('z', 2)], []);
  assert.deepEqual(merge(a, b), merge(b, a));
});

test('时间戳撞车时两边挑得一样 —— 挑得对不重要，挑得一致才重要', () => {
  const a = C([conv('x', 5, 'alpha')]);
  const b = C([conv('x', 5, 'beta')]);
  assert.deepEqual(merge(a, b), merge(b, a));
  assert.equal(merge(a, b).items.length, 1);
});

test('重复合并不改变结果（幂等）', () => {
  const a = C([conv('x', 3)], [{ id: 'q', deletedAt: 10 }]);
  const b = C([conv('y', 4)], []);
  const once = merge(a, b);
  assert.deepEqual(merge(once, b), once);
  assert.deepEqual(merge(once, once), once);
});

test('墓碑压住老记录 —— 删掉的东西不会被另一台设备同步回来', () => {
  const out = merge(C([], [{ id: 'a', deletedAt: 100 }]), C([conv('a', 50)]));
  assert.deepEqual(out.items, []);
  assert.equal(out.tombstones.length, 1);
});

test('删除之后又改过，记录复活，墓碑作废', () => {
  const out = merge(C([], [{ id: 'a', deletedAt: 100 }]), C([conv('a', 150, '删后又改')]));
  assert.deepEqual(out.items.map((x) => x.id), ['a']);
  assert.deepEqual(out.tombstones, []);
});

test('删除时间和最后一次编辑同刻，认删除', () => {
  const out = merge(C([], [{ id: 'a', deletedAt: 100 }]), C([conv('a', 100)]));
  assert.deepEqual(out.items, []);
});

test('两边都删过，取更早的那次删除时间 —— 保守一侧，编辑更容易赢', () => {
  const out = merge(C([], [{ id: 'a', deletedAt: 200 }]), C([], [{ id: 'a', deletedAt: 100 }]));
  assert.equal(out.tombstones[0].deletedAt, 100);
});

test('墓碑过期就清掉，否则会无限增长', () => {
  const old = { id: 'a', deletedAt: 0 };
  const out = M.mergeCollection(C([], [old]), C([]), { stampOf, now: M.TOMBSTONE_TTL_MS + 1 });
  assert.deepEqual(out.tombstones, []);
});

test('缺字段、id 不是字符串的脏数据不会把合并搞崩', () => {
  const out = merge(C([conv('a', 1), null, { id: 42 }, {}]), C([conv('b', 2)]));
  assert.deepEqual(out.items.map((x) => x.id), ['a', 'b']);
});

test('没有更新时间的集合（比如技能）也能合，缺时间戳当 0', () => {
  const skill = (id, installedAt) => ({ id, installedAt, body: 'x' });
  const out = M.mergeCollection(
    C([skill('s1', 5)]), C([skill('s1', 9), skill('s2', 1)]),
    { stampOf: (s) => s.installedAt ?? 0, now: 1000 },
  );
  assert.deepEqual(out.items.map((x) => x.id), ['s1', 's2']);
  assert.equal(out.items[0].installedAt, 9);
});

test('canonical 与键顺序无关 —— 两台设备必须算出同一个字符串', () => {
  assert.equal(M.canonical({ b: 1, a: 2 }), M.canonical({ a: 2, b: 1 }));
  assert.notEqual(M.canonical({ a: 1 }), M.canonical({ a: 2 }));
  assert.equal(M.canonical([1, { y: 1, x: 2 }]), M.canonical([1, { x: 2, y: 1 }]));
});

/* ---------------- 观测记录 ---------------- */

const obs = (patch = {}) => ({
  version: 1, epoch: 'e-local', createdAt: 100, tasks: [],
  droppedTasks: 0, writeFailures: 0, ignoredRecordIds: [], ...patch,
});

test('观测的计数器取 max 不相加 —— 相加会在重复同步时虚增，而它们是做成率的分母', () => {
  const a = obs({ droppedTasks: 7, writeFailures: 2 });
  const b = obs({ droppedTasks: 5, writeFailures: 9 });
  const once = M.mergeObservations(a, b, { now: 1000 });
  assert.equal(once.droppedTasks, 7);
  assert.equal(once.writeFailures, 9);
  // 再同步一次，数字不能再涨
  const twice = M.mergeObservations(once, b, { now: 1000 });
  assert.equal(twice.droppedTasks, 7);
  assert.equal(twice.writeFailures, 9);
});

test('任务记录逐条合，按 lastAt 取新', () => {
  const t = (id, lastAt, status) => ({ id, lastAt, status });
  const out = M.mergeObservations(
    obs({ tasks: [t('t1', 10, 'old'), t('t2', 1, 'x')] }),
    obs({ tasks: [t('t1', 20, 'new')] }),
    { now: 1000 },
  );
  assert.deepEqual(out.tasks.map((x) => x.id), ['t1', 't2']);
  assert.equal(out.tasks[0].status, 'new');
});

test('忽略名单取并集：任何一台设备说别算，就都别算', () => {
  const out = M.mergeObservations(
    obs({ ignoredRecordIds: ['a', 'b'] }),
    obs({ ignoredRecordIds: ['b', 'c'] }),
    { now: 1000 },
  );
  assert.deepEqual(out.ignoredRecordIds, ['a', 'b', 'c']);
});

test('epoch 以本地为准 —— 清记录是明确的本地意图，不该被另一台设备撤销', () => {
  const out = M.mergeObservations(obs({ epoch: 'e-local' }), obs({ epoch: 'e-remote' }), { now: 1000 });
  assert.equal(out.epoch, 'e-local');
});

/* ---------------- 设置 ---------------- */

test('设置整份取新，不做字段级拼接', () => {
  const local = { value: { theme: 'dark', failover: ['p1'] }, updatedAt: 1 };
  const remote = { value: { theme: 'light', failover: ['p2', 'p3'] }, updatedAt: 9 };
  assert.deepEqual(M.pickSettings(local, remote), { theme: 'light', failover: ['p2', 'p3'] });
});

test('设置时间戳撞车时两边也挑得一样', () => {
  const a = { value: { theme: 'dark' }, updatedAt: 5 };
  const b = { value: { theme: 'light' }, updatedAt: 5 };
  assert.deepEqual(M.pickSettings(a, b), M.pickSettings(b, a));
});
