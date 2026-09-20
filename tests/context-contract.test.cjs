'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-ts.cjs').loader();

const file = (name) => path.resolve(__dirname, '../src/lib', `${name}.ts`);
const contractApi = load(file('task-contract'));
const memory = load(file('context-memory'));
const handoff = load(file('handoff'));

const source = (id, content, createdAt) => ({ id, role: 'user', content, createdAt });
const requirement = (revision, sourceId, sourceQuote, title = '交付报告') => ({
  id: 'report', revision, title, sourceId, sourceQuote,
  check: { kind: 'file_exists', path: 'C:/out/report.txt' }, at: revision,
  history: revision > 1 ? [{ revision: 1, title, sourceId: 'goal', sourceQuote: '写报告', check: { kind: 'file_exists', path: 'C:/out/report.txt' }, at: 1 }] : [],
  verificationHistory: [],
});

function state(extra = {}) {
  return {
    runId: 'run-1', status: 'paused', round: 2, at: 1, stoppedBy: 'user', working: [
      source('goal', '写报告，保留原始日期。', 1),
      source('correction', '更正：不要写入原文件；只写入新文件。', 2),
    ], requirementSourceIds: ['goal', 'correction'], requirements: [requirement(2, 'correction', '更正：不要写入原文件；只写入新文件。')],
    milestones: [{ id: 'm', title: '交付报告', status: 'verifying', evidence: ['write-ok'], updatedAt: 2 }],
    steps: [{ id: 'write-ok', callId: 'call-ok', name: 'write_file', status: 'ok', summary: '写入新文件', resultRef: 'saved-new', startedAt: 2 }],
    ...extra,
  };
}

test('portable contract keeps the effective correction and original source history, including negation', () => {
  const s = state();
  const before = JSON.stringify(s);
  const contract = contractApi.taskContractFromState(s);
  assert.equal(contract.requirements[0].revision, 2);
  assert.equal(contract.requirements[0].sourceId, 'correction');
  assert.equal(contract.requirements[0].history[0].sourceId, 'goal');
  assert.equal(contract.sources.find((item) => item.id === 'goal').content, '写报告，保留原始日期。');
  assert.equal(contract.corrections.at(-1).id, 'correction');
  assert.match(contract.corrections.at(-1).content, /不要写入原文件/);
  assert.equal(contract.summary.semanticStatus, 'unverifiable');
  assert.match(memory.memoryInstructions(s), /不要写入原文件/);
  assert.match(memory.memoryInstructions(s), /语义蕴含只能做结构核对/);
  contract.requirements[0].title = 'mutated transport view';
  assert.equal(JSON.stringify(s), before);
});

test('failed, attempted, and uncertain side effects stay non-completed with pending action references', () => {
  const s = state({
    status: 'paused',
    steps: [
      { id: 'write-failed', callId: 'call-failed', name: 'write_file', status: 'error', summary: '写入失败', error: 'permission denied', startedAt: 3 },
      { id: 'write-unknown', callId: 'call-unknown', name: 'write_file', status: 'running', summary: '写入结果未知', startedAt: 4 },
    ],
    pendingCalls: [{ id: 'call-unknown', name: 'write_file', arguments: '{"path":"C:/out/report.txt"}' }],
    toolCursor: 0,
    uncertainCallId: 'call-unknown',
    milestones: [{ id: 'm', title: '交付报告', status: 'verifying', evidence: ['write-failed'], updatedAt: 4 }],
  });
  const contract = contractApi.taskContractFromState(s);
  assert.equal(contract.evidence.find((item) => item.id === 'write-failed').outcome, 'failed');
  assert.equal(contract.evidence.find((item) => item.id === 'write-unknown').outcome, 'unknown');
  assert.equal(contract.pending[0].id, 'call-unknown');
  assert.equal(contract.uncertain.callId, 'call-unknown');
  assert.equal(contract.milestones[0].status, 'verifying');
  assert.equal(contract.requirements[0].verification, undefined);
});

test('repeated compaction keeps raw sources, archived evidence, and model-switch handoff references', () => {
  const working = [source('goal', '保留原始目标和路径 C:/out/report.txt。', 1)];
  const steps = [{ id: 'archived-ok', callId: 'archived-call', name: 'read_file', status: 'ok', summary: '读取旧证据', resultRef: 'archived-result', startedAt: 1 }];
  for (let i = 0; i < 8; i += 1) {
    working.push({ id: `a${i}`, role: 'assistant', content: `调查 ${i}`, toolCalls: [{ id: `c${i}`, name: 'read_file', arguments: '{}' }], createdAt: i + 2 });
    working.push({ id: `t${i}`, role: 'tool', toolCallId: `c${i}`, toolName: 'read_file', content: `RAW_EVIDENCE_${i}`, createdAt: i + 2 });
  }
  const s = state({ working, contextArchive: [{ id: 'archived-user', role: 'user', content: 'ARCHIVED_SOURCE', createdAt: 0 }], contextArchiveSteps: steps, compactions: [] });
  const before = JSON.stringify(s.working);
  for (const throughIndex of [2, 4, 6]) {
    const summary = { facts: [{ text: `fact-${throughIndex}`, sources: [s.working[throughIndex].id] }], decisions: [], unresolved: [{ text: '仍待检查', sources: ['goal'] }], nextSteps: ['继续核实'] };
    s.compactions.push(memory.validateCompaction(JSON.stringify(summary), s, throughIndex));
  }
  assert.equal(JSON.stringify(s.working), before);
  assert.match(memory.readContext(s, { id: 'goal' }).content, /保留原始目标/);
  assert.match(memory.readContext(s, { id: 't0' }).content, /RAW_EVIDENCE_0/);
  const contract = contractApi.taskContractFromState(s);
  assert.equal(contract.summary.available, true);
  assert.equal(contract.evidence.find((item) => item.id === 'archived-ok').resultRef, 'archived-result');

  const sourceRecord = { config: { model: 'model-a' }, state: s };
  const portable = handoff.withHandoffArchive({ history: [], archive: [], evidence: [], checkpoints: 0 }, sourceRecord);
  assert.equal(portable.fromModel, 'model-a');
  assert.equal(portable.taskContract.evidence.find((item) => item.id === 'archived-ok').resultRef, 'archived-result');
  assert.match(JSON.stringify(portable.archive), /ARCHIVED_SOURCE/);
  const draft = handoff.createContextHandoff({ id: 'conversation', title: '报告', config: { model: 'model-a' }, keyProfileId: 'k' }, s, 'handoff-1');
  assert.match(draft.draft, /语义蕴含只能做结构核对/);
});

test('compaction rejects malformed boundaries, orphaned tool batches, and unreferenced summary sources', () => {
  const s = state({
    working: [source('goal', '目标', 1), { id: 'assistant', role: 'assistant', content: 'call', toolCalls: [{ id: 'call', name: 'read_file', arguments: '{}' }], createdAt: 2 }, { id: 'tool', role: 'tool', toolCallId: 'call', toolName: 'read_file', content: 'raw', createdAt: 3 }],
    compactions: [],
  });
  const valid = { facts: [{ text: '事实', sources: ['tool'] }], decisions: [], unresolved: [], nextSteps: [] };
  assert.throws(() => memory.validateCompaction(JSON.stringify(valid), s, -1), /边界/);
  assert.throws(() => memory.validateCompaction(JSON.stringify(valid), s, 99), /边界/);
  assert.throws(() => memory.validateCompaction(JSON.stringify(valid), s, 1), /工具调用/);
  assert.throws(() => memory.validateCompaction(JSON.stringify({ ...valid, facts: [{ text: '虚构', sources: ['missing'] }] }), s, 2), /来源/);
  const contract = contractApi.taskContractFromState(s);
  assert.throws(() => contractApi.validateTaskContract({ ...contract, summary: { available: true, semanticStatus: 'proved' } }), /摘要状态/);
});

test('prompt and handoff projections stay bounded while the archived original remains retrievable', () => {
  const originalText = `ORIGINAL_GOAL_${'x'.repeat(200000)}`;
  const history = Array.from({ length: 50 }, (_, index) => ({ revision: index + 1, title: `旧要求 ${index}`, sourceId: `old-${index}`, sourceQuote: `旧原文 ${index}`, check: { kind: 'review' }, at: index + 1 }));
  const s = state({
    working: [source('latest', '更正：只更新新文件。', 3)],
    contextArchive: [{ id: 'goal', role: 'user', content: originalText, createdAt: 1 }],
    requirementSourceIds: ['latest'],
    requirements: [{ id: 'r', revision: 51, title: '当前要求', sourceId: 'latest', sourceQuote: '更正：只更新新文件。', check: { kind: 'review' }, at: 51, history, verificationHistory: [] }],
    milestones: Array.from({ length: 20 }, (_, index) => ({ id: `m-${index}`, title: `里程碑 ${index}`, status: 'verifying', evidence: [], updatedAt: index })),
  });
  const full = contractApi.taskContractFromState(s);
  const prompt = contractApi.taskContractPrompt(full);
  const notes = handoff.checkpointNotes(s);
  assert.ok(prompt.length <= 10000, `prompt length ${prompt.length}`);
  assert.ok(JSON.stringify(notes).length <= 20000, `checkpoint length ${JSON.stringify(notes).length}`);
  assert.match(prompt, /goal/);
  assert.match(prompt, /未列出的原文/);
  assert.doesNotMatch(prompt, /x{1000}/);
  assert.match(memory.readContext(s, { id: 'goal', offset: 0, limit: 200 }).content, /ORIGINAL_GOAL/);
  const draft = handoff.createContextHandoff({ id: 'old', title: '大任务', config: { model: 'a' }, keyProfileId: 'k' }, s, 'bounded');
  assert.ok(draft.draft.length < 30000, `draft length ${draft.draft.length}`);
  assert.match(draft.draft, /完整原文可用 read_context/);
});
