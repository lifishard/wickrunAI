import type { ChatMessage } from '../types';
import Markdown from './Markdown';
import OutputHistory from './OutputHistory';
import UserQuestionCard from './UserQuestionCard';
import CopyablePre from './CopyablePre';
export default function PreviousReplies({items}:{items?:ChatMessage[]}){
  if(!items?.length)return null;
  return <details className="reasoning"><summary>重答前的记录 · {items.length} 条</summary>{items.map(old=><section key={old.id}>
    <PreviousReplies items={old.previousReplies}/><OutputHistory items={old.outputHistory}/>
    {old.reasoning&&<details className="reasoning"><summary>思考过程</summary><div className="reasoning-body">{old.reasoning}</div></details>}
    <Markdown text={old.content} copyText />{old.userQuestionHistory?.map(q=><UserQuestionCard key={q.request.id} request={q.request} answers={q.answers} disabled onSubmit={()=>{}}/>)}
    {old.runState?.userQuestion&&!old.userQuestionHistory?.some(q=>q.request.id===old.runState?.userQuestion?.request.id)&&<UserQuestionCard request={old.runState.userQuestion.request} answers={old.runState.userQuestion.answers} disabled onSubmit={()=>{}}/>}
    {!!old.steps?.length&&<details><summary>当时的操作记录 · {old.steps.length} 项</summary>{old.steps.map(step=><div key={step.id}><strong>{step.name}</strong><CopyablePre text={JSON.stringify(step,null,2)} /></div>)}</details>}
  </section>)}</details>;
}
