import type { NativeAiProvider } from './native-ai';
export type MeetingPhase = 'preparation'|'perspectives'|'discussion'|'convergence'|'decision'|'closed';
export type ContributionKind = 'viewpoint'|'question'|'concern'|'response'|'proposal'|'summary'|'pass';
export interface MeetingMessage {id:string;seq:number;at:number;author:'user'|NativeAiProvider;kind:ContributionKind|'invitation'|'notice'|'phase'|'ask_user'|'decision'|'deferred';text:string;replyTo?:string;to?:NativeAiProvider;questionId?:string;basedOn?:number}
export interface MeetingQuestion {id:string;messageId:string;asker:NativeAiProvider;text:string;reason:string;options:{label:string;impact:string}[];recommendation:string;status:'pending'|'answered'|'deferred';answer?:string;answerMessageId?:string}
export interface MeetingInvitation {id:string;provider:NativeAiProvider;status:'waiting'|'completed'|'cancelled';focus:string;replyTo?:string;readThrough?:number;readAt?:number;independent:boolean;createdAt:number;automatic?:boolean}
export interface MeetingMinutes {agreements:string;disagreements:string;openQuestions:string;actions:string;basedOn:number;confirmedAt:number;confirmedBy:'user'}
export interface MeetingRoom {id:string;projectId:string;title:string;purpose:string;material:string;participants:NativeAiProvider[];phase:MeetingPhase;messages:MeetingMessage[];questions:MeetingQuestion[];invitations:MeetingInvitation[];minutes?:MeetingMinutes;createdAt:number;updatedAt:number;auto?:{status:'running'|'paused'|'completed';remaining:number;focus:string;reason:string};attendance?:{provider:NativeAiProvider;connected:boolean;waiting:boolean}[]}
export const meetingPhases:Record<MeetingPhase,string>={preparation:'明确议题',perspectives:'各自观点',discussion:'交流与澄清',convergence:'归纳分歧',decision:'请你决定',closed:'会议结束'};
export const meetingKinds:Record<MeetingMessage['kind'],string>={viewpoint:'观点',question:'提问',concern:'提出异议',response:'回应',proposal:'改进建议',summary:'归纳草案',pass:'暂无补充',invitation:'邀请发言',notice:'主持记录',phase:'会议阶段',ask_user:'等待你决定',decision:'你的决定',deferred:'你已暂缓'};
export const meetingNames:Record<MeetingMessage['author'],string>={user:'你 · 主持人','claude-desktop':'Claude Desktop',chatgpt:'ChatGPT'};
export function meetingMinutesText(room:MeetingRoom):string {
  const m=room.minutes;
  return [`# ${room.title}`,`会议目标：${room.purpose}`,'会议纪要是讨论记录，不是质检结论或执行授权。',m?`纪要经用户确认：${new Date(m.confirmedAt).toLocaleString()}`:'纪要尚未确认',...(m?[`## 共识\n${m.agreements}`,`## 分歧\n${m.disagreements}`,`## 待验证问题\n${m.openQuestions}`,`## 行动建议\n${m.actions}`]:[]),'## 向用户提问与决定',...room.questions.map(q=>`${q.text}\n原因：${q.reason}\n${q.status==='pending'?'等待答复':q.status==='deferred'?'暂缓':'用户答复'}：${q.answer||'尚未回答'}`),'## 发言记录',...room.messages.map(x=>`### #${x.seq} ${meetingNames[x.author]} · ${meetingKinds[x.kind]}\n${x.kind==='phase'?meetingPhases[x.text as MeetingPhase]||x.text:x.text}${x.replyTo?`\n回应发言：${x.replyTo}`:''}`)].join('\n\n');
}
