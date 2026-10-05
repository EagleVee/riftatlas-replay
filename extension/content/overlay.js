/**
 * In-game overlay: what the opponent showed you and hid again.
 *
 * Off unless switched on in the popup. When on, and only while a live match
 * socket is open, it puts a small control in the corner of the board. It
 * collapses to one draggable icon so it never has to sit over anything that
 * matters.
 *
 * READ-ONLY, like everything else in the recorder. The overlay draws in its own
 * shadow root and never touches RiftAtlas' page, never talks to the match
 * socket, and learns nothing the server did not already send to this seat - the
 * reveals come from the recording, which holds exactly what this player saw.
 *
 * Card costs and colours come from main-world/card-catalog.js, which reads
 * them from RiftAtlas' own code as the page loads it. The list itself is
 * shared/reveal-panel.js.
 *
 * It also draws the same panel for replay mode, whose control bar has its own
 * eye button. Replay mode runs in the page's world, where the shared panel
 * cannot be loaded a second time, so it posts what to show and where, and this
 * draws it - see `replayReveals` below.
 */
(() => {
  if (window.top !== window) return;

  const TAG = 'riftatlas-replay';
  const CATALOG = 'riftatlas-replay-catalog';
  const ENABLED = 'overlayEnabled';
  const POSITION = 'overlayPosition';
  const ICON = 40;
  const MARGIN = 16;
  const REFRESH_MS = 700;

  const state = {
    enabled: false,
    room: null,
    socketRooms: new Map(),   // socketId -> room code, to know which close matters
    events: [],
    seenIds: new Set(),
    expanded: true,
    panel: false,             // the reveals list is open
    position: null,           // centre of the icon, in viewport px; null = default corner
    catalog: new Map(),
  };

  // ── Watching the match ───────────────────────────────────────────────────
  // The main-world observer already announces every match socket and frame to
  // the isolated world for the bridge. Listening to the same announcements
  // costs nothing and needs no new path into the page.

  const roomOf = (url) => /\/parties\/match\/([^/?#]+)/.exec(String(url))?.[1] ?? null;
  let refreshTimer = null;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.source === CATALOG && msg.catalog && typeof msg.catalog === 'object') {
      state.catalog = new Map(Object.entries(msg.catalog));
      render();
      replayPanel?.update(replayEvents, state.catalog);
      return;
    }
    if (!msg || msg.source !== TAG) return;
    if (msg.kind === 'open') {
      const room = roomOf(msg.url);
      if (!room) return;
      state.socketRooms.set(msg.socketId, room);
      if (state.room !== room) { state.room = room; state.events = []; }
      scheduleRefresh();
      render();
    } else if (msg.kind === 'close') {
      const room = state.socketRooms.get(msg.socketId);
      state.socketRooms.delete(msg.socketId);
      if (room && room === state.room && ![...state.socketRooms.values()].includes(room)) {
        state.room = null;
        render();
      }
    } else if (msg.kind === 'frame' && typeof msg.data === 'string'
      && msg.data.includes('"authoritative_')) {
      scheduleRefresh();
    }
  });

  /**
   * Ask for the reveals once the frames have settled. The worker writes each
   * frame before reading, so asking a moment after the last one lands sees it.
   */
  function scheduleRefresh() {
    if (!state.enabled || !state.room) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, REFRESH_MS);
  }

  async function refresh() {
    if (!state.enabled || !state.room || !chrome.runtime?.id) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'reveals', room: state.room });
      if (!res?.ok) return;
      const events = res.events ?? [];
      // Most frames change nothing here. Redrawing anyway would reset the
      // panel's scroll under the reader's thumb.
      if (JSON.stringify(events) === JSON.stringify(state.events)) return;
      state.events = events;
      if (state.panel) markSeen();
      render();
    } catch { /* the worker is waking up; the next frame asks again */ }
  }

  const markSeen = () => { for (const e of state.events) state.seenIds.add(e.id); };
  const unseen = () => state.events.filter((e) => !state.seenIds.has(e.id)).length;

  // In case the catalog went past before this script was listening.
  window.postMessage({ source: CATALOG, ask: true }, window.location.origin);

  // ── Settings ─────────────────────────────────────────────────────────────

  chrome.storage.local.get([ENABLED, POSITION]).then((stored) => {
    state.enabled = stored[ENABLED] === true;
    state.position = stored[POSITION] ?? null;
    scheduleRefresh();
    render();
  }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(ENABLED in changes)) return;
    state.enabled = changes[ENABLED].newValue === true;
    scheduleRefresh();
    render();
  });

  // ── Drawing ──────────────────────────────────────────────────────────────

  let host = null;
  let root = null;
  let dragging = false;   // a redraw mid-drag would drop the pointer
  let reveals = null;     // the shared panel, made once and moved into place

  const closePanel = () => { state.panel = false; reveals?.reset(); render(); };

  function mount() {
    if (host) return true;
    if (!document.body) return false;
    host = document.createElement('div');
    host.id = 'riftatlas-replay-overlay';
    // Above the board, and immune to the page's own styles.
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; inset: auto;';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
    document.body.append(host);
    reveals = globalThis.riftatlasRevealPanel.create({
      onClose: closePanel,
      emptyText: 'Nothing yet. When your opponent reveals their hand or the top of their deck, '
        + 'the cards appear here once they are hidden again.',
    });
    window.addEventListener('resize', () => render());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.panel) closePanel();
    });
    return true;
  }

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const svg = (markup) => {
    const span = el('span', 'svg');
    span.innerHTML = markup;   // static, ours
    return span;
  };

  /** Where the icon sits, clamped inside the window. */
  function iconCentre() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const half = ICON / 2;
    const p = state.position ?? { x: w - MARGIN - half, y: h - MARGIN - half };
    return {
      x: Math.min(Math.max(p.x, half + 4), w - half - 4),
      y: Math.min(Math.max(p.y, half + 4), h - half - 4),
    };
  }

  /** Which corner of the window the icon is nearest. */
  const sidesFor = ({ x, y }) => ({
    right: x > window.innerWidth / 2,
    below: y > window.innerHeight / 2,
  });

  /** Put the host where the icon is, measured from the given corner. */
  function place(sides) {
    const { x, y } = iconCentre();
    const half = ICON / 2;
    host.style.left = sides.right ? 'auto' : `${x - half}px`;
    host.style.right = sides.right ? `${window.innerWidth - x - half}px` : 'auto';
    host.style.top = sides.below ? 'auto' : `${y - half}px`;
    host.style.bottom = sides.below ? `${window.innerHeight - y - half}px` : 'auto';
    return sides;
  }

  function render() {
    if (dragging) return;
    const show = state.enabled && !!state.room;
    if (!show) { if (host) host.style.display = 'none'; return; }
    if (!mount()) { document.addEventListener('DOMContentLoaded', render, { once: true }); return; }
    host.style.display = '';

    // Anchor to the corner nearest the icon, and grow toward the middle of the
    // window, so the panel never opens off screen wherever the icon was left.
    const { right, below } = place(sidesFor(iconCentre()));

    for (const node of [...root.childNodes]) if (node.tagName !== 'STYLE') node.remove();
    const frame = el('div', `frame ${right ? 'right' : 'left'} ${below ? 'below' : 'above'}`);

    const bar = el('div', 'bar');
    bar.append(logoButton());
    if (state.expanded) bar.append(eyeButton());
    frame.append(bar);

    if (state.expanded && state.panel) {
      reveals.update(state.events, state.catalog);
      frame.append(reveals.element);
    }
    root.append(frame);
  }

  /** The one icon that is always there: drag it anywhere, click to fold. */
  function logoButton() {
    const button = el('button', 'logo');
    button.title = state.expanded
      ? 'RiftAtlas Replay — click to collapse, drag to move'
      : 'RiftAtlas Replay — click to expand, drag to move';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(state.expanded));
    const img = el('img');
    img.src = chrome.runtime.getURL('icons/icon48.png');
    img.alt = '';
    img.draggable = false;
    button.append(img);
    if (!state.expanded && unseen()) button.append(el('span', 'dot'));

    let start = null;
    let moved = false;
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const centre = iconCentre();
      start = { px: e.clientX, py: e.clientY, ...centre, sides: sidesFor(centre) };
      moved = false;
      button.setPointerCapture(e.pointerId);
    });
    button.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      dragging = true;
      state.position = { x: start.x + dx, y: start.y + dy };
      // Move, do not redraw: redrawing would replace this button and drop the
      // pointer it is holding. The corner is re-chosen on release.
      place(start.sides);
    });
    const end = () => {
      if (!start) return;
      start = null;
      dragging = false;
      if (moved) {
        state.position = iconCentre();
        chrome.storage.local.set({ [POSITION]: state.position }).catch(() => {});
        render();
      } else {
        state.expanded = !state.expanded;
        render();
      }
    };
    button.addEventListener('pointerup', end);
    button.addEventListener('pointercancel', end);
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.expanded = !state.expanded; render(); }
    });
    return button;
  }

  function eyeButton() {
    const button = el('button', `tool${state.panel ? ' on' : ''}`);
    button.title = 'Cards your opponent revealed, then hid again';
    button.setAttribute('aria-label', 'Revealed cards');
    button.setAttribute('aria-pressed', String(state.panel));
    button.append(svg(globalThis.riftatlasRevealPanel.EYE));
    const fresh = unseen();
    if (fresh) button.append(el('span', 'badge', String(fresh)));
    button.onclick = () => {
      if (state.panel) { closePanel(); return; }
      state.panel = true;
      markSeen();
      render();
    };
    return button;
  }

  // ── Replay mode's panel ──────────────────────────────────────────────────
  // Replay mode says which reveals are listed at the scrubber's position and
  // where its bar is; this draws them beside the bar and reports back.

  const TO_PANEL = 'riftatlas-replay-reveals';
  const FROM_PANEL = 'riftatlas-replay-reveals-panel';
  let replayHost = null;
  let replayPanel = null;
  let replayEvents = [];
  const tell = (m) => window.postMessage({ source: FROM_PANEL, ...m }, window.location.origin);

  function replayReveals(msg) {
    if (!msg.open) { replayHost?.remove(); replayPanel?.reset(); return; }
    if (!document.body) return;
    if (!replayPanel) {
      replayPanel = globalThis.riftatlasRevealPanel.create({
        onClose: () => tell({ kind: 'closed' }),
        onJump: (e) => tell({ kind: 'jump', id: e.id, sequence: e.openedSequence }),
        emptyText: 'Nothing revealed and hidden again up to this point in the match.',
      });
      replayHost = document.createElement('div');
      replayHost.id = 'riftatlas-replay-reveals';
      replayHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
      replayHost.append(replayPanel.element);
    }
    replayEvents = Array.isArray(msg.events) ? msg.events : [];
    replayPanel.update(replayEvents, state.catalog);
    if (!replayHost.isConnected) document.body.append(replayHost);

    // Above the bar when it sits low, below it when it sits high, lined up
    // with its right-hand end, where the eye button is.
    const a = msg.anchor ?? {};
    const s = replayHost.style;
    s.top = s.bottom = '';
    if ((a.top ?? 0) > window.innerHeight / 2) s.bottom = `${Math.max(8, window.innerHeight - a.top + 8)}px`;
    else s.top = `${Math.max(8, (a.bottom ?? 0) + 8)}px`;
    s.right = `${Math.max(8, window.innerWidth - (a.right ?? window.innerWidth))}px`;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== TO_PANEL) return;
    replayReveals(event.data);
  });

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .frame { display: flex; gap: 8px; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
      color: #dbe7f3; }
    .frame.below { flex-direction: column-reverse; }
    .frame.above { flex-direction: column; }
    .frame.right { align-items: flex-end; }
    .frame.left { align-items: flex-start; }
    .bar { display: flex; gap: 6px; align-items: center; }
    .frame.right .bar { flex-direction: row-reverse; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .logo { position: relative; width: ${ICON}px; height: ${ICON}px; padding: 0; border-radius: 50%;
      border: 1px solid #24313f; background: #0b1017; box-shadow: 0 4px 14px rgba(0,0,0,.45);
      touch-action: none; cursor: grab; display: grid; place-items: center; }
    .logo:active { cursor: grabbing; }
    .logo img { width: 26px; height: 26px; pointer-events: none; }
    .logo:hover, .tool:hover { border-color: #74efff; }
    .logo:focus-visible, button:focus-visible { outline: 2px solid #74efff; outline-offset: 2px; }
    .dot { position: absolute; top: 2px; right: 2px; width: 9px; height: 9px; border-radius: 50%;
      background: #74efff; border: 2px solid #0b1017; }
    .tool { position: relative; width: 36px; height: 36px; border-radius: 8px; padding: 0;
      border: 1px solid #24313f; background: #121a24; display: grid; place-items: center;
      box-shadow: 0 4px 14px rgba(0,0,0,.4); }
    .tool.on { border-color: #d8b76e; color: #d8b76e; }
    .badge { position: absolute; top: -6px; right: -6px; min-width: 17px; height: 17px; padding: 0 4px;
      border-radius: 9px; background: #74efff; color: #0b1017; font-size: 10.5px; font-weight: 700;
      line-height: 17px; text-align: center; }
    .svg { display: grid; place-items: center; }
  `;
})();
