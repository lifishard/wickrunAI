import type { UserQuestionAnswers } from './user-questions';

/** One mounted question owns its edits. Saved snapshots are acknowledgements,
 * not replacements for text the user has already changed again. */
export function createQuestionDraft(initial: UserQuestionAnswers, publish: (value: UserQuestionAnswers) => void, delayMs = 400) {
  let value = initial;
  let edited = false;
  let dirty = false;
  let composing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const flush = () => {
    cancel();
    if (!dirty || composing) return;
    dirty = false;
    publish(value);
  };
  const schedule = () => { cancel(); if (dirty && !composing) timer = setTimeout(flush, delayMs); };
  return {
    current: () => value,
    receive(next: UserQuestionAnswers) {
      if (edited) return false;
      value = next;
      return true;
    },
    update(next: UserQuestionAnswers) { value = next; edited = dirty = true; schedule(); },
    composition(active: boolean) { composing = active; schedule(); },
    isComposing: () => composing,
    flush,
    submitted() { cancel(); dirty = false; },
    dispose() { composing = false; flush(); },
  };
}
