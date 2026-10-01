import type { Conversation, GenerationConfig } from '../types';
import { importTemplate, TEMPLATE_FORMAT, type Graph, type Member, type TeamSchedule, type Workflow } from './collaboration';
import { makeProject, type Project } from './projects';
import { uid } from './store';
import { assertPublicCollaboration, collaborationCall, type SharedItem, type SharedView } from './shared-resources';

type Data=Record<string,unknown>;
const text=(v:unknown)=>typeof v==='string'?v:'';
const rows=(v:unknown):Data[]=>Array.isArray(v)?v as Data[]:[];
export interface SharedCopy {project:Project;conversations:Conversation[];members:Member[];workflows:Workflow[];schedules:TeamSchedule[];binaryFiles:number}

/** Read all permitted descendants before making any local changes. */
export async function readSharedTree(root:SharedItem,token?:string,call=collaborationCall):Promise<SharedItem[]> {
  const result:SharedItem[]=[],seen=new Set([root.id]),queue=[root];
  while(queue.length){
    const current=queue.shift()!;
    const view=await call<SharedView>('get',{itemId:current.id,...(token?{token}:{})});
    for(const child of view.children??[]){
      if(seen.has(child.id))continue;
      if(seen.size>=200)throw Error('一次最多复制 200 项，请分批复制。');
      seen.add(child.id);result.push(child);
      if(['project','folder','conversation'].includes(child.kind))queue.push(child);
    }
  }
  return result;
}

/** A copy carries selected content, with fresh identities and disabled execution. */
export function buildSharedCopy(root:SharedItem,descendants:SharedItem[],config:GenerationConfig,keyProfileId:string|null):SharedCopy {
  const all=[root,...descendants],project=makeProject(root.title),now=Date.now();
  const result:SharedCopy={project,conversations:[],members:[],workflows:[],schedules:[],binaryFiles:0};
  for(const item of all){
    assertPublicCollaboration(item.payload);
    const p=item.payload;
    if(item.kind==='project'){
      if(item.id===root.id)project.instructions=text(p.instructions);
      project.docs.push(...rows(p.docs).map(d=>({id:uid('doc'),name:text(d.name),text:text(d.content),updatedAt:now})));
      project.prompts.push(...rows(p.prompts).map(d=>({id:uid('prompt'),label:text(d.name),text:text(d.text)})));
    }else if(item.kind==='file'){
      if(typeof p.text==='string')project.docs.push({id:uid('doc'),name:text(p.name)||item.title,text:p.text,updatedAt:now});
      else result.binaryFiles++;
    }else if(item.kind==='conversation'){
      if(item.id===root.id)project.instructions=text(p.instructions);
      const localConfig=structuredClone(config);localConfig.toolsEnabled=false;delete localConfig.client;
      result.conversations.push({id:uid('c'),title:item.title,projectId:project.id,keyProfileId,config:localConfig,
        messages:rows(p.messages).filter(m=>m.role==='user'||m.role==='assistant').map(m=>({id:uid('m'),role:m.role as 'user'|'assistant',content:text(m.content),createdAt:Number(m.createdAt)||now,...(typeof m.model==='string'?{model:m.model}:{})})),
        createdAt:now,updatedAt:now});
    }else if(item.kind==='workflow'){
      const graph=p.definition as Graph;
      const members=rows(p.agents).map(a=>({id:text(a.id),name:text(a.name)||'Agent',instructions:text(a.description),connectionId:'',model:'',effort:'normal',enabled:false,tools:[],maxTokens:30000,maxMinutes:20}));
      const template=importTemplate({format:TEMPLATE_FORMAT,version:1,members,workflows:[{id:item.id,name:item.title,draft:{...graph,maxSteps:graph.maxSteps??100,maxMinutes:graph.maxMinutes??60,maxTokens:graph.maxTokens??100000},viewport:{x:0,y:0,zoom:1},versions:[],archived:false,updatedAt:now}]});
      const workflow=template.workflows[0],version={id:uid('version'),number:1,createdAt:now,graph:structuredClone(workflow.draft)};
      workflow.versions=[version];result.members.push(...template.members);result.workflows.push(workflow);
      result.schedules.push(...rows(p.schedules).map(s=>({id:uid('schedule'),name:text(s.name),workflowId:workflow.id,versionId:version.id,
        goal:text(s.goal),acceptance:text(s.acceptance),timezone:text(s.timezone)||'UTC',hour:Number(s.hour)||0,minute:Number(s.minute)||0,
        enabled:false,catchUp:false,overlap:'skip' as const,nextAt:0,triggers:[]})));
    }
  }
  return result;
}

export function sharedHandoffDraft(receiptId:string,payload:Data,config:GenerationConfig,keyProfileId:string|null,projectId?:string):Conversation {
  const now=Date.now(),localConfig=structuredClone(config);localConfig.toolsEnabled=false;delete localConfig.client;
  const goal=text(payload.goal),summary=text(payload.summary);
  const artifacts=rows(payload.artifacts).map(a=>`${text(a.name)}${typeof a.text==='string'?`\n${a.text}`:''}`).join('\n\n');
  return {id:`shared-handoff-${receiptId}`,title:goal.replace(/\s+/g,' ').slice(0,48),projectId:projectId??null,keyProfileId,config:localConfig,messages:[],
    draft:[goal,summary,artifacts].filter(Boolean).join('\n\n'),createdAt:now,updatedAt:now};
}
