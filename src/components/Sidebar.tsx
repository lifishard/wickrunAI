import React from 'react';
import type { Conversation } from '../types';
import type { Project } from '../lib/projects';
import { useT } from '../lib/i18n';
import { conversationTitle } from '../lib/store';

export default function Sidebar(props: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onFork: (id: string) => void;
  onExport: (id: string) => void;
  onOpenSettings: () => void;
  onOpenObservations: () => void;

  projects: Project[];
  onNewInProject: (projectId: string | null) => void;
  onOpenWorkspace: (tab: string) => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Conversation | null>(null);
  const [draft, setDraft] = React.useState('');
  const [q, setQ] = React.useState('');
  const [folded, setFolded] = React.useState<Set<string>>(new Set());

  const toggleFold = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { pinned, byProject, loose } = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (c: Conversation) =>
      !needle ||
      c.title.toLowerCase().includes(needle) ||
      c.messages.some((m) => m.content.toLowerCase().includes(needle));

    const list = props.conversations.filter(match).sort((a, b) => b.updatedAt - a.updatedAt);
    // 钉选只是多一个置顶入口，不代表把会话从它所属的项目里摘出去
    const rest = list;

    const grouped = new Map<string, Conversation[]>();
    for (const p of props.projects) grouped.set(p.id, []);
    const noProject: Conversation[] = [];
    for (const c of rest) {
      const g = c.projectId ? grouped.get(c.projectId) : undefined;
      if (g) g.push(c);
      else noProject.push(c);
    }

    return {
      pinned: list.filter((c) => c.pinned),
      byProject: grouped,
      loose: noProject,
    };
  }, [props.conversations, props.projects, q]);

  function renderItem(c: Conversation, where = 'g') {
    return (
      <div
        key={`${where}-${c.id}`}
        className={`conv-item${c.id === props.activeId ? ' active' : ''}`}
        onClick={() => props.onSelect(c.id)}
        onDoubleClick={() => {
          // 没取名的会话开重命名时留空，占位符显示当前语言的默认名。
          // 预填成「新对话」的话，用户直接回车就把当前语言固化进数据了。
          setRenaming(c.id);
          setDraft(c.title);
        }}
      >
        {renaming === c.id ? (
          <input
            type="text"
            value={draft}
            placeholder={conversationTitle(c.title, t)}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              props.onRename(c.id, draft.trim() || c.title);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                props.onRename(c.id, draft.trim() || c.title);
                setRenaming(null);
              }
              if (e.key === 'Escape') setRenaming(null);
            }}
            style={{ padding: '2px 6px', fontSize: 13 }}
          />
        ) : (
          <>
            {c.pinned ? <span className="pin-dot" title={t('已钉选')}>📌</span> : null}
            <span className="conv-title" title={conversationTitle(c.title, t)}>
              {c.forkedFrom ? <span className="fork-mark" title={t('从别的对话分叉来的')}>⑂</span> : null}
              {conversationTitle(c.title, t)}
            </span>
            <button
              className="icon-btn"
              title={c.pinned ? t('取消钉选') : t('钉到顶部')}
              onClick={(e) => {
                e.stopPropagation();
                props.onTogglePin(c.id);
              }}
            >
              {c.pinned ? '📌' : '📍'}
            </button>
            <button
              className="icon-btn"
              title={t('复制一份，带上全部上下文，接着聊')}
              onClick={(e) => {
                e.stopPropagation();
                props.onFork(c.id);
              }}
            >
              ⑂
            </button>
            <button
              className="icon-btn"
              title={t('存成文件')}
              onClick={(e) => {
                e.stopPropagation();
                props.onExport(c.id);
              }}
            >
              ⤓
            </button>
            <button
              className="icon-btn"
              title={t('删除')}
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete(c);
              }}
            >
              ✕
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {pendingDelete ? (
        <div className="overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal" style={{ maxWidth: 420 }} role="dialog" aria-label={t('删除这个对话？')} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">{t('删除这个对话？')}</div>
            <div className="modal-body">
              <p style={{ margin: 0, lineHeight: 1.7 }}>
                {t('「{title}」的全部消息和执行记录会被一起删掉，删了就找不回来了。', { title: conversationTitle(pendingDelete.title, t) })}
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPendingDelete(null)}>{t('取消')}</button>
              <button
                className="btn danger"
                autoFocus
                onClick={() => {
                  props.onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                {t('删除')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="sidebar-head">
        <button className="btn primary block" onClick={props.onNew}>
          {t('＋ 新对话')}
        </button>
        {props.conversations.length > 4 ? (
          <input
            type="text"
            placeholder={t('搜索对话…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ fontSize: 12, padding: '5px 8px' }}
          />
        ) : null}
      </div>

      <div className="conv-list">
        {pinned.length === 0 && loose.length === 0 && props.projects.length === 0 ? (
          <div className="empty" style={{ padding: '24px 10px' }}>
            {q.trim() ? t('没有匹配的对话') : t('还没有对话')}
          </div>
        ) : null}

        {pinned.length ? (
          <>
            <div className="conv-group">📌 {t('已钉选')}</div>
            {pinned.map((c) => renderItem(c, 'pin'))}
          </>
        ) : null}

        {props.projects.map((p) => {
          const list = byProject.get(p.id) ?? [];
          const collapsed = folded.has(p.id);
          return (
            <div key={p.id}>
              <div className="conv-group project-group">
                <button className="project-toggle" onClick={() => toggleFold(p.id)}>
                  {collapsed ? '▸' : '▾'} {p.emoji} {p.name}
                  <span className="project-count">{list.length}</span>
                </button>
                <button
                  className="icon-btn"
                  title={t('在「{name}」里新开一个对话', { name: p.name })}
                  onClick={() => props.onNewInProject(p.id)}
                >
                  ＋
                </button>
              </div>
              {!collapsed ? list.map((c) => renderItem(c, p.id)) : null}
              {!collapsed && list.length === 0 ? (
                <div className="project-empty">{t('这个项目下还没有对话')}</div>
              ) : null}
            </div>
          );
        })}

        {loose.length ? (
          <>
            {props.projects.length ? <div className="conv-group">{t('未分组')}</div> : null}
            {loose.map((c) => renderItem(c, 'loose'))}
          </>
        ) : null}
      </div>

      <div className="sidebar-foot">
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => props.onOpenWorkspace('projects')}>
            {t('📁 项目')}
          </button>
          <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => props.onOpenWorkspace('skills')}>
            {t('⚡ 技能')}
          </button>
          <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => props.onOpenWorkspace('tasks')}>
            {t('⏰ 定时')}
          </button>
        </div>
        <button className="btn block ghost" onClick={props.onOpenSettings}>
          {t('⚙ 设置')}
        </button>
        <button className="btn block ghost" onClick={props.onOpenObservations}>{t('任务记录与分析')}</button>
      </div>
    </>
  );
}
