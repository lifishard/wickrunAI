import React from 'react';
import AnchoredPopover from './AnchoredPopover';
import type { GenerationConfig, KeyProfile, ModelInfo } from '../types';
import { defaultGenerationConfig } from '../lib/paramSchema';
import type { SubagentConfig, SubagentWorker } from '../lib/subagents';
import { useT } from '../lib/i18n';
import './ConversationControls.css';

const DEFAULT_RUNTIME = defaultGenerationConfig().runtime!;

function workerId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `worker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ConversationControls({ config, profiles, modelsByProfile, onChange }: {
  config: GenerationConfig;
  profiles: KeyProfile[];
  modelsByProfile: Record<string, ModelInfo[]>;
  onChange: (patch: Partial<GenerationConfig>) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const subagents: SubagentConfig = config.subagents ?? { enabled: false, workers: [], maxCalls: 4, allowEdits: false };
  const harness = config.runtime?.harness !== 'off';

  const updateSubagents = (patch: Partial<SubagentConfig>) => {
    onChange({ subagents: { ...subagents, ...patch } });
  };

  const updateWorker = (id: string, patch: Partial<SubagentWorker>) => {
    updateSubagents({ workers: subagents.workers.map((worker) => worker.id === id ? { ...worker, ...patch } : worker) });
  };

  const addWorker = () => {
    const profile = profiles[0];
    if (!profile) return;
    const model = modelsByProfile[profile.id]?.[0];
    updateSubagents({
      workers: [...subagents.workers, {
        id: workerId(),
        profileId: profile.id,
        model: model?.id ?? '',
        label: model?.label,
      }],
    });
  };

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        className="btn sm ghost"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('对话运行方式：任务引导{harness} · 临时协作{subagents}。只作用于当前会话。', { harness: t(harness ? '开' : '关'), subagents: t(subagents.enabled ? '开' : '关') })}
        onClick={() => setOpen((v) => !v)}
      >
        {t('⚙ 运行方式')}
      </button>
      {open ? (
      <AnchoredPopover anchorRef={anchorRef} onClose={() => setOpen(false)} className="popup wide conversation-controls" label={t('对话运行方式')}>
      <div className="conversation-control-head">
        <span>{t('对话运行方式')}</span>
        <span className="conversation-control-summary">{t('任务引导')}{t(harness ? '开' : '关')} · {t('临时协作')}{t(subagents.enabled ? '开' : '关')}</span>
      </div>

      <div className="conversation-control-section">
        <label className="conversation-toggle">
          <input type="checkbox" checked={harness} onChange={(event) => onChange({ runtime: { ...DEFAULT_RUNTIME, ...config.runtime, harness: event.target.checked ? 'guided' : 'off' } })} />
          <span>
            <strong>{t('任务引导')}</strong>
            <small>{t('帮助模型理解目标、按规范编辑、自查并完成测试。关闭后仍保留传输完整性和防重复执行保护。')}</small>
          </span>
        </label>
      </div>

      <div className="conversation-control-section">
        <label className="conversation-toggle">
          <input type="checkbox" checked={subagents.enabled} onChange={(event) => updateSubagents({ enabled: event.target.checked })} />
          <span>
            <strong>{t('临时协作')}</strong>
            <small>{t('主模型可像调用工具一样临时分派独立工作，并在本轮整合结果。默认只读，最多两个同时运行。')}</small>
          </span>
        </label>

        {subagents.enabled ? (
          <div className="worker-pool">
            <div className="worker-pool-head">
              <span>{t('可调用模型')}</span>
              <label>
                {t('最多调用')}
                <input type="number" min={1} max={8} value={Math.max(1, Math.min(8, subagents.maxCalls || 4))} onChange={(event) => updateSubagents({ maxCalls: Math.max(1, Math.min(8, Number(event.target.value) || 1)) })} />
                {t('次')}
              </label>
            </div>

            {subagents.workers.length === 0 ? <p className="worker-empty">{t('还没有工作模型。添加后，主模型会按任务需要决定是否调用。')}</p> : null}

            {subagents.workers.map((worker, index) => {
              const models = modelsByProfile[worker.profileId] ?? [];
              const datalistId = `conversation-worker-models-${worker.id}`;
              return (
                <div className="worker-row" key={worker.id}>
                  <label>
                    <span>{t('API 凭据')}</span>
                    <select value={worker.profileId} aria-label={t('工作模型 {n} 的 API 凭据', { n: index + 1 })} onChange={(event) => {
                      const nextModels = modelsByProfile[event.target.value] ?? [];
                      updateWorker(worker.id, { profileId: event.target.value, model: nextModels[0]?.id ?? '', label: nextModels[0]?.label });
                    }}>
                      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>{t('模型')}</span>
                    <input list={datalistId} value={worker.model} aria-label={t('工作模型 {n} 的模型 ID', { n: index + 1 })} placeholder={t('选择模型或填写 ID')} onChange={(event) => {
                      const model = models.find((item) => item.id === event.target.value);
                      updateWorker(worker.id, { model: event.target.value, label: model?.label });
                    }} />
                    <datalist id={datalistId}>{models.map((model) => <option key={model.id} value={model.id}>{model.label ?? model.id}</option>)}</datalist>
                  </label>
                  <button className="icon-btn sm" aria-label={t('移除工作模型 {n}', { n: index + 1 })} title={t('移除')} onClick={() => updateSubagents({ workers: subagents.workers.filter((item) => item.id !== worker.id) })}>×</button>
                </div>
              );
            })}

            <div className="worker-actions">
              <button className="btn sm ghost" disabled={profiles.length === 0} onClick={addWorker}>{t('添加工作模型')}</button>
              <label className="edit-permission">
                <input type="checkbox" checked={Boolean(subagents.allowEdits)} disabled={!config.toolsEnabled} onChange={(event) => updateSubagents({ allowEdits: event.target.checked })} />
                {t('允许继承本会话的编辑权限')}
              </label>
            </div>
            {!config.toolsEnabled ? <p className="worker-note">{t('当前会话未开启工具，临时协作保持只读。')}</p> : <p className="worker-note">{t('编辑仍受本会话的目录范围和审批方式约束。')}</p>}
          </div>
        ) : null}
      </div>
      </AnchoredPopover>
      ) : null}
    </div>
  );
}
