'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Fields that only the model-context machinery needs. They make up ~95% of a
 * run file (a long coding run carries several MB of archived context) and are
 * never needed to list tasks or render a conversation, so the renderer
 * receives records without them and asks for the full record on demand.
 */
const HEAVY_STATE_FIELDS = ['working', 'contextArchive', 'contextArchiveSteps', 'compactions'];
function summaryOf(record) {
  const state = { ...record.state };
  for (const field of HEAVY_STATE_FIELDS) delete state[field];
  state.working = [];
  state.slim = true;
  return { ...record, state };
}
/** A slim record must never replace a full one: restore the heavy fields from the stored record. */
function mergeHeavy(slim, full) {
  const state = { ...slim.state };
  delete state.slim;
  for (const field of HEAVY_STATE_FIELDS) {
    if (full.state[field] === undefined) delete state[field];
    else state[field] = full.state[field];
  }
  return { ...slim, state };
}

/** Separate durable task records: writing a chat bubble is not a checkpoint. */
function createRunStore(root, { io = fs } = {}) {
  const hash = (id) => crypto.createHash('sha256').update(String(id)).digest('hex');
  const location = (kind, id) => path.join(root, kind, `${hash(id)}.json`);
  // A run is written by this process only. Keep the tombstone decision in
  // memory so streaming checkpoints do not parse the whole run on every
  // update. The first write still reads both the primary and its backup.
  const runDisposition = new Map();
  function atomic(file, value) {
    io.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const prev = `${file}.prev`;
    const fd = io.openSync(tmp, 'w', 0o600);
    try { io.writeFileSync(fd, JSON.stringify(value)); io.fsyncSync(fd); }
    finally { io.closeSync(fd); }
    // Rotate on the same volume instead of copying the complete old record.
    // If the process stops between the two renames, read() can still recover
    // the previous committed record from .prev.
    let rotated = false;
    try {
      if (io.existsSync(file)) {
        try { io.unlinkSync(prev); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        io.renameSync(file, prev);
        rotated = true;
      }
      io.renameSync(tmp, file);
    } catch (error) {
      // Best-effort restoration keeps the primary available when a replace
      // fails after rotation. The normal reader also accepts .prev alone.
      if (rotated) {
        try { if (!io.existsSync(file)) io.renameSync(prev, file); } catch { /* retain .prev for recovery */ }
      }
      throw error;
    } finally {
      try { io.unlinkSync(tmp); } catch { /* no unfinished temp */ }
    }
  }
  // Progress checkpoints are written many times per turn and may carry
  // megabytes of partial output. They never block the main process: the write
  // is asynchronous and skips fsync. The record is still replaced by an atomic
  // rename, so a reader always sees one complete version. Dispatch and
  // terminal records keep using the synchronous, fsynced atomic() above, and
  // the caller must finish any pending progress write before writing them.
  const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
  let progressSeq = 0;
  async function atomicProgress(file, value) {
    const fsp = io.promises;
    if (!fsp?.writeFile || !fsp?.rename) { atomic(file, value); return; }
    await fsp.mkdir(path.dirname(file), { recursive: true });
    // A name per write: two overlapping writers must never share (and truncate) one temporary file.
    const tmp = `${file}.progress.${process.pid}.${progressSeq++}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    for (let attempt = 0; ; attempt += 1) {
      try { await fsp.rename(tmp, file); return; }
      catch (error) {
        // Windows can briefly refuse a rename over a file that a virus scanner
        // or indexer is reading. Retry a few times before giving up.
        if (process.platform !== 'win32' || !RETRYABLE.has(error.code) || attempt >= 4) {
          try { await fsp.unlink(tmp); } catch { /* nothing left to remove */ }
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }
  function read(file) {
    for (const p of [file, `${file}.prev`]) {
      try { return JSON.parse(io.readFileSync(p, 'utf8')); } catch { /* try the last committed record */ }
    }
    return null;
  }
  function committedFiles(dir) {
    if (!io.existsSync(dir)) return [];
    const names = new Set();
    for (const name of io.readdirSync(dir)) {
      if (name.endsWith('.json')) names.add(name);
      else if (name.endsWith('.json.prev')) names.add(name.slice(0, -'.prev'.length));
    }
    return [...names].map((name) => path.join(dir, name));
  }
  const summaryLocation = (id) => location('run-summaries', id);
  const stat = (file) => { try { const s = io.statSync(file); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } };
  /** The summary remembers which run file it was built from, so any change to that file is noticed exactly. */
  function writeSummary(record, source = location('runs', record.id)) {
    // Best effort: a missing or stale summary is rebuilt from the full record.
    try {
      const sourceStat = stat(source);
      if (!sourceStat) return;
      const file = summaryLocation(record.id);
      io.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      io.writeFileSync(tmp, JSON.stringify({ ...summaryOf(record), sourceStat }), { mode: 0o600 });
      io.renameSync(tmp, file);
    } catch { /* rebuilt on next list */ }
  }
  function dropSummary(id) { try { io.unlinkSync(summaryLocation(id)); } catch { /* none */ } }
  return {
    summaryOf,
    /** One complete record (with model context), or null when absent or deleted. */
    get(id) {
      const record = read(location('runs', id));
      return record?.id && !record.deleted && record.state ? record : null;
    },
    /**
     * Run summaries for the renderer: the same records as list() without the
     * model context. Served from small per-run summary files; a summary older
     * than its run file is rebuilt, so the first start after an upgrade (or a
     * restored backup) is correct and later starts read ~10 MB instead of GBs.
     */
    async listSummaries() {
      const fsp = io.promises, out = [];
      for (const file of committedFiles(path.join(root, 'runs'))) {
        const id = path.basename(file, '.json');
        const source = stat(file) ? file : `${file}.prev`, current = stat(source);
        if (!current) continue;
        try {
          const cached = JSON.parse(await fsp.readFile(path.join(root, 'run-summaries', `${id}.json`), 'utf8'));
          if (cached?.id && cached.state?.slim && cached.sourceStat?.size === current.size && cached.sourceStat?.mtimeMs === current.mtimeMs) {
            delete cached.sourceStat;
            out.push(cached);
            continue;
          }
        } catch { /* missing or unreadable: rebuild below */ }
        const record = read(file);
        // Let the event loop breathe between large parses while rebuilding.
        await new Promise((resolve) => setImmediate(resolve));
        if (!record?.id || record.deleted || !record.state) continue;
        writeSummary(record, source);
        out.push(summaryOf(record));
      }
      return out;
    },
    save(record) {
      if (!record?.id || !record.conversationId || !record.answerId || !Array.isArray(record.state?.working)) {
        throw new Error('执行记录不完整，已暂停以避免丢失进度');
      }
      const runFile = location('runs', record.id);
      if (record.state.slim) {
        const stored = read(runFile);
        if (!stored?.state) throw new Error('执行记录的完整内容已不在本机，无法保存摘要');
        record = mergeHeavy(record, stored);
      }
      let disposition = runDisposition.get(record.id);
      if (disposition === undefined) {
        disposition = read(runFile)?.deleted ? 'deleted' : 'active';
        runDisposition.set(record.id, disposition);
      }
      if (disposition === 'deleted') return;
      atomic(runFile, record);
      writeSummary(record);
    },
    list() {
      const dir = path.join(root, 'runs');
      return committedFiles(dir).map((file) => read(file)).filter((r) => r?.id && !r.deleted);
    },
    remove(id) { atomic(location('runs', id), { id, deleted: true }); dropSummary(id); runDisposition.set(id, 'deleted'); },
    job(runId, callId) { return read(location('jobs', `${runId}:${callId}`)); },
    saveJob(runId, callId, value) { atomic(location('jobs', `${runId}:${callId}`), value); },
    /** Asynchronous, non-fsynced checkpoint of a running job; see atomicProgress. */
    saveJobProgress(runId, callId, value) { return atomicProgress(location('jobs', `${runId}:${callId}`), value); },
    // 按「做了什么」索引的一层，跨模型、跨轮次都指向同一条记录
    op(runId, opKey) { return read(location('ops', `${runId}:${opKey}`)); },
    saveOp(runId, opKey, value) { atomic(location('ops', `${runId}:${opKey}`), value); },
    saveResult(runId, callId, text) {
      const id = hash(`${runId}:${callId}`);
      atomic(location('results', id), { text: String(text), runId, at: Date.now() });
      return id;
    },
    readResult(id, offset = 0, limit = 8000) {
      const value = read(location('results', id));
      if (!value) throw new Error('找不到这份工具结果，请检查执行记录是否仍在本机');
      const start = Math.max(0, Number(offset) || 0);
      const count = Math.max(1, Math.min(16000, Number(limit) || 8000));
      return { text: value.text.slice(start, start + count), total: value.text.length,
        nextOffset: start + count < value.text.length ? start + count : null };
    },
    saveExchange(exchange) {
      if (!exchange?.requestId) throw new Error('缺少请求编号');
      atomic(location('exchanges', exchange.requestId), exchange);
    },
    exchanges(runId) {
      const dir = path.join(root, 'exchanges');
      return committedFiles(dir).map((file) => read(file)).filter((e) => e && (!runId || e.runId === runId))
        .sort((a, b) => a.at - b.at).slice(-100);
    },
  };
}
let cached;
function runtimeStore() {
  if (!cached) cached = createRunStore(path.join(require('electron').app.getPath('userData'), 'runtime-v2'));
  return cached;
}
module.exports = { createRunStore, runtimeStore, summaryOf, HEAVY_STATE_FIELDS };
