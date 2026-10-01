import type { ButlerProactivePreferences } from './proactive-butler';

export function butlerClock(now:number,timezone:string):{day:string;time:string} {
  let parts:Intl.DateTimeFormatPart[];
  try {parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);}
  catch {parts=new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);}
  const value=(type:string)=>parts.find(p=>p.type===type)?.value??'';
  return {day:`${value('year')}-${value('month')}-${value('day')}`,time:`${value('hour')}:${value('minute')}`};
}
/** One morning/evening catch-up per local calendar day, even after suspend/restart. */
export function dueButlerBrief(prefs:ButlerProactivePreferences,now:number,done:string[]):{key:string;period:'morning'|'evening'}|null {
  if(!prefs.enabled||prefs.paused)return null;
  const clock=butlerClock(now,prefs.timezone);
  const periods= prefs.cadence==='twice-daily'?['morning','evening'] as const:['morning'] as const;
  for(const period of [...periods].reverse()) {
    const at=prefs[period];
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)||clock.time<at)continue;
    const key=`${clock.day}:${period}`;
    if(!done.includes(key))return {key,period};
  }
  return null;
}

export function parseButlerAnalysis(raw:string):{goals:{title:string;hypothesis:string;evidenceIds:string[];confidence:'low'|'medium'|'high'}[];skills:{name:string;description:string;body:string;evidenceIds:string[]}[]} {
  const clean=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  const data=JSON.parse(clean) as Record<string,unknown>;
  const strings=(value:unknown,max:number)=>Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'&&x.length<=120).slice(0,max):[];
  const items=(key:string)=>Array.isArray(data[key])?(data[key] as unknown[]).filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object').slice(0,5):[];
  const text=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
  return {
    goals:items('goals').map(g=>({title:text(g.title,100),hypothesis:text(g.hypothesis,400),evidenceIds:strings(g.evidenceIds,12),confidence:(['low','medium','high'].includes(String(g.confidence))?g.confidence:'low') as 'low'|'medium'|'high'})).filter(g=>g.title&&g.hypothesis&&g.evidenceIds.length),
    skills:items('skills').map(s=>({name:text(s.name,60),description:text(s.description,160),body:text(s.body,2000),evidenceIds:strings(s.evidenceIds,12)})).filter(s=>s.name&&s.description&&s.body&&s.evidenceIds.length),
  };
}
