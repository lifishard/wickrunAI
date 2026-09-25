'use strict';
/*
 * 本机 AI「大脑」协议转换：纯函数，不碰网络。
 *
 * Claude Code 只会说 Anthropic Messages，Codex 只会说 OpenAI Responses，
 * 而用户登记的路由绝大多数是 OpenAI Chat Completions。这里把两种客户端协议
 * 翻成 Chat Completions，再把结果翻回去。模型由会话决定，客户端请求里的
 * model 字段只作参考，不能借此换到用户没选的路由。
 *
 * 不翻译的东西：客户端私有的思考签名（thinking signature）、服务端工具
 * （web_search 等）、缓存控制字段。这些要么上游不认识，要么只有原厂能验。
 */

const STOP_TO_ANTHROPIC = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'refusal' };
/* 会话里用户定的思考参数；客户端自己带的同名字段一律让位 */
const CLIENT_EFFORT_KEYS = ['reasoning_effort', 'thinking', 'enable_thinking', 'thinking_budget', 'reasoning'];
const PROTECTED = new Set(['model', 'messages', 'tools', 'tool_choice', 'stream', 'stream_options', 'n']);

function asText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (typeof b === 'string' ? b : b && b.type === 'text' ? String(b.text || '') : '')).join('');
}

function safeJson(text) {
  if (typeof text !== 'string' || !text.trim()) return {};
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }; }
  catch { return { _raw: text }; }
}

/** 会话里的思考参数与用户额外字段并进请求体，但不能改写模型、消息和工具 */
function applySession(body, session) {
  for (const k of CLIENT_EFFORT_KEYS) delete body[k];
  for (const [k, v] of Object.entries(session.extras || {})) if (!PROTECTED.has(k)) body[k] = v;
  if (session.outputField === 'max_completion_tokens' && body.max_tokens !== undefined) {
    body.max_completion_tokens = body.max_tokens; delete body.max_tokens;
  } else if (session.outputField === 'none') delete body.max_tokens;
  return body;
}

/* ------------------------------ Anthropic ------------------------------ */

function anthropicImage(block) {
  const s = block.source || {};
  if (s.type === 'base64' && typeof s.data === 'string') return { type: 'image_url', image_url: { url: `data:${s.media_type || 'image/png'};base64,${s.data}` } };
  if (s.type === 'url' && typeof s.url === 'string') return { type: 'image_url', image_url: { url: s.url } };
  return null;
}

function toolResultText(block) {
  const c = block.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.type === 'text' ? x.text : x && x.type === 'image' ? '[image]' : '')).join('\n') : '';
  return block.is_error ? `[tool error] ${text}` : text;
}

/** Anthropic Messages 请求 → Chat Completions 请求 */
function anthropicToChat(req, session) {
  const messages = [];
  const system = typeof req.system === 'string' ? req.system : asText(req.system);
  if (system) messages.push({ role: 'system', content: system });
  for (const m of Array.isArray(req.messages) ? req.messages : []) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: String(b.id), type: 'function', function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // 用户消息里的 tool_result 必须紧跟在对应 assistant 之后，先出 tool 消息再出正文
    for (const b of blocks) if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: toolResultText(b) || '(empty)' });
    const parts = [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') { const img = anthropicImage(b); if (img) parts.push(img); }
      else if (b.type === 'document') parts.push({ type: 'text', text: '[document omitted: this route receives text only]' });
    }
    if (parts.length) messages.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('') : parts });
  }
  const body = { model: session.model, messages, stream: req.stream === true };
  if (body.stream) body.stream_options = { include_usage: true };
  if (Number.isFinite(req.max_tokens)) body.max_tokens = req.max_tokens;
  if (Number.isFinite(req.temperature)) body.temperature = req.temperature;
  if (Number.isFinite(req.top_p)) body.top_p = req.top_p;
  if (Array.isArray(req.stop_sequences) && req.stop_sequences.length) body.stop = req.stop_sequences.slice(0, 4);
  const tools = (Array.isArray(req.tools) ? req.tools : []).filter((t) => t && typeof t.name === 'string' && (!t.type || t.type === 'custom' || t.input_schema));
  if (tools.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: String(t.description || ''), parameters: t.input_schema || { type: 'object', properties: {} } } }));
    const c = req.tool_choice;
    if (c?.type === 'any') body.tool_choice = 'required';
    else if (c?.type === 'tool' && c.name) body.tool_choice = { type: 'function', function: { name: c.name } };
    else if (c?.type === 'none') body.tool_choice = 'none';
    if (c?.disable_parallel_tool_use === true) body.parallel_tool_calls = false;
  }
  return applySession(body, session);
}

function anthropicUsage(u) {
  return { input_tokens: u?.prompt_tokens ?? 0, output_tokens: u?.completion_tokens ?? 0, ...(u?.prompt_tokens_details?.cached_tokens ? { cache_read_input_tokens: u.prompt_tokens_details.cached_tokens } : {}) };
}

/** Chat Completions 非流式结果 → Anthropic Messages 结果 */
function chatToAnthropic(resp, model, id) {
  const choice = resp?.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  const text = typeof msg.content === 'string' ? msg.content : asText(msg.content);
  if (text) content.push({ type: 'text', text });
  for (const c of msg.tool_calls || []) content.push({ type: 'tool_use', id: c.id || `toolu_${Math.random().toString(36).slice(2)}`, name: c.function?.name || '', input: safeJson(c.function?.arguments) });
  return { id: id || `msg_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model, content, stop_reason: STOP_TO_ANTHROPIC[choice.finish_reason] || (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'), stop_sequence: null, usage: anthropicUsage(resp?.usage) };
}

/**
 * Chat Completions SSE 分片 → Anthropic SSE 事件。
 * emit(event, data) 由调用方写到响应流。push 每个解析好的 chunk，最后 end()。
 */
function createAnthropicStream(emit, model, id) {
  let started = false, textIndex = -1, next = 0, finish = null, usage = null, closed = false;
  const tools = new Map(); // upstream index → {block, id, name}
  const open = () => {
    if (started) return; started = true;
    emit('message_start', { type: 'message_start', message: { id: id || `msg_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  };
  const closeText = () => { if (textIndex >= 0) { emit('content_block_stop', { type: 'content_block_stop', index: textIndex }); textIndex = -1; } };
  return {
    push(chunk) {
      open();
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const d = choice.delta || {};
      if (typeof d.content === 'string' && d.content) {
        if (textIndex < 0) { textIndex = next++; emit('content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } }); }
        emit('content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: d.content } });
      }
      for (const c of d.tool_calls || []) {
        const key = Number.isInteger(c.index) ? c.index : tools.size;
        let t = tools.get(key);
        if (!t) {
          closeText();
          t = { block: next++, id: c.id || `toolu_${Math.random().toString(36).slice(2)}`, name: c.function?.name || '' };
          tools.set(key, t);
          emit('content_block_start', { type: 'content_block_start', index: t.block, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
        }
        const args = c.function?.arguments;
        if (typeof args === 'string' && args) emit('content_block_delta', { type: 'content_block_delta', index: t.block, delta: { type: 'input_json_delta', partial_json: args } });
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    },
    end() {
      if (closed) return; closed = true; open(); closeText();
      for (const t of tools.values()) emit('content_block_stop', { type: 'content_block_stop', index: t.block });
      const stop = STOP_TO_ANTHROPIC[finish] || (tools.size ? 'tool_use' : 'end_turn');
      emit('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: anthropicUsage(usage) });
      emit('message_stop', { type: 'message_stop' });
    },
  };
}

/* ------------------------------ Responses ------------------------------ */

function responsesContent(content) {
  if (typeof content === 'string') return content;
  const parts = [];
  for (const p of Array.isArray(content) ? content : []) {
    if (['input_text', 'output_text', 'text'].includes(p?.type) && typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
    else if (p?.type === 'input_image' && (p.image_url || p.url)) parts.push({ type: 'image_url', image_url: { url: p.image_url || p.url } });
  }
  return parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('') : parts;
}

/** OpenAI Responses 请求 → Chat Completions 请求。custom（自由格式）工具包成一个只有 input 字段的函数 */
function responsesToChat(req, session) {
  const messages = [];
  if (typeof req.instructions === 'string' && req.instructions) messages.push({ role: 'system', content: req.instructions });
  const custom = new Set();
  const input = typeof req.input === 'string' ? [{ type: 'message', role: 'user', content: req.input }] : Array.isArray(req.input) ? req.input : [];
  let pending = null; // 连续的 function_call 合进同一条 assistant
  const flush = () => { if (pending) { messages.push(pending); pending = null; } };
  for (const item of input) {
    const type = item?.type || (item?.role ? 'message' : '');
    if (type === 'function_call' || type === 'custom_tool_call') {
      if (!pending) pending = { role: 'assistant', content: null, tool_calls: [] };
      pending.tool_calls.push({ id: String(item.call_id), type: 'function', function: { name: String(item.name), arguments: type === 'custom_tool_call' ? JSON.stringify({ input: String(item.input ?? '') }) : String(item.arguments || '{}') } });
      continue;
    }
    flush();
    if (type === 'message') {
      const role = item.role === 'developer' ? 'system' : item.role === 'assistant' ? 'assistant' : item.role === 'system' ? 'system' : 'user';
      const content = responsesContent(item.content);
      if ((typeof content === 'string' && content) || (Array.isArray(content) && content.length)) messages.push({ role, content });
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      const out = item.output;
      messages.push({ role: 'tool', tool_call_id: String(item.call_id), content: typeof out === 'string' ? out : typeof out?.content === 'string' ? out.content : JSON.stringify(out ?? '') });
    }
    // reasoning、web_search_call 等条目不下发：上游无法验证，也不需要
  }
  flush();
  const body = { model: session.model, messages, stream: req.stream === true };
  if (body.stream) body.stream_options = { include_usage: true };
  if (Number.isFinite(req.max_output_tokens)) body.max_tokens = req.max_output_tokens;
  if (Number.isFinite(req.temperature)) body.temperature = req.temperature;
  if (Number.isFinite(req.top_p)) body.top_p = req.top_p;
  const tools = [];
  for (const t of Array.isArray(req.tools) ? req.tools : []) {
    if (t?.type === 'function' && t.name) tools.push({ type: 'function', function: { name: t.name, description: String(t.description || ''), parameters: t.parameters || { type: 'object', properties: {} } } });
    else if (t?.type === 'custom' && t.name) {
      custom.add(t.name);
      tools.push({ type: 'function', function: { name: t.name, description: `${t.description || ''}\nPut the complete raw tool input in the "input" string.`, parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] } } });
    }
  }
  if (tools.length) {
    body.tools = tools;
    const c = req.tool_choice;
    if (c === 'required' || c === 'none' || c === 'auto') body.tool_choice = c;
    else if (c?.type === 'function' && c.name) body.tool_choice = { type: 'function', function: { name: c.name } };
    if (req.parallel_tool_calls === false) body.parallel_tool_calls = false;
  }
  return { body: applySession(body, session), custom };
}

function responsesUsage(u) {
  const input = u?.prompt_tokens ?? 0, output = u?.completion_tokens ?? 0;
  return { input_tokens: input, input_tokens_details: { cached_tokens: u?.prompt_tokens_details?.cached_tokens ?? 0 }, output_tokens: output, output_tokens_details: { reasoning_tokens: u?.completion_tokens_details?.reasoning_tokens ?? 0 }, total_tokens: u?.total_tokens ?? input + output };
}

function toolItem(call, custom, id) {
  const name = call.function?.name || call.name || '';
  const args = call.function?.arguments ?? call.arguments ?? '';
  if (custom.has(name)) {
    const parsed = safeJson(args);
    return { type: 'custom_tool_call', id, status: 'completed', call_id: call.id, name, input: typeof parsed.input === 'string' ? parsed.input : String(args) };
  }
  return { type: 'function_call', id, status: 'completed', call_id: call.id, name, arguments: String(args || '{}') };
}

function responseShell(id, model, status, output = [], usage) {
  return { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status, model, output, ...(usage ? { usage } : {}) };
}

/** Chat Completions 非流式结果 → Responses 结果 */
function chatToResponses(resp, model, custom, id) {
  const rid = id || `resp_${Date.now().toString(36)}`;
  const msg = resp?.choices?.[0]?.message || {};
  const output = [];
  const text = typeof msg.content === 'string' ? msg.content : asText(msg.content);
  if (text) output.push({ type: 'message', id: `${rid}_msg`, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] });
  (msg.tool_calls || []).forEach((c, i) => output.push(toolItem({ ...c, id: c.id || `call_${rid}_${i}` }, custom, `${rid}_fc${i}`)));
  return responseShell(rid, model, 'completed', output, responsesUsage(resp?.usage));
}

/** Chat Completions SSE 分片 → Responses SSE 事件 */
function createResponsesStream(emit, model, custom, id) {
  const rid = id || `resp_${Date.now().toString(36)}`;
  let seq = 0, started = false, text = null, usage = null, closed = false, outputIndex = 0;
  const output = [];
  const calls = new Map();
  const send = (type, data) => emit(type, { type, sequence_number: seq++, ...data });
  const open = () => {
    if (started) return; started = true;
    send('response.created', { response: responseShell(rid, model, 'in_progress') });
    send('response.in_progress', { response: responseShell(rid, model, 'in_progress') });
  };
  const closeText = () => {
    if (!text) return;
    const part = { type: 'output_text', text: text.value, annotations: [] };
    send('response.output_text.done', { item_id: text.id, output_index: text.index, content_index: 0, text: text.value });
    send('response.content_part.done', { item_id: text.id, output_index: text.index, content_index: 0, part });
    const item = { type: 'message', id: text.id, status: 'completed', role: 'assistant', content: [part] };
    output[text.index] = item;
    send('response.output_item.done', { output_index: text.index, item });
    text = null;
  };
  return {
    push(chunk) {
      open();
      if (chunk.usage) usage = chunk.usage;
      const d = chunk.choices?.[0]?.delta;
      if (!d) return;
      if (typeof d.content === 'string' && d.content) {
        if (!text) {
          text = { id: `${rid}_msg${outputIndex}`, index: outputIndex++, value: '' };
          send('response.output_item.added', { output_index: text.index, item: { type: 'message', id: text.id, status: 'in_progress', role: 'assistant', content: [] } });
          send('response.content_part.added', { item_id: text.id, output_index: text.index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        }
        text.value += d.content;
        send('response.output_text.delta', { item_id: text.id, output_index: text.index, content_index: 0, delta: d.content });
      }
      for (const c of d.tool_calls || []) {
        const key = Number.isInteger(c.index) ? c.index : calls.size;
        let t = calls.get(key);
        if (!t) {
          closeText();
          t = { index: outputIndex++, id: `${rid}_fc${key}`, call_id: c.id || `call_${rid}_${key}`, name: c.function?.name || '', args: '' };
          calls.set(key, t);
          const isCustom = custom.has(t.name);
          send('response.output_item.added', { output_index: t.index, item: isCustom ? { type: 'custom_tool_call', id: t.id, status: 'in_progress', call_id: t.call_id, name: t.name, input: '' } : { type: 'function_call', id: t.id, status: 'in_progress', call_id: t.call_id, name: t.name, arguments: '' } });
        }
        if (!t.name && c.function?.name) t.name = c.function.name;
        const a = c.function?.arguments;
        if (typeof a === 'string' && a) {
          t.args += a;
          if (!custom.has(t.name)) send('response.function_call_arguments.delta', { item_id: t.id, output_index: t.index, delta: a });
        }
      }
    },
    end() {
      if (closed) return; closed = true; open(); closeText();
      for (const t of calls.values()) {
        const item = toolItem({ id: t.call_id, name: t.name, arguments: t.args }, custom, t.id);
        if (item.type === 'function_call') send('response.function_call_arguments.done', { item_id: t.id, output_index: t.index, arguments: item.arguments });
        output[t.index] = item;
        send('response.output_item.done', { output_index: t.index, item });
      }
      send('response.completed', { response: responseShell(rid, model, 'completed', output.filter(Boolean), responsesUsage(usage)) });
    },
  };
}

/** 粗估 token：Claude Code 的 count_tokens 只用来决定何时压缩，不需要精确 */
function estimateTokens(req) {
  const size = JSON.stringify([req.system, req.messages, req.tools]).length;
  return Math.ceil(size / 3.5);
}

/** 通用 SSE 行切分：data: 行里的 JSON 交给 onData，[DONE] 触发 onDone */
function createSseParser(onData, onDone) {
  let buffer = '';
  return (text) => {
    buffer += text;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).replace(/\r$/, '');
      buffer = buffer.slice(at + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') { onDone(); continue; }
      try { onData(JSON.parse(data)); } catch { /* 上游偶发的非 JSON 行，跳过 */ }
    }
  };
}

module.exports = { anthropicToChat, chatToAnthropic, createAnthropicStream, responsesToChat, chatToResponses, createResponsesStream, estimateTokens, createSseParser, applySession };
