import type { GenerationConfig, KeyProfile, ModelInfo } from '../types';
import type { ContentPart, WireMessage } from './paramSchema';
import { buildRequestBody } from './paramSchema';
import { buildHeaders, endpoint } from './api';
import { getTransport } from './transport';
import { calibratedTokens, capabilities, outputReserve, paceFields, prepareBody, rateLimitLearning } from './adaptive';
import { classifyError } from './errors';
import { quotaLimits, type LearnedLimit } from './limits';
import { isRateLimited, rateLimitDelay, retryAfterMs, waitCancellable } from './pacer';
import { secretGet } from './store';
import { runtimePolicy } from './task-context';

/** Opt-in: the rate-limit learning, wait and retry the single agent uses. */
export interface AssistantRetry {
  autoRetry: number;
  limitOf?: () => LearnedLimit | undefined;
  onLearnLimit?: (limit: LearnedLimit) => void;
  modelInfo?: ModelInfo;
  /** Milliseconds left while queued for quota or waiting out a rate limit; 0 once sending. */
  onWait?: (ms: number) => void;
}
type Attempt = { text: string; error?: string; status?: number; headers: Record<string, string> };

/** A cancellable, tool-free request. Nothing is applied to files automatically. */
export async function requestAssistant(profile: KeyProfile, config: GenerationConfig, content: string | ContentPart[], signal: AbortSignal, system: string, onContent?:(text:string)=>void, retry?: AssistantRetry): Promise<string> {
  const transport = getTransport();
  const key = await secretGet(profile.id);
  if (!key) throw Error('请先为当前模型配置 API Key。');
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const messages: WireMessage[] = [{ role: 'system', content: system }, { role: 'user', content }];
  const safeConfig={ ...config, toolsEnabled: false, customBody: '' };
  const started = Date.now(), recoveryLimit = runtimePolicy(safeConfig).recoveryMinutes*60_000;
  for (;;) {
    const learned = retry?.limitOf?.();
    const cap = capabilities(profile, safeConfig, learned, retry?.modelInfo);
    const body = prepareBody(buildRequestBody(safeConfig, messages, []),safeConfig,cap);
    delete body.tools; delete body.tool_choice;
    // Same ledger as the single agent and team members on this credential.
    const result = await once(body, paceFields(profile, cap, learned, calibratedTokens(body, profile, safeConfig), outputReserve(body, safeConfig, cap)));
    if (result.error === undefined) return result.text;
    if (!isRateLimited(result.error, result.status)) throw Error(result.error);
    retry?.onLearnLimit?.(rateLimitLearning(profile, result.error));
    const info = classifyError(result.error, result.status, { model: safeConfig.model });
    const delay = rateLimitDelay(retryAfterMs(result.headers), info.retryAfterMs);
    if (!retry || retry.autoRetry <= 0 || !info.retryable || Date.now()-started+delay > recoveryLimit) throw Error(result.error);
    onContent?.('');
    await waitCancellable(delay, signal, retry.onWait);
    retry.onWait?.(0);
  }

  function once(body: Record<string, unknown>, pace: ReturnType<typeof paceFields>): Promise<Attempt> {
    const requestId = `artifact-${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      let text = '', settled = false, headers: Record<string, string> = {};
      const finish = (value?: Attempt, error?: Error) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(value!); };
      const abort = () => { void transport.abort(requestId); finish(undefined, new DOMException('已取消', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      void transport.chat({ requestId, url: endpoint(profile.baseUrl, 'chat/completions'), headers: buildHeaders(key!, profile), body, stream: config.stream, timeoutMs: 120000, ...pace }, {
        onContent: delta => { text += delta; onContent?.(text); if (text.length > 1024 * 1024) { void transport.abort(requestId); finish(undefined, Error('修改建议过长，请缩小选区。')); } },
        onReasoning() {}, onToolCalls() {}, onUsage() {}, onStop() {},
        onResponse: (status, value) => {
          headers = value;
          const limits = quotaLimits(value);
          if (Object.keys(limits).length) retry?.onLearnLimit?.({ ...limits, at: Date.now(), from: `HTTP ${status} 响应头` });
        },
        onPaceWait: ms => retry?.onWait?.(ms),
        onDispatch: () => retry?.onWait?.(0),
        onDone: () => finish({ text, headers }),
        onError: (message, status) => finish({ text, error: message, status, headers }),
      }).catch(e => finish(undefined, e instanceof Error ? e : Error(String(e))));
    });
  }
}
