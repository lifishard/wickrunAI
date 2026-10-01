import { projectButlerBrainForSync, type ButlerBrainState } from './proactive-butler';
import { butlerPrivateText, type ButlerPrivacyPolicy } from './butler-privacy';

/** Recheck incoming shared memory against this device's rules before inference. */
export function privateButlerBrain(brain:ButlerBrainState,policy?:ButlerPrivacyPolicy):ButlerBrainState {
  const clean=<T extends object>(item:T,keys:string[]):T|null=>{
    const copy={...item} as Record<string,unknown>;
    for(const key of keys)if(typeof copy[key]==='string'){
      const text=butlerPrivateText(copy[key] as string,policy);if(text===null||text==='[private]')return null;copy[key]=text;
    }
    return copy as T;
  };
  const list=<T extends object>(items:T[],keys:string[])=>items.map(item=>clean(item,keys)).filter((item):item is T=>item!==null);
  return projectButlerBrainForSync({...brain,
    signals:list(brain.signals,['topic','intent','summary','sourceLabel']),
    goals:list(brain.goals,['title','hypothesis','userCorrection']),
    skillProposals:list(brain.skillProposals,['name','description','body']),
    briefs:brain.briefs.map(brief=>({...brief,items:list(brief.items,['title','summary'])})),
    feedback:list(brain.feedback??[],['comment']),audit:list(brain.audit??[],['title','detail']),
    jobs:(brain.jobs??[]).map(job=>({...job,summary:butlerPrivateText(job.summary??'',policy)??undefined,error:butlerPrivateText(job.error??'',policy)??undefined,commands:list(job.commands??[],['text'])})),
  });
}
