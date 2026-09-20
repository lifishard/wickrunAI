const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const { teamFlowPreview } = loader()(path.resolve(__dirname, '../src/lib/team-flow-preview.ts'));

const node = (id, type, patch = {}) => ({
  id, type, title: patch.title ?? id, x: 0, y: 0,
  instructions: '', inputRefs: [], outputRequirement: '', maxVisits: 3, join: 'all',
  ports: ['condition', 'review', 'approval'].includes(type)
    ? [{ id: 'pass', label: '通过' }, { id: 'fail', label: '不通过' }, { id: 'default', label: '其他' }]
    : [{ id: 'next', label: '继续' }],
  ...patch,
});
const edge = (id, from, to, patch = {}) => ({ id, from, to, port: 'next', label: '继续', maxTraversals: 3, ...patch });
const graph = (nodes, edges, patch = {}) => ({ nodes, edges, maxSteps: 50, maxMinutes: 30, maxTokens: 50000, ...patch });
const version = (id, number, value, createdAt = number) => ({ id, number, createdAt, graph: structuredClone(value) });
const flow = (draft, versions = []) => ({
  id: 'flow', name: 'Preview fixture', draft, versions,
  viewport: { x: 0, y: 0, zoom: 1 }, archived: false, updatedAt: 1,
});
const member = (id, name = id) => ({
  id, name, instructions: '', connectionId: 'fixture', model: 'fixture-model', effort: 'medium',
  enabled: true, tools: [], maxTokens: 10000, maxMinutes: 5,
});

test('review preview preserves pass, fail rework, and default branches without linearizing them', () => {
  const frozen = graph([
    node('start', 'start'),
    node('execute', 'agent', { memberId: 'executor', instructions: 'Build it', outputRequirement: 'Working files' }),
    node('review', 'review', { memberId: 'reviewer', instructions: 'Check it', outputRequirement: 'Acceptance evidence' }),
    node('end', 'end', { outputRequirement: 'Accepted delivery' }),
  ], [
    edge('e1', 'start', 'execute', { label: '执行' }),
    edge('e2', 'execute', 'review', { label: '交给复核' }),
    edge('pass', 'review', 'end', { port: 'pass', label: '复核通过' }),
    edge('fail', 'review', 'execute', { port: 'fail', label: '返工', loop: true, maxTraversals: 4 }),
    edge('default', 'review', 'end', { port: 'default', label: '无法核实' }),
  ]);
  const preview = teamFlowPreview(flow(structuredClone(frozen), [version('v1', 1, frozen)]), [member('executor'), member('reviewer')]);

  assert.equal(preview.source, 'version');
  assert.equal(preview.hasDraftChanges, false);
  assert.deepEqual(preview.edges.map(({ id, from, to, port, label, loop, maxTraversals }) =>
    ({ id, from, to, port, label, loop, maxTraversals })), [
    { id: 'e1', from: 'start', to: 'execute', port: 'next', label: '执行', loop: false, maxTraversals: 3 },
    { id: 'e2', from: 'execute', to: 'review', port: 'next', label: '交给复核', loop: false, maxTraversals: 3 },
    { id: 'pass', from: 'review', to: 'end', port: 'pass', label: '复核通过', loop: false, maxTraversals: 3 },
    { id: 'fail', from: 'review', to: 'execute', port: 'fail', label: '返工', loop: true, maxTraversals: 4 },
    { id: 'default', from: 'review', to: 'end', port: 'default', label: '无法核实', loop: false, maxTraversals: 3 },
  ]);
  assert.deepEqual(Object.fromEntries(preview.nodes.map((item) => [item.id, item.layer])),
    { start: 0, execute: 1, review: 2, end: 3 });
  assert.equal(preview.nodes.find((item) => item.id === 'execute').outputs, 'Working files');
});

test('custom parallel branches remain peers and all connections survive', () => {
  const draft = graph([
    node('start', 'start'), node('fan', 'parallel'),
    node('a', 'agent', { memberId: 'a' }), node('b', 'agent', { memberId: 'b' }),
    node('join', 'join'), node('end', 'end'),
  ], [
    edge('s-f', 'start', 'fan'), edge('f-a', 'fan', 'a'), edge('f-b', 'fan', 'b'),
    edge('a-j', 'a', 'join'), edge('b-j', 'b', 'join'), edge('j-e', 'join', 'end'),
  ]);
  const preview = teamFlowPreview(flow(draft), [member('a', 'Alpha'), member('b', 'Beta')]);

  assert.equal(preview.source, 'draft');
  assert.equal(preview.versionId, undefined);
  assert.equal(preview.hasDraftChanges, false);
  assert.equal(preview.edges.length, 6);
  assert.equal(preview.nodes.find((item) => item.id === 'a').layer, preview.nodes.find((item) => item.id === 'b').layer);
  assert.deepEqual(preview.layers.find((layer) => layer.nodeIds.includes('a')).nodeIds, ['a', 'b']);
});

test('unversioned cycles are condensed into a finite layout while edges remain unchanged', () => {
  const draft = graph([
    node('start', 'start'), node('a', 'agent', { memberId: 'm' }),
    node('b', 'agent', { memberId: 'm' }), node('end', 'end'),
  ], [
    edge('s-a', 'start', 'a'), edge('a-b', 'a', 'b'), edge('b-a', 'b', 'a'), edge('b-e', 'b', 'end'),
  ]);
  const preview = teamFlowPreview(flow(draft), [member('m')]);

  assert.equal(preview.edges.length, 4);
  assert.equal(preview.nodes.find((item) => item.id === 'a').layer, 1);
  assert.equal(preview.nodes.find((item) => item.id === 'b').layer, 1);
  assert.equal(preview.nodes.find((item) => item.id === 'end').layer, 2);
  assert.ok(preview.layers.length <= preview.nodes.length);
});

test('a saved version stays frozen when the draft changes', () => {
  const frozen = graph([node('start', 'start'), node('old-end', 'end')], [edge('old-edge', 'start', 'old-end')]);
  const draft = graph([node('start', 'start'), node('draft-agent', 'agent', { memberId: 'm' }), node('new-end', 'end')], [
    edge('d1', 'start', 'draft-agent'), edge('d2', 'draft-agent', 'new-end'),
  ]);
  const preview = teamFlowPreview(flow(draft, [version('v1', 1, frozen)]), [member('m')]);

  assert.equal(preview.source, 'version');
  assert.equal(preview.versionId, 'v1');
  assert.equal(preview.hasDraftChanges, true);
  assert.deepEqual(preview.nodes.map((item) => item.id), ['start', 'old-end']);
  assert.deepEqual(preview.edges.map((item) => item.id), ['old-edge']);
});

test('latest version is selected by number and a fixed older version can be requested', () => {
  const oldGraph = graph([node('old', 'start')], []);
  const latestGraph = graph([node('latest', 'start')], []);
  const workflow = flow(structuredClone(latestGraph), [
    version('v2', 2, latestGraph, 20),
    version('v1', 1, oldGraph, 10),
  ]);

  const latest = teamFlowPreview(workflow, []);
  const old = teamFlowPreview(workflow, [], 'v1');
  assert.deepEqual([latest.versionId, latest.versionNumber, latest.nodes[0].id], ['v2', 2, 'latest']);
  assert.deepEqual([old.versionId, old.versionNumber, old.nodes[0].id], ['v1', 1, 'old']);
  assert.equal(old.hasDraftChanges, true);
  assert.throws(() => teamFlowPreview(workflow, [], 'missing'), /流程版本不存在/);
});

test('missing single and discussion members are explicit preview data', () => {
  const draft = graph([
    node('agent', 'agent', { memberId: 'gone', instructions: 'Do work' }),
    node('discussion', 'discussion', { participants: ['known', 'also-gone'] }),
    node('unassigned', 'review'),
  ], []);
  const preview = teamFlowPreview(flow(draft), [member('known', 'Known member')]);
  const byId = Object.fromEntries(preview.nodes.map((item) => [item.id, item]));

  assert.deepEqual(byId.agent.memberIds, ['gone']);
  assert.deepEqual(byId.agent.missingMemberIds, ['gone']);
  assert.equal(byId.agent.hasMissingMember, true);
  assert.deepEqual(byId.discussion.members, [
    { id: 'known', name: 'Known member', missing: false },
    { id: 'also-gone', name: undefined, missing: true },
  ]);
  assert.equal(byId.discussion.hasMissingMember, true);
  assert.deepEqual(byId.unassigned.memberIds, []);
  assert.equal(byId.unassigned.hasMissingMember, true);
});
