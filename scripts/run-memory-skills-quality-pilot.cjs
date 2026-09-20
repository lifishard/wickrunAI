'use strict';

// Four-call, real-provider pilot for production memory/skill prompt injection.
// Reads the configured free SenseNova credential in memory and sends synthetic facts only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

const worktree = path.resolve(__dirname, '..');
const productionRepo = worktree;
const outputRoot = path.resolve(process.argv[2] || path.join(worktree, 'artifacts', 'memory-skills-quality'));
const isolatedUserData = path.join(outputRoot, 'user-data');
const dailyUserData = path.join(process.env.APPDATA || '', 'anyai');
const dailyStore = path.join(dailyUserData, 'store.json');
const dailyLocalState = path.join(dailyUserData, 'Local State');
const isolatedLocalState = path.join(isolatedUserData, 'Local State');
const model = 'deepseek-v4-flash';
const maxOutputTokens = 2_000;
const asOf = Date.parse('2026-09-20T20:00:00Z');

const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeError = value => String(value?.message || value || 'unknown error')
  .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
  .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);

fs.mkdirSync(isolatedUserData, { recursive: true });
if (fs.existsSync(dailyLocalState)) fs.copyFileSync(dailyLocalState, isolatedLocalState);
app.setName('AnyAI');
app.setPath('userData', isolatedUserData);
app.setPath('sessionData', isolatedUserData);

function decrypt(record) {
  if (!record) throw Error('configured credential missing');
  return record.enc ? safeStorage.decryptString(Buffer.from(record.v, 'base64')) : record.v;
}

function configuredSenseNova() {
  const source = JSON.parse(fs.readFileSync(dailyStore, 'utf8'));
  const settings = JSON.parse(source.kv?.['snc:settings:v1'] || '{}');
  const profile = settings.keyProfiles?.find(item => item.name === 'testing' && item.baseUrl === 'https://token.sensenova.cn/v1');
  if (!profile || !source.secrets?.[profile.id]) throw Error('authorized SenseNova free route is unavailable');
  return { profile, key: decrypt(source.secrets[profile.id]) };
}

function memory(id, text, overrides = {}) {
  return {
    id, title: 'Synthetic launch fact', text, applicability: 'Synthetic launch-code questions only',
    evidence: 'synthetic benchmark fixture', status: 'adopted', revision: 1, kind: 'fact', scope: 'task',
    keywords: ['launch code'], createdAt: 1, ...overrides,
  };
}

function skill(enabled = true) {
  return {
    id: 'synthetic-json-answer', name: 'synthetic-json-answer',
    description: 'Return the synthetic answer as a strict JSON object.',
    body: 'Return exactly one JSON object with only the string field "answer". Do not add Markdown or prose. If the requested fact is unavailable, use "unknown".',
    source: 'synthetic:memory-skills-pilot', enabled, installedAt: 1, uses: 0,
  };
}

function strictAnswer(text, expected) {
  let parsed;
  try { parsed = JSON.parse(text.trim()); } catch { return { passed: false, failures: ['invalid_json'], actual: null }; }
  const failures = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) failures.push('not_object');
  if (parsed && Object.keys(parsed).sort().join(',') !== 'answer') failures.push('fields');
  if (parsed?.answer !== expected) failures.push('answer');
  return { passed: failures.length === 0, failures, actual: typeof parsed?.answer === 'string' ? parsed.answer : null };
}

function usageOf(data) {
  const usage = data?.usage || {};
  const input = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const output = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
  const total = Number.isFinite(usage.total_tokens) ? usage.total_tokens : input !== null && output !== null ? input + output : null;
  return { input, output, total };
}

async function request(api, profile, key, system, user) {
  const started = Date.now();
  try {
    const response = await fetch(api.endpoint(profile.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: api.buildHeaders(key, profile),
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxOutputTokens, temperature: 0, stream: false }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    return {
      ok: response.ok,
      httpStatus: response.status,
      elapsedMs: Date.now() - started,
      usage: usageOf(data),
      finishReason: data?.choices?.[0]?.finish_reason ?? null,
      content: typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : '',
      error: response.ok ? null : safeError(data?.error?.message || data?.message || `HTTP ${response.status}`),
    };
  } catch (error) {
    return { ok: false, httpStatus: null, elapsedMs: Date.now() - started,
      usage: { input: null, output: null, total: null }, finishReason: null, content: '', error: safeError(error) };
  }
}

app.whenReady().then(async () => {
  const version = JSON.parse(fs.readFileSync(path.join(productionRepo, 'package.json'), 'utf8')).version;
  if (version !== '2.17.10') throw Error(`expected production source 2.17.10, found ${version}`);
  const { profile, key } = configuredSenseNova();
  try { fs.rmSync(isolatedLocalState, { force: true }); } catch {}

  const { loader } = require(path.join(productionRepo, 'tests', 'load-ts.cjs'));
  const load = loader({ './transport': { getTransport() { throw Error('not used'); } } });
  const memoryApi = load(path.join(productionRepo, 'src', 'lib', 'team-memory.ts'));
  const skillsApi = load(path.join(productionRepo, 'src', 'lib', 'skills.ts'));
  const api = load(path.join(productionRepo, 'src', 'lib', 'api.ts'));
  const cases = [
    {
      id: 'no-context', expected: 'unknown',
      memories: [], skills: [],
      user: 'What is the synthetic launch code? Use only facts supplied in this request or approved memory.',
    },
    {
      id: 'adopted-memory-and-enabled-skill', expected: 'zephyr-417',
      memories: [memory('launch-current', 'The synthetic launch code is zephyr-417.')], skills: [skill(true)],
      user: 'What is the synthetic launch code? Use only facts supplied in this request or approved memory.',
    },
    {
      id: 'current-user-correction-wins', expected: 'cobalt-732',
      memories: [memory('launch-old', 'The synthetic launch code is amber-111.')], skills: [skill(true)],
      user: 'Correction for this request: the synthetic launch code is cobalt-732. What is the synthetic launch code?',
    },
    {
      id: 'revoked-expired-disabled-omitted', expected: 'unknown',
      memories: [
        memory('launch-revoked', 'The synthetic launch code is should-not-appear-1.', { status: 'invalid' }),
        memory('launch-expired', 'The synthetic launch code is should-not-appear-2.', { expiresAt: asOf }),
      ],
      skills: [skill(false)],
      user: 'What is the synthetic launch code? Use only facts supplied in this request or approved memory.',
    },
  ];

  const rows = [];
  for (const item of cases) {
    const task = { goal: item.user, acceptance: 'Return an evidence-bounded machine-readable answer.' };
    const selection = memoryApi.selectTeamMemories(item.memories, task, { now: asOf });
    const memoryBlock = memoryApi.teamMemorySystemBlock(selection);
    const skillBlock = skillsApi.skillSystemBlock(item.skills);
    const skillRead = skillsApi.readSkill(item.skills, { name: 'synthetic-json-answer' });
    const system = [
      'This is a synthetic benchmark. Answer only from the current user request or injected approved memory. Never guess. If the fact is absent, answer unknown. Return exactly one JSON object with only the string field "answer".',
      memoryBlock,
      skillBlock,
    ].filter(Boolean).join('\n\n');
    const result = await request(api, profile, key, system, item.user);
    const check = result.ok ? strictAnswer(result.content, item.expected) : { passed: false, failures: ['request_failed'], actual: null };
    rows.push({
      id: item.id,
      expected: item.expected,
      provider: { ok: result.ok, httpStatus: result.httpStatus, elapsedMs: result.elapsedMs,
        usage: result.usage, finishReason: result.finishReason, error: result.error },
      check,
      injection: {
        selectedMemoryIds: selection.snapshots.map(entry => `${entry.id}@${entry.revision}`),
        memoryAudit: selection.audit,
        memoryBlockBytes: Buffer.byteLength(memoryBlock),
        memoryBlockSha256: memoryBlock ? hash(memoryBlock) : null,
        skillBlockBytes: Buffer.byteLength(skillBlock),
        skillBlockSha256: skillBlock ? hash(skillBlock) : null,
        skillReadOk: skillRead.ok,
      },
      responseSha256: result.content ? hash(result.content) : null,
      responseBytes: Buffer.byteLength(result.content),
    });
    if (rows.length < cases.length) await sleep(2_500);
  }

  const sourceFiles = ['package.json', 'src/lib/team-memory.ts', 'src/lib/skills.ts', 'src/lib/api.ts'];
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(path.join(productionRepo, file)))]));
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    engineSnapshot: { version, sourceSha256: sourceHashes },
    route: { family: 'SenseNova', model, fixed: true, automaticFailover: false, paidRoutesAllowed: false },
    callLimit: 4,
    callsMade: rows.length,
    maxOutputTokensPerCall: maxOutputTokens,
    syntheticInputOnly: true,
    results: rows,
    summary: {
      passed: rows.every(row => row.check.passed),
      passedCases: rows.filter(row => row.check.passed).length,
      falseKnowledgeCases: rows.filter(row => row.check.actual !== row.expected).length,
      providerReportedUsage: {
        input: rows.every(row => Number.isFinite(row.provider.usage.input)) ? rows.reduce((n, row) => n + row.provider.usage.input, 0) : null,
        output: rows.every(row => Number.isFinite(row.provider.usage.output)) ? rows.reduce((n, row) => n + row.provider.usage.output, 0) : null,
        total: rows.every(row => Number.isFinite(row.provider.usage.total)) ? rows.reduce((n, row) => n + row.provider.usage.total, 0) : null,
      },
    },
    limitations: [
      'Four single-turn synthetic cases test prompt injection behavior, not the complete agent or team lifecycle.',
      'The pilot does not establish general model quality, long-horizon memory quality, retrieval recall, or skill tool execution quality.',
      'Provider token counts are usage telemetry, not a monetary bill.',
    ],
  };
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'anonymous-report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ report: path.join(outputRoot, 'anonymous-report.json'), callsMade: rows.length,
    passed: report.summary.passed, providerReportedUsage: report.summary.providerReportedUsage }, null, 2) + '\n');
}).catch(error => {
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'anonymous-report.json'), JSON.stringify({ schemaVersion: 1,
    createdAt: new Date().toISOString(), fatal: safeError(error), callsMade: 0 }, null, 2) + '\n');
  process.stderr.write(safeError(error) + '\n');
  process.exitCode = 1;
}).finally(() => app.quit());

