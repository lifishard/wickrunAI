import React from 'react';
import { desktop } from '../lib/transport';
import ArtifactMedia from './ArtifactMedia';

/** Images are streamed like video; only files outside the authorised folders fall back to reading bytes. */
export default function ArtifactImage({path,name}:{path:string;name:string}){
 const [fallback,setFallback]=React.useState(''),[error,setError]=React.useState(''),[streamed,setStreamed]=React.useState<boolean|null>(null);
 React.useEffect(()=>{
  let disposed=false,objectUrl='';setFallback('');setError('');setStreamed(null);
  const bridge=desktop();
  const bytes=()=>bridge!.artifactDocument(path).then(data=>{if(disposed)return;const ext=name.split('.').pop()?.toLowerCase();const type=ext==='jpg'||ext==='jpeg'?'image/jpeg':`image/${ext}`;objectUrl=URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer],{type}));setFallback(objectUrl);}).catch(e=>{if(!disposed)setError(String(e));});
  if(!bridge?.mediaUrl){void bytes();return()=>{disposed=true;};}
  void bridge.mediaUrl(path).then(()=>{if(!disposed)setStreamed(true);}).catch(()=>{if(!disposed){setStreamed(false);void bytes();}});
  return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[path,name]);
 if(streamed)return <ArtifactMedia path={path} name={name} type="image"/>;
 return error?<p role="alert">{error}</p>:fallback?<img src={fallback} alt={name} style={{display:'block',maxWidth:'100%',height:'auto',margin:'auto'}}/>:null;
}
