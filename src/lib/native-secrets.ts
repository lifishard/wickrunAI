import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const secrets = registerPlugin<{
  get(options: {key: string}): Promise<{value: string | null}>;
  set(options: {key: string; value: string}): Promise<void>;
  remove(options: {key: string}): Promise<void>;
}>('WickrunSecrets');

const pending = new Map<string, Promise<unknown>>();
function serialized<T>(id: string, action: () => Promise<T>): Promise<T> {
  const run = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
  pending.set(id, run);
  void run.finally(() => { if (pending.get(id) === run) pending.delete(id); }).catch(() => {});
  return run;
}

export function nativeSecretGet(id: string) { return serialized(id, async () => {
  const key = `secret:${id}`;
  const secure = await secrets.get({key});
  if (secure.value !== null && secure.value !== undefined) {
    await Preferences.remove({key});
    return secure.value;
  }
  const legacy = await Preferences.get({key});
  if (legacy.value !== null) {
    // Remove plaintext only after durable secure storage succeeds.
    await secrets.set({key, value: legacy.value});
    await Preferences.remove({key});
  }
  return legacy.value;
}); }
export function nativeSecretSet(id: string, value: string) { return serialized(id, async () => {
  const key = `secret:${id}`;
  await secrets.set({key, value});
  await Preferences.remove({key});
}); }
export function nativeSecretDelete(id: string) { return serialized(id, async () => {
  const key = `secret:${id}`;
  // A failed legacy cleanup must not make a deleted credential reappear later.
  await Preferences.remove({key});
  await secrets.remove({key});
}); }
