'use strict';

// Real-provider, headless acceptance pilot for the three collaboration strategies.
// It reads the user's existing encrypted connection records, decrypts them in memory,
// sends only the synthetic fixture, and writes no credentials or request headers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

const repo = path.resolve(__dirname, '..');
const outputRoot = path.resolve(process.argv[2] || path.join(repo, 'artifacts', 'team-strategy-comparison'));
const fixture = require(path.join(repo, 'tests', 'fixtures', 'team-strategy-case.cjs'));
const { loader } = require(path.join(repo, 'tests', 'load-ts.cjs'));
const sourceStore = path.join(process.env.APPDATA || '', 'anyai', 'store.json');
const sourceLocalState = path.join(process.env.APPDATA || '', 'anyai', 'Local State');
const userData = path.join(outputRoot, 'user-data');
const projectId = `strategy-comparison-${Date.now()}`;
// The production harness may spend a second round turning discussion/review
// notes into a checked handoff. Twenty thousand per stage avoids a known false
// "budget exhausted" result while keeping every arm on the same 60k ceiling.
const runBudget = 60_000;
const memberBudget = 20_000;

fs.mkdirSync(userData, { recursive: true });
// Chromium's v10 ciphertext is bound to the encrypted key in Local State. Copy
// that machine-bound metadata into the isolated profile; never read or modify
// the daily profile itself.
if (fs.existsSync(sourceLocalState)) {
  fs.copyFileSync(sourceLocalState, path.join(userData, 'Local State'));
}
// Keep the same internal Chromium identity as the installed app. The project
// intentionally retained the historical AnyAI identity so existing safeStorage
// ciphertext remains decryptable after the product rename.
app.setName('AnyAI');
app.setPath('userData', userData);
app.setPath('sessionData', userData);

const nowIso = () => new Date().toISOString();
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeError(value) {
  const text = String(value?.message || value || 'unknown error');
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 500);
}

function decrypt(record) {
  if (!record) throw Error('configured credential missing');
  return record.enc ? safeStorage.decryptString(Buffer.from(record.v, 'base64')) : record.v;
}

function usageOf(data) {
  const u = data?.usage;
  if (!u || typeof u !== 'object') return { input: null, output: null, total: null };
  const input = Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
  const output = Number.isFinite(u.completion_tokens) ? u.completion_tokens : null;
  const total = Number.isFinite(u.total_tokens) ? u.total_tokens : input !== null && output !== null ? input + output : null;
  return { input, output, total };
}

async function post(profile, key, model, messages, maxTokens, timeoutMs = 45_000) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(profile.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
        ...(profile.extraHeaders || {}),
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    const content = data?.choices?.[0]?.message?.content;
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - started,
      content: typeof content === 'string' ? content : '',
      hasContent: typeof content === 'string' && content.length > 0,
      finishReason: data?.choices?.[0]?.finish_reason ?? null,
      usage: usageOf(data),
      error: response.ok ? null : safeError(data?.error?.message || data?.message || `HTTP ${response.status}`),
    };
  } catch (error) {
    return { ok: false, status: null, elapsedMs: Date.now() - started, content: '', finishReason: null,
      usage: { input: null, output: null, total: null }, error: safeError(error) };
  }
}

function configuredRoutes() {
  if (!fs.existsSync(sourceStore)) throw Error('daily configuration store is unavailable');
  const source = JSON.parse(fs.readFileSync(sourceStore, 'utf8'));
  const settings = JSON.parse(source.kv?.['snc:settings:v1'] || '{}');
  const find = (name, baseUrl) => settings.keyProfiles?.find(p => p.name === name && p.baseUrl === baseUrl);
  const sense = find('testing', 'https://token.sensenova.cn/v1');
  const router = find('openrouter_free', 'https://openrouter.ai/api/v1');
  const omni = find('omni', 'http://localhost:20128/v1');
  const candidates = [
    { family: 'SenseNova', profile: sense, model: 'deepseek-v4-flash', fixed: true },
    { family: 'SenseNova', profile: sense, model: 'sensenova-6.8-flash-lite', fixed: true },
    { family: 'OpenRouter', profile: router, model: 'qwen/qwen3.8-27b:free', fixed: true },
    // Authorized readiness fallback only. This is an auto route, so it is never
    // selected for the fixed-model comparison even if it answers successfully.
    { family: 'omni', profile: omni, model: 'auto/coding:free', fixed: false },
  ];
  return candidates.map(candidate => ({
    ...candidate,
    key: candidate.profile && source.secrets?.[candidate.profile.id] ? decrypt(source.secrets[candidate.profile.id]) : null,
  }));
}

function probePublic(candidate, result) {
  return {
    family: candidate.family,
    model: candidate.model,
    fixed: candidate.fixed,
    configured: Boolean(candidate.profile && candidate.key),
    ok: result?.ok ?? false,
    httpStatus: result?.status ?? null,
    elapsedMs: result?.elapsedMs ?? null,
    usage: result?.usage ?? { input: null, output: null, total: null },
    hasContent: result?.hasContent ?? false,
    finishReason: result?.finishReason ?? null,
    error: result?.error ?? (candidate.profile && candidate.key ? null : 'configured route or credential unavailable'),
  };
}

function transportFor(profile, key, requestLog) {
  return {
    kind: 'electron',
    canRunTools: () => false,
    abort: async () => {},
    callTool: async () => ({ ok: false, content: '', error: 'This benchmark has no tools.' }),
    kvGet: async () => null,
    kvSet: async () => {},
    secretGet: async () => null,
    secretSet: async () => {},
    secretDelete: async () => {},
    getJson: async () => { throw Error('model listing is outside this benchmark'); },
    async chat(init, handlers) {
      const started = Date.now();
      let response;
      try {
        response = await fetch(init.url, {
          method: 'POST',
          headers: init.headers,
          body: JSON.stringify(init.body),
          signal: AbortSignal.timeout(init.timeoutMs),
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = {}; }
        const usage = usageOf(data);
        const row = {
          requestId: init.requestId,
          purpose: init.purpose || null,
          status: response.status,
          elapsedMs: Date.now() - started,
          usage,
          finishReason: data?.choices?.[0]?.finish_reason ?? null,
          ok: response.ok,
        };
        requestLog.push(row);
        handlers.onResponse?.(response.status, {});
        if (!response.ok) {
          handlers.onError(safeError(data?.error?.message || data?.message || `HTTP ${response.status}`), response.status);
          return;
        }
        const choice = data?.choices?.[0]?.message || {};
        if (choice.reasoning_content) handlers.onReasoning?.(String(choice.reasoning_content));
        if (choice.content) handlers.onContent(String(choice.content));
        if (usage.total !== null) handlers.onUsage({ prompt_tokens: usage.input ?? undefined, completion_tokens: usage.output ?? undefined, total_tokens: usage.total });
        handlers.onStop?.({ reason: data?.choices?.[0]?.finish_reason ?? null, droppedCalls: 0 });
        handlers.onDone();
      } catch (error) {
        requestLog.push({ requestId: init.requestId, purpose: init.purpose || null, status: null,
          elapsedMs: Date.now() - started, usage: { input: null, output: null, total: null }, finishReason: null, ok: false });
        handlers.onError(safeError(error));
      }
    },
  };
}

function extractReport(output) {
  const candidates = [output.trim()];
  const fenced = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1].trim());
  candidates.push(...fenced);
  for (let start = output.indexOf('{'); start >= 0; start = output.indexOf('{', start + 1)) {
    for (let end = output.lastIndexOf('}'); end > start; end = output.lastIndexOf('}', end - 1)) candidates.push(output.slice(start, end + 1));
  }
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text);
      const report = parsed?.report && typeof parsed.report === 'object' ? parsed.report : parsed;
      if (report && typeof report === 'object') return JSON.stringify(report);
    } catch {}
  }
  return '';
}

function programCheck(output) {
  const report = extractReport(output);
  if (!report) return { passed: false, failures: ['invalid_or_missing_json'] };
  return fixture.validate(report, fixture.input);
}

function sumUsage(rows) {
  const known = key => rows.every(row => Number.isFinite(row.usage?.[key]));
  const sum = key => rows.reduce((n, row) => n + (Number.isFinite(row.usage?.[key]) ? row.usage[key] : 0), 0);
  return {
    requests: rows.length,
    input: known('input') ? sum('input') : null,
    output: known('output') ? sum('output') : null,
    total: known('total') ? sum('total') : null,
    missingUsageRequests: rows.filter(row => !Number.isFinite(row.usage?.total)).length,
  };
}

async function runComparison(selected) {
  const requestLog = [];
  const transport = transportFor(selected.profile, selected.key, requestLog);
  const agentLoad = loader({ './transport': { getTransport: () => transport } });
  const agentModule = agentLoad(path.join(repo, 'src', 'lib', 'agent.ts'));
  const collaborationStore = require(path.join(repo, 'electron', 'collaboration-store.cjs')).createCollaborationStore(userData);
  const bridge = {
    collaborationRead: async () => collaborationStore.read(),
    collaborationUpdate: async (revision, project) => collaborationStore.update(revision, project),
    collaborationClaim: async (id, runId) => collaborationStore.claim(id, runId),
    toolAbort: async () => {},
  };
  const teamLoad = loader({
    './agent': agentModule,
    './store': {
      uid: (prefix = 'id') => `${prefix}-${crypto.randomUUID()}`,
      secretGet: async id => id === selected.profile.id ? selected.key : null,
      toolContextOf: () => ({ grants: { extraRoots: [], screen: false, admin: false } }),
    },
    './transport': { desktop: () => bridge },
  });
  const domain = teamLoad(path.join(repo, 'src', 'lib', 'collaboration.ts'));
  const { TeamRuntime } = teamLoad(path.join(repo, 'src', 'lib', 'team-runtime.ts'));
  const { defaultSettings } = teamLoad(path.join(repo, 'src', 'lib', 'store.ts'));
  const settings = defaultSettings();
  settings.keyProfiles = [selected.profile];
  settings.activeKeyProfileId = selected.profile.id;
  settings.defaultConfig.model = selected.model;
  settings.defaultConfig.stream = false;
  settings.defaultConfig.maxToolRounds = 2;
  settings.defaultConfig.runtime.maxTokens = runBudget;
  settings.defaultConfig.runtime.maxMinutes = 4;
  settings.autoRetry = 0;
  settings.failover = { enabled: false, routes: [] };
  settings.customModels = { [selected.profile.id]: [{ id: selected.model }] };
  settings.requestTimeoutMs = 60_000;

  const runtime = new TeamRuntime();
  runtime.settings = () => settings;
  await runtime.load();
  const project = domain.emptyTeamProject(projectId);
  project.name = '2.17.10 synthetic strategy comparison';
  project.instructions = 'Only solve the supplied synthetic CSV case. Do not claim to read or write files.';
  // Keep all three finished runs pending for objective inspection. A capacity of
  // three lets the later arms start without auto-accepting the earlier results.
  project.settings = { roots: [], allowedConnections: [selected.profile.id], maxConcurrent: 3,
    maxTokens: runBudget, maxMinutes: 4, approvalMode: 'auto' };
  project.members = [
    { id: 'executor', name: 'Executor', instructions: 'Compute carefully. Return the requested JSON and no prose.',
      connectionId: selected.profile.id, model: selected.model, effort: 'medium', enabled: true, tools: [], maxTokens: memberBudget, maxMinutes: 2 },
    { id: 'reviewer', name: 'Reviewer', instructions: 'Independently check the latest-revision rule and exact arithmetic. Cite the text you checked.',
      connectionId: selected.profile.id, model: selected.model, effort: 'medium', enabled: true, tools: [], maxTokens: memberBudget, maxMinutes: 2 },
  ];
  const goal = `${fixture.goal}\n\ninput.csv:\n${fixture.input}\n\n本次基准不提供文件工具；请把 report.json 的内容直接作为最终答复。`;
  const acceptance = `${fixture.acceptance} 最终答复必须只包含 JSON 对象，不要 Markdown 代码围栏或解释。`;
  const arms = [
    ['single', '单助手'],
    ['discussion', '讨论后执行'],
    ['review', '执行后复核'],
  ];
  for (const [id, title] of arms) {
    const task = { id, title, goal, acceptance, ownerId: 'executor', status: '就绪', entries: [], createdAt: Date.now() };
    const flow = id === 'single'
      ? domain.freeFlowGraph(task, [project.members[0]], title)
      : id === 'discussion'
        ? domain.freeFlowGraph(task, project.members, title)
        : domain.reviewFlowGraph(task, project.members, title, 'text');
    flow.id = `flow-${id}`;
    flow.draft.maxTokens = runBudget;
    flow.draft.maxMinutes = 4;
    flow.draft.maxSteps = 12;
    flow.versions = [{ id: `version-${id}`, number: 1, createdAt: Date.now(), graph: structuredClone(flow.draft) }];
    task.workflowId = flow.id;
    project.tasks.push(task);
    project.workflows.push(flow);
  }
  await runtime.update(projectId, target => Object.assign(target, project));

  const results = [];
  for (const [id, title] of arms) {
    const before = requestLog.length;
    const started = Date.now();
    const runId = await runtime.createRun(projectId, id, `flow-${id}`, `version-${id}`, settings.defaultConfig);
    await runtime.start(projectId, runId);
    const run = runtime.project(projectId).runs.find(item => item.id === runId);
    const elapsedMs = Date.now() - started;
    const agentOutputs = run.attempts
      .filter(attempt => run.version.graph.nodes.find(node => node.id === attempt.nodeId)?.type === 'agent')
      .map(attempt => attempt.memberOutputs?.executor || attempt.output || '')
      .filter(Boolean);
    const finalOutput = agentOutputs.at(-1) || '';
    const check = programCheck(finalOutput);
    const armRequests = requestLog.slice(before);
    const reportedComplete = ['waiting_user', 'completed'].includes(run.status);
    results.push({
      strategy: id,
      label: title,
      status: run.status,
      elapsedMs,
      workflowBudgetTokens: runBudget,
      memberBudgetTokens: memberBudget,
      runtimeAccountedTokens: run.tokens,
      requestUsage: sumUsage(armRequests),
      requestOutcomes: armRequests.map(row => ({ purpose: row.purpose, httpStatus: row.status, elapsedMs: row.elapsedMs,
        usage: row.usage, finishReason: row.finishReason, ok: row.ok })),
      programCheck: check,
      reportedComplete,
      falseCompletion: reportedComplete && !check.passed,
      outputSha256: finalOutput ? sha256(finalOutput) : null,
      outputBytes: Buffer.byteLength(finalOutput),
      attempts: run.attempts.map(attempt => ({
        nodeType: run.version.graph.nodes.find(node => node.id === attempt.nodeId)?.type || 'unknown',
        status: attempt.status,
        outcome: attempt.outcome || null,
        elapsedMs: attempt.endedAt && attempt.startedAt ? attempt.endedAt - attempt.startedAt : null,
        reviewVerdict: attempt.textReview?.verdict ?? attempt.review?.verdict ?? null,
        error: attempt.error ? safeError(attempt.error) : null,
      })),
    });
    // A short pause respects the free endpoints and avoids turning the pilot into a burst test.
    await sleep(2_500);
  }
  return results;
}

app.whenReady().then(async () => {
  fs.mkdirSync(outputRoot, { recursive: true });
  const candidates = configuredRoutes();
  // The decrypted values now live only in this process. Remove the copied key
  // metadata before any network call or report write.
  try { fs.rmSync(path.join(userData, 'Local State'), { force: true }); } catch {}
  const probes = [];
  let selected = null;
  for (const candidate of candidates) {
    if (!candidate.profile || !candidate.key) {
      probes.push(probePublic(candidate));
      continue;
    }
    const result = await post(candidate.profile, candidate.key, candidate.model,
      [{ role: 'user', content: 'Synthetic availability check. Reply exactly OK.' }], 8, 30_000);
    probes.push(probePublic(candidate, result));
    // HTTP 200 is the bounded readiness signal. Reasoning models can spend the
    // intentionally tiny probe allowance before emitting visible content.
    if (result.ok && candidate.fixed) {
      selected = candidate;
      break;
    }
    await sleep(1_500);
  }
  let runs = [];
  let blocker = null;
  if (selected) {
    runs = await runComparison(selected);
  } else {
    blocker = 'No authorized fixed free model passed the bounded availability probes; the quality comparison was not fabricated.';
  }
  const report = {
    schemaVersion: 1,
    createdAt: nowIso(),
    fixture: fixture.id,
    inputSha256: fixture.digest(fixture.input),
    policy: {
      syntheticInputOnly: true,
      paidRoutesAllowed: false,
      automaticFailover: false,
      probeLimit: candidates.length,
      sameModelRequired: true,
      workflowBudgetTokens: runBudget,
      memberBudgetTokens: memberBudget,
    },
    probes,
    selected: selected ? { family: selected.family, model: selected.model, fixed: selected.fixed } : null,
    runs,
    blocker,
    limitations: [
      'One deterministic synthetic case per strategy; this is not a general quality ranking.',
      'The production TeamRuntime and runAgent are used headlessly, while Electron IPC byte transport is replaced by an in-process fetch adapter.',
      'Provider-reported usage can be missing; missing values are null and are never treated as zero.',
      'Elapsed time is wall-clock time and includes local persistence plus provider latency.',
    ],
  };
  fs.writeFileSync(path.join(outputRoot, 'anonymous-report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ report: path.join(outputRoot, 'anonymous-report.json'), selected: report.selected,
    probes: probes.map(({ family, model, ok, httpStatus, error }) => ({ family, model, ok, httpStatus, error })),
    runCount: runs.length, blocker }, null, 2) + '\n');
}).catch(error => {
  fs.mkdirSync(outputRoot, { recursive: true });
  const failure = { schemaVersion: 1, createdAt: nowIso(), fixture: fixture.id, fatal: safeError(error) };
  fs.writeFileSync(path.join(outputRoot, 'anonymous-report.json'), JSON.stringify(failure, null, 2) + '\n');
  process.stderr.write(safeError(error) + '\n');
  process.exitCode = 1;
}).finally(() => app.quit());
