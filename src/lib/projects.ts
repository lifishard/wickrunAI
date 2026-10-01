import { getTransport } from './transport';
import { uid } from './store';
import { memoryItemsOf, pruneMemory, renderMemoryText, selectMemoryForPrompt, type ProjectMemoryItem } from './memory-core';

/* ------------------------------------------------------------------ *
 * 项目（Project）
 *
 * 一个项目 = 一组对话 + 一份共享的上下文。同一个项目里新开的对话自动继承：
 *   - 项目规范（instructions）→ 拼进 system prompt
 *   - 项目文档（docs）→ 目录进 system prompt，正文按需用工具读
 *   - 项目记忆（memory）→ 模型可以读写，跨对话累积
 *   - 常用提示词（prompts）→ 输入框里一键插入
 *
 * 文档为什么不全量注入：一个项目攒几万字很正常，每轮都塞进去等于每轮
 * 重付一次钱。给目录 + 一个读取工具，让模型自己决定要不要看。
 * ------------------------------------------------------------------ */

const K_PROJECTS = 'snc:projects:v1';

export interface ProjectDoc {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
  cloudFile?: { sha256:string;size:number;encrypted?:boolean };
}

export interface ProjectPrompt {
  id: string;
  label: string;
  text: string;
}

export interface Project {
  id: string;
  name: string;
  emoji: string;
  /** 这个项目里所有对话都要遵守的规范 */
  instructions: string;
  docs: ProjectDoc[];
  prompts: ProjectPrompt[];
  /**
   * 旧版的整段记忆文本。现在以 memoryItems 为准，这里只保留一份可读的镜像，
   * 给还没升级的设备看；读到没有 memoryItems 的旧数据时由它迁移成条目。
   */
  memory: string;
  /** 跨对话累积的记忆，一条一条：可单独编辑、置顶、删除，按条同步合并 */
  memoryItems?: ProjectMemoryItem[];
  /** 这个项目的失灵交接名单；会话没设置时用它，它没设置再看应用全局 */
  failover?: import('./failover').FailoverConfig;
  /** 这个项目默认用哪个模型 / 凭据，新开对话时套上 */
  defaultModel?: string;
  defaultKeyProfileId?: string | null;
  createdAt: number;
}

export function makeProject(name: string): Project {
  return {
    id: uid('p'),
    name: name.trim() || '新项目',
    emoji: '📁',
    instructions: '',
    docs: [],
    prompts: [],
    memory: '',
    memoryItems: [],
    createdAt: Date.now(),
  };
}

export async function loadProjects(): Promise<Project[]> {
  try {
    const raw = await getTransport().kvGet(K_PROJECTS);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error("记录格式无效");
    return (list as Project[]).map((p) => ({
      ...p,
      docs: p.docs ?? [],
      prompts: p.prompts ?? [],
      memory: p.memory ?? '',
      // 旧数据只有整段文字：按内容确定 id 迁移成条目，两台设备迁移结果一致
      memoryItems: memoryItemsOf(p),
      instructions: p.instructions ?? '',
    }));
  } catch (error) {
    throw new Error(`Project 数据读取失败：${String(error)}`);
  }
}

export async function saveProjects(list: Project[]): Promise<void> {
  await getTransport().kvSet(K_PROJECTS, JSON.stringify(list.map(withMemoryMirror)));
}

/** 存盘前：清掉过期墓碑，并刷新给旧版本看的文字镜像 */
export function withMemoryMirror(p: Project): Project {
  if (!Array.isArray(p.memoryItems)) return p;
  const items = pruneMemory(p.memoryItems);
  return { ...p, memoryItems: items, memory: renderMemoryText(items) };
}

/**
 * 项目拼进 system prompt 的那一段。
 * 文档只给目录和字数，正文让模型用 project_doc_read 按需取。
 */
export function projectSystemBlock(p: Project | null, query = '', opts: { memory?: boolean } = {}): string {
  if (!p) return '';
  const parts: string[] = [`当前项目：${p.name}`];

  if (p.instructions.trim()) {
    parts.push(`项目规范（本项目内所有对话都要遵守）：\n${p.instructions.trim()}`);
  }

  // 放得下就全放（前缀稳定、缓存能命中）；放不下按置顶、相关度、新近程度挑，其余让模型按需查
  // 协作运行的记忆走创建运行时冻结的快照（team-memory），这里不再放一份
  const memory = selectMemoryForPrompt(opts.memory === false ? [] : memoryItemsOf(p), { query });
  if (memory.selected.length) {
    parts.push(
      `项目记忆（之前几轮对话里攒下来的，每条带 id，可能有用）：\n${memory.prompt}\n` +
        (memory.omitted ? `另有 ${memory.omitted} 条未展示，需要时用 project_memory_read 按关键词查。\n` : '') +
        '有值得跨对话记住的结论或约定，用 project_memory_write 记下一条；发现某条过时了，用它的 id 更新或用 project_memory_forget 删除。',
    );
  }

  if (p.docs.length) {
    const index = p.docs
      .map((d) => `  - ${d.name}（${d.cloudFile&&!d.text?'正文尚未同步，需要来源设备上线':`${d.text.length} 字`}）`)
      .join('\n');
    parts.push(
      `项目文档清单（正文没有直接给你，需要时用 project_doc_read 按名字读）：\n${index}`,
    );
  }

  return parts.join('\n\n');
}
