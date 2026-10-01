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
