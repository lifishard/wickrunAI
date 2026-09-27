import type { GenerationConfig, KeyProfile } from '../types';
import type { ContentPart, WireMessage } from './paramSchema';
import { buildRequestBody } from './paramSchema';
import { buildHeaders, endpoint } from './api';
import { getTransport } from './transport';

/** A cancellable, tool-free request. Nothing is applied to files automatically. */
export async function requestAssistant(profile: KeyProfile, config: GenerationConfig, content: string | ContentPart[], signal: AbortSignal, system: string): Promise<string> {
  const transport = getTransport();
  const key = await transport.secretGet(profile.id);
  if (!key) throw Error('请先为当前模型配置 API Key。');
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const requestId = `artifact-${crypto.randomUUID()}`;
  const messages: WireMessage[] = [{ role: 'system', content: system }, { role: 'user', content }];
  const body = buildRequestBody({ ...config, toolsEnabled: false, customBody: '' }, messages, []);
  delete body.tools; delete body.tool_choice;
  return new Promise((resolve, reject) => {
    let text = '', settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); error ? reject(error) : resolve(text); };
    const abort = () => { void transport.abort(requestId); finish(new DOMException('已取消', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    void transport.chat({ requestId, url: endpoint(profile.baseUrl, 'chat/completions'), headers: buildHeaders(key, profile), body, stream: config.stream, timeoutMs: 120000 }, {
      onContent: delta => { text += delta; if (text.length > 1024 * 1024) { void transport.abort(requestId); finish(Error('修改建议过长，请缩小选区。')); } },
      onReasoning() {}, onToolCalls() {}, onUsage() {}, onStop() {}, onDone: () => finish(), onError: message => finish(Error(message)),
    }).catch(e => finish(e instanceof Error ? e : Error(String(e))));
  });
}
