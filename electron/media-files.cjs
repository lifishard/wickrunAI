'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectFile } = require('./file-records.cjs');

/**
 * Files that models and agents produce but the app cannot read into memory:
 * videos, audio, large images and archives.
 *
 * Nothing here depends on which model or client made the file. A native
 * client, a tool call, a generation API and a script all end the same way: a
 * file on disk that the person should be able to see, play and save.
 */
const MEDIA_TYPES = {
  // video: containers a Chromium-based window can normally play
  '.mp4': { kind: 'video', mime: 'video/mp4' }, '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' }, '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.ogv': { kind: 'video', mime: 'video/ogg' }, '.mkv': { kind: 'video', mime: 'video/x-matroska' },
  '.avi': { kind: 'video', mime: 'video/x-msvideo' },
  // audio
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' }, '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' }, '.aac': { kind: 'audio', mime: 'audio/aac' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' }, '.oga': { kind: 'audio', mime: 'audio/ogg' },
  '.opus': { kind: 'audio', mime: 'audio/ogg' }, '.flac': { kind: 'audio', mime: 'audio/flac' },
  // image
  '.png': { kind: 'image', mime: 'image/png' }, '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' }, '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' }, '.avif': { kind: 'image', mime: 'image/avif' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
  // other deliverables that can be larger than an in-app preview allows
  '.pdf': { kind: 'file', mime: 'application/pdf' }, '.zip': { kind: 'file', mime: 'application/zip' },
  '.pptx': { kind: 'file', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.docx': { kind: 'file', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xlsx': { kind: 'file', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.7z': { kind: 'file', mime: 'application/x-7z-compressed' }, '.tar': { kind: 'file', mime: 'application/x-tar' },
  '.gz': { kind: 'file', mime: 'application/gzip' },
};
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__']);

function mediaInfo(name) {
  return MEDIA_TYPES[path.extname(String(name || '')).toLowerCase()] || null;
}

/**
 * Deliverable files written under `roots` since `sinceMs`. Only file metadata
 * is read, never content, so a 2 GB video costs the same as a 2 KB note.
 */
function detectOutputFiles(roots, sinceMs, {
  maxFiles = 50, maxVisited = 20000, maxDepth = 8, now = Date.now,
} = {}) {
  const found = [];
  let visited = 0;
  let truncated = false;
  const seenDirs = new Set();
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= maxFiles || visited >= maxVisited) { truncated = true; return; }
    let real;
    try { real = fs.realpathSync.native(dir); } catch { return; }
    if (seenDirs.has(real)) return;
    seenDirs.add(real);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= maxFiles || visited >= maxVisited) { truncated = true; return; }
      visited += 1;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1); continue; }
      if (!entry.isFile() || !mediaInfo(entry.name)) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size <= 0 || stat.mtimeMs < sinceMs - 1000 || stat.mtimeMs > now() + 60000) continue;
      found.push({ path: full, name: entry.name, size: stat.size, modifiedAt: stat.mtimeMs });
    }
  };
  for (const root of new Set((roots || []).filter(Boolean))) walk(root, 0);
  return { files: found.sort((a, b) => b.modifiedAt - a.modifiedAt), truncated };
}

/** Parse a single `Range: bytes=…` header against a known size. */
function parseRange(header, size) {
  if (header === undefined || header === null || header === '') return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start, end;
  if (match[1] === '') { // suffix: the last N bytes
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  }
  if (start >= size || start > end) return null;
  return { start, end, partial: true };
}

/**
 * A streaming response for a local file, with byte ranges. Video players seek
 * by asking for ranges; without them a long clip cannot be scrubbed and has
 * to download completely before it can start.
 */
function fileResponse(filePath, rangeHeader, { openStream = fs.createReadStream } = {}) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: null, message: 'File not found.' }; }
  if (!stat.isFile()) return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: null, message: 'File not found.' };
  const info = mediaInfo(filePath);
  const base = {
    'Content-Type': info?.mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = parseRange(rangeHeader, stat.size);
  if (!range) return { status: 416, headers: { ...base, 'Content-Range': `bytes */${stat.size}` }, body: null, message: 'Range not satisfiable.' };
  const length = range.end - range.start + 1;
  const headers = { ...base, 'Content-Length': String(length) };
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
  return {
    status: range.partial ? 206 : 200, headers, size: stat.size, start: range.start, end: range.end,
    body: length === 0 ? null : openStream(filePath, { start: range.start, end: range.end }),
  };
}

/**
 * Short-lived, unguessable handles for files the renderer may display. The
 * renderer never names a path to the protocol handler; it names a token that
 * the main process issued after checking the path against the allowed roots.
 */
function createMediaTokens({ roots, limit = 500, ttlMs = 12 * 60 * 60 * 1000, now = Date.now } = {}) {
  const tokens = new Map();
  const prune = () => {
    const t = now();
    for (const [key, entry] of tokens) if (entry.expiresAt <= t) tokens.delete(key);
    while (tokens.size > limit) tokens.delete(tokens.keys().next().value);
  };
  return {
    /** Verify `candidate` lies inside an allowed root and is a real file, then issue a handle. */
    issue(candidate) {
      const file = inspectFile(candidate, roots());
      prune();
      const token = crypto.randomBytes(16).toString('hex');
      tokens.set(token, { path: file.path, expiresAt: now() + ttlMs });
      return { token, name: file.name, size: file.size, ...(mediaInfo(file.name) || { kind: 'file', mime: 'application/octet-stream' }) };
    },
    resolve(token) {
      prune();
      const entry = tokens.get(String(token || ''));
      return entry ? entry.path : null;
    },
    get size() { return tokens.size; },
  };
}

module.exports = { MEDIA_TYPES, mediaInfo, detectOutputFiles, parseRange, fileResponse, createMediaTokens };
