const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

const root = path.resolve(__dirname, '..');
const file = (name) => path.resolve(root, name);
const memory = loader()(file('src/lib/team-memory.ts'));

function entry(overrides = {}) {
  return {
    id: 'memory-default', title: 'Default memory', text: 'durable guidance', applicability: 'This project',
    evidence: 'reviewed', status: 'adopted', revision: 1, history: [],
    ...overrides,
  };
}

test('legacy adopted entries keep project-wide behavior while non-adopted entries stay out', () => {
  const legacy = entry({ id: 'a-legacy', revision: 2 });
  delete legacy.kind;
  delete legacy.scope;
  delete legacy.keywords;
  delete legacy.expiresAt;
  const input = [
    entry({ id: 'b-candidate', status: 'candidate', text: 'candidate guidance' }),
    entry({ id: 'c-adopted', text: 'adopted guidance' }),
    legacy,
  ];
  const result = memory.selectTeamMemories(input, { goal: 'unrelated task', acceptance: 'unrelated' }, { now: 1000 });

  assert.deepEqual(result.snapshots.map((item) => item.id), ['a-legacy', 'c-adopted']);
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshots[0], 'scope'), false);
  assert.match(result.prompt, /\[a-legacy@2\] kind=experience scope=project/);
  assert.match(result.prompt, /title=Default memory applicability=This project/);
  assert.ok(result.audit.every((item) => item.id && Number.isInteger(item.revision) && item.reason));
  assert.equal(result.audit.find((item) => item.id === 'b-candidate').reason, 'omitted: status is not adopted');
});

test('expiry is evaluated against the frozen timestamp and the exact boundary is expired', () => {
  const result = memory.selectTeamMemories([
    entry({ id: 'a-boundary', expiresAt: 1000 }),
    entry({ id: 'b-past', expiresAt: 999 }),
    entry({ id: 'c-future', expiresAt: 1001 }),
    entry({ id: 'd-never' }),
  ], { goal: '', acceptance: '' }, { now: 1000 });

  assert.deepEqual(result.snapshots.map((item) => item.id), ['c-future', 'd-never']);
  assert.match(result.audit.find((item) => item.id === 'a-boundary').reason, /expired/);
  assert.match(result.audit.find((item) => item.id === 'b-past').reason, /expired/);
});

test('project scope always applies while task scope requires an explicit lexical match', () => {
  const result = memory.selectTeamMemories([
    entry({ id: 'a-project', scope: 'project', keywords: [], text: 'always project guidance' }),
    entry({ id: 'b-task-match', scope: 'task', keywords: ['release'], text: 'release guidance' }),
    entry({ id: 'c-task-miss', scope: 'task', keywords: ['database'], text: 'database guidance' }),
    entry({ id: 'd-task-no-keywords', scope: 'task', text: 'invalid task guidance' }),
  ], { goal: 'Prepare the release notes', acceptance: 'Review the release' }, { now: 1000 });

  assert.deepEqual(result.snapshots.map((item) => item.id), ['a-project', 'b-task-match']);
  assert.equal(result.audit.find((item) => item.id === 'c-task-miss').reason, 'omitted: no task keyword match');
  assert.match(result.audit.find((item) => item.id === 'd-task-no-keywords').reason, /keywords/);
});

test('task matching supports Chinese substrings and case-insensitive Latin term boundaries', () => {
  const result = memory.selectTeamMemories([
    entry({ id: 'a-chinese', scope: 'task', keywords: ['课程'], text: 'Chinese task memory' }),
    entry({ id: 'b-latin', scope: 'task', keywords: ['API'], text: 'Latin task memory' }),
    entry({ id: 'c-hyphen', scope: 'task', keywords: ['API'], text: 'Hyphen task memory' }),
    entry({ id: 'd-inside-word', scope: 'task', keywords: ['CAT'], text: 'False positive memory' }),
  ], {
    goal: '安排课程表，并 build an api client',
    acceptance: 'The API-first output is required; concatenate is unrelated',
  }, { now: 1000 });

  assert.deepEqual(result.snapshots.map((item) => item.id), ['a-chinese', 'b-latin', 'c-hyphen']);
  assert.equal(result.audit.find((item) => item.id === 'd-inside-word').reason, 'omitted: no task keyword match');
});

test('size cap omits whole memories and reports oversized versus overflow without truncation', () => {
  const result = memory.selectTeamMemories([
    entry({ id: 'a-big', text: 'BIG-' + 'x'.repeat(5000) }),
    entry({ id: 'b-one', text: 'ONE-' + 'o'.repeat(650) }),
    entry({ id: 'c-two', text: 'TWO-' + 't'.repeat(650) }),
  ], { goal: '', acceptance: '' }, { now: 1000, maxChars: 1000 });

  assert.equal(result.maxChars, 1000);
  assert.equal(result.totalChars, result.prompt.length);
  assert.ok(result.totalChars <= 1000);
  assert.deepEqual(result.snapshots.map((item) => item.id), ['b-one']);
  assert.doesNotMatch(result.prompt, /BIG-|TWO-/);
  assert.match(result.audit.find((item) => item.id === 'a-big').reason, /exceeds context limit/);
  assert.match(result.audit.find((item) => item.id === 'c-two').reason, /context limit reached/);
  assert.equal(result.prompt, memory.formatTeamMemory(result.snapshots[0]));
});

test('metadata validation rejects invalid fields and empty contents without changing adoption status', () => {
  assert.equal(memory.validateTeamMemoryMetadata({ scope: 'task' }).ok, false);
  assert.equal(memory.validateTeamMemoryMetadata({ scope: 'sideways' }).field, 'scope');
  assert.equal(memory.validateTeamMemoryMetadata({ kind: 'lesson' }).field, 'kind');
  assert.equal(memory.validateTeamMemoryMetadata({ expiresAt: Number.NaN }).field, 'expiresAt');
  assert.equal(memory.validateTeamMemoryMetadata({ expiresAt: 1.5 }).field, 'expiresAt');
  assert.equal(memory.validateTeamMemoryEntry({ text: '   ', status: 'candidate' }).field, 'text');

  const valid = memory.validateTeamMemoryEntry({ text: 'keep this', status: 'candidate', scope: 'task', keywords: ['API'], expiresAt: 1 });
  assert.equal(valid.ok, true);
  assert.equal(valid.status, 'candidate');
  assert.deepEqual(valid.metadata, { scope: 'task', keywords: ['API'], expiresAt: 1 });
});

test('selection is pure, snapshots are detached, and audit stays bounded to metadata', () => {
  const input = [entry({ id: 'b', text: 'B-' + 'b'.repeat(100) }), entry({ id: 'a', text: 'A-' + 'a'.repeat(100) })];
  const before = structuredClone(input);
  const first = memory.selectTeamMemories(input, { goal: 'goal', acceptance: 'acceptance' }, { now: 1000 });
  const baseline = structuredClone(first);

  first.snapshots[0].text = 'mutated result';
  first.audit[0].reason = 'mutated audit';
  assert.deepEqual(input, before);
  const second = memory.selectTeamMemories(input, { goal: 'goal', acceptance: 'acceptance' }, { now: 1000 });
  assert.deepEqual(second, baseline);
  assert.ok(JSON.stringify(second.audit).length < 1000);
  assert.doesNotMatch(JSON.stringify(second.audit), /A-|B-/);
});
