/**
 * Replay mode: render a recorded match in RiftAtlas' own UI.
 *
 * RiftAtlas' client renders a game purely from frames it receives - that is how
 * spectating works. So a replay can be shown in their real board by answering
 * the client's match socket locally with recorded frames instead of connecting
 * to a server.
 *
 * ── Why this is not a cheat, structurally ────────────────────────────────────
 *
 * This file is the ONLY place in the extension that originates frames, and it
 * is fenced off from everything else:
 *
 *   1. It is never listed in `content_scripts`. It cannot run unless the user
 *      explicitly asks for it, via chrome.scripting.executeScript from the
 *      popup.
 *   2. It is armed with exactly one room code - the one in the loaded replay -
 *      and intercepts ONLY `/parties/match/<that room>`. Every other socket,
 *      including any live match, is handed to the real WebSocket untouched.
 *   3. The frames it produces never reach a network. A FakeSocket has no
 *      transport; `send()` is a sink. Nothing here can talk to RiftAtlas'
 *      servers, in a live game or otherwise.
 *   4. It refuses to arm while a live match socket is open in the page.
 *
 * The recorder, by contrast, never sends. The two capabilities live in separate
 * files with no shared code path, so neither can drift into the other.
 */
(() => {
  // Two ways in. A replay already parked on `window` (development, and the
  // tests) starts immediately; otherwise wait briefly for arm.js to post one
  // from the isolated world, which is how the popup arms at document_start.
  const parked = window.__riftatlasReplayArm;
  if (parked?.replay) {
    delete window.__riftatlasReplayArm;
    begin(parked.replay, parked);
  } else {
    const onArm = (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== 'riftatlas-replay-arm' || !event.data.replay) return;
      window.removeEventListener('message', onArm);
      begin(event.data.replay, {});
    };
    window.addEventListener('message', onArm);
    // Tell arm.js we are listening, in case it ran first.
    window.postMessage({ source: 'riftatlas-replay-ready' }, window.location.origin);
  }

function begin(replay, ARM) {
  const ROOM = replay.match?.roomCode;
  if (!ROOM) {
    console.warn('[riftatlas-replay] replay mode: replay has no room code');
    return;
  }

  // Guard 3: refuse if the page already holds a live match socket.
  if (window.__riftatlasLiveMatch) {
    console.warn('[riftatlas-replay] replay mode refused: a live match is open');
    return;
  }

  const TARGET = `/parties/match/${ROOM}`;
  const Native = window.WebSocket;   // may already be the recorder's observer
  const DEBUG = !!ARM.debug;
  const send = (socket, obj) => {
    if (DEBUG) console.log('[riftatlas-replay] <- client', obj.type, obj.sequence ?? '');
    socket._emit(JSON.stringify(obj));
  };

  // ---------------------------------------------------------------- timeline

  const states = new Map();   // sequence -> [state, log]
  const order = [];
  const meta = new Map();     // sequence -> { action, narrated }

  function clone(v) { return structuredClone(v); }

  (function materialise() {
    // A compact inline reduction: replay mode runs in the page's world, where
    // module imports are not available, so the reducer's semantics are mirrored
    // here. tools/reducer.py remains normative; keep the two in step.
    const apply = (state, log, op) => {
      const P = (id) => state.players.find((p) => p.id === id);
      const Z = (id, z) => { const b = P(id).board; return (b[z] ??= []); };
      switch (op.op) {
        case 'set_room_fields': Object.assign(state, op.fields); break;
        case 'unset_room_fields': for (const f of op.fields) delete state[f]; break;
        case 'set_player_fields': Object.assign(P(op.playerId), op.fields); break;
        case 'set_board_fields': Object.assign(P(op.playerId).board, op.fields); break;
        case 'zone_insert': Z(op.playerId, op.zone).splice(op.index, 0, ...clone(op.cards)); break;
        case 'zone_remove': {
          const b = P(op.playerId).board, drop = new Set(op.cardIds);
          b[op.zone] = (b[op.zone] ?? []).filter((c) => !drop.has(c.id)); break;
        }
        case 'zone_reorder': {
          const b = P(op.playerId).board;
          const by = new Map((b[op.zone] ?? []).map((c) => [c.id, c]));
          b[op.zone] = op.cardIds.filter((i) => by.has(i)).map((i) => by.get(i)); break;
        }
        case 'zone_move': {
          const sb = P(op.from.playerId).board;
          const had = (sb[op.from.zone] ?? []).find((c) => c.id === op.cardId);
          sb[op.from.zone] = (sb[op.from.zone] ?? []).filter((c) => c.id !== op.cardId);
          const dz = Z(op.to.playerId, op.to.zone);
          dz.splice(op.to.index ?? dz.length, 0, clone(op.card ?? had)); break;
        }
        case 'patch_card_fields':
          for (const c of Z(op.playerId, op.zone)) if (c.id === op.cardId) Object.assign(c, op.fields);
          break;
        case 'unset_card_fields':
          for (const c of Z(op.playerId, op.zone)) if (c.id === op.cardId) for (const f of op.fields) delete c[f];
          break;
        case 'log_insert': log.splice(op.index, 0, ...clone(op.entries)); break;
        case 'log_remove': {
          const drop = new Set(op.entryIds);
          const kept = log.filter((e) => !drop.has(e.id));
          log.length = 0; log.push(...kept); break;
        }
        case 'chain_insert': (state.chainEntries ??= []).splice(op.index, 0, ...clone(op.entries)); break;
        case 'chain_remove': {
          const drop = new Set(op.entryIds);
          state.chainEntries = (state.chainEntries ?? []).filter((e) => !drop.has(e.id)); break;
        }
        case 'chain_replace': {
          const by = new Map(op.entries.map((e) => [e.id, e]));
          state.chainEntries = (state.chainEntries ?? []).map((e) => (by.has(e.id) ? clone(by.get(e.id)) : e));
          break;
        }
        default: throw new Error('unknown op ' + op.op);
      }
    };

    let state = clone(replay.origin.snapshot);
    let log = clone(replay.origin.gameplayLog ?? []);
    let seq = replay.origin.sequence;
    const repairs = new Map((replay.gaps ?? []).filter((g) => g.snapshot)
      .map((g) => [g.toSequence, g]));
    states.set(seq, [clone(state), clone(log)]); order.push(seq);

    for (const commit of replay.commits) {
      if (commit.baseSequence !== seq) {
        const repair = repairs.get(commit.baseSequence);
        if (!repair) continue;
        state = clone(repair.snapshot); log = clone(repair.gameplayLog ?? []);
        seq = commit.baseSequence;
        states.set(seq, [clone(state), clone(log)]);
        if (!order.includes(seq)) order.push(seq);
      }
      for (const op of commit.operations) apply(state, log, op);
      seq = commit.sequence;
      meta.set(seq, {
        action: commit.action?.type ?? null,
        narrated: commit.operations.some((op) => op.op === 'log_insert'),
      });
      states.set(seq, [clone(state), clone(log)]);
      order.push(seq);
    }
    order.sort((a, b) => a - b);
  })();

  let cursor = 0;
  /**
   * The client discards a snapshot whose sequence is not newer than what it
   * already has, so seeking backwards is ignored if we send the replay's own
   * sequence. Snapshots are authoritative resyncs, so we present a wire
   * sequence that only ever climbs and carry the state of whatever replay
   * sequence the cursor is on. The replay's real sequence stays in the control
   * bar, which is where a viewer reads it.
   */
  let wire = 0;
  const clockAt = (seq) => {
    const commit = replay.commits.find((c) => c.sequence === seq);
    return commit?.actionClock ?? replay.origin.actionClock ?? null;
  };

  // ---------------------------------------------------------------- fake socket

  const sockets = new Set();

  /**
   * The room document presented to the client, with the viewer rewritten to a
   * spectator of the recorded match.
   */
  function shellFor(socket) {
    const shell = clone(replay.shell ?? {});
    shell.viewer = { role: 'spectator', playerId: socket._viewerId ?? null };
    shell.canReturnToLobby = true;
    delete shell.selfPlayer;
    shell.publicPlayers = (replay.players ?? []).map((p) => ({
      id: p.id, seat: p.seat, name: p.name, joinedAt: shell.createdAt ?? 0,
      battlefieldOptionCount: 3, isSealedSeat: false,
    }));
    return shell;
  }

  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      // Tells the recorder's observer that these frames are ours, not a match.
      this.__riftatlasSynthetic = true;
      this.url = String(url);
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.extensions = '';
      this.protocol = '';
      this.binaryType = 'blob';
      sockets.add(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this._fire('open', new Event('open'));
      });
    }

    /** No transport exists. The client's frames are read for handshake cues and dropped. */
    send(data) {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (DEBUG) console.log('[riftatlas-replay] client ->', msg.type);
      if (msg.type === 'join_shell') {
        // The replay's own viewer is whoever recorded it, which is not whoever
        // is signed in now. Answer as a spectator of that match instead, which
        // is a role the client already knows how to render and does not require
        // the viewer to be one of the seated players.
        this._viewerId = msg.playerId ?? null;
        send(this, { type: 'room_shell_sync', gameInstanceId: ROOM, sessionDoc: shellFor(this), sequence: 4 });
        send(this, { type: 'setup_log_sync', gameInstanceId: ROOM, log: [] });
      } else if (msg.type === 'join_game' || msg.type === 'resume_game') {
        send(this, { type: 'auth_session', gameInstanceId: ROOM, tokenRemainingMs: 3600000 });
        send(this, { type: 'room_shell_sync', gameInstanceId: ROOM, sessionDoc: shellFor(this), sequence: 5 });
        send(this, { type: 'chat_sync', gameInstanceId: ROOM, chatEntries: replay.chat ?? [],
          chatAccess: { canSend: false, authorId: replay.viewer?.playerId ?? null } });
        send(this, { type: 'judge_call_sync', gameInstanceId: ROOM, judgeCall: null, judgeCalls: [], cooldownRemainingMs: 0 });
        send(this, { type: 'spectator_roster_sync', gameInstanceId: ROOM,
          spectators: this._viewerId ? [{ playerId: this._viewerId, name: 'Replay' }] : [] });
        send(this, { type: 'presence_event', gameInstanceId: ROOM,
          event: { type: 'presence_snapshot', playerId: replay.viewer?.playerId,
            connectedPlayerIds: (replay.players ?? []).map((p) => p.id) } });
        this._pushState();
        send(this, { type: 'rewind_confirmation_state', gameInstanceId: ROOM, confirmation: null });
      }
      // Everything else - action_intent, presence_update, chat_send - is dropped.
    }

    close() {
      this.readyState = 3;
      sockets.delete(this);
      this._fire('close', new CloseEvent('close', { wasClean: true, code: 1000 }));
    }

    _emit(text) {
      if (this.readyState !== 1) return;
      this._fire('message', new MessageEvent('message', { data: text }));
    }

    _fire(type, event) {
      const handler = this['on' + type];
      if (typeof handler === 'function') handler.call(this, event);
      this.dispatchEvent(event);
    }

    /** Push the materialised state at the cursor as an authoritative snapshot. */
    _pushState() {
      const seq = order[cursor];
      const [state, log] = states.get(seq);
      send(this, {
        type: 'authoritative_snapshot', gameInstanceId: ROOM,
        sequence: ++wire, snapshot: clone(state), gameplayLog: clone(log),
        actionClock: clockAt(seq),
      });
    }
  }
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) FakeSocket[k] = Native[k];

  // Guard 2: only the armed room is intercepted; everything else passes through.
  function Intercepted(url, protocols) {
    if (String(url).includes(TARGET)) return new FakeSocket(url);
    return new Native(url, protocols);
  }
  Intercepted.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Intercepted[k] = Native[k];
  Intercepted.__riftatlasReplayMode = ROOM;
  window.WebSocket = Intercepted;
  // Belt and braces: the observer also stands down entirely while replay mode
  // is live, whichever order the two wrappers ended up in.
  window.__riftatlasReplayModeActive = ROOM;

  // ---------------------------------------------------------------- controls

  /**
   * Playback pacing.
   *
   * A flat one second per commit reads badly, because one player action often
   * lands as several commits: exhausting four runes is four of them, and so is
   * nudging a counter up four times. Measured on the reference match, 21 runs
   * of three or more identical actions cover 91 of its 369 commits.
   *
   * So a step gets the full beat only when it is something new to look at.
   * A step that repeats the previous action, or that the game did not narrate
   * in its own log, flicks past. The reference match plays in about four
   * minutes rather than six, and the runes still visibly go down one by one.
   */
  const BASE_MS = 1000;
  const RUN_MS = 180;
  let playing = false;
  let timer = null;

  const atEnd = () => cursor >= order.length - 1;

  /** How long to hold before showing `order[index]`. */
  function delayFor(index) {
    const here = meta.get(order[index]);
    if (!here) return BASE_MS;
    const previous = index > 0 ? meta.get(order[index - 1]) : null;
    const continuesRun = !!previous && !!here.action && here.action === previous.action;
    return (continuesRun || !here.narrated) ? RUN_MS : BASE_MS;
  }

  /**
   * `fromAuto` distinguishes playback's own advance from a person reaching for
   * the controls. Any manual move stops playback - otherwise the bar keeps
   * advancing out from under someone who just scrubbed somewhere to look at it.
   */
  function seek(index, fromAuto) {
    if (!fromAuto) stop();
    cursor = Math.max(0, Math.min(order.length - 1, index));
    for (const socket of sockets) socket._pushState();
    paint();
  }

  function schedule() {
    if (!playing) return;
    if (atEnd()) { stop(); return; }
    timer = setTimeout(() => {
      timer = null;
      if (!playing) return;
      seek(cursor + 1, true);
      schedule();
    }, delayFor(cursor + 1));
  }

  function stop() {
    if (!playing && !timer) return;
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    paintTransport();
  }

  function play() {
    if (playing) return;
    if (atEnd()) seek(0);
    playing = true;
    schedule();
    paintTransport();
  }

  const toggle = () => (playing ? stop() : play());

  const LAST = order.at(-1);
  const DIGITS = String(LAST).length;

  const bar = document.createElement('div');
  bar.id = 'riftatlas-replay-bar';
  // Fixed geometry. Nothing in here may resize as the cursor moves: the board
  // is the thing being read, and a control bar that reflows under the pointer
  // makes stepping feel unreliable.
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:14px',
    'z-index:2147483647', 'box-sizing:border-box',
    'width:min(520px, calc(100vw - 32px))', 'height:46px',
    'display:flex', 'align-items:center', 'gap:6px', 'flex-wrap:nowrap',
    'padding:0 10px', 'border:1px solid rgba(216,183,110,.55)', 'border-radius:10px',
    'background:rgba(8,12,18,.94)', 'color:#dbe7f3',
    'font:12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif',
    'white-space:nowrap', 'user-select:none',
    'box-shadow:0 6px 24px rgba(0,0,0,.55)', 'backdrop-filter:blur(4px)',
  ].join(';');

  const BTN = [
    'flex:0 0 auto', 'width:30px', 'height:30px', 'padding:0',
    'display:grid', 'place-items:center',
    'font:14px/1 ui-sans-serif,system-ui,sans-serif', 'color:inherit',
    'background:#16202c', 'border:1px solid #24313f', 'border-radius:6px',
    'cursor:pointer', 'white-space:nowrap', 'overflow:hidden',
  ].join(';');

  const mk = (glyph, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.style.cssText = BTN;
    b.onmouseenter = () => { b.style.borderColor = '#74efff'; };
    b.onmouseleave = () => { b.style.borderColor = '#24313f'; };
    b.onclick = fn;
    return b;
  };

  // A dot rather than the room code: the room is already shown in the client's
  // own header, and a variable-length code would change the bar's width.
  const badge = document.createElement('span');
  badge.textContent = 'REPLAY';
  badge.title = `Replaying ${ROOM}`;
  badge.style.cssText = 'flex:0 0 auto;color:#d8b76e;letter-spacing:.1em;font-weight:700;font-size:10px';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(order.length - 1);
  slider.step = '1';
  slider.value = '0';
  slider.title = 'Scrub';
  slider.style.cssText = 'flex:1 1 auto;min-width:60px;margin:0 2px;accent-color:#d8b76e;cursor:pointer';
  slider.oninput = () => seek(Number(slider.value));   // manual: stops playback

  // Tabular figures and a width reserved for the largest value, so the counter
  // cannot nudge its neighbours as the numbers grow.
  const counter = document.createElement('span');
  counter.style.cssText = `flex:0 0 auto;color:#8698ab;font-variant-numeric:tabular-nums;`
    + `min-width:${DIGITS * 2 + 3}ch;text-align:right`;

  const transport = mk('\u25B6', 'Play (space)', toggle);

  bar.append(
    badge,
    mk('\u23EE', 'First (Home)', () => seek(0)),
    mk('\u25C0', 'Previous step (left arrow)', () => seek(cursor - 1)),
    transport,
    mk('\u25B6', 'Next step (right arrow)', () => seek(cursor + 1)),
    mk('\u23ED', 'Last (End)', () => seek(order.length - 1)),
    slider,
    counter,
    mk('\u2715', 'Leave replay mode', () => leaveReplayMode()),
  );

  /**
   * Three states in one button: play, pause, and - once the match has run out -
   * replay from the start. Every glyph is a single character inside a fixed
   * 30x30 button, so swapping them cannot change the bar's geometry.
   */
  function paintTransport() {
    if (playing) {
      transport.textContent = '\u23F8';
      transport.title = 'Pause (space)';
    } else if (atEnd()) {
      transport.textContent = '\u21BB';
      transport.title = 'Replay from the start (space)';
    } else {
      transport.textContent = '\u25B6';
      transport.title = 'Play (space)';
    }
    transport.setAttribute('aria-label', transport.title);
  }

  function paint() {
    const seq = order[cursor];
    const [, log] = states.get(seq);
    counter.textContent = `${seq}/${LAST}`;
    slider.value = String(cursor);
    paintTransport();
    // The client already narrates the match in its own log panel, so the text
    // lives in a tooltip rather than in the layout.
    bar.title = log[0]?.text ?? `Sequence ${seq}`;
  }

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // The client has a chat box and its own shortcuts; never take keys from a
    // field someone is typing in.
    const el = e.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement || el?.isContentEditable) return;

    if (e.key === 'ArrowRight') { e.preventDefault(); seek(cursor + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(cursor - 1); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(order.length - 1); }
    else if (e.key === ' ') { e.preventDefault(); toggle(); }
  }, true);

  const mount = () => { document.body.append(bar); paint(); };
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);

  /**
   * Put the client into the room.
   *
   * Intercepting the socket is not enough: the app only opens one once it
   * believes it is in a room, and a fresh page sits in the lobby with nothing
   * to intercept. Driving its Join control does not help either - joining by
   * code asks the server whether the room exists, and a finished match's room
   * is usually gone.
   *
   * So skip the lookup and restore the room the way the client restores its own
   * after a reload: it keeps the current room in `riftbound_simulator_active_room`
   * (sessionStorage, per tab) and a recovery copy in
   * `riftbound_simulator_last_room` (localStorage). Writing those before the app
   * boots makes it open the socket on its own, and the intercept answers.
   *
   * As a spectator, because the replay's seats belong to whoever played the
   * match, not to whoever is watching it now.
   */
  const ROOM_KEYS = {
    active: 'riftbound_simulator_active_room',
    last: 'riftbound_simulator_last_room',
    tab: 'riftbound_simulator_tab_id',
  };

  /** What we displaced, so leaving replay mode does not strand the viewer. */
  const previousRoomState = {
    active: sessionStorage.getItem(ROOM_KEYS.active),
    last: localStorage.getItem(ROOM_KEYS.last),
  };

  function enterRoom() {
    const viewer = replay.players?.[0]?.id ?? replay.viewer?.playerId ?? null;
    const name = replay.players?.find((p) => p.id === replay.viewer?.playerId)?.name ?? 'Replay';
    const session = {
      roomCode: ROOM,
      playerId: 'spectator',
      activePlayerId: viewer,
      controlledPlayerIds: [],
      viewerRole: 'spectator',
      spectatorName: name,
      playerName: name,
      playMode: replay.match?.playMode ?? 'constructed',
      deckRulesMode: replay.match?.deckRulesMode ?? 'standard',
      lastKnownPhase: replay.origin?.snapshot?.phase ?? 'in_game',
    };
    const now = Date.now();
    let tabId = sessionStorage.getItem(ROOM_KEYS.tab);
    if (!tabId) {
      tabId = (crypto.randomUUID?.() ?? String(now));
      sessionStorage.setItem(ROOM_KEYS.tab, tabId);
    }
    sessionStorage.setItem(ROOM_KEYS.active,
      JSON.stringify({ version: 2, updatedAt: now, session }));
    localStorage.setItem(ROOM_KEYS.last,
      JSON.stringify({ updatedAt: now, ownerTabId: tabId, session }));

    if (!location.pathname.startsWith('/game')) {
      location.replace('/game');
    }
  }

  function leaveReplayMode() {
    // Hand the viewer's own room state back before reloading.
    if (previousRoomState.active === null) sessionStorage.removeItem(ROOM_KEYS.active);
    else sessionStorage.setItem(ROOM_KEYS.active, previousRoomState.active);
    if (previousRoomState.last === null) localStorage.removeItem(ROOM_KEYS.last);
    else localStorage.setItem(ROOM_KEYS.last, previousRoomState.last);
    location.replace('/');
  }

  enterRoom();

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // The client has a chat box and its own shortcuts; never take keys from a
    // field someone is typing in.
    const el = e.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement || el?.isContentEditable) return;

    if (e.key === 'ArrowRight') { e.preventDefault(); seek(cursor + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(cursor - 1); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(order.length - 1); }
    else if (e.key === ' ') { e.preventDefault(); toggle(); }
  }, true);

  console.log(`[riftatlas-replay] replay mode armed for ${ROOM}: ${order.length} states`);
}
})();
