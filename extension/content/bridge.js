/**
 * Isolated-world bridge.
 *
 * The main-world observer cannot reach chrome.runtime, and the service worker
 * cannot see the page's sockets. This forwards one to the other and does nothing
 * else - in particular it never sends anything back into the page.
 */
const TAG = 'riftatlas-replay';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== TAG) return;

  chrome.runtime.sendMessage({
    type: 'observer',
    kind: msg.kind,
    socketId: msg.socketId,
    url: msg.url,
    at: msg.at,
    data: msg.data,
  }).catch(() => {
    // The worker restarts constantly under MV3; a dropped message is expected
    // and recoverable because state lives in IndexedDB, not in the worker.
  });
});
