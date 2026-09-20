const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const load = loader({ './store': { uid: (prefix) => `${prefix}-new` } });
const {
  DISCOVERY_ACCEPTANCE,
  normalizeTaskDraft,
  readDiscoveryProposal,
  discoveryResult,
  taskFromDiscovery,
} = load(path.resolve(__dirname, '../src/lib/team-discovery.ts'));

const task = (patch = {}) => ({
  id: 'idea', title: 'Idea', goal: 'I might organize a neighborhood event', acceptance: DISCOVERY_ACCEPTANCE,
  intent: 'explore', status: 'waiting', entries: [], createdAt: 1, ...patch,
});

const validOutput = [
  'Two possible directions with tradeoffs and assumptions.',
  '```wickrun-plan',
  JSON.stringify({
    title: 'Plan a small pilot',
    goal: 'Choose and plan one small neighborhood event pilot',
    acceptance: 'A reviewed one-page plan with scope, date, owner, and go/no-go criteria',
    workflowId: 'do-not-inherit',
    ownerId: 'tool-member',
    tools: ['run_command'],
  }),
  '```',
].join('\n');

function run(output = validOutput, patch = {}) {
  return {
    id: 'discovery-run', taskId: 'idea', intent:'explore', status: 'waiting_user',
    pendingApproval: { nodeId: 'end', text: 'Accept?' },
    version: { id: 'version-with-tools', number: 1, graph: { nodes: [
      { id: 'start', type: 'start' },
      { id: 'explore', type: 'agent', memberId: 'explorer' },
      { id: 'plan', type: 'agent', memberId: 'planner' },
      { id: 'end', type: 'end' },
    ] } },
    attempts: [
      { id: 'explore-attempt', nodeId: 'explore', status: 'completed', output: 'directions' },
      { id: 'plan-attempt', nodeId: 'plan', status: 'completed', output },
    ],
    ...patch,
  };
}

test('a valid proposal imports editable text and provenance only', () => {
  const sourceTask = task();
  const sourceRun = run();
  const result = discoveryResult(sourceTask, sourceRun);
  assert.equal(result.proposal.title, 'Plan a small pilot');
  assert.doesNotMatch(result.proposal.body, /wickrun-plan/);

  const next = taskFromDiscovery(sourceTask, sourceRun);
  assert.deepEqual({
    title: next.title, goal: next.goal, acceptance: next.acceptance, intent: next.intent,
    sourceTaskId: next.sourceTaskId, sourceRunId: next.sourceRunId,
  }, {
    title: 'Plan a small pilot',
    goal: 'Choose and plan one small neighborhood event pilot',
    acceptance: 'A reviewed one-page plan with scope, date, owner, and go/no-go criteria',
    intent: 'deliver', sourceTaskId: 'idea', sourceRunId: 'discovery-run',
  });
  for (const forbidden of ['workflowId', 'ownerId', 'memberId', 'members', 'tools', 'route', 'config']) {
    assert.equal(Object.hasOwn(next, forbidden), false, `${forbidden} must not cross the discovery boundary`);
  }
});

test('malformed, truncated, or ambiguous plan blocks are never partially adopted', () => {
  for (const output of [
    '```wickrun-plan\n{"title":"Only a title"}\n```',
    '```wickrun-plan\n{"title":"T","goal":"G","acceptance":',
    `${validOutput}\n${validOutput}`,
    '```wickrun-plan\n{"title":"T","goal":"G","acceptance":"A","workflowId":"danger"}\n```\n```wickrun-plan\n{}\n```',
  ]) {
    assert.equal(readDiscoveryProposal(output), null);
    const next = taskFromDiscovery(task(), run(output));
    assert.deepEqual([next.title, next.goal, next.acceptance], ['', '', '']);
    assert.equal(next.intent, 'deliver');
    assert.equal(next.workflowId, undefined);
    assert.equal(next.ownerId, undefined);
  }
});

test('partial or failed latest planning attempts cannot fall back to an older completed proposal', () => {
  const sourceRun = run('new partial output', {
    status: 'failed',
    pendingApproval: undefined,
    attempts: [
      { id: 'old-plan', nodeId: 'plan', status: 'completed', output: validOutput },
      { id: 'new-plan', nodeId: 'plan', status: 'failed', output: 'new partial output' },
    ],
  });
  assert.equal(discoveryResult(task(), sourceRun), null);
  assert.throws(() => taskFromDiscovery(task(), sourceRun), /等待本轮想法梳理完成/);
});

test('waiting for a model tool approval is not mistaken for final user acceptance', () => {
  const sourceRun = run(validOutput, { pendingApproval: { nodeId: 'plan-attempt', text: 'Tool approval' } });
  assert.equal(discoveryResult(task(), sourceRun), null);
});
test('a plan requires frozen exploration intent and no pending branch, regardless of editor node order',()=>{
 assert.equal(discoveryResult(task(),run(validOutput,{intent:undefined})),null);
 assert.equal(discoveryResult(task(),run(validOutput,{queue:['unfinished']})),null);
 const reordered=run();reordered.version.graph.nodes.reverse();
 assert.equal(discoveryResult(task(),reordered).proposal.title,'Plan a small pilot');
});

test('completed discovery remains readable while task/run mismatches and old deliver tasks stay isolated', () => {
  assert.ok(discoveryResult(task(), run(validOutput, { status: 'completed', pendingApproval: undefined })));
  assert.equal(discoveryResult(task(), run(validOutput, { taskId: 'other' })), null);
  assert.equal(discoveryResult(task({ intent: 'deliver' }), run()), null);
  assert.equal(discoveryResult(task({ intent: undefined }), run()), null);
});

test('normalization preserves legacy deliver tasks and applies the fixed exploration contract', () => {
  const legacy = normalizeTaskDraft(task({ intent: undefined, title: '  ', goal: '  Ship a report  ', acceptance: 'Existing acceptance' }));
  assert.equal(legacy.title, 'Ship a report');
  assert.equal(legacy.acceptance, 'Existing acceptance');
  assert.equal(legacy.intent, undefined);

  const explore = normalizeTaskDraft(task({ acceptance: 'stale acceptance' }));
  assert.equal(explore.acceptance, DISCOVERY_ACCEPTANCE);
});
