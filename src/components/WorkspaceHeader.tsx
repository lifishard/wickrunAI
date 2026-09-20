import React from 'react';
import BrandLogo from './BrandLogo';
import { useT } from '../lib/i18n';
import type { Project } from '../lib/projects';

export default function WorkspaceHeader({ team, platform, projects, projectId, onProject, onMode, onHide }: {
  team: boolean;
  platform: string;
  projects: Project[];
  projectId: string;
  onProject: (id: string) => void;
  onMode: (team: boolean) => void;
  onHide: () => void;
}) {
  const t = useT();
  return <div className="workspace-header">
    <div className="brand">
      <button className="icon-btn brand-toggle" title={t('收起侧栏（Ctrl+B）')} onClick={onHide}>⇤</button>
      <BrandLogo size={25} />
      <span title="wickrunAI">{t('灯芯AI')}</span><small>{platform}</small>
    </div>
    <label className="workspace-project"><span>{t('当前项目')}</span>
      <select aria-label={t('当前项目')} value={projectId} onChange={e => onProject(e.target.value)}>
        <option value="" disabled={team && projects.length > 0}>{t(team ? '选择项目' : '不属于项目')}</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <div className="workspace-mode pill-switch" role="group" aria-label={t('工作区切换')}>
      <button aria-pressed={!team} onClick={() => onMode(false)}>{t('单一 Agent')}</button>
      <button aria-pressed={team} onClick={() => onMode(true)}>{t('协作空间')}</button>
    </div>
  </div>;
}
