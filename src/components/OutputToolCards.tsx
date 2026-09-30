import React from 'react';
import type { ToolStep } from '../types';
import Markdown from './Markdown';
import { followupPresentation, presentedOutputs, type PresentedOutput } from '../lib/output-tools';
import { useT } from '../lib/i18n';
import './OutputToolCards.css';

function OutputCard({ item }: { item: PresentedOutput }) {
  const t=useT();
  const [copied,setCopied]=React.useState<'idle'|'ok'|'error'>('idle');
  const timer=React.useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  React.useEffect(()=>()=>clearTimeout(timer.current),[]);
  const copy=async()=>{
    try{await navigator.clipboard.writeText(item.text);setCopied('ok');}catch{setCopied('error');}
    clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied('idle'),1400);
  };
  return <section className="output-tool-card">
    <div className="output-tool-head">
      <div className="output-tool-title">{item.title || t('成品文本')}</div>
      <button type="button" className="btn sm" onClick={()=>void copy()}>{t(copied==='ok'?'已复制':copied==='error'?'复制失败':'复制文本')}</button>
    </div>
    <Markdown text={item.text}/>
  </section>;
}

export function answerBodyAndFollowups(content: string, steps: ToolStep[]) {
  const presentation=followupPresentation(content, steps);
  const outputs=presentedOutputs(steps);
  if (outputs.length && presentation.body.trim()===outputs.map(item=>item.text).join('\n\n').trim()) {
    return {...presentation,body:''};
  }
  return presentation;
}

export default function OutputToolCards(props: {
  content: string;
  steps: ToolStep[];
  onFollowup?: (question: string) => void;
}) {
  const t=useT();
  const outputs = presentedOutputs(props.steps);
  const {questions} = followupPresentation(props.content, props.steps);
  if (!outputs.length && !questions.length) return null;
  return <div className="output-tool-cards">
    {outputs.map(item => <OutputCard item={item} key={item.id}/>)}
    {questions.length ? <section className="output-followups" aria-label={t('可选追问')}>
      {questions.map((question,index) => <button type="button" key={`${index}-${question}`} disabled={!props.onFollowup} onClick={() => props.onFollowup?.(question)}>{question}<span aria-hidden="true">↗</span></button>)}
    </section> : null}
  </div>;
}
