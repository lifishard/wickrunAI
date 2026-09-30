/** Stop waiting locally even when an IPC or provider call ignores cancellation. */
export async function awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    throw new DOMException('已暂停', 'AbortError');
  }
  let stop = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      stop = () => reject(new DOMException('已暂停', 'AbortError'));
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    })]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
