import type { OutputSnapshot } from '../lib/output-history';
import Markdown from './Markdown';
export default function OutputHistory({items}:{items?:OutputSnapshot[]}) {
  if(!items?.length)return null;
  return <details className="reasoning output-history"><summary>此前输出 · {items.length} 段（可展开查看）</summary>
    <p className="hint">保留被重试或后续回复替换的原文，供回看；不代表最终结论。</p>
    {items.map((item,i)=><section key={item.id}><h4>第 {i+1} 段 · {new Date(item.at).toLocaleTimeString()}</h4>
      {item.reasoning&&<details className="reasoning"><summary>思考过程</summary><div className="reasoning-body">{item.reasoning}</div></details>}
      {item.content&&<Markdown text={item.content} copyText />}</section>)}
  </details>;
}
