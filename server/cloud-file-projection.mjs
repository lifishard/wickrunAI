// Shared by the browser and server migration. Only file contents move into the
// temporary relay; the reference remains part of the durable account directory.
export const isFileRef = value => Boolean(value && typeof value === 'object' &&
  /^[a-f0-9]{64}$/.test(value.sha256 || '') && Number.isSafeInteger(value.size) && value.size > 0);
export async function splitFilePayloads(data, hash) {
  const files = new Map();
  const walk = async (value, key = '') => {
    if (Array.isArray(value)) { const result=[]; for(const item of value)result.push(await walk(item,key));return result; }
    if (!value || typeof value !== 'object') return value;
    const attachment = typeof value.id === 'string' && typeof value.name === 'string' &&
      ['text', 'image', 'audio', 'video'].includes(value.kind) && typeof value.mime === 'string';
    const document = key === 'docs' && typeof value.id === 'string' && typeof value.name === 'string';
    if (attachment || document) {
      const { text, dataUrl, path: _localPath, cloudFile, ...metadata } = value;
      const payload = { ...(typeof text === 'string' && text ? { text } : {}), ...(typeof dataUrl === 'string' && dataUrl ? { dataUrl } : {}) };
      if (Object.keys(payload).length) {
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        const ref = { sha256: await hash(bytes), size: bytes.length };
        files.set(ref.sha256, { ref, bytes });
        return { ...metadata, ...(document ? { text: '' } : {}), cloudFile: ref };
      }
      return { ...metadata, ...(document ? { text: '' } : {}), ...(isFileRef(cloudFile) ? { cloudFile } : {}) };
    }
    const entries=[];
    for (const [name, item] of Object.entries(value)) entries.push([name,await walk(item, name)]);
    return Object.fromEntries(entries);
  };
  return { data: await walk(data), files };
}
export function fileReferences(data) {
  const refs = new Map();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (isFileRef(value.cloudFile)) refs.set(value.cloudFile.sha256, value.cloudFile);
    for (const [key, item] of Object.entries(value)) if (key !== 'cloudFile') visit(item);
  };
  visit(data); return [...refs.values()];
}
export function restoreFilePayloads(data, payloads) {
  const walk = value => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    if (isFileRef(value.cloudFile)) {
      const payload = payloads.get(value.cloudFile.sha256);
      if (payload) { if (typeof payload.text === 'string') result.text = payload.text; if (typeof payload.dataUrl === 'string') result.dataUrl = payload.dataUrl; }
    }
    return result;
  };
  return walk(data);
}
