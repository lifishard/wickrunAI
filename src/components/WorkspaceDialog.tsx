import React from 'react';
import { useT } from '../lib/i18n';
import type { KeyProfile, ModelInfo, ToolContext } from '../types';
import {
  describeMerge,
  installFromGithub,
  makeSkill,
  mergeSkills,
  parseSkillMd,
  toSkillMd,
  type Skill,
} from '../lib/skills';
import { makeProject, type Project, type ProjectDoc } from '../lib/projects';
import {
  describeSchedule,
  makeTask,
  nextRun,
  parseCron,
  type ScheduledTask,
} from '../lib/schedule';
import { uid } from '../lib/store';
import { applyPlan, describeSync, planSync } from '../lib/skillsync';
import { desktop } from '../lib/transport';
import type { SkillSyncConfig } from '../types';
import { Field, Modal, Segmented, Switch } from './ui';

type Tab = 'projects' | 'skills' | 'tasks';

const TAB_LABEL: Record<Tab, string> = {
  projects: '项目',
  skills: '技能',
  tasks: '定时任务',
};

/* ================================================================== *
 * 项目
 * ================================================================== */

function ProjectsTab(props: {
  projects: Project[];
  onChange: (p: Project[]) => void;
  profiles: KeyProfile[];
  models: ModelInfo[];
}) {
  const t = useT();
  const [sel, setSel] = React.useState<string | null>(props.projects[0]?.id ?? null);
  const p = props.projects.find((x) => x.id === sel) ?? null;

  const patch = (v: Partial<Project>) => {
    if (!p) return;
    props.onChange(props.projects.map((x) => (x.id === p.id ? { ...x, ...v } : x)));
  };

  const setDoc = (id: string, v: Partial<ProjectDoc>) =>
    patch({
      docs: (p?.docs ?? []).map((d) => (d.id === id ? { ...d, ...v, updatedAt: Date.now() } : d)),
    });

  return (
    <div>
      <div className="hint" style={{ marginBottom: 12, lineHeight: 1.85 }}>
        {t('项目 = 一组对话 + 一份共享上下文。同一个项目里新开的对话自动继承规范、记忆、文档清单和常用提示词。')}
        <br />
        <strong>{t('文档正文不会每轮都塞进去')}</strong>{t('。只给模型一份目录，它需要时用 project_doc_read 按名字取。一个项目攒几万字很正常，全量注入等于每轮重付一次钱。')}
      </div>

      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {props.projects.map((x) => (
          <button
            key={x.id}
            className={`picker-profile${x.id === sel ? ' on' : ''}`}
            onClick={() => setSel(x.id)}
          >
            {x.emoji} {x.name}
          </button>
        ))}
        <button
          className="btn sm"
          onClick={() => {
            const np = makeProject('新项目');
            props.onChange([...props.projects, np]);
            setSel(np.id);
          }}
        >
          {t('＋ 新建项目')}
        </button>
      </div>

      {!p ? (
        <div className="empty">{t('还没有项目。建一个，把相关的对话归到一起。')}</div>
      ) : (
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              type="text"
              value={p.emoji}
              onChange={(e) => patch({ emoji: e.target.value.slice(0, 4) })}
              style={{ flex: '0 0 56px', textAlign: 'center' }}
            />
            <input
              type="text"
              value={p.name}
              onChange={(e) => patch({ name: e.target.value })}
              style={{ fontWeight: 600 }}
            />
            <button
              className="btn sm danger"
              onClick={() => {
                if (!confirm(t('删除项目「{name}」？里面的对话会保留，只是不再归属任何项目。', { name: p.name }))) return;
                const rest = props.projects.filter((x) => x.id !== p.id);
                props.onChange(rest);
                setSel(rest[0]?.id ?? null);
              }}
            >
              {t('删除')}
            </button>
          </div>

          <Field
            label={t('项目规范')}
            hint={t('拼进这个项目里每一轮的 system prompt。写约定、口径、禁忌 —— 别写具体任务。')}
          >
            <textarea
              rows={5}
              value={p.instructions}
              placeholder={t('例如：所有代码用 TypeScript strict；回答先给结论再给推导；金额一律标明币种。')}
              onChange={(e) => patch({ instructions: e.target.value })}
            />
          </Field>

          <Field label={t('默认模型')} hint={t('在这个项目里新开对话时套上。留空就用全局默认。')}>
            <input
              type="text"
              list="ws-models"
              value={p.defaultModel ?? ''}
              placeholder={t('留空 = 跟随全局')}
              onChange={(e) => patch({ defaultModel: e.target.value })}
            />
            <datalist id="ws-models">
              {props.models.slice(0, 200).map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          </Field>

          <Field label={t('默认凭据')}>
            <select
              value={p.defaultKeyProfileId ?? ''}
              onChange={(e) => patch({ defaultKeyProfileId: e.target.value || null })}
            >
              <option value="">{t('跟随全局')}</option>
              {props.profiles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="section">
            <div className="section-title">{t('项目记忆')}</div>
            <div className="hint" style={{ marginBottom: 6 }}>
              {t('模型用 project_memory_write 往里追加跨对话的结论。这里可以直接改或清空。太长会挤占每轮的上下文，超过两万字会自动截断最早的部分。')}
            </div>
            <textarea
              rows={6}
              className="mono"
              value={p.memory}
              placeholder={t('（空）')}
              onChange={(e) => patch({ memory: e.target.value })}
            />
          </div>

          <div className="section">
            <div className="section-title">{t('文档')}</div>
            {(p.docs ?? []).map((d) => (
              <div className="card" key={d.id}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => setDoc(d.id, { name: e.target.value })}
                    style={{ fontWeight: 600 }}
                  />
                  <span className="chip">{t('{n} 字', { n: d.text.length })}</span>
                  <button
                    className="btn sm danger"
                    onClick={() => patch({ docs: p.docs.filter((x) => x.id !== d.id) })}
                  >
                    {t('删除')}
                  </button>
                </div>
                <textarea
                  rows={5}
                  className="mono"
                  value={d.text}
                  onChange={(e) => setDoc(d.id, { text: e.target.value })}
                />
              </div>
            ))}
            <button
              className="btn block"
              onClick={() =>
                patch({
                  docs: [
                    ...(p.docs ?? []),
                    { id: uid('d'), name: t('文档 {n}', { n: (p.docs?.length ?? 0) + 1 }), text: '', updatedAt: Date.now() },
                  ],
                })
              }
            >
              {t('＋ 加一篇文档')}
            </button>
          </div>

          <div className="section">
            <div className="section-title">{t('常用提示词')}</div>
            <div className="hint" style={{ marginBottom: 6 }}>
              {t('在这个项目里、输入框还空着的时候，会以小胶囊的形式出现在输入框上方，点一下填进去。')}
            </div>
            {(p.prompts ?? []).map((pp) => (
              <div className="row" key={pp.id} style={{ marginBottom: 6 }}>
                <input
                  type="text"
                  value={pp.label}
                  placeholder={t('按钮上显示的短名')}
                  onChange={(e) =>
                    patch({
                      prompts: p.prompts.map((x) =>
                        x.id === pp.id ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                  style={{ flex: '0 0 140px' }}
                />
                <input
                  type="text"
                  value={pp.text}
                  placeholder={t('点了之后填进输入框的内容')}
                  onChange={(e) =>
                    patch({
                      prompts: p.prompts.map((x) =>
                        x.id === pp.id ? { ...x, text: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  className="btn sm danger"
                  onClick={() => patch({ prompts: p.prompts.filter((x) => x.id !== pp.id) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn block"
              onClick={() =>
                patch({ prompts: [...(p.prompts ?? []), { id: uid('pp'), label: t('新提示词'), text: '' }] })
              }
            >
              {t('＋ 加一条')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * 技能
 * ================================================================== */


/* ------------------------------------------------------------------ *
 * 与本地文件夹双向同步
 *
 * 目标是跟 Claude Code / Desktop 共用同一批技能 —— 它们读的就是
 * ~/.claude/skills/<名字>/SKILL.md。
 * ------------------------------------------------------------------ */

function FolderSync(props: {
  skills: Skill[];
  onChange: (s: Skill[]) => void;
  cfg: SkillSyncConfig;
  onCfg: (c: SkillSyncConfig) => void;
}) {
  const t = useT();
  const bridge = desktop();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  if (!bridge) {
    return (
      <div className="hint" style={{ marginTop: 8 }}>
        {t('文件夹同步只在桌面端可用（手机端没有本地文件系统）。')}
      </div>
    );
  }

  const useDefault = async () => {
    const d = await bridge.skillsDefaultDir();
    props.onCfg({ ...props.cfg, dir: d });
    setMsg(t('已填入 {path}', { path: d }));
  };

  const run = async () => {
    const dir = props.cfg.dir.trim();
    if (!dir) {
      setMsg(t('先填一个目录'));
      return;
    }
    setBusy(true);
    setMsg(t('扫描目录…'));
    try {
      const r = await bridge.skillsRead(dir);
      if (!r.ok) {
        setMsg(t('✗ 读取失败：{reason}', { reason: r.error ?? t('未知原因') }));
        return;
      }

      const plan = planSync(props.skills, r.items);

      if (plan.push.length) {
        setMsg(t('写出 {n} 个…', { n: plan.push.length }));
        const w = await bridge.skillsWrite(dir, plan.push);
        if (!w.ok) {
          setMsg(t('✗ 写入失败：{reason}', { reason: w.error ?? t('未知原因') }));
          return;
        }
        if (w.failed.length) {
          setMsg(
            t('部分写入失败：{list}', {
              list: w.failed.slice(0, 3).map((f) => `${f.name}（${f.error}）`).join('、'),
            }),
          );
        }
      }

      props.onChange(applyPlan(props.skills, plan));
      setMsg(describeSync(plan, r.dir ?? dir));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field" style={{ marginTop: 14 }}>
      <div className="field-label">{t('与本地文件夹双向同步')}</div>
      <div className="row" style={{ gap: 6 }}>
        <input
          type="text"
          style={{ flex: 1 }}
          placeholder={t('例如 C:\\Users\\你\\.claude\\skills')}
          value={props.cfg.dir}
          onChange={(e) => props.onCfg({ ...props.cfg, dir: e.target.value })}
        />
        <button className="btn sm" onClick={() => void useDefault()}>
          {t('用默认')}
        </button>
        <button className="btn sm primary" onClick={() => void run()} disabled={busy}>
          {busy ? t('同步中…') : t('同步')}
        </button>
        {props.cfg.dir ? (
          <button className="btn sm" onClick={() => void bridge.revealPath(props.cfg.dir)}>
            {t('打开')}
          </button>
        ) : null}
      </div>

      <div className="row" style={{ marginTop: 6, alignItems: 'center', gap: 8 }}>
        <Switch
          checked={props.cfg.auto}
          onChange={(v) => props.onCfg({ ...props.cfg, auto: v })}
          label={t('启动时自动同步一次')}
        />
      </div>

      {msg ? (
        <div
          className="hint"
          style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: msg.startsWith('✗') ? 'var(--danger)' : undefined }}
        >
          {msg}
        </div>
      ) : null}

      <div className="hint" style={{ marginTop: 6, lineHeight: 1.85 }}>
        {t('Claude Code 和 Claude Desktop 读的就是 ~/.claude/skills/<名字>/SKILL.md，指到那里就能跟它们共用同一批技能。')}
        <br />
        <b>{t('只新增和更新，永不删除任何一边。')}</b>{t('两边都改过的会各留一份，进来的那份叫「<名字>-来自文件夹」。这里不猜谁更该保留：按时间戳挑新的那种做法，迟早会悄悄吃掉你半小时的修改。')}
      </div>
    </div>
  );
}

function SkillsTab(props: {
  skills: Skill[];
  onChange: (s: Skill[]) => void;
  toolCtx: ToolContext;
  sync: SkillSyncConfig;
  onSync: (c: SkillSyncConfig) => void;
}) {
  const t = useT();
  const [ghInput, setGhInput] = React.useState('');
  const [installing, setInstalling] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);

  const patch = (id: string, v: Partial<Skill>) =>
    props.onChange(props.skills.map((s) => (s.id === id ? { ...s, ...v } : s)));

  async function install() {
    const input = ghInput.trim();
    if (!input) return;
    setInstalling(true);
    setMsg(t('连接 GitHub…'));
    try {
      let lastTrace = '';
      const found = await installFromGithub(input, props.toolCtx, (s) => {
        if (s.startsWith('扫描完成')) lastTrace = s;
        setMsg(s);
      });
      const { skills: merged, report } = mergeSkills(props.skills, found);
      props.onChange(merged);
      // 把扫描过程一起显示：装少了的时候，光看「装好了 N 个」根本不知道
      // 是仓库里就这么多，还是找的过程中断在哪儿
      setMsg(
        `${describeMerge(report)}\n` +
          t('找到 {n} 个：{names}', { n: found.length, names: found.map((f) => `/${f.name}`).join(' ') }) +
          (lastTrace ? `\n${lastTrace}` : ''),
      );
      setGhInput('');
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 12, lineHeight: 1.85 }}>
        {t('技能 = 一段写好的指令，在输入框打 /名字 唤起，唤起时作为额外的 system 消息注入这一轮。')}
        <br />
        <strong>{t('技能是提示词，不是可执行代码')}</strong>{t('。装一个技能不会在你机器上跑任何东西，所以不需要沙箱。格式跟 Anthropic 的 SKILL.md 一致，GitHub 上现成的技能仓库能直接装。')}
        <br />
        {t('也可以直接跟模型说「把刚才那套流程存成技能」，它会用 skill_write 自己写一个。')}
      </div>

      <div className="card">
        <div className="field-label">{t('从 GitHub 安装')}</div>
        <div className="row">
          <input
            type="text"
            value={ghInput}
            placeholder={t('owner/repo 或 https://github.com/owner/repo/tree/main/skills')}
            onChange={(e) => setGhInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !installing && void install()}
          />
          <button className="btn primary" disabled={installing || !ghInput.trim()} onClick={() => void install()}>
            {installing ? t('装…') : t('安装')}
          </button>
        </div>
        {msg ? (
          <div
            className="hint"
            style={{
              marginTop: 6,
              whiteSpace: 'pre-wrap',
              color: msg.startsWith('✗') ? 'var(--danger)' : undefined,
            }}
          >
            {msg}
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 6 }}>
            {t('会找这几个位置：给定路径本身、路径下的 md 文件、下一层每个目录、仓库根的 skills/ 和 .claude/skills/。文件名不限于 SKILL.md：只要开头的 --- 块里有 name 或 description 就认，README.md 排在最后。也可以把地址直接指到某个具体的 .md 文件。私有仓库需要在 设置 → 工具 → GitHub 里填 token。')}
          </div>
        )}
      </div>

      <FolderSync
        skills={props.skills}
        onChange={props.onChange}
        cfg={props.sync}
        onCfg={props.onSync}
      />

      <div className="row" style={{ margin: '12px 0' }}>
        <button
          className="btn"
          onClick={() =>
            props.onChange([
              ...props.skills,
              makeSkill({ name: `skill-${props.skills.length + 1}`, body: '', description: '' }),
            ])
          }
        >
          {t('＋ 手写一个')}
        </button>
        <span className="hint" style={{ flex: 1 }}>
          {t('共 {n} 个', { n: props.skills.length })}
        </span>
      </div>

      {props.skills.length === 0 ? (
        <div className="empty">{t('还没有技能。从 GitHub 装一个，或者手写一个。')}</div>
      ) : null}

      {props.skills.map((sk) => (
        <div className="card" key={sk.id}>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="skill-slash">/</span>
            <input
              type="text"
              value={sk.name}
              onChange={(e) => patch(sk.id, { name: e.target.value })}
              style={{ fontFamily: 'var(--mono)', fontWeight: 600, flex: '0 0 170px' }}
            />
            <input
              type="text"
              value={sk.description}
              placeholder={t('一句话说明什么时候用')}
              onChange={(e) => patch(sk.id, { description: e.target.value })}
            />
            <Switch checked={sk.enabled} onChange={(v) => patch(sk.id, { enabled: v })} label="" />
            <button className="btn sm" onClick={() => setEditing(editing === sk.id ? null : sk.id)}>
              {editing === sk.id ? t('收起') : t('正文')}
            </button>
            <button
              className="btn sm danger"
              onClick={() => props.onChange(props.skills.filter((x) => x.id !== sk.id))}
            >
              {t('删除')}
            </button>
          </div>

          {editing === sk.id ? (
            <>
              <textarea
                rows={12}
                className="mono"
                value={sk.body}
                placeholder={t('技能的指令正文，Markdown。写成自包含的操作说明，别依赖某次对话的上下文。')}
                onChange={(e) => patch(sk.id, { body: e.target.value })}
              />
              <div className="row" style={{ marginTop: 6 }}>
                <span className="hint" style={{ flex: 1 }}>
                  {t('来源：{source} · 用过 {uses} 次 · 正文 {kb} KB', { source: sk.source, uses: sk.uses, kb: Math.round(sk.body.length / 1024) })}
                  {sk.body.length > 16000
                    ? t(' ⚠ 这个技能很大，每次唤起都会整段进上下文，注意 token 消耗')
                    : ''}
                </span>
                <button
                  className="btn sm"
                  onClick={() => void navigator.clipboard.writeText(toSkillMd(sk))}
                >
                  {t('复制成 SKILL.md')}
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    const md = await navigator.clipboard.readText();
                    if (!md.trim()) return;
                    const parsed = parseSkillMd(md, sk.name);
                    patch(sk.id, parsed);
                  }}
                >
                  {t('从剪贴板粘 SKILL.md')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ================================================================== *
 * 定时任务
 * ================================================================== */

function TasksTab(props: {
  tasks: ScheduledTask[];
  onChange: (t: ScheduledTask[]) => void;
  projects: Project[];
  profiles: KeyProfile[];
  models: ModelInfo[];
}) {
  const t = useT();
  const patch = (id: string, v: Partial<ScheduledTask>) =>
    props.onChange(
      props.tasks.map((task) => {
        if (task.id !== id) return task;
        const next = { ...task, ...v };
        // 改了排程或重新启用，下一次触发时间要跟着重算
        if (v.schedule || v.enabled !== undefined) {
          next.nextRunAt = next.enabled ? (nextRun(next.schedule) ?? undefined) : undefined;
        }
        return next;
      }),
    );

  const DAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((d) => t(d));

  return (
    <div>
      <div className="hint" style={{ marginBottom: 12, lineHeight: 1.85 }}>
        {t('到点自动发一条消息给模型，工具照常能用。')}
        <br />
        <strong>{t('说清楚边界：调度器跑在应用里，应用关着就不会触发。')}</strong>要做到关掉窗口也能跑，
        得把整个 Agent 循环搬进主进程再实现一遍，而且工具确认弹窗没人点照样卡住 —— 不值。
        补偿是「错过补跑」：下次打开应用时会把漏掉的补上一次。
        <br />
        自动跑的任务建议把放行档位设成「自动批准编辑」或更松，否则它会停在确认弹窗前等你。
      </div>

      <button
        className="btn"
        style={{ marginBottom: 12 }}
        onClick={() => props.onChange([...props.tasks, makeTask(t('任务 {n}', { n: props.tasks.length + 1 }))])}
      >
        {t('＋ 新建任务')}
      </button>

      {props.tasks.length === 0 ? <div className="empty">{t('还没有定时任务。')}</div> : null}

      {props.tasks.map((task) => {
        const cronBad = task.schedule.kind === 'cron' && !parseCron(task.schedule.cron ?? '');
        return (
          <div className="card" key={task.id}>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                type="text"
                value={task.name}
                onChange={(e) => patch(task.id, { name: e.target.value })}
                style={{ fontWeight: 600 }}
              />
              <Switch checked={task.enabled} onChange={(v) => patch(task.id, { enabled: v })} label={t('启用')} />
              <button
                className="btn sm danger"
                onClick={() => props.onChange(props.tasks.filter((x) => x.id !== task.id))}
              >
                {t('删除')}
              </button>
            </div>

            <Field label={t('要它做什么')} hint={t('每次触发就把这段话当成一条新消息发出去。写清楚，它看不到之前的对话。')}>
              <textarea
                rows={3}
                value={task.prompt}
                placeholder={t('例如：搜一下昨天美股收盘后有哪些和半导体相关的重要新闻，按重要性给我三条，带来源。')}
                onChange={(e) => patch(task.id, { prompt: e.target.value })}
              />
            </Field>

            <Field label={t('什么时候跑')}>
              <Segmented
                value={task.schedule.kind}
                options={[
                  { value: 'interval' as const, label: t('每隔') },
                  { value: 'daily' as const, label: t('每天') },
                  { value: 'weekly' as const, label: t('每周') },
                  { value: 'cron' as const, label: 'cron' },
                ]}
                onChange={(k) => patch(task.id, { schedule: { ...task.schedule, kind: k } })}
              />
            </Field>

            {task.schedule.kind === 'interval' ? (
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="hint">{t('每')}</span>
                <input
                  type="number"
                  min={1}
                  value={task.schedule.everyMinutes ?? 60}
                  onChange={(e) =>
                    patch(task.id, {
                      schedule: { ...task.schedule, everyMinutes: Math.max(1, Number(e.target.value) || 60) },
                    })
                  }
                  style={{ width: 100 }}
                />
                <span className="hint">{t('分钟')}</span>
              </div>
            ) : null}

            {task.schedule.kind === 'daily' || task.schedule.kind === 'weekly' ? (
              <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={task.schedule.hour ?? 9}
                  onChange={(e) => patch(task.id, { schedule: { ...task.schedule, hour: Number(e.target.value) } })}
                  style={{ width: 70 }}
                />
                <span className="hint">{t('时')}</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={task.schedule.minute ?? 0}
                  onChange={(e) => patch(task.id, { schedule: { ...task.schedule, minute: Number(e.target.value) } })}
                  style={{ width: 70 }}
                />
                <span className="hint">{t('分')}</span>
                {task.schedule.kind === 'weekly'
                  ? DAY.map((d, i) => {
                      const on = (task.schedule.weekdays ?? [1]).includes(i);
                      return (
                        <button
                          key={i}
                          className={`picker-profile${on ? ' on' : ''}`}
                          onClick={() => {
                            const cur = new Set(task.schedule.weekdays ?? [1]);
                            if (on) cur.delete(i);
                            else cur.add(i);
                            patch(task.id, { schedule: { ...task.schedule, weekdays: [...cur].sort() } });
                          }}
                        >
                          {d}
                        </button>
                      );
                    })
                  : null}
              </div>
            ) : null}

            {task.schedule.kind === 'cron' ? (
              <Field
                label={t('cron 表达式')}
                hint={
                  cronBad ? (
                    <span style={{ color: 'var(--danger)' }}>{t('解析不了。标准 5 段：分 时 日 月 周')}</span>
                  ) : (
                    t('标准 5 段：分 时 日 月 周。支持 * , - / 。例如 0 9 * * 1-5 = 工作日早上九点。')
                  )
                }
              >
                <input
                  type="text"
                  value={task.schedule.cron ?? ''}
                  placeholder="0 9 * * 1-5"
                  onChange={(e) => patch(task.id, { schedule: { ...task.schedule, cron: e.target.value } })}
                  style={{ fontFamily: 'var(--mono)' }}
                />
              </Field>
            ) : null}

            <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              <select
                value={task.projectId ?? ''}
                onChange={(e) => patch(task.id, { projectId: e.target.value || null })}
                style={{ flex: '0 0 150px' }}
              >
                <option value="">{t('不属于项目')}</option>
                {props.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji} {p.name}
                  </option>
                ))}
              </select>
              <select
                value={task.keyProfileId ?? ''}
                onChange={(e) => patch(task.id, { keyProfileId: e.target.value || null })}
                style={{ flex: '0 0 140px' }}
              >
                <option value="">{t('跟随全局凭据')}</option>
                {props.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                list="ws-models"
                value={task.model}
                placeholder={t('模型（留空跟随全局）')}
                onChange={(e) => patch(task.id, { model: e.target.value })}
              />
            </div>

            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Segmented
                value={task.target}
                options={[
                  { value: 'new' as const, label: t('每次开新对话') },
                  { value: 'same' as const, label: t('都追加到同一个') },
                ]}
                onChange={(v) => patch(task.id, { target: v })}
              />
              <Switch
                checked={task.catchUp}
                onChange={(v) => patch(task.id, { catchUp: v })}
                label={t('错过了补跑')}
              />
            </div>

            <div className="hint" style={{ marginTop: 8 }}>
              {describeSchedule(task.schedule)}
              {task.enabled && task.nextRunAt
                ? ` · ${t('下次 {time}', { time: new Date(task.nextRunAt).toLocaleString(undefined, { hour12: false }) })}`
                : ` · ${t('未启用')}`}
              {task.lastRunAt
                ? ` · ${t('上次 {time}', { time: new Date(task.lastRunAt).toLocaleString(undefined, { hour12: false }) })}${
                    task.lastResult ? `（${t(task.lastResult)}）` : ''
                  }`
                : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================== */

export default function WorkspaceDialog(props: {
  tab: string;
  onTab: (t: string) => void;
  onClose: () => void;

  projects: Project[];
  onProjects: (p: Project[]) => void;
  skills: Skill[];
  onSkills: (s: Skill[]) => void;
  tasks: ScheduledTask[];
  onTasks: (t: ScheduledTask[]) => void;

  profiles: KeyProfile[];
  models: ModelInfo[];
  toolCtx: ToolContext;
  skillSync: SkillSyncConfig;
  onSkillSync: (c: SkillSyncConfig) => void;
}) {
  const t = useT();
  const tab = (['projects', 'skills', 'tasks'] as Tab[]).includes(props.tab as Tab)
    ? (props.tab as Tab)
    : 'projects';

  return (
    <Modal title={t('工作区')} onClose={props.onClose} wide>
      <div className="tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((name) => (
          <button key={name} className={name === tab ? 'on' : ''} onClick={() => props.onTab(name)}>
            {t(TAB_LABEL[name])}
          </button>
        ))}
      </div>
      <div className="modal-body">
        {tab === 'projects' ? (
          <ProjectsTab
            projects={props.projects}
            onChange={props.onProjects}
            profiles={props.profiles}
            models={props.models}
          />
        ) : null}
        {tab === 'skills' ? (
          <SkillsTab
            skills={props.skills}
            onChange={props.onSkills}
            toolCtx={props.toolCtx}
            sync={props.skillSync}
            onSync={props.onSkillSync}
          />
        ) : null}
        {tab === 'tasks' ? (
          <TasksTab
            tasks={props.tasks}
            onChange={props.onTasks}
            projects={props.projects}
            profiles={props.profiles}
            models={props.models}
          />
        ) : null}
      </div>
    </Modal>
  );
}
