/**
 * Isolated-world bridge.
 *
 * The main-world observer cannot reach chrome.runtime, and the service worker
 * cannot see the page's sockets. This forwards one to the other and does
 * nothing else - in particular it never sends anything back into the page.
 *
 * Delivery is queued and retried. MV3 stops the service worker whenever it
 * looks idle, and a frame sent into a worker that is still waking up is simply
 * lost. An earlier version shrugged those off as "expected and recoverable" -
 * they are not: one dropped frame is a hole in the commit chain, and a hole
 * makes every later commit unreplayable. A real match lost 28 commits that way
 * and replayed as nine moves out of 396.
 *
 * A content script outlives the worker, so it can hold the frames until the
 * worker comes back.
 */
const TAG = 'riftatlas-replay';

/**
 * Delivery counters, readable from the page for diagnosis. `seen` counts frames
 * the observer handed over, `delivered` counts those the worker acknowledged.
 * A difference that never closes is a frame loss, and `retries` says whether
 * the worker going to sleep was the cause.
 */
const stats = { seen: 0, delivered: 0, retries: 0, failures: 0, maxQueue: 0, queued: 0 };

// The isolated world has its own `window`, so these counters are invisible to
// the page. Publish them across so a diagnosis can read the whole chain from
// one place.
setInterval(() => {
  try {
    window.postMessage({ source: 'riftatlas-replay-stats', stats: { ...stats } }, window.location.origin);
  } catch { /* the page is going away */ }
}, 2000);

/** Frames waiting to reach the worker, oldest first. Order is load-bearing. */
const queue = [];
let flushing = false;
let backoff = 0;

const MAX_BACKOFF = 5000;
const SEND_TIMEOUT_MS = 3000;
const MAX_QUEUE = 5000;   // ~a very long match; far past this something else is wrong

async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const message = queue[0];
    try {
      // A send can hang indefinitely if the worker dies mid-request, and the
      // whole queue stalls behind it - worse than dropping the frame, because
      // everything after it stops too. Bound the wait and retry instead.
      const ack = await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), SEND_TIMEOUT_MS)),
      ]);
      // A frame counts as delivered only when the worker says it stored it.
      // Anything else - no acknowledgement, or a failure - means try again.
      if (message.kind === 'frame' && !ack?.ok) throw new Error(ack?.error ?? 'no acknowledgement');
      queue.shift();
      stats.delivered++;
      stats.queued = queue.length;
      backoff = 0;
    } catch {
      // The worker is asleep, restarting, or the extension was reloaded. Wait
      // and try the same frame again - dropping it would break the chain.
      stats.retries++;
      if (!chrome.runtime?.id) { stats.failures++; flushing = false; return; }   // extension is gone
      backoff = Math.min(backoff ? backoff * 2 : 100, MAX_BACKOFF);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  flushing = false;
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== TAG) return;

  stats.seen++;
  if (queue.length >= MAX_QUEUE) { stats.failures++; return; }
  queue.push({
    type: 'observer',
    kind: msg.kind,
    socketId: msg.socketId,
    url: msg.url,
    at: msg.at,
    data: msg.data,
  });
  stats.queued = queue.length;
  if (queue.length > stats.maxQueue) stats.maxQueue = queue.length;
  flush();
});

// A closing page is the last chance to hand over anything still queued.
window.addEventListener('pagehide', () => { flush(); });
