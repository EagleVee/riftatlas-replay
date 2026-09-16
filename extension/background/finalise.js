/**
 * Assemble a .ratlas.json from persisted recording state.
 *
 * Behaviourally identical to tools/har_to_replay.py, which is the reference.
 * Finalisation is a pure function of what is already in IndexedDB, so a worker
 * that was killed mid-match can still produce a correct replay on wake.
 */
import { SESSIONS, get, commitsFor, extrasFor } from './store.js';
import { Timeline } from '../shared/reducer.js';

const FORMAT = 'riftatlas-replay';
const VERSION = 1;

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

export async function buildReplay(roomCode) {
  const session = await get(SESSIONS, roomCode);
  if (!session?.origin) throw new Error(`no anchoring snapshot for ${roomCode}`);

  const commits = await commitsFor(roomCode);
  const snapshots = await extrasFor(roomCode, 'snapshot');
  const chat = (await extrasFor(roomCode, 'chat')).map((r) => r.entry)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const errors = new Map((await extrasFor(roomCode, 'error')).map((r) => [r.sequence, r.code]));

  const timeline = new Timeline();
  timeline.ingest({ type: 'authoritative_snapshot', ...session.origin });
  const repairs = new Map(snapshots.map((s) => [s.sequence, s]));
  for (const commit of commits) {
    const repair = repairs.get(commit.baseSequence);
    if (repair) {
      timeline.ingest({ type: 'authoritative_snapshot', ...repair });
      repairs.delete(commit.baseSequence);
    }
    timeline.ingest({ type: 'authoritative_patch_commit', ...commit });
  }

  const lastSeq = timeline.sequences.at(-1);
  const [finalState, finalLog] = timeline.states.get(lastSeq);

  const gaps = timeline.resyncs.map(({ from, to }) => {
    const repair = snapshots.find((s) => s.sequence === to);
    return {
      fromSequence: from, toSequence: to, missingCommits: to - from,
      reason: errors.get(to) ?? 'unknown',
      recovery: repair ? 'snapshot' : 'none',
      snapshot: repair?.snapshot ?? null,
      gameplayLog: repair?.gameplayLog ?? null,
    };
  });

  const shell = session.shell ?? {};
  const viewer = session.viewer ?? shell.viewer ?? {};
  const masked = maskedZones(finalState);
  const clock = commits.at(-1)?.actionClock ?? session.origin.actionClock ?? {};
  const totals = clock.totals ?? {};
  const selfPlayer = shell.selfPlayer ?? {};

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
      roomCode: finalState.roomCode ?? roomCode,
      capturedAt: shell.createdAt ?? session.startedAt,
      durationMs: commits.at(-1)?.t ?? 0,
      gameVariant: finalState.gameVariant ?? null,
      playMode: finalState.playMode ?? null,
      matchFormat: shell.matchFormat ?? null,
      deckRulesMode: shell.deckRulesMode ?? null,
      roomOrigin: shell.roomOrigin ?? null,
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
    partial: session.partial === true,
    players,
    shell: session.shell ?? null,
    origin: session.origin,
    commits: commits.map(({ roomCode: _ignored, ...c }) => c),
    gaps,
    chat,
  };
}
