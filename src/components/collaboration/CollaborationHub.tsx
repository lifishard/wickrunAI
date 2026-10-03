import Icon from '../Icon';
import React from 'react';
import type { AppSettings } from '../../types';
import { useT } from '../../lib/i18n';
import { collaborationCall, publishSharedSeed, shareLink, sharedLinkToken, type SharedItem, type SharedSpace, type SharedConnection, type SharedSeed } from '../../lib/shared-resources';
import SharedWorkflowEditor from './SharedWorkflowEditor';
import ProjectBoards from './ProjectBoards';
import { uploadSharedFile, downloadSharedFile, sharedFileLink, type FileTransferProgress } from '../../lib/shared-files';
import { sharedMessageIdentity,sharedMessageGroups } from '../../lib/message-identity';
import './CollaborationHub.css';

type Role = 'viewer' | 'commenter' | 'editor';
type Opened = { item: SharedItem; role: Role | 'owner'|'admin'; comments: SharedComment[]; events: SharedEvent[]; children?: SharedItem[]; permissions?: { read: boolean; annotatePrivate: boolean; annotateShared: boolean; edit: boolean; postMessage: boolean; manageSharing: boolean } };
type Anchor = { kind: 'resource' | 'message' | 'text' | 'node'; messageId?: string; nodeId?: string; quote?: string; start?: number; end?: number; field?:string; entryId?:string };
type SharedComment = { id: string; authorId: string; authorName?: string; body: string; visibility?: 'private' | 'shared'; anchor?: Anchor; createdAt?: number; at?: number };
type SharedEvent = { id: string; authorId?: string; authorName?: string; actorId?: string; actorName?: string; action?: string; text?: string; body?: string; kind?: string; createdAt?: number; at?: number };
type HistoryEntry = { id: string; actorId: string; actorName?: string; at: number; action: string; revision: number; title: string; payload: Record<string, unknown> };
type HubState = { user?: { id: string; email?: string; name?: string } | null; items: SharedItem[]; spaces: SharedSpace[]; connections: SharedConnection[]; storage?:{usedBytes:number;limitBytes:number;availableBytes:number;plan:string;includesHistory:boolean}|null };
type Tab = 'boards' | 'items' | 'spaces' | 'connections';
type ModelChoice={profileId:string;model:string};
type Props = { initialSource?:{kind:SharedItem['kind'];sourceId:string};onOpenSidebar?:()=>void;sidebarHidden?:boolean;onAccount?:()=>void; settings: AppSettings; seeds: SharedSeed[]; onClose: () => void; onImport?: (item: SharedItem, token?:string) => Promise<string|void>; onHandoff?: (receipt:Record<string,unknown>,target:SharedItem|undefined,connection:SharedConnection)=>Promise<void>; onGenerate?: (item: SharedItem, prompt: string, signal: AbortSignal, choice:ModelChoice) => Promise<string>; onBoardAI?: (prompt:string, system:string, signal:AbortSignal, choice:ModelChoice) => Promise<string> };

const kinds = ['file', 'folder', 'conversation', 'project', 'workflow'] as const;
const kindNames: Record<string, string> = { file: '文件', folder: '文件夹', conversation: '对话', project: '项目', workflow: '工作流', board: '项目看板' };
const roleNames: Record<Role, string> = { viewer: '查看', commenter: '评论', editor: '编辑' };
const visibilityNames = { private: '受限访问', link: '知道链接的人', invite: '受邀的人', team: '空间成员' } as const;
const timestamp = (value?: number) => value ? new Date(value).toLocaleString() : '';
const getString = (object: Record<string, unknown>, key: string) => typeof object[key] === 'string' ? object[key] as string : '';
const getArray = (object: Record<string, unknown>, key: string) => Array.isArray(object[key]) ? object[key] as Record<string, unknown>[] : [];
const defaultPayload = (kind: SharedItem['kind']): Record<string, unknown> => {
  if (kind === 'file') return { name: '', mime: 'text/plain', text: '', size: 0 };
  if (kind === 'folder') return { description: '' };
  if (kind === 'conversation') return { instructions: '', messages: [] };
  if (kind === 'project') return { instructions: '', docs: [], prompts: [] };
  return { description: '', definition: { nodes: [], edges: [] }, agents: [], schedules: [], runs: [] };
};
const errText = (error: unknown) => error instanceof Error ? error.message : String(error);
const linkTokenFromInput=(value:string)=>{
  const input=value.trim();if(/^[\w-]{43}$/.test(input))return input;
  try{const url=new URL(input);return url.protocol==='https:'&&url.hostname==='wickrunai.com'&&url.pathname==='/share'&&/^[\w-]{43}$/.test(url.hash.slice(1))?url.hash.slice(1):'';}catch{return '';}
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="share-field"><span>{label}</span>{children}</label>;
}

function jumpToMessage(id:string){
  const element=[...document.querySelectorAll<HTMLElement>('.share-thread [data-message-id]')].find(node=>node.dataset.messageId===id);
  element?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});element?.focus({preventScroll:true});
}
function SharedMessages({messages,viewerId,onReply,onAnnotate,comments=[]}:{messages:Record<string,unknown>[];viewerId?:string;onReply?:(id:string)=>void;onAnnotate?:(id:string)=>void;comments?:SharedComment[]}){
  const t=useT();
  const list=React.useRef<HTMLDivElement>(null),stick=React.useRef(true);
  const lastMessage=messages.at(-1);
  React.useLayoutEffect(()=>{const node=list.current;if(node&&(stick.current||lastMessage?.authorId===viewerId))node.scrollTop=node.scrollHeight;},[lastMessage?.id,viewerId]);
  return <div ref={list} onScroll={e=>{const node=e.currentTarget;stick.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;}} className="share-thread-list">{messages.length?sharedMessageGroups(messages).map(group=><div key={group.id} className={`share-message-group ${group.paired?'paired':''} ${sharedMessageIdentity(group.messages[0],viewerId).own?'own':''}`} data-message-group={group.id}>{group.messages.map((m,i)=>{
    const identity=sharedMessageIdentity(m,viewerId);
    const name=identity.ai?String(m.model||t('助手')):identity.system?t('系统'):String(m.authorName||t('成员'));
    const parent=messages.find(entry=>entry.id===m.replyTo),annotations=comments.filter(c=>c.anchor?.messageId===m.id);
    return <article tabIndex={-1} key={String(m.id??i)} className={`share-message ${identity.ai?'assistant':''} ${identity.own?'own':''} ${identity.system?'system':''}`}
      style={{'--speaker-color':identity.color} as React.CSSProperties} data-message-id={String(m.id??'')} data-speaker-kind={identity.ai?'ai':identity.system?'system':'human'} data-own={identity.own}>
      <header className="share-message-header"><span className="share-speaker-kind">{identity.ai?'AI':identity.system?t('系统'):t('人类')}</span><strong>{name}</strong>{identity.own?<span className="share-message-you">{t('你')}</span>:null}</header>
      {m.replyTo?<button className="share-reply-quote" disabled={!parent} onClick={()=>jumpToMessage(String(m.replyTo))}><strong>{t('回复')} · {String(parent?.model||parent?.authorName||t('成员'))}</strong><span>{parent?String(parent.content??'').slice(0,240):t('原消息已移除')}</span></button>:null}
      <p data-message-body>{String(m.content??'')}</p><time dateTime={Number(m.createdAt)>0?new Date(Number(m.createdAt)).toISOString():undefined}>{timestamp(Number(m.createdAt??0))}</time>
      {(onReply||onAnnotate)&&<div className="share-message-actions">{onReply&&<button className="btn sm ghost" onClick={()=>onReply(String(m.id))}>{t('回复')}</button>}{onAnnotate&&<button className="btn sm ghost" onClick={()=>onAnnotate(String(m.id))}>{t('添加批注')}</button>}</div>}
      {annotations.map(c=><aside className="share-inline-annotation" key={c.id}><strong>{c.authorName||t('成员')} · {t(c.visibility==='private'?'仅自己可见':'共享注释')}</strong>{c.anchor?.quote&&<blockquote>{c.anchor.quote}</blockquote>}<p>{c.body}</p></aside>)}
    </article>;
  })}</div>):<p className="share-muted">{t('还没有消息。')}</p>}</div>;
}

function HistoryPreview({ entry, kind, viewerId }: { entry: HistoryEntry; kind: SharedItem['kind'];viewerId?:string }) {
  const t = useT();
  const data = entry.payload;
  return <div className="share-history-preview"><h4>{entry.title} · {t('版本')} {entry.revision}</h4>
    {kind === 'file' && <><p>{getString(data, 'name')} · {getString(data, 'mime')}</p><pre>{getString(data, 'text') || t('此版本是可下载的二进制文件。')}</pre></>}
    {kind === 'folder' && <p>{getString(data, 'description')}</p>}
    {kind === 'conversation' && <SharedMessages messages={getArray(data,'messages')} viewerId={viewerId}/>}
    {kind === 'project' && <><p>{getString(data, 'instructions')}</p>{getArray(data, 'docs').map((d, i) => <p key={String(d.id ?? i)}><strong>{String(d.name ?? '')}</strong><br />{String(d.content ?? '')}</p>)}</>}
    {kind === 'workflow' && <><p>{getString(data, 'description')}</p>{getArray((data.definition as Record<string, unknown>) ?? {}, 'nodes').map((n, i) => <p key={String(n.id ?? i)}><strong>{String(n.title ?? '')}</strong><br />{String(n.instructions ?? '')}</p>)}</>}
  </div>;
}

function Thread({ item, role, disabled, onSend, viewerId,onAnnotate,comments,settings,canGenerate,onStop }: { item: SharedItem; role: Role; disabled:boolean; onSend: (content:string,id:string,replyTo?:string,modelChoice?:ModelChoice) => Promise<void>;settings:AppSettings;canGenerate:boolean;onStop?:()=>void;viewerId?:string;onAnnotate?:(id:string)=>void;comments:SharedComment[] }) {
  const t = useT();
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error,setError]=React.useState('');
  const [replyTo,setReplyTo]=React.useState<string>();
  const [selectedModel,setSelectedModel]=React.useState('');
  const models=settings.keyProfiles.flatMap(profile=>{const known=[...(settings.cachedModels[profile.id]??[]),...(settings.customModels[profile.id]??[])].map(m=>m.id);if(profile.id===settings.activeKeyProfileId&&settings.defaultConfig.model)known.push(settings.defaultConfig.model);return [...new Set(known)].map(model=>({profileId:profile.id,model,label:`${model} · ${profile.name}`}));});
  const compose=React.useRef<HTMLTextAreaElement>(null);
  const pending=React.useRef<{content:string;id:string;replyTo?:string;selectedModel:string}|null>(null);
  const messages = getArray(item.payload, 'messages');
  const send = async () => {
    const content = message.trim(); if (!content || busy||disabled) return;
    setBusy(true);setError('');
    if(pending.current?.content!==content||pending.current.replyTo!==replyTo||pending.current.selectedModel!==selectedModel)pending.current={content,id:crypto.randomUUID(),replyTo,selectedModel};
    try { await onSend(content,pending.current.id,replyTo,models.find(model=>JSON.stringify([model.profileId,model.model])===selectedModel)); setMessage('');setReplyTo(undefined);pending.current=null; }
    catch(e){setError(errText(e));}
    finally { setBusy(false); }
  };
  return <section className="share-thread" aria-label={t('共同对话')}>
    <SharedMessages messages={messages} viewerId={viewerId} comments={comments} onReply={role==='editor'?(id)=>{setReplyTo(id);compose.current?.focus();}:undefined} onAnnotate={onAnnotate}/>
    {error&&<p role="alert">{error}</p>}
    {role === 'editor' && <div className="share-compose">{replyTo&&<div className="share-reply-draft"><span>{t('回复')} · {String(messages.find(m=>m.id===replyTo)?.content??t('原消息已移除')).slice(0,180)}</span><button className="btn sm ghost" onClick={()=>setReplyTo(undefined)}>{t('取消回复')}</button></div>}<textarea ref={compose} value={message} onChange={e => setMessage(e.target.value)} placeholder={t('写一条消息')} rows={3} /><label className="share-chat-mode">{t('发送方式')}<select aria-label={t('聊天或 AI 模型')} disabled={busy||disabled} value={selectedModel} onChange={e=>setSelectedModel(e.target.value)}><option value="">{t('聊天 · 不调用 AI')}</option>{canGenerate&&models.map(model=><option key={JSON.stringify([model.profileId,model.model])} value={JSON.stringify([model.profileId,model.model])}>{model.label}</option>)}</select></label><small className="share-muted">{t(selectedModel?'发送你的消息并让所选模型回复；相关对话内容会发送给该模型服务。':'仅发送普通消息，不调用 AI。')}</small>{onStop&&<button className="btn ghost" onClick={onStop}>{t('停止生成')}</button>}<button className="btn primary" disabled={busy ||disabled|| !message.trim()} onClick={() => void send()}>{t('发送')}</button></div>}
  </section>;
}

export default function CollaborationHub({ initialSource,onOpenSidebar,sidebarHidden,onAccount,settings, seeds, onClose, onImport, onHandoff, onGenerate, onBoardAI }: Props) {
  const [showList,setShowList]=React.useState(false);
  const t = useT();
  const appliedSource=React.useRef('');
  const [createOpen,setCreateOpen]=React.useState(Boolean(initialSource));
  const [newEncrypted,setNewEncrypted]=React.useState(true);
  // Projects come first: shared goals, tasks and who confirmed them. Sharing a specific item opens its list.
  const [tab, setTab] = React.useState<Tab>(initialSource ? 'items' : 'boards');
  const [state, setState] = React.useState<HubState>({ items: [], spaces: [], connections: [] });
  const [selectedId, setSelectedId] = React.useState('');
  const [opened, setOpened] = React.useState<Opened | null>(null);
  const [linkedItems, setLinkedItems] = React.useState<SharedItem[]>([]);
  const [token, setToken] = React.useState<string | null>(sharedLinkToken());
  const [createdLink, setCreatedLink] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [payload, setPayload] = React.useState<Record<string, unknown>>({});
  const [dirty, setDirty] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [pendingRemote, setPendingRemote] = React.useState<Opened | null>(null);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [transferProgress,setTransferProgress]=React.useState<FileTransferProgress|null>(null);
  const [newKind, setNewKind] = React.useState<SharedItem['kind']>('file');
  const [newTitle, setNewTitle] = React.useState('');
  const [createWithinCurrent,setCreateWithinCurrent]=React.useState(false);
  const [seedId, setSeedId] = React.useState('');
  const [spaceId, setSpaceId] = React.useState('');
  const [spaceName, setSpaceName] = React.useState('');
  const [spaceKind, setSpaceKind] = React.useState<'personal' | 'company' | 'group'>('group');
  const [spaceMembers,setSpaceMembers]=React.useState<SharedSpace['members']>([]);
  const [newSpaceEmails,setNewSpaceEmails]=React.useState('');
  const [spaceDefaultRole,setSpaceDefaultRole]=React.useState<Role>('viewer');
  const [newSpaceDefaultRole,setNewSpaceDefaultRole]=React.useState<Role>('editor');
  const [groupGrants,setGroupGrants]=React.useState<{spaceId:string;role:Role}[]>([]);
  const [itemSearch,setItemSearch]=React.useState('');
  const [spaceHistory,setSpaceHistory]=React.useState<Record<string,unknown>[]>([]);
  const [policyInvites, setPolicyInvites] = React.useState<{email:string;role:Role}[]>([]);
  const [policyVisibility, setPolicyVisibility] = React.useState<SharedItem['policy']['visibility']>('private');
  const [policyLinkRole, setPolicyLinkRole] = React.useState<Role>('viewer');
  const [policyTeamRole, setPolicyTeamRole] = React.useState<Role>('viewer');
  const [requireSignIn, setRequireSignIn] = React.useState(false);
  const [allowGuestComments, setAllowGuestComments] = React.useState(false);
  const [comment, setComment] = React.useState('');
  const [commentVisibility, setCommentVisibility] = React.useState<'private' | 'shared'>('shared');
  const [commentAnchor, setCommentAnchor] = React.useState<Anchor>({ kind: 'resource' });
  const [editingCommentId, setEditingCommentId] = React.useState('');
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [historyRevision, setHistoryRevision] = React.useState<number | null>(null);
  const [linkInput,setLinkInput]=React.useState('');
  const [pendingAI,setPendingAI]=React.useState<{itemId:string;token?:string;message:{id:string;role:'assistant';content:string;model:string;groupId?:string}}|null>(null);
  const [connectionSource, setConnectionSource] = React.useState('');
  const [connectionTarget, setConnectionTarget] = React.useState('');
  const [connectionTargetLink, setConnectionTargetLink] = React.useState('');
  const [connectionPurpose, setConnectionPurpose] = React.useState('');
  const [sourceAgentId,setSourceAgentId]=React.useState('');
  const [targetAgentId,setTargetAgentId]=React.useState('');
  const [targetPreview,setTargetPreview]=React.useState<SharedItem|null>(null);
  const [handoffGoal, setHandoffGoal] = React.useState('');
  const [handoffSummary,setHandoffSummary]=React.useState('');
  const [handoffFiles,setHandoffFiles]=React.useState<string[]>([]);
  const [handoffs, setHandoffs] = React.useState<Record<string, unknown>[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = React.useState('');
  const live = React.useRef(true);
  const generation = React.useRef<AbortController | null>(null);
  const [generating,setGenerating]=React.useState(false);
  const fileTransfer=React.useRef<AbortController|null>(null);
  const openedRef = React.useRef<Opened | null>(null);
  const dirtyRef = React.useRef(false);
  const handoffRequest=React.useRef<{content:string;key:string}|null>(null);
  React.useEffect(() => { openedRef.current = opened; }, [opened]);
  React.useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  React.useEffect(() => {live.current=true;return () => { live.current = false; generation.current?.abort();fileTransfer.current?.abort(); };}, []);

  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError(errText(e)); } finally { if (live.current) setBusy(false); } };
  const refreshState = React.useCallback(async () => { const next = await collaborationCall<HubState>('state'); if (live.current) setState(next); }, []);
  const applyOpen = (next: Opened, preserveDraft = false, linked=Boolean(token)) => {
    setOpened(next); setSelectedId(next.item.id);
    if (linked) setLinkedItems(current => [...new Map([...current, next.item, ...(next.children ?? [])].map(i => [i.id, i])).values()]);
    if (!preserveDraft) {
      setTitle(next.item.title); setPayload(structuredClone(next.item.payload)); setDirty(false); setConflict(false); setPendingRemote(null);
    }
    setGroupGrants(next.item.groupGrants??[]);setPolicyVisibility(next.item.policy.visibility); setPolicyLinkRole(next.item.policy.linkRole); setPolicyTeamRole(next.item.policy.teamRole ?? 'viewer');
    setAllowGuestComments(Boolean(next.item.policy.allowGuestComments)); setRequireSignIn(Boolean(next.item.policy.requireSignIn));
    setPolicyInvites(structuredClone(next.item.policy.invites ?? []));
    if (!preserveDraft) setHistoryRevision(null);
  };
  const open = React.useCallback(async (itemId?: string, linkToken?: string, preserveDraft = false) => {
    const next = await collaborationCall<Opened>(linkToken && !itemId ? 'openLink' : 'get', linkToken && !itemId ? { token: linkToken } : { itemId, ...(linkToken ? { token: linkToken } : {}) });
    if (!live.current) return;
    if (preserveDraft && openedRef.current?.item.id === next.item.id) {
      if (next.item.revision === openedRef.current.item.revision) {setOpened(next);return;}
      if (dirtyRef.current) { setOpened(current => current ? { ...current, role:next.role,permissions:next.permissions,comments: next.comments, events: next.events } : current); setPendingRemote(next); setConflict(true); return; }
    }
    applyOpen(next,false,Boolean(linkToken));
  }, []);
  React.useEffect(() => { void refreshState().catch(e => setError(errText(e))); if (token) void open(undefined, token).catch(e => setError(errText(e))); }, [refreshState, open]);
  React.useEffect(()=>{
    const changed=()=>{const nextToken=sharedLinkToken();if(!nextToken)return;setToken(nextToken);setLinkedItems([]);setSpaceId('');setCreatedLink('');void open(undefined,nextToken).catch(e=>setError(errText(e)));};
    window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed);
    return()=>{window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed);};
  },[open]);
  React.useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => { if (!busy) void open(selectedId, token ?? undefined, true).catch(e => { const message = errText(e); if ([401,403,404].includes((e as {status?:number}).status??0)||/401|403|revoked|access|permission|not found|unavailable/i.test(message)) { setOpened(null); setSelectedId('');setLinkedItems([]);setToken(null);setHistory([]);setPendingRemote(null);setConflict(false);setError(t('共享访问已失效。')); } }); }, 4000);
    return () => window.clearInterval(timer);
  }, [selectedId, token, open, busy, t]);
  React.useEffect(()=>{
    if(!initialSource||!state.user)return;
    const key=JSON.stringify(initialSource);if(appliedSource.current===key)return;appliedSource.current=key;
    const existing=state.items.find(item=>item.kind===initialSource.kind&&item.sourceId===initialSource.sourceId);
    setTab('items');setSpaceId('');setToken(null);
    if(existing){void open(existing.id).catch(e=>setError(errText(e)));return;}
    const seed=seeds.find(seed=>seed.kind===initialSource.kind&&seed.sourceId===initialSource.sourceId);
    if(seed){setNewKind(seed.kind);setSeedId(seed.sourceId??'');setNewTitle(seed.title);setCreateOpen(true);}else setError(t('此内容无法共享，可能包含管家的私人记录。'));
  },[initialSource,state.user,state.items,seeds,open,t]);
  const item = opened?.item;
  React.useEffect(() => {
    if (!selectedId) { setHistory([]); return; }
    void collaborationCall<{ history: HistoryEntry[] }>('getHistory', { itemId: selectedId, ...(token ? { token } : {}) }).then(result => { if (live.current) setHistory(result.history ?? []); }).catch(() => setHistory([]));
  }, [selectedId, token, item?.revision,opened?.events.length]);
  const role = opened?.role ?? 'viewer';
  const signedIn = Boolean(state.user?.id);
  const canEdit = signedIn && (opened?.permissions?.edit ?? (role === 'editor' || role === 'owner'));
  const canPost = signedIn && (opened?.permissions?.postMessage ?? canEdit);
  const guestCanComment = Boolean(!signedIn && token && (opened?.permissions?.annotateShared ?? (item?.policy.visibility === 'link' && !item.policy.requireSignIn && item.policy.allowGuestComments)));
  const canPrivateComment = Boolean(signedIn && (opened?.permissions?.annotatePrivate ?? role !== 'viewer'));
  const canSharedComment = Boolean(opened?.permissions?.annotateShared ?? ((signedIn && role !== 'viewer') || guestCanComment));
  const canComment = canPrivateComment || canSharedComment;
  const owner = Boolean(signedIn && (role==='owner'||role==='admin'));
  const canManageSharing=owner&&!item?.parentId;
  const patchPayload = (value: Record<string, unknown>) => { setPayload(value); setDirty(true); };
  const save = async (nextPayload = payload, base = item) => {
    if (!base) throw new Error(t('没有选中共享内容。'));
    const result = await collaborationCall<Opened>('update', { itemId: base.id, ...(token ? { token } : {}), expectedRevision: base.revision, title: title.trim() || base.title, payload: nextPayload });
    applyOpen(result); await refreshState(); setNotice(t('已保存到共享项目。'));
    return result;
  };
  const create = async () => {
    const seed = seeds.find(s => s.sourceId === seedId && s.kind === newKind);
    const parentId=createWithinCurrent&&canEdit&&item&&(['project','folder'].includes(item.kind)||item.kind==='conversation'&&['file','folder'].includes(newKind))?item.id:undefined;
    const nextSpaceId=parentId?item?.spaceId:spaceId||undefined;
    const encrypt=Boolean(newEncrypted||parentId&&item?.encryption);
    const result = seed ? await publishSharedSeed(seed, seeds, nextSpaceId,parentId,token??undefined,encrypt) : await collaborationCall<{ item: SharedItem; token?: string }>('create', { kind: newKind, title: newTitle.trim() || kindNames[newKind], payload: defaultPayload(newKind), encrypt, ...(nextSpaceId ? { spaceId:nextSpaceId } : {}),...(parentId?{parentId,parentToken:token}:{} ) });
    await refreshState();if(!parentId){setToken(null);setLinkedItems([]);}await open(result.item.id,parentId?token??undefined:undefined); setCreateOpen(false);setNewTitle(''); setSeedId(''); setCreatedLink(result.token ? shareLink(result.token) : '');
  };
  const savePolicy = async () => {
    if (!item) return;
    const invites = policyInvites.filter(i=>i.email.trim()).map(i=>({email:i.email.trim(),role:i.role}));
    const result = await collaborationCall<{ item: SharedItem; token?: string }>('setPolicy', { itemId: item.id, expectedRevision: item.revision, visibility: policyVisibility, linkRole: policyLinkRole, invites, requireSignIn: policyVisibility === 'link' && requireSignIn, allowGuestComments: policyVisibility === 'link' && !requireSignIn && allowGuestComments, ...(policyVisibility === 'team' ? { teamRole: policyTeamRole } : {}) });
    await open(result.item.id); await refreshState(); setCreatedLink(result.token ? shareLink(result.token) : ''); setNotice(t('访问设置已保存。'));
  };
  const upload = async (file: File) => {
    if(!item||!canEdit)return;
    const controller=new AbortController();fileTransfer.current=controller;
    try {
      const result=await uploadSharedFile(item.id,file,{token:token??undefined,signal:controller.signal,onProgress:value=>{if(live.current)setTransferProgress(value);}});
      if(live.current){patchPayload(result);setNotice(t('文件已上传，请保存修改。'));}
    }finally{fileTransfer.current=null;if(live.current)setTransferProgress(null);}
  };
  const download = async (historical?:HistoryEntry) => {
    if(!item)return;
    const scope={itemId:item.id,...(token?{token}:{})};
    const current=await collaborationCall<Opened>('get',scope);
    let source=current.item;
    if(historical){
      const latest=await collaborationCall<{history:HistoryEntry[]}>('getHistory',scope);
      const version=latest.history.find(entry=>entry.id===historical.id);if(!version)throw Error(t('历史版本已不可访问。'));
      source={...current.item,title:version.title,payload:version.payload};
    }
    const controller=new AbortController();fileTransfer.current=controller;
    try{
      if(source.payload.storage==='r2'&&!source.payload.fileEncryption){
        // Saved straight from storage, so a multi-gigabyte file never has to fit in memory.
        const link=await sharedFileLink(source,{token:token??undefined,signal:controller.signal,historyId:historical?.id});
        if(!live.current)return;
        const a=document.createElement('a');a.href=link.url;a.download=link.name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
        return;
      }
      const blob=await downloadSharedFile(source,{token:token??undefined,signal:controller.signal,historyId:historical?.id,onProgress:value=>{if(live.current)setTransferProgress(value);}});
      if(!live.current)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=getString(source.payload,'name')||source.title;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),3000);
    }finally{fileTransfer.current=null;if(live.current)setTransferProgress(null);}
  };
  const copyLink = async () => { if (!createdLink) return; await navigator.clipboard.writeText(createdLink); setNotice(t('链接已复制。')); };
  const captureSelection = () => {
    const active=document.activeElement;
    const input=active instanceof HTMLTextAreaElement||active instanceof HTMLInputElement?active:null;
    const selection = window.getSelection();
    const quote=input?input.value.slice(input.selectionStart??0,input.selectionEnd??0):selection?.toString();
    if (!quote?.trim()) { setNotice(t('先选中一段文字。')); return; }
    const node = selection?.anchorNode?.parentElement?.closest('[data-message-id]');
    const messageId = node?.getAttribute('data-message-id') || undefined;
    if(input&&!input.dataset.shareField&&item?.kind!=='file'){setNotice(t('请选择共享内容中的文字。'));return;}
    setCommentAnchor({ kind: 'text', quote: quote.slice(0, 1000), ...(messageId ? { messageId } : {}),...(input?{start:input.selectionStart??0,end:Math.min(input.selectionEnd??0,(input.selectionStart??0)+1000),...(input.dataset.shareField?{field:input.dataset.shareField}:{}),...(input.dataset.shareEntry?{entryId:input.dataset.shareEntry}:{})}:{}) });
    setNotice(t('已选中注释位置。'));
  };
  const submitComment = async () => {
    if (!item || !canComment || !comment.trim()) return;
    const input = { itemId: item.id, ...(token ? { token } : {}), body: comment.trim(), visibility: !canPrivateComment ? 'shared' : !canSharedComment ? 'private' : commentVisibility, anchor: commentAnchor };
    if (editingCommentId) await collaborationCall('editComment', { ...input, commentId: editingCommentId });
    else await collaborationCall('comment', input);
    setComment(''); setEditingCommentId(''); setCommentAnchor({ kind: 'resource' });
    await open(item.id, token ?? undefined, true);
  };
  const removeComment = async (commentId: string) => {
    if (!item) return;
    await collaborationCall('deleteComment', { itemId: item.id, commentId, ...(token ? { token } : {}) });
    await open(item.id, token ?? undefined, true);
  };
  const selectedSpace = state.spaces.find(s => s.id === spaceId);
  const canManageSpace=signedIn&&(selectedSpace?.role==='admin'||selectedSpace?.ownerId===state.user?.id);
  React.useEffect(()=>{
    if(!selectedSpace||!canManageSpace){setSpaceHistory([]);return;}
    void collaborationCall<{history:Record<string,unknown>[]}>('getSpaceHistory',{spaceId:selectedSpace.id}).then(r=>{if(live.current)setSpaceHistory(r.history);}).catch(e=>setError(errText(e)));
  },[selectedSpace?.id,selectedSpace?.revision,canManageSpace]);
  const myItems = [...new Map([...state.items, ...linkedItems].filter(i => i.kind !== ('board' as SharedItem['kind']) && (!spaceId || i.spaceId === spaceId || i.groupGrants?.some(g=>g.spaceId===spaceId)) && (!itemSearch.trim()||i.title.toLocaleLowerCase().includes(itemSearch.trim().toLocaleLowerCase()))).map(i => [i.id, i])).values()];
  const openItem = (id: string) => void run(async () => { setShowList(false); const linked = Boolean(token && linkedItems.some(i => i.id === id)); if (!linked) { setToken(null); setLinkedItems([]); } await open(id, linked ? token ?? undefined : undefined); setCreatedLink(''); });
  const currentSeedOptions = seeds.filter(s => s.kind === newKind);
  const allItems=[...new Map([...state.items,...linkedItems].map(i=>[i.id,i])).values()];
  const connectableItems = allItems.filter(i => i.kind === 'project' || i.kind === 'workflow');
  const targetToken = linkTokenFromInput(connectionTargetLink);
  React.useEffect(()=>{
    let active=true;setTargetPreview(null);setTargetAgentId('');
    if(targetToken)void collaborationCall<Opened>('openLink',{token:targetToken}).then(r=>{if(active)setTargetPreview(r.item);}).catch(e=>{if(active)setError(errText(e));});
    return()=>{active=false;};
  },[targetToken]);
  const sourceItem=connectableItems.find(i=>i.id===connectionSource);
  const targetItem=targetPreview??connectableItems.find(i=>i.id===connectionTarget);
  const selectedConnection=state.connections.find(c=>c.id===selectedConnectionId);
  const connectionTargetItem=allItems.find(i=>i.id===selectedConnection?.targetItemId);
  const sourceTree=new Set(selectedConnection?[selectedConnection.sourceItemId]:[]);
  let growing=true;while(growing){growing=false;for(const child of allItems)if(child.parentId&&sourceTree.has(child.parentId)&&!sourceTree.has(child.id)){sourceTree.add(child.id);growing=true;}}
  const handoffFileOptions=allItems.filter(i=>i.kind==='file'&&sourceTree.has(i.id)&&typeof i.payload.text==='string');
  const loadHandoffs=async(id:string)=>{
    const next=await collaborationCall<{receipts:Record<string,unknown>[]}>('listHandoffs',{connectionId:id});
    if(live.current)setHandoffs(next.receipts??[]);
  };
  React.useEffect(()=>{
    setHandoffs([]);setHandoffFiles([]);setHandoffGoal('');setHandoffSummary('');handoffRequest.current=null;
    if(!selectedConnection?.permissions?.readReceipts)return;
    void loadHandoffs(selectedConnection.id).catch(e=>setError(errText(e)));
  },[selectedConnectionId,selectedConnection?.status,selectedConnection?.permissions?.readReceipts]);
  const sendHandoff=async()=>{
    if(!selectedConnection)return;
    const artifacts=handoffFileOptions.filter(f=>handoffFiles.includes(f.id)).map(f=>({name:getString(f.payload,'name')||f.title,mime:getString(f.payload,'mime')||'text/plain',text:getString(f.payload,'text')}));
    const body={goal:handoffGoal.trim(),summary:handoffSummary.trim(),artifacts};
    const content=JSON.stringify(body);if(handoffRequest.current?.content!==content)handoffRequest.current={content,key:crypto.randomUUID()};
    await collaborationCall('sendHandoff',{connectionId:selectedConnection.id,requestKey:handoffRequest.current.key,payload:body});
    setHandoffGoal('');setHandoffSummary('');setHandoffFiles([]);handoffRequest.current=null;
    await loadHandoffs(selectedConnection.id);setNotice(t('交接已发送。接收方可打开草稿。'));
  };
  React.useEffect(()=>{
    if(tab==='items')return;
    const timer=window.setInterval(()=>{if(!busy){void refreshState().catch(()=>{});if(selectedConnection?.permissions?.readReceipts)void loadHandoffs(selectedConnection.id).catch(()=>setHandoffs([]));}},5000);
    return()=>window.clearInterval(timer);
  },[tab,busy,selectedConnectionId,selectedConnection?.permissions?.readReceipts,refreshState]);

  return <div className={`share-hub ${item?(showList?'share-show-list':'share-show-item'):''}`} role="region" aria-label={t('共享与协作')}>
    <header className="share-topbar">{onOpenSidebar&&<button className="btn sm ghost only-narrow share-reveal" title={t('展开侧栏')} aria-label={t('展开侧栏')} onClick={onOpenSidebar}><Icon name="menu" size={18}/></button>}{onOpenSidebar&&sidebarHidden&&<button className="btn sm ghost wide-only share-reveal" title={t('展开侧栏（Ctrl+B）')} aria-label={t('展开侧栏（Ctrl+B）')} onClick={onOpenSidebar}><Icon name="menu" size={18}/></button>}<div><h1>{t('群组与共享')}</h1></div>{onAccount&&<button className="btn ghost" onClick={onAccount}>{t('账号与加密')}</button>}<button className="btn ghost" onClick={onClose} aria-label={t('关闭')}><Icon name="close" size={16}/>{t('关闭')}</button></header>
    <nav className="share-tabs" aria-label={t('协作页面')}>
      {([['boards', '项目'], ['items', '共享内容'], ['spaces', '空间与成员'], ['connections', '工作交接']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>{t(label)}</button>)}
    </nav>
    {error && <div className="share-alert" role="alert">{error}<button className="btn sm ghost" onClick={() => setError('')}>{t('关闭')}</button></div>}
    {notice && <p className="share-notice" role="status">{notice}</p>}
    {transferProgress&&<div className="share-file-progress" role="status"><span>{t(transferProgress.direction==='upload'?'正在上传文件':'正在下载文件')} · {Math.round(transferProgress.total?transferProgress.done/transferProgress.total*100:0)}%</span><progress value={transferProgress.done} max={Math.max(1,transferProgress.total)}/><button className="btn sm ghost" onClick={()=>fileTransfer.current?.abort()}>{t('取消传输')}</button></div>}
    {!state.user && <p className="share-signin">{t('未登录者可查看公开内容；发言、编辑和共享需要登录。')}{typeof window!=='undefined'&&window.snc?<button className="btn sm" onClick={onClose}>{t('返回工作区登录')}</button>:<a className="btn sm" href="/api/auth/google?next=%2Fshare">{t('使用 Google 登录')}</a>}</p>}
    <details className="share-link-open"><summary>{t('打开共享链接')}</summary><form className="share-open-link share-actions" onSubmit={e=>{e.preventDefault();void run(async()=>{const nextToken=linkTokenFromInput(linkInput);if(!nextToken)throw Error(t('共享链接无效。'));await open(undefined,nextToken);setToken(nextToken);setTab('items');setSpaceId('');setLinkInput('');setCreatedLink('');});}}>
      <input aria-label={t('打开共享链接')} value={linkInput} onChange={e=>setLinkInput(e.target.value)} placeholder={t('粘贴共享链接')}/><button className="btn" disabled={busy||!linkInput.trim()}>{t('打开链接')}</button>
    </form></details>
    {pendingAI&&<div className="share-conflict"><p>{t('助手回复已生成，但尚未保存到群聊。')}</p><pre>{pendingAI.message.content}</pre><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const result=await collaborationCall<Opened>('postMessage',{itemId:pendingAI.itemId,...(pendingAI.token?{token:pendingAI.token}:{}),message:pendingAI.message});if(item?.id===pendingAI.itemId)applyOpen(result);setPendingAI(null);await refreshState();})}>{t('重试保存回复')}</button><button className="btn ghost" onClick={()=>setPendingAI(null)}>{t('放弃这条回复')}</button></div>}

    {state.storage&&<details className="share-storage"><summary>{t('云存储空间（共享文件 + 云文件库）')} · {(state.storage.usedBytes/1024/1024).toFixed(1)} MB / {(state.storage.limitBytes/1024/1024/1024).toFixed(0)} GB</summary><progress aria-label={t('已用文件空间')} value={state.storage.usedBytes} max={state.storage.limitBytes}/><p>{t('共享文件与云文件库共用同一份额度，计入上传者，历史版本也占用空间。付费扩容尚未开放。')}</p></details>}
    {tab === 'boards' && <ProjectBoards settings={settings} me={state.user} spaces={state.spaces} items={state.items} onRefresh={refreshState} onAI={onBoardAI}/>}
    {tab === 'items' && <div className="share-layout">
      <aside className="share-rail"><div className="share-rail-head"><h2>{t('共享内容')}</h2>{item&&<button className="btn sm ghost only-narrow" onClick={()=>setShowList(false)}>{t('返回内容')}</button>}<button className="btn sm" onClick={() => void run(refreshState)}>{t('刷新')}</button></div>
        <Field label={t('空间')}><select value={spaceId} onChange={e => setSpaceId(e.target.value)}><option value="">{t('全部空间')}</option>{state.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <input aria-label={t('搜索共享内容')} placeholder={t('搜索共享内容')} value={itemSearch} onChange={e=>setItemSearch(e.target.value)}/><div className="share-item-list">{myItems.map(i => <button key={i.id} className={selectedId === i.id ? 'active' : ''} onClick={() => openItem(i.id)}><span>{t(kindNames[i.kind] ?? i.kind)}</span><strong>{i.title}</strong><small>{timestamp(i.updatedAt)}</small></button>)}{!myItems.length && <p className="share-muted">{t('还没有共享内容。')}</p>}</div>
        {state.user && <details open={createOpen} onToggle={e=>setCreateOpen(e.currentTarget.open)}><summary>{t('创建共享内容')}</summary><form className="share-new" onSubmit={e => { e.preventDefault(); void run(create); }}>
          <h3>{t('创建共享内容')}</h3><Field label={t('类型')}><select value={newKind} onChange={e => { setNewKind(e.target.value as SharedItem['kind']); setSeedId(''); }}>{kinds.map(k => <option key={k} value={k}>{t(kindNames[k])}</option>)}</select></Field>
          {currentSeedOptions.length > 0 && <Field label={t('从现有内容创建')}><select value={seedId} onChange={e => setSeedId(e.target.value)}><option value="">{t('空白内容')}</option>{currentSeedOptions.map(s => <option key={`${s.kind}:${s.sourceId}`} value={s.sourceId}>{s.title}</option>)}</select></Field>}
          <Field label={t('名称')}><input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder={t(kindNames[newKind])} /></Field>
          <label className="share-visibility"><input type="checkbox" checked={newEncrypted||Boolean(createWithinCurrent&&item?.encryption)} disabled={Boolean(createWithinCurrent&&item?.encryption)} onChange={e=>setNewEncrypted(e.target.checked)}/>{t('端到端加密')}</label><p className="share-muted">{t(newEncrypted?'通过群组或邀请共享；成员需先在账号与同步中启用并解锁加密。群名称、成员身份和访问时间仍用于提供服务。':'此副本未端到端加密，可使用公开链接。原有历史记录不会自动转为加密内容。')}</p>
          {canEdit&&item&&(['folder','project'].includes(item.kind)||item.kind==='conversation'&&['file','folder'].includes(newKind))&&<label className="share-visibility"><input type="checkbox" checked={createWithinCurrent} onChange={e=>setCreateWithinCurrent(e.target.checked)}/>{t('放入当前内容')}: {item.title}</label>}
          <button className="btn primary" disabled={busy} type="submit">{t('创建')}</button></form></details>}
      </aside>
      <main className="share-main">{!item ? <div className="share-empty"><h2>{t('选择一项内容')}</h2><p>{t('可以创建共享副本，也可以打开别人发来的链接。')}</p></div> : <>
        <button className="btn sm ghost only-narrow share-list-back" onClick={()=>setShowList(true)}>{t('共享内容')}</button><div className="share-detail-head"><div><h2>{item.title}</h2><small>{t(kindNames[item.kind] ?? item.kind)} · {t(role === 'owner' ? '所有者' : role==='admin'?'空间管理员':roleNames[role])}</small><p>{t(item.encryption?'端到端加密':'未端到端加密')} · {t('更新于')} {timestamp(item.updatedAt)}</p></div><div className="share-actions">{signedIn && onImport && item.kind!=='file'&&<button className="btn" onClick={() => void run(async () => { const message=await onImport(item,token??undefined);await refreshState();setNotice(message||t('已复制到我的工作区。')); })}>{t('复制到我的工作区')}</button>}{item.kind === 'file' && <button className="btn" disabled={busy} onClick={()=>void run(()=>download())}>{t('下载')}</button>}</div></div>
        {item.parentId&&<p className="share-muted">{t('访问权限继承上一级内容。')} <button className="btn sm ghost" onClick={()=>openItem(item.parentId!)}>{t('上一级')}</button></p>}
        {Boolean(opened.children?.length)&&<section className="share-panel"><h3>{t('包含的内容')}</h3><div className="share-cards">{opened.children?.map(child=><button className="share-card" key={child.id} onClick={()=>openItem(child.id)}><small>{t(kindNames[child.kind])}</small><strong>{child.title}</strong></button>)}</div></section>}
        {conflict && <div className="share-conflict" role="alert"><p>{t('这项内容有新版本。你未保存的修改仍在这里。')}</p><button className="btn" onClick={() => { if (pendingRemote) applyOpen(pendingRemote); }}>{t('载入新版本')}</button><button className="btn ghost" onClick={() => { setConflict(false); setPendingRemote(null); }}>{t('继续编辑草稿')}</button></div>}
        <div className="share-detail-tabs"><a href="#share-content">{t('内容')}</a><a href="#share-comments">{t('讨论')}</a>{canManageSharing && <a href="#share-access">{t('访问权限')}</a>}</div>
        <section id="share-content" className="share-panel">{item.kind!=='conversation'&&<h3>{t('内容')}</h3>}{canEdit && item.kind!=='conversation' && <Field label={t('名称')}><input value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }} /></Field>}
          {item.kind === 'file' && <><p className="share-muted">{getString(payload, 'name') || item.title} · {getString(payload, 'mime') || 'text/plain'} · {String(payload.size ?? 0)} B</p>{canEdit && <Field label={t('上传文件（最多 5 GB，加密项目 100 MB）')}><input type="file" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value=''; if (file) void run(() => upload(file)); }} /></Field>}{!getString(payload, 'data') && !getString(payload,'blobId') && <Field label={t('文件内容')}><textarea rows={12} value={getString(payload, 'text')} onChange={e => patchPayload({ ...payload, text: e.target.value, size: new Blob([e.target.value]).size })} readOnly={!canEdit} /></Field>}{Boolean(getString(payload, 'data') || getString(payload,'blobId')) && <p className="share-muted">{t('二进制文件可以下载或重新上传。')}</p>}</>}
          {item.kind === 'folder' && <Field label={t('文件夹说明')}><textarea data-share-field="description" rows={8} value={getString(payload, 'description')} onChange={e => patchPayload({ ...payload, description: e.target.value })} readOnly={!canEdit} /></Field>}
          {item.kind === 'conversation' && <><details className="share-conversation-settings"><summary>{t('对话设置')}</summary>{canEdit&&<Field label={t('名称')}><input value={title} onChange={e=>{setTitle(e.target.value);setDirty(true);}}/></Field>}<Field label={t('对话说明')}><textarea data-share-field="instructions" rows={4} value={getString(payload, 'instructions')} onChange={e => patchPayload({ ...payload, instructions: e.target.value })} readOnly={!canEdit} /></Field></details>
            <Thread key={item.id} item={{ ...item, payload }} settings={settings} canGenerate={Boolean(onGenerate)} onStop={generating?()=>generation.current?.abort():undefined} role={canPost ? 'editor' : 'viewer'} disabled={busy||dirty||conflict} viewerId={state.user?.id} comments={opened.comments} onAnnotate={canComment?(id)=>{setEditingCommentId('');setCommentAnchor({kind:'message',messageId:id});setCommentVisibility(canSharedComment?'shared':'private');document.getElementById('share-comments')?.scrollIntoView({block:'start'});}:undefined} onSend={async(content,id,replyTo,choice)=>{
              setBusy(true);setError('');
              try{
                const result=await collaborationCall<Opened>('postMessage',{itemId:item.id,...(token?{token}:{}),message:{id,role:'user',content,...(replyTo?{replyTo}:{}),...(choice?{groupId:id}:{})}});applyOpen(result);await refreshState();
                if(choice&&onGenerate){const controller=new AbortController();generation.current=controller;setGenerating(true);
                  try{const response=await onGenerate(result.item,content,controller.signal,choice);if(controller.signal.aborted)return;
                    const pending={itemId:item.id,token:token??undefined,message:{id:crypto.randomUUID(),role:'assistant' as const,content:response,model:choice.model,groupId:id}};setPendingAI(pending);
                    const after=await collaborationCall<Opened>('postMessage',{itemId:item.id,...(token?{token}:{}),message:pending.message});setPendingAI(null);applyOpen(after);await refreshState();
                  }catch(e){if(!controller.signal.aborted)setError(errText(e));}finally{generation.current=null;setGenerating(false);}
                }
              }finally{if(live.current)setBusy(false);}
            }}/>

          </>}
          {item.kind === 'project' && <><Field label={t('项目说明')}><textarea data-share-field="instructions" rows={6} value={getString(payload, 'instructions')} onChange={e => patchPayload({ ...payload, instructions: e.target.value })} readOnly={!canEdit} /></Field>{(['docs', 'prompts'] as const).map(key => <section className="share-entries" key={key}><h4>{t(key === 'docs' ? '文档' : '提示词')}</h4>{getArray(payload, key).map((entry, index) => <div className="share-entry" key={String(entry.id ?? index)}><input aria-label={t('名称')} value={String(entry.name ?? '')} readOnly={!canEdit} onChange={e => patchPayload({ ...payload, [key]: getArray(payload, key).map((v, i) => i === index ? { ...v, name: e.target.value } : v) })} /><textarea data-share-field={key === 'docs' ? 'doc' : 'prompt'} data-share-entry={String(entry.id ?? '')} aria-label={t('内容')} rows={4} value={String(entry[key === 'docs' ? 'content' : 'text'] ?? '')} readOnly={!canEdit} onChange={e => patchPayload({ ...payload, [key]: getArray(payload, key).map((v, i) => i === index ? { ...v, [key === 'docs' ? 'content' : 'text']: e.target.value } : v) })} />{canEdit && <button className="btn sm ghost" onClick={() => patchPayload({ ...payload, [key]: getArray(payload, key).filter((_, i) => i !== index) })}>{t('移除')}</button>}</div>)}{canEdit && <button className="btn sm" onClick={() => patchPayload({ ...payload, [key]: [...getArray(payload, key), { id: crypto.randomUUID(), name: '', [key === 'docs' ? 'content' : 'text']: '' }] })}>{t('新增')}</button>}</section>)}</>}
          {item.kind === 'workflow' && <SharedWorkflowEditor payload={payload} onChange={patchPayload} readOnly={!canEdit} />}
          {canEdit && dirty && <div className="share-actions"><button className="btn primary" disabled={busy || conflict} onClick={() => void run(async () => { await save(); })}>{t('保存修改')}</button><button className="btn ghost" onClick={() => { setTitle(item.title); setPayload(structuredClone(item.payload)); setDirty(false); }}>{t('放弃草稿')}</button></div>}
        </section>
        <section id="share-comments" className="share-panel">
          <h3>{t('讨论与注释')}</h3>
          <p className="share-muted">{t('注释独立于对话与助手上下文，不会进入项目记忆。')}</p>
          {opened.comments.map(c => <article className="share-comment" key={c.id}>
            <div><strong>{c.authorName || c.authorId || t('访客')}</strong><time>{timestamp(c.createdAt ?? c.at)}</time></div>
            <small>{t(c.visibility === 'private' ? '仅自己可见' : '共享注释')}</small>
            {c.anchor?.kind !== 'resource' && c.anchor && <p className="share-anchor">{c.anchor.messageId&&<button className="btn sm ghost" onClick={()=>jumpToMessage(c.anchor!.messageId!)}>{t('查看原消息')}</button>}{c.anchor.kind === 'message' ? t('对话消息') : c.anchor.kind === 'node' ? t('流程步骤') : t('选中文字')} · {c.anchor.quote || c.anchor.messageId || c.anchor.nodeId || ''}</p>}
            <p>{c.body}</p>
            {signedIn && (c.authorId === state.user?.id || (owner && c.visibility !== 'private')) && <div className="share-actions">{c.authorId === state.user?.id && <button className="btn sm ghost" onClick={() => { setEditingCommentId(c.id); setComment(c.body); setCommentVisibility(c.visibility ?? 'shared'); setCommentAnchor(c.anchor ?? { kind: 'resource' }); }}>{t('修改')}</button>}<button className="btn sm ghost" onClick={() => void run(() => removeComment(c.id))}>{t('删除')}</button></div>}
          </article>)}
          {!opened.comments.length && <p className="share-muted">{t('还没有评论。')}</p>}
          {canComment && <div className="share-compose">
            <Field label={t('注释位置')}><select value={`${commentAnchor.kind}:${commentAnchor.messageId ?? commentAnchor.nodeId ?? ''}`} onChange={e => { const separator = e.target.value.indexOf(':'); const kind = e.target.value.slice(0, separator); const id = e.target.value.slice(separator + 1); setCommentAnchor(kind === 'message' ? { kind: 'message', messageId: id } : kind === 'node' ? { kind: 'node', nodeId: id } : { kind: 'resource' }); }}><option value="resource:">{t('整项内容')}</option>{item.kind === 'conversation' && getArray(payload, 'messages').map((m, i) => <option key={String(m.id ?? i)} value={`message:${String(m.id ?? '')}`}>{t('对话消息')} {i + 1}: {String(m.content ?? '').slice(0, 40)}</option>)}{item.kind === 'workflow' && getArray((payload.definition as Record<string, unknown>) ?? {}, 'nodes').map((n, i) => <option key={String(n.id ?? i)} value={`node:${String(n.id ?? '')}`}>{t('流程步骤')} {i + 1}: {String(n.title ?? '')}</option>)}{commentAnchor.kind === 'text' && <option value="text:">{t('选中文字')}: {commentAnchor.quote?.slice(0, 40)}</option>}</select></Field>
            <button className="btn sm ghost" onMouseDown={e=>e.preventDefault()} onClick={captureSelection}>{t('注释选中文字')}</button>
            {canPrivateComment && canSharedComment && <label className="share-visibility"><input type="checkbox" checked={commentVisibility === 'private'} onChange={e => setCommentVisibility(e.target.checked ? 'private' : 'shared')} />{t('仅自己可见')}</label>}
            <p className="share-muted">{t(commentVisibility==='private'?'这条批注仅自己可见。':item.policy.visibility==='team'?'这条批注对全空间成员可见。':'这条批注对有权查看此内容的人可见。')}</p><textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder={t('写一条评论')} />
            <div className="share-actions"><button className="btn primary" disabled={busy || !comment.trim()} onClick={() => void run(submitComment)}>{t(editingCommentId ? '保存注释' : '发布评论')}</button>{editingCommentId && <button className="btn ghost" onClick={() => { setEditingCommentId(''); setComment(''); }}>{t('取消')}</button>}</div>
          </div>}
        </section>
        {canManageSharing && <section id="share-access" className="share-panel"><h3>{t('访问权限')}</h3>
          {state.spaces.some(s=>s.kind==='group')&&<fieldset className="share-group-picker"><legend>{t('分享到群组')}</legend><p className="share-muted">{t('多群共用同一份内容，文件不重复计算额度。')}</p>{state.spaces.filter(s=>s.kind==='group').map(group=>{const grant=groupGrants.find(g=>g.spaceId===group.id);return <div className="share-actions" key={group.id}><label><input type="checkbox" checked={Boolean(grant)} onChange={e=>setGroupGrants(current=>e.target.checked?[...current,{spaceId:group.id,role:group.defaultRole}]:current.filter(g=>g.spaceId!==group.id))}/>{group.name}</label>{grant&&<select aria-label={`${group.name} ${t('权限')}`} value={grant.role} onChange={e=>setGroupGrants(current=>current.map(g=>g.spaceId===group.id?{...g,role:e.target.value as Role}:g))}>{Object.entries(roleNames).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select>}</div>;})}<button className="btn" disabled={busy} onClick={()=>void run(async()=>{const next=await collaborationCall<Opened>('setGroups',{itemId:item.id,expectedRevision:item.revision,groups:groupGrants});applyOpen(next);await refreshState();setNotice(t('共享群组已更新。'));})}>{t('保存共享群组')}</button></fieldset>}
          <div className="share-two"><Field label={t('谁可以访问')}><select value={policyVisibility} onChange={e => setPolicyVisibility(e.target.value as SharedItem['policy']['visibility'])}>{Object.entries(visibilityNames).filter(([key])=>!item.encryption||key!=='link').map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></Field>{policyVisibility === 'link' && <Field label={t('链接访问权限')}><select value={policyLinkRole} onChange={e => setPolicyLinkRole(e.target.value as Role)}>{Object.entries(roleNames).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></Field>}{policyVisibility === 'team' && <Field label={t('空间成员权限')}><select value={policyTeamRole} onChange={e => setPolicyTeamRole(e.target.value as Role)}>{Object.entries(roleNames).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></Field>}</div>
          {policyVisibility==='invite'&&<div className="share-entries"><h4>{t('受邀人员')}</h4>{policyInvites.map((invite,index)=><div className="share-two" key={index}><input type="email" aria-label={t('邮箱')} value={invite.email} onChange={e=>setPolicyInvites(all=>all.map((v,i)=>i===index?{...v,email:e.target.value}:v))} placeholder="name@example.com"/><div className="share-actions"><select aria-label={t('权限')} value={invite.role} onChange={e=>setPolicyInvites(all=>all.map((v,i)=>i===index?{...v,role:e.target.value as Role}:v))}>{Object.entries(roleNames).map(([key,label])=><option value={key} key={key}>{t(label)}</option>)}</select><button className="btn sm ghost" onClick={()=>setPolicyInvites(all=>all.filter((_,i)=>i!==index))}>{t('移除')}</button></div></div>)}<button className="btn sm" onClick={()=>setPolicyInvites(all=>[...all,{email:'',role:'viewer'}])}>{t('新增邀请')}</button><p className="share-muted">{t('受邀人员需要登录，并使用共享链接。')}</p></div>}
          {policyVisibility === 'link' && <><label className="share-visibility"><input type="checkbox" checked={requireSignIn} onChange={e => { setRequireSignIn(e.target.checked); if (e.target.checked) setAllowGuestComments(false); }} />{t('查看也需要登录')}</label><label className="share-visibility"><input type="checkbox" checked={allowGuestComments} disabled={requireSignIn} onChange={e => setAllowGuestComments(e.target.checked)} />{t('允许未登录访客发表评论')}</label></>}
          <div className="share-actions"><button className="btn primary" disabled={busy} onClick={() => void run(savePolicy)}>{t('保存访问设置')}</button>{createdLink && <button className="btn" onClick={() => void run(copyLink)}>{t('复制链接')}</button>}{item.policy.visibility === 'link' && <button className="btn ghost" disabled={busy} onClick={() => void run(async () => { const next = await collaborationCall<{ item: SharedItem; token?: string }>('setPolicy', { itemId: item.id, expectedRevision: item.revision, visibility: 'link', linkRole: policyLinkRole, invites: item.policy.invites, teamRole: item.policy.teamRole, requireSignIn: item.policy.requireSignIn, allowGuestComments: item.policy.allowGuestComments, rotate: true }); await open(next.item.id); setCreatedLink(next.token ? shareLink(next.token) : ''); })}>{t('更新链接')}</button>}{item.policy.visibility !== 'private' && <button className="btn ghost" disabled={busy} onClick={() => void run(async () => { const next = await collaborationCall<{ item: SharedItem }>('setPolicy', { itemId: item.id, expectedRevision: item.revision, visibility: 'private', linkRole: 'viewer', invites: [], requireSignIn: true, allowGuestComments: false }); await open(next.item.id); setCreatedLink(''); await refreshState(); })}>{t('停止共享')}</button>}</div>{createdLink && <output className="share-link">{createdLink}</output>}<p className="share-muted">{t('链接只在创建或更新时显示，请及时复制。')}</p>
        </section>}
        <details className="share-panel share-history"><summary>{t('变更记录')}</summary>{opened.events.map(e => <p key={e.id}><time>{timestamp(e.at)}</time> · {e.actorName || e.actorId || e.authorName || e.authorId} · {e.action || e.kind || e.text}</p>)}<h4>{t('历史版本')}</h4><div className="share-history-versions">{history.map(h => <button key={h.id} className={`btn sm ${historyRevision === h.revision ? 'primary' : ''}`} onClick={() => setHistoryRevision(historyRevision === h.revision ? null : h.revision)}>{t('版本')} {h.revision} · {timestamp(h.at)} · {h.actorName || h.actorId}</button>)}</div>{historyRevision !== null && history.find(h => h.revision === historyRevision) && <><HistoryPreview entry={history.find(h => h.revision === historyRevision)!} kind={item.kind} viewerId={state.user?.id} />{item.kind==='file'&&<button className="btn sm" disabled={busy} onClick={()=>void run(()=>download(history.find(h=>h.revision===historyRevision)!))}>{t('下载此版本')}</button>}</>}</details>
      </>}</main>
    </div>}

    {tab === 'spaces' && <div className="share-stack">
      <div className="share-section-head"><h2>{t('空间与成员')}</h2><p>{t('创建群组，选择共享内容，并管理成员和管理员。')}</p></div>
      <div className="share-cards">{state.spaces.map(s => <button className={`share-card ${spaceId === s.id ? 'active' : ''}`} key={s.id} onClick={() => { setSpaceId(s.id);setSpaceMembers(structuredClone(s.members));setSpaceDefaultRole(s.defaultRole); }}><small>{t(s.kind==='group'?'群组':s.kind === 'company' ? '公司空间' : '个人空间')}</small><strong>{s.name}</strong><span>{Number(s.billing.seats??s.members.length+1)} {t('位成员')} · {t('免费')}</span></button>)}</div>
      {selectedSpace&&<section className="share-panel"><h3>{selectedSpace.name}</h3><div className="share-actions"><button className="btn" onClick={()=>setTab('items')}>{t('查看共享内容')}</button>{selectedSpace.kind==='group'&&<button className="btn primary" onClick={()=>{setTab('items');setNewKind('conversation');setNewTitle(selectedSpace.name);setSeedId('');setCreateWithinCurrent(false);setCreateOpen(true);}}>{t('新建群聊')}</button>}</div><p className="share-muted">{t('成员可以按空间默认权限访问在这里共享的内容。')}</p>
        {canManageSpace&&<><h4>{t('成员名单')}</h4>{spaceMembers.map((member,index)=><div className="share-two" key={index}><input type="email" aria-label={t('邮箱')} value={member.email} onChange={e=>setSpaceMembers(all=>all.map((v,i)=>i===index?{...v,email:e.target.value}:v))} placeholder="name@example.com"/><div className="share-actions"><select aria-label={t('空间角色')} value={member.role} onChange={e=>setSpaceMembers(all=>all.map((v,i)=>i===index?{...v,role:e.target.value as 'admin'|'member'}:v))}><option value="member">{t('成员')}</option><option value="admin">{t('管理员')}</option></select><button className="btn sm ghost" onClick={()=>setSpaceMembers(all=>all.filter((_,i)=>i!==index))}>{t('移除')}</button></div></div>)}
          <button className="btn sm" onClick={()=>setSpaceMembers(all=>[...all,{email:'',role:'member'}])}>{t('添加成员')}</button>
          <Field label={t('默认内容权限')}><select value={spaceDefaultRole} onChange={e=>setSpaceDefaultRole(e.target.value as Role)}>{Object.entries(roleNames).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></Field>
          <button className="btn primary" disabled={busy} onClick={()=>void run(async()=>{await collaborationCall('setMembers',{spaceId:selectedSpace.id,expectedRevision:selectedSpace.revision,members:spaceMembers.filter(m=>m.email.trim()),defaultRole:spaceDefaultRole});await refreshState();setNotice(t('成员已更新。'));})}>{t('保存成员')}</button>
          <h4>{t('空间变更记录')}</h4>{spaceHistory.map(h=><p key={String(h.id)}><time>{timestamp(Number(h.at))}</time> · {String(h.actorName??h.actorId??'')} · {String(h.action??'')}</p>)}
        </>}
      </section>}
      {state.user&&<form className="share-panel share-create-space" onSubmit={e=>{e.preventDefault();void run(async()=>{await collaborationCall('createSpace',{name:spaceName.trim(),kind:spaceKind,defaultRole:newSpaceDefaultRole,emails:newSpaceEmails.split('\n').map(s=>s.trim()).filter(Boolean)});setSpaceName('');setNewSpaceEmails('');await refreshState();});}}>
        <h3>{t('新建空间')}</h3><div className="share-two"><Field label={t('名称')}><input required value={spaceName} onChange={e=>setSpaceName(e.target.value)}/></Field><Field label={t('类型')}><select value={spaceKind} onChange={e=>setSpaceKind(e.target.value as 'personal'|'company'|'group')}><option value="group">{t('群组')}</option><option value="personal">{t('个人空间')}</option><option value="company">{t('公司空间')}</option></select></Field></div>
        <Field label={t('初始成员邮箱（每行一个）')}><textarea rows={3} value={newSpaceEmails} onChange={e=>setNewSpaceEmails(e.target.value)} placeholder="name@example.com"/></Field>
        <Field label={t('默认内容权限')}><select value={newSpaceDefaultRole} onChange={e=>setNewSpaceDefaultRole(e.target.value as Role)}>{Object.entries(roleNames).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></Field>
        <button className="btn primary" disabled={busy||!spaceName.trim()}>{t('创建空间')}</button><p className="share-muted">{t('目前免费使用；不需要付费席位。')}</p>
      </form>}
    </div>}

    {tab === 'connections' && <div className="share-stack">
      <div className="share-section-head"><h2>{t('工作交接')}</h2><p>{t('连接两个项目或工作流，让它们交换明确的任务与结果。')}</p></div>
      <div className="share-cards">{state.connections.map(c => <button className={`share-card ${selectedConnectionId === c.id ? 'active' : ''}`} key={c.id} onClick={() => setSelectedConnectionId(c.id)}><small>{t(c.status === 'offered' ? '等待接受' : c.status === 'accepted' ? '已连接' : c.status === 'rejected' ? '已拒绝' : '已撤销')}</small><strong>{allItems.find(i => i.id === c.sourceItemId)?.title ?? t('来源工作区')} → {allItems.find(i => i.id === c.targetItemId)?.title ?? t('接收工作区')}</strong><span>{c.purpose}</span></button>)}</div>
      {selectedConnection&&<section className="share-panel"><h3>{t('交接详情')}</h3><p>{selectedConnection.purpose}</p>
        <p className="share-muted">{t('交接只传递填写的目标、说明和选中的文件。双方保留各自的流程与执行权限。')}</p>
        <div className="share-actions">{(['accept','reject','revoke'] as const).map(action=>selectedConnection.permissions?.[action]&&(action!=='revoke'||selectedConnection.status!=='revoked')&&<button key={action} className={`btn ${action==='accept'?'primary':'ghost'}`} disabled={busy} onClick={()=>void run(async()=>{await collaborationCall(`${action}Connection`,{connectionId:selectedConnection.id});await refreshState();})}>{t({accept:'接受连接',reject:'拒绝连接',revoke:'撤销连接'}[action])}</button>)}</div>
        {selectedConnection.permissions?.send&&<div className="share-compose"><Field label={t('交接目标')}><textarea rows={3} maxLength={20000} value={handoffGoal} onChange={e=>setHandoffGoal(e.target.value)}/></Field><Field label={t('交接说明')}><textarea rows={4} maxLength={20000} value={handoffSummary} onChange={e=>setHandoffSummary(e.target.value)}/></Field>
          {!!handoffFileOptions.length&&<fieldset><legend>{t('选择随交接发送的文本文件')}</legend>{handoffFileOptions.map(f=><label className="share-visibility" key={f.id}><input type="checkbox" checked={handoffFiles.includes(f.id)} onChange={e=>setHandoffFiles(all=>e.target.checked?[...all,f.id]:all.filter(id=>id!==f.id))}/>{getString(f.payload,'name')||f.title}</label>)}</fieldset>}
          <button className="btn primary" disabled={busy||!handoffGoal.trim()||handoffFiles.length>20} onClick={()=>void run(sendHandoff)}>{t('发送交接')}</button>
        </div>}
        <h4>{t('交接记录')}</h4>{!handoffs.length&&<p className="share-muted">{t('还没有可查看的交接记录。')}</p>}{handoffs.map((receipt,index)=>{const data=(receipt.payload??{}) as Record<string,unknown>;return <article className="share-comment" key={String(receipt.id??index)}><div><strong>{String(receipt.actorName??receipt.actorId??t('成员'))}</strong><time>{timestamp(Number(receipt.createdAt))}</time></div><h4>{getString(data,'goal')}</h4><p>{getString(data,'summary')}</p>{getArray(data,'artifacts').map((file,i)=><details key={i}><summary>{getString(file,'name')}</summary><pre>{getString(file,'text')}</pre></details>)}{onHandoff&&selectedConnection.permissions?.readReceipts&&<button className="btn sm" disabled={busy} onClick={()=>void run(async()=>{const latest=await collaborationCall<{receipts:Record<string,unknown>[]}>('listHandoffs',{connectionId:selectedConnection.id});const verified=latest.receipts.find(r=>r.id===receipt.id);if(!verified)throw Error(t('交接记录已不可访问。'));await onHandoff(verified,connectionTargetItem,selectedConnection);})}>{t('打开为我的草稿')}</button>}</article>;})}
      </section>}
      {signedIn && <form className="share-panel" onSubmit={e=>{e.preventDefault();void run(async()=>{
        const target=targetToken?await collaborationCall<Opened>('openLink',{token:targetToken}):null;
        const targetItemId=target?.item.id??connectionTarget;
        await collaborationCall('offerConnection',{sourceItemId:connectionSource,targetItemId,...(token&&linkedItems.some(i=>i.id===connectionSource)?{sourceToken:token}:{}),...(targetToken?{targetToken}:{}),...(sourceAgentId?{sourceAgentId}:{}),...(targetAgentId?{targetAgentId}:{}),purpose:connectionPurpose.trim()});
        setConnectionPurpose('');setConnectionTargetLink('');await refreshState();setNotice(t('连接请求已发送，等待接收方接受。'));
      });}}><h3>{t('提出连接')}</h3><div className="share-two"><Field label={t('来源')}><select required value={connectionSource} onChange={e=>{setConnectionSource(e.target.value);setSourceAgentId('');}}><option value="">{t('选择内容')}</option>{connectableItems.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></Field><Field label={t('接收方')}><select value={connectionTarget} disabled={Boolean(targetToken)} onChange={e=>{setConnectionTarget(e.target.value);setTargetAgentId('');}}><option value="">{t('选择内容')}</option>{connectableItems.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></Field></div>
        <Field label={t('或粘贴对方的共享链接')}><input value={connectionTargetLink} onChange={e=>setConnectionTargetLink(e.target.value)} placeholder="https://wickrunai.com/share#…"/></Field>{targetPreview&&<p>{t('接收方')}: {targetPreview.title}</p>}
        <div className="share-two">{sourceItem?.kind==='workflow'&&<Field label={t('来源 Agent')}><select value={sourceAgentId} onChange={e=>setSourceAgentId(e.target.value)}><option value="">{t('整个工作流')}</option>{getArray(sourceItem.payload,'agents').map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}</select></Field>}{targetItem?.kind==='workflow'&&<Field label={t('接收 Agent')}><select value={targetAgentId} onChange={e=>setTargetAgentId(e.target.value)}><option value="">{t('整个工作流')}</option>{getArray(targetItem.payload,'agents').map(a=><option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}</select></Field>}</div>
        <Field label={t('交接用途')}><input required maxLength={2000} value={connectionPurpose} onChange={e=>setConnectionPurpose(e.target.value)}/></Field><button className="btn primary" disabled={busy||!connectionSource||!targetItem||(!connectionTarget&&!targetToken)||connectionSource===targetItem.id||!connectionPurpose.trim()}>{t('提出连接')}</button>
      </form>}
    </div>}
  </div>;
}





