import React from 'react';
import type { AppSettings } from '../../types';
import { useT } from '../../lib/i18n';
import { collaborationCall, publishSharedSeed, shareLink, sharedLinkToken, type SharedItem, type SharedSpace, type SharedConnection, type SharedSeed } from '../../lib/shared-resources';
import SharedWorkflowEditor from './SharedWorkflowEditor';
import './CollaborationHub.css';

type Role = 'viewer' | 'commenter' | 'editor';
type Opened = { item: SharedItem; role: Role | 'owner'|'admin'; comments: SharedComment[]; events: SharedEvent[]; children?: SharedItem[]; permissions?: { read: boolean; annotatePrivate: boolean; annotateShared: boolean; edit: boolean; postMessage: boolean; manageSharing: boolean } };
type Anchor = { kind: 'resource' | 'message' | 'text' | 'node'; messageId?: string; nodeId?: string; quote?: string; start?: number; end?: number };
type SharedComment = { id: string; authorId: string; authorName?: string; body: string; visibility?: 'private' | 'shared'; anchor?: Anchor; createdAt?: number; at?: number };
type SharedEvent = { id: string; authorId?: string; authorName?: string; actorId?: string; actorName?: string; action?: string; text?: string; body?: string; kind?: string; createdAt?: number; at?: number };
type HistoryEntry = { id: string; actorId: string; actorName?: string; at: number; action: string; revision: number; title: string; payload: Record<string, unknown> };
type HubState = { user?: { id: string; email?: string; name?: string } | null; items: SharedItem[]; spaces: SharedSpace[]; connections: SharedConnection[] };
type Tab = 'items' | 'spaces' | 'connections';
type Props = { settings: AppSettings; seeds: SharedSeed[]; onClose: () => void; onImport?: (item: SharedItem, token?:string) => Promise<string|void>; onHandoff?: (receipt:Record<string,unknown>,target?:SharedItem)=>Promise<void>; onGenerate?: (item: SharedItem, prompt: string, signal: AbortSignal) => Promise<string> };

const kinds = ['file', 'folder', 'conversation', 'project', 'workflow'] as const;
const kindNames: Record<string, string> = { file: '文件', folder: '文件夹', conversation: '对话', project: '项目', workflow: '工作流' };
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

function HistoryPreview({ entry, kind }: { entry: HistoryEntry; kind: SharedItem['kind'] }) {
  const t = useT();
  const data = entry.payload;
  return <div className="share-history-preview"><h4>{entry.title} · {t('版本')} {entry.revision}</h4>
    {kind === 'file' && <><p>{getString(data, 'name')} · {getString(data, 'mime')}</p><pre>{getString(data, 'text') || t('此版本是可下载的二进制文件。')}</pre></>}
    {kind === 'folder' && <p>{getString(data, 'description')}</p>}
    {kind === 'conversation' && getArray(data, 'messages').map((m, i) => <p key={String(m.id ?? i)}><strong>{String(m.authorName ?? m.role ?? '')}: </strong>{String(m.content ?? '')}</p>)}
    {kind === 'project' && <><p>{getString(data, 'instructions')}</p>{getArray(data, 'docs').map((d, i) => <p key={String(d.id ?? i)}><strong>{String(d.name ?? '')}</strong><br />{String(d.content ?? '')}</p>)}</>}
    {kind === 'workflow' && <><p>{getString(data, 'description')}</p>{getArray((data.definition as Record<string, unknown>) ?? {}, 'nodes').map((n, i) => <p key={String(n.id ?? i)}><strong>{String(n.title ?? '')}</strong><br />{String(n.instructions ?? '')}</p>)}</>}
  </div>;
}

function Thread({ item, role, disabled, onSend }: { item: SharedItem; role: Role; disabled:boolean; onSend: (content:string,id:string) => Promise<void> }) {
  const t = useT();
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error,setError]=React.useState('');
  const pending=React.useRef<{content:string;id:string}|null>(null);
  const messages = getArray(item.payload, 'messages');
  const send = async () => {
    const content = message.trim(); if (!content || busy||disabled) return;
    setBusy(true);setError('');
    if(pending.current?.content!==content)pending.current={content,id:crypto.randomUUID()};
    try { await onSend(content,pending.current.id); setMessage('');pending.current=null; }
    catch(e){setError(errText(e));}
    finally { setBusy(false); }
  };
  return <section className="share-thread" aria-label={t('共同对话')}>
    <div className="share-thread-list">{messages.length ? messages.map((m, i) => <article key={String(m.id ?? i)} className={`share-message ${m.role === 'assistant' ? 'assistant' : ''}`} data-message-id={String(m.id ?? '')}><strong>{m.authorName ? String(m.authorName) : m.role === 'assistant' ? t('助手') : t('成员')}</strong>{m.role === 'assistant' && m.model ? <span className="share-model">{String(m.model)}</span> : null}<p>{String(m.content ?? '')}</p><small>{timestamp(Number(m.createdAt ?? 0))}</small></article>) : <p className="share-muted">{t('还没有消息。')}</p>}</div>
    {error&&<p role="alert">{error}</p>}
    {role === 'editor' && <div className="share-compose"><textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={t('写一条消息')} rows={3} /><button className="btn primary" disabled={busy ||disabled|| !message.trim()} onClick={() => void send()}>{t('发送')}</button></div>}
  </section>;
}

export default function CollaborationHub({ settings, seeds, onClose, onImport, onHandoff, onGenerate }: Props) {
  const t = useT();
  const [tab, setTab] = React.useState<Tab>('items');
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
  const [newKind, setNewKind] = React.useState<SharedItem['kind']>('file');
  const [newTitle, setNewTitle] = React.useState('');
  const [createWithinCurrent,setCreateWithinCurrent]=React.useState(false);
  const [seedId, setSeedId] = React.useState('');
  const [spaceId, setSpaceId] = React.useState('');
  const [spaceName, setSpaceName] = React.useState('');
  const [spaceKind, setSpaceKind] = React.useState<'personal' | 'company'>('personal');
  const [spaceMembers,setSpaceMembers]=React.useState<SharedSpace['members']>([]);
  const [newSpaceEmails,setNewSpaceEmails]=React.useState('');
  const [spaceDefaultRole,setSpaceDefaultRole]=React.useState<Role>('viewer');
  const [newSpaceDefaultRole,setNewSpaceDefaultRole]=React.useState<Role>('viewer');
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
  const [prompt, setPrompt] = React.useState('');
  const [linkInput,setLinkInput]=React.useState('');
  const [pendingAI,setPendingAI]=React.useState<{itemId:string;token?:string;message:{id:string;role:'assistant';content:string;model:string}}|null>(null);
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
  const openedRef = React.useRef<Opened | null>(null);
  const dirtyRef = React.useRef(false);
  const handoffRequest=React.useRef<{content:string;key:string}|null>(null);
  React.useEffect(() => { openedRef.current = opened; }, [opened]);
  React.useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  React.useEffect(() => {live.current=true;return () => { live.current = false; generation.current?.abort(); };}, []);

  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError(errText(e)); } finally { if (live.current) setBusy(false); } };
  const refreshState = React.useCallback(async () => { const next = await collaborationCall<HubState>('state'); if (live.current) setState(next); }, []);
  const applyOpen = (next: Opened, preserveDraft = false, linked=Boolean(token)) => {
    setOpened(next); setSelectedId(next.item.id);
    if (linked) setLinkedItems(current => [...new Map([...current, next.item, ...(next.children ?? [])].map(i => [i.id, i])).values()]);
    if (!preserveDraft) {
      setTitle(next.item.title); setPayload(structuredClone(next.item.payload)); setDirty(false); setConflict(false); setPendingRemote(null);
    }
    setPolicyVisibility(next.item.policy.visibility); setPolicyLinkRole(next.item.policy.linkRole); setPolicyTeamRole(next.item.policy.teamRole ?? 'viewer');
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
    const result = seed ? await publishSharedSeed(seed, seeds, nextSpaceId,parentId,token??undefined) : await collaborationCall<{ item: SharedItem; token?: string }>('create', { kind: newKind, title: newTitle.trim() || kindNames[newKind], payload: defaultPayload(newKind), ...(nextSpaceId ? { spaceId:nextSpaceId } : {}),...(parentId?{parentId,parentToken:token}:{} ) });
    await refreshState();if(!parentId){setToken(null);setLinkedItems([]);}await open(result.item.id,parentId?token??undefined:undefined); setNewTitle(''); setSeedId(''); setCreatedLink(result.token ? shareLink(result.token) : '');
  };
  const savePolicy = async () => {
    if (!item) return;
    const invites = policyInvites.filter(i=>i.email.trim()).map(i=>({email:i.email.trim(),role:i.role}));
    const result = await collaborationCall<{ item: SharedItem; token?: string }>('setPolicy', { itemId: item.id, expectedRevision: item.revision, visibility: policyVisibility, linkRole: policyLinkRole, invites, requireSignIn: policyVisibility === 'link' && requireSignIn, allowGuestComments: policyVisibility === 'link' && !requireSignIn && allowGuestComments, ...(policyVisibility === 'team' ? { teamRole: policyTeamRole } : {}) });
    await open(result.item.id); await refreshState(); setCreatedLink(result.token ? shareLink(result.token) : ''); setNotice(t('访问设置已保存。'));
  };
  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) throw new Error(t('文件不能超过 5 MB。'));
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
    patchPayload({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data: base64 });
  };
  const download = () => {
    if (!item) return;
    const data = getString(item.payload, 'data');
    const text = getString(item.payload, 'text');
    const bytes = data ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new TextEncoder().encode(text);
    const url = URL.createObjectURL(new Blob([bytes], { type: getString(item.payload, 'mime') || 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = getString(item.payload, 'name') || item.title; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  const copyLink = async () => { if (!createdLink) return; await navigator.clipboard.writeText(createdLink); setNotice(t('链接已复制。')); };
  const captureSelection = () => {
    const active=document.activeElement;
    const input=active instanceof HTMLTextAreaElement||active instanceof HTMLInputElement?active:null;
    const selection = window.getSelection();
    const quote=input?input.value.slice(input.selectionStart??0,input.selectionEnd??0).trim():selection?.toString().trim();
    if (!quote) { setNotice(t('先选中一段文字。')); return; }
    const node = selection?.anchorNode?.parentElement?.closest('[data-message-id]');
    const messageId = node?.getAttribute('data-message-id') || undefined;
    setCommentAnchor({ kind: 'text', quote: quote.slice(0, 1000), ...(messageId ? { messageId } : {}),...(input?{start:input.selectionStart??0,end:Math.min(input.selectionEnd??0,(input.selectionStart??0)+1000)}:{}) });
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
  const myItems = [...new Map([...state.items, ...linkedItems].filter(i => !spaceId || i.spaceId === spaceId).map(i => [i.id, i])).values()];
  const openItem = (id: string) => void run(async () => { const linked = Boolean(token && linkedItems.some(i => i.id === id)); if (!linked) { setToken(null); setLinkedItems([]); } await open(id, linked ? token ?? undefined : undefined); setCreatedLink(''); });
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

  return <div className="share-hub" role="dialog" aria-modal="true" aria-label={t('共享与协作')}>
    <header className="share-topbar"><div><small>{t('一起完成工作')}</small><h1>{t('共享与协作')}</h1></div><button className="btn ghost" onClick={onClose} aria-label={t('关闭')}>{t('关闭')}</button></header>
    <nav className="share-tabs" aria-label={t('协作页面')}>
      {([['items', '共享内容'], ['spaces', '空间与成员'], ['connections', '工作交接']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>{t(label)}</button>)}
    </nav>
    {error && <div className="share-alert" role="alert">{error}<button className="btn sm ghost" onClick={() => setError('')}>{t('关闭')}</button></div>}
    {notice && <p className="share-notice" role="status">{notice}</p>}
    {!state.user && <p className="share-signin">{t('未登录者可查看公开内容；发言、编辑和共享需要登录。')}{typeof window!=='undefined'&&window.snc?<button className="btn sm" onClick={onClose}>{t('返回工作区登录')}</button>:<a className="btn sm" href="/api/auth/google?next=%2Fshare">{t('使用 Google 登录')}</a>}</p>}
    <form className="share-open-link share-actions" onSubmit={e=>{e.preventDefault();void run(async()=>{const nextToken=linkTokenFromInput(linkInput);if(!nextToken)throw Error(t('共享链接无效。'));await open(undefined,nextToken);setToken(nextToken);setTab('items');setSpaceId('');setLinkInput('');setCreatedLink('');});}}>
      <input aria-label={t('打开共享链接')} value={linkInput} onChange={e=>setLinkInput(e.target.value)} placeholder={t('粘贴共享链接')}/><button className="btn" disabled={busy||!linkInput.trim()}>{t('打开链接')}</button>
    </form>
    {pendingAI&&<div className="share-conflict"><p>{t('助手回复已生成，但尚未保存到群聊。')}</p><pre>{pendingAI.message.content}</pre><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const result=await collaborationCall<Opened>('postMessage',{itemId:pendingAI.itemId,...(pendingAI.token?{token:pendingAI.token}:{}),message:pendingAI.message});if(item?.id===pendingAI.itemId)applyOpen(result);setPendingAI(null);await refreshState();})}>{t('重试保存回复')}</button><button className="btn ghost" onClick={()=>setPendingAI(null)}>{t('放弃这条回复')}</button></div>}

    {tab === 'items' && <div className="share-layout">
      <aside className="share-rail"><div className="share-rail-head"><h2>{t('共享内容')}</h2><button className="btn sm" onClick={() => void run(refreshState)}>{t('刷新')}</button></div>
        <Field label={t('空间')}><select value={spaceId} onChange={e => setSpaceId(e.target.value)}><option value="">{t('全部空间')}</option>{state.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <div className="share-item-list">{myItems.map(i => <button key={i.id} className={selectedId === i.id ? 'active' : ''} onClick={() => openItem(i.id)}><span>{t(kindNames[i.kind] ?? i.kind)}</span><strong>{i.title}</strong><small>{timestamp(i.updatedAt)}</small></button>)}{!myItems.length && <p className="share-muted">{t('还没有共享内容。')}</p>}</div>
        {state.user && <form className="share-new" onSubmit={e => { e.preventDefault(); void run(create); }}>
          <h3>{t('创建共享内容')}</h3><Field label={t('类型')}><select value={newKind} onChange={e => { setNewKind(e.target.value as SharedItem['kind']); setSeedId(''); }}>{kinds.map(k => <option key={k} value={k}>{t(kindNames[k])}</option>)}</select></Field>
          {currentSeedOptions.length > 0 && <Field label={t('从现有内容创建')}><select value={seedId} onChange={e => setSeedId(e.target.value)}><option value="">{t('空白内容')}</option>{currentSeedOptions.map(s => <option key={`${s.kind}:${s.sourceId}`} value={s.sourceId}>{s.title}</option>)}</select></Field>}
          <Field label={t('名称')}><input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder={t(kindNames[newKind])} /></Field>
          {canEdit&&item&&(['folder','project'].includes(item.kind)||item.kind==='conversation'&&['file','folder'].includes(newKind))&&<label className="share-visibility"><input type="checkbox" checked={createWithinCurrent} onChange={e=>setCreateWithinCurrent(e.target.checked)}/>{t('放入当前内容')}: {item.title}</label>}
          <button className="btn primary" disabled={busy} type="submit">{t('创建')}</button></form>}
      </aside>
      <main className="share-main">{!item ? <div className="share-empty"><h2>{t('选择一项内容')}</h2><p>{t('可以创建共享副本，也可以打开别人发来的链接。')}</p></div> : <>
        <div className="share-detail-head"><div><small>{t(kindNames[item.kind] ?? item.kind)} · {t(role === 'owner' ? '所有者' : role==='admin'?'空间管理员':roleNames[role])}</small><h2>{item.title}</h2><p>{t('更新于')} {timestamp(item.updatedAt)}</p></div><div className="share-actions">{signedIn && onImport && item.kind!=='file'&&<button className="btn" onClick={() => void run(async () => { const message=await onImport(item,token??undefined);await refreshState();setNotice(message||t('已复制到我的工作区。')); })}>{t('复制到我的工作区')}</button>}{item.kind === 'file' && <button className="btn" onClick={download}>{t('下载')}</button>}</div></div>
        {item.parentId&&<p className="share-muted">{t('访问权限继承上一级内容。')} <button className="btn sm ghost" onClick={()=>openItem(item.parentId!)}>{t('上一级')}</button></p>}
        {Boolean(opened.children?.length)&&<section className="share-panel"><h3>{t('包含的内容')}</h3><div className="share-cards">{opened.children?.map(child=><button className="share-card" key={child.id} onClick={()=>openItem(child.id)}><small>{t(kindNames[child.kind])}</small><strong>{child.title}</strong></button>)}</div></section>}
        {conflict && <div className="share-conflict" role="alert"><p>{t('这项内容有新版本。你未保存的修改仍在这里。')}</p><button className="btn" onClick={() => { if (pendingRemote) applyOpen(pendingRemote); }}>{t('载入新版本')}</button><button className="btn ghost" onClick={() => { setConflict(false); setPendingRemote(null); }}>{t('继续编辑草稿')}</button></div>}
        <div className="share-detail-tabs"><a href="#share-content">{t('内容')}</a><a href="#share-comments">{t('讨论')}</a>{canManageSharing && <a href="#share-access">{t('访问权限')}</a>}</div>
        <section id="share-content" className="share-panel"><h3>{t('内容')}</h3>{canEdit && <Field label={t('名称')}><input value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }} /></Field>}
          {item.kind === 'file' && <><p className="share-muted">{getString(payload, 'name') || item.title} · {getString(payload, 'mime') || 'text/plain'} · {String(payload.size ?? 0)} B</p>{canEdit && <Field label={t('上传文件（最多 5 MB）')}><input type="file" onChange={e => { const file = e.target.files?.[0]; if (file) void run(() => upload(file)); }} /></Field>}{!getString(payload, 'data') && <Field label={t('文件内容')}><textarea rows={12} value={getString(payload, 'text')} onChange={e => patchPayload({ ...payload, text: e.target.value, size: new Blob([e.target.value]).size })} readOnly={!canEdit} /></Field>}{getString(payload, 'data') && <p className="share-muted">{t('二进制文件可以下载或重新上传。')}</p>}</>}
          {item.kind === 'folder' && <Field label={t('文件夹说明')}><textarea rows={8} value={getString(payload, 'description')} onChange={e => patchPayload({ ...payload, description: e.target.value })} readOnly={!canEdit} /></Field>}
          {item.kind === 'conversation' && <><Field label={t('对话说明')}><textarea rows={4} value={getString(payload, 'instructions')} onChange={e => patchPayload({ ...payload, instructions: e.target.value })} readOnly={!canEdit} /></Field>
            <Thread key={item.id} item={{ ...item, payload }} role={canPost ? 'editor' : 'viewer'} disabled={busy||dirty||conflict} onSend={async(content,id)=>{
              setBusy(true);try{const result=await collaborationCall<Opened>('postMessage',{itemId:item.id,...(token?{token}:{}),message:{id,role:'user',content}});applyOpen(result);await refreshState();}finally{if(live.current)setBusy(false);}
            }} />
            {onGenerate && canPost && <div className="share-compose"><small>{t('当前模型')}: {settings.defaultConfig.model||t('未选择')}</small><Field label={t('请助手回复')}><textarea rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} /></Field><div className="share-actions"><button className="btn" disabled={busy||dirty||conflict||!prompt.trim()} onClick={() => void run(async () => {
              const currentPrompt = prompt.trim(); const controller = new AbortController(); generation.current = controller;
              try {
                const afterHuman = await collaborationCall<Opened>('postMessage',{itemId:item.id,...(token?{token}:{}),message:{id:crypto.randomUUID(),role:'user',content:currentPrompt}});applyOpen(afterHuman);
                setPrompt('');
                const response = await onGenerate(afterHuman.item, currentPrompt, controller.signal);
                if (controller.signal.aborted) return;
                const pending={itemId:item.id,token:token??undefined,message:{id:crypto.randomUUID(),role:'assistant' as const,model:settings.defaultConfig.model,content:response}};setPendingAI(pending);
                const afterAI=await collaborationCall<Opened>('postMessage',{itemId:item.id,...(token?{token}:{}),message:pending.message});setPendingAI(null);applyOpen(afterAI);await refreshState();
              } finally { generation.current = null; }
            })}>{t('生成回复')}</button>{generation.current && <button className="btn ghost" onClick={() => generation.current?.abort()}>{t('停止生成')}</button>}</div></div>}
          </>}
          {item.kind === 'project' && <><Field label={t('项目说明')}><textarea rows={6} value={getString(payload, 'instructions')} onChange={e => patchPayload({ ...payload, instructions: e.target.value })} readOnly={!canEdit} /></Field>{(['docs', 'prompts'] as const).map(key => <section className="share-entries" key={key}><h4>{t(key === 'docs' ? '文档' : '提示词')}</h4>{getArray(payload, key).map((entry, index) => <div className="share-entry" key={String(entry.id ?? index)}><input aria-label={t('名称')} value={String(entry.name ?? '')} readOnly={!canEdit} onChange={e => patchPayload({ ...payload, [key]: getArray(payload, key).map((v, i) => i === index ? { ...v, name: e.target.value } : v) })} /><textarea aria-label={t('内容')} rows={4} value={String(entry[key === 'docs' ? 'content' : 'text'] ?? '')} readOnly={!canEdit} onChange={e => patchPayload({ ...payload, [key]: getArray(payload, key).map((v, i) => i === index ? { ...v, [key === 'docs' ? 'content' : 'text']: e.target.value } : v) })} />{canEdit && <button className="btn sm ghost" onClick={() => patchPayload({ ...payload, [key]: getArray(payload, key).filter((_, i) => i !== index) })}>{t('移除')}</button>}</div>)}{canEdit && <button className="btn sm" onClick={() => patchPayload({ ...payload, [key]: [...getArray(payload, key), { id: crypto.randomUUID(), name: '', [key === 'docs' ? 'content' : 'text']: '' }] })}>{t('新增')}</button>}</section>)}</>}
          {item.kind === 'workflow' && <SharedWorkflowEditor payload={payload} onChange={patchPayload} readOnly={!canEdit} />}
          {canEdit && dirty && <div className="share-actions"><button className="btn primary" disabled={busy || conflict} onClick={() => void run(async () => { await save(); })}>{t('保存修改')}</button><button className="btn ghost" onClick={() => { setTitle(item.title); setPayload(structuredClone(item.payload)); setDirty(false); }}>{t('放弃草稿')}</button></div>}
        </section>
        <section id="share-comments" className="share-panel">
          <h3>{t('讨论与注释')}</h3>
          <p className="share-muted">{t('注释独立于对话与助手上下文，不会进入项目记忆。')}</p>
          {opened.comments.map(c => <article className="share-comment" key={c.id}>
            <div><strong>{c.authorName || c.authorId || t('访客')}</strong><time>{timestamp(c.createdAt ?? c.at)}</time></div>
            <small>{t(c.visibility === 'private' ? '仅自己可见' : '共享注释')}</small>
            {c.anchor?.kind !== 'resource' && c.anchor && <p className="share-anchor">{c.anchor.kind === 'message' ? t('对话消息') : c.anchor.kind === 'node' ? t('流程步骤') : t('选中文字')} · {c.anchor.quote || c.anchor.messageId || c.anchor.nodeId || ''}</p>}
            <p>{c.body}</p>
            {signedIn && (c.authorId === state.user?.id || (owner && c.visibility !== 'private')) && <div className="share-actions">{c.authorId === state.user?.id && <button className="btn sm ghost" onClick={() => { setEditingCommentId(c.id); setComment(c.body); setCommentVisibility(c.visibility ?? 'shared'); setCommentAnchor(c.anchor ?? { kind: 'resource' }); }}>{t('修改')}</button>}<button className="btn sm ghost" onClick={() => void run(() => removeComment(c.id))}>{t('删除')}</button></div>}
          </article>)}
          {!opened.comments.length && <p className="share-muted">{t('还没有评论。')}</p>}
          {canComment && <div className="share-compose">
            <Field label={t('注释位置')}><select value={`${commentAnchor.kind}:${commentAnchor.messageId ?? commentAnchor.nodeId ?? ''}`} onChange={e => { const separator = e.target.value.indexOf(':'); const kind = e.target.value.slice(0, separator); const id = e.target.value.slice(separator + 1); setCommentAnchor(kind === 'message' ? { kind: 'message', messageId: id } : kind === 'node' ? { kind: 'node', nodeId: id } : { kind: 'resource' }); }}><option value="resource:">{t('整项内容')}</option>{item.kind === 'conversation' && getArray(payload, 'messages').map((m, i) => <option key={String(m.id ?? i)} value={`message:${String(m.id ?? '')}`}>{t('对话消息')} {i + 1}: {String(m.content ?? '').slice(0, 40)}</option>)}{item.kind === 'workflow' && getArray((payload.definition as Record<string, unknown>) ?? {}, 'nodes').map((n, i) => <option key={String(n.id ?? i)} value={`node:${String(n.id ?? '')}`}>{t('流程步骤')} {i + 1}: {String(n.title ?? '')}</option>)}{commentAnchor.kind === 'text' && <option value="text:">{t('选中文字')}: {commentAnchor.quote?.slice(0, 40)}</option>}</select></Field>
            <button className="btn sm ghost" onMouseDown={e=>e.preventDefault()} onClick={captureSelection}>{t('注释选中文字')}</button>
            {canPrivateComment && canSharedComment && <label className="share-visibility"><input type="checkbox" checked={commentVisibility === 'private'} onChange={e => setCommentVisibility(e.target.checked ? 'private' : 'shared')} />{t('仅自己可见')}</label>}
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder={t('写一条评论')} />
            <div className="share-actions"><button className="btn primary" disabled={busy || !comment.trim()} onClick={() => void run(submitComment)}>{t(editingCommentId ? '保存注释' : '发布评论')}</button>{editingCommentId && <button className="btn ghost" onClick={() => { setEditingCommentId(''); setComment(''); }}>{t('取消')}</button>}</div>
          </div>}
        </section>
        {canManageSharing && <section id="share-access" className="share-panel"><h3>{t('访问权限')}</h3>
          <div className="share-two"><Field label={t('谁可以访问')}><select value={policyVisibility} onChange={e => setPolicyVisibility(e.target.value as SharedItem['policy']['visibility'])}>{Object.entries(visibilityNames).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></Field>{policyVisibility === 'link' && <Field label={t('链接访问权限')}><select value={policyLinkRole} onChange={e => setPolicyLinkRole(e.target.value as Role)}>{Object.entries(roleNames).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></Field>}{policyVisibility === 'team' && <Field label={t('空间成员权限')}><select value={policyTeamRole} onChange={e => setPolicyTeamRole(e.target.value as Role)}>{Object.entries(roleNames).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></Field>}</div>
          {policyVisibility==='invite'&&<div className="share-entries"><h4>{t('受邀人员')}</h4>{policyInvites.map((invite,index)=><div className="share-two" key={index}><input type="email" aria-label={t('邮箱')} value={invite.email} onChange={e=>setPolicyInvites(all=>all.map((v,i)=>i===index?{...v,email:e.target.value}:v))} placeholder="name@example.com"/><div className="share-actions"><select aria-label={t('权限')} value={invite.role} onChange={e=>setPolicyInvites(all=>all.map((v,i)=>i===index?{...v,role:e.target.value as Role}:v))}>{Object.entries(roleNames).map(([key,label])=><option value={key} key={key}>{t(label)}</option>)}</select><button className="btn sm ghost" onClick={()=>setPolicyInvites(all=>all.filter((_,i)=>i!==index))}>{t('移除')}</button></div></div>)}<button className="btn sm" onClick={()=>setPolicyInvites(all=>[...all,{email:'',role:'viewer'}])}>{t('新增邀请')}</button><p className="share-muted">{t('受邀人员需要登录，并使用共享链接。')}</p></div>}
          {policyVisibility === 'link' && <><label className="share-visibility"><input type="checkbox" checked={requireSignIn} onChange={e => { setRequireSignIn(e.target.checked); if (e.target.checked) setAllowGuestComments(false); }} />{t('查看也需要登录')}</label><label className="share-visibility"><input type="checkbox" checked={allowGuestComments} disabled={requireSignIn} onChange={e => setAllowGuestComments(e.target.checked)} />{t('允许未登录访客发表评论')}</label></>}
          <div className="share-actions"><button className="btn primary" disabled={busy} onClick={() => void run(savePolicy)}>{t('保存访问设置')}</button>{createdLink && <button className="btn" onClick={() => void run(copyLink)}>{t('复制链接')}</button>}{item.policy.visibility === 'link' && <button className="btn ghost" disabled={busy} onClick={() => void run(async () => { const next = await collaborationCall<{ item: SharedItem; token?: string }>('setPolicy', { itemId: item.id, expectedRevision: item.revision, visibility: 'link', linkRole: policyLinkRole, invites: item.policy.invites, teamRole: item.policy.teamRole, requireSignIn: item.policy.requireSignIn, allowGuestComments: item.policy.allowGuestComments, rotate: true }); await open(next.item.id); setCreatedLink(next.token ? shareLink(next.token) : ''); })}>{t('更新链接')}</button>}{item.policy.visibility !== 'private' && <button className="btn ghost" disabled={busy} onClick={() => void run(async () => { const next = await collaborationCall<{ item: SharedItem }>('setPolicy', { itemId: item.id, expectedRevision: item.revision, visibility: 'private', linkRole: 'viewer', invites: [], requireSignIn: true, allowGuestComments: false }); await open(next.item.id); setCreatedLink(''); await refreshState(); })}>{t('停止共享')}</button>}</div>{createdLink && <output className="share-link">{createdLink}</output>}<p className="share-muted">{t('链接只在创建或更新时显示，请及时复制。')}</p>
        </section>}
        <section className="share-panel share-history"><h3>{t('变更记录')}</h3>{opened.events.map(e => <p key={e.id}><time>{timestamp(e.at)}</time> · {e.actorName || e.actorId || e.authorName || e.authorId} · {e.action || e.kind || e.text}</p>)}<h4>{t('历史版本')}</h4><div className="share-history-versions">{history.map(h => <button key={h.id} className={`btn sm ${historyRevision === h.revision ? 'primary' : ''}`} onClick={() => setHistoryRevision(historyRevision === h.revision ? null : h.revision)}>{t('版本')} {h.revision} · {timestamp(h.at)} · {h.actorName || h.actorId}</button>)}</div>{historyRevision !== null && history.find(h => h.revision === historyRevision) && <HistoryPreview entry={history.find(h => h.revision === historyRevision)!} kind={item.kind} />}</section>
      </>}</main>
    </div>}

    {tab === 'spaces' && <div className="share-stack">
      <div className="share-section-head"><h2>{t('空间与成员')}</h2><p>{t('个人空间适合自己整理，公司空间可由成员共同管理。')}</p></div>
      <div className="share-cards">{state.spaces.map(s => <button className={`share-card ${spaceId === s.id ? 'active' : ''}`} key={s.id} onClick={() => { setSpaceId(s.id);setSpaceMembers(structuredClone(s.members));setSpaceDefaultRole(s.defaultRole); }}><small>{t(s.kind === 'company' ? '公司空间' : '个人空间')}</small><strong>{s.name}</strong><span>{Number(s.billing.seats??s.members.length+1)} {t('位成员')} · {t('免费')}</span></button>)}</div>
      {selectedSpace&&<section className="share-panel"><h3>{selectedSpace.name}</h3><p className="share-muted">{t('成员可以按空间默认权限访问在这里共享的内容。')}</p>
        {canManageSpace&&<><h4>{t('成员名单')}</h4>{spaceMembers.map((member,index)=><div className="share-two" key={index}><input type="email" aria-label={t('邮箱')} value={member.email} onChange={e=>setSpaceMembers(all=>all.map((v,i)=>i===index?{...v,email:e.target.value}:v))} placeholder="name@example.com"/><div className="share-actions"><select aria-label={t('空间角色')} value={member.role} onChange={e=>setSpaceMembers(all=>all.map((v,i)=>i===index?{...v,role:e.target.value as 'admin'|'member'}:v))}><option value="member">{t('成员')}</option><option value="admin">{t('管理员')}</option></select><button className="btn sm ghost" onClick={()=>setSpaceMembers(all=>all.filter((_,i)=>i!==index))}>{t('移除')}</button></div></div>)}
          <button className="btn sm" onClick={()=>setSpaceMembers(all=>[...all,{email:'',role:'member'}])}>{t('添加成员')}</button>
          <Field label={t('默认内容权限')}><select value={spaceDefaultRole} onChange={e=>setSpaceDefaultRole(e.target.value as Role)}>{Object.entries(roleNames).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></Field>
          <button className="btn primary" disabled={busy} onClick={()=>void run(async()=>{await collaborationCall('setMembers',{spaceId:selectedSpace.id,expectedRevision:selectedSpace.revision,members:spaceMembers.filter(m=>m.email.trim()),defaultRole:spaceDefaultRole});await refreshState();setNotice(t('成员已更新。'));})}>{t('保存成员')}</button>
          <h4>{t('空间变更记录')}</h4>{spaceHistory.map(h=><p key={String(h.id)}><time>{timestamp(Number(h.at))}</time> · {String(h.actorName??h.actorId??'')} · {String(h.action??'')}</p>)}
        </>}
      </section>}
      {state.user&&<form className="share-panel share-create-space" onSubmit={e=>{e.preventDefault();void run(async()=>{await collaborationCall('createSpace',{name:spaceName.trim(),kind:spaceKind,defaultRole:newSpaceDefaultRole,emails:newSpaceEmails.split('\n').map(s=>s.trim()).filter(Boolean)});setSpaceName('');setNewSpaceEmails('');await refreshState();});}}>
        <h3>{t('新建空间')}</h3><div className="share-two"><Field label={t('名称')}><input required value={spaceName} onChange={e=>setSpaceName(e.target.value)}/></Field><Field label={t('类型')}><select value={spaceKind} onChange={e=>setSpaceKind(e.target.value as 'personal'|'company')}><option value="personal">{t('个人空间')}</option><option value="company">{t('公司空间')}</option></select></Field></div>
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
        <h4>{t('交接记录')}</h4>{!handoffs.length&&<p className="share-muted">{t('还没有可查看的交接记录。')}</p>}{handoffs.map((receipt,index)=>{const data=(receipt.payload??{}) as Record<string,unknown>;return <article className="share-comment" key={String(receipt.id??index)}><div><strong>{String(receipt.actorName??receipt.actorId??t('成员'))}</strong><time>{timestamp(Number(receipt.createdAt))}</time></div><h4>{getString(data,'goal')}</h4><p>{getString(data,'summary')}</p>{getArray(data,'artifacts').map((file,i)=><details key={i}><summary>{getString(file,'name')}</summary><pre>{getString(file,'text')}</pre></details>)}{onHandoff&&selectedConnection.permissions?.readReceipts&&<button className="btn sm" disabled={busy} onClick={()=>void run(async()=>{const latest=await collaborationCall<{receipts:Record<string,unknown>[]}>('listHandoffs',{connectionId:selectedConnection.id});const verified=latest.receipts.find(r=>r.id===receipt.id);if(!verified)throw Error(t('交接记录已不可访问。'));await onHandoff(verified,connectionTargetItem);})}>{t('打开为我的草稿')}</button>}</article>;})}
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





