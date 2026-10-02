'use strict';

/**
 * Progress plumbing for native clients (Grok, Kimi and any other client that
 * streams many small events).
 *
 * A turn that drives tools can emit thousands of events a second. Writing a
 * checkpoint and sending an IPC message for each one froze the whole window,
 * because both ran on the main process. These helpers keep every event's
 * effect but bound the work: at most one checkpoint write is in flight, and
 * consecutive events of the same kind travel to the renderer as one message.
 */

/** Keep the tail of a growing string without copying it on every append. */
function appendTail(current, addition, limit) {
  const next = current + addition;
  // Trim only after 10% slack so a long stream is not re-sliced per token.
  return next.length > limit + Math.ceil(limit / 10) ? next.slice(-limit) : next;
}

function createCheckpointWriter({
  snapshot, write, onError = () => {}, interval = 500,
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now,
} = {}) {
  let dirty = false, timer = null, inflight = null, closed = false, last = -Infinity;

  function schedule() {
    if (timer || inflight || closed || !dirty) return;
    const delay = Math.max(0, interval - (now() - last));
    timer = setTimer(run, delay);
    timer?.unref?.();
  }
  function run() {
    timer = null;
    if (!dirty || closed) return;
    dirty = false;
    last = now();
    let value;
    try { value = snapshot(); } catch (error) { onError(error); return; }
    inflight = Promise.resolve().then(() => write(value)).catch(onError).finally(() => {
      inflight = null;
      schedule();
    });
  }
  return {
    /** Something changed; persist the latest state soon. */
    touch() { if (closed) return; dirty = true; schedule(); },
    /**
     * Stop scheduling, finish the write in flight and save any change not yet
     * written. After this resolves the caller may write the terminal record
     * without a late checkpoint overwriting it.
     */
    async close() {
      if (timer) { clearTimer(timer); timer = null; }
      const wasClosed = closed;
      closed = true;
      if (inflight) await inflight;
      if (dirty && !wasClosed) {
        dirty = false;
        try { await write(snapshot()); } catch (error) { onError(error); }
      }
    },
  };
}

/**
 * Merge bursts of renderer events. Within one window, all text of the same
 * kind travels as one message and each tool call is reported once, in its
 * latest state. Kinds feed separate parts of the screen, so merging across
 * kinds changes nothing visible; any other event (an approval request, say)
 * flushes everything pending first so it can never overtake earlier output.
 */
function createEventBatcher({
  emit, interval = 100,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let pending = new Map(), timer = null;

  function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    const batch = [...pending.values()];
    pending = new Map();
    for (const message of batch) emit(message);
  }
  function arm() {
    if (timer) return;
    timer = setTimer(flush, interval);
    timer?.unref?.();
  }
  return {
    push(message) {
      const type = message?.type;
      if (!['reasoning', 'delta', 'activity', 'plan', 'waiting'].includes(type)) {
        flush();
        emit(message);
        return;
      }
      const id = type === 'activity' ? message.event?.toolCall?.toolCallId : null;
      const key = id ? `activity:${id}` : type;
      const existing = pending.get(key);
      if (existing && (type === 'reasoning' || type === 'delta')) existing.text += message.text;
      else if (existing) pending.set(key, message); // newest state of that tool call / plan / wait
      else pending.set(key, { ...message });
      arm();
    },
    flush,
  };
}

module.exports = { appendTail, createCheckpointWriter, createEventBatcher };
