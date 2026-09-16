#!/usr/bin/env node
/**
 * The navigation index must report the measured shape of the reference match.
 * These numbers are facts about the capture, so a change here means either the
 * index regressed or the capture changed - both worth failing on.
 *
 *   node tests/index-shape.mjs <replay.ratlas.json>
 */
import fs from 'node:fs';
import { timelineFromReplay, buildIndex, Cursor } from '../extension/shared/timeline-index.js';

const replay = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const index = buildIndex(timelineFromReplay(replay));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` != ${JSON.stringify(expected)}`}`);
};

check('sequences', index.sequences.length, 371);
check('sequence range', [index.first, index.last], [0, 370]);
check('narrated events', index.events.length, 291);
check('phase chapters', index.chapters.filter((c) => c.kind === 'phase').map((c) => c.label),
  ['battlefield_pick', 'initiative_roll', 'first_player_choice', 'sideboarding', 'mulligan', 'in_game']);
check('phase sequences', index.chapters.filter((c) => c.kind === 'phase').map((c) => c.sequence),
  [0, 2, 3, 4, 8, 10]);
check('turn chapters', index.chapters.filter((c) => c.kind === 'turn').length, 14);
check('turn 1 sequence', index.chapters.find((c) => c.id.startsWith('turn:1:')).sequence, 11);
check('turn 9 sequence', index.chapters.find((c) => c.id.startsWith('turn:9:')).sequence, 139);
check('gaps', index.gaps, [{ from: 368, to: 369, missing: 1 }]);

// Navigation round-trip: stepping to the end and back must land exactly on 0.
const cursor = new Cursor(index);
cursor.toEnd();
check('toEnd', cursor.sequence, 370);
while (cursor.sequence > index.first) cursor.stepSequence(-1);
check('walk back to start', cursor.sequence, 0);

// Fog must be restored when stepping backwards past a reveal.
const timeline = timelineFromReplay(replay);
const hiddenAt = (seq, playerId, zone) => {
  const [state] = timeline.states.get(seq);
  const cards = state.players.find((p) => p.id === playerId).board[zone] ?? [];
  return cards.filter((c) => c.isPlaceholder).length;
};
const opp = replay.players.find((p) => p.id !== replay.viewer.playerId).id;
check('opponent hand hidden at seq 0 and at end',
  [hiddenAt(0, opp, 'hand'), hiddenAt(370, opp, 'hand') > 0],
  [0, true]);
const self = replay.viewer.playerId;
check('own deck hidden from self at end', hiddenAt(370, self, 'deck') > 0, true);

console.log(`\n${failed ? failed + ' CHECK(S) FAILED' : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
