import type { ChatMessage } from '../types';
/** Keep binary data out of the text handoff, preserving image order and names. */
export function bridgeImages(messages: ChatMessage[]) {
  const images: {name:string;dataUrl:string}[]=[];
  const history=messages.map(m=>({...m,attachments:m.attachments?.flatMap(a=>{
    if(a.kind==='audio'||a.kind==='video')throw Error('MCP 交接暂不直接传音视频，请先转为文字或视频抽帧。');
    if(a.kind!=='image')return [a];
    if(!a.dataUrl)throw Error(`图片《${a.name}》内容不可用，请重新添加。`);
    images.push({name:a.name,dataUrl:a.dataUrl});
    return [{...a,kind:'text' as const,dataUrl:undefined,text:`[图片 image-${images.length}：${a.name}。请用 wickrun_read_task_image 读取实际图片。]`}];
  })}));
  return {images,history};
}
