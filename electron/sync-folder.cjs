'use strict';
/**
 * 同步的落点：一个文件夹。
 *
 * 没有服务器，是有意的。这个应用的前提是「密钥不离开你的机器」，再自建一个
 * 收全部对话的服务器，等于把刚拒绝掉的信任又请回来。一个文件夹能同时满足
 * 所有人的现成条件：Syncthing 的共享目录、网盘的同步目录、tailnet 上挂的一个
 * 共享盘、甚至一个 U 盘 —— 用户已经有哪个就用哪个，不用再多信任一方。
 *
 * 落点上的东西一律是密文（见 sync-crypto.cjs），所以「这个文件夹是不是安全的」
 * 这个问题不需要回答。
 *
 * 每台设备只写自己那一个文件：<deviceId>.wsync。互不覆盖，也就没有写冲突 ——
 * 合并发生在读到之后，在各自的机器上，不在文件夹里。
 */
const fs = require('node:fs');
const path = require('node:path');
const { seal, open, MAX_SEALED_BYTES } = require('./sync-crypto.cjs');

const EXT = '.wsync';
/** 设备号是随机 UUID，不含任何机器信息 —— 文件名会躺在落点上被人看见。 */
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILES = 32;

function requireValue(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * 落点目录本身要过一遍检查。
 * 不跟符号链接：落点是用户指的目录，链接指到哪里不该由它说了算。
 */
function checkDir(dir) {
  requireValue(typeof dir === 'string' && dir && path.isAbsolute(dir), '同步文件夹必须是绝对路径');
  const resolved = path.resolve(dir);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error('同步文件夹不存在');
  }
  requireValue(!stat.isSymbolicLink(), '同步文件夹是符号链接，拒绝使用');
  requireValue(stat.isDirectory(), '同步路径不是文件夹');
  return resolved;
}

function checkDeviceId(id) {
  requireValue(typeof id === 'string' && DEVICE_ID.test(id), '设备编号格式无效');
  return id;
}

/** 写这台设备自己那一份。先写临时文件再改名，读的一方永远看不到半份。 */
function push(dir, deviceId, payload, passphrase) {
  const root = checkDir(dir);
  const id = checkDeviceId(deviceId);
  const sealed = seal({ deviceId: id, at: Date.now(), payload }, passphrase);
  requireValue(Buffer.byteLength(sealed) <= MAX_SEALED_BYTES, '同步包超过大小上限');
  const target = path.join(root, id + EXT);
  const tmp = target + '.' + process.pid + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, sealed);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, target);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* 已经关了 */ }
    if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch { /* 清不掉就留着 */ }
  }
  return { deviceId: id, bytes: Buffer.byteLength(sealed), file: id + EXT };
}

/**
 * 读落点上除自己以外的每一份。
 *
 * 单份打不开不算失败：换过口令、别人放了个同名文件、或者一份写到一半 ——
 * 这些都不该让整次同步中止。打不开的记下来报给用户，能开的照常合。
 */
function pull(dir, selfDeviceId, passphrase) {
  const root = checkDir(dir);
  const self = checkDeviceId(selfDeviceId);
  const names = fs
    .readdirSync(root)
    .filter((n) => n.endsWith(EXT) && DEVICE_ID.test(n.slice(0, -EXT.length)))
    .filter((n) => n.slice(0, -EXT.length) !== self)
    .sort();
  requireValue(names.length <= MAX_FILES, `同步文件夹里有超过 ${MAX_FILES} 台设备的包，请先清理`);

  const bundles = [];
  const failures = [];
  for (const name of names) {
    const target = path.join(root, name);
    try {
      const stat = fs.lstatSync(target);
      // 同样不跟链接，也不读超限的文件
      requireValue(stat.isFile(), '不是普通文件');
      requireValue(stat.size <= MAX_SEALED_BYTES, '超过大小上限');
      const value = open(fs.readFileSync(target, 'utf8'), passphrase);
      // 文件名声称的设备号必须和包里签的对得上，否则这个包的来源是可疑的
      requireValue(value && value.deviceId === name.slice(0, -EXT.length), '包里的设备编号和文件名对不上');
      requireValue(Number.isFinite(value.at), '包里没有有效的时间');
      bundles.push(value);
    } catch (e) {
      failures.push({ file: name, error: e.message });
    }
  }
  return { bundles, failures };
}

/** 落点上有几台设备、各自什么时候写的。不需要口令，用来做「连通了没」的提示。 */
function peek(dir) {
  const root = checkDir(dir);
  return fs
    .readdirSync(root)
    .filter((n) => n.endsWith(EXT) && DEVICE_ID.test(n.slice(0, -EXT.length)))
    .map((n) => {
      const stat = fs.lstatSync(path.join(root, n));
      return { deviceId: n.slice(0, -EXT.length), bytes: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

module.exports = { push, pull, peek, EXT, MAX_FILES, DEVICE_ID };
