const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');const {loader}=require('./load-ts.cjs');
const catalog=require('../src/data/agency-catalog.json'),names=require('../src/data/agency-role-names-zh.json');
const load=loader({'../data/agency-catalog.json':{default:catalog},'../data/agency-role-names-zh.json':{default:names}});
const i18n=load(path.resolve(__dirname,'../src/lib/i18n.ts'));
const {localizeRoles}=load(path.resolve(__dirname,'../src/lib/role-locale.ts'));
const cn=s=>/[\u3400-\u9fff]/.test(s);
test('role names switch languages without mutating prompts or custom names',()=>{
 const before=JSON.stringify(catalog),en=localizeRoles(catalog,'en'),zh=localizeRoles(catalog,'zh-Hans'),hant=localizeRoles(catalog,'zh-Hant');
 assert.equal(Object.keys(names).length,catalog.length);assert.ok(en.every(r=>!cn(r.name)));assert.ok(zh.every(r=>cn(r.name)));assert.equal(zh[0].name,'人类学家');assert.equal(hant[0].name,'人類學家');assert.equal(JSON.stringify(catalog),before);
 for(let i=0;i<catalog.length;i++)assert.equal(en[i].instructions,catalog[i].instructions);
 const custom={...catalog[0],name:'我的研究员'};assert.equal(localizeRoles([custom],'en')[0].name,custom.name);
 const {filterRoles}=load(path.resolve(__dirname,'../src/lib/office-library.ts'));assert.equal(filterRoles(en,'人类学家')[0].id,catalog[0].id);assert.equal(filterRoles(zh,'Anthropologist')[0].id,catalog[0].id);
});
test('new workspace and review UI has complete English keys and no raw Chinese JSX',()=>{
 const files=['AgentRolePicker','CodeChanges','CompatibilityStatus','collaboration/AgentOffice','collaboration/OfficeLibrary','collaboration/OfficePlanner','collaboration/WorkspacePlanCard','collaboration/ButlerPreferences','collaboration/MeetingRoom'];const errors=[];
 for(const file of files){const source=fs.readFileSync(path.resolve(__dirname,'../src/components',file+'.tsx'),'utf8');const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function walk(n){if(ts.isJsxText(n)&&cn(n.text))errors.push(file+': raw JSX '+n.text.trim());if(ts.isCallExpression(n)&&['tx','tr','t'].includes(n.expression.getText(tree))&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])){const key=n.arguments[0].text;if(cn(key)&&cn(i18n.translate('en',key)))errors.push(file+': missing '+key);}ts.forEachChild(n,walk);}walk(tree);
 }
 for(const r of catalog)if(cn(i18n.translate('en',r.division)))errors.push('Category: '+r.division);
 assert.deepEqual(errors,[]);
});
test('English interpolation and traditional Chinese preserve user text',()=>{
 assert.equal(i18n.translate('en','批量加入（{count}）',{count:3}),'Add selected (3)');
 assert.equal(i18n.translate('en','展开角色说明：{name}',{name:'自定义A'}),'Show role details: 自定义A');
 assert.equal(i18n.translate('zh-Hant','角色库'),'角色庫');
});
