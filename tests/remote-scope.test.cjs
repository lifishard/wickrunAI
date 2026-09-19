'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { addressScope, allowedSource, localEndpoints, ALLOWED_SCOPES } = require('../electron/remote-server.cjs');

/*
 * 这组用例守的是一句话：遥控端口背后是这台电脑的命令行，所以「谁能连上来」
 * 必须比「token 对不对」更早一层做判断。
 */

test('私有网段判成 private', () => {
  for (const ip of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.1.10']) {
    assert.equal(addressScope(ip), 'private', ip);
  }
});

test('172.16/12 的边界不能多放也不能少放', () => {
  assert.equal(addressScope('172.15.255.255'), 'public');
  assert.equal(addressScope('172.16.0.0'), 'private');
  assert.equal(addressScope('172.31.255.255'), 'private');
  assert.equal(addressScope('172.32.0.0'), 'public');
});

test('100.64.0.0/10 判成 cgnat —— Tailscale 的 tailnet 地址在这里', () => {
  assert.equal(addressScope('100.64.0.0'), 'cgnat');
  assert.equal(addressScope('100.101.102.103'), 'cgnat');
  assert.equal(addressScope('100.127.255.255'), 'cgnat');
  // 段外的 100.x 是正经公网地址，不能顺手一起放行
  assert.equal(addressScope('100.63.255.255'), 'public');
  assert.equal(addressScope('100.128.0.0'), 'public');
});

test('公网地址判成 public', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.5', '2606:4700::1111']) {
    assert.equal(addressScope(ip), 'public', ip);
  }
});

test('回环和链路本地各归各的', () => {
  assert.equal(addressScope('127.0.0.1'), 'loopback');
  assert.equal(addressScope('::1'), 'loopback');
  assert.equal(addressScope('169.254.1.1'), 'linklocal');
  assert.equal(addressScope('fe80::1'), 'linklocal');
  assert.equal(addressScope('fe80::1%eth0'), 'linklocal');
});

test('IPv6 映射过来的 IPv4 要按 IPv4 判 —— Node 在双栈上就是这么给的', () => {
  assert.equal(addressScope('::ffff:192.168.1.5'), 'private');
  assert.equal(addressScope('::ffff:8.8.8.8'), 'public');
  assert.equal(addressScope('::ffff:100.101.1.2'), 'cgnat');
});

test('fc00::/7 唯一本地地址判成 private —— Tailscale 的 IPv6 落在这里', () => {
  assert.equal(addressScope('fd7a:115c:a1e0::1'), 'private');
  assert.equal(addressScope('fc00::1'), 'private');
  assert.equal(addressScope('fe00::1'), 'public');
});

test('畸形输入不能蒙混成放行档', () => {
  for (const bad of ['', null, undefined, 'not-an-ip', '1.2.3', '1.2.3.4.5', '999.1.1.1', '10.0.0.-1', '01.2.3.4444']) {
    assert.equal(allowedSource(bad), false, String(bad));
  }
});

test('放行名单就是这四档，多一档都不行', () => {
  assert.deepEqual([...ALLOWED_SCOPES].sort(), ['cgnat', 'linklocal', 'loopback', 'private']);
  assert.equal(allowedSource('8.8.8.8'), false);
  assert.equal(allowedSource('100.101.1.2'), true);
});

test('localEndpoints 每条都带得出档位，且不会把 internal 网卡算进去', () => {
  for (const e of localEndpoints()) {
    assert.ok(typeof e.address === 'string' && e.address.length > 0);
    assert.ok(e.family === 4 || e.family === 6);
    assert.ok(typeof e.scope === 'string' && e.scope !== 'unknown', `${e.address} -> ${e.scope}`);
    assert.notEqual(e.scope, 'loopback');
  }
});

test('cgnat 排在 private 前面：tailnet 地址换网也通，192.168 换个 Wi-Fi 就废了', () => {
  const order = localEndpoints().map((e) => e.scope);
  const firstCgnat = order.indexOf('cgnat');
  const firstPrivate = order.indexOf('private');
  if (firstCgnat !== -1 && firstPrivate !== -1) assert.ok(firstCgnat < firstPrivate);
});

/*
 * 下面这条是真起一个服务再连。判来源的代码写对了没有，只有走一遍真的 socket
 * 才算数 —— 上面全是纯函数，纯函数对不代表它被接在了该接的地方。
 */
test('公网来源的连接被直接掐断，不回任何响应', async () => {
  const { handle } = require('../electron/remote-server.cjs');
  let destroyed = false;
  let responded = false;
  const req = {
    method: 'GET',
    url: '/ping',
    headers: {},
    socket: { remoteAddress: '203.0.113.9', destroy() { destroyed = true; } },
  };
  const res = { writeHead() { responded = true; }, end() { responded = true; } };
  await handle(req, res);
  assert.equal(destroyed, true, '公网来源必须断开');
  assert.equal(responded, false, '连 401 都不能回，否则等于告诉对面这里有东西');
});

test('私有来源的请求走到正常分支', async () => {
  const { handle } = require('../electron/remote-server.cjs');
  let destroyed = false;
  let status = 0;
  let body = '';
  const req = {
    method: 'GET',
    url: '/ping',
    headers: {},
    socket: { remoteAddress: '192.168.1.22', destroy() { destroyed = true; } },
  };
  const res = { writeHead(code) { status = code; }, end(text) { body = text || ''; } };
  await handle(req, res);
  assert.equal(destroyed, false);
  assert.equal(status, 200);
  assert.equal(JSON.parse(body).ok, true);
});

test('tailnet 来源的请求也走到正常分支 —— 这就是第 0 档零改动生效的地方', async () => {
  const { handle } = require('../electron/remote-server.cjs');
  let status = 0;
  const req = {
    method: 'GET',
    url: '/ping',
    headers: {},
    socket: { remoteAddress: '100.101.102.103', destroy() {} },
  };
  await handle(req, { writeHead(code) { status = code; }, end() {} });
  assert.equal(status, 200);
});

test('放行的来源没有 token 照样拿不到工具 —— 两层是并列的，不是二选一', async () => {
  const { handle } = require('../electron/remote-server.cjs');
  let status = 0;
  const req = {
    method: 'POST',
    url: '/tool',
    headers: {},
    socket: { remoteAddress: '192.168.1.22', destroy() {} },
  };
  await handle(req, { writeHead(code) { status = code; }, end() {} });
  assert.equal(status, 401);
});
