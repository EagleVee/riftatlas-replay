/**
 * Assemble a .ratlas.json from persisted recording state.
 *
 * Behaviourally identical to tools/har_to_replay.py, which is the reference.
 * Finalisation is a pure function of what is already in IndexedDB, so a worker
 * that was killed mid-match can still produce a correct replay on wake.
 */
import { SESSIONS, get, commitsFor, extrasFor, roomOf } from './store.js';
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

export async function buildReplay(recordingId) {
  const session = await get(SESSIONS, recordingId);
  if (!session?.origin) throw new Error(`no anchoring snapshot for ${recordingId}`);
  const roomCode = session.room ?? roomOf(recordingId);

  const commits = await commitsFor(recordingId);
  const snapshots = await extrasFor(recordingId, 'snapshot');
  const chat = (await extrasFor(recordingId, 'chat')).map((r) => r.entry)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const errors = new Map((await extrasFor(recordingId, 'error')).map((r) => [r.sequence, r.code]));

  const timeline = new Timeline();
  timeline.ingest({ type: 'authoritative_snapshot', ...session.origin });

  // Repair holes with any snapshot that lets the chain continue, not only one
  // sitting exactly on the break. A hole is fatal to everything after it - the
  // reducer cannot apply a commit whose base state it never saw - so a match
  // that lost a handful of frames replayed as nine moves out of 396 while the
  // other 388 sat unused. Resuming from the nearest usable snapshot recovers
  // the rest of the match, minus the stretch that was actually lost.
  const bySequence = [...snapshots].sort((a, b) => a.sequence - b.sequence);
  const unrepaired = [];
  let sequence = session.origin.sequence;

  for (const commit of commits) {
    if (commit.baseSequence !== sequence) {
      const repair = bySequence.find((s) => s.sequence >= sequence && s.sequence <= commit.baseSequence);
      if (repair) {
        timeline.ingest({ type: 'authoritative_snapshot', ...repair });
        sequence = repair.sequence;
      }
    }
    // Commits below where we now stand belong to the lost stretch; skip them
    // rather than feeding the reducer a base it never reached.
    if (commit.baseSequence !== sequence) {
      // One gap per contiguous run of skipped commits, not one per commit.
      const open = unrepaired.at(-1);
      if (open && open.from === sequence) open.to = commit.baseSequence;
      else if (commit.baseSequence > sequence) {
        unrepaired.push({ from: sequence, to: commit.baseSequence });
      }
      continue;
    }
    timeline.ingest({ type: 'authoritative_patch_commit', ...commit });
    sequence = commit.sequence;
  }

  // Snapshots beyond everything we could walk still tell us how the match
  // ended. When a hole has cost the middle of a game, the final board is the
  // most that can be salvaged, and it is worth more than stopping at the hole.
  for (const later of bySequence) {
    if (later.sequence <= sequence) continue;
    timeline.ingest({ type: 'authoritative_snapshot', ...later });
    const open = unrepaired.at(-1);
    if (open && open.from === sequence) open.to = later.sequence;
    else if (later.sequence > sequence) unrepaired.push({ from: sequence, to: later.sequence });
    sequence = later.sequence;
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

  // Holes nothing could bridge. Recorded but unusable, and the replay has to
  // say so - reporting no gaps made a truncated match look like a short one.
  const seen = new Set(gaps.map((g) => `${g.fromSequence}:${g.toSequence}`));
  for (const { from, to } of unrepaired) {
    const key = `${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push({
      fromSequence: from, toSequence: to, missingCommits: to - from,
      reason: errors.get(to) ?? 'frames_not_captured',
      recovery: 'none', snapshot: null, gameplayLog: null,
    });
  }
  gaps.sort((a, b) => a.fromSequence - b.fromSequence);

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
    // What the reducer could actually walk, against what was recorded. A
    // replay that stops early must be visibly short, not quietly short.
    coverage: {
      recordedCommits: commits.length,
      appliedCommits: timeline.commits.size,
      lastSequence: lastSeq,
    },
    players,
    shell: session.shell ?? null,
    origin: session.origin,
    recordingId,
    commits: commits.map(({ roomCode: _ignored, ...c }) => c),
    gaps,
    chat,
  };
}
