import React from 'react';
import type { AppSettings } from '../../types';
import type { Skill } from '../../lib/skills';
import { OBSERVER_SOURCE } from '../../lib/butler';
import notices from '../../data/thirdparty-notices.json';
export default function ButlerPreferences({settings,onSettings,projectRules,onProjectRules,skills}:{settings:AppSettings;onSettings?:(update:(s:AppSettings)=>AppSettings)=>void;projectRules:string;onProjectRules:(text:string)=>void;skills:Skill[]}){
  return <details className="butler-preferences"><summary>管家的规范、约束与学习方式</summary><p>你的规则优先于技能建议和积累的经验。它们随请求提供给模型；预算、权限和启动确认还由程序单独限制。</p>
    <label className="team-field"><span>全局长期指令（所有项目）</span><textarea rows={4} value={settings.butler?.instructions??''} placeholder="例如：用中文，先给重点；遇到不明确的目标先提问；对外发布前必须交给我确认。" onChange={e=>{const instructions=e.target.value;onSettings?.(s=>({...s,butler:{...s.butler,instructions}}));}}/></label>
    <label className="team-field"><span>当前项目的规范与约束</span><textarea rows={3} value={projectRules} placeholder="例如：先做小规模试验；交付要附来源；不得把讨论通过当作质检通过。" onChange={e=>onProjectRules(e.target.value)}/></label>
    <label className="team-check"><input type="checkbox" checked={settings.butler?.learning!==false} onChange={e=>{const learning=e.target.checked;onSettings?.(s=>({...s,butler:{...s.butler,learning}}));}}/>在管家对话与任务复盘中提出学习建议</label><p className="hint">建议留待你审阅，采用后才成为项目记忆或技能草案。已有记忆可在下方修改、删除；关闭学习仍会使用你已批准的记忆。</p>
    <details><summary>给管家装配已安装的技能</summary><p>仅加载你勾选且已启用的技能，每项最多 12,000 字；超出时提示摘要范围，不授予额外工具权限。</p>{skills.filter(s=>s.enabled).map(skill=><label className="team-check" key={skill.id}><input type="checkbox" checked={settings.butler?.skillIds?.includes(skill.id)??false} onChange={e=>{const checked=e.target.checked;onSettings?.(s=>({...s,butler:{...s.butler,skillIds:checked?[...new Set([...(s.butler?.skillIds??[]),skill.id])]:(s.butler?.skillIds??[]).filter(id=>id!==skill.id)}}));}}/>{skill.name} · {skill.description}</label>)}{!skills.some(s=>s.enabled)&&<p>尚无已启用技能，可在单人对话的技能管理中安装。</p>}</details>
    <p className="hint">内置学习方法改编自 <a href={OBSERVER_SOURCE} target="_blank" rel="noreferrer">Task Observer — Eoghan Henn</a>（CC BY 4.0）。使用 wickrunAI 的建议审阅与记忆存储，没有自动运行上游脚本。</p>
    <details><summary>开源来源与许可证</summary><p>agency-agents 的角色正文保留原文，中文摘要与像素形象为 wickrunAI 添加。Task Observer 的观察与审阅方法适配为本机界面，不是上游技能运行环境的完整移植。</p><pre style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap'}}>{notices.agencyAgents+'\n\n'+notices.taskObserver}</pre></details>
  </details>;
}
