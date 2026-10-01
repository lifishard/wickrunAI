const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const { resolveSharedHandoff } = loader()(path.resolve(__dirname, '../src/lib/shared-handoff.ts'));

const team = () => ({
  id: 'local-project',
  workflows: [{ id: 'local-flow', archived: false }],
  members: [{ id: 'local-agent' }],
  tasks: [],
});
const target = { id: 'shared-flow', kind: 'workflow', title: 'Receiving workflow', ownerId: 'alice', sourceId: 'local-flow' };
const connection = { sourceItemId: 'sender-item', targetItemId: 'shared-flow', targetAgentId: 'local-agent' };
const receipt = { id: 'receipt-1', actorId: 'bob', actorName: 'Bob', createdAt: 123, payload: {
  goal: 'Analyze the report', summary: 'Use Q3 numbers', artifacts: [{ name: 'facts.txt', text: 'Revenue grew' }],
} };
const input = () => ({ receipt, connection, target, canonicalId: 'alice', teams: { 'local-project': team() }, localProjectIds: ['local-project'] });

test('owner workflow and selected local Agent yield an unsent, idempotent task draft', () => {
  const args = input();
  const result = resolveSharedHandoff(args);
  assert.equal(result.kind, 'task');
  assert.equal(result.projectId, 'local-project');
  assert.equal(result.task.workflowId, 'local-flow');
  assert.equal(result.task.ownerId, 'local-agent');
  assert.equal(result.task.status, '草稿');
  assert.equal(result.task.intent, 'explore');
  assert.equal(result.task.goal, 'Analyze the report');
  assert.match(result.task.entries[0].text, /Use Q3 numbers/);
  assert.match(result.task.entries[0].text, /Revenue grew/);
  assert.match(result.task.entries[0].text, /receipt-1.*sender-item/);
  assert.equal(args.teams['local-project'].tasks.length, 0);
  args.teams['local-project'].tasks.push(result.task);
  const repeated = resolveSharedHandoff(args);
  assert.equal(repeated.kind, 'task');
  assert.equal(repeated.existing, true);
  assert.equal(repeated.task, result.task);
});

test('remote workflow owner or stale shared IDs cannot silently route to local Agent', () => {
  for (const change of [
    { target: { ...target, ownerId: 'bob' } },
    { target: { ...target, sourceId: 'imported-remote-id' } },
    { connection: { ...connection, targetAgentId: 'other-agent' } },
    { connection: { ...connection, targetItemId: 'other-item' } },
  ]) {
    const result = resolveSharedHandoff({ ...input(), ...change });
    assert.equal(result.kind, 'review');
    assert.equal(result.targetTitle, 'Receiving workflow');
  }
});

test('explicit recipient selection can route a foreign shared workflow only to an existing local target', () => {
  const args = { ...input(), target: { ...target, ownerId: 'bob' },
    selectedLocal: { projectId: 'local-project', workflowId: 'local-flow', agentId: 'local-agent' } };
  const resolved = resolveSharedHandoff(args);
  assert.equal(resolved.kind, 'task');
  assert.equal(resolved.reviewed, true);
  assert.equal(resolveSharedHandoff({ ...args, selectedLocal: { ...args.selectedLocal, agentId: 'unknown' } }).kind, 'review');
});

test('the same receipt cannot create a second task in a different project', () => {
  const args = input();
  const first = resolveSharedHandoff(args);
  const other = team();
  other.id = 'other-project';
  other.workflows[0].id = 'other-flow';
  other.members[0].id = 'other-agent';
  args.teams['local-project'].tasks.push(first.task);
  args.teams['other-project'] = other;
  args.localProjectIds.push('other-project');
  const switched = resolveSharedHandoff({ ...args,
    selectedLocal: { projectId: 'other-project', workflowId: 'other-flow', agentId: 'other-agent' } });
  assert.equal(switched.kind, 'review');
  assert.match(switched.reason, /already has a draft/);
});

test('owner project keeps ordinary draft route while foreign project requires review', () => {
  const args = { ...input(), target: { ...target, id: 'shared-project', kind: 'project', sourceId: 'local-project' },
    connection: { ...connection, targetItemId: 'shared-project', targetAgentId: undefined } };
  assert.deepEqual(resolveSharedHandoff(args), { kind: 'project', projectId: 'local-project' });
  assert.equal(resolveSharedHandoff({ ...args, target: { ...args.target, ownerId: 'bob' } }).kind, 'review');
});
