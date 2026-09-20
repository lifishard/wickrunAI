'use strict';
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../tests/fixtures/team-strategy-case.cjs');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'artifacts', 'team-strategy-comparison', 'anonymous-report.json'));
const raw = fs.readFileSync(file, 'utf8');
const report = JSON.parse(raw);
const failures = [];
const arms = ['single', 'discussion', 'review'];

if (report.fixture !== fixture.id || report.inputSha256 !== fixture.digest(fixture.input)) failures.push('fixture_identity');
if (!report.selected?.fixed || !report.selected?.model) failures.push('fixed_model_missing');
if (report.policy?.paidRoutesAllowed !== false || report.policy?.automaticFailover !== false) failures.push('route_policy');
if (report.runs?.map(run => run.strategy).join(',') !== arms.join(',')) failures.push('strategy_set');
if (new Set((report.runs || []).map(run => run.workflowBudgetTokens)).size !== 1) failures.push('unequal_workflow_budget');
if (new Set((report.runs || []).map(run => run.memberBudgetTokens)).size !== 1) failures.push('unequal_member_budget');
if ((report.runs || []).some(run => !run.programCheck?.passed)) failures.push('objective_answer_failure');
if ((report.runs || []).some(run => run.falseCompletion)) failures.push('false_completion');
if (report.runs?.find(run => run.strategy === 'review')?.reviewOutcome !== 'pass') failures.push('review_not_passed');
if (/authorization|bearer|api[_-]?key|extraHeaders|secret/i.test(raw)) failures.push('sensitive_field_name');

const baseline = report.runs?.find(run => run.strategy === 'single');
const comparisons = Object.fromEntries((report.runs || []).map(run => [run.strategy, {
  passed: run.programCheck.passed,
  falseCompletion: run.falseCompletion,
  elapsedMs: run.elapsedMs,
  totalTokens: run.requestUsage.total,
  elapsedVsSingle: baseline ? Number((run.elapsedMs / baseline.elapsedMs).toFixed(2)) : null,
  tokensVsSingle: baseline && Number.isFinite(run.requestUsage.total) && Number.isFinite(baseline.requestUsage.total)
    ? Number((run.requestUsage.total / baseline.requestUsage.total).toFixed(2)) : null,
}]));

process.stdout.write(JSON.stringify({ passed: failures.length === 0, failures, selected: report.selected, comparisons }, null, 2) + '\n');
if (failures.length) process.exitCode = 1;
