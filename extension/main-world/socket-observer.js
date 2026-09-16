/**
 * Main-world WebSocket observer.
 *
 * Runs in the page's own world at document_start, before RiftAtlas opens its
 * match socket, and wraps `window.WebSocket` so *incoming* frames can be copied
 * out to the isolated world.
 *
 * READ-ONLY BY CONSTRUCTION. This file contains no path that can send a frame,
 * modify one, delay one, or suppress one:
 *
 *   - `send` is never wrapped, referenced, or called anywhere in this file.
 *   - Only a `message` listener is added, which cannot affect delivery.
 *   - Outgoing frames are not observed at all.
 *
 * That last point is a deliberate trade. Outgoing frames carry `action_intent`
 * and `presence_update`, neither of which a replay needs - the server's
 * authoritative commits are the record - plus the handshake, which carries
 * credentials we would only have to redact. Declining to look at them keeps the
 * read-only guarantee structural rather than a matter of reviewing the code
 * carefully, which is the difference between a replay tool and a cheat.
 */
(() => {
  const Native = window.WebSocket;
  if (!Native || Native.__riftatlasObserved) return;

  const TAG = 'riftatlas-replay';
  const MATCH = '/parties/';

  const post = (kind, payload) => {
    try {
      window.postMessage({ source: TAG, kind, ...payload }, window.location.origin);
    } catch {
      // A frame that will not structured-clone is not worth breaking the page for.
    }
  };

  class ObservedWebSocket extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      const href = String(url);
      if (!href.includes(MATCH)) return;

      const socketId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Replay mode reads this to refuse arming while a real match is open.
      if (href.includes('/parties/match/')) window.__riftatlasLiveMatch = href;
      post('open', { socketId, url: href, at: Date.now() });

      this.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        post('frame', { socketId, at: Date.now(), data: event.data });
      });
      this.addEventListener('close', () => {
        if (window.__riftatlasLiveMatch === href) delete window.__riftatlasLiveMatch;
        post('close', { socketId, at: Date.now() });
      });
    }
  }

  ObservedWebSocket.__riftatlasObserved = true;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    ObservedWebSocket[key] = Native[key];
  }
  window.WebSocket = ObservedWebSocket;
})();
