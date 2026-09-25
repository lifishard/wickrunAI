import React from 'react';
import { useT } from '../lib/i18n';
import AnchoredPopover from './AnchoredPopover';
import type { KeyProfile, ModelHealth, ModelHealthMap, ModelHealthStatus, ModelInfo } from '../types';
import { healthOf, partitionModels } from '../lib/health';
import { nonChatReason } from '../lib/modelKind';
import ApiConnectionStatus from './ApiConnectionStatus';

/**
 * 模型 + 凭据选择器，挂在输入框左下角，作用域是**当前会话**。
 *
 * 为什么不用 <select>：接了聚合网关之后模型能有几百上千个，原生下拉滚不动也搜不了。
 *
 * 长列表用「滚到底自动加载下一批」而不是一刀切到前 N 个 —— 切断的那种做法
 * 会让人根本不知道后面还有什么，连搜索关键词都想不出来。
 *
 * 健康度：撞过确定性错误（服务端 5xx、模型不存在）的路由会被折叠到下面，
 * 按原因分组。这个判断只来自真实发生过的失败或一次批量体检，不猜。
 */

const PAGE = 150;

/** 坏模型的分组：按「为什么坏」而不是按名字 */
const BAD_GROUPS: { key: ModelHealthStatus | 'muted'; label: string; hint: string }[] = [
  { key: 'broken', label: '服务端报错', hint: '5xx：那条路由在上游自己就起不来，客户端改什么都没用' },
  { key: 'missing', label: '模型不存在', hint: '404：ID 下线了或写法不对' },
  { key: 'unknown', label: '其他失败', hint: '返回了非 2xx，但归不进上面两类' },
  { key: 'muted', label: '手动隐藏', hint: '你自己压下去的，体检不会推翻' },
];

function groupOf(h: ModelHealth): ModelHealthStatus | 'muted' {
  if (h.muted) return 'muted';
  if (h.status === 'broken' || h.status === 'missing') return h.status;
  return 'unknown';
}

export default function ModelPicker(props: {
  clientSlot?: React.ReactNode;
  displayModel?: string;
  profiles: KeyProfile[];
  profileId: string | null;
  onProfile: (id: string) => void;

  models: ModelInfo[];
  model: string;
  onModel: (id: string) => void;

  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAddModel: (id: string) => void;

  health: ModelHealthMap;
  probe: { done: number; total: number; current: string } | null;
  onProbe: () => void;
  onStopProbe: () => void;
  onMute: (id: string, muted: boolean) => void;
  /** 只对手动补的 ID 开放：扫描来的删了下次还会回来，删除对它没有意义 */
  onRemove?: (id: string) => void;
  onClearHealth: () => void;
  /** 设置里存的路由组：点一组 = 切到组里第一条路由，并把整组设为本对话的接力名单 */
  routeGroups?: { id: string; name: string; count: number }[];
  activeRouteGroupId?: string;
  onRouteGroup?: (id: string) => void;
  onManageRouteGroups?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  // 删除手动 ID 要点两下：误删虽然补得回来，但不该一下就没
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null);
  const [source,setSource]=React.useState<'api'|'local'>(props.displayModel?'local':'api');
  React.useEffect(()=>setSource(props.displayModel?'local':'api'),[props.displayModel]);
  const [q, setQ] = React.useState('');
  const [showBad, setShowBad] = React.useState(false);
  // 默认只看聊天模型：聚合网关会把 SD checkpoint、embedding、语音模型
  // 全列进 /models，它们打不通 /chat/completions，混在列表里纯属噪音
  const [chatOnly, setChatOnly] = React.useState(true);
  const [limit, setLimit] = React.useState(PAGE);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else {
      setQ('');
      setShowBad(false);
    }
    setLimit(PAGE);
  }, [open]);

  // 换搜索词就回到第一页，否则翻到第 5 页再搜会看到莫名其妙的一大串
  React.useEffect(() => setLimit(PAGE), [q]);

  const { good: healthyModels, bad } = React.useMemo(
    () => partitionModels(props.models, props.health, props.profileId),
    [props.models, props.health, props.profileId],
  );

  /** 非聊天模型（图像 / 向量 / 语音）—— 只影响默认显示，开关一关就全回来 */
  const nonChat = React.useMemo(
    () => healthyModels.filter((m) => nonChatReason(m) !== null),
    [healthyModels],
  );
  const good = React.useMemo(
    () => (chatOnly ? healthyModels.filter((m) => nonChatReason(m) === null) : healthyModels),
    [healthyModels, chatOnly],
  );

  const match = React.useCallback(
    (list: ModelInfo[]) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return list;
      return list.filter((m) => {
        const hay = `${m.id} ${m.label ?? ''} ${m.ownedBy ?? ''}`.toLowerCase();
        // 空格分词，全部命中才算 —— 「kimi think」这种能筛出来
        return needle.split(/\s+/).every((w) => hay.includes(w));
      });
    },
    [q],
  );

  const filtered = React.useMemo(() => match(good), [match, good]);
  const filteredBad = React.useMemo(() => match(bad), [match, bad]);
  const shown = filtered.slice(0, limit);

  /** 坏模型按原因分组 */
  const badGroups = React.useMemo(() => {
    const by = new Map<string, ModelInfo[]>();
    for (const m of filteredBad) {
      const h = healthOf(props.health, props.profileId, m.id);
      if (!h) continue;
      const g = groupOf(h);
      const arr = by.get(g) ?? [];
      arr.push(m);
      by.set(g, arr);
    }
    return BAD_GROUPS.map((g) => ({ ...g, items: by.get(g.key) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [filteredBad, props.health, props.profileId]);

  const activeProfile = props.profiles.find((p) => p.id === props.profileId) ?? null;
  const exact = props.models.some((m) => m.id === q.trim());
  const probing = props.probe !== null;

  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      setLimit((n) => (n >= filtered.length ? n : n + PAGE));
    }
  };

  const renderItem = (m: ModelInfo, broken: boolean) => {
    const h = healthOf(props.health, props.profileId, m.id);
    // 「返回 200 但正文是空的」不给勾 —— 那多半根本不是聊天模型
    const verified = !broken && h?.status === 'ok';
    const hollow = !broken && h?.status === 'hollow';
    return (
      <div key={m.id} className={`picker-row${m.id === props.model ? ' on' : ''}`}>
        <button
          className="picker-item"
          onClick={() => {
            props.onModel(m.id);
            setOpen(false);
          }}
          title={
            h
              ? `${m.id}\n${h.reason ?? ''}${h.code ? `\nHTTP ${h.code}` : ''}\n${t('最后一次判定：')}${new Date(h.at).toLocaleString()}`
              : m.id
          }
        >
          <span className="picker-item-id">{m.label ?? m.id}</span>
          {m.custom ? <span className="badge-off">{t('手动')}</span> : null}
          {!broken && nonChatReason(m) ? (
            <span className="badge-off" title={t('打不通 /chat/completions')}>
              {nonChatReason(m)}
            </span>
          ) : null}
          {verified ? (
            <span className="badge-ok" title={t('体检通过')}>
              ✓
            </span>
          ) : null}
          {hollow ? (
            <span className="badge-off" title={h!.reason}>
              {t('空响应')}
            </span>
          ) : null}
          {broken && h?.code ? <span className="badge-bad">{h.code}</span> : null}
          {m.ownedBy ? <span className="picker-item-owner">{m.ownedBy}</span> : null}
        </button>
        {m.custom && props.onRemove ? (
          <button
            className={`icon-btn sm${confirmRemove === m.id ? ' danger' : ''}`}
            title={confirmRemove === m.id ? t('再点一次就彻底删除这个手动 ID') : t('彻底删除这个手动补的 ID')}
            onClick={(e) => {
              e.stopPropagation();
              if (confirmRemove === m.id) { props.onRemove!(m.id); setConfirmRemove(null); }
              else setConfirmRemove(m.id);
            }}
          >
            {confirmRemove === m.id ? t('确认删除') : '🗑'}
          </button>
        ) : null}
        <button
          className="icon-btn sm"
          title={broken ? t('放回正常列表') : t('手动隐藏：不想在列表里看到它。扫描来的模型只能隐藏，下次扫描还会回来')}
          onClick={(e) => {
            e.stopPropagation();
            props.onMute(m.id, !broken);
          }}
        >
          {broken ? '↩' : '✕'}
        </button>
      </div>
    );
  };

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        className="btn sm ghost model-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('当前模型：{model}\n凭据：{profile}', { model: props.model || t('未选择'), profile: activeProfile?.name ?? t('未选择') })}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="model-btn-name">{props.displayModel || props.model || t('选模型')}</span>
        <span className="model-btn-caret">▾</span>
      </button>

      {open ? (
        <AnchoredPopover anchorRef={anchorRef} onClose={() => setOpen(false)} className="popup picker" label={t('选择模型与凭据')}>
          {props.clientSlot && <div className="connection-tabs" role="group" aria-label={t('模型连接方式')}><button className={`btn sm ${source==='api'?'':'ghost'}`} onClick={()=>setSource('api')}>{t('API 模型')}</button><button className={`btn sm ${source==='local'?'':'ghost'}`} onClick={()=>setSource('local')}>{t('本机 AI')}</button></div>}
          {source==='local' && props.clientSlot ? props.clientSlot : <>
          {props.onRouteGroup && (props.routeGroups?.length || props.onManageRouteGroups) ? <div className="picker-section">
            <div className="picker-label">
              {t('路由组')}
              <span style={{ flex: 1 }} />
              {props.onManageRouteGroups ? <button className="icon-btn" title={t('管理路由组')}
                onClick={() => { setOpen(false); props.onManageRouteGroups!(); }}>⚙</button> : null}
            </div>
            <div className="picker-profiles">
              {props.routeGroups?.length ? props.routeGroups.map((g) => <button key={g.id} disabled={!g.count}
                className={`picker-profile${g.id === props.activeRouteGroupId ? ' on' : ''}`}
                title={t('切到这一组的第一条路由，失灵时按组内顺序交接')}
                onClick={() => { props.onRouteGroup!(g.id); setOpen(false); }}>
                {g.name || t('未命名路由组')} · {g.count}
              </button>) : <div className="picker-empty">{t('还没有路由组，去设置里建一组')}</div>}
            </div>
          </div> : null}

          {/* 凭据 */}
          <div className="picker-section">
            <div className="picker-label">
              {t('凭据')}
              <span style={{ flex: 1 }} />
              <button
                className="icon-btn"
                title={t('重新拉取这份凭据下的模型列表')}
                onClick={props.onRefresh}
                disabled={props.loading}
              >
                {props.loading ? '…' : '↻'}
              </button>
            </div>
            <div className="picker-profiles">
              {props.profiles.length === 0 ? (
                <div className="picker-empty">{t('还没登记凭据，去设置里加一份')}</div>
              ) : (
                props.profiles.map((p) => (
                  <button
                    key={p.id}
                    className={`picker-profile${p.id === props.profileId ? ' on' : ''}`}
                    onClick={() => props.onProfile(p.id)}
                    title={p.baseUrl}
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>
            <ApiConnectionStatus
              profile={activeProfile}
              cachedCount={props.models.length}
              loading={props.loading}
              error={props.error}
              onCheck={props.onRefresh}
            />
          </div>

          {/* 模型 */}
          <div className="picker-section">
            <div className="picker-label">
              {t('模型')}
              <span style={{ flex: 1 }} />
              <span style={{ fontWeight: 400, color: 'var(--fg-faint)' }}>
                {q.trim() ? t('匹配 {n} / {total}', { n: filtered.length, total: good.length }) : t('{n} 个模型', { n: good.length })}
              </span>
            </div>

            {nonChat.length > 0 ? (
              <button
                className={`chat-only${chatOnly ? ' on' : ''}`}
                onClick={() => setChatOnly((v) => !v)}
                title={
                  chatOnly
                    ? t('已隐藏 {n} 个非聊天模型（图像生成、向量、语音），点一下显示出来', { n: nonChat.length })
                    : t('点一下只看聊天模型')
                }
              >
                <span>{chatOnly ? '☑' : '☐'}</span> {t('只看聊天模型')}
                <span className="hint">
                  {chatOnly ? t('已隐藏 {n} 个', { n: nonChat.length }) : t('含 {n} 个非聊天模型', { n: nonChat.length })}
                </span>
              </button>
            ) : null}

            <input
              ref={inputRef}
              type="text"
              className="picker-search"
              placeholder={t('搜索模型，或直接粘贴一个 ID')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter') {
                  const pick = shown[0]?.id ?? (q.trim() || '');
                  if (pick) {
                    if (!props.models.some((m) => m.id === pick)) props.onAddModel(pick);
                    props.onModel(pick);
                    setOpen(false);
                  }
                }
              }}
            />

            {props.error ? (
              <div className="picker-error">
                {t('拉取失败：')}{props.error}
                <br />
                {t('可以直接在上面输入 ID 然后回车，手动加一个。')}
              </div>
            ) : null}

            <div className="picker-list" onScroll={onListScroll}>
              {shown.length === 0 ? (
                <div className="picker-empty">
                  {t('没有匹配的模型')}
                  {q.trim() ? (
                    <>
                      <br />
                      <button
                        className="btn sm"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          props.onAddModel(q.trim());
                          props.onModel(q.trim());
                          setOpen(false);
                        }}
                      >
                        {t('把「{id}」当成模型 ID 加进来', { id: q.trim() })}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : (
                <>
                  {shown.map((m) => renderItem(m, false))}
                  {filtered.length > shown.length ? (
                    <button
                      className="picker-more"
                      onClick={() => setLimit((n) => n + PAGE)}
                    >
                      {t('继续往下滚，或点这里再加载 {n} 个（已显示 {shown} / {total}）', { n: Math.min(PAGE, filtered.length - shown.length), shown: shown.length, total: filtered.length })}
                    </button>
                  ) : null}
                </>
              )}
            </div>

            {q.trim() && !exact && shown.length > 0 ? (
              <div className="picker-foot">{t('回车选中第一条')}</div>
            ) : null}

            {/* 有问题的模型：按原因分组 */}
            {bad.length > 0 ? (
              <div className="picker-bad">
                <div className="picker-bad-row">
                  <button className="picker-bad-head" onClick={() => setShowBad((v) => !v)}>
                  <span>{showBad ? '▾' : '▸'}</span>
                  {t('有问题的模型 {n} 个', { n: bad.length })}
                  <span className="hint" style={{ marginLeft: 6 }}>
                    {BAD_GROUPS.map((g) => {
                      const n = bad.filter((m) => {
                        const h = healthOf(props.health, props.profileId, m.id);
                        return h && groupOf(h) === g.key;
                      }).length;
                      return n ? `${t(g.label)} ${n}` : null;
                    })
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
                <button
                  className="icon-btn sm"
                  title={t('把这些模型 ID 连同失败原因复制出来')}
                  onClick={() => {
                    const text = bad
                      .map((m) => {
                        const h = healthOf(props.health, props.profileId, m.id);
                        return `${m.id}\t${h?.code ?? ''}\t${h?.reason ?? ''}`;
                      })
                      .join('\n');
                    void navigator.clipboard.writeText(text);
                  }}
                >
                    ⧉
                  </button>
                </div>

                {showBad ? (
                  <div className="picker-list short">
                    {badGroups.length === 0 ? (
                      <div className="picker-empty">{t('这里没有匹配的')}</div>
                    ) : (
                      badGroups.map((g) => (
                        <div key={g.key} className="bad-group">
                          <div className="bad-group-head" title={t(g.hint)}>
                            {t(g.label)} · {g.items.length}
                            <span className="hint">{t(g.hint)}</span>
                          </div>
                          {g.items.slice(0, 80).map((m) => renderItem(m, true))}
                          {g.items.length > 80 ? (
                            <div className="picker-foot">
                              {t('这一组还有 {n} 个，用上面的搜索框筛', { n: g.items.length - 80 })}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 批量体检 */}
            <div className="picker-probe">
              {probing ? (
                <>
                  <div className="probe-bar">
                    <div
                      className="probe-fill"
                      style={{
                        width: `${Math.round((props.probe!.done / Math.max(1, props.probe!.total)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="probe-text">
                    {t('体检中 {done}/{total}', { done: props.probe!.done, total: props.probe!.total })}
                    <span className="hint"> · {props.probe!.current}</span>
                  </div>
                  <button className="btn sm" onClick={props.onStopProbe}>
                    {t('停下')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn sm"
                    onClick={props.onProbe}
                    disabled={props.models.length === 0}
                    title={t('给每个模型发一个最小请求，把服务端坏掉的路由挑出来。并发压到 2，不会把额度打爆')}
                  >
                    {t('批量体检 {n} 个模型', { n: props.models.length })}
                  </button>
                  {bad.length > 0 ? (
                    <button
                      className="btn sm ghost"
                      onClick={props.onClearHealth}
                      title={t('清空这份凭据下的全部体检记录，所有模型回到未判定状态')}
                    >
                      {t('清空记录')}
                    </button>
                  ) : null}
                  <span className="hint">{t('只测通不通，不测能力')}</span>
                </>
              )}
            </div>
          </div>
          </>}
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
