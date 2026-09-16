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
  const ARM = window.__riftatlasReplayArm;
  if (!ARM?.replay) {
    console.warn('[riftatlas-replay] replay mode: nothing armed');
    return;
  }
  delete window.__riftatlasReplayArm;

  const replay = ARM.replay;
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

  // ---------------------------------------------------------------- controls

  function seek(index) {
    cursor = Math.max(0, Math.min(order.length - 1, index));
    for (const socket of sockets) socket._pushState();
    paint();
  }

  const bar = document.createElement('div');
  bar.id = 'riftatlas-replay-bar';
  bar.style.cssText = `position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:2147483647;
    display:flex;gap:6px;align-items:center;padding:8px 12px;border:1px solid #d8b76e;border-radius:8px;
    background:rgba(8,12,18,.94);color:#dbe7f3;font:12px ui-sans-serif,system-ui,sans-serif;
    box-shadow:0 6px 24px rgba(0,0,0,.6);backdrop-filter:blur(4px)`;
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label; b.title = title;
    b.style.cssText = 'font:inherit;color:inherit;background:#16202c;border:1px solid #24313f;border-radius:4px;padding:3px 9px;cursor:pointer';
    b.onclick = fn; return b;
  };
  const label = document.createElement('span');
  label.style.cssText = 'margin:0 8px;min-width:230px;color:#8698ab';
  const badge = document.createElement('strong');
  badge.textContent = `REPLAY ${ROOM}`;
  badge.style.cssText = 'color:#d8b76e;letter-spacing:.06em;margin-right:4px';

  bar.append(badge,
    mk('|<', 'First (Home)', () => seek(0)),
    mk('<', 'Previous step (left arrow)', () => seek(cursor - 1)),
    mk('>', 'Next step (right arrow)', () => seek(cursor + 1)),
    mk('>|', 'Last (End)', () => seek(order.length - 1)),
    label,
    mk('x', 'Leave replay mode', () => location.reload()));

  function paint() {
    const seq = order[cursor];
    const [, log] = states.get(seq);
    label.textContent = `seq ${seq} / ${order.at(-1)}  ·  ${log[0]?.text ?? ''}`.slice(0, 96);
  }

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(cursor + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(cursor - 1); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(order.length - 1); }
  }, true);

  const mount = () => { document.body.append(bar); paint(); };
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);

  console.log(`[riftatlas-replay] replay mode armed for ${ROOM}: ${order.length} states`);
})();
