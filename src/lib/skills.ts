import { getTransport } from './transport';
import { uid } from './store';
import { tr } from './i18n';
import type { ToolResult } from '../types';

/* ------------------------------------------------------------------ *
 * 技能（Skill）
 *
 * 一个技能 = 一段写好的指令，用 `/名字` 唤起，唤起时作为额外的 system
 * 消息注入这一轮。就这么简单 —— 技能是提示词，不是可执行代码，所以不需要
 * 沙箱，也不会有「装一个技能把你电脑搞了」这种事。
 *
 * 格式跟 Anthropic 的 SKILL.md 一致：YAML frontmatter 给 name / description，
 * 正文是指令本体。GitHub 上现成的技能仓库可以直接装。
 * ------------------------------------------------------------------ */

const K_SKILLS = 'snc:skills:v1';

export interface Skill {
  id: string;
  /** 斜杠命令用的名字，只能是字母数字和连字符 */
  name: string;
  description: string;
  /** 指令正文，注入时就是这一段 */
  body: string;
  /** 从哪来的：手写 / GitHub 仓库地址 */
  source: string;
  enabled: boolean;
  installedAt: number;
  /** 唤起次数，用来把常用的排前面 */
  uses: number;
  /**
   * 用过之后成没成。
   *
   * uses 只说「被叫了多少次」，那是习惯不是效果 —— 一个每次都帮倒忙的技能
   * 也会因为名字好记而排在前面。这里记的是「叫了它的那些任务后来做成没有」。
   */
  outcomes?: { used: number; usable: number };
  /**
   * 安装时正文的指纹。
   * 用来区分「用户手改过」和「原样没动」—— 重装时前者不该被静默覆盖掉。
   * 手写的技能没有这个字段。
   */
  installedHash?: string;
}

/**
 * 正文归一化。
 *
 * 指纹必须建立在同一种表示上，否则会出这种事：安装时按原文算、同步时按
 * 归一化后算 —— 同一份内容两个指纹，于是每次同步都以为「我方改过了」。
 * 所以凡是要比对的地方，一律先过这里。
 */
export function normalizeBody(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

/** 极简 FNV-1a。只用来判断「正文变没变过」，不需要抗碰撞 */
export function bodyHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^\w一-龥-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'skill'
  );
}

/** 解析 SKILL.md：YAML frontmatter + 正文 */
export function parseSkillMd(md: string, fallbackName = ''): Omit<Skill, 'id' | 'installedAt' | 'uses' | 'enabled' | 'source'> {
  let name = fallbackName;
  let description = '';
  let body = normalizeBody(md);

  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    // frontmatter 后面那个空行属于格式不属于内容。不去掉的话每次
    // 「解析 → 序列化 → 再解析」都会多攒一个换行
    body = normalizeBody(fm[2]);
    // 只挑我们认识的两个字段，不引 YAML 库 —— frontmatter 里花活再多也不关我们的事
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(name|description)\s*:\s*(.*)$/i);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (m[1].toLowerCase() === 'name') name = v;
      else description = v;
    }
  }

  if (!name) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) name = h1[1].trim();
  }
  if (!description) {
    const firstLine = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    description = (firstLine ?? '').slice(0, 160);
  }

  return { name: slugify(name), description, body: body.trim() };
}

export function toSkillMd(s: Skill): string {
  return `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.body}\n`;
}

/* ---------------- 存储 ---------------- */

export async function loadSkills(): Promise<Skill[]> {
  try {
    const raw = await getTransport().kvGet(K_SKILLS);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error("记录格式无效");
    return list as Skill[];
  } catch (error) {
    throw new Error(tr('Skill 数据读取失败：{error}', { error: String(error) }));
  }
}

export async function saveSkills(list: Skill[]): Promise<void> {
  await getTransport().kvSet(K_SKILLS, JSON.stringify(list));
}

export function makeSkill(
  partial: Partial<Skill> & { name: string; body: string },
): Skill {
  return {
    id: uid('sk'),
    name: slugify(partial.name),
    description: partial.description ?? '',
    body: partial.body,
    source: partial.source ?? '手写',
    enabled: partial.enabled ?? true,
    installedAt: Date.now(),
    uses: 0,
    installedHash: partial.installedHash,
  };
}

/* ---------------- 斜杠唤起 ---------------- */

/**
 * 输入框里正在打的是不是一个斜杠命令？
 * 规则：光标前的这一行以 / 开头，且 / 后面还没有空格。
 */
export function slashQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.slice(lineStart);
  if (!line.startsWith('/')) return null;
  const q = line.slice(1);
  if (/\s/.test(q)) return null;
  return q;
}

/**
 * 用了这个技能的任务，后来做成的比例。
 *
 * 样本不足就返回 -1 排在有数据的后面，而不是当成 0（那等于判它有罪）
 * 也不是当成 1（那等于新技能天然排第一）。没数据就是没数据。
 */
export const SKILL_MIN_SAMPLES = 5;
export function successRate(s: Skill): number {
  const o = s.outcomes;
  return o && o.used >= SKILL_MIN_SAMPLES ? o.usable / o.used : -1;
}

/**
 * 一个任务有了结果之后，记到它当时用过的技能头上。
 *
 * 只认用户反馈和程序核验过的验收 —— 判据跟路由记分共用一套，
 * 不给技能另立一套更宽松的标准。
 */
export function recordSkillOutcome(skills: Skill[], names: string[], done: boolean): Skill[] {
  if (!names.length) return skills;
  const wanted = new Set(names);
  return skills.map((s) => wanted.has(s.name)
    ? { ...s, outcomes: { used: (s.outcomes?.used ?? 0) + 1, usable: (s.outcomes?.usable ?? 0) + (done ? 1 : 0) } }
    : s);
}

export function matchSkills(skills: Skill[], q: string): Skill[] {
  const needle = q.trim().toLowerCase();
  return skills
    .filter((s) => s.enabled)
    .filter(
      (s) =>
        !needle ||
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      // 名字前缀命中的排最前，其次按「用了它的任务做成没有」，最后才按频次
      const ap = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ar = successRate(a), br = successRate(b);
      if (ar !== br) return br - ar;
      return b.uses - a.uses;
    })
    .slice(0, 12);
}

/* ---------------- 从 GitHub 安装 ---------------- */

export interface GithubTarget {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}

/**
 * 认这几种写法：
 *   owner/repo
 *   owner/repo/path/to/skill
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/skills/foo
 */
export function parseGithubTarget(input: string): GithubTarget | null {
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  s = s.replace(/\.git$/, '');
  s = s.replace(/^\/+|\/+$/g, '');
  if (!s) return null;

  const parts = s.split('/');
  if (parts.length < 2) return null;
  const [owner, repo, ...rest] = parts;

  let ref: string | undefined;
  let path = '';
  if (rest[0] === 'tree' || rest[0] === 'blob') {
    ref = rest[1];
    path = rest.slice(2).join('/');
  } else {
    path = rest.join('/');
  }
  return { owner, repo, path, ref };
}

interface GhEntry {
  type: string;
  name: string;
  path: string;
  /** 目录的 sha —— 用它可以一次把整棵子树拉下来，省掉逐层列目录 */
  sha?: string;
  content?: string;
  encoding?: string;
}

interface GhTree {
  tree?: { path: string; type: string }[];
  truncated?: boolean;
  _truncated?: boolean;
}

async function ghJson(
  pathAndQuery: string,
  ctxLike: unknown,
  maxChars?: number,
): Promise<unknown> {
  const res = await getTransport().callTool(
    'github_api',
    { method: 'GET', path: pathAndQuery, ...(maxChars ? { max_chars: maxChars } : {}) },
    ctxLike as never,
  );
  if (!res.ok) throw new Error(res.error ?? tr('GitHub 请求失败'));
  try {
    return JSON.parse(res.content);
  } catch {
    throw new Error(tr('GitHub 返回的不是 JSON'));
  }
}

/**
 * 取文件原文。
 *
 * 走 raw 模式而不是 contents API 的 base64：一个 32KB 的 SKILL.md 经 base64
 * 会变成 43K 字符，超过工具返回值的限额被截断，然后表现成「仓库里没这个文件」。
 * raw 拿到的就是文本，没有这一层。
 */
async function ghRaw(pathAndQuery: string, ctxLike: unknown): Promise<string> {
  const res = await getTransport().callTool(
    'github_api',
    { method: 'GET', path: pathAndQuery, raw: true },
    ctxLike as never,
  );
  if (!res.ok) throw new Error(res.error ?? 'GitHub 请求失败');
  return res.content;
}

/** 这个错误是「文件不存在」还是「请求根本没成功」—— 两者不能混为一谈 */
function isNotFound(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /HTTP 404/.test(msg);
}

/** 这份 md 看起来像不像一个技能 */
function looksLikeSkill(md: string): boolean {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  return /^\s*(name|description)\s*:/im.test(fm[1]);
}

/** 文件名优先级：SKILL.md 最优先，其次是几个常见叫法 */
function nameRank(fileName: string): number {
  const n = fileName.toLowerCase();
  if (n === 'skill.md') return 0;
  if (n === 'agent.md' || n === 'agents.md' || n === 'prompt.md') return 1;
  if (n === 'readme.md') return 9; // 最后才考虑
  return 5;
}

/**
 * 到仓库里找技能。
 *
 * 找的顺序：给定路径本身 → 该路径下的 md 文件 → 下一层每个目录 →
 * 仓库根的 skills/ 和 .claude/skills/。不做深递归，免得把整个仓库爬一遍。
 *
 * **文件名不限定 SKILL.md**：很多作者用别的名字。判据是「有 YAML frontmatter
 * 且里面有 name 或 description」—— 这是 SKILL.md 格式的实质，文件叫什么是形式。
 * README.md 排在最后，因为它通常是给人看的介绍而不是给模型的指令。
 */
export async function installFromGithub(
  input: string,
  toolCtx: unknown,
  onProgress?: (s: string) => void,
): Promise<Skill[]> {
  const t = parseGithubTarget(input);
  if (!t) throw new Error(tr('看不懂这个地址。写成 owner/repo 或者完整的 GitHub 链接。'));

  const refQ = t.ref ? `?ref=${encodeURIComponent(t.ref)}` : '';
  const base = `/repos/${t.owner}/${t.repo}/contents`;

  onProgress?.(tr('在 {repo} 里找技能…', { repo: `${t.owner}/${t.repo}` }));

  /**
   * 一次最多装多少个。
   * 不带 token 时 GitHub API 每小时只有 60 次，每个技能至少要一次取正文，
   * 所以这个上限同时也是在保护额度。撞顶会明确告诉用户。
   */
  const MAX_SKILLS = 50;

  const found: Skill[] = [];
  const seen = new Set<string>();
  /** 扫描过程的账：装少了的时候，这个能一眼看出卡在哪一步 */
  const trace = { dirs: 0, trees: 0, filesTried: 0 };
  /** 非 404 的失败：限额、网络、权限。这些必须让用户看见，不能当成「没找到」 */
  const hardErrors: string[] = [];

  const tryFile = async (p: string, opts: { requireFrontmatter?: boolean } = {}) => {
    if (seen.has(p) || found.length >= MAX_SKILLS) return;
    seen.add(p);
    trace.filesTried++;
    try {
      const md = await ghRaw(`${base}/${p}${refQ}`, toolCtx);
      if (!md.trim()) return;
      if (opts.requireFrontmatter && !looksLikeSkill(md)) return;

      // 目录名比文件名更能代表技能名：skills/pdf-export/SKILL.md → pdf-export
      const segs = p.split('/');
      const fallback = /^skill\.md$/i.test(segs[segs.length - 1])
        ? (segs[segs.length - 2] ?? t.repo)
        : segs[segs.length - 1].replace(/\.md$/i, '');

      const parsed = parseSkillMd(md, fallback);
      if (!parsed.body.trim()) return;
      found.push(
        makeSkill({
          ...parsed,
          source: `github:${t.owner}/${t.repo}/${p}`,
          installedHash: bodyHash(parsed.body), // parsed.body 已经归一化过
        }),
      );
      onProgress?.(tr('找到 {name}（{kb} KB）', { name: parsed.name, kb: Math.round(md.length / 1024) }));
    } catch (e) {
      if (!isNotFound(e)) {
        hardErrors.push(`${p}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const listDir = async (p: string): Promise<GhEntry[]> => {
    try {
      const r = await ghJson(`${base}${p ? `/${p}` : ''}${refQ}`, toolCtx);
      return Array.isArray(r) ? (r as GhEntry[]) : [];
    } catch (e) {
      if (!isNotFound(e)) hardErrors.push(tr('列目录 {path}：{error}', { path: p || '/', error: e instanceof Error ? e.message : String(e) }));
      return [];
    }
  };

  /** 在一个目录里挑出像技能的 md 文件，按文件名优先级排序 */
  const mdFilesIn = (entries: GhEntry[]): GhEntry[] =>
    entries
      .filter((e) => e.type === 'file' && /\.md$/i.test(e.name))
      .sort((a, b) => nameRank(a.name) - nameRank(b.name));

  /**
   * 一次把某个目录的整棵子树拉下来，从里面挑出所有 SKILL.md。
   *
   * 为什么不逐层列目录：anthropics/skills 那种仓库 skills/ 下面有二十几个
   * 技能目录，逐个列要二十几次 API 调用 —— 不带 token 每小时只有 60 次，
   * 装一个仓库就能把额度打光。子树接口一次就够。
   */
  const skillPathsInTree = async (dirPath: string, sha: string): Promise<string[]> => {
    trace.trees++;
    try {
      /*
       * 递归拉整棵子树，一次调用拿到所有层。
       *
       * 这里前后栽过两跟头，记下来免得再犯：
       *
       *   1. 一开始用 recursive=1 但没动返回值上限，40000 字符把树截断了，
       *      只剩字母序前几个技能 —— JSON 合法所以一路静默。
       *   2. 于是改成非递归只看一层。truncation 是没了，但
       *      skills/<分类>/<名字>/SKILL.md 这种多一层的布局直接一个都找不到。
       *
       * 正解是两样都要：递归 + 把上限开到足够大（max_chars 就是为此加的）。
       * 真被 GitHub 自己截断了（超过 10 万条目）会如实报出来，不再装作没事。
       */
      const r = (await ghJson(
        `/repos/${t.owner}/${t.repo}/git/trees/${sha}?recursive=1`,
        toolCtx,
        1000000,
      )) as GhTree;
      const items = Array.isArray(r?.tree) ? r.tree : [];

      if (r?.truncated || r?._truncated) {
        hardErrors.push(tr('{path} 的目录树太大被截断了，可能漏掉一部分技能 —— 把地址直接指到某个子目录再装一次', { path: dirPath }));
      }

      return items
        .filter((e) => e.type === 'blob' && /(^|\/)SKILL\.md$/i.test(e.path))
        // 深度放到 4：skills/<分类>/<名字>/SKILL.md 是真实存在的布局（mattpocock/skills），
        // 再深就不像技能仓库而像是把整个 monorepo 爬进来了
        .filter((e) => e.path.split('/').length <= 4)
        .map((e) => `${dirPath}/${e.path}`);
    } catch (e) {
      if (!isNotFound(e)) {
        hardErrors.push(tr('读取 {path} 的目录树：{error}', { path: dirPath, error: e instanceof Error ? e.message : String(e) }));
      }
      return [];
    }
  };

  // 1. 路径直接指到一个 .md 文件
  if (/\.md$/i.test(t.path)) {
    await tryFile(t.path);
    if (found.length) return found;
  }

  // 2. 路径下的 SKILL.md
  await tryFile(t.path ? `${t.path}/SKILL.md` : 'SKILL.md');

  const entries = await listDir(t.path);
  const dirs = entries.filter((e) => e.type === 'dir');
  trace.dirs = dirs.length;

  // 3. 路径下其他名字的 md（要求有 frontmatter，避免把普通文档当技能装进来）
  for (const f of mdFilesIn(entries)) {
    if (nameRank(f.name) >= 9) continue; // README 留到最后一轮
    await tryFile(f.path, { requireFrontmatter: true });
  }

  // 4. 下一层每个目录里的 SKILL.md
  for (const d of dirs.slice(0, 60)) {
    await tryFile(`${d.path}/SKILL.md`);
  }

  /*
   * 5. 再往深一层。
   *
   * 这里踩过一个坑：原来这一步写成「前面都没找到才做」，结果 anthropics/skills
   * 因为 template/SKILL.md 命中了一个，skills/ 下面那二十几个就再也不看了。
   * 找到一个不等于找完了 —— 所以现在无条件往下走。
   *
   * 顺序上先看名字像技能集合的目录，再看其余的，整体封顶 10 个子树，
   * 免得在一个大仓库里把 API 额度耗光。
   */
  const collectionish = /^(skills?|examples?|templates?|catalog|library|packages|agents?)$/i;
  const ordered = [
    ...dirs.filter((d) => collectionish.test(d.name)),
    ...dirs.filter((d) => !collectionish.test(d.name)),
  ];

  for (const d of ordered.slice(0, 10)) {
    if (found.length >= MAX_SKILLS) break;
    if (!d.sha) continue;
    const paths = await skillPathsInTree(d.path, d.sha);
    for (const p of paths.slice(0, 120)) await tryFile(p);
  }

  // 6. 仓库根的隐藏目录（.claude/skills 这类不会出现在普通列目录里的组合路径）
  if (!t.path) {
    for (const guess of ['.claude/skills', 'Skills']) {
      if (found.length >= MAX_SKILLS) break;
      const sub = await listDir(guess);
      for (const d of sub.filter((e) => e.type === 'dir').slice(0, 40)) {
        await tryFile(`${d.path}/SKILL.md`);
      }
      for (const f of mdFilesIn(sub)) {
        await tryFile(f.path, { requireFrontmatter: true });
      }
    }
  }

  // 7. 最后一招：带 frontmatter 的 README
  if (!found.length) {
    for (const f of mdFilesIn(entries).filter((x) => nameRank(x.name) >= 9)) {
      await tryFile(f.path, { requireFrontmatter: true });
    }
  }

  onProgress?.(
    tr('扫描完成：{dirs} 个子目录、{trees} 棵目录树、试了 {files} 个文件，找到 {found} 个技能',
      { dirs: trace.dirs, trees: trace.trees, files: trace.filesTried, found: found.length }) +
      (hardErrors.length ? '\n' + tr('⚠ 过程中有 {n} 处出错：{first}', { n: hardErrors.length, first: hardErrors[0] }) : ''),
  );
  if (found.length >= MAX_SKILLS) {
    onProgress?.(tr('已达单次安装上限 {max} 个，仓库里可能还有更多 —— 指到具体子目录再装一次', { max: MAX_SKILLS }));
  }

  if (!found.length) {
    if (hardErrors.length) {
      // 请求失败和「没有这个文件」是两回事，混着报会让人往错的方向查
      throw new Error(
        tr('访问 {repo} 时出错了，不是「没有技能」：', { repo: `${t.owner}/${t.repo}` }) + '\n' + hardErrors.slice(0, 3).join('\n') +
          (/403|rate limit/i.test(hardErrors.join(' '))
            ? '\n\n' + tr('看起来是 GitHub API 限额（不带 token 每小时只有 60 次）。设置 → 工具 → GitHub 填一个 token。')
            : ''),
      );
    }
    const mdNames = mdFilesIn(entries).map((f) => f.name);
    const dirNames = dirs.map((d) => d.name);
    throw new Error(
      tr('在 {where} 里没找到技能文件。', { where: `${t.owner}/${t.repo}${t.path ? `/${t.path}` : ''}` }) + '\n' +
        (mdNames.length
          ? tr('根目录的这些 md 没有 YAML frontmatter（开头的 --- 块里要有 name 或 description），所以不当成技能：{names}。', { names: mdNames.slice(0, 8).join('、') }) + '\n'
          : '') +
        (dirNames.length
          ? tr('扫过的子目录：{names}。如果技能藏得更深，把地址直接指到那一层，例如 owner/repo/tree/main/skills/engineering。', { names: dirNames.slice(0, 8).join('、') }) + '\n'
          : '') +
        tr('也可以把地址指到某个具体的 .md 文件 —— 那种情况不检查 frontmatter，直接装。'),
    );
  }
  return found;
}

/** 技能注入成什么样的 system 消息 */
/**
 * 技能正文进 system 的长度上限。
 *
 * 技能正文拼在 system prompt 里，也就是拼在**前缀**里。一份长 SKILL.md 会一直
 * 占着那段位置，每一轮都跟着算，而其中真正会被用到的往往只有几行。
 *
 * 超限的折叠：只留名字和描述，加一段开头，正文留在本地，模型要用具体规范时
 * 用 read_skill 取回。刻意不是「只放代号」—— 光有代号模型没法判断该不该取，
 * 只会每个都取一遍，那比原样塞进去还贵。判断要用的信息必须留在上面。
 */
export const SKILL_INLINE_LIMIT = 4000;
/** 折叠后保留的开头长度：够看出这技能在讲什么，不够拿来直接执行 */
const SKILL_PREVIEW = 600;

export function foldedSkillNames(skills: Skill[], limit = SKILL_INLINE_LIMIT): string[] {
  return skills.filter((s) => (s.body ?? '').length > limit).map((s) => s.name);
}

export function skillSystemBlock(skills: Skill[], limit = SKILL_INLINE_LIMIT): string {
  if (!skills.length) return '';
  return skills
    .map((s) => {
      const body = s.body ?? '';
      if (body.length <= limit) {
        return `以下是用户唤起的技能「${s.name}」的指令，本轮请严格按它执行：\n<skill name="${s.name}">\n${body}\n</skill>`;
      }
      return `以下是用户唤起的技能「${s.name}」，正文 ${body.length} 字，没有全部载入。` +
        `需要它的具体规范时，先用 read_skill(name="${s.name}") 取回正文再执行；没取回的部分不能当作已知。\n` +
        `<skill name="${s.name}" folded="true">\n${s.description || '（这个技能没有写描述）'}\n\n` +
        `${body.slice(0, SKILL_PREVIEW)}\n…（以上只是开头，其余部分用 read_skill 取回）\n</skill>`;
    })
    .join('\n\n');
}

/** 取回被折叠的技能正文。分页跟 read_context 一个形状，省得再学一套。 */
export function readSkill(skills: Skill[], args: Record<string, unknown>): ToolResult {
  const name = String(args.name ?? '').trim();
  const skill = skills.find((s) => s.name === name);
  if (!skill) {
    return { ok: false, content: '',
      error: `本轮没有唤起名为「${name}」的技能。可用的是：${skills.map((s) => s.name).join('、') || '（本轮没有唤起任何技能）'}` };
  }
  const body = skill.body ?? '';
  const offset = Math.max(0, Number(args.offset) || 0);
  const limit = Math.max(1, Math.min(12000, Number(args.limit) || 12000));
  const text = body.slice(offset, offset + limit);
  const next = offset + limit < body.length ? offset + limit : null;
  return { ok: true,
    content: JSON.stringify({ name: skill.name, total: body.length, offset, nextOffset: next, text }),
    summary: `取回技能 /${skill.name} 的正文` };
}

/* ------------------------------------------------------------------ *
 * 合并新装的技能
 *
 * 三种情况分开处理，而不是一律按名字覆盖：
 *
 *   1. 同名、同来源、用户没改过 → 原地更新（这就是「升级」该有的样子）
 *   2. 同名、用户改过正文       → **不覆盖**，跳过并说明。手改过的东西被一次
 *                                 重装无声抹掉，是最容易让人失去信任的行为
 *   3. 同名、但来自另一个仓库   → 两个都留着，新的加后缀。它们是不同的东西，
 *                                 名字撞车不代表可以互相取代
 * ------------------------------------------------------------------ */

export interface MergeReport {
  added: string[];
  updated: string[];
  /** 因为用户改过而没有覆盖的 */
  skipped: string[];
  /** 同名不同来源，改名保留的 */
  renamed: { from: string; to: string }[];
}

export function mergeSkills(
  existing: Skill[],
  incoming: Skill[],
): { skills: Skill[]; report: MergeReport } {
  const out = [...existing];
  const report: MergeReport = { added: [], updated: [], skipped: [], renamed: [] };

  for (const inc of incoming) {
    const i = out.findIndex((s) => s.name === inc.name);
    if (i < 0) {
      out.push(inc);
      report.added.push(inc.name);
      continue;
    }

    const cur = out[i];

    // 同名但来自别的地方：不是同一个东西
    if (cur.source !== inc.source && cur.source !== '手写') {
      let n = 2;
      while (out.some((s) => s.name === `${inc.name}-${n}`)) n++;
      const renamed = { ...inc, name: `${inc.name}-${n}` };
      out.push(renamed);
      report.renamed.push({ from: inc.name, to: renamed.name });
      continue;
    }

    // 用户手改过：正文跟当初装进来时对不上
    const userEdited = cur.installedHash ? bodyHash(cur.body) !== cur.installedHash : true;
    if (userEdited && cur.body.trim() !== inc.body.trim()) {
      report.skipped.push(cur.name);
      continue;
    }

    // 正常升级：保留 id、启用状态和使用次数，换掉正文
    out[i] = {
      ...inc,
      id: cur.id,
      enabled: cur.enabled,
      uses: cur.uses,
      installedAt: cur.installedAt,
    };
    report.updated.push(cur.name);
  }

  return { skills: out, report };
}

/** 把合并结果讲成人话 */
export function describeMerge(r: MergeReport): string {
  const parts: string[] = [];
  if (r.added.length) parts.push(tr('新增 {n} 个', { n: r.added.length }));
  if (r.updated.length) parts.push(tr('更新 {n} 个', { n: r.updated.length }));
  if (r.renamed.length) {
    parts.push(
      tr('{n} 个同名但来自别的仓库，已改名保留（{names}）', {
        n: r.renamed.length,
        names: r.renamed.slice(0, 3).map((x) => `${x.from}→${x.to}`).join('、'),
      }),
    );
  }
  if (r.skipped.length) {
    parts.push(
      tr('{n} 个你改过正文，没有覆盖（{names}）—— 想要上游版本就先删掉本地那个再装', {
        n: r.skipped.length,
        names: r.skipped.slice(0, 3).join('、'),
      }),
    );
  }
  return parts.join('；') || tr('没有变化');
}
