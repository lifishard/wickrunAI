'use strict';
const patterns=require('./butler-privacy-rules.json');
const DEFAULT={excludedTerms:[],encryptedOnlyTerms:[],categories:{contact:'redact',financial:'redact',health:'exclude'}};
const terms=value=>[...new Set((Array.isArray(value)?value:[]).map(x=>String(x).trim()).filter(x=>x&&x.length<=80))].slice(0,40);
function normalizePolicy(value={}) {
  return {excludedTerms:terms(value.excludedTerms),encryptedOnlyTerms:terms(value.encryptedOnlyTerms),
    categories:Object.fromEntries(Object.keys(DEFAULT.categories).map(key=>[key,['exclude','encrypt-only','redact'].includes(value.categories?.[key])?value.categories[key]:DEFAULT.categories[key]]))};
}
function privacyDecision(text,policy=DEFAULT) {
  if(new RegExp(patterns.credentials,'i').test(text))return 'exclude';
  const lower=text.toLocaleLowerCase();
  if(policy.excludedTerms.some(x=>lower.includes(x.toLocaleLowerCase())))return 'exclude';
  let encrypted=policy.encryptedOnlyTerms.some(x=>lower.includes(x.toLocaleLowerCase()));
  for(const category of Object.keys(DEFAULT.categories))if(new RegExp(patterns[category],'i').test(text)){
    if(policy.categories[category]==='exclude')return 'exclude';
    if(policy.categories[category]==='encrypt-only')encrypted=true;
  }
  return encrypted?'encrypt-only':'redact';
}
function redactByPolicy(text,policy=DEFAULT) {
  if(privacyDecision(text,policy)!=='redact')return '';
  for(const category of Object.keys(DEFAULT.categories)){
    if(category!=='contact'&&new RegExp(patterns[category],'i').test(text))return '[private]';
    text=text.replace(new RegExp(patterns[category],'ig'),'[private]');
  }
  return text;
}
function encryptedStorage(safeStorage) {
  const available=()=>Boolean(safeStorage?.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text');
  return {available,
    encode:value=>{if(!available())throw Error('系统加密存储不可用；未保存或采集原始活动。');return {version:1,encrypted:true,data:safeStorage.encryptString(JSON.stringify(value)).toString('base64')};},
    decode:value=>{if(!value?.encrypted)return Array.isArray(value)?value:[];if(!available())return [];
      try{return JSON.parse(safeStorage.decryptString(Buffer.from(value.data,'base64')));}catch{return [];}}};
}
module.exports={normalizePolicy,privacyDecision,redactByPolicy,encryptedStorage};
