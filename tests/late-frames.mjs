#!/usr/bin/env node
/**
 * A match's last word can arrive after the match has been declared over.
 *
 * In a best-of-three the next game's room opens the moment the previous one
 * ends, which closes the previous recording on the spot - and the concession
 * that ended it turns up a beat later. A real game two was built with no result
 * at all because that frame had nowhere to land and was dropped.
 *
 * A closed recording therefore keeps accepting frames for a couple of minutes.
 * Long enough for a straggler, short enough that a recycled room code two
 * minutes later starts its own recording instead of joining someone else's.
 *
 *   node tests/late-frames.mjs
 */
import { stillAccepting, isEmptyRecording } from '../extension/background/store.js';

const MINUTE = 60 * 1000;
const now = 1_700_000_000_000;

const cases = [
  [true, stillAccepting({ finished: false, lastAt: now - 30 * MINUTE }, now),
    'an open recording accepts frames however long it has been quiet'],
  [true, stillAccepting({ lastAt: now }, now),
    'a recording with no finished flag is open'],
  [true, stillAccepting({ finished: true, lastAt: now - 1000 }, now),
    'the straggler: a concession a second after the recording closed'],
  [true, stillAccepting({ finished: true, lastAt: now - 119 * 1000 }, now),
    'still inside the grace window at just under two minutes'],
  [false, stillAccepting({ finished: true, lastAt: now - 3 * MINUTE }, now),
    'past the window — a recycled room code is a different match'],
  [false, stillAccepting({ finished: true }, now),
    'closed, with no last frame recorded at all'],

  [false, isEmptyRecording({ origin: {}, finished: true }, 4),
    'a recording holding commits is real'],
  [false, isEmptyRecording({ origin: {}, finished: false }, 0),
    'an open recording that has caught a snapshot is a match starting'],
  [true, isEmptyRecording({ origin: {}, finished: true }, 0),
    'closed without a single commit is residue'],
  [true, isEmptyRecording({ finished: false }, 0),
    'no snapshot, no commits — the residue of being in a room'],
];

let failed = 0;
for (const [expected, actual, why] of cases) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}`);
  if (!ok) console.log(`       got ${actual}, wanted ${expected}`);
}
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
