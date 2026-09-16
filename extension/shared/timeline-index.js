/**
 * Navigation index over a materialised Timeline.
 *
 * Three tiers, per docs/replay-navigation.md:
 *   sequence  - one authoritative commit; the atom. Every rendered position.
 *   event     - one narrated game action; the move list.
 *   chapter   - one phase or turn; the rail.
 *
 * Backward navigation is a lookup into Timeline.states, never an undo, which is
 * what keeps fog-of-war correct when stepping back past a reveal.
 */
import { Timeline } from './reducer.js';

/** Rebuild a Timeline from a .ratlas.json replay document. */
export function timelineFromReplay(replay) {
  const timeline = new Timeline();
  timeline.ingest({
    type: 'authoritative_snapshot',
    sequence: replay.origin.sequence,
    snapshot: replay.origin.snapshot,
    gameplayLog: replay.origin.gameplayLog,
  });
  // Gap snapshots must be ingested at the point the chain reaches them, so index
  // them by the sequence they re-anchor to and feed them in as we go.
  const repairs = new Map();
  for (const gap of replay.gaps ?? []) {
    if (gap.snapshot) {
      repairs.set(gap.toSequence, {
        type: 'authoritative_snapshot',
        sequence: gap.toSequence,
        snapshot: gap.snapshot,
        gameplayLog: gap.gameplayLog ?? [],
      });
    }
  }
  for (const commit of replay.commits) {
    if (repairs.has(commit.baseSequence)) {
      timeline.ingest(repairs.get(commit.baseSequence));
      repairs.delete(commit.baseSequence);
    }
    timeline.ingest({ type: 'authoritative_patch_commit', ...commit });
  }
  return timeline;
}

/**
 * Build the navigation index.
 *
 * `events` accumulates every gameplay-log entry the first time it appears.
 * The server trims its own log as a match runs, so reading the final
 * `gameplayLog` would silently lose most of the match - 192 of 291 entries on
 * the reference capture.
 */
export function buildIndex(timeline) {
  const sequences = timeline.sequences;
  const events = [];
  const seenEvents = new Set();
  const chapters = [];
  let phase = null;
  let turnKey = null;

  for (const seq of sequences) {
    const [state, log] = timeline.states.get(seq);

    if (state.phase !== phase) {
      phase = state.phase;
      chapters.push({ kind: 'phase', id: `phase:${phase}`, label: phase, sequence: seq });
    }

    // Log entries arrive newest-first; reverse so events accumulate in play order.
    for (const entry of [...log].reverse()) {
      if (seenEvents.has(entry.id)) continue;
      seenEvents.add(entry.id);
      events.push({
        id: entry.id,
        sequence: seq,
        at: entry.at,
        text: entry.text,
        actionType: entry.actionType ?? null,
        actionKind: entry.actionKind ?? null,
        turnNumber: entry.turnNumber ?? null,
        turnPlayerId: entry.turnPlayerId ?? null,
        authorPlayerId: entry.authorPlayerId ?? null,
      });

      const key = entry.turnNumber != null ? `${entry.turnNumber}:${entry.turnPlayerId}` : null;
      if (key && key !== turnKey) {
        turnKey = key;
        chapters.push({
          kind: 'turn', id: `turn:${key}`,
          label: `Turn ${entry.turnNumber}`,
          turnNumber: entry.turnNumber, playerId: entry.turnPlayerId,
          sequence: seq,
        });
      }
    }
  }

  // Close each chapter's span so the scrubber can size its band.
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endSequence = (chapters[i + 1]?.sequence ?? sequences.at(-1) + 1) - 1;
  }

  return {
    sequences,
    first: sequences[0],
    last: sequences.at(-1),
    events,
    chapters,
    gaps: timeline.resyncs.map(({ from, to }) => ({ from, to, missing: to - from })),
    eventBySequence: indexBy(events, 'sequence'),
    chapterBySequence: spanIndex(chapters, sequences),
  };
}

function indexBy(items, key) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item[key])) map.set(item[key], []);
    map.get(item[key]).push(item);
  }
  return map;
}

function spanIndex(chapters, sequences) {
  const map = new Map();
  let i = 0;
  for (const seq of sequences) {
    while (i + 1 < chapters.length && chapters[i + 1].sequence <= seq) i++;
    map.set(seq, chapters[i]);
  }
  return map;
}

/** Navigation cursor. All movement resolves to a sequence in `index.sequences`. */
export class Cursor {
  constructor(index) {
    this.index = index;
    this.i = 0;
  }
  get sequence() { return this.index.sequences[this.i]; }
  set sequence(seq) {
    const at = this.index.sequences.indexOf(seq);
    if (at >= 0) this.i = at;
  }
  stepSequence(delta) {
    this.i = Math.min(this.index.sequences.length - 1, Math.max(0, this.i + delta));
    return this.sequence;
  }
  stepEvent(delta) {
    const here = this.sequence;
    const list = this.index.events;
    const next = delta > 0
      ? list.find((e) => e.sequence > here)
      : [...list].reverse().find((e) => e.sequence < here);
    if (next) this.sequence = next.sequence;
    else this.i = delta > 0 ? this.index.sequences.length - 1 : 0;
    return this.sequence;
  }
  stepChapter(delta) {
    const here = this.sequence;
    const list = this.index.chapters;
    const next = delta > 0
      ? list.find((c) => c.sequence > here)
      : [...list].reverse().find((c) => c.sequence < here);
    if (next) this.sequence = next.sequence;
    else this.i = delta > 0 ? this.index.sequences.length - 1 : 0;
    return this.sequence;
  }
  toStart() { this.i = 0; return this.sequence; }
  toEnd() { this.i = this.index.sequences.length - 1; return this.sequence; }
}
