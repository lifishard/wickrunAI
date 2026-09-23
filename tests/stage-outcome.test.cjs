const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-ts.cjs').loader();
const { stageOutcome } = load(path.join(__dirname, '../src/lib/stage-outcome.ts'));
const answer = extra => ({ id: 'a', role: 'assistant', content: 'Done', createdAt: 1, ...extra });
const milestone = (title, status) => ({ id: title, title, status, evidence: [], updatedAt: 1 });
const requirement = (title, revision, verification) => ({ id: title, title, revision, check: { kind: 'review' }, history: [], verification });

test('ordinary chat and active/waiting responses do not claim a stage conclusion', () => {
  assert.equal(stageOutcome(answer({})), null);
  for (const status of ['running', 'waiting']) assert.equal(stageOutcome(answer({ pending: true, runState: { status, milestones: [milestone('work', 'completed')] } })), null);
});

test('native end of turn preserves unfinished milestones even when the prose says done', () => {
  const check = { ...requirement('plan check', 1, { revision: 1, status: 'passed', method: 'program' }), milestoneId: 'plan' };
  const result = stageOutcome(answer({ milestones: [milestone('plan', 'completed'), milestone('implementation', 'verifying')], delivery: { requirements: [check] } }));
  assert.deepEqual(result.completed, ['plan']);
  assert.deepEqual(result.remaining, ['implementation']);
  assert.match(result.title, /未完成或待验证/);
  assert.equal(result.requirementCount, 1);
});

test('a completed milestone without current checks stays pending, matching the activity panel', () => {
  const input = answer({ milestones: [milestone('unsupported claim', 'completed')], delivery: { requirements: [] } });
  const result = stageOutcome(input);
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.remaining, ['unsupported claim']);
  assert.equal(input.milestones[0].status, 'completed');
});

test('only checks of the current revision count, separating program and model evidence', () => {
  const requirements = [requirement('automated', 2, { revision: 2, status: 'passed', method: 'program' }),
    requirement('judgment', 1, { revision: 1, status: 'passed', method: 'model' }),
    requirement('changed', 2, { revision: 1, status: 'passed', method: 'program' }),
    requirement('failed', 1, { revision: 1, status: 'failed', method: 'program' })];
  const result = stageOutcome(answer({ delivery: { requirements, status: 'passed' } }));
  assert.equal(result.programChecks, 1); assert.equal(result.modelChecks, 1);
  assert.deepEqual(result.remaining, ['changed', 'failed']);
  const { recoveryInfo } = load(path.join(__dirname, '../src/lib/delivery.ts'));
  assert.deepEqual(recoveryInfo({ requirements, steps: [] }).remaining, ['changed', 'failed']);
});

test('pause and uncertain results take precedence over passed conditions, without mutating the checkpoint', () => {
  const state = { status: 'paused', stoppedBy: 'user', reason: '请求已停止', requirements: [], milestones: [], steps: [] };
  const input = answer({ runState: state });
  const before = JSON.stringify(input);
  assert.match(stageOutcome(input).title, /按你的要求暂停/);
  assert.equal(JSON.stringify(input), before);
  state.uncertainCallId = 'call';
  assert.match(stageOutcome(input).title, /结果待核实/);
  assert.match(stageOutcome(input).next, /重试可能重复/);
});

test('saved checks still produce a bounded conclusion after completed runState is removed', () => {
  const result = stageOutcome(answer({ delivery: { requirements: [requirement('checked', 1, { revision: 1, status: 'passed', method: 'program' })] } }));
  assert.match(result.title, /已列条件检查通过/);
  assert.match(result.next, /仅覆盖已列/);
  assert.match(stageOutcome(answer({ steps: [{ status: 'ok' }] })).title, /结果待确认/);
});
