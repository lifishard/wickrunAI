import type { ToolResult, ToolStep } from '../types';

export const OUTPUT_TOOL_NAMES = ['present_output', 'suggest_followups'] as const;

export const NATIVE_OUTPUT_INSTRUCTIONS = `For a finished, reusable piece of text (draft, rewrite, email, message, document text), put the complete text in one <wickrun_output>{"title":"short optional label","text":"complete final text"}</wickrun_output> JSON marker. The app renders a copyable card. Do not repeat its text outside the marker. For optional questions the user might ask you next, put 1–3 complete questions in <wickrun_followups>{"questions":["Question?"]}</wickrun_followups>. These are suggestions only: do not wait for answers. Ask for user input separately when you need a real user decision, clarification, or permission. These output markers only display content in this conversation; they never edit files, run commands, or send messages. Do not put output markers inside examples or quotations.`;

/** Keep protocol-like examples in Markdown fences and quotations as ordinary text. */
export function mapOutsideMarkdown(text: string, transform: (outside: string) => string, protectedTransform: (inside: string) => string = inside=>inside): string {
  const lines=text.match(/[^\n]*\n|[^\n]+$/g)??[];
  let fence:{char:string;length:number}|null=null;
  let protectedText='';
  let outside='';
  let result='';
  const flushOutside=()=>{if(outside){result+=transform(outside);outside='';}};
  const flushProtected=()=>{if(protectedText){result+=protectedTransform(protectedText);protectedText='';}};
  for(const line of lines){
    const opening=/^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    const marker=opening?.[1];
    if(fence){
      flushOutside();protectedText+=line;
      if(marker && marker[0]===fence.char && marker.length>=fence.length &&
          new RegExp(`^[ \\t]{0,3}${fence.char}{${fence.length},}[ \\t]*$`).test(line.trimEnd())) fence=null;
      continue;
    }
    if(marker){flushOutside();protectedText+=line;fence={char:marker[0],length:marker.length};continue;}
    if(/^[ \t]{0,3}>/.test(line)){flushOutside();protectedText+=line;continue;}
    flushProtected();outside+=line;
  }
  flushOutside();flushProtected();
  return result;
}

const question = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 240 && /[?？]$/.test(value.trim());

export function runOutputTool(name: string, args: Record<string, unknown>): ToolResult {
  if (name === 'present_output') {
    const text = args.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 30000 ||
        (args.title !== undefined && (typeof args.title !== 'string' || args.title.length > 80))) {
      return {ok:false,content:'',error:'成品文本需要非空 text（最多 30000 字）和可选短标题（最多 80 字）。'};
    }
    return {ok:true,content:'成品文本已在当前对话展示。不要重复正文。',summary:'已展示成品文本'};
  }
  if (name === 'suggest_followups') {
    const questions = args.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3 || !questions.every(question) ||
        new Set(questions.map(q => q.trim().toLocaleLowerCase())).size !== questions.length) {
      return {ok:false,content:'',error:'可选追问需要 1 到 3 个不重复的完整问句，每条最多 240 字。'};
    }
    return {ok:true,content:'可选追问已展示，等待用户自行点击；不要将其当成用户问题或等待用户回答。',summary:'已展示可选追问'};
  }
  return {ok:false,content:'',error:'未知输出工具'};
}

/** Native desktop clients have no function-call channel, so use equivalent final-text markers. */
export function nativeOutputSteps(text: string, requestId: string): ToolStep[] {
  const tags = [
    {tag:'wickrun_output',name:'present_output'},
    {tag:'wickrun_followups',name:'suggest_followups'},
  ];
  const prose=mapOutsideMarkdown(text,part=>part,()=> '\n');
  return tags.flatMap(({tag,name}) => [...prose.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,'gi'))]
    .map((match,index) => {
      let args:Record<string,unknown>={};
      let result:ToolResult;
      try {
        const value:unknown=JSON.parse(match[1]);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('参数必须是 JSON 对象');
        args=value as Record<string,unknown>;
        result=runOutputTool(name,args);
      } catch (error) { result={ok:false,content:'',error:`输出格式无效：${error instanceof Error?error.message:String(error)}`}; }
      const id=`${requestId}-${name}-${index}`;
      return {id,callId:id,name,args,status:result.ok?'ok' as const:'error' as const,
        summary:result.summary??name,output:result.content,error:result.error,startedAt:Date.now()};
    }));
}

export interface PresentedOutput { id: string; title: string; text: string }

export function presentedOutputs(steps: ToolStep[]): PresentedOutput[] {
  return steps.flatMap(step => {
    if (step.name !== 'present_output' || step.status !== 'ok' || !step.args || typeof step.args !== 'object') return [];
    const args = step.args as Record<string, unknown>;
    if (typeof args.text !== 'string' || !args.text.trim()) return [];
    return [{id:step.id,title:typeof args.title === 'string' ? args.title : '',text:args.text}];
  });
}

/** Native output cards are also part of the conversation the model must remember. */
export function outputTranscript(content: string, steps: ToolStep[]): string {
  const outputs = presentedOutputs(steps).map(item => item.text);
  return [content, ...outputs.filter(text => !content.includes(text))].filter(Boolean).join('\n\n');
}

export interface FollowupPresentation { body: string; questions: string[] }

/**
 * A tool call is authoritative. The prose fallback only converts a clearly labelled,
 * trailing set of bullet questions, so numbered content or user decisions remain prose.
 */
export function followupPresentation(content: string, steps: ToolStep[]): FollowupPresentation {
  const fromTool = [...steps].reverse().find(step => step.name === 'suggest_followups' && step.status === 'ok');
  if (fromTool?.args && typeof fromTool.args === 'object') {
    const questions = (fromTool.args as Record<string, unknown>).questions;
    if (Array.isArray(questions) && questions.length >= 1 && questions.length <= 3 && questions.every(question)) {
      return {body:content,questions:questions.map(q => q.trim())};
    }
  }
  const lines = content.trimEnd().split(/\r?\n/);
  const items: string[] = [];
  let i=lines.length-1;
  while (i>=0 && !lines[i].trim()) i--;
  for (; i>=0 && items.length<3;) {
    const match = /^\s*[-*•]\s+(.+?)\s*$/.exec(lines[i]);
    if (!match || !question(match[1])) break;
    items.unshift(match[1].trim()); i--;
    while (i>=0 && !lines[i].trim()) i--;
  }
  if (!items.length || i<0) return {body:content,questions:[]};
  const outsideLines=mapOutsideMarkdown(content,part=>part,part=>part.replace(/[^\r\n]/g,' ')).trimEnd().split(/\r?\n/);
  if(outsideLines[i]?.trim()!==lines[i].trim())return {body:content,questions:[]};
  const label = lines[i].trim().replace(/^#{1,6}\s*/, '').replace(/\*\*/g,'');
  if (!/^(?:a few things worth a second look|(?:suggested|possible|optional|follow[- ]?up|further) questions|(?:你可以|可选|建议|进一步|后续|以下).{0,16}(?:追问|问题|再问)|有几个值得进一步考虑的问题)\s*[:：]?$/.test(label.toLowerCase())) {
    return {body:content,questions:[]};
  }
  return {body:lines.slice(0,i).join('\n').trimEnd(),questions:items};
}
