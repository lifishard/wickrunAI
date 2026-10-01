import * as patterns from '../../electron/butler-privacy-rules.json';

export type ButlerSensitiveCategory='contact'|'financial'|'health';
export type ButlerSensitiveMode='exclude'|'encrypt-only'|'redact';
export interface ButlerPrivacyPolicy {
  excludedTerms:string[];
  encryptedOnlyTerms:string[];
  categories:Record<ButlerSensitiveCategory,ButlerSensitiveMode>;
  encryptedStorage?:boolean;
  note?:string;
}
export const DEFAULT_BUTLER_PRIVACY:ButlerPrivacyPolicy={excludedTerms:[],encryptedOnlyTerms:[],categories:{contact:'redact',financial:'redact',health:'exclude'}};
/** Filtering precedes inference. Encrypted-only material is unavailable to the bot. */
export function butlerPrivateText(text:string,policy:ButlerPrivacyPolicy=DEFAULT_BUTLER_PRIVACY):string|null {
  if(new RegExp(patterns.credentials,'i').test(text))return null;
  const lower=text.toLocaleLowerCase();
  if([...policy.excludedTerms,...policy.encryptedOnlyTerms].some(term=>term.trim()&&lower.includes(term.toLocaleLowerCase())))return null;
  for(const category of Object.keys(DEFAULT_BUTLER_PRIVACY.categories) as ButlerSensitiveCategory[]){
    const pattern=new RegExp(patterns[category],'ig');
    if(!pattern.test(text))continue;
    if(policy.categories[category]!=='redact')return null;
    if(category!=='contact')return '[private]';
    text=text.replace(pattern,'[private]');
  }
  return text;
}
