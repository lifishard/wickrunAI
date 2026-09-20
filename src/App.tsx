import React from 'react';
import StartupWelcome from './components/StartupWelcome';
import BrandLogo, { BrandLoading } from './components/BrandLogo';
import type {
  AccessRequest,
  AppSettings,
  ApprovalMode,
  Artifact,
  Attachment,
  ChatMessage,
  Conversation,
  GenerationConfig,
  KeyProfile,
  ModelInfo,
  MessageQuote,
  MessageAnnotation,
  RunState,
  SessionGrants,
  SourceRef,
  ToolResult,
  ToolStep,
} from './types';
import { validateUserAnswers, type UserQuestionAnswers } from './lib/user-questions';
import { SEED_MODELS, buildHeaders, endpoint, fetchModels, previewBody } from './lib/api';
import { PROBE_SPACING_MS, probe400, probeHistory, type ProbeStep } from './lib/probe400';
import { formatExchange, failedExchange, exchangeOf, importExchanges } from './lib/wiretap';
import { loadRuns, saveRun, recoverConversations, forgetRuns, runRecord,conversationsForStorage } from './lib/runs';
import { localProgress } from './lib/task-context';
import { conversationMemory, createContextHandoff, withHandoffArchive } from './lib/handoff';
import { capabilities, outputReserve, quotaKey, routeKey, workingBudget } from './lib/adaptive';
import { addRunInput } from './lib/delivery';
import { limitKey, mergeLearnedLimit, pacingFloor, estimateRequestTokens } from './lib/limits';
import { buildWire, type AgentHandle } from './lib/agent';
import { runConnectedAgent } from './lib/connected-agent';
import {
  clearHealth,
  mergeProbe,
  probeModels,
  recordFailure,
  recordSuccess,
  setMuted,
  type ProbeProgress,
} from './lib/health';
import { nextRoute, resolveFailover, type FailoverConfig, type FailoverScope, type RouteRef } from './lib/failover';
import { TOOL_BY_NAME, availableTools } from './lib/tools/registry';
import {
  loadConversations,
  loadSettings,
  newConversation,
  saveConversationsDebounced,
  saveConversationsNow as saveConversationsRaw,
  saveSettings,
  secretGet,
  titleFrom,
  conversationTitle,
  toolContextOf,
  uid,
} from './lib/store';
import { desktop, getTransport, platformLabel, setRemoteConfig } from './lib/transport';
import type { EffortLevel } from './lib/effort';
import { loadSkills, recordSkillOutcome, saveSkills, skillSystemBlock, type Skill } from './lib/skills';
import { recallFrom } from './lib/recall';
import { observationSnapshot, routeAliasOf, type CorrectionKind } from './lib/observations';
import { routeScores, type RouteScore } from './lib/routing-memory';
import { caseFromRecord, loadEvals, resultFromRun, saveEvals, worthKeeping, type EvalStore } from './lib/evals';
import { collectArtifacts } from './lib/artifacts';
import { applyPlan, describeSync, planSync } from './lib/skillsync';
import { loadProjects, makeProject, projectSystemBlock, saveProjects, type Project } from './lib/projects';
import { teamRuntime } from './lib/team-runtime';
import { conversationQueue, nextQueuedIndex, type QueuedInput } from './lib/run-queue';
import { teamNotifications } from './lib/team-notify';
import { I18nProvider, LOCALES, setActiveLocale, translate, type Locale } from './lib/i18n';
import LocaleSwitch from './components/LocaleSwitch';
import { claimRoots, holdersOf, releaseRoots } from './lib/workspace-guard';
import DataBackupPanel from './components/collaboration/DataBackupPanel';
import {
  dueTasks,
  loadTasks,
  nextRun,
  saveTasks,
  type ScheduledTask,
} from './lib/schedule';
import AnswerBlock from './components/AnswerBlock';
import ConversationControls from './components/ConversationControls';
import {validateAttachmentSize,validateAttachmentBatch} from './lib/attachment-limits';
import ActivityPanel, { hasActivity } from './components/ActivityPanel';
import SelectionActions from './components/SelectionActions';
import Composer from './components/Composer';
import ConfigPanel from './components/ConfigPanel';
import SettingsDialog from './components/SettingsDialog';
import Sidebar from './components/Sidebar';
import WorkspaceHeader from './components/WorkspaceHeader';
import ArtifactPanel from './components/ArtifactPanel';
import Resizer from './components/Resizer';
import ErrorBoundary from './components/ErrorBoundary';
import ToolConfirm from './components/ToolConfirm';
import GrantDialog, { REMEMBER_DAYS } from './components/GrantDialog';
import WorkspaceDialog from './components/WorkspaceDialog';
import { Modal, Toast, useToast } from './components/ui';
const ObservationPanel = React.lazy(()=>import('./components/ObservationPanel'));
const ExportDialog = React.lazy(()=>import('./components/ExportDialog'));
const TeamWorkspace = React.lazy(()=>import('./components/collaboration/TeamWorkspace'));

const EXAMPLES = [
  '日日新现在有哪些免费模型，各自的上下文长度是多少？',
  '读一下我工作目录里的 README，说说这个项目是干什么的',
  '搜一下 2026 年 A 股量化私募的监管新规，给我一个时间线',
  '把当前 Chrome 标签页的内容总结成三点',
];

const saveConversationsNow=(list:Conversation[])=>saveConversationsRaw(conversationsForStorage(list));
export default function App() {
  const [bootError, setBootError] = React.useState<string | null>(null);
  const [bootReady, setBootReady] = React.useState(false);
  const [welcomeDone, setWelcomeDone] = React.useState(false);
  const [bootAttempt, setBootAttempt] = React.useState(0);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const reportSaveError = (error: unknown) => setSaveError(t('尚未保存：{error}', { error: String(error) }));
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const teamVisible = Boolean(settings?.collaborationView?.visible);
  const setTeamVisible = (visible:boolean) => setSettings(s=>s?{...s,collaborationView:{...s.collaborationView,visible}}:s);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const [models, setModels] = React.useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  /** 批量体检的进度；null = 没在跑 */
  const [probe, setProbe] = React.useState<{ done: number; total: number; current: string } | null>(
    null,
  );
  const probeStopRef = React.useRef(false);

  /** 运行态按会话分桶：不同会话各自跑各自的路由，互不占用输入框，额度只受各自路由限制。 */
  const [runs, setRuns] = React.useState<Record<string, { requestId: string; handle: AgentHandle }>>({});
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [observationsOpen,setObservationsOpen] = React.useState(false);
  /** 正在导出哪条对话。存 id 不存对象 —— 存对象的话对话更新了框里还是旧快照。 */
  const [exportingId,setExportingId] = React.useState<string|null>(null);
  const [settingsTab, setSettingsTab] = React.useState<string>('keys');
  const [configOpen, setConfigOpen] = React.useState(false);
  const [activityOpen, setActivityOpen] = React.useState(true);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<{ encryptionAvailable: boolean; storePath: string } | null>(
    null,
  );

  const [confirmReq, setConfirmReq] = React.useState<{
    step: ToolStep;
    resolve: (ok: boolean) => void;
  } | null>(null);

  /**
   * 模型申请来的额外权限。刻意只放在 React state 里：应用一关就没了，
   * 下次要用得重新申请。能执行命令、能控屏幕的授权如果被永久记住，
   * 用户迟早会忘了自己给过。
   */
  const [grants, setGrants] = React.useState<SessionGrants>({
    extraRoots: [],
    admin: false,
    screen: false,
  });
  const grantsRef = React.useRef(grants);
  grantsRef.current = grants;

  // 跑到一半时要现读设置（学到的窗口大小会在这次提问过程中被写进去），
  // 闭包里那份快照是开跑那一刻的，读它等于永远慢一拍
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;

  const [grantReq, setGrantReq] = React.useState<{
    req: AccessRequest;
    resolve: (ok: boolean, remember?: boolean) => void;
  } | null>(null);

  const [projects, setProjects] = React.useState<Project[]>([]);
  const [skills, setSkills] = React.useState<Skill[]>([]);
  const [tasks, setTasks] = React.useState<ScheduledTask[]>([]);
  const [activeSkills, setActiveSkills] = React.useState<Skill[]>([]);
  const [openArtifact, setOpenArtifact] = React.useState<Artifact | null>(null);
  const [sidebarHidden, setSidebarHidden] = React.useState(false);
  const [sidebarW, setSidebarW] = React.useState(268);
  const [teamSidebar, setTeamSidebar] = React.useState<HTMLDivElement | null>(null);
  const [panelW, setPanelW] = React.useState(420);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [workspaceTab, setWorkspaceTab] = React.useState<string>('projects');

  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  /** 生成期间又发的消息，按顺序排队，等这一轮结束再依次发出去 */
  const [queue, setQueue] = React.useState<QueuedInput[]>([]);
  const queueLoaded=React.useRef(false);
  const queueSaveChain=React.useRef(Promise.resolve());
  const [quotes, setQuotes] = React.useState<MessageQuote[]>([]);
  const [quoteOnly, setQuoteOnly] = React.useState(true);
  const [pausedQueues, setPausedQueues] = React.useState<string[]>([]);
  const startingRef = React.useRef(new Set<string>());
  const interruptingRef = React.useRef(new Map<string, {requestId:string;input:ChatMessage}>());
  const [resumeInput,setResumeInput]=React.useState<{convId:string;state:RunState}|null>(null);
  // 失灵交接：换好路由后带着现场重新起跑
  const [failoverResume,setFailoverResume]=React.useState<{convId:string;state:RunState;question:string}|null>(null);
  // 本次任务里已经试过的路由，保证一次任务最多把名单走一遍，不来回打转
  const failoverTriedRef=React.useRef(new Map<string,RouteRef[]>());
  const [routeScoreMap,setRouteScoreMap]=React.useState<Record<string,RouteScore>>({});
  const [evals,setEvals]=React.useState<EvalStore>();
  React.useEffect(()=>{void loadEvals().then(setEvals);},[]);
  const evalsRef=React.useRef<EvalStore|undefined>(undefined);evalsRef.current=evals;
  const writeEvals=React.useCallback((next:EvalStore)=>{setEvals(next);void saveEvals(next);},[]);
  const runningRef = React.useRef(new Map<string, { requestId: string; handle: AgentHandle }>());
  const questionDraftSaveRef = React.useRef(Promise.resolve());
  const questionSubmitRef = React.useRef(new Set<string>());

  const toast = useToast();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(()=>{
    if(!settings||!queueLoaded.current)return;
    const data=JSON.stringify(queue);
    queueSaveChain.current=queueSaveChain.current.catch(()=>{}).then(()=>getTransport().kvSet('wickrun:input-queue:v1',data)).catch(reportSaveError);
  },[queue,settings]);

  function notifyTask(kind:'question'|'paused'|'error'|'completed',id:string,conversationId:string,title:string,body:string){
    if(settingsRef.current?.notifications?.enabled===false)return;
    void desktop()?.notifyTask?.({kind,id,conversationId,title,body:body.slice(0,500),silent:settingsRef.current?.notifications?.sound===false}).catch(()=>{});
  }
  React.useEffect(()=>desktop()?.onTaskNotificationClick?.(event=>{
    // 协作空间的通知带的是 team:<projectId>，点开回到那个项目而不是某个会话
    if(event.conversationId.startsWith('team:')){
      const projectId=event.conversationId.slice(5);
      setSettings(s=>s?{...s,collaborationView:{visible:true,projectId}}:s);
      return;
    }
    setActiveId(event.conversationId);setTeamVisible(false);
  }),[]);

  React.useEffect(() => {
    if (!pausedQueues.length) return;
    const freed = pausedQueues.filter((id) => {
      const waiting = blockedOnRoots.current.get(id);
      return waiting !== undefined && holdersOf(id, waiting).length === 0;
    });
    if (!freed.length) return;
    for (const id of freed) blockedOnRoots.current.delete(id);
    setPausedQueues((list) => list.filter((id) => !freed.includes(id)));
  }, [runs, pausedQueues]);

  /* ---------------- 协作空间通知 ---------------- */

  const blockedOnRoots = React.useRef(new Map<string, string[]>());
  const teamNotified = React.useRef(new Map<string, string>());
  const teamSeeded = React.useRef(false);
  React.useEffect(() => {
    const sync = () => {
      const data = teamRuntime.data;
      if (!data) return;
      // 第一次拿到数据只记下现状：应用刚开就为历史运行补一堆通知没有意义
      const seeding = !teamSeeded.current;
      teamSeeded.current = true;
      for (const item of teamNotifications(teamNotified.current, data, seeding)) {
        notifyTask(item.kind, `team:${item.runId}:${item.status}`, `team:${item.projectId}`, item.title, item.body);
      }
    };
    sync();
    return teamRuntime.subscribe(sync);
  }, [bootReady]);

  /* ---------------- 启动加载 ---------------- */

  React.useEffect(() => {
    let cancelled = false;
    setBootError(null);
    void (async () => {
      const [s, c, pr, sk, tk] = await Promise.all([
        loadSettings().then(value => { if (!cancelled) setSettings(value); return value; }),
        loadConversations(),
        loadProjects(),
        loadSkills(),
        loadTasks(),
      ]);
      let recovered = c;
      try { recovered = recoverConversations(c, await loadRuns()); }
      catch (err) { toast.show(t('执行记录读取失败：{error}', { error: String(err) }), 6000); }
      if (cancelled) return;
      try {
        const savedQueue=JSON.parse(await getTransport().kvGet('wickrun:input-queue:v1')||'[]');
        const restored=Array.isArray(savedQueue)?savedQueue.filter(q=>q&&typeof q.text==='string'&&Array.isArray(q.attachments)&&Array.isArray(q.quotes)&&(q.conversationId===null||typeof q.conversationId==='string')):[];
        setQueue(restored);
        // 恢复出来的队列先按会话挂起，等用户自己点「继续队列」
        setPausedQueues([...new Set(restored.map(q=>q.conversationId).filter((id):id is string=>typeof id==='string'))]);
      }catch(error){toast.show(t('排队输入恢复失败：{error}', { error: String(error) }));}
      queueLoaded.current=true;
      setSettings(s);
      setConversations(recovered);
      setProjects(pr);
      setSkills(sk);
      setTasks(tk);
      setActiveId(recovered.length ? [...recovered].sort((a, b) => b.updatedAt - a.updatedAt)[0].id : null);
      setRemoteConfig(s.remote);
      // 记住过的授权在这里回填。过期的那份 loadSettings 已经丢掉了，
      // 所以这里拿到什么就是什么，不用再判一次时间
      if (s.rememberedGrants) {
        setGrants({
          extraRoots: s.rememberedGrants.extraRoots,
          screen: s.rememberedGrants.screen,
          admin: false, // 提权永远不跨重启
        });
      }
      const bridge = desktop();
      if (bridge) {
        const i = await bridge.info();
        setInfo({ encryptionAvailable: i.encryptionAvailable, storePath: i.storePath });
      }
      if (!cancelled) setBootReady(true);
    })().catch(error => { if (!cancelled) setBootError(String(error)); });
    return () => { cancelled = true; };
  }, [bootAttempt]);

  React.useEffect(() => {
    if (settings && bootReady) void saveSettings(settings).catch(reportSaveError);
    if (settings) setRemoteConfig(settings.remote);
  }, [settings, bootReady]);

  React.useEffect(() => {
    if (bootReady) saveConversationsDebounced(conversationsForStorage(conversations), reportSaveError);
  }, [conversations, bootReady]);

  React.useEffect(() => {
    if (!bootReady) return;
    void Promise.all([saveProjects(projects), saveSkills(skills), saveTasks(tasks)]).catch(reportSaveError);
  }, [projects, skills, tasks, bootReady]);

  /* ---------------- 启动时自动同步技能文件夹 ---------------- */

  const syncedOnceRef = React.useRef(false);
  React.useEffect(() => {
    if (syncedOnceRef.current) return;
    if (!settings?.skillSync?.auto || !settings.skillSync.dir) return;
    const bridge = desktop();
    if (!bridge) return;
    syncedOnceRef.current = true;

    void (async () => {
      try {
        const r = await bridge.skillsRead(settings.skillSync.dir);
        if (!r.ok) return;
        const plan = planSync(skills, r.items);
        if (!plan.push.length && !plan.pull.length && !plan.conflicts.length) return;
        if (plan.push.length) await bridge.skillsWrite(settings.skillSync.dir, plan.push);
        setSkills((prev) => applyPlan(prev, plan));
        toast.show(describeSync(plan, r.dir ?? settings.skillSync.dir).split('\n')[0], 5000);
      } catch {
        // 自动同步失败就安静收场 —— 启动时弹一个红条没意义，
        // 用户在工作区里手动点一次会看到真正的报错
      }
    })();
    // skills 只在首次挂载时取一次，不跟它联动：否则同步写回 skills 会触发自己
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.skillSync?.auto, settings?.skillSync?.dir]);

  /* ---------------- 快捷键 ---------------- */

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarHidden((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------- 主题 ---------------- */

  React.useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const apply = () => {
      const dark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    root.style.setProperty('--font-scale', String(settings.fontScale));
    root.setAttribute('data-density', settings.uiDensity ?? 'default');
    root.setAttribute('lang', LOCALES.find((l) => l.value === settings.locale)?.lang ?? 'zh-Hans');
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings]);

  /* ---------------- 派生值 ---------------- */

  const active = React.useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  // App 自己就是 I18nProvider，useT 会读到上一层的默认值，所以这里直接按设置取词
  const locale = settings?.locale ?? 'zh-Hans';
  // 让不在 React 树里的模块（工具摘要、诊断结论）也拿到当前语言
  setActiveLocale(locale);
  const t = React.useCallback(
    (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars),
    [locale],
  );
  /** 界面只关心当前会话：别的会话在后台跑不该锁住这里的输入和按钮。 */
  const busy = activeId ? runs[activeId] ?? null : null;
  const queuePaused = activeId ? pausedQueues.includes(activeId) : false;
  const pauseQueue = (id: string) => setPausedQueues((list) => (list.includes(id) ? list : [...list, id]));
  const resumeQueue = (id: string) => setPausedQueues((list) => list.filter((x) => x !== id));
  /** 输入框只显示本会话排的队；别的会话的队列跟这里无关。 */
  const activeQueue = React.useMemo(() => conversationQueue(queue, activeId), [queue, activeId]);

  /**
   * 当前会话用哪份凭据。
   * 会话在创建时会把 keyProfileId 钉下来 —— 这是故意的，不然翻旧对话时
   * 模型和端点会跟着全局设置漂走。代价是会话可能绑在一份你已经不用的凭据上，
   * 所以输入框左下角能随时改，改的是这个会话自己的绑定。
   */
  const profile: KeyProfile | null = React.useMemo(() => {
    if (!settings) return null;
    const pinned = active?.keyProfileId
      ? settings.keyProfiles.find((p) => p.id === active.keyProfileId)
      : null;
    if (pinned) return pinned;
    const global = settings.keyProfiles.find((p) => p.id === settings.activeKeyProfileId);
    return global ?? settings.keyProfiles[0] ?? null;
  }, [settings, active]);

  const activeProject: Project | null = React.useMemo(
    () => projects.find((p) => p.id === active?.projectId) ?? null,
    [projects, active?.projectId],
  );

  const config: GenerationConfig | null = active?.config ?? settings?.defaultConfig ?? null;
  const canRunHostTools = getTransport().canRunTools();
  React.useEffect(()=>{if(!settings||!bootReady||!desktop())return;teamRuntime.settings=()=>settingsRef.current;void teamRuntime.load();},[bootReady]);
  React.useEffect(()=>{if(!bootReady||!desktop())return;const timer=setInterval(()=>void teamRuntime.tick(),20000);return()=>clearInterval(timer);},[bootReady]);

  /* ---------------- 模型列表 ---------------- */

  const refreshModels = React.useCallback(
    async (silent = false) => {
      if (!settings || !profile) return;
      const key = await secretGet(profile.id);
      if (!key) {
        if (!silent) setModelsError(t('这份凭据还没填 API Key'));
        return;
      }
      setModelsLoading(true);
      setModelsError(null);
      try {
        const list = await fetchModels(profile, key, 30000);
        setSettings((s) =>
          s ? { ...s, cachedModels: { ...s.cachedModels, [profile.id]: list } } : s,
        );
      } catch (e) {
        setModelsError(e instanceof Error ? e.message : String(e));
      } finally {
        setModelsLoading(false);
      }
    },
    [settings, profile],
  );

  React.useEffect(() => {
    if (!settings || !profile) return;
    const cached = settings.cachedModels[profile.id] ?? [];
    const custom = settings.customModels[profile.id] ?? [];
    const merged = [...cached, ...custom];
    setModels(merged.length ? merged : SEED_MODELS);
    if (!cached.length) void refreshModels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.cachedModels, settings?.customModels, profile?.id]);

  /* ---------------- 会话操作 ---------------- */

  function updateConv(id: string, fn: (c: Conversation) => Conversation) {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }

  function openContextHandoff(msg: ChatMessage) {
    if (!active) return;
    const state = msg.runState ?? runRecord(msg.taskId ?? '')?.state;
    if (!state) { toast.show(t('没有可交接的执行记录')); return; }
    const next = createContextHandoff(active, state, uid('handoff'));
    setConversations(all => [next, ...all]);
    setActiveId(next.id);
    setAttachments([]); setQuotes([]);
    toast.show(t('已打开交接草稿。请审阅后决定是否发送；原任务进度保留。'));
  }

  React.useEffect(() => {
    if (!bootReady) return;
    for (const source of conversations) {
      const state = source.messages.map(m => m.runState).find(s => s?.contextHandoff && !source.handledHandoffKeys?.includes(s.contextHandoff.id));
      if (!state?.contextHandoff) continue;
      const key = state.contextHandoff.id;
      const next = createContextHandoff(source, state, key);
      setConversations(all => {
        const current = all.find(c => c.id === source.id);
        if (!current || current.handledHandoffKeys?.includes(key)) return all;
        return [next, ...all.map(c => c.id === source.id ? { ...c, handledHandoffKeys: [...(c.handledHandoffKeys ?? []), key] } : c)];
      });
      // Do not replace text or discard attachments the user is composing.
      if (!active?.draft?.trim() && !attachments.length && !quotes.length) setActiveId(next.id);
      toast.show(t('已按设置创建交接草稿，可从侧栏打开。尚未发送，原任务仍可继续。'));
      break;
    }
  }, [conversations, bootReady]);

  function patchMessage(convId: string, msgId: string, patch: Partial<ChatMessage>) {
    updateConv(convId, (c) => ({
      ...c,
      updatedAt: Date.now(),
      messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
    }));
  }

  async function changeAnnotation(messageId: string, noteId: string, note?: MessageAnnotation) {
    if (!active) return;
    const next = conversations.map((c) => c.id !== active.id ? c : { ...c, updatedAt: Date.now(),
      messages: c.messages.map((m) => m.id !== messageId ? m : { ...m,
        annotations: [...(m.annotations ?? []).filter((n) => n.id !== noteId), ...(note ? [note] : [])] }) });
    setConversations(next);
    await saveConversationsNow(next);
  }

  const saveAnnotation = (note: MessageAnnotation) => changeAnnotation(note.quote.messageId, note.id, note);

  function setProfileForConversation(profileId: string) {
    if (active) updateConv(active.id, (c) => ({ ...c, keyProfileId: profileId }));
    // 同时更新全局默认，新开的会话跟着走
    setSettings((st) => (st ? { ...st, activeKeyProfileId: profileId } : st));
  }

  function togglePin(id: string) {
    updateConv(id, (c) => ({ ...c, pinned: !c.pinned }));
  }

  /**
   * 分叉一个会话：上下文整份复制到新会话，接着往下聊。
   * uptoIndex 给定时只复制到那条为止 —— 用来「回到某一步重开一条支线」。
   */
  function forkConversation(id: string, uptoIndex?: number) {
    const src = conversations.find((c) => c.id === id);
    if (!src) return;
    const slice = uptoIndex === undefined ? src.messages : src.messages.slice(0, uptoIndex + 1);
    const copy: Conversation = {
      ...src,
      id: uid('c'),
      title: t('{title}（分叉）', { title: conversationTitle(src.title, t) }),
      config: JSON.parse(JSON.stringify(src.config)) as GenerationConfig,
      messages: (JSON.parse(JSON.stringify(slice)) as ChatMessage[]).map((m) => ({
        ...m,
        pending: false,
        runState: undefined,
      })),
      pinned: false,
      forkedFrom: src.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((prev) => [copy, ...prev]);
    setActiveId(copy.id);
    toast.show(t(uptoIndex === undefined ? '已分叉，上下文都带过来了' : '已从这一步分叉'));
  }

  function addCustomModel(id: string) {
    if (!profile) return;
    setSettings((st) => {
      if (!st) return st;
      const cur = st.customModels[profile.id] ?? [];
      if (cur.some((m) => m.id === id)) return st;
      return {
        ...st,
        customModels: { ...st.customModels, [profile.id]: [...cur, { id, custom: true }] },
      };
    });
  }

  /**
   * 彻底删掉一个手动补的模型 ID。
   *
   * 只对手动补的开放：扫描来的删了下次拉列表还会回来，对它来说删除等于隐藏，
   * 给两个看起来不一样、实际一样的入口只会让人困惑。顺手清掉它的健康度记录，
   * 不然这个 ID 已经不在了，记录还留着。
   */
  function removeCustomModel(id: string) {
    if (!profile) return;
    setSettings((st) => {
      if (!st) return st;
      const cur = st.customModels[profile.id] ?? [];
      if (!cur.some((m) => m.id === id)) return st;
      const health = { ...(st.modelHealth ?? {}) };
      if (health[profile.id]?.[id]) {
        const forProfile = { ...health[profile.id] };
        delete forProfile[id];
        health[profile.id] = forProfile;
      }
      return { ...st, modelHealth: health,
        customModels: { ...st.customModels, [profile.id]: cur.filter((m) => m.id !== id) } };
    });
    toast.show(t('已删除手动模型 {id}', { id }));
  }

  function addPastedImage(dataUrl: string, name: string, mime: string, size: number) {
    const error=validateAttachmentSize('image',size,name)||validateAttachmentBatch(attachments.reduce((n,a)=>n+a.size,0)+size);
    if(error){toast.show(error,5000);return;}
    setAttachments((prev) => [
      ...prev,
      { id: uid('a'), kind: 'image', name, mime, size, dataUrl },
    ]);
  }

  function setConfig(patch: Partial<GenerationConfig>) {
    if (active) {
      updateConv(active.id, (c) => ({ ...c, config: { ...c.config, ...patch } }));
    } else {
      setSettings((s) => (s ? { ...s, defaultConfig: { ...s.defaultConfig, ...patch } } : s));
    }
  }

  /**
   * 授权通过后把对应的工具一起打开。
   *
   * 不这么做的话会出现一个很蠢的局面：用户在弹窗上同意了「控制屏幕」，
   * 模型转头发现 computer_* 根本没在启用列表里 —— 同意了个寂寞。
   * 同意授权本来就是「我要它能做这件事」的意思。
   */
  function enableToolsNow(names: string[]) {
    const cur = active ? active.config : settings?.defaultConfig;
    if (!cur) return;
    const next = Array.from(new Set([...(cur.enabledTools ?? []), ...names]));
    setConfig({ toolsEnabled: true, enabledTools: next });
    // 同时写进「新会话默认」。只改当前会话的话，下次开个新对话这些工具
    // 又没了 —— 人明明已经点过同意，却要为每条对话重新点一遍
    setSettings((s) =>
      s
        ? {
            ...s,
            defaultConfig: {
              ...s.defaultConfig,
              toolsEnabled: true,
              enabledTools: Array.from(new Set([...(s.defaultConfig.enabledTools ?? []), ...names])),
            },
          }
        : s,
    );
  }
  const enableToolsRef = React.useRef(enableToolsNow);
  enableToolsRef.current = enableToolsNow;

  /* ---------------- 附件 / 工作目录 ---------------- */

  async function addAttachments(mode: 'file' | 'image') {
    const bridge = desktop();
    if (!bridge) {
      toast.show(t('这台设备读不了本地文件'));
      return;
    }
    const picked = await bridge.pickFiles(mode);
    const added: Attachment[] = [];
    const errors: string[] = [];
    for (const f of picked) {
      if (f.error || !f.kind) {
        errors.push(f.error ?? t('读取失败'));
        continue;
      }
      added.push({
        id: uid('a'),
        kind: f.kind,
        name: f.name ?? t('未命名'),
        mime: f.mime ?? '',
        size: f.size ?? 0,
        text: f.text,
        dataUrl: f.dataUrl,
        path: f.path,
      });
    }
    const batchError=validateAttachmentBatch([...attachments,...added].reduce((n,a)=>n+a.size,0));
    if(batchError)errors.unshift(batchError);
    else if (added.length) setAttachments((prev) => [...prev, ...added]);
    if (errors.length) toast.show(errors[0], 4000);
  }

  async function pickWorkspace() {
    const bridge = desktop();
    if (!bridge) {
      toast.show(t('工作目录只能在桌面端添加'));
      return;
    }
    const dir = await bridge.pickFolder();
    if (!dir) return;
    setSettings((st) => {
      if (!st) return st;
      if (st.tools.workspaceRoots.includes(dir)) return st;
      return { ...st, tools: { ...st.tools, workspaceRoots: [...st.tools.workspaceRoots, dir] } };
    });
    toast.show(t('已加入工作目录：{dir}', { dir }));
  }

  /** 新建对话。带项目时套上项目的默认模型和凭据 */
  function newChat(projectId: string | null = activeProject?.id ?? null) {
    if (!settings) return;
    const proj = projects.find((p) => p.id === projectId) ?? null;
    const c = newConversation(
      settings.defaultConfig,
      proj?.defaultKeyProfileId ?? settings.activeKeyProfileId,
    );
    c.projectId = projectId;
    if (proj?.defaultModel) c.config = { ...c.config, model: proj.defaultModel };
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
  }

  function moveToProject(convId: string, projectId: string | null) {
    updateConv(convId, (c) => ({ ...c, projectId }));
  }

  /* ---------------- 发送 ---------------- */

  /**
   * 批量体检：给列表里每个模型发一个最小请求，把死掉的路由挑出来。
   *
   * 并发压到 2 并且撞到限流就整体暂停 —— 体检本身把额度打爆的话，
   * 一批好模型会被记成「限流」，那比不测还糟。
   */
  const runProbe = React.useCallback(async () => {
    if (!settings || !profile) {
      toast.show(t('先选一份凭据'));
      return;
    }
    if (!models.length) {
      toast.show(t('先拉一次模型列表'));
      return;
    }
    const key = await secretGet(profile.id);
    if (!key) {
      toast.show(t('这份凭据还没填 API Key'));
      return;
    }

    probeStopRef.current = false;
    setProbe({ done: 0, total: models.length, current: '' });

    const out = await probeModels({
      profile,
      apiKey: key,
      models: models.map((m) => m.id),
      timeoutMs: 30_000,
      concurrency: 2,
      onProgress: (p: ProbeProgress) =>
        setProbe({ done: p.done, total: p.total, current: p.current }),
      shouldStop: () => probeStopRef.current,
      // 体检跟对话共用同一份「这条路由的脾气」：读同一份记录，也往回写
      limitOf: (m) => settingsRef.current?.modelLimits?.[limitKey(profile.id, m, profile.baseUrl)],
      onLearnLimit: (m, l) =>
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                modelLimits: {
                  ...(prev.modelLimits ?? {}),
                  [limitKey(profile.id, m, profile.baseUrl)]: mergeLearnedLimit(prev.modelLimits?.[limitKey(profile.id, m, profile.baseUrl)],l),
                },
              }
            : prev,
        ),
    });

    setSettings((prev) =>
      prev
        ? { ...prev, modelHealth: mergeProbe(prev.modelHealth ?? {}, profile.id, out.health) }
        : prev,
    );
    setProbe(null);

    if (out.fatal) {
      toast.show(t('体检中断：{title}', { title: out.fatal.title }), 5000);
      return;
    }
    const tested = Object.keys(out.health).length;
    const bad = Object.values(out.health).filter(
      (h) => h.status === 'broken' || h.status === 'missing',
    ).length;
    toast.show(
      out.stopped
        ? t('体检已停止，测了 {tested} 个，其中 {bad} 个不可用', { tested, bad })
        : t('体检完成：{tested} 个里有 {bad} 个不可用，已从默认列表移出', { tested, bad }),
      5000,
    );
  }, [settings, profile, models, toast, t]);

  /**
   * 模型申请会话级权限。同意之后只写进 React state —— 不落盘、不跨会话。
   *
   * 三种 scope 的共同点：它们都扩大了「模型能碰到什么」的边界，所以每一次
   * 都要用户亲自点。已经有的授权直接回「已有」，不重复打扰。
   */
  // 这个工具返回给模型的文字不跟界面语言走：它们是提示词的一部分，
  // 跟着 UI 切语言会改变模型行为。
  const grantAccess = React.useCallback((req: AccessRequest): Promise<ToolResult> => {
    const scope = req.scope;
    if (scope !== 'path' && scope !== 'admin' && scope !== 'screen') {
      return Promise.resolve({
        ok: false,
        content: '',
        error: `不认识的 scope：${String(scope)}。只能是 path、admin、screen 三者之一。`,
      });
    }
    if (scope === 'path' && !req.target) {
      return Promise.resolve({
        ok: false,
        content: '',
        error: 'scope="path" 必须同时给 target，填要访问的目录的绝对路径。',
      });
    }
    if (!req.reason || req.reason.trim().length < 4) {
      return Promise.resolve({
        ok: false,
        content: '',
        error: '必须给出具体理由：你要用这个权限做什么。理由会原样展示给用户看。',
      });
    }

    const g = grantsRef.current;
    if (scope === 'admin' && g.admin) {
      return Promise.resolve({ ok: true, content: '这次会话已经有管理员授权了，直接用 run_command 的 elevated 参数即可。', summary: '已有授权' });
    }
    if (scope === 'screen' && g.screen) {
      return Promise.resolve({ ok: true, content: '这次会话已经有屏幕控制授权了，可以直接截屏和操作。', summary: '已有授权' });
    }
    if (scope === 'path' && req.target && g.extraRoots.includes(req.target)) {
      return Promise.resolve({ ok: true, content: `${req.target} 已经在可访问范围里了。`, summary: '已有授权' });
    }

    return new Promise<ToolResult>((resolve) => {
      setGrantReq({
        req,
        resolve: (okGranted, remember) => {
          // 记一笔台账：同意和拒绝都记。只记同意的台账没有意义 ——
          // 「我拒绝过这件事」跟「我同意过」一样值得回头看。
          setSettings((prev) => prev ? { ...prev, grantLedger: [...(prev.grantLedger ?? []), {
            at: Date.now(), scope, target: req.target, reason: req.reason,
            granted: okGranted, remembered: Boolean(remember && okGranted && scope !== 'admin'),
            conversationId: active?.id, projectId: active?.projectId ?? null,
          }].slice(-200) } : prev);
          if (!okGranted) {
            resolve({
              ok: false,
              content: '',
              error:
                '用户拒绝了这次权限申请。不要反复申请同一项 —— 换一个不需要它的做法，' +
                '或者直接问用户希望怎么处理。',
            });
            return;
          }
          setGrants((prev) =>
            scope === 'path'
              ? { ...prev, extraRoots: Array.from(new Set([...prev.extraRoots, req.target as string])) }
              : scope === 'admin'
                ? { ...prev, admin: true }
                : { ...prev, screen: true },
          );
          // 选了记住就落进设置，重启（以及每次更新）之后还在。
          // admin 不在此列 —— GrantDialog 压根不给它这个按钮
          if (remember && scope !== 'admin') {
            setSettings((prev) => {
              if (!prev) return prev;
              const cur = prev.rememberedGrants;
              const alive = cur && cur.expiresAt > Date.now() ? cur : null;
              return {
                ...prev,
                rememberedGrants: {
                  extraRoots:
                    scope === 'path'
                      ? Array.from(new Set([...(alive?.extraRoots ?? []), req.target as string]))
                      : (alive?.extraRoots ?? []),
                  screen: scope === 'screen' ? true : Boolean(alive?.screen),
                  expiresAt: Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000,
                },
              };
            });
          }
          if (scope === 'screen') {
            enableToolsRef.current([
              'computer_screenshot',
              'computer_click',
              'computer_move',
              'computer_scroll',
              'computer_type',
              'computer_key',
            ]);
          } else if (scope === 'admin') {
            enableToolsRef.current(['run_command']);
          }
          // 有效期照实说。之前一律写「仅本次会话」，现在能记住了，
          // 再这么说就是在骗模型 —— 它会因此以为下一轮还得重新申请
          const span = remember && scope !== 'admin' ? `${REMEMBER_DAYS} 天内有效` : '仅本次会话';
          resolve({
            ok: true,
            summary: '授权通过',
            content:
              scope === 'path'
                ? `已获准访问 ${req.target}（${span}）。`
                : scope === 'admin'
                  ? '已获准提权（仅本次会话）。注意：每条 elevated 命令仍会单独弹确认，系统还会再弹一次 UAC 由用户亲自放行。'
                  : `已获准控制屏幕（${span}）。动手之前先 computer_screenshot 看清楚，不要凭记忆点击。`,
          });
        },
      });
    });
  }, []);

  /**
   * 400 自动排查。
   *
   * `inference request is invalid (code 400001)` 这种报错不点名任何字段，
   * 人只能一个个去掉再试。那件事交给机器做：从最小请求体开始一层层加回去，
   * 工具那一组再二分。十几次短请求换一个确定的答案。
   *
   * 注意别跟上面那个 runProbe 搞混：那个是「批量体检模型列表」，
   * 这个是「拆解一次失败的请求」。两件事，两个名字。
   */
  const runRequestProbe = React.useCallback(async (message?: ChatMessage) => {
    const cfg = active?.config ?? settings?.defaultConfig;
    if (!cfg || !profile || !settings) return;
    const runId = message?.runState?.runId;
    const bridge = desktop();
    if (bridge?.exchanges) importExchanges(await bridge.exchanges(runId));
    const captured = exchangeOf(message?.runState?.failedRequestId) ?? failedExchange(runId);
    if (!captured) { setPreview(t('没有找到对应的失败请求，无法根据普通聊天记录替它下结论。')); return; }
    setPreview(formatExchange(captured));
    const apiKey = await secretGet(profile.id);
    if (!apiKey) return;
    const original = captured.request as Record<string, unknown>;
    const tokens = estimateRequestTokens(original);
    const limit = settings.modelLimits?.[limitKey(profile.id, String(original.model), profile.baseUrl)];
    const cap = capabilities(profile,cfg,limit,models.find(m => m.id === cfg.model));
    const tpm = cap.tpm;
    const output = outputReserve(original,cfg,cap);
    if ((tpm && tokens+output > tpm) || tokens > workingBudget(cfg,cap,output)) {
      setPreview(formatExchange(captured)+'\n\n'+t('本地检查：原请求超出当前发送预算，已保留原文，不再重复发送大请求。')); return;
    }
    const attempts: string[] = [];
    // Compare an explicit baseline with the exact original body, not reconstructed chat history.
    for (const [label, body] of [
      // 这两个标签是翻译 key，拼进预览时才过 t()
      ['最小基线', { model: original.model, messages: [{ role: 'user', content: 'Reply OK' }], stream: false, max_tokens: 1 }],
      ['原始失败请求', original],
    ] as const) {
      let failure = '';
      const id = uid('probe');
      await getTransport().chat({ requestId: id, purpose: 'probe', runId, url: captured.url,
        headers: buildHeaders(apiKey, profile), body, stream: body.stream === true, timeoutMs: 30000,
        paceKey: quotaKey(profile), paceTokens: estimateRequestTokens(body)+outputReserve(body,cfg,cap), paceTpm: tpm,
        paceInput:estimateRequestTokens(body), paceOutput:outputReserve(body,cfg,cap), paceItpm:cap.itpm, paceOtpm:cap.otpm,
        paceMinMs: Math.max(PROBE_SPACING_MS, cfg.runtime?.rpm ? 60000/cfg.runtime.rpm : 0),
      }, { onContent() {}, onReasoning() {}, onToolCalls() {}, onUsage() {}, onDone() {},
        onError(text, status) { failure = `${status ?? ''} ${text}`; },
        onPaceWait(ms) { setPreview(formatExchange(captured)+'\n\n'+t('{label}正在排队，约 {sec} 秒后发送。', { label: t(label), sec: Math.ceil(ms/1000) })); },
      });
      attempts.push(t('{label}：{result}', { label: t(label), result: failure || t('请求成功') }));
      if (failure && /429|tpm|rpm|限流|401|403/i.test(failure)) break;
    }
    setPreview(formatExchange(captured)+'\n\n—— '+t('对照结果')+' ——\n'+attempts.join('\n')+
      '\n'+t('单次成功不证明故障不存在；以上只说明本次对照结果，原失败证据仍保留。'));
  }, [active, settings, profile, t]);

  const revokeGrants = React.useCallback(() => {
    setGrants({ extraRoots: [], admin: false, screen: false });
    // 记住的那份也一起清掉 —— 「全部撤销」按下去之后还能被重启复活，
    // 那这个按钮就是在骗人
    setSettings((prev) => (prev ? { ...prev, rememberedGrants: undefined } : prev));
    toast.show(t('已撤销全部额外授权，包括记住的那些'));
  }, [toast, t]);

  const clearProfileHealth = React.useCallback(() => {
    if (!profile) return;
    setSettings((prev) =>
      prev ? { ...prev, modelHealth: clearHealth(prev.modelHealth ?? {}, profile.id) } : prev,
    );
    toast.show(t('已清空这份凭据的体检记录'));
  }, [profile, toast, t]);

  const muteModel = React.useCallback(
    (modelId: string, muted: boolean) => {
      if (!profile) return;
      setSettings((prev) =>
        prev
          ? { ...prev, modelHealth: setMuted(prev.modelHealth ?? {}, profile.id, modelId, muted) }
          : prev,
      );
    },
    [profile],
  );

  const send = React.useCallback(
    async (text: string, replaceFromIndex?: number, resumeFrom?: RunState, queuedInput?: QueuedInput, resolution?: 'skip' | 'retry', compactBeforeRun = false) => {
      if (!settings) return;
      const nativeClient=(active?.config ?? settings.defaultConfig).client;
      const profile:KeyProfile|null=nativeClient ? {id:`client:${nativeClient.kind}`,name:nativeClient.kind,baseUrl:'',hasSecret:false,extraHeaders:{},createdAt:0} : settings.keyProfiles.find(p=>p.id===active?.keyProfileId) ?? settings.keyProfiles.find(p=>p.id===settings.activeKeyProfileId) ?? settings.keyProfiles[0] ?? null;
      // 目标会话由排队条目指定，否则就是当前可见的会话；只有同一个会话在跑才排队。
      const targetId = queuedInput?.conversationId ?? active?.id ?? null;
      const startKey = targetId ?? '__new__';
      if (startingRef.current.has(startKey) || (targetId && runningRef.current.has(targetId))) {
        setQueue((q) => [...q, queuedInput ?? { toolsEnabled:config?.toolsEnabled, text, attachments: [...attachments], quotes: [...quotes], quoteOnly, conversationId: targetId }]);
        setAttachments([]); setQuotes([]);
        return;
      }
      if (!profile) {
        toast.show(t('先去设置里登记一份 API 凭据')); setSettingsOpen(true); return;
      }
      startingRef.current.add(startKey);
      let apiKey: string | null;
      try { apiKey = nativeClient ? 'official-client' : await secretGet(profile.id); }
      catch (e) { startingRef.current.delete(startKey); toast.show(String(e)); return; }
      if (!apiKey) { startingRef.current.delete(startKey); toast.show(t('这份凭据还没填 API Key')); setSettingsOpen(true); return; }
      // 没有会话就现开一个；排队条目带着会话 id，指向哪个会话就在哪个会话里跑
      let conv = queuedInput?.conversationId
        ? conversations.find((c) => c.id === queuedInput.conversationId) ?? active
        : active;
      let baseList = conversations;
      if (!conv) {
        conv = newConversation(settings.defaultConfig, profile.id);
        baseList = [conv, ...conversations];
      }
      const cfg = queuedInput?.toolsEnabled===undefined?conv.config:{...conv.config,toolsEnabled:queuedInput.toolsEnabled};
      // 新任务重新开始数：已试过的名单只在一次任务内有效，不该拖累下一个问题
      if(!resumeFrom)failoverTriedRef.current.delete(conv.id);

      if (!cfg.model) {
        startingRef.current.delete(startKey);
        toast.show(t('先选一个模型'));
        setConfigOpen(true);
        return;
      }

      const resumeIndex = resumeFrom ? conv.messages.findIndex((m) => m.runState === resumeFrom ||
        (resumeFrom.runId && m.runState?.runId === resumeFrom.runId)) : -1;
      const resumeAnswer = resumeIndex >= 0 ? conv.messages[resumeIndex] : undefined;
      const previousQuestion = resumeIndex > 0 ? conv.messages[resumeIndex-1] : undefined;
      const kept = resumeFrom ? conv.messages.slice(0, Math.max(0, resumeIndex-1))
        : replaceFromIndex === undefined ? conv.messages : conv.messages.slice(0, replaceFromIndex);
      if (!resumeFrom && replaceFromIndex !== undefined) {
        try { await forgetRuns(conv.id, new Set(conv.messages.slice(replaceFromIndex).map((m) => m.id))); }
        catch (e) { startingRef.current.delete(startKey); toast.show(t('无法更新执行记录：{error}', { error: String(e) })); return; }
      }

      // 本轮唤起的技能：固定一份快照，并记一次使用次数。
      // 注意技能是**粘的** —— 发完不清空，一直注入到用户自己点掉那个 ✕。
      // 一次性注入看着更"干净"，但技能通常是一整段工作流（先查再写再验），
      // 第二轮开始模型就看不见规则了，表现出来就是"它好像忘了"。
      const turnSkills = activeSkills;
      if (turnSkills.length) {
        const ids = new Set(turnSkills.map((x) => x.id));
        setSkills((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, uses: x.uses + 1 } : x)));
      }

      const userMsg: ChatMessage = previousQuestion ?? {
        id: uid('m'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
        attachments: (queuedInput?.attachments ?? attachments).length ? (queuedInput?.attachments ?? attachments) : undefined,
        quotes: queuedInput?.quotes ?? quotes,
        quoteOnly: (queuedInput?.quotes ?? quotes).length > 0 ? (queuedInput?.quoteOnly ?? quoteOnly) : false,
        skillNames: turnSkills.length ? turnSkills.map((x) => x.name) : undefined,
      };
      const answerMsg: ChatMessage = {
        ...resumeAnswer,
        id: resumeAnswer?.id ?? uid('m'),
        role: 'assistant',
        content: resumeFrom?.content ?? resumeAnswer?.content ?? '',
        reasoning: resumeFrom?.reasoning ?? resumeAnswer?.reasoning ?? '',
        createdAt: resumeAnswer?.createdAt ?? Date.now(),
        pending: true, error: undefined, errorInfo: undefined, progress: undefined,
        model: cfg.model,
        steps: resumeFrom?.steps ?? resumeAnswer?.steps ?? [],
        sources: resumeFrom?.sources ?? [],
      };

      const convId = conv.id;
      if (convId !== startKey) { startingRef.current.delete(startKey); startingRef.current.add(convId); }

      // 会话之间并行没问题，同时往一个目录里写有问题：先登记，占着就等对方放手
      const wantedRoots = cfg.toolsEnabled
        ? toolContextOf(settings, conv.projectId ?? null, grantsRef.current).workspaceRoots
        : [];
      const holders = holdersOf(convId, wantedRoots);
      if (holders.length) {
        startingRef.current.delete(convId);
        blockedOnRoots.current.set(convId, wantedRoots);
        setQueue((q) => [...q, queuedInput ?? { toolsEnabled: cfg.toolsEnabled, text, attachments: [...attachments], quotes: [...quotes], quoteOnly, conversationId: convId }]);
        setAttachments([]); setQuotes([]);
        pauseQueue(convId);
        const holderTitle = conversations.find((c) => c.id === holders[0])?.title || t('另一个会话');
        toast.show(t('「{title}」正在这个工作目录里执行。这条排着，等它结束再发。', { title: holderTitle }), 6000);
        return;
      }
      claimRoots(convId, wantedRoots);

      const history = [...kept, userMsg];
      const nextConv: Conversation = {
        ...conv,
        draft: resumeFrom ? conv.draft : '',
        title: kept.length === 0 ? titleFrom(text) : conv.title,
        messages: resumeAnswer ? conv.messages.map((m) => m.id === answerMsg.id ? answerMsg : m) : [...history, answerMsg],
        updatedAt: Date.now(),
      };

      setConversations(baseList.map((c) => (c.id === convId ? nextConv : c)));
      // 后台会话的排队/恢复不抢焦点：只有从当前可见会话发出的才切过去
      if (!queuedInput?.conversationId || queuedInput.conversationId === active?.id) setActiveId(convId);
      if (!resumeFrom) { setAttachments([]); setQuotes([]); }
      resumeQueue(convId);

      /* --- 流式缓冲：按 60ms 节流刷进 state，不然一个 token 一次 setState --- */
      const buf = { content: answerMsg.content, reasoning: answerMsg.reasoning ?? '', dirty: false };
      const flush = () => {
        if (!buf.dirty) return;
        buf.dirty = false;
        const content = buf.content;
        const reasoning = buf.reasoning;
        patchMessage(convId, answerMsg.id, { content, reasoning });
      };
      const timer = setInterval(flush, 120);

      const steps: ToolStep[] = [...(answerMsg.steps ?? [])];
      let latestState: RunState | null = resumeFrom ?? null;
      const started = Date.now();
      const requestId = uid('r');
      let approvalChain=Promise.resolve();
      let approvalsClosed=false;
      const pendingApprovals=new Set<(ok:boolean)=>void>();
      const requestApproval=(step:ToolStep):Promise<boolean>=>{
        const result=approvalChain.then(()=>new Promise<boolean>(resolve=>{
          if(approvalsClosed){resolve(false);return;}
          const finish=(ok:boolean)=>{pendingApprovals.delete(finish);resolve(ok);};
          pendingApprovals.add(finish);notifyTask('question',`${requestId}:approval:${step.id}`,convId,t('操作需要你的确认'),step.summary);setConfirmReq({step,resolve:finish});
        }));
        approvalChain=result.then(()=>{});return result;
      };

      const finishUi = () => {
        approvalsClosed=true;
        for(const resolve of pendingApprovals)resolve(false);
        setConfirmReq(null);
        clearInterval(timer); flush();
        if (runningRef.current.get(convId)?.requestId === requestId) {
          runningRef.current.delete(convId);
          setRuns((prev) => { if (prev[convId]?.requestId !== requestId) return prev; const next = { ...prev }; delete next[convId]; return next; });
        }
        startingRef.current.delete(convId);
        if (!runningRef.current.has(convId)) releaseRoots(convId);
      };
      const finishInterruption=()=>{
        const steering=interruptingRef.current.get(convId);
        if(steering?.requestId!==requestId||!latestState)return false;
        interruptingRef.current.delete(convId);startingRef.current.add(convId);pauseQueue(convId);
        const state=latestState.supplementalInputs?.some(m=>m.id===steering.input.id)?structuredClone(latestState):addRunInput(latestState,steering.input);
        if(state.status==='completed'){state.phase='request';state.pendingCalls=[];state.toolCursor=0;}
        state.at=Date.now();state.status='paused';state.reason='新输入和执行现场已保存，正在继续';/* 翻译 key，RecoveryCard 渲染时过 t() */
        void saveRun({id:state.runId??requestId,conversationId:convId,answerId:answerMsg.id,question:userMsg,config:cfg,keyProfileId:profile.id,projectId:conv!.projectId,title:nextConv.title,state}).then(()=>{
          patchMessage(convId,answerMsg.id,{runState:state,supplementalInputs:state.supplementalInputs});
          startingRef.current.delete(convId);
          if(!state.uncertainCallId)setResumeInput({convId,state});
          else notifyTask('paused',`${requestId}:uncertain`,convId,t('新要求已保存，需要核实上一项操作'),t('上一项操作的结果尚未确认，请回来核实后继续，避免重复执行。'));
        }).catch(error=>{startingRef.current.delete(convId);reportSaveError(error);});
        return true;
      };
      const handle = runConnectedAgent({
        requestId,
        profile,
        apiKey,
        config: cfg,
        resolveWorker: async profileId => {
          const workerProfile=settings.keyProfiles.find(p=>p.id===profileId);
          if(!workerProfile)throw new Error(t('子代理所选凭据已不存在，请重新选择。'));
          const workerKey=await getTransport().secretGet(profileId);
          return {profile:structuredClone(workerProfile),apiKey:workerKey || '',models:[...(settings.cachedModels[profileId] || []),...(settings.customModels[profileId] || [])]};
        },
        history,
        autoRetry: settings.autoRetry ?? 2,
        profileName: profile.name,
        // 传函数而不是快照：中途拿到的授权要对后面的工具调用立刻生效
        toolCtx: () => toolContextOf(settings, conv.projectId ?? null, grantsRef.current),
        effortMappings: settings.effortMappings,
        resume: resumeFrom,
        compactBeforeRun,
        previousModel: resumeAnswer?.model,
        conversationMemory: resumeFrom ? undefined : withHandoffArchive(conversationMemory(history, runRecord), history.some(m => m.quoteOnly) ? undefined : runRecord(conv.handoffSourceRunId ?? '')),
        resolveUncertain: resolution,
        // 这条路由的窗口有多大 —— 之前撞出来的那个数
        modelInfo: [...(settings.cachedModels[profile.id] ?? []), ...(settings.customModels[profile.id] ?? [])].find(m => m.id === cfg.model),
        limitOf: () => settingsRef.current?.modelLimits?.[limitKey(profile.id, cfg.model, profile.baseUrl)],
        onLearnLimit: (l) =>
          setSettings((prev) =>
            prev
              ? {
                  ...prev,
                  modelLimits: {
                    ...(prev.modelLimits ?? {}),
                    [limitKey(profile.id, cfg.model, profile.baseUrl)]: mergeLearnedLimit(prev.modelLimits?.[limitKey(profile.id, cfg.model, profile.baseUrl)],l),
                  },
                }
              : prev,
          ),
        // 子代理跑在别的路由上，按它自己的键读写，别记到主任务那条上去
        limits: {
          get: (profileId, model, baseUrl) =>
            settingsRef.current?.modelLimits?.[limitKey(profileId, model, baseUrl)],
          learn: (profileId, model, baseUrl, l) =>
            setSettings((prev) =>
              prev
                ? {
                    ...prev,
                    modelLimits: {
                      ...(prev.modelLimits ?? {}),
                      [limitKey(profileId, model, baseUrl)]: mergeLearnedLimit(prev.modelLimits?.[limitKey(profileId, model, baseUrl)],l),
                    },
                  }
                : prev,
            ),
        },
        skills: turnSkills,
        // 默认零关联：只在模型显式调用时才查，而且只查同一个项目
        recallTasks: async (query, limit) => recallFrom(await loadRuns(), await observationSnapshot(),
          { query, limit, projectId: conv!.projectId ?? null, excludeConversationId: conv!.id }),
        extraSystem: [
          projectSystemBlock(projects.find((p) => p.id === conv.projectId) ?? null),
          skillSystemBlock(turnSkills),
        ]
          .filter(Boolean)
          .join('\n\n'),
        timeoutMs: settings.requestTimeoutMs,
        canRunHostTools,
        grantAccess,
        confirm: (step) => {
          // 这两类永远要人点头，连「全部放行」都不例外：
          //   - 提权：它越过的是工作目录白名单之外的一切
          //   - 权限申请：一个「一律放行」的档位如果连「要不要给权限」都替人答了，
          //     那这个档位就等于把授权体系整个关掉
          const args = (step.args ?? {}) as Record<string, unknown>;
          const alwaysAsk =
            step.name === 'request_access' || (step.name === 'run_command' && Boolean(args.elevated));
          if (alwaysAsk) {
            return requestApproval(step);
          }
          if (cfg.approvalMode === 'all') return Promise.resolve(true);
          if (cfg.approvalMode === 'auto') {
            const def = TOOL_BY_NAME[step.name];
            // 「自动批准编辑」只放行改文件和 Chrome；
            // 跑命令和 Claude Code 影响面太大，这一档仍然要问
            const heavy = step.name === 'native_client_operation' || def?.group === 'shell' || def?.group === 'agent';
            if (!heavy) return Promise.resolve(true);
          }
          return requestApproval(step);
        },
        events: {
          onContentReplace(content, reasoning) {
            buf.content = content; buf.reasoning = reasoning; buf.dirty = true; flush();
          },
          onContentDelta(d) {
            buf.content += d;
            buf.dirty = true;
          },
          onReasoningDelta(d) {
            buf.reasoning += d;
            buf.dirty = true;
          },
          onStep(step) {
            const i = steps.findIndex((s) => s.id === step.id);
            if (i === -1) steps.push(step);
            else steps[i] = step;
            patchMessage(convId, answerMsg.id, { steps: [...steps], artifacts: collectArtifacts(buf.content, steps) });
          },
          onSources(list: SourceRef[]) {
            patchMessage(convId, answerMsg.id, { sources: [...list] });
          },
          onUsage(u) {
            patchMessage(convId, answerMsg.id, { usage: u });
          },
          onRound() {},
          onNotice(text) {
            patchMessage(convId, answerMsg.id, { notice: text || undefined });
          },
          onStopReason(reason) {
            patchMessage(convId, answerMsg.id, { stopReason: reason ?? undefined });
          },
          async onRunState(state) {
            if (state) {
              latestState = state;
              await saveRun({ id: state.runId ?? requestId, conversationId: convId, answerId: answerMsg.id,
                question: userMsg, config: cfg, keyProfileId: profile.id, projectId: conv!.projectId,
                title: nextConv.title, state });
            }
            if(state?.userQuestion&&!state.userQuestion.answers)notifyTask('question',`${state.runId}:${state.userQuestion.request.id}`,convId,t('任务需要你的回答'),state.userQuestion.request.questions.map(q=>q.question).join('；'));
            patchMessage(convId, answerMsg.id, { runState: state ?? undefined,
              ...(state ? { harness:state.harness,subagents:state.subagents,milestones: state.milestones, contextSnapshot: state.contextSnapshot, delivery: state.delivery, taskId:state.runId, supplementalInputs:state.supplementalInputs, handoff:state.handoff, userQuestionHistory: state.userQuestionHistory } : {}) });
          },
          onPaused(reason) {
            finishUi(); pauseQueue(convId);
            const interrupted=finishInterruption();
            const answeredWhileSaving=!latestState?.userQuestion&&!latestState?.uncertainCallId&&latestState?.pendingInputMessages?.some(m=>m.id.startsWith('answer-'));
            if(!interrupted&&answeredWhileSaving&&latestState)setResumeInput({convId,state:latestState});
            else if(!interrupted&&!latestState?.userQuestion)notifyTask('paused',`${requestId}:paused`,convId,t('任务已暂停'),reason);
            patchMessage(convId, answerMsg.id, { pending: false, notice: undefined,
              content: buf.content, reasoning: buf.reasoning, progress: localProgress(steps, reason),
              artifacts: collectArtifacts(buf.content, steps), elapsedMs: Date.now()-started });
          },
          onDone() {
            finishUi();

            const arts = collectArtifacts(buf.content, steps);
            patchMessage(convId, answerMsg.id, {
              pending: false,
              notice: undefined,
              progress: undefined,
              content: buf.content,
              reasoning: buf.reasoning,
              elapsedMs: Date.now() - started,
              artifacts: arts.length ? arts : undefined,
            });
            if(finishInterruption())return;
            failoverTriedRef.current.delete(convId);
            /*
             * 在跑回归题就把结果记回去。没有这一步，回归集只是一张清单 ——
             * 而清单证明不了任何事。
             */
            if(nextConv.evalCaseId&&latestState&&evalsRef.current){
              const store=evalsRef.current;
              const result=resultFromRun(nextConv.evalCaseId,nextConv.evalConfig??cfg.model,latestState,Date.now()-started);
              writeEvals({...store,results:[...store.results,result],
                cases:store.cases.map(c=>c.id===nextConv.evalCaseId?{...c,uses:c.uses+1,lastUsedAt:Date.now()}:c)});
            }
            notifyTask('completed',`${requestId}:completed`,convId,t('任务已完成'),buf.content.slice(-240)||nextConv.title);
            // 只有完整响应成功才清除失败记录。
            if (latestState?.status === 'completed') setSettings((prev) =>
              prev
                ? {
                    ...prev,
                    modelHealth: recordSuccess(prev.modelHealth ?? {}, profile.id, cfg.model),
                  }
                : prev,
            );
            // 只产出一个东西时直接开右侧面板 —— 多个就让用户自己挑
            if (arts.length === 1) setOpenArtifact(arts[0]);
          },
          onError(msg, info) {
            finishUi(); pauseQueue(convId);
            const interrupted = finishInterruption();
            if(!interrupted)notifyTask('error',`${requestId}:error`,convId,t('任务遇到问题'),msg);
            // 记一笔健康度：确定性的服务端崩溃和「模型不存在」会让这个 ID
            // 从默认模型列表里消失，限流和超时不算
            const health = info.blameModel
              ? recordFailure(settingsRef.current?.modelHealth ?? {}, profile.id, cfg.model, info)
              : (settingsRef.current?.modelHealth ?? {});
            if (info.blameModel) setSettings((prev) => prev ? { ...prev, modelHealth: health } : prev);

            // 失灵即交接。名单是用户排的，程序只按顺序往下走；名单为空就是原来的行为。
            const current: RouteRef = { profileId: profile.id, model: cfg.model };
            const tried = failoverTriedRef.current.get(convId) ?? [];
            // 三层继承：本对话 > 项目 > 应用全局。哪一层先有设置就用哪一层。
            const failover = resolveFailover(cfg.failover,
              projects.find((p) => p.id === conv!.projectId)?.failover,
              settingsRef.current?.failover).config;
            const decision = !interrupted && latestState && failover.enabled && !cfg.client
              ? nextRoute({ current, order: failover.routes ?? [], tried, health, info })
              : null;
            const note = decision
              ? t('{reason}，已按你的接力名单交给 {model} 接手，进度不重来。', { reason: t(decision.reason), model: decision.route.model })
              : '';
            patchMessage(convId, answerMsg.id, {
              pending: false,
              notice: undefined,
              error: note ? `${msg}\n${note}` : msg,
              errorInfo: info,
              progress: localProgress(steps, msg),
              artifacts: collectArtifacts(buf.content, steps),
              content: buf.content,
              elapsedMs: Date.now() - started,
            });
            if (decision && latestState) {
              failoverTriedRef.current.set(convId, [...tried, current]);
              setConversations((all) => all.map((c) => c.id === convId
                ? { ...c, keyProfileId: decision.route.profileId, config: { ...c.config, model: decision.route.model } }
                : c));
              toast.show(note);
              setFailoverResume({ convId, state: latestState, question: userMsg.content });
            }
          },
        },
      });

      startingRef.current.delete(convId);
      runningRef.current.set(convId, { requestId, handle });
      setRuns((prev) => ({ ...prev, [convId]: { requestId, handle } }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, conversations, active, profile, runs, canRunHostTools, attachments, activeSkills, projects, quotes, quoteOnly],
  );

  /*
   * 把接力名单里的候选和记分表对上号。
   *
   * 观测里存的是路由别名（哈希，不可逆），所以只能用同一套算法给候选重算一遍。
   * 只算名单里真的出现过的那几条 —— 给几百个模型逐个算哈希纯属浪费。
   */
  React.useEffect(()=>{
    if(!settings)return;
    let live=true;
    const wanted=[...new Set([settings.failover,...projects.map(p=>p.failover),...conversations.map(c=>c.config.failover)]
      .flatMap(f=>f?.routes??[]).map(r=>`${r.profileId}::${r.model}`))];
    if(!wanted.length){setRouteScoreMap({});return;}
    void (async()=>{
      const store=await observationSnapshot();
      const byAlias=new Map(routeScores(store,'all').map(s=>[s.route,s]));
      const out:Record<string,RouteScore>={};
      for(const key of wanted){
        const at=key.indexOf('::'),profileId=key.slice(0,at),model=key.slice(at+2);
        const profile=settings.keyProfiles.find(p=>p.id===profileId);
        if(!profile)continue;
        const score=byAlias.get(await routeAliasOf(model,profileId,routeKey(profile,model),store.epoch));
        if(score)out[key]=score;
      }
      if(live)setRouteScoreMap(out);
    })();
    return ()=>{live=false;};
  },[settings?.failover,settings?.keyProfiles,projects,conversations]);

  React.useEffect(()=>{
    if(!failoverResume)return;
    const {convId,state,question}=failoverResume;
    if(runningRef.current.has(convId)||startingRef.current.has(convId))return;
    setFailoverResume(null);
    void send(question,undefined,state,{text:'',attachments:[],quotes:[],quoteOnly:false,conversationId:convId});
  },[failoverResume,runs,send]);

  React.useEffect(()=>{
    if(!resumeInput)return;
    const {convId,state}=resumeInput;
    if(runningRef.current.has(convId)||startingRef.current.has(convId))return;
    setResumeInput(null);
    // '继续处理新输入' 是发给模型的续跑指令，不跟界面语言走
    void send('继续处理新输入',undefined,state,{text:'',attachments:[],quotes:[],quoteOnly:false,conversationId:convId});
  },[resumeInput,runs,send]);

  function sendNow(input:QueuedInput):boolean {
    const convId=input.conversationId??activeId;
    if(!convId)return false;
    const running=runningRef.current.get(convId);
    if(!running||interruptingRef.current.has(convId))return false;
    const message:ChatMessage={id:uid('input'),role:'user',content:input.text,createdAt:Date.now(),attachments:input.attachments,quotes:input.quotes,quoteOnly:input.quotes.length>0&&input.quoteOnly};
    pauseQueue(convId);
    try{
      interruptingRef.current.set(convId,{requestId:running.requestId,input:message});
      if(running.handle.interrupt)running.handle.interrupt(message);else running.handle.abort();
      setConfirmReq(request=>{request?.resolve(false);return null;});setGrantReq(request=>{request?.resolve(false);return null;});
      toast.show(t('正在保存当前输出和执行现场，然后处理新要求'));return true;
    }catch(error){interruptingRef.current.delete(convId);toast.show(String(error));return false;}
  }

  function abortRun(id:string){
    interruptingRef.current.delete(id);
    pauseQueue(id);
    runningRef.current.get(id)?.handle.abort();
  }

  /** 停当前会话（或指定会话）；别的会话的任务继续跑。 */
  function stop(target?:string) {
    const id=target??activeId;
    if(id)abortRun(id);
    if(!target)setResumeInput(null);
    setConfirmReq((request) => { request?.resolve(false); return null; });
    setGrantReq((request) => { request?.resolve(false); return null; });
  }

  function stopAll() {
    for(const id of [...runningRef.current.keys()])abortRun(id);
    setResumeInput(null);
    setConfirmReq((request) => { request?.resolve(false); return null; });
    setGrantReq((request) => { request?.resolve(false); return null; });
  }

  const resumeRun = React.useCallback(
    (msg: ChatMessage, resolution?: 'skip' | 'retry', additionalInput?: string, compactBeforeRun = false) => {
      if (busy || !msg.runState || !active) return;
      const index = active.messages.findIndex((m) => m.id === msg.id);
      const question = active.messages[index-1]?.content ?? '继续'; // 发给模型的续跑问题，不翻译
      let state = structuredClone(msg.runState);
      if (additionalInput?.trim()) {
        const message: ChatMessage = {id:uid('m'),role:'user',content:additionalInput.trim(),createdAt:Date.now()};
        state=addRunInput(state,message);
        state.reason = '用户已补充信息，正在继续'; // 翻译 key，渲染时过 t()
      }
      void send(question, undefined, state, undefined, resolution, compactBeforeRun);
    }, [busy, active, send],
  );

  /** Save a pending question draft in both the visible conversation and run journal. */
  const saveQuestionDraft = React.useCallback((msg: ChatMessage, draft: UserQuestionAnswers) => {
    if (!active || !msg.runState?.userQuestion) return;
    const live=runningRef.current.get(active.id);
    if(live&&msg.pending&&live.handle.questionDraft){
      void live.handle.questionDraft(msg.runState.userQuestion.request.id,draft).catch(reportSaveError);return;
    }
    const state = structuredClone(msg.runState);
    if (!state.userQuestion) return;
    state.userQuestion.draft = structuredClone(draft);
    state.at = Date.now();
    patchMessage(active.id, msg.id, {
      runState: state,
      userQuestionHistory: state.userQuestionHistory,
    });
    const saved = runRecord(state.runId ?? '');
    if (!saved) return;
    questionDraftSaveRef.current = questionDraftSaveRef.current
      .catch(() => {})
      .then(() => saveRun({ ...saved, state }))
      .catch(reportSaveError);
  }, [active]);

  /** Validate once, persist the answer, then resume the same tool cursor. */
  const submitQuestion = React.useCallback((msg: ChatMessage, answers: UserQuestionAnswers) => {
    if (!active || !msg.runState?.userQuestion) return;
    const pending = msg.runState.userQuestion;
    const key = `${msg.runState.runId ?? msg.id}:${pending.callId}`;
    if (questionSubmitRef.current.has(key) || pending.answers) return;
    let normalized: UserQuestionAnswers;
    try {
      normalized = validateUserAnswers(pending.request, answers);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : t('回答无效，请检查后重试'), 5000);
      return;
    }
    if(busy){
      const live=runningRef.current.get(active.id);
      if(!msg.pending||!live?.handle.answerQuestion){toast.show(t('请等待当前任务保存后提交回答'));return;}
      questionSubmitRef.current.add(key);
      void live.handle.answerQuestion(pending.request.id,normalized).catch(error=>{questionSubmitRef.current.delete(key);toast.show(String(error));});return;
    }
    questionSubmitRef.current.add(key);
    const state = structuredClone(msg.runState);
    if (!state.userQuestion) return;
    state.userQuestion.answers = structuredClone(normalized);
    state.userQuestion.draft = structuredClone(normalized);
    state.reason = '已收到回答，正在继续'; // 翻译 key，渲染时过 t()
    patchMessage(active.id, msg.id, {
      runState: state,
      userQuestionHistory: state.userQuestionHistory,
    });
    const index = active.messages.findIndex((item) => item.id === msg.id);
    const question = index > 0 ? active.messages[index - 1]?.content ?? '继续' : '继续'; // 同上，模型侧文本
    const saved = runRecord(state.runId ?? '');
    questionDraftSaveRef.current = questionDraftSaveRef.current
      .catch(() => {})
      .then(async () => {
        if (saved) await saveRun({ ...saved, state });
        await send(question, undefined, state);
      })
      .catch((error) => {
        questionSubmitRef.current.delete(key);
        toast.show(error instanceof Error ? error.message : String(error), 5000);
      });
  }, [busy, active, send, toast]);

  // 上一轮结束后自动发下一条排队的
  React.useEffect(() => {
    if (queue.length === 0) return;
    const index = nextQueuedIndex(queue, {
      activeId,
      busyIds: [...runningRef.current.keys(), ...startingRef.current],
      pausedIds: pausedQueues,
    });
    if (index < 0) return;
    const next = queue[index];
    setQueue((all) => all.filter((_, i) => i !== index));
    void send(next.text, undefined, undefined, { ...next, conversationId: next.conversationId ?? activeId });
  }, [runs, queue, send, pausedQueues, activeId]);

  /* ---------------- 定时任务调度 ---------------- */

  /**
   * 每 20 秒看一眼有没有到点的任务。
   * 跑在渲染进程里 —— 应用关着就不会触发，这是已知的取舍，
   * TasksTab 里跟用户讲清楚了。
   */
  const sendRef = React.useRef(send);
  sendRef.current = send;

  const busyRef = React.useRef(false);
  busyRef.current = Boolean(busy);

  React.useEffect(() => {
    if (!settings) return;

    // 启用了但还没算过下次触发时间的，补上
    setTasks((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (t.enabled && !t.nextRunAt) {
          changed = true;
          return { ...t, nextRunAt: nextRun(t.schedule) ?? undefined };
        }
        return t;
      });
      return changed ? next : prev;
    });

    const tick = () => {
      if (busyRef.current) return; // 正在生成就等下一轮，别插队
      const due = dueTasks(tasks);
      if (!due.length) return;

      const t = due[0];
      const now = Date.now();

      setTasks((prev) =>
        prev.map((x) =>
          x.id === t.id
            // lastResult 是翻译 key，WorkspaceDialog 渲染时过 t()
            ? { ...x, lastRunAt: now, lastResult: '已触发', nextRunAt: nextRun(x.schedule, new Date(now)) ?? undefined }
            : x,
        ),
      );

      void runTask(t);
    };

    const id = setInterval(tick, 20_000);
    const first = setTimeout(tick, 3_000); // 打开应用几秒后先补一次
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, settings]);

  /** 一个定时任务到点了：开对话（或复用），把 prompt 发出去 */
  async function runTask(t: ScheduledTask) {
    if (!settings) return;

    let convId = t.conversationId;
    const reuse = t.target === 'same' && convId && conversations.some((c) => c.id === convId);

    if (!reuse) {
      const proj = projects.find((p) => p.id === t.projectId) ?? null;
      const c = newConversation(
        settings.defaultConfig,
        t.keyProfileId ?? proj?.defaultKeyProfileId ?? settings.activeKeyProfileId,
      );
      c.projectId = t.projectId;
      c.taskId = t.id;
      c.title = `⏰ ${t.name}`;
      const model = t.model || proj?.defaultModel || settings.defaultConfig.model;
      if (model) c.config = { ...c.config, model };
      convId = c.id;
      setConversations((prev) => [c, ...prev]);
      if (t.target === 'same') {
        setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, conversationId: c.id } : x)));
      }
    }

    setActiveId(convId!);
    // 等一帧让上面的 state 落地，再走正常的发送链路
    await new Promise((r) => setTimeout(r, 60));
    sendRef.current(t.prompt);
  }

  /* ---------------- 滚动跟随 ---------------- */

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [active?.messages]);

  /* ---------------- 渲染 ---------------- */

  if (bootError) return <div className="empty" role="alert" style={{padding: 48}}><h2>{t('本地数据未能读取')}</h2><p>{bootError}</p><p>{t('原记录已保留。修复文件或恢复备份后重试。')}</p><button className="btn" onClick={() => setBootAttempt(n => n + 1)}>{t('重新读取')}</button><button className="btn" onClick={() => void desktop()?.info().then(i => desktop()?.revealPath(i.storePath))}>{t('打开数据位置')}</button><DataBackupPanel/></div>;
  if (!bootReady || !settings || !config || !welcomeDone) {
    return <StartupWelcome key={bootAttempt} ready={Boolean(bootReady && settings && config)} locale={locale}
      onLocale={locale => setSettings(previous => previous ? { ...previous, locale } : previous)}
      onDone={() => setWelcomeDone(true)} />;
  }

  // 把消息配成「一问一答」
  const turns: { q: ChatMessage | null; a: ChatMessage | null; qIndex: number }[] = [];
  const msgs = active?.messages ?? [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'user') {
      const next = msgs[i + 1];
      if (next && next.role === 'assistant') {
        turns.push({ q: m, a: next, qIndex: i });
        i++;
      } else {
        turns.push({ q: m, a: null, qIndex: i });
      }
    } else if (m.role === 'assistant') {
      turns.push({ q: null, a: m, qIndex: i });
    }
  }

  const toolNames = config.toolsEnabled
    ? config.enabledTools.filter((n) =>
        availableTools(canRunHostTools).some((t) => t.name === n),
      )
    : [];

  /** 已生效的额外授权：一直显示在输入框上方，不让人忘了自己给过什么 */
  const grantBanner =
    grants.admin || grants.screen || grants.extraRoots.length ? (
      <div className="grant-banner">
        <span className="grant-banner-label">
          {t('已授权')}
          {settings?.rememberedGrants
            ? t('（记到 {date}）', { date: new Date(settings.rememberedGrants.expiresAt).toLocaleDateString() })
            : t('（仅本次会话）')}
        </span>
        {grants.screen ? <span className="grant-chip">🖥 {t('屏幕控制')}</span> : null}
        {grants.admin ? <span className="grant-chip">🛡 {t('管理员执行')}</span> : null}
        {grants.extraRoots.map((r) => (
          <span key={r} className="grant-chip" title={r}>
            📂 {r.split(/[\\/]/).filter(Boolean).slice(-1)[0] || r}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={revokeGrants}>
          {t('全部撤销')}
        </button>
      </div>
    ) : null;

  const composer = (
    <Composer
      layout={turns.length === 0 ? 'home' : 'conversation'}
      barControls={<ConversationControls config={config} profiles={settings.keyProfiles} modelsByProfile={Object.fromEntries(settings.keyProfiles.map(p=>[p.id,[...(settings.cachedModels[p.id]||[]),...(settings.customModels[p.id]||[])]]))} onChange={setConfig}/>}
      controls={active?.messages.filter(m=>m.runState?.userQuestion&&!m.runState.userQuestion.answers).map(m=><button className="btn sm" key={m.id} onClick={()=>document.getElementById(`question-${m.runState!.userQuestion!.request.id}`)?.scrollIntoView({block:'center',behavior:'smooth'})}>{t('Answer Question · 回答问题')}</button>)}
      key={active?.id ?? 'new'}
      initialDraft={active?.draft}
      onDraftChange={text => { if (active) updateConv(active.id, c => c.draft === text ? c : { ...c, draft: text }); }}
      client={config.client}
      onClient={client=>setConfig({client,model:client?client.model:models[0]?.id || ''})}
      connectionSettings={settings}
      onConnectionSettings={patch=>setSettings(s=>s?{...s,...patch}:s)}
      contextPreview={profile && !config.client ? { profile,config,history:(active?.messages ?? []).filter(m => !m.pending),
        handoffSourceRunId:active?.handoffSourceRunId,
        extraSystem:[projectSystemBlock(activeProject),skillSystemBlock(activeSkills)].filter(Boolean).join('\n\n'),
        toolNames,mappings:settings.effortMappings,learned:settings.modelLimits?.[limitKey(profile.id,config.model,profile.baseUrl)],
        modelInfo:models.find(m => m.id === config.model), current:busy ? [...(active?.messages ?? [])].reverse().find(m => m.pending)?.contextSnapshot : undefined } : undefined}
      busy={Boolean(busy)}
      disabled={false}
      sendKey={settings.sendKey}
      sendMode={config.toolsEnabled ? "work" : "chat"}
      onSendMode={(mode) => {
        setConfig({ toolsEnabled: mode === 'work' });
        if (mode === 'chat' && busy) {
          busy.handle.abort();
          toast.show(t('已停止后续工具调度，正在保存当前检查点'), 5000);
        } else if (mode === 'work' && active?.messages.length) {
          toast.show(t(busy ? '当前回复会继续完成；下一条消息将带上已有对话，由 Work 接着处理' : '已切换为 Work，已有对话和附件会继续作为上下文'));
        }
      }}
      onSend={(t, mode) => void send(t, undefined, undefined, {toolsEnabled: mode === 'work', text: t, attachments: [...attachments], quotes: [...quotes], quoteOnly, conversationId: active?.id ?? null})}
      onSendNow={t=>{const accepted=sendNow({text:t,attachments:[...attachments],quotes:[...quotes],quoteOnly,conversationId:active?.id??null});if(accepted){setAttachments([]);setQuotes([]);}return accepted;}}
      onSendQueuedNow={i=>{const entry=activeQueue[i];if(entry&&sendNow(entry.item))setQueue(all=>all.filter((_,j)=>j!==entry.index));}}
      onStop={stop}
      stream={config.stream}
      toolCount={toolNames.length}
      quotes={quotes}
      quoteOnly={quoteOnly}
      onQuoteOnly={setQuoteOnly}
      onRemoveQuote={(id) => setQuotes((q) => q.filter((x) => x.id !== id))}
      attachments={attachments}
      onAddAttachments={(m) => void addAttachments(m)}
      onPasteImage={addPastedImage}
      onRemoveAttachment={(id) => setAttachments((p) => p.filter((a) => a.id !== id))}
      onPickWorkspace={() => void pickWorkspace()}
      workspaceCount={settings.tools.workspaceRoots.length}
      canPickLocal={Boolean(desktop())}
      approvalMode={config.approvalMode}
      onApprovalMode={(m: ApprovalMode) => setConfig({ approvalMode: m })}
      profiles={settings.keyProfiles}
      profileId={profile?.id ?? null}
      onProfile={id=>{setConfig({client:undefined});setProfileForConversation(id);}}
      models={models}
      model={config.model}
      onModel={(id) => setConfig({ model: id,client:undefined })}
      modelsLoading={modelsLoading}
      modelsError={modelsError}
      onRefreshModels={() => void refreshModels()}
      onAddModel={addCustomModel}
      modelHealth={settings.modelHealth ?? {}}
      probe={probe}
      onProbe={() => void runProbe()}
      onStopProbe={() => {
        probeStopRef.current = true;
      }}
      onMuteModel={muteModel}
      onRemoveModel={removeCustomModel}
      onClearHealth={clearProfileHealth}
      effortLevel={config.effortLevel}
      onEffortLevel={(l: EffortLevel) => setConfig({ effortLevel: l })}
      effortMappings={settings.effortMappings}
      effortManual={config.thinkingStyle !== 'auto'}
      onOpenMappings={() => {
        const route = profile?.routeProfiles?.[routeKey(profile,config.model)];
        if (route?.effortStyle && route.effortStyle !== 'mapping') { setConfigOpen(true); return; }
        setSettingsOpen(true);
        setSettingsTab('effort');
      }}
      skills={skills}
      activeSkills={activeSkills}
      onPickSkill={(sk) =>
        setActiveSkills((prev) => (prev.some((x) => x.id === sk.id) ? prev : [...prev, sk]))
      }
      onDropSkill={(id) => setActiveSkills((prev) => prev.filter((x) => x.id !== id))}
      projectPrompts={activeProject?.prompts ?? []}
      queued={activeQueue.map(({ item }) => item.text || t('{n} 个附件', { n: item.attachments.length }))}
      queuePaused={queuePaused}
      onResumeQueue={() => { if (activeId) resumeQueue(activeId); }}
      onDropQueued={(i) => { const entry = activeQueue[i]; if (entry) setQueue((q) => q.filter((_, j) => j !== entry.index)); }}
    />
  );

  return (
    <I18nProvider locale={settings.locale ?? 'zh-Hans'}>
    <div className="app">
      {!sidebarHidden ? (
      <aside
        className={`sidebar${sidebarOpen ? ' open' : ''}`}
        style={{ width: sidebarW, flexBasis: sidebarW }}
      >
        <WorkspaceHeader team={teamVisible} platform={platformLabel()} projects={projects}
          projectId={teamVisible ? (settings.collaborationView?.projectId ?? activeProject?.id ?? projects[0]?.id ?? '') : (active?.projectId ?? '')}
          onProject={id => {
            if (teamVisible) setSettings(s => s ? {...s, collaborationView: {visible: true, projectId: id}} : s);
            else if (active) moveToProject(active.id, id || null);
            else if (id) newChat(id);
          }}
          onMode={setTeamVisible}
          onHide={() => { setSidebarOpen(false); setSidebarHidden(true); }} />
        <div className="sidebar-body" hidden={teamVisible}>
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setSidebarOpen(false);
          }}
          onNew={() => newChat(null)}
          onDelete={(id) => {
            if (runningRef.current.has(id)) stop(id);
            releaseRoots(id);
            blockedOnRoots.current.delete(id);
            void forgetRuns(id);
            setConversations((prev) => prev.filter((c) => c.id !== id));
            if (activeId === id) setActiveId(null);
          }}
          onRename={(id, title) => updateConv(id, (c) => ({ ...c, title }))}
          projects={projects}
          onTogglePin={togglePin}
          onFork={(id) => forkConversation(id)}
          onExport={(id) => setExportingId(id)}
          onNewInProject={(pid) => newChat(pid)}
          onOpenWorkspace={(t) => {
            setWorkspaceTab(t);
            setWorkspaceOpen(true);
            setSidebarOpen(false);
          }}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSidebarOpen(false);
          }}
          onOpenObservations={()=>{setObservationsOpen(true);setSidebarOpen(false);}}
        />
        </div>
        <div className="sidebar-body" hidden={!teamVisible} ref={setTeamSidebar} />
      </aside>
      ) : null}

      {!sidebarHidden ? (
        <Resizer
          side="left"
          width={sidebarW}
          min={190}
          max={460}
          onWidth={setSidebarW}
          onDoubleClick={() => setSidebarW(268)}
        />
      ) : null}

      {(sidebarOpen || configOpen) && (
        <div
          className="backdrop"
          onClick={() => {
            setSidebarOpen(false);
            setConfigOpen(false);
          }}
        />
      )}

      {teamVisible ? <div className="team-workspace-container"><React.Suspense fallback={<div className="empty"><BrandLoading label={t('正在打开协作空间…')} /></div>}><TeamWorkspace sidebarTarget={teamSidebar} sidebarHidden={sidebarHidden} onOpenSidebar={()=>{setSidebarHidden(false);setSidebarOpen(true);}} onNavigate={()=>setSidebarOpen(false)} projects={projects} settings={settings} sourceConversation={active} beforeRestore={async()=>{stopAll();await teamRuntime.pauseAll();await saveConversationsNow(conversations);}} onProject={projectId=>setSettings(s=>s?{...s,collaborationView:{visible:true,projectId}}:s)} onSettingsChange={update=>setSettings(prev=>prev?update(prev):prev)} initialProjectId={settings.collaborationView?.projectId??activeProject?.id} onSingle={()=>setTeamVisible(false)} onSettings={()=>{setSettingsTab('keys');setSettingsOpen(true);}} onCreateProject={name=>{const p=makeProject(name);setProjects(all=>[...all,p]);return p.id;}} onHandoff={(text,projectId)=>{const conv=newConversation(settings.defaultConfig,settings.activeKeyProfileId);conv.projectId=projectId;conv.title=titleFrom(text);conv.messages=[{id:uid(),role:'user',content:text,createdAt:Date.now()}];setConversations(all=>[...all,conv]);setActiveId(conv.id);setTeamVisible(false);}}/></React.Suspense></div> : null}
      <main className="main" style={teamVisible?{display:'none'}:undefined}>
        {saveError ? <div className="grant-banner" role="alert">{saveError}<button className="btn sm" onClick={() => { void Promise.all([saveSettings(settings), saveConversationsNow(conversations),saveProjects(projects),saveSkills(skills),saveTasks(tasks)]).then(() => setSaveError(null)).catch(reportSaveError); }}>{t('重试保存')}</button></div> : null}
        <div className="topbar">
          <button className="btn sm ghost only-narrow" title={t('展开侧栏')} onClick={() => { setSidebarHidden(false); setSidebarOpen(true); }}>
            ☰
          </button>
          {sidebarHidden ? (
            <button
              className="btn sm ghost wide-only"
              title={t('展开侧栏（Ctrl+B）')}
              onClick={() => setSidebarHidden(false)}
            >
              ⇥
            </button>
          ) : null}
          <span className="page-title" title={active ? conversationTitle(active.title, t) : undefined}>{active ? conversationTitle(active.title, t) : t('新对话')}</span>
          <span className="spacer" />
          {!profile ? <span className="chip warn">{t('未配置凭据')}</span> : null}
          <span className="chip">{config.model || t('未选模型')}</span>
          <LocaleSwitch onChange={(locale) => setSettings((prev) => (prev ? { ...prev, locale } : prev))} />

          {active && turns.length > 0 ? (
            <button className="btn sm" title={t('把这条对话存成文件')} onClick={() => setExportingId(active.id)}>
              {t('导出')}
            </button>
          ) : null}

          {msgs.some(hasActivity) ? <button className="btn sm" aria-pressed={activityOpen && !configOpen && !openArtifact} onClick={() => { setActivityOpen(!(activityOpen && !configOpen && !openArtifact)); setConfigOpen(false); setOpenArtifact(null); }}>{t('任务动态')}</button> : null}

          <button className="btn sm" onClick={() => setConfigOpen((v) => !v)}>
            {t('⚙ 配置')}
          </button>
        </div>

        {turns.length === 0 ? (
          <div className="hero">
            <BrandLogo size={48} label="wickrunAI" />
            <h1 className="hero-title">{t(active?.handoffKey ? '审阅交接内容' : '问点什么')}</h1>
            <p className="hero-sub">
              {t(active?.handoffKey ? '新对话已准备好，由你决定下一步。' : '会自己联网查证、读你本地的文件、翻 Chrome 里的页面，答案里带可点的来源编号。')}
            </p>
            <div className="hero-box">
              {active?.handoffKey ? <section className="recovery-card" aria-label={t('交接草稿')}>
                <strong>{t('交接草稿 · 尚未发送')}</strong>
                <p>{t('上下文已填入下方输入框，可以编辑、保留或发送。原任务没有被交接动作停止；请先查看其最新进度，避免同时重复执行。')}</p>
                <button className="btn sm" onClick={() => { if (active.forkedFrom) setActiveId(active.forkedFrom); }}>{t('查看原任务')}</button>
              </section> : null}
              {grantBanner}
              {composer}
            </div>
            {!active?.handoffKey ? <div className="hero-examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="example-chip" onClick={() => void send(t(e))}>
                  {t(e)}
                </button>
              ))}
            </div> : null}
          </div>
        ) : (
          <>
            <div className="messages" ref={scrollRef}>
              <div className="messages-inner">
                {turns.map((turn, i) => (
                  <AnswerBlock
                    key={(turn.a ?? turn.q)!.id}
                    question={turn.q}
                    answer={turn.a}
                    gatewayProfile={profile}
                    claudeConnection={config.client?.kind==='claude'}
                    onGatewayReady={r=>{if(r.baseUrl && profile)setSettings(s=>s?{...s,keyProfiles:s.keyProfiles.map(p=>p.id===profile.id && p.baseUrl===profile.baseUrl?{...p,baseUrl:r.baseUrl!}:p)}:s);}}
                    showReasoning={settings.showReasoningByDefault}
                    onOpenArtifact={setOpenArtifact}
                    onArtifactSaved={(artifact) => {
                      if (active && turn.a) updateConv(active.id, (c) => ({ ...c, messages: c.messages.map((m) => m.id === turn.a!.id
                        ? { ...m, artifacts: [...(m.artifacts ?? []).filter((a) => a.path !== artifact.path), artifact] } : m) }));
                    }}
                    onCopy={(text) => {
                      void navigator.clipboard.writeText(text);
                      toast.show(t('已复制'));
                    }}
                    onRetry={
                      busy || !turn.q
                        ? undefined
                        : () => void send(turn.q!.content, turn.qIndex)
                    }
                    onProbe={busy ? undefined : () => void runRequestProbe(turn.a ?? undefined)}
                    onSkillOutcome={(recordId,done)=>{
                      // skillNames 挂在用户那条消息上，不在 RunRecord 顶层
                      const names=runRecord(recordId)?.question.skillNames??[];
                      if(names.length)setSkills(prev=>recordSkillOutcome(prev,names,done));
                    }}
                    onCorrection={async(recordId,kind,note)=>{
                      /*
                       * 纠错分流：知识缺口进项目记忆，流程问题进项目规范。
                       * 改错地方的纠错不会起作用 —— 流程问题塞进知识库，下次照样犯。
                       * 写的是原话加来源，不做改写：改写过的就不是用户说的了。
                       */
                      const rec=runRecord(recordId);
                      const project=projects.find(p=>p.id===rec?.projectId);
                      if(!project){toast.show(t('这个任务不属于任何项目，纠错没有可写入的地方'));return t('（没有写入）');}
                      const stamp=new Date().toLocaleString('zh-CN',{hour12:false});
                      const title=(rec?.question.content??'').trim().replace(/\s+/g,' ').slice(0,60);
                      const line=`[${stamp}] 纠错（来自任务「${title}」）：${note}`;
                      const patch=kind==='knowledge'
                        ?{memory:`${project.memory.trimEnd()}\n\n${line}`.trim()}
                        :{instructions:`${project.instructions.trimEnd()}\n\n${line}`.trim()};
                      setProjects(all=>all.map(p=>p.id===project.id?{...p,...patch}:p));
                      return kind==='knowledge'?t('项目记忆'):t('项目规范');
                    }}
                    onReplay={busy?undefined:(recordId)=>{
                      const question=runRecord(recordId)?.question.content;
                      if(question)void send(question);
                    }}
                    onResume={busy || !turn.a?.runState ? undefined : () => resumeRun(turn.a!)}
                    onCompact={busy || config.client || !turn.a?.runState ? undefined : () => resumeRun(turn.a!, undefined, undefined, true)}
                    onHandoff={!turn.a ? undefined : () => openContextHandoff(turn.a!)}
                    onPauseForContext={turn.a?.pending ? stop : undefined}
                    onResumeWithInput={busy || !turn.a?.runState ? undefined : (text) => resumeRun(turn.a!,undefined,text)}
                    onResolveUncertain={busy || !turn.a?.runState ? undefined : (choice) => resumeRun(turn.a!, choice)}
                    onQuestionSubmit={!turn.a?.runState?.userQuestion ? undefined : (answers) => submitQuestion(turn.a!, answers)}
                    onQuestionDraft={!turn.a?.runState?.userQuestion ? undefined : (draft) => saveQuestionDraft(turn.a!, draft)}
                    onSaveAnnotation={saveAnnotation}
                    onDeleteAnnotation={(messageId, noteId) => changeAnnotation(messageId, noteId)}
                    onEditQuestion={
                      busy || !turn.q ? undefined : (text) => void send(text, turn.qIndex)
                    }
                    onFork={busy ? undefined : () => forkConversation(active!.id, turn.qIndex + (turn.a ? 1 : 0))}
                    onDelete={
                      busy
                        ? undefined
                        : () => {
                            if (!active) return;
                            const drop = new Set<string>();
                            if (turn.q) drop.add(turn.q.id);
                            if (turn.a) drop.add(turn.a.id);
                            void forgetRuns(active.id, drop);
                            updateConv(active.id, (c) => ({
                              ...c,
                              messages: c.messages.filter((m) => !drop.has(m.id)),
                            }));
                          }
                    }
                  />
                ))}
              </div>
            </div>
            {grantBanner}
            {composer}
          </>
        )}
      </main>

      {activityOpen && !teamVisible && !configOpen && !openArtifact ? <ActivityPanel key={`activity-${active?.id}`} messages={msgs} onHide={() => setActivityOpen(false)} /> : null}

      {openArtifact && !teamVisible ? (
        <>
          <Resizer
            side="right"
            width={panelW}
            min={300}
            max={900}
            onWidth={setPanelW}
            onDoubleClick={() => setPanelW(420)}
          />
          <div style={{ width: panelW, flex: `0 0 ${panelW}px`, display: 'flex', minWidth: 0 }}>
            <ErrorBoundary label={t('产物预览')} onReset={() => setOpenArtifact(null)}>
              <ArtifactPanel artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
            </ErrorBoundary>
          </div>
        </>
      ) : null}

      {configOpen && !teamVisible ? (
      <aside className="config-panel open">
        <ConfigPanel
          profile={profile}
          onProfileChange={next => setSettings(prev => prev ? { ...prev,keyProfiles:prev.keyProfiles.map(p => p.id === next.id ? next : p) } : prev)}
          config={config}
          onChange={setConfig}
          models={models}
          modelsLoading={modelsLoading}
          modelsError={modelsError}
          routeOptions={(settings.keyProfiles ?? []).map(p => ({ profileId: p.id, profileName: p.name,
            models: [...(settings.cachedModels[p.id] ?? []), ...(settings.customModels[p.id] ?? [])].map(m => m.id) }))}
          failoverScopes={{ session: config.failover, project: activeProject?.failover, app: settings.failover }}
          failoverProjectName={activeProject?.name}
          failoverScores={routeScoreMap}
          onFailoverChange={(scope: FailoverScope, value: FailoverConfig | undefined) => {
            if (scope === 'session') setConfig({ failover: value });
            else if (scope === 'app') setSettings(prev => prev ? { ...prev, failover: value } : prev);
            else if (activeProject) setProjects(all => all.map(p => p.id === activeProject.id ? { ...p, failover: value } : p));
          }}
          hasKey={Boolean(profile)}
          canRunHostTools={canRunHostTools}
          onRefreshModels={() => void refreshModels()}
          onAddModel={(id) => {
            addCustomModel(id);
            setConfig({ model: id });
          }}
          onPreview={() =>
            setPreview(
              previewBody(
                config,
                t('这里是你输入的问题'),
                toolNames,
                // 跟真正发出去的那份用同一个表达式拼，预览才有意义
                [projectSystemBlock(activeProject), skillSystemBlock(activeSkills)]
                  .filter(Boolean)
                  .join('\n\n'),
              ),
            )
          }
          onRawDump={() => { void (async () => {
            const runId = [...(active?.messages ?? [])].reverse().find((m) => m.runState)?.runState?.runId;
            const bridge = desktop();
            if (bridge?.exchanges) importExchanges(await bridge.exchanges(runId));
            setPreview(formatExchange(failedExchange(runId)));
          })(); }}
          onSaveAsDefault={() => {
            setSettings((s) => (s ? { ...s, defaultConfig: config } : s));
            toast.show(t('已存为新会话的默认配置'));
          }}
        />
      </aside>
      ) : null}

      {workspaceOpen ? (
        <ErrorBoundary label={t('工作区')} onReset={() => setWorkspaceOpen(false)}>
        <WorkspaceDialog
          tab={workspaceTab}
          onTab={setWorkspaceTab}
          onClose={() => setWorkspaceOpen(false)}
          projects={projects}
          onProjects={setProjects}
          skills={skills}
          onSkills={setSkills}
          tasks={tasks}
          onTasks={setTasks}
          profiles={settings.keyProfiles}
          models={models}
          toolCtx={toolContextOf(settings, active?.projectId ?? null)}
          skillSync={settings.skillSync ?? { dir: '', auto: false }}
          onSkillSync={(c) => setSettings((p) => (p ? { ...p, skillSync: c } : p))}
        />
        </ErrorBoundary>
      ) : null}

      {exportingId && conversations.some(c=>c.id===exportingId) ? (
        <React.Suspense fallback={null}>
          <ExportDialog
            conversation={conversations.find(c=>c.id===exportingId)!}
            onClose={()=>setExportingId(null)}
          />
        </React.Suspense>
      ) : null}

      {observationsOpen ? <React.Suspense fallback={<Modal title={t('任务记录与分析')} onClose={()=>setObservationsOpen(false)}><div className="modal-body">{t('正在读取记录…')}</div></Modal>}>
        <ObservationPanel onClose={()=>setObservationsOpen(false)}
          onOpenTask={(conversationId,answerId)=>{setActiveId(conversationId);setObservationsOpen(false);setTimeout(()=>document.getElementById(`msg-${answerId}`)?.scrollIntoView({block:'center'}),150);}}
          evals={evals}
          onSaveCase={recordId=>{
            const rec=runRecord(recordId);
            if(!rec||!evals)return;
            writeEvals({...evals,cases:[...evals.cases,caseFromRecord(rec)]});
            toast.show(t('已存为回归题（先进 dev）'));
          }}
          onSplit={(caseId,split)=>{
            if(!evals)return;
            // 转到 holdout 时把跑过的次数清零：它要重新开始当留出集
            writeEvals({...evals,cases:evals.cases.map(c=>c.id===caseId?{...c,split,uses:split==='holdout'?0:c.uses}:c)});
          }}
          onRunCase={caseId=>{
            const item=evals?.cases.find(c=>c.id===caseId);
            if(!settings||!item)return;
            const conv=newConversation(settings.defaultConfig,settings.activeKeyProfileId);
            conv.title=t('回归题：{title}',{title:item.title});
            conv.evalCaseId=item.id;
            conv.evalConfig=conv.config.model;
            setConversations(all=>[conv,...all]);
            setActiveId(conv.id);
            setObservationsOpen(false);
            setTimeout(()=>{void send(item.task,undefined,undefined,
              {text:'',attachments:[],quotes:[],quoteOnly:false,conversationId:conv.id});},0);
          }}/>
      </React.Suspense>:null}
      {settingsOpen ? (
        <ErrorBoundary label={t('设置')} onReset={() => setSettingsTab('keys')}>
        <SettingsDialog
          tab={settingsTab}
          onTab={setSettingsTab}
          settings={settings}
          onChange={(patch) => setSettings((s) => (s ? { ...s, ...patch } : s))}
          onClose={() => setSettingsOpen(false)}
          encryptionAvailable={info ? info.encryptionAvailable : null}
          storePath={info?.storePath ?? ''}
          onTestProfile={async (p) => {
            const key = await secretGet(p.id);
            if (!key) return t('还没填 API Key');
            try {
              const list = await fetchModels(p, key, 30000);
              setSettings((s) =>
                s ? { ...s, cachedModels: { ...s.cachedModels, [p.id]: list } } : s,
              );
              return t('连上了，拿到 {n} 个模型', { n: list.length });
            } catch (e) {
              return t('失败：{error}', { error: e instanceof Error ? e.message : String(e) });
            }
          }}
        />
        </ErrorBoundary>
      ) : null}

      {preview !== null ? (
        <Modal title={t('请求详情')} onClose={() => setPreview(null)} wide>
          <div className="modal-body">
            <pre
              style={{
                margin: 0,
                fontFamily: 'var(--mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {preview}
            </pre>
          </div>
        </Modal>
      ) : null}

      {confirmReq ? (
        <ToolConfirm
          step={confirmReq.step}
          onResolve={(ok) => {
            confirmReq.resolve(ok);
            setConfirmReq(null);
          }}
        />
      ) : null}

      {grantReq ? (
        <GrantDialog
          req={grantReq.req}
          onDecide={(ok, remember) => {
            grantReq.resolve(ok, remember);
            setGrantReq(null);
          }}
        />
      ) : null}

      {active ? <SelectionActions key={active.id} messages={active.messages}
        onReply={(quote) => { setQuotes((q) => [...q, quote]); setQuoteOnly(true); }}
        onAnnotate={saveAnnotation} /> : null}
      <Toast message={toast.message} />
    </div>
    </I18nProvider>
  );
}
