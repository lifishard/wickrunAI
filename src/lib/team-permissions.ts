/*
 * 协作运行的工具与授权边界。electron/team-permissions.cjs 是主进程里的同一份规则，
 * 由测试保证两边一致：界面决定给成员声明哪些工具，主进程执行前再按同一份清单拦一次。
 */

/** 只读：查资料、读文件、看网页，不改变任何东西。想法梳理和质检步骤只开放这些。 */
export const TEAM_READ_ONLY_TOOLS = [
  'web_search', 'fetch_url', 'chrome_tabs', 'chrome_read_page', 'chrome_fetch_json', 'github_search',
  'list_dir', 'list_directory', 'read_file', 'read_document', 'search_files', 'inspect_deliverable',
  'read_tool_result', 'project_memory_read', 'project_doc_read', 'recall_past_task', 'read_skill', 'read_context',
  'request_user_input', 'update_plan', 'update_requirements', 'verify_requirements', 'read_review_text', 'read_source_text',
] as const;

/** 路径受任务目录约束的工具。文件任务里这些按读/改/命令级别放行，其他工具按成员配置。 */
export const TEAM_SCOPED_FILE_TOOLS = [
  'list_dir', 'list_directory', 'read_file', 'read_document', 'search_files',
  'write_file', 'edit_file', 'write_document', 'delete_file', 'register_outputs', 'run_command',
] as const;

export type TeamGrantScope = 'path' | 'screen' | 'admin';
export interface TeamAccessGrant { memberId: string; scope: TeamGrantScope; target?: string; reason: string; at: number }

/** 这位成员在本次运行里被批准的授权。只看本人的记录，别的成员批过的不算。 */
export function teamGrants(run: { accessGrants?: TeamAccessGrant[] }, memberId: string): { extraRoots: string[]; screen: boolean; admin: boolean } {
  const own = (run.accessGrants ?? []).filter((g) => g.memberId === memberId);
  return {
    extraRoots: [...new Set(own.filter((g) => g.scope === 'path' && g.target).map((g) => g.target!))],
    screen: own.some((g) => g.scope === 'screen'),
    admin: own.some((g) => g.scope === 'admin'),
  };
}

export const isAbsolutePath = (value: string) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
