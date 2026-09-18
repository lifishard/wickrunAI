const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','src');
/** 已经改造成 t() 的文件。每完成一批就往这里加一个，覆盖率才不会往回掉。 */
const TRANSLATED=[
  'App.tsx',
  'lib/tools/registry.ts',
  'lib/probe400.ts',
  'lib/skills.ts',
  'lib/skillsync.ts',
  'lib/transport.ts',
  'lib/wirecheck.ts',
  'components/Sidebar.tsx',
  'components/Composer.tsx',
  'components/ConversationControls.tsx',
  'components/LocaleSwitch.tsx',
  'components/SettingsDialog.tsx',
  'components/FailoverList.tsx',
  'components/ConfigPanel.tsx',
  'components/ModelPicker.tsx',
  'components/AnswerBlock.tsx',
  'components/WorkspaceDialog.tsx',
  'components/ObservationPanel.tsx',
  'components/UserQuestionCard.tsx',
  'components/collaboration/TeamWorkspace.tsx',
  'components/collaboration/WorkflowDesigner.tsx',
  'components/collaboration/WorkflowCanvas.tsx',
  'components/GrantDialog.tsx',
  'components/ToolConfirm.tsx',
  'components/RouteSettings.tsx',
  'components/EffortPicker.tsx',
  'components/ContextMeter.tsx',
  'components/ActivityPanel.tsx',
  'components/ApiConnectionStatus.tsx',
  'components/ClaudeRepair.tsx',
  'components/GatewayRecovery.tsx',
  'components/MessageNotes.tsx',
  'components/MilestonePanel.tsx',
  'components/Resizer.tsx',
  'components/SelectionActions.tsx',
  'components/SubagentProgress.tsx',
  'components/TaskFeedback.tsx',
  'components/WorkspaceHeader.tsx',
  'components/ui.tsx',
  'components/ArtifactPanel.tsx',
  'components/ClientConnections.tsx',
  'components/NativeAiPanel.tsx',
  'components/DeliveryPanel.tsx',
  'components/RecoveryCard.tsx',
  'components/Markdown.tsx',
  'components/ErrorBoundary.tsx',
  'components/collaboration/DataBackupPanel.tsx',
  'components/collaboration/LocalClientsPanel.tsx',
];

/** 纯逻辑模块：整份文件里的中文字符串都是给界面翻的 key。 */
const KEY_SOURCES=['lib/errors.ts'];

const dict=fs.readFileSync(path.join(root,'lib','i18n.ts'),'utf8');
const entries=[...dict.matchAll(/^\s+'((?:[^'\\]|\\.)+)':/gm)].map(m=>m[1]);

test('词典没有重复 key', () => {
  const seen=new Set(), dupes=[];
  for(const k of entries){ if(seen.has(k))dupes.push(k); seen.add(k); }
  assert.deepEqual(dupes,[],`重复的 key 会让后一条静默覆盖前一条：${dupes.join('、')}`);
});

test('errors.ts 的诊断文案都有英文', () => {
  const known=new Set(entries);
  const missing=[];
  for(const file of KEY_SOURCES){
    const source=fs.readFileSync(path.join(root,file),'utf8')
      .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    // 单行的普通字符串字面量，跳过正则里的内容
    for(const line of source.split('\n')){
      if(/^\s*(const|let)\s+[A-Z_]+\s*=\s*$/.test(line))continue;
      for(const m of line.matchAll(/'((?:[^'\\]|\\.)*)'/g)){
        const key=m[1];
        if(/[\u4e00-\u9fff]/.test(key)&&!known.has(key))missing.push(`${file}: ${key}`);
      }
    }
  }
  assert.deepEqual(missing,[],`英文模式下错误诊断会退回简体：\n${missing.join('\n')}`);
});

test('已改造的文件里每个 t() key 都有英文', () => {
  const known=new Set(entries);
  const missing=[];
  for(const file of TRANSLATED){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const used=[...source.matchAll(/\b(?:t|tr)\('([^']+)'/g)].map(m=>m[1]);
    // 常量表里的 label / hint 是在渲染处 t(x.label) 取的，同样要有词条
    for(const m of source.matchAll(/(?:label|hint|title|what|risk):\s*'([^']+)'/g))used.push(m[1]);
    for(const key of used){
      if(/[一-鿿]/.test(key)&&!known.has(key))missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing,[],`英文模式下会退回简体：\n${missing.join('\n')}`);
});

test('t() 里的反斜杠是转义过的', () => {
  // JSX 属性里的 \ 是字面量，搬进 t('...') 后就变成转义符了。少写一个就悄悄改了值。
  const bad=[];
  for(const file of TRANSLATED){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    source.split('\n').forEach((line,i)=>{
      for(const m of line.matchAll(/\b(?:t|tr)\('((?:[^'\\]|\\.)*)'/g)){
        const raw=m[1];
        // 成对扫：\\ 会被整对吃掉，后面的普通字符不会被当成转义
        const invalid=[...raw.matchAll(/\\(.)/g)].filter((e)=>!"\\'nt".includes(e[1]));
        if(invalid.length)bad.push(`${file}:${i+1} ${raw.slice(0,60)}`);
      }
    });
  }
  assert.deepEqual(bad,[],`这些字符串的值和源码看起来不一样：\n${bad.join('\n')}`);
});

test('已改造的文件里没有漏网的裸中文属性', () => {
  const leftovers=[];
  for(const file of TRANSLATED){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    source.split('\n').forEach((line,i)=>{
      // placeholder="中文" / title="中文" 这类还没走 t() 的属性
      if(/\b(placeholder|title|label|hint|aria-label)="[^"]*[一-鿿]/.test(line))
        leftovers.push(`${file}:${i+1} ${line.trim().slice(0,70)}`);
    });
  }
  assert.deepEqual(leftovers,[],`这些属性切语言不会变：\n${leftovers.join('\n')}`);
});
