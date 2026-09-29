import type { WorkspaceOperation, WorkspaceResult } from './workspace-planner';
import { workspaceOperationSchema } from './workspace-planner';
import type { TeamProject } from './collaboration';
import type { MeetingRoom } from './meeting-room';
import type { desktop } from './transport';
import type { TeamRuntime } from './team-runtime';
import { nextTeamTrigger } from './team-runtime';
import { uid } from './store';
import { tr } from './i18n';

export interface WorkspaceOperator {
 project:()=>TeamProject;
 update:(fn:(p:TeamProject)=>void)=>Promise<unknown>;
 runtime:Pick<TeamRuntime,'start'|'pause'>;
 bridge:Pick<NonNullable<ReturnType<typeof desktop>>,'meetingAction'|'meetingState'|'teamFilesDiff'>;
 launch:(taskId:string)=>void;
}
/** Explicit user-click operations reuse the same runtime and native APIs as the workspace UI. */
export async function operateWorkspace(raw:WorkspaceOperation,result:WorkspaceResult,operator:WorkspaceOperator):Promise<{text:string;ids?:Record<string,string>}>{
 const op=workspaceOperationSchema.parse(raw),p=operator.project(),resolve=(id:string)=>Object.prototype.hasOwnProperty.call(result.ids,id)?result.ids[id]:id;
 const go=async(page:string,extra:Partial<TeamProject['preferences']>={})=>operator.update(p=>{p.preferences={...p.preferences,page,...extra};});
 if(op.kind==='start_task'){
   const task=p.tasks.find(t=>t.id===resolve(op.task)),flow=p.workflows.find(f=>f.id===task?.workflowId);
   if(!task||!flow?.versions.length||flow.archived)throw Error(tr('安排引用的工作流尚无可用版本'));
   operator.launch(task.id);return {text:tr('已打开运行前检查，等待你确认启动')};
 }
 if(op.kind==='run_control'){
   const run=p.runs.find(r=>r.id===resolve(op.run));if(!run)throw Error(tr('运行不存在'));
   if(op.action==='resume'){
     if(!['paused','ready'].includes(run.status)){await go('runs',{runId:run.id});throw Error(tr('此运行需要先处理提问、验收或待核实结果'));}
     await go('runs',{runId:run.id});await operator.runtime.start(p.id,run.id);return {text:tr('已请求继续运行，可在运行页查看结果')};
   }
   if(['completed','cancelled','failed'].includes(run.status))throw Error(tr('此运行已结束'));
   await operator.runtime.pause(p.id,run.id,op.action==='cancel');return {text:tr(op.action==='cancel'?'已请求停止运行，已有记录保留':'已请求暂停运行，已有记录保留')};
 }
 if(op.kind==='schedule_control'){
   await operator.update(p=>{const schedule=p.schedules.find(s=>s.id===resolve(op.schedule));if(!schedule)throw Error(tr('安排引用的定时任务不存在'));const f=p.workflows.find(f=>f.id===schedule.workflowId);if(op.enabled&&(!f||f.archived||!f.versions.some(v=>v.id===schedule.versionId)))throw Error(tr('安排引用的工作流尚无可用版本'));schedule.nextAt=nextTeamTrigger(schedule.timezone,schedule.hour,schedule.minute);schedule.enabled=op.enabled;});return {text:tr(op.enabled?'已启用定时任务':'已停用定时任务')};
 }
 if(op.kind==='task_message'){
   await operator.update(p=>{const task=p.tasks.find(t=>t.id===resolve(op.task));if(!task)throw Error(tr('任务不存在'));const member=op.member?p.members.find(m=>m.id===resolve(op.member!)):undefined;if(op.member&&!member)throw Error(tr('成员不存在'));task.entries.push({id:uid('entry'),at:Date.now(),kind:'instruction',author:'你 → '+(member?.name??'所有成员'),text:op.text});});return {text:tr('已把补充要求交给任务成员')};
 }
 if(op.kind==='create_meeting'){
   const room=await operator.bridge.meetingAction('create',{projectId:p.id,title:op.title,purpose:op.purpose,material:op.material,participants:op.participants}) as MeetingRoom;
   if(!room?.id)throw Error(tr('未收到会议创建结果，请先核对会议室'));
   return {text:tr('会议已建立，客户端加入后可以开始讨论'),ids:{[op.ref]:room.id}};
 }
 if(op.kind==='meeting_control'){
   const room=(await operator.bridge.meetingState(p.id)).find(r=>r.id===resolve(op.room));if(!room)throw Error(tr('当前项目中不存在这场会议'));
   if(op.action==='auto_start'&&(!op.rounds||!op.focus)||op.action==='invite'&&(!op.provider||!op.focus)||op.action==='phase'&&!op.phase)throw Error(tr('会议安排缺少轮数、重点或参与者'));
   await operator.bridge.meetingAction(op.action,{roomId:room.id,rounds:op.rounds,focus:op.focus,provider:op.provider,phase:op.phase});return {text:tr('会议安排已更新，待决问题仍由你回答')};
 }
 if(op.kind==='inspect_files'){
   const session=p.files.find(f=>f.id===resolve(op.session));if(!session)throw Error(tr('当前项目中不存在这份文件记录'));
   const refreshed=await operator.bridge.teamFilesDiff(session.id);await operator.update(p=>{const i=p.files.findIndex(f=>f.id===session.id);if(i>=0)p.files[i]=refreshed;p.preferences.page='files';});return {text:tr('已检查文件差异，请查看后决定是否合并')};
 }
 if(op.kind==='open'){
   const extra:Partial<TeamProject['preferences']>={},target=op.target?resolve(op.target):undefined;
   if(target){if(op.page==='tasks'){if(!p.tasks.some(t=>t.id===target))throw Error(tr('任务不存在'));extra.taskId=target;}if(op.page==='runs'){if(!p.runs.some(r=>r.id===target))throw Error(tr('运行不存在'));extra.runId=target;}if(op.page==='workflows'){if(!p.workflows.some(f=>f.id===target))throw Error(tr('工作流不存在'));extra.workflowId=target;}if(op.page==='meetings'){if(!(await operator.bridge.meetingState(p.id)).some(r=>r.id===target))throw Error(tr('当前项目中不存在这场会议'));extra.meetingId=target;}}
   await go(op.page,extra);return {text:tr('已打开对应操作位置')};
 }
 throw Error(tr('未知协作操作'));
}
