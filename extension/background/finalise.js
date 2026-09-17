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

/**
 * Points needed to win, by game variant, as the client defines them.
 *
 * The threshold is not in the match state - the client derives it from the
 * variant - so it is mirrored here. The real rule adds a small bonus for
 * certain battlefield brushes, which is not reproduced: this is only used to
 * recognise a player who has clearly reached a winning score, so erring low
 * would misread a match and erring high would simply defer to RiftAtlas.
 */
const VICTORY_SCORE = {
  duel: 8,
  free_for_all_3: 8,
  free_for_all_4: 8,
  teams_2v2: 11,
};
const BASE_VICTORY_SCORE = 8;

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
  let stoppedAt = null;

  for (const commit of commits) {
    if (commit.baseSequence !== sequence) {
      const repair = bySequence.find((s) => s.sequence >= sequence && s.sequence <= commit.baseSequence);
      if (repair) {
        timeline.ingest({ type: 'authoritative_snapshot', ...repair });
        sequence = repair.sequence;
      }
    }
    if (stoppedAt) break;
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
    try {
      timeline.ingest({ type: 'authoritative_patch_commit', ...commit });
      sequence = commit.sequence;
    } catch (error) {
      // Something the reducer does not know - a patch verb RiftAtlas has added
      // since. Keep everything up to here rather than losing the match: a new
      // verb should cost the rest of a replay, not the whole of it. The
      // recording is untouched, so the same match builds in full once the
      // reducer catches up.
      stoppedAt = { sequence: commit.sequence, reason: String(error?.message ?? error) };
      break;
    }
  }

  // Snapshots beyond everything we could walk still tell us how the match
  // ended. When a hole has cost the middle of a game, the final board is the
  // most that can be salvaged, and it is worth more than stopping at the hole.
  //
  // Skipped when the reducer stopped early: stitching the ending onto a replay
  // that cannot reach it would present a gap as if it were merely a resync.
  for (const later of stoppedAt ? [] : bySequence) {
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

  const legendOf = (player) => {
    // The legend can leave its own zone during play, so fall back to the
    // opening board, which always has it.
    const here = player.board?.legend?.[0];
    if (here?.name) return { name: here.name, cardCode: here.cardCode ?? null };
    const atStart = session.origin.snapshot.players
      ?.find((x) => x.id === player.id)?.board?.legend?.[0];
    return atStart?.name ? { name: atStart.name, cardCode: atStart.cardCode ?? null } : null;
  };

  const players = (finalState.players ?? []).map((p) => ({
    id: p.id, seat: p.seat, name: p.name, legend: legendOf(p),
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

  // Reaching the victory score settles a finished match, whatever the log says.
  //
  // RiftAtlas records a player leaving the room as a concession, and a winner
  // usually leaves as soon as they have won - so the log credits the win to the
  // player who stayed. Both captures of a finished match showed exactly that:
  // the player on 8 points was logged as the conceder.
  //
  // This decides who won. It never decides *that* a match is over: scores are
  // manual in a simulator and a player can put themselves on 8 by mistake and
  // correct it. Nothing in the recorder watches the score, and the finalisation
  // triggers are a new room, everyone leaving, a terminal log line, or the
  // socket closing - never a number on the track. Reading the score only once a
  // recording has closed means a mistaken 8 mid-match is simply corrected
  // before anyone asks who won.
  //
  // Only an unambiguous case overrides: exactly one player at or above the
  // threshold. Anything else keeps RiftAtlas' own ruling.
  const victoryScore = VICTORY_SCORE[finalState.gameVariant] ?? BASE_VICTORY_SCORE;
  if (session.finished === true) {
    const reached = players.filter((p) => (p.finalScore ?? 0) >= victoryScore);
    if (reached.length === 1 && reached[0].id !== winnerPlayerId) {
      winnerPlayerId = reached[0].id;
      reason = 'score';
    }
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
      outcome: { winnerPlayerId, reason, victoryScore },
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
      // Set when the reducer met something it did not understand. The recording
      // is complete; this replay is not.
      stoppedAt,
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
