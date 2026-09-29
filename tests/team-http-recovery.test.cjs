const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const { createCollaborationStore } = require('../electron/collaboration-store.cjs');

const projectFile = (name) => path.resolve(__dirname, '..', name);
const { extractErrorMessage } = loader()(projectFile('src/lib/sse.ts'));

function completion(content, totalTokens, toolCalls) {
  return {
    id: crypto.randomUUID(),
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
    usage: { prompt_tokens: Math.max(1, totalTokens - 5), completion_tokens: 5, total_tokens: totalTokens },
  };
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

async function localOpenAi(t, respond) {
  const routeLog = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    routeLog.push({ url: req.url, model: body.model, messages: structuredClone(body.messages), tools: (body.tools ?? []).map((t) => t.function?.name) });
    const answer = await respond({ req, body, ordinal: routeLog.length });
    res.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...(answer.headers ?? {}) });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, routeLog };
}

/*
 * Electron's main process is unavailable under node:test. This bridge keeps that
 * boundary deliberately small: it performs the real localhost fetch and emits
 * the same response/body/raw/error/done events as electron/main.cjs. Everything
 * above it is production code: pacing, ElectronTransport, the shared JSON/SSE
 * parser, runAgent checkpoints, error classification, and TeamRuntime failover.
 */
function localElectronBridge(store, callTool) {
  const listeners = new Set();
  const controllers = new Map();
  const emit = (event) => { for (const listener of listeners) listener(event); };
  return {
    platform: 'electron',
    collaborationRead: async () => store.read(),
    collaborationUpdate: async (revision, project) => store.update(revision, project),
    collaborationClaim: async (projectId, runId) => store.claim(projectId, runId),
    toolAbort: async () => {},
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async chat(init) {
      const controller = new AbortController();
      controllers.set(init.requestId, controller);
      try {
        const response = await fetch(init.url, {
          method: 'POST',
          headers: init.headers,
          body: JSON.stringify(init.body),
          signal: controller.signal,
        });
        const headers = {};
        for (const [key, value] of response.headers) {
          if (/^(content-type|retry-after|x-request-id|request-id|x-ratelimit-[a-z-]+)$/i.test(key)) headers[key] = value;
        }
        emit({ requestId: init.requestId, type: 'response', data: headers, status: response.status });
        const text = await response.text();
        if (!response.ok) {
          emit({ requestId: init.requestId, type: 'raw', data: text, status: response.status });
          let parsed = text;
          try { parsed = JSON.parse(text); } catch {}
          const message = extractErrorMessage(parsed, `HTTP ${response.status}`);
          emit({ requestId: init.requestId, type: 'error', data: message, status: response.status });
          return;
        }
        emit({ requestId: init.requestId, type: 'body', data: text });
        emit({ requestId: init.requestId, type: 'done' });
      } catch (error) {
        emit({ requestId: init.requestId, type: 'error', data: error.message });
      } finally {
        controllers.delete(init.requestId);
      }
    },
    async abort(requestId) { controllers.get(requestId)?.abort(); },
    tool: callTool,
  };
}

function immediatePacer() {
  const actual = loader()(projectFile('src/lib/pacer.ts'));
  const waits = [];
  const rateLimitDelays = [];
  return {
    waits,
    rateLimitDelays,
    module: {
      ...actual,
      async paced(_key, fn, options = {}) {
        if (options.signal?.aborted) throw actual.abortError();
        return fn();
      },
      async waitCancellable(ms, signal, onWait) {
        waits.push(ms);
        onWait?.(ms);
        if (signal?.aborted) throw actual.abortError();
      },
      noteRateLimit(_key, retryAfterMs) {
        const delay = retryAfterMs ?? 62000;
        rateLimitDelays.push(delay);
        return delay;
      },
      waitForTokens: () => 0,
      waitForQuota: () => 0,
      reserveTokens: () => {},
      reconcileTokens: () => {},
      consumeQuota: () => {},
      noteQuotaHeaders: () => {},
      noteSuccess: () => {},
    },
  };
}

async function fixture(t, server, { tools = [], callTool = async () => ({ ok: true, content: '' }), autoRetry = 0, pacer, failover = true, maxVisits, secondAgent = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-team-http-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createCollaborationStore(root);
  const bridge = localElectronBridge(store, callTool);
  const previousWindow = global.window;
  global.window = { snc: bridge };
  t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });

  let serial = 0;
  const load = loader({
    ...(pacer ? { './pacer': pacer.module } : {}),
    './store': {
      uid: (prefix = 'id') => `${prefix}-${++serial}`,
      secretGet: async () => 'fake-local-key',
      toolContextOf: () => ({ grants: { extraRoots: [], screen: false, admin: false } }),
    },
  });
  const { TeamRuntime } = load(projectFile('src/lib/team-runtime.ts'));
  const domain = load(projectFile('src/lib/collaboration.ts'));
  const config = load(projectFile('src/lib/paramSchema.ts')).defaultGenerationConfig();
  config.stream = false;
  config.maxToolRounds = 8;
  const runtime = new TeamRuntime();
  runtime.settings = () => ({
    defaultConfig: config,
    keyProfiles: [
      { id: 'primary', name: 'Primary local fixture', baseUrl: `${server.baseUrl}/primary/v1`, hasSecret: true },
      { id: 'fallback', name: 'Fallback local fixture', baseUrl: `${server.baseUrl}/fallback/v1`, hasSecret: true },
    ],
    effortMappings: [],
    requestTimeoutMs: 2000,
    autoRetry,
    modelHealth: {},
    failover: {
      enabled: failover,
      routes: [
        { profileId: 'primary', model: 'primary-model' },
        { profileId: 'fallback', model: 'fallback-model' },
      ],
    },
  });

  await runtime.load();
  const project = domain.emptyTeamProject('p');
  project.settings.allowedConnections = [];
  project.settings.maxTokens = 400000;
  project.settings.approvalMode = 'all';
  project.members = [{
    id: 'member-a', name: 'A', instructions: 'Complete the assigned fixture task.',
    connectionId: 'primary', model: 'primary-model', effort: 'medium', enabled: true,
    tools, maxTokens: 100000, maxMinutes: 2,
  }];
  const flow = domain.newWorkflow('HTTP recovery');
  const start = flow.draft.nodes[0];
  const end = flow.draft.nodes[1];
  const agent = domain.newNode('agent');
  agent.memberId = 'member-a';
  agent.instructions = 'Return the deterministic fixture result.';
  agent.outputRequirement = 'A concrete result.';
  end.outputRequirement = 'Review the result.';
  if (maxVisits) agent.maxVisits = maxVisits;
  const second = domain.newNode('agent');
  second.memberId = 'member-a';
  second.instructions = 'Summarize the previous result.';
  second.outputRequirement = 'A summary.';
  flow.draft.nodes = secondAgent ? [start, agent, second, end] : [start, agent, end];
  flow.draft.edges = (secondAgent ? [[start, agent], [agent, second], [second, end]] : [[start, agent], [agent, end]]).map(([from, to], index) => ({
    id: `edge-${index}`, from: from.id, to: to.id, port: 'next', label: 'next', maxTraversals: 5,
  }));
  flow.draft.maxTokens = 400000;
  flow.versions = [{ id: 'v1', number: 1, createdAt: 1, graph: structuredClone(flow.draft) }];
  project.workflows = [flow];
  project.tasks = [{ id: 'task', title: 'Fixture', goal: 'Explain the fixture result', acceptance: 'Return a concrete result', entries: [], status: 'ready', createdAt: 1 }];
  await runtime.update('p', (target) => Object.assign(target, project));
  const runId = await runtime.createRun('p', 'task', flow.id, 'v1', config);
  return { runtime, runId, store, load };
}

function agentAttempt(run) {
  return run.attempts.find((attempt) => attempt.routeLog?.length);
}

test('team failover crosses real localhost HTTP and preserves recovery state', async (t) => {
  await t.test('primary HTTP 429 is classified and handed to the successful fallback', async (t) => {
    const server = await localOpenAi(t, ({ req }) => req.url.startsWith('/primary/')
      ? { status: 429, body: { error: { message: 'fixture quota exhausted' } } }
      : { body: completion('fallback completed the task', 25) });
    const f = await fixture(t, server);
    await f.runtime.start('p', f.runId);

    const run = f.runtime.project('p').runs[0];
    assert.equal(run.status, 'waiting_user');
    assert.deepEqual(server.routeLog.map((entry) => [entry.url.split('/')[1], entry.model]), [
      ['primary', 'primary-model'],
      ['fallback', 'fallback-model'],
    ]);
    assert.deepEqual(agentAttempt(run).routeLog.map((entry) => [entry.model, entry.status]), [
      ['primary-model', 'failed'],
      ['fallback-model', 'done'],
    ]);
    assert.equal(run.tokens, 25);
    assert.equal(agentAttempt(run).memberStates['member-a'].spentTokens, 25);
  });

  await t.test('a completed side effect survives the later 429 and is not repeated by fallback', async (t) => {
    let primaryCalls = 0;
    const server = await localOpenAi(t, ({ req }) => {
      if (req.url.startsWith('/primary/') && primaryCalls++ === 0) {
        return { body: completion('', 30, [toolCall('write-once', 'write_file', { path: 'C:/fixture/output.txt', content: 'once' })]) };
      }
      if (req.url.startsWith('/primary/')) return { status: 429, body: { error: { message: 'quota ended after tool result' } } };
      return { body: completion('fallback resumed after the saved tool result', 40) };
    });
    let writes = 0;
    const f = await fixture(t, server, {
      tools: ['write_file'],
      callTool: async (name, args, ctx) => {
        assert.equal(name, 'write_file');
        assert.equal(ctx.execution.callId.endsWith('write-once'), true);
        writes++;
        return { ok: true, content: `wrote ${args.content}` };
      },
    });
    await f.runtime.start('p', f.runId);

    const run = f.runtime.project('p').runs[0];
    const attempt = agentAttempt(run);
    const checkpoint = attempt.memberStates['member-a'];
    assert.equal(run.status, 'waiting_user');
    assert.equal(writes, 1, 'fallback must resume after the persisted tool result');
    assert.deepEqual(server.routeLog.map((entry) => entry.url.split('/')[1]), ['primary', 'primary', 'fallback']);
    assert.equal(server.routeLog[2].messages.some((message) => message.role === 'tool' && message.tool_call_id === 'write-once'), true);
    assert.deepEqual(attempt.routeLog.map((entry) => [entry.model, entry.status]), [
      ['primary-model', 'failed'],
      ['fallback-model', 'done'],
    ]);
    assert.equal(run.tokens, 70, 'usage is cumulative across the checkpoint and fallback');
    assert.equal(checkpoint.spentTokens, 70);
    assert.equal(checkpoint.steps.filter((step) => step.callId === 'write-once' && step.status === 'ok').length, 1);
  });

  await t.test('an uncertain side effect stops on the primary route without automatic replay', async (t) => {
    const server = await localOpenAi(t, () => ({
      body: completion('', 18, [toolCall('unknown-write', 'write_file', { path: 'C:/fixture/unknown.txt', content: 'maybe' })]),
    }));
    let writes = 0;
    const f = await fixture(t, server, {
      tools: ['write_file'],
      callTool: async () => {
        writes++;
        return { ok: false, content: '', uncertain: true, operationStatus: 'uncertain', error: 'write may already have happened' };
      },
    });
    await f.runtime.start('p', f.runId);

    const run = f.runtime.project('p').runs[0];
    const attempt = agentAttempt(run);
    const checkpoint = attempt.memberStates['member-a'];
    assert.equal(run.status, 'uncertain');
    assert.equal(writes, 1);
    assert.deepEqual(server.routeLog.map((entry) => entry.url.split('/')[1]), ['primary']);
    assert.deepEqual(attempt.routeLog.map((entry) => [entry.model, entry.status]), [['primary-model', 'failed']]);
    assert.equal(checkpoint.uncertainCallId, 'unknown-write');
    assert.equal(checkpoint.toolCursor, 0, 'the unresolved operation remains at the durable cursor');
    assert.equal(run.tokens, 18);
  });
});

test('team run uses the shared automatic rate-limit retry over real localhost HTTP', async (t) => {
  for (const scenario of [
    { name: 'provider default wait', headers: {}, expectedDelay: 62000 },
    { name: 'Retry-After wait', headers: { 'retry-after': '2' }, expectedDelay: 2000 },
  ]) {
    await t.test(scenario.name, async (t) => {
      let calls = 0;
      const server = await localOpenAi(t, ({ req }) => {
        assert.equal(req.url.startsWith('/primary/'), true, 'runAgent should retry the same team route');
        if (calls++ === 0) {
          return {
            status: 429,
            headers: scenario.headers,
            body: { error: { message: 'inference exceeds tpm limit (code insufficient_quota)' } },
          };
        }
        return { body: completion('same route recovered after throttling', 25) };
      });
      const pacer = immediatePacer();
      const f = await fixture(t, server, { autoRetry: 1, pacer });
      await f.runtime.start('p', f.runId);

      const run = f.runtime.project('p').runs[0];
      const attempt = agentAttempt(run);
      const state = attempt.memberStates['member-a'];
      assert.equal(run.status, 'waiting_user');
      assert.deepEqual(server.routeLog.map((entry) => [entry.url.split('/')[1], entry.model]), [
        ['primary', 'primary-model'],
        ['primary', 'primary-model'],
      ]);
      assert.deepEqual(pacer.rateLimitDelays, [scenario.expectedDelay]);
      assert.deepEqual(pacer.waits, [scenario.expectedDelay]);
      assert.equal(run.tokens, 25, 'the rejected request must not invent token usage');
      assert.deepEqual(state.requestStats.map((stat) => [stat.httpStatus, stat.failureKind, stat.outcome]), [
        [429, 'rate_limit', 'failed'],
        [200, undefined, 'accepted'],
      ]);
    });
  }
});

test('an out-of-plan model stops the step with a fix, and switching the member route finishes it on the new model', async (t) => {
  const server = await localOpenAi(t, ({ req }) => req.url.startsWith('/primary/')
    ? { status: 400, body: { error: { message: 'model is not available in the current token plan (code 7)' } } }
    : { body: completion('switched route finished', 20) });
  const f = await fixture(t, server, { failover: false });
  const { teamRouteFix } = f.load(projectFile('src/lib/team-route-fix.ts'));
  await f.runtime.start('p', f.runId);

  let run = f.runtime.project('p').runs[0];
  assert.ok(['failed', 'uncertain'].includes(run.status), run.status);
  const failed = agentAttempt(run).routeLog.at(-1);
  assert.deepEqual([failed.status, failed.kind, failed.httpStatus], ['failed', 'route_unavailable', 400]);
  const fix = teamRouteFix(run);
  assert.equal(fix.failures.length, 1);
  assert.deepEqual([fix.failures[0].memberId, fix.failures[0].profileId, fix.failures[0].model], ['member-a', 'primary', 'primary-model']);
  assert.equal(fix.failures[0].info.title, '{model} 不在这条接入的套餐里');
  assert.equal(fix.sideEffectFree, true, 'a rejected request ran nothing, so retry needs no manual verification');

  await f.runtime.switchMemberRoute('p', f.runId, 'member-a', { profileId: 'fallback', model: 'fallback-model', effort: 'off' }, true);
  run = f.runtime.project('p').runs[0];
  assert.equal(run.members[0].model, 'primary-model', 'the run snapshot stays the audit baseline');
  assert.deepEqual(run.routeOverrides.map((o) => [o.memberId, o.profileId, o.model, o.previous.model]), [['member-a', 'fallback', 'fallback-model', 'primary-model']]);
  assert.ok(run.events.some((e) => e.kind === 'route_change'));
  assert.deepEqual([f.runtime.project('p').members[0].connectionId, f.runtime.project('p').members[0].model], ['fallback', 'fallback-model']);
  await assert.rejects(f.runtime.switchMemberRoute('p', f.runId, 'member-a', { profileId: 'fallback', model: 'fallback-model', effort: 'off' }), /新选择与当前路由相同/);
  await assert.rejects(f.runtime.runUpdate('p', f.runId, (r) => { r.routeOverrides[0].model = 'other'; }), /成员换路由历史不可改写/);
  await assert.rejects(f.runtime.runUpdate('p', f.runId, (r) => { r.routeOverrides.push({ ...r.routeOverrides[0], profileId: 'client:codex' }); }), /成员换路由记录无效/);

  await f.runtime.resolveUncertain('p', f.runId, 'retry', fix.failures[0].error);
  await f.runtime.start('p', f.runId);
  run = f.runtime.project('p').runs[0];
  assert.equal(run.status, 'waiting_user');
  assert.deepEqual(server.routeLog.map((entry) => [entry.url.split('/')[1], entry.model]), [['primary', 'primary-model'], ['fallback', 'fallback-model']]);
  assert.match(run.attempts.filter((a) => a.routeLog?.length).at(-1).output, /switched route finished/);
  assert.equal(teamRouteFix(run), null);
  await assert.rejects(f.runtime.switchMemberRoute('p', f.runId, 'member-a', { profileId: 'primary', model: 'primary-model', effort: 'off' }), /只能在运行停下后更换成员的模型/);
});

test('a member asks for more access mid-run; approving records the grant for this member only and the step continues', async (t) => {
  const extra = path.resolve(os.tmpdir(), 'wickrun-grant-target');
  const server = await localOpenAi(t, ({ ordinal }) => ordinal === 1
    ? { body: completion('', 30, [toolCall('call-access', 'request_access', { scope: 'path', target: extra, reason: 'read the shared reference docs' })]) }
    : { body: completion('used the granted directory', 20) });
  const f = await fixture(t, server, { tools: ['request_access'], failover: false });
  const running = f.runtime.start('p', f.runId);
  for (let i = 0; i < 400 && !f.runtime.project('p').runs[0].pendingApproval; i++) await new Promise((resolve) => setTimeout(resolve, 25));
  const pending = f.runtime.project('p').runs[0].pendingApproval;
  assert.ok(pending, 'the request waits on the run page');
  assert.match(pending.text, /申请授权/);
  assert.ok(pending.text.includes(extra));
  await f.runtime.approve('p', f.runId, true);
  await running;
  const run = f.runtime.project('p').runs[0];
  assert.deepEqual(run.accessGrants.map((g) => [g.memberId, g.scope, g.target]), [['member-a', 'path', extra]]);
  assert.ok(run.events.some((e) => e.kind === 'permission' && /获准/.test(e.text)));
  assert.match(JSON.stringify(server.routeLog[1].messages), /用户已批准/);
  assert.equal(run.status, 'waiting_user');
  await assert.rejects(f.runtime.runUpdate('p', f.runId, (r) => { r.accessGrants[0].target = path.parse(extra).root; }), /成员授权历史不可改写/);
});

test('a retry continues the same visit, and limits can be raised on the stopped run without starting over', async (t) => {
  const server = await localOpenAi(t, ({ ordinal }) => ordinal === 1
    ? { status: 400, body: { error: { message: 'invalid parameter: temperature' } } }
    : { body: completion('finished on retry', 20) });
  const f = await fixture(t, server, { failover: false, maxVisits: 1 });
  await f.runtime.start('p', f.runId);
  let run = f.runtime.project('p').runs[0];
  assert.ok(['failed', 'uncertain'].includes(run.status));

  await f.runtime.raiseLimits('p', f.runId, [{ kind: 'runTokens', value: 500000 }]);
  run = f.runtime.project('p').runs[0];
  assert.deepEqual(run.limitRaises.map((r) => [r.kind, r.value]), [['runTokens', 500000]]);
  assert.ok(run.events.some((e) => e.kind === 'limit_raise' && /500000/.test(e.text)));
  await assert.rejects(f.runtime.raiseLimits('p', f.runId, [{ kind: 'runTokens', value: 450000 }]), /只能调高/);
  await assert.rejects(f.runtime.runUpdate('p', f.runId, (r) => { r.limitRaises[0].value = 900000; }), /上限调整历史不可改写/);
  const agentId = run.version.graph.nodes.find((n) => n.type === 'agent').id;
  await assert.rejects(f.runtime.runUpdate('p', f.runId, (r) => { r.limitRaises.push({ kind: 'visits', target: agentId, value: 1, at: Date.now() }); }), /只能调高/);

  await f.runtime.resolveUncertain('p', f.runId, 'retry', 'request was rejected before any action');
  await f.runtime.start('p', f.runId);
  run = f.runtime.project('p').runs[0];
  assert.equal(run.status, 'waiting_user', 'a retry of the only allowed run is not a second run');
  const tries = run.attempts.filter((a) => a.nodeId === agentId);
  assert.deepEqual(tries.map((a) => a.visit), [1, 1]);
  assert.equal(run.visits[agentId], 1);
});

test('long upstream output reaches the next step as a document it reads in parts, not pasted into the message', async (t) => {
  const long = '开头结论。' + '详细过程'.repeat(6000) + '结尾建议。';
  const server = await localOpenAi(t, ({ ordinal, body }) => {
    if (ordinal === 1) return { body: completion(long, 30) };
    const catalog = JSON.parse(String(body.messages.find((m) => m.role === 'user').content).match(/前置记录目录：(\[.*?\])\n/)[1]);
    const id = catalog.find((d) => d.characters > 20000).id;
    return ordinal === 2 ? { body: completion('', 30, [toolCall('call-read', 'read_source_text', { id, part: 1 })]) } : { body: completion('summary done', 30) };
  });
  const f = await fixture(t, server, { failover: false, secondAgent: true });
  await f.runtime.start('p', f.runId);
  const second = server.routeLog[1];
  const text = JSON.stringify(second.messages);
  assert.match(text, /前置记录目录/);
  assert.ok(!text.includes('详细过程'.repeat(50)), 'the long output is not pasted into the message');
  assert.ok(second.tools.includes('read_source_text'));
  assert.match(JSON.stringify(server.routeLog[2].messages), /开头结论。/, 'the part it asked for came back verbatim');
  assert.equal(f.runtime.project('p').runs[0].status, 'waiting_user');
});
