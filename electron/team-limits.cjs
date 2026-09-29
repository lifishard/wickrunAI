'use strict';
/* 与 src/lib/team-limits.ts 同一份规则；tests/team-limits.test.cjs 保证两边一致。 */
const LIMIT_CAPS=Object.freeze({visits:1000,traversals:1000,memberTokens:10000000,runTokens:100000000,runSteps:10000,runMinutes:43200});
const latest=(run,kind,target)=>[...(run.limitRaises||[])].reverse().find(r=>r.kind===kind&&(r.target||'')===(target||''))?.value;
const maxVisitsOf=(run,node)=>latest(run,'visits',node.id)??node.maxVisits;
const maxTraversalsOf=(run,edge)=>latest(run,'traversals',edge.id)??edge.maxTraversals;
const memberTokensOf=(run,member)=>latest(run,'memberTokens',member.id)??member.maxTokens;
const runTokensOf=run=>latest(run,'runTokens')??run.version.graph.maxTokens;
const runStepsOf=run=>latest(run,'runSteps')??run.version.graph.maxSteps;
const runMinutesOf=run=>latest(run,'runMinutes')??run.version.graph.maxMinutes;
function currentLimit(run,kind,target){
 if(kind==='visits'){const n=run.version.graph.nodes.find(x=>x.id===target);if(!n)throw Error('上限调整对象无效');return maxVisitsOf(run,n);}
 if(kind==='traversals'){const e=run.version.graph.edges.find(x=>x.id===target);if(!e)throw Error('上限调整对象无效');return maxTraversalsOf(run,e);}
 if(kind==='memberTokens'){const m=run.members.find(x=>x.id===target);if(!m)throw Error('上限调整对象无效');return memberTokensOf(run,m);}
 if(!['runTokens','runSteps','runMinutes'].includes(kind))throw Error('上限调整类型无效');
 if(target!==undefined)throw Error('上限调整对象无效');
 return kind==='runTokens'?runTokensOf(run):kind==='runSteps'?runStepsOf(run):runMinutesOf(run);
}
/** 追加的调高记录必须针对本次运行里的对象，只能调高，且不超过硬上限。before 是追加这条之前的运行。 */
function validateLimitRaise(raise,before){
 if(!raise||typeof raise!=='object'||!Object.prototype.hasOwnProperty.call(LIMIT_CAPS,raise.kind)||!Number.isInteger(raise.value)||!Number.isFinite(raise.at))throw Error('上限调整记录无效');
 const current=currentLimit(before,raise.kind,raise.target);
 if(raise.value<=current||raise.value>LIMIT_CAPS[raise.kind])throw Error('上限只能调高，且不能超过允许的最大值');
}
module.exports={LIMIT_CAPS,maxVisitsOf,maxTraversalsOf,memberTokensOf,runTokensOf,runStepsOf,runMinutesOf,currentLimit,validateLimitRaise};
