import React from 'react';
import { desktop } from '../lib/transport';

export default function ArtifactImage({path,name}:{path:string;name:string}){
 const [url,setUrl]=React.useState(''),[error,setError]=React.useState('');
 React.useEffect(()=>{let disposed=false,objectUrl='';setUrl('');setError('');void desktop()!.artifactDocument(path).then(bytes=>{if(disposed)return;const ext=name.split('.').pop()?.toLowerCase();const type=ext==='jpg'||ext==='jpeg'?'image/jpeg':`image/${ext}`;objectUrl=URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer],{type}));setUrl(objectUrl);}).catch(e=>{if(!disposed)setError(String(e));});return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[path,name]);
 return error?<p role="alert">{error}</p>:url?<img src={url} alt={name} style={{display:'block',maxWidth:'100%',height:'auto',margin:'auto'}}/>:null;
}
