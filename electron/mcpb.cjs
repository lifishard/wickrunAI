'use strict';
/*
 * 生成 Claude Desktop 扩展包（.mcpb）。
 *
 * .mcpb 就是一个 zip：manifest.json + 服务端脚本（+ 可选图标）。
 * 双击后 Claude Desktop 弹出安装界面，用它自带的 Node.js 运行，
 * 不依赖用户装没装 Node，也绕开了微软商店版读哪份 claude_desktop_config.json 的问题。
 *
 * 这里只需要「存储」（不压缩）的 zip，自己写几十行，不引依赖。
 */
const fs = require('node:fs');
const path = require('node:path');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{name, data:Buffer}] → 不压缩的 zip */
function zipStore(entries, date = new Date()) {
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const TOOLS = [
  ['wickrun_claim_task', '领取最早排队的一个灯芯AI 任务'],
  ['wickrun_get_task', '读取任务目标、授权的工作模型与限制'],
  ['wickrun_delegate_task', '把子任务派给授权的 API 工作模型'],
  ['wickrun_read_worker_result', '读取工作模型的结果'],
  ['wickrun_report_progress', '向灯芯AI 汇报进度'],
  ['wickrun_submit_result', '把最终成果交回灯芯AI'],
  ['wickrun_report_blocked', '说明任务受阻的原因'],
  ['wickrun_list_tasks', '列出发给 Claude 的任务'],
];

/**
 * 生成扩展包。connectionFile 是本机桥接的私有连接文件（地址 + 令牌），
 * 扩展启动时读它；wickrunAI 重启换了端口也能跟上，因为文件会被刷新。
 */
function buildMcpb({ outFile, serverFile, connectionFile, version, iconFile }) {
  let icon = null;
  if (iconFile) { try { icon = fs.readFileSync(iconFile); } catch { /* 图标可选 */ } }
  const manifest = {
    manifest_version: '0.3',
    name: 'wickrun-ai',
    display_name: '灯芯AI wickrunAI',
    version: /^\d+\.\d+\.\d+/.test(version || '') ? version : '1.0.0',
    description: '让 Claude 领取并完成灯芯AI（wickrunAI）排队的任务，结果交回灯芯AI。',
    long_description: '连接本机运行的灯芯AI。Claude 用 wickrun_claim_task 领取任务，完成后用 wickrun_submit_result 交回；缺权限或信息时用 wickrun_report_blocked 说明原因。API 密钥始终留在灯芯AI 里，扩展只保存本机连接地址。需要灯芯AI 保持运行。',
    author: { name: 'wickrunAI contributors' },
    homepage: 'https://github.com/lifishard/wickrunAI',
    ...(icon ? { icon: 'icon.png' } : {}),
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: { command: 'node', args: ['${__dirname}/server/index.js', connectionFile] },
    },
    tools: TOOLS.map(([name, description]) => ({ name, description })),
    compatibility: { platforms: ['win32', 'darwin'], runtimes: { node: '>=20.0.0' } },
    license: 'Apache-2.0',
  };
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: 'server/index.js', data: fs.readFileSync(serverFile) },
  ];
  if (icon) entries.push({ name: 'icon.png', data: icon });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, zipStore(entries));
  return { file: outFile, manifest };
}

module.exports = { buildMcpb, zipStore, crc32 };
