import type { ToolStep } from '../types';
import Markdown from './Markdown';
import { followupPresentation, presentedOutputs } from '../lib/output-tools';
import './OutputToolCards.css';

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
  const outputs = presentedOutputs(props.steps);
  const {questions} = followupPresentation(props.content, props.steps);
  if (!outputs.length && !questions.length) return null;
  return <div className="output-tool-cards">
    {outputs.map(item => <section className="output-tool-card" key={item.id}>
      <div className="output-tool-head">
        <div className="output-tool-title">{item.title || '成品文本'}</div>
        <button type="button" className="btn sm" onClick={() => void navigator.clipboard.writeText(item.text)}>复制文本</button>
      </div>
      <Markdown text={item.text}/>
    </section>)}
    {questions.length ? <section className="output-followups" aria-label="可选追问">
      {questions.map((question,index) => <button type="button" key={`${index}-${question}`} disabled={!props.onFollowup} onClick={() => props.onFollowup?.(question)}>{question}<span aria-hidden="true">↗</span></button>)}
    </section> : null}
  </div>;
}
