export interface SyncFileRef { sha256: string; size: number; encrypted?: true }
export function isFileRef(value: unknown): value is SyncFileRef;
export function splitFilePayloads<T>(data:T,hash:(bytes:Uint8Array)=>Promise<string>|string):Promise<{data:T;files:Map<string,{ref:SyncFileRef;bytes:Uint8Array}>}>;
export function fileReferences(data:unknown):SyncFileRef[];
export function restoreFilePayloads<T>(data:T,payloads:Map<string,{text?:string;dataUrl?:string}>):T;
