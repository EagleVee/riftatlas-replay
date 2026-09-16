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

/** Frames waiting to reach the worker, oldest first. Order is load-bearing. */
const queue = [];
let flushing = false;
let backoff = 0;

const MAX_BACKOFF = 5000;
const MAX_QUEUE = 5000;   // ~a very long match; far past this something else is wrong

async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const message = queue[0];
    try {
      await chrome.runtime.sendMessage(message);
      queue.shift();
      backoff = 0;
    } catch {
      // The worker is asleep, restarting, or the extension was reloaded. Wait
      // and try the same frame again - dropping it would break the chain.
      if (!chrome.runtime?.id) { flushing = false; return; }   // extension is gone
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

  if (queue.length >= MAX_QUEUE) return;
  queue.push({
    type: 'observer',
    kind: msg.kind,
    socketId: msg.socketId,
    url: msg.url,
    at: msg.at,
    data: msg.data,
  });
  flush();
});

// A closing page is the last chance to hand over anything still queued.
window.addEventListener('pagehide', () => { flush(); });
