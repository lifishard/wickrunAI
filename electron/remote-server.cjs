'use strict';
/**
 * 给手机端用的遥控服务。
 *
 * 手机上没有文件系统权限、没法控 Chrome、也没有 claude CLI，所以手机端的工具
 * 调用全部转发到这台电脑执行。这个小 HTTP 服务就是那个转发入口。
 *
 * 安全上做了四件事，也只做了这四件：
 *   1. 必须带 Bearer token，token 是随机生成的，配对时手动抄到手机上
 *   2. 按来源地址放行：只接私有网段、CGNAT（Tailscale）、链路本地和本机回环
 *   3. 不做任何 UPnP / 打洞
 *   4. token 不对直接 401，不给任何提示信息
 *
 * 关于第 2 条：以前这里的注释写的是「默认只绑内网地址」，但代码一直是
 * listen(port, '0.0.0.0') —— 绑的是所有网卡。这两句话不是一回事：在路由器
 * 后面它们的效果一样，可这台机器一旦拿到公网 IP，或者插进咖啡店的公共
 * Wi-Fi，0.0.0.0 就是把一个能跑命令行的入口摆在门口。
 *
 * 绑定继续保持 0.0.0.0，因为 Tailscale / WireGuard 的虚拟网卡也得能进来，
 * 而那些网卡的地址是会变的，一条条绑不现实。改成在连接层面判来源：来源不在
 * 放行网段就直接 destroy，连 401 都不回 —— 不给对面任何「这里有东西」的信号。
 *
 * 这不是给公网暴露用的。别把它端口转发出去。真要从外面进来，正确的做法是
 * 装 Tailscale 让两台设备进同一个 tailnet，那样来源就是 100.64.0.0/10，
 * 这里天然放行，而且一行代码都不用改。
 */
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { runTool } = require('./tools/index.cjs');
const { MAX_BATCH, limitLabel } = require('./attachments.cjs');

let server = null;
let currentPort = 0;
let currentToken = '';

/**
 * 判一个地址属于哪一档。手机端要连的是 private 或 cgnat；public 出现在网卡
 * 列表里意味着这台机器直接挂在公网上，出现在来源里意味着有人从外面进来。
 *
 * 100.64.0.0/10 是运营商级 NAT 段，Tailscale 的 tailnet 地址就发在这个段里，
 * 所以它和内网一样放行 —— 这是「第 0 档」方案能零改动生效的原因。
 * IPv6 这边 fc00::/7 是唯一本地地址，Tailscale 的 IPv6 也落在里面。
 */
function addressScope(ip) {
  if (typeof ip !== 'string' || !ip) return 'unknown';
  let v = ip;
  const zone = v.indexOf('%'); // fe80::1%eth0
  if (zone !== -1) v = v.slice(0, zone);
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  if (v.toLowerCase().startsWith('::ffff:') && v.includes('.')) v = v.slice(7);

  if (v.includes(':')) {
    const head = v.toLowerCase();
    if (head === '::1') return 'loopback';
    if (head.startsWith('fe80')) return 'linklocal';
    const first = parseInt(head.split(':')[0] || '', 16);
    if (Number.isNaN(first)) return 'unknown';
    if ((first & 0xfe00) === 0xfc00) return 'private';
    return 'public';
  }

  const p = v.split('.');
  if (p.length !== 4) return 'unknown';
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : -1));
  if (n.some((x) => x < 0 || x > 255)) return 'unknown';
  if (n[0] === 127) return 'loopback';
  if (n[0] === 10) return 'private';
  if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return 'private';
  if (n[0] === 192 && n[1] === 168) return 'private';
  if (n[0] === 169 && n[1] === 254) return 'linklocal';
  if (n[0] === 100 && n[1] >= 64 && n[1] <= 127) return 'cgnat';
  return 'public';
}

// 回环放在放行名单里是有意的：Cloudflare Tunnel / 反向代理这类东西就是从本机
// 回环连进来的。那是「第 1 档」的门，留着；但走那条路必须自己在前面再加一层
// 认证，Bearer token 单独一层在公网上不够。
const ALLOWED_SCOPES = new Set(['loopback', 'private', 'cgnat', 'linklocal']);

function allowedSource(ip) {
  return ALLOWED_SCOPES.has(addressScope(ip));
}

// cgnat 排在最前：tailnet 地址不挑网络，换个咖啡店还是同一个地址，
// 而 192.168.x 换个 Wi-Fi 就废了。手机端应该优先抄第一条。
const SCOPE_ORDER = { cgnat: 0, private: 1, linklocal: 2, loopback: 3 };

function localEndpoints() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.internal) continue;
      const family = ni.family === 'IPv4' || ni.family === 4 ? 4 : 6;
      const scope = addressScope(ni.address);
      out.push({ iface: name, address: ni.address, family, scope });
    }
  }
  out.sort((a, b) => {
    const sa = SCOPE_ORDER[a.scope];
    const sb = SCOPE_ORDER[b.scope];
    if (sa !== sb) return (sa === undefined ? 9 : sa) - (sb === undefined ? 9 : sb);
    if (a.family !== b.family) return a.family - b.family;
    return a.address.localeCompare(b.address);
  });
  return out;
}

function lanAddresses() {
  return localEndpoints()
    .filter((e) => e.scope !== 'public' && e.family === 4)
    .map((e) => e.address);
}

function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// Keep the remote bridge aligned with the attachment batch policy. The
// endpoint still receives JSON tool requests, but Android/browser clients may
// carry attachment metadata through the same authenticated bridge.
const MAX_REMOTE_BODY = MAX_BATCH;

function readBody(req, limit = MAX_REMOTE_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`请求体超过 ${limitLabel(limit)} 上限，请分批发送。`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handle(req, res) {
  // 来源不在放行网段就直接掐断。不回 401、不回 403，什么都不回 —— 扫端口的
  // 那头只会看到连接被重置，和「这个端口没开」分不出来。
  if (!allowedSource(req.socket && req.socket.remoteAddress)) {
    try { req.socket.destroy(); } catch { /* 已经断了就算了 */ }
    return;
  }

  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  // /ping 不校验 token，只用来让手机确认地址通不通
  if (url.pathname === '/ping') {
    send(res, 200, { ok: true, app: 'anyai', productName: 'wickrunAI', displayName: '灯芯AI', host: os.hostname() });
    return;
  }

  const auth = req.headers.authorization || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(currentToken);
  const okToken =
    a.length === b.length && currentToken.length > 0 && crypto.timingSafeEqual(a, b);
  if (!okToken) {
    send(res, 401, { error: '配对令牌不对' });
    return;
  }

  if (url.pathname === '/tool' && req.method === 'POST') {
    try {
      const payload = JSON.parse(await readBody(req));
      const result = await runTool(payload.name, payload.args, payload.ctx);
      send(res, 200, result);
    } catch (e) {
      send(res, 400, { ok: false, content: '', error: e.message });
    }
    return;
  }

  send(res, 404, { error: 'not found' });
}

function start(port, token) {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(status());
      return;
    }
    currentPort = Number(port) || 8719;
    currentToken = token || newToken();

    server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        try {
          send(res, 500, { error: e.message });
        } catch {
          /* 连响应都发不出去就算了 */
        }
      });
    });

    server.on('error', (e) => {
      server = null;
      reject(new Error(`遥控服务起不来：${e.message}`));
    });

    server.listen(currentPort, '0.0.0.0', () => resolve(status()));
  });
}

function stop() {
  if (server) {
    try {
      server.close();
    } catch {
      /* 忽略 */
    }
    server = null;
  }
  return {
    running: false,
    port: currentPort,
    token: currentToken,
    addresses: [],
    endpoints: [],
    hasPrivateNetwork: false,
    publicInterfaces: [],
  };
}

function status() {
  const found = localEndpoints();
  const reachable = found.filter((e) => e.scope !== 'public');
  const url = (e) =>
    e.family === 6 ? `http://[${e.address}]:${currentPort}` : `http://${e.address}:${currentPort}`;
  return {
    running: Boolean(server),
    port: currentPort,
    token: currentToken,
    // 旧字段：只给 IPv4 的可达地址，手机端设置页直接粘这个
    addresses: lanAddresses().map((ip) => `http://${ip}:${currentPort}`),
    // 新字段：带档位，UI 用它区分「Tailscale（换网也通）」和「同一 Wi-Fi 才通」
    endpoints: reachable.map((e) => ({ url: url(e), scope: e.scope, iface: e.iface })),
    hasPrivateNetwork: reachable.some((e) => e.scope === 'cgnat'),
    // 这台机器有公网网卡。服务本身会掐掉公网来源，但这值得让用户知道：
    // 说明它不在路由器后面，任何端口转发或防火墙放行都会立刻变成公网入口。
    publicInterfaces: found.filter((e) => e.scope === 'public').map((e) => e.iface),
  };
}

module.exports = {
  start, stop, status, newToken, readBody, MAX_REMOTE_BODY,
  addressScope, allowedSource, localEndpoints, ALLOWED_SCOPES,
  // handle 只为测试导出：判来源的逻辑写对了，不等于它被接在了请求的最前面。
  handle,
};
