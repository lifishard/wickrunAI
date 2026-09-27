/** Ignore only keys belonging to an active IME composition, without a cooldown. */
export function isCompositionKey(event: { isComposing?: boolean; keyCode?: number }, composing: boolean): boolean {
  return composing || event.isComposing === true || event.keyCode === 229;
}
