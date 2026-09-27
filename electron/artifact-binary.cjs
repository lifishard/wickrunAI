'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createDurableJson } = require('./durable-json.cjs');
const LIMIT = 25 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function createBinaryWorkspace(root) {
  function file(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || fs.lstatSync(p).isSymbolicLink()) throw Error('请选择原始文档。');
    const real = fs.realpathSync(p), ext = path.extname(real).toLowerCase();
    if (!['.docx', '.xlsx', '.xlsm', '.pdf'].includes(ext)) throw Error('不支持编辑此格式。');
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > LIMIT) throw Error('文档编辑上限为 25 MB。');
    const bytes = fs.readFileSync(real);
    if (bytes.length > LIMIT) throw Error('文档编辑上限为 25 MB。');
    return { path: real, ext, bytes, hash: digest(bytes), mode: stat.mode };
  }
  function storage(p) {
    const dir = path.join(root, digest(process.platform === 'win32' ? p.toLowerCase() : p));
    const store = createDurableJson(path.join(dir, 'history.json'), { initial: () => [], validate: entries => {
      if (!Array.isArray(entries) || entries.length > 9 || entries.some(e => !/^[a-f0-9]{64}$/.test(e.hash) || !Number.isFinite(e.at))) throw Error('文档版本记录损坏。');
    } });
    return { dir, store };
  }
  function read(p) {
    const current = file(p);
    return { path: current.path, hash: current.hash, bytes: new Uint8Array(current.bytes), versions: storage(current.path).store.read().filter(v => v.hash !== current.hash).reverse() };
  }
  function save({ path: p, expectedHash, bytes }) {
    const current = file(p);
    if (current.hash !== expectedHash) throw Error('文档已被其他程序修改。草稿已保留，请重新读取后合并。');
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > LIMIT) throw Error('文档大小无效。');
    const next = Buffer.from(bytes);
    if (current.ext === '.pdf' ? !next.subarray(0, 5).equals(Buffer.from('%PDF-')) : !next.subarray(0, 2).equals(Buffer.from('PK'))) throw Error('文档格式不匹配，未保存。');
    if (digest(next) === current.hash) return read(current.path);
    const { dir, store } = storage(current.path), versions = store.read().filter(v => v.hash !== current.hash);
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, current.hash + '.bin');
    if (!fs.existsSync(backup)) { const fd = fs.openSync(backup, 'wx', 0o600); try { fs.writeFileSync(fd, current.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    if (digest(fs.readFileSync(backup)) !== current.hash) throw Error('版本备份校验失败，未修改文件。');
    versions.push({ hash: current.hash, at: Date.now() }); store.write(versions.slice(-9));
    const temp = current.path + '.' + crypto.randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temp, 'wx', current.mode); try { fs.writeFileSync(fd, next); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (file(p).hash !== current.hash) throw Error('文档已变化，已停止覆盖。');
      fs.renameSync(temp, current.path);
    } finally { try { fs.unlinkSync(temp); } catch {} }
    // Keep backups referenced by either durable manifest generation. Never recurse.
    const keep=new Set(store.read().map(v=>v.hash));
    try{for(const v of JSON.parse(fs.readFileSync(path.join(dir,'history.json.prev'),'utf8')))keep.add(v.hash);}catch{}
    for(const name of fs.readdirSync(dir))if(/^[a-f0-9]{64}\.bin$/.test(name)&&!keep.has(name.slice(0,-4)))fs.unlinkSync(path.join(dir,name));
    return read(current.path);
  }
  function restore({ path: p, expectedHash, version }) {
    const current = file(p), { dir, store } = storage(current.path);
    if (!store.read().some(v => v.hash === version)) throw Error('找不到此版本。');
    const bytes = fs.readFileSync(path.join(dir, version + '.bin'));
    if (digest(bytes) !== version) throw Error('版本文件校验失败，未恢复。');
    return save({ path: current.path, expectedHash, bytes });
  }
  return { read, save, restore };
}
module.exports = { createBinaryWorkspace };
