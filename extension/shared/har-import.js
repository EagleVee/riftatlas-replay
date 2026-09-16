/**
 * Build a replay from a DevTools HAR, in the browser.
 *
 * Mirrors tools/har_to_replay.py so a capture can be opened directly in the
 * player without running anything first. The Python version stays the reference
 * for the recorder's finaliser; this one exists for convenience.
 */
import { Timeline } from './reducer.js';

const FORMAT = 'riftatlas-replay';
const VERSION = 1;

/** Frame types that carry authoritative state or match context. */
const KEEP = new Set([
  'authoritative_snapshot', 'authoritative_patch_commit',
  'room_shell_sync', 'chat_sync', 'chat_append', 'error',
]);

/** Keys scrubbed before anything is kept. Mirrors tools/har_to_jsonl.py. */
const SECRETS = new Set(['authToken', 'token', 'jwt', '_pk']);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRETS.has(k) && typeof v === 'string' ? '<redacted>' : redact(v);
    }
    return out;
  }
  return value;
}

export function looksLikeHar(text) {
  return /"log"\s*:/.test(text.slice(0, 4000)) && /"entries"\s*:/.test(text.slice(0, 20000));
}

/** Zones holding placeholder stubs, per player. Empty means full information. */
function maskedZones(state) {
  const out = {};
  for (const player of state.players ?? []) {
    const zones = Object.entries(player.board ?? {})
      .filter(([, cards]) => Array.isArray(cards)
        && cards.some((c) => c && typeof c === 'object' && c.isPlaceholder))
      .map(([zone]) => zone).sort();
    if (zones.length) out[player.id] = zones;
  }
  return out;
}

export function harToReplay(har, { urlContains = '/parties/match/' } = {}) {
  const frames = [];
  for (const entry of har?.log?.entries ?? []) {
    if (!entry.request?.url?.includes(urlContains)) continue;
    frames.push(...(entry._webSocketMessages ?? []));
  }
  if (!frames.length) {
    throw new Error('no match WebSocket frames in this HAR — capture with the WS filter on');
  }
  frames.sort((a, b) => a.time - b.time);
  const t0 = frames[0].time;

  const timeline = new Timeline();
  const commits = [];
  const chat = new Map();
  const errors = new Map();
  let shell = null;
  let origin = null;

  for (const frame of frames) {
    let msg;
    try { msg = redact(JSON.parse(frame.data)); } catch { continue; }
    if (!KEEP.has(msg.type)) continue;
    timeline.ingest(msg);
    const t = Math.round((frame.time - t0) * 1000);

    if (msg.type === 'room_shell_sync' && !shell) {
      shell = msg.sessionDoc;
    } else if (msg.type === 'authoritative_snapshot' && !origin) {
      origin = {
        sequence: msg.sequence,
        snapshot: msg.snapshot,
        gameplayLog: msg.gameplayLog ?? [],
        actionClock: msg.actionClock ?? null,
      };
    } else if (msg.type === 'authoritative_patch_commit') {
      commits.push({
        t,
        baseSequence: msg.baseSequence,
        sequence: msg.sequence,
        action: msg.action,
        operations: msg.patch.operations,
        actionClock: msg.actionClock ?? null,
      });
    } else if (msg.type === 'chat_sync' || msg.type === 'chat_append') {
      for (const entry of msg.chatEntries ?? msg.entries ?? []) chat.set(entry.id, entry);
    } else if (msg.type === 'error') {
      errors.set(msg.authoritativeSequence, msg.code);
    }
  }

  if (!origin) throw new Error('capture contains no snapshot to anchor on');

  const lastSeq = timeline.sequences.at(-1);
  const [finalState, finalLog] = timeline.states.get(lastSeq);

  const gaps = timeline.resyncs.map(({ from, to }) => {
    const snap = timeline.snapshots.get(to);
    return {
      fromSequence: from, toSequence: to, missingCommits: to - from,
      reason: errors.get(to) ?? 'unknown',
      recovery: snap ? 'snapshot' : 'none',
      snapshot: snap?.[0] ?? null,
      gameplayLog: snap?.[1] ?? null,
    };
  });

  const viewer = shell?.viewer ?? {};
  const selfPlayer = shell?.selfPlayer ?? {};
  const clock = commits.at(-1)?.actionClock ?? origin.actionClock ?? {};
  const totals = clock.totals ?? {};
  const masked = maskedZones(finalState);

  const players = (finalState.players ?? []).map((p) => ({
    id: p.id, seat: p.seat, name: p.name,
    decklistRaw: p.id === selfPlayer.id ? (selfPlayer.decklistRaw ?? null) : null,
    finalScore: p.board?.score ?? null,
    thinkTimeMs: totals[p.id] ?? null,
  }));

  let winnerPlayerId = null;
  let reason = null;
  for (const entry of finalLog) {
    const text = entry.text ?? '';
    if (!/ wins\b/.test(text) && !/conceded/.test(text)) continue;
    reason = /conceded/.test(text) ? 'concession' : 'victory';
    winnerPlayerId = players.find((p) => p.name && text.includes(`${p.name} wins`))?.id ?? null;
    break;
  }

  return {
    format: FORMAT,
    version: VERSION,
    match: {
      roomCode: finalState.roomCode ?? null,
      capturedAt: shell?.createdAt ?? null,
      durationMs: commits.at(-1)?.t ?? 0,
      gameVariant: finalState.gameVariant ?? null,
      playMode: finalState.playMode ?? null,
      matchFormat: shell?.matchFormat ?? null,
      deckRulesMode: shell?.deckRulesMode ?? null,
      roomOrigin: shell?.roomOrigin ?? null,
      roomMode: finalState.roomMode ?? null,
      setupOrderVersion: finalState.setupOrderVersion ?? null,
      outcome: { winnerPlayerId, reason },
    },
    viewer: {
      role: viewer.role ?? 'player',
      playerId: viewer.playerId ?? null,
      fogOfWar: Object.keys(masked).length > 0,
      maskedZonesByPlayer: masked,
    },
    players,
    origin,
    commits,
    gaps,
    chat: [...chat.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
  };
}
