const humanColors=['#3478c6','#218579','#b06d24','#377a65'];
const aiColors=['#8061c6','#a7598c','#5e6bcc','#8e6caa'];
/** Color is supplemental: the visible name and Human/AI label carry identity. */
export function speakerColor(id:string,ai:boolean):string {
  let hash=0;for(const char of id)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
  const colors=ai?aiColors:humanColors;return colors[hash%colors.length];
}
export function sharedMessageIdentity(message:Record<string,unknown>,viewerId?:string){
  const ai=message.role==='assistant',system=message.role==='system';
  const authorId=typeof message.authorId==='string'?message.authorId:'';
  const model=typeof message.model==='string'?message.model:'';
  return {ai,system,own:!ai&&!system&&Boolean(viewerId&&authorId===viewerId),
    color:speakerColor(ai?model||'assistant':authorId||String(message.authorName??'member'),ai)};
}

/** A model answer may join only the initiating author's explicit message group. */
export function sharedMessageGroups(messages:Record<string,unknown>[]){
 const roots=new Map(messages.filter(m=>m.role==='user'&&m.groupId===m.id).map(m=>[m.id,m]));
 const groups:{id:string;messages:Record<string,unknown>[];paired:boolean}[]=[],byId=new Map<string,{id:string;messages:Record<string,unknown>[];paired:boolean}>();
 for(const message of messages){const root=roots.get(message.groupId);const valid=root&&root.authorId===message.authorId&&(message===root||message.role==='assistant');const id=String(valid?root.id:message.id);let group=byId.get(id);if(!group){group={id,messages:[],paired:Boolean(valid)};byId.set(id,group);groups.push(group);}group.messages.push(message);}
 for(const group of groups)if(group.paired)group.messages.sort((a,b)=>a.id===group.id?-1:b.id===group.id?1:Number(a.createdAt)-Number(b.createdAt));
 return groups;
}
