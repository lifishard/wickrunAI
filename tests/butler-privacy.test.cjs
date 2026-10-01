const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const {butlerPrivateText}=loader()(path.join(__dirname,'../src/lib/butler-privacy.ts'));
const {normalizePolicy,privacyDecision,redactByPolicy}=require('../electron/butler-privacy.cjs');
test('desktop and application memory agree on exclude, encrypted-only and redaction rules',()=>{
 const policy=normalizePolicy({excludedTerms:['Private Project'],encryptedOnlyTerms:['local only']});
 for(const [text,decision] of [['AI skills password: secret','exclude'],['AI Private Project','exclude'],['AI local only','encrypt-only'],['diagnosis: confidential','exclude'],['AI skills alice@example.com','redact'],['bank account number 12345','redact']]){
  assert.equal(privacyDecision(text,policy),decision);const result=butlerPrivateText(text,policy);
  if(decision==='redact'){assert.equal(result,redactByPolicy(text,policy));assert.doesNotMatch(result,/alice@example|12345/);}else assert.equal(result,null);
 }
});

test('shared memory is filtered again before inference while timestamps and ids remain intact',()=>{
 const load=loader(),{emptyButlerBrain}=load(path.join(__dirname,'../src/lib/proactive-butler.ts')),{privateButlerBrain}=load(path.join(__dirname,'../src/lib/butler-private-brain.ts'));
 const brain=emptyButlerBrain('account-one'),signal={id:'signal',accountId:brain.accountId,source:'wickrun',topic:'AI skills',intent:'Learn',summary:'AI skills',basis:'user-stated',confidence:'high',modelSafe:true,observedAt:1790812345678};
 brain.signals=[signal,{...signal,id:'private',summary:'secret-project AI skills'}];brain.goals=[{id:'goal',accountId:brain.accountId,title:'Private goal',hypothesis:'secret-project research',evidenceIds:['private'],status:'proposed',confidence:'medium',updatedAt:1790812345678}];
 const result=privateButlerBrain(brain,normalizePolicy({excludedTerms:['secret-project']}));assert.deepEqual(result.signals,[{...signal,sourceLabel:''}]);assert.deepEqual(result.goals,[]);assert.equal(brain.signals.length,2);
});
