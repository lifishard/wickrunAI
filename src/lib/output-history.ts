/** Presentation history is never used as model context or as a final deliverable. */
export interface OutputSnapshot { id:string; at:number; content:string; reasoning:string }
export function preserveOutput(history:OutputSnapshot[], before:{content:string;reasoning?:string}, after:{content:string;reasoning?:string}, at=Date.now()):OutputSnapshot[] {
  const lostContent=!!before.content&&!after.content.startsWith(before.content);
  const lostReasoning=!!before.reasoning&&!(after.reasoning??'').startsWith(before.reasoning);
  if(!lostContent&&!lostReasoning)return history;
  const content=lostContent?before.content:'',reasoning=lostReasoning?before.reasoning??'':'';
  const last=history.at(-1);
  if(last?.content===content&&last.reasoning===reasoning)return history;
  return [...history,{id:`output-${at}-${history.length}`,at,content,reasoning}];
}
