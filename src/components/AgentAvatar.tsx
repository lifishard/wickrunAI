export default function AgentAvatar({name,color='#5b7da4',seed=''}:{name:string;color?:string;seed?:string}){
  const n=[...seed].reduce((sum,c)=>sum+c.charCodeAt(0),0);
  return <svg className="agent-avatar" viewBox="0 0 32 32" role="img" aria-label={`${name}的角色形象`} shapeRendering="crispEdges"><rect width="32" height="32" rx="5" fill="currentColor" opacity=".07"/><path d="M7 29v-8h4v-3h10v3h4v8" fill={color}/><path d="M10 8h12v11H10z" fill="#e5bd94"/><path d={n%2?'M9 7h14v5H9zM9 12h3v4H9z':'M10 6h12v4H10zM8 9h16v3H8z'} fill={n%3?'#55443e':color}/><path d="M12 13h2v2h-2zM18 13h2v2h-2z" fill="#292933"/><path d="M14 17h4v1h-4z" fill="#865750"/>{n%2?<path d="M15 21h2v7h-2z" fill="#f4eddd"/>:<path d="M10 23h5v3h-5z" fill="#f4eddd"/>}</svg>;
}
