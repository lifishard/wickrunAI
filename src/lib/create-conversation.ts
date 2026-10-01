import type { Conversation, GenerationConfig } from '../types';

export interface ConversationRequest {
  mode: 'chat' | 'work';
  title: string;
  prompt: string;
  start: boolean;
  request_key: string;
  workspace_root?: string;
}

export function parseConversationRequest(input: Record<string, unknown>): ConversationRequest {
  if (input.mode !== 'chat' && input.mode !== 'work') throw Error('mode 必须是 chat 或 work。');
  if (typeof input.request_key !== 'string' || !/^[\w-]{1,80}$/.test(input.request_key)) throw Error('需要稳定的 request_key（最多 80 个字母、数字、下划线或连字符）。');
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 80)) throw Error('对话标题最多 80 个字符。');
  if (input.prompt !== undefined && (typeof input.prompt !== 'string' || input.prompt.length > 16000)) throw Error('新任务说明最多 16000 个字符，请仅带入必要资料。');
  if (input.start !== undefined && typeof input.start !== 'boolean') throw Error('start 必须是布尔值。');
  if(input.workspace_root!==undefined&&(typeof input.workspace_root!=='string'||input.workspace_root.length>1024))throw Error('工作目录无效。');
  const prompt = String(input.prompt ?? '').trim();
  return { mode: input.mode, title: String(input.title ?? '').trim(), prompt, start: Boolean(prompt) && input.start !== false, request_key: input.request_key, ...(input.workspace_root?{workspace_root:String(input.workspace_root)}:{}) };
}

/** Only an explicit leading command is local navigation; discussion and quoted examples stay in chat. */
export function conversationCommand(text: string, fallback: 'chat' | 'work'): Omit<ConversationRequest, 'request_key'> | null {
  const value = text.trim();
  const slash = /^\/(chat|work)(?=\s|$)\s*([\s\S]*)$/i.exec(value);
  const chinese = /^(?:请(?:帮我)?|帮我|麻烦(?:帮我)?)?\s*(?:新建|新开|另开|开新|开(?:一个|个)新|打开新|创建新)(?:\s*(?:一个|一条|个))?\s*(?:(chat|work|聊天|工作)\s*(?:对话|会话)?(?:窗口|窗)?|(?:对话|会话)(?:\s*(chat|work|聊天|工作))?\s*(?:窗口|窗)?)(?=$|[\s，,:：。！!；;、])([\s\S]*)$/i.exec(value);
  const english = /^(?:please\s+)?(?:open|create|start)\s+(?:a\s+)?new\s+(chat|work)(?:\s+(?:conversation|window|session))?(?=$|[\s,:;.!])([\s\S]*)$/i.exec(value);
  if (!slash && !chinese && !english) return null;
  const rawMode = slash?.[1] ?? chinese?.[1] ?? chinese?.[2] ?? english?.[1];
  const mode = rawMode ? /^(work|工作)$/i.test(rawMode) ? 'work' : 'chat' : fallback;
  const prompt = (slash?.[2] ?? chinese?.[3] ?? english?.[2] ?? '').replace(/^[\s，,:：。！!；;、]+/, '').trim();
  return {mode, title: '', prompt, start: Boolean(prompt)};
}

export async function conversationRequestIdentity(sourceId: string, operationKey: string, request: ConversationRequest) {
  const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
  return { id: 'created-' + await hash(sourceId + ':' + operationKey + ':' + request.request_key), fingerprint: await hash(JSON.stringify(request)) };
}

export function requestedConversation(source: Conversation | undefined, config: GenerationConfig, keyProfileId: string | null, request: ConversationRequest, identity: {id:string;fingerprint:string}, now = Date.now()): Conversation {
  return {
    id: identity.id, coordinationGroupId: source?.coordinationGroupId ?? source?.id ?? identity.id, title: request.title || request.prompt.replace(/\s+/g, ' ').slice(0, 48),
    projectId: source?.projectId ?? null, keyProfileId: source?.keyProfileId ?? keyProfileId,
    ...(source?.privacy ? {privacy:source.privacy} : {}),
    config: {...structuredClone(source?.config ?? config), toolsEnabled: request.mode === 'work'},
    messages: [], draft: request.prompt, creationFingerprint: identity.fingerprint, createdAt: now, updatedAt: now,
  };
}
