'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const net = require('node:net');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { MEDIA_TYPES, mediaInfo } = require('./media-files.cjs');

/**
 * Media that a model returns inside an API response: an image as base64, an
 * audio clip, a link to a rendered video. Providers differ in how they hand
 * the result back; this turns every form into a file on disk, so everything
 * after it (preview, playback, download, sharing) treats them all alike.
 *
 * Provider links expire, so they are downloaded now rather than shown later.
 */
const MAX_PARTS = 20;
const MAX_INLINE_BASE64 = 400 * 1024 * 1024; // base64 characters held in memory for one inline part
const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;
const MIME_EXT = {};
for (const [ext, info] of Object.entries(MEDIA_TYPES)) MIME_EXT[info.mime] ??= ext;
Object.assign(MIME_EXT, { 'audio/mp3': '.mp3', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/x-m4a': '.m4a', 'image/jpg': '.jpg', 'audio/ogg': '.ogg', 'video/mpeg': '.mp4' });

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return privateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

function cleanName(value) {
  return String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').slice(0, 80);
}

function createGeneratedMedia({
  dir, fetchImpl = (...args) => fetch(...args), lookup = dns.promises.lookup,
  maxBytes = DEFAULT_MAX_BYTES, timeoutMs = 10 * 60 * 1000, now = Date.now,
} = {}) {
  async function assertPublic(url) {
    if (url.protocol !== 'https:') throw Error('只能下载 https 地址的生成结果');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) throw Error('该地址指向本机或内网，已拒绝下载');
  }

  function target(kind, ext, hint) {
    const folder = path.join(dir, new Date(now()).toISOString().slice(0, 10));
    const base = cleanName(hint).replace(/\.[A-Za-z0-9]{1,5}$/, '') || kind;
    const unique = crypto.randomBytes(3).toString('hex');
    return { folder, file: path.join(folder, `${base}-${unique}${ext}`) };
  }

  async function saveInline(part) {
    const base64 = String(part.base64 || '').replace(/^data:[^,]*,/, '');
    if (!base64) throw Error('返回的媒体内容为空');
    if (base64.length > MAX_INLINE_BASE64) throw Error('返回的内嵌媒体超过 400 MB，无法在内存中处理；请改用返回下载链接的接口');
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) throw Error('返回的媒体内容无法解码');
    const ext = MIME_EXT[String(part.mime || '').toLowerCase()] || path.extname(part.name || '').toLowerCase() || (part.kind === 'audio' ? '.wav' : part.kind === 'video' ? '.mp4' : '.png');
    const { folder, file } = target(part.kind || 'media', ext, part.name);
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(file, bytes, { mode: 0o600 });
    return file;
  }

  async function saveLink(part) {
    let url;
    try { url = new URL(part.url); } catch { throw Error('生成结果的链接无效'); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let tmp = null;
    try {
      let response;
      for (let hop = 0; ; hop += 1) {
        await assertPublic(url);
        response = await fetchImpl(url.href, { redirect: 'manual', signal: controller.signal, headers: { Accept: '*/*' } });
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
          if (hop >= 3) throw Error('生成结果的链接重定向次数过多');
          url = new URL(response.headers.get('location'), url);
          continue;
        }
        break;
      }
      if (!response.ok) throw Error(`下载失败（HTTP ${response.status}）。生成结果的链接可能已过期，请重新生成`);
      const declared = Number(response.headers.get('content-length'));
      if (declared > maxBytes) throw Error(`文件 ${(declared / 1024 ** 3).toFixed(1)} GB，超过 ${(maxBytes / 1024 ** 3).toFixed(0)} GB 上限`);
      const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const fromUrl = path.extname(decodeURIComponent(url.pathname)).toLowerCase();
      const ext = mediaInfo(`x${fromUrl}`) ? fromUrl : MIME_EXT[type] || (part.kind === 'video' ? '.mp4' : part.kind === 'audio' ? '.mp3' : part.kind === 'image' ? '.png' : fromUrl);
      if (!ext || !response.body) throw Error('无法确定下载内容的类型');
      const { folder, file } = target(part.kind || 'media', ext, part.name || path.basename(decodeURIComponent(url.pathname)));
      await fs.promises.mkdir(folder, { recursive: true });
      tmp = `${file}.part`;
      let received = 0;
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > maxBytes) callback(Error(`文件超过 ${(maxBytes / 1024 ** 3).toFixed(0)} GB 上限，已停止下载`));
        else callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(tmp, { mode: 0o600 }), { signal: controller.signal });
      await fs.promises.rename(tmp, file); tmp = null;
      return file;
    } catch (error) {
      if (controller.signal.aborted) throw Error('下载超时。生成结果的链接可能已过期，请重新生成');
      throw error;
    } finally {
      clearTimeout(timer);
      if (tmp) await fs.promises.rm(tmp, { force: true }).catch(() => {});
    }
  }

  return {
    /** Save every part; one failing download never hides the ones that worked. */
    async save(parts) {
      const files = [], errors = [];
      for (const part of (Array.isArray(parts) ? parts : []).slice(0, MAX_PARTS)) {
        try {
          const file = part?.base64 ? await saveInline(part) : part?.url ? await saveLink(part) : (() => { throw Error('没有可保存的媒体内容'); })();
          const stat = await fs.promises.stat(file);
          files.push({ path: file, name: path.basename(file), size: stat.size, modifiedAt: stat.mtimeMs });
        } catch (error) {
          errors.push({ name: part?.name || part?.kind || '媒体', error: String(error.message || error) });
        }
      }
      return { files, errors };
    },
  };
}

module.exports = { createGeneratedMedia, privateAddress };
