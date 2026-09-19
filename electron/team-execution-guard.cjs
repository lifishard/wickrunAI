'use strict';
const path = require('node:path');
const WORK = new Set(['agent','discussion','review','handoff']);
/*
 * 交付闸门自己要用的两件只读工具，不受成员工具白名单限制。
 *
 * 它们不是成员挑来干活的工具，是执行器在 verify_requirements 和分页读结果时
 * 自己发起的调用，界面上也没有对应的勾选项。按白名单拦下来的后果是：
 * 协作空间里**任何**「可程序核验的验收」都会失败，模型只能退回自评，
 * 而自评本来就不算证据 —— 整条质检链就此空转。
 *
 * 两件都是只读：inspect_deliverable 只读取并比对交付物，read_tool_result 只翻自己
 * 已经存下来的结果。工作目录仍然受隔离区约束，没有放宽任何范围。
 */
const HARNESS_TOOLS = new Set(['inspect_deliverable','read_tool_result']);
function createTeamExecutionGuard({ collaboration, teamFiles }) {
  const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  function identity(projectId, runId, memberId, attemptId) {
    if ([projectId,runId,memberId].some(v => typeof v !== 'string' || !v)) throw Error('协作执行身份无效');
    const project = collaboration.read().projects[projectId], run = project?.runs.find(r => r.id === runId), member = run?.members.find(m => m.id === memberId);
    if (!run || run.status !== 'running' || !member?.enabled || !Array.isArray(run.projectSettings?.allowedConnections) || (run.projectSettings.allowedConnections.length && !run.projectSettings.allowedConnections.includes(member.connectionId))) throw Error('协作执行已停止或接入尚未授权');
    const owns = attempt => {
      const node = run.version?.graph?.nodes?.find(n => n.id === attempt.nodeId);
      return attempt.status === 'running' && WORK.has(node?.type) && (node.type === 'discussion' ? node.participants?.includes(memberId) : node.memberId === memberId);
    };
    const attempt = attemptId ? run.attempts.find(a => a.id === attemptId && owns(a)) : run.attempts.find(owns);
    if (!attempt) throw Error('当前执行步骤没有指派该成员');
    if (!Array.isArray(run.projectSettings.roots) || run.projectSettings.roots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) throw Error('协作目录授权无效');
    return { project, run, member, attempt };
  }
  function authorizedFile(id, current) {
    const { project, run, member } = current, session = teamFiles.get(id);
    if (!project.files.some(f => f.id === id) || session.projectId !== project.id || session.taskId !== run.id || session.memberId !== member.id || !['isolated','pending'].includes(session.status) || session.recoveryRequired || !path.isAbsolute(session.root || '') || !path.isAbsolute(session.isolatedRoot || '') || !run.projectSettings.roots.some(root => normalized(root) === normalized(session.root))) throw Error('文件隔离范围未获授权或需要恢复核实');
    return session;
  }
  function tool(name, ctx) {
    const scope = ctx?.teamExecution;
    if (!scope || typeof scope.attemptId !== 'string' || !scope.attemptId) throw Error('工具缺少协作执行身份');
    const current = identity(scope.projectId, scope.runId, scope.memberId, scope.attemptId), { run, member } = current;
    if (!Array.isArray(member.tools) || (!member.tools.includes(name) && !(HARNESS_TOOLS.has(name) && member.tools.length))) throw Error('工具不在当前成员授权范围');
    const amount = run.reservations?.[scope.attemptId + ':' + scope.memberId], reserved = Object.values(run.reservations || {}).reduce((sum,n) => sum + n,0);
    if (!Number.isFinite(amount) || amount <= 0 || amount > member.maxTokens || !Number.isFinite(reserved) || !Number.isFinite(run.version.graph.maxTokens) || (run.tokens || 0) + reserved > run.version.graph.maxTokens) throw Error('工具派发缺少有效的本次用量预留');
    const roots = scope.fileSessionId ? [authorizedFile(scope.fileSessionId,current).isolatedRoot] : [];
    return { ...ctx, projectId: scope.projectId, workspaceRoots: roots, grants: { extraRoots: [], screen: false, admin: false } };
  }
  function createFileSession(args = {}) {
    const current = identity(args.projectId,args.taskId,args.memberId), roots = current.run.projectSettings.roots;
    if (typeof args.root !== 'string' || !path.isAbsolute(args.root) || !roots.some(root => normalized(root) === normalized(args.root))) throw Error('复制目录不在本次运行的冻结授权范围');
    return teamFiles.create({ projectId: current.project.id, taskId: current.run.id, memberId: current.member.id, root: args.root }, roots);
  }
  return { tool, createFileSession };
}
module.exports = { createTeamExecutionGuard };
