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

  // Sequence numbers of every authoritative frame this page observed. If a
  // sequence is missing here, it never reached the extension at all and the
  // loss is upstream - a reconnect, a reload, or a socket we never saw.
  const observed = window.__riftatlasObserved ?? { sockets: [], sequences: [], frames: 0 };
  window.__riftatlasObserved = observed;

  // Delivery counters published by the bridge from the isolated world.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source === 'riftatlas-replay-stats') {
      window.__riftatlasBridgeStats = event.data.stats;
    }
  });

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

      // Replay mode installs before this wrapper, so a socket it fakes arrives
      // here looking like a real one. Recording those would file a replay's own
      // playback as a fresh match - and could overwrite the real recording of
      // the room being replayed.
      if (this.__riftatlasSynthetic || window.__riftatlasReplayModeActive) return;

      const socketId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Replay mode reads this to refuse arming while a real match is open.
      if (href.includes('/parties/match/')) window.__riftatlasLiveMatch = href;
      post('open', { socketId, url: href, at: Date.now() });

      observed.sockets.push({ url: href, at: Date.now() });

      this.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        observed.frames++;
        // Cheap enough to parse: only authoritative frames carry a sequence.
        const at = event.data.indexOf('"sequence"');
        if (at > 0) {
          const m = /"sequence":(\d+)/.exec(event.data);
          if (m) observed.sequences.push(Number(m[1]));
        }
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
