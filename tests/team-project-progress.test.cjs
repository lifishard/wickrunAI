const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mainRoot = path.resolve(__dirname, '..');
const {loader} = require(path.join(mainRoot, 'tests/load-ts.cjs'));
const discovery = loader({'./store': {uid: prefix => `${prefix}-test`}})(path.join(mainRoot, 'src/lib/team-discovery.ts'));
const load = loader({'./team-discovery': discovery});
const {teamProjectProgress} = load(path.resolve(__dirname, '../src/lib/team-project-progress.ts'));

function task(id, options = {}) {
  return {
    id,
    title: options.title ?? id,
    goal: 'goal',
    acceptance: 'acceptance',
    status: options.status ?? '任意旧状态',
    entries: [],
    createdAt: options.createdAt ?? 1,
    intent: options.intent,
    sourceTaskId: options.sourceTaskId,
    sourceRunId: options.sourceRunId,
  };
}

function graph() {
  return {
    nodes: [
      {id: 'start', type: 'start'},
      {id: 'agent', type: 'agent'},
      {id: 'end', type: 'end'},
    ],
    edges: [],
    maxSteps: 20,
    maxMinutes: 10,
    maxTokens: 100000,
  };
}

function run(id, taskId, status, updatedAt, options = {}) {
  return {
    id,
    taskId,
    intent: options.intent,
    workflowId: 'flow',
    version: {id: 'version', number: 1, createdAt: 1, graph: graph()},
    status,
    queue: options.queue ?? [],
    attempts: options.attempts ?? [],
    events: options.events ?? [],
    pendingApproval: options.pendingApproval,
    createdAt: options.createdAt ?? updatedAt,
    updatedAt,
  };
}

function validDiscoveryRun(id, taskId, status, updatedAt) {
  const attempts = [{id: `${id}-agent`, nodeId: 'agent', visit: 1, status: 'completed', startedAt: 1, endedAt: 2, output: '两个方向和一份下一步建议', steps: []}];
  const options = {intent: 'explore', attempts};
  if (status === 'waiting_user') {
    attempts.push({id: `${id}-end`, nodeId: 'end', visit: 1, status: 'waiting_user', startedAt: 3, output: '', steps: []});
    options.pendingApproval = {nodeId: 'end', text: '请决定是否采用建议'};
  }
  return run(id, taskId, status, updatedAt, options);
}

test('empty project has stable zero counts', () => {
  assert.deepEqual(teamProjectProgress({tasks: [], runs: []}), {
    tasks: [],
    counts: {exploring: 0, decision: 0, ready: 0, running: 0, completed: 0, attention: 0},
    liveRunCount: 0,
    needsAttentionCount: 0,
  });
});

test('delivery progress trusts actual runs, never stale task.status', () => {
  const tasks = [
    task('unrun', {status: '已完成', createdAt: 1}),
    task('done', {status: '草稿', createdAt: 2}),
  ];
  const result = teamProjectProgress({tasks, runs: [run('done-run', 'done', 'completed', 10)]});
  const byId = Object.fromEntries(result.tasks.map(item => [item.taskId, item]));
  assert.equal(byId.unrun.status, 'ready');
  assert.equal(byId.unrun.relevantRunId, undefined);
  assert.equal(byId.unrun.reasonKey, '任务还没有实际运行');
  assert.equal(byId.done.status, 'completed');
  assert.equal(byId.done.reasonKey, '实际交付运行已完成');
  assert.equal(result.counts.ready, 1);
  assert.equal(result.counts.completed, 1);
});

test('waiting for final acceptance is a decision, not completed', () => {
  const pending = run('pending', 'delivery', 'waiting_user', 10, {
    pendingApproval: {nodeId: 'end', text: '请核对最终交付'},
  });
  const item = teamProjectProgress({tasks: [task('delivery')], runs: [pending]}).tasks[0];
  assert.equal(item.status, 'decision');
  assert.equal(item.reasonKey, '运行等待你验收');
  assert.equal(item.reasonDetail, '请核对最终交付');
  assert.equal(item.nextActionKey, '查看并处理运行');
  assert.deepEqual(item.needsAttentionRunIds, ['pending']);
});

test('live run wins over newer ready and cancelled records without hiding another wait', () => {
  const runs = [
    run('run-active', 'delivery', 'running', 10),
    run('run-wait', 'delivery', 'waiting_user', 20, {pendingApproval: {nodeId: 'agent', text: '选择方向'}}),
    run('run-cancelled', 'delivery', 'cancelled', 30),
    run('run-ready', 'delivery', 'ready', 40),
  ];
  const project = {tasks: [task('delivery')], runs};
  const first = teamProjectProgress(project).tasks[0];
  const second = teamProjectProgress({tasks: [...project.tasks].reverse(), runs: [...runs].reverse()}).tasks[0];
  assert.equal(first.relevantRunId, 'run-active');
  assert.equal(first.status, 'running');
  assert.equal(first.liveRunCount, 2);
  assert.deepEqual(first.needsAttentionRunIds, ['run-wait']);
  assert.equal(first.needsAttentionCount, 1);
  assert.deepEqual(second, first);
});

test('new completed run clears historical failure from attention totals', () => {
  const runs = [
    run('old-failure', 'delivery', 'failed', 10, {attempts: [{id: 'a', status: 'failed', nodeId: 'agent', startedAt: 1, endedAt: 2, error: '旧错误', output: '', steps: []}]}),
    run('new-success', 'delivery', 'completed', 20),
  ];
  const result = teamProjectProgress({tasks: [task('delivery')], runs});
  assert.equal(result.tasks[0].relevantRunId, 'new-success');
  assert.equal(result.tasks[0].status, 'completed');
  assert.equal(result.tasks[0].needsAttentionCount, 0);
  assert.equal(result.needsAttentionCount, 0);
});

test('completed sibling run does not erase a paused or uncertain run', () => {
  const runs = [
    run('paused', 'delivery', 'paused', 50, {createdAt: 10, events: [{id: 'recovery', at: 51, kind: 'recovery_budget', text: '重载后需要核实预算'}]}),
    run('uncertain', 'delivery', 'uncertain', 40, {createdAt: 20}),
    run('completed', 'delivery', 'completed', 30, {createdAt: 30}),
  ];
  const item = teamProjectProgress({tasks: [task('delivery')], runs}).tasks[0];
  assert.equal(item.relevantRunId, 'uncertain');
  assert.equal(item.status, 'attention');
  assert.deepEqual(item.needsAttentionRunIds, ['uncertain', 'paused']);
  assert.equal(item.needsAttentionCount, 2);
});

test('run creation order wins over a later update to an older run', () => {
  const runs = [
    run('older-approved-late', 'delivery', 'completed', 100, {createdAt: 10}),
    run('newer-failed', 'delivery', 'failed', 30, {createdAt: 20}),
  ];
  const item = teamProjectProgress({tasks: [task('delivery')], runs}).tasks[0];
  assert.equal(item.relevantRunId, 'newer-failed');
  assert.equal(item.status, 'attention');
});

test('unrun idea explores; a valid frozen result waits for a decision', () => {
  const unrun = task('idea-unrun', {intent: 'explore', createdAt: 1});
  const planned = task('idea-planned', {intent: 'explore', createdAt: 2});
  const result = teamProjectProgress({
    tasks: [unrun, planned],
    runs: [validDiscoveryRun('discovery', 'idea-planned', 'waiting_user', 10)],
  });
  const byId = Object.fromEntries(result.tasks.map(item => [item.taskId, item]));
  assert.equal(byId['idea-unrun'].status, 'exploring');
  assert.equal(byId['idea-unrun'].nextActionKey, '打开任务，准备梳理想法');
  assert.equal(byId['idea-planned'].status, 'decision');
  assert.equal(byId['idea-planned'].relevantRunId, 'discovery');
  assert.equal(byId['idea-planned'].reasonKey, '梳理结果等待你决定下一步');
  assert.equal(byId['idea-planned'].reasonDetail, '请决定是否采用建议');
});

test('a downstream task tied to the valid discovery marks only planning completed', () => {
  const idea = task('idea', {intent: 'explore', createdAt: 1});
  const delivery = task('delivery', {intent: 'deliver', sourceTaskId: 'idea', sourceRunId: 'discovery', createdAt: 2});
  const result = teamProjectProgress({tasks: [idea, delivery], runs: [validDiscoveryRun('discovery', 'idea', 'completed', 10)]});
  const byId = Object.fromEntries(result.tasks.map(item => [item.taskId, item]));
  assert.equal(byId.idea.status, 'completed');
  assert.equal(byId.idea.reasonKey, '想法梳理已完成，并已建立后续任务');
  assert.deepEqual(byId.idea.childTaskIds, ['delivery']);
  assert.equal(byId.delivery.status, 'ready');
  assert.deepEqual(byId.delivery.source, {taskId: 'idea', runId: 'discovery', taskExists: true, runExists: true});
});

test('an adopted old discovery never conceals the current failed round', () => {
  const idea = task('idea', {intent: 'explore'});
  const delivery = task('delivery', {sourceTaskId: 'idea', sourceRunId: 'old-discovery', createdAt: 2});
  const oldDiscovery = validDiscoveryRun('old-discovery', 'idea', 'completed', 10);
  const failed = run('new-failure', 'idea', 'failed', 20, {
    createdAt: 20,
    intent: 'explore',
    attempts: [{id: 'failed-attempt', nodeId: 'agent', status: 'failed', startedAt: 20, endedAt: 21, error: '新一轮失败', output: '', steps: []}],
  });
  const item = teamProjectProgress({tasks: [idea, delivery], runs: [oldDiscovery, failed]}).tasks.find(value => value.taskId === 'idea');
  assert.equal(item.relevantRunId, 'new-failure');
  assert.equal(item.status, 'attention');
  assert.equal(item.reasonDetail, '新一轮失败');
});

test('a waiting discovery remains a decision even if a child already points to it', () => {
  const idea = task('idea', {intent: 'explore'});
  const child = task('premature-child', {sourceTaskId: 'idea', sourceRunId: 'waiting-discovery', createdAt: 2});
  const item = teamProjectProgress({tasks: [idea, child], runs: [validDiscoveryRun('waiting-discovery', 'idea', 'waiting_user', 10)]}).tasks.find(value => value.taskId === 'idea');
  assert.equal(item.status, 'decision');
  assert.equal(item.reasonKey, '梳理结果等待你决定下一步');
});

test('completed exploration without a usable result needs attention', () => {
  const invalid = run('invalid', 'idea', 'completed', 10, {
    intent: 'explore',
    attempts: [{id: 'empty', nodeId: 'agent', visit: 1, status: 'completed', startedAt: 1, output: '   ', steps: []}],
  });
  const item = teamProjectProgress({tasks: [task('idea', {intent: 'explore'})], runs: [invalid]}).tasks[0];
  assert.equal(item.status, 'attention');
  assert.equal(item.reasonKey, '梳理运行已结束，但没有可用结果');
  assert.equal(item.needsAttentionCount, 1);
  assert.deepEqual(item.needsAttentionRunIds, ['invalid']);
});

test('completed delivery does not show an old recovered failure as a current waiting reason', () => {
  const done = run('done', 'delivery', 'completed', 20, {
    attempts: [{id: 'old', nodeId: 'agent', status: 'failed', startedAt: 1, error: 'old error', output: '', steps: []}],
    events: [{id: 'pause', at: 2, kind: 'paused', text: 'old pause'}],
  });
  const item = teamProjectProgress({tasks: [task('delivery')], runs: [done]}).tasks[0];
  assert.equal(item.status, 'completed');
  assert.equal(item.reasonDetail, undefined);
  assert.equal(item.needsAttentionCount, 0);
});

test('a resumed run only shows current notices, and a new pause supersedes an old error', () => {
  const runs = [run('resumed', 'delivery', 'running', 20, {
    attempts: [{id: 'old', nodeId: 'agent', status: 'failed', startedAt: 1, endedAt: 2, error: 'old failure', output: '', steps: []}],
    events: [{id: 'recovered', at: 3, kind: 'recovery', text: 'old interruption'}],
  })];
  assert.equal(teamProjectProgress({tasks: [task('delivery')], runs}).tasks[0].reasonDetail, undefined);
  runs[0].attempts.push({id: 'new', nodeId: 'agent', status: 'running', startedAt: 20, notice: 'Retrying in 62 seconds', output: '', steps: []});
  assert.equal(teamProjectProgress({tasks: [task('delivery')], runs}).tasks[0].reasonDetail, 'Retrying in 62 seconds');
  runs[0].status = 'paused';
  runs[0].events.push({id: 'latest-pause', at: 30, kind: 'paused', text: 'User paused this run'});
  assert.equal(teamProjectProgress({tasks: [task('delivery')], runs}).tasks[0].reasonDetail, 'User paused this run');
});

test('missing and cyclic provenance stays finite and validates run ownership', () => {
  const tasks = [
    task('a', {sourceTaskId: 'b', sourceRunId: 'run-b', createdAt: 1}),
    task('b', {sourceTaskId: 'a', sourceRunId: 'run-a', createdAt: 2}),
    task('missing', {sourceTaskId: 'gone', sourceRunId: 'run-a', createdAt: 3}),
    task('wrong-run', {sourceTaskId: 'a', sourceRunId: 'run-b', createdAt: 4}),
  ];
  const runs = [run('run-a', 'a', 'completed', 10), run('run-b', 'b', 'completed', 11)];
  const result = teamProjectProgress({tasks, runs});
  const byId = Object.fromEntries(result.tasks.map(item => [item.taskId, item]));
  assert.deepEqual(byId.a.source, {taskId: 'b', runId: 'run-b', taskExists: true, runExists: true});
  assert.deepEqual(byId.b.source, {taskId: 'a', runId: 'run-a', taskExists: true, runExists: true});
  assert.deepEqual(byId.missing.source, {taskId: 'gone', runId: 'run-a', taskExists: false, runExists: false});
  assert.deepEqual(byId['wrong-run'].source, {taskId: 'a', runId: 'run-b', taskExists: true, runExists: false});
  assert.deepEqual(byId.a.childTaskIds, ['wrong-run', 'b']);
  assert.deepEqual(byId.b.childTaskIds, ['a']);
});

test('task and child order is deterministic by timestamp then id', () => {
  const tasks = [
    task('root', {createdAt: 1}),
    task('child-b', {sourceTaskId: 'root', createdAt: 2}),
    task('child-a', {sourceTaskId: 'root', createdAt: 2}),
    task('newest', {createdAt: 3}),
  ];
  const result = teamProjectProgress({tasks: [tasks[1], tasks[3], tasks[0], tasks[2]], runs: []});
  assert.deepEqual(result.tasks.map(item => item.taskId), ['newest', 'child-a', 'child-b', 'root']);
  assert.deepEqual(result.tasks.find(item => item.taskId === 'root').childTaskIds, ['child-a', 'child-b']);
});

test('overview orders work needing action before passive and completed work', () => {
  const tasks = [
    task('done', {createdAt: 60}),
    task('ready', {createdAt: 50}),
    task('explore', {intent: 'explore', createdAt: 40}),
    task('running', {createdAt: 30}),
    task('decision', {createdAt: 20}),
    task('attention', {createdAt: 10}),
  ];
  const runs = [
    run('done-run', 'done', 'completed', 60),
    run('running-run', 'running', 'running', 30),
    run('decision-run', 'decision', 'waiting_user', 20, {pendingApproval: {nodeId: 'end', text: '请验收'}}),
    run('attention-run', 'attention', 'failed', 10),
  ];
  const result = teamProjectProgress({tasks, runs});
  assert.deepEqual(result.tasks.map(item => item.taskId), ['attention', 'decision', 'running', 'explore', 'ready', 'done']);
});

test('runtime notice and recovery event supply factual reason detail', () => {
  const running = run('running', 'active', 'running', 10, {
    attempts: [{id: 'live', nodeId: 'agent', status: 'running', startedAt: 9, output: '', steps: [], notice: '限流，等待 62 秒后重试'}],
  });
  const paused = run('paused', 'recovering', 'paused', 20, {
    events: [{id: 'e', at: 21, kind: 'recovery_budget', text: '重载后保守计入未结算预算'}],
  });
  const result = teamProjectProgress({tasks: [task('active'), task('recovering', {createdAt: 2})], runs: [running, paused]});
  const byId = Object.fromEntries(result.tasks.map(item => [item.taskId, item]));
  assert.equal(byId.active.reasonDetail, '限流，等待 62 秒后重试');
  assert.equal(byId.recovering.reasonDetail, '重载后保守计入未结算预算');
});
