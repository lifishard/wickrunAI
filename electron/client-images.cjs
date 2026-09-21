'use strict';

// Only accept inline attachment bytes. Never turn renderer-supplied paths or
// remote URLs into host file reads/network requests.
function normalizeImages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw Error('图片附件列表无效，单次最多 100 张。');
  let total = 0;
  return value.map(url => {
    if (typeof url !== 'string' || url.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 + 64) throw Error('图片附件超过 20MB 上限。');
    const header = /^data:(image\/(?:png|jpeg|gif|webp));base64,/.exec(url);
    if (!header) throw Error('本机图片附件须为 PNG、JPEG、GIF 或 WebP，请重新添加图片。');
    const data = url.slice(header[0].length);
    if (!data || data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data) || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw Error('图片附件数据无效，请重新添加图片。');
    const bytes = Buffer.byteLength(data, 'base64');
    if (bytes > 20 * 1024 * 1024) throw Error('图片附件超过 20MB 上限。');
    total += bytes;
    if (total > 100 * 1024 * 1024) throw Error('本轮图片合计超过 100MB，请减少图片后重试。');
    return { dataUrl: url, mimeType: header[1], data };
  });
}
module.exports = { normalizeImages };
