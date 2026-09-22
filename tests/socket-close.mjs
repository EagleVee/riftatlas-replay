#!/usr/bin/env node
/**
 * A closing socket ends one match, and a recording must say when it cannot be
 * replayed at all.
 *
 * Both rules come from the same evening. The observer watches every
 * `/parties/` socket — lobby, queue, the match — and any one of them closing
 * used to end every recording in the database. Two live matches were cut in
 * half mid-play as a result, and because a recording that starts partway
 * through a match has no anchor until the server sends one, the half that
 * followed held 145 actions that could never be replayed: its only snapshot
 * arrived at the end, above all of them. In the player that is a scrubber
 * sitting at 269/269 that will not move.
 *
 *   node tests/socket-close.mjs
 */
import { endsWithSocket } from '../extension/background/recorder.js';
import { unanchoredSpan } from '../extension/background/finalise.js';

const c = (sequence) => ({ sequence });

const cases = [
  [true, endsWithSocket({ socketId: 'game-1' }, 'game-1'),
    'the socket carrying this match closed — the match is over'],
  [false, endsWithSocket({ socketId: 'game-1' }, 'lobby-9'),
    'the lobby socket closed — the match plays on'],
  [false, endsWithSocket({ socketId: 'game-1' }, undefined),
    'a close with no socket named ends nothing'],
  [false, endsWithSocket({}, 'lobby-9'),
    'a recording not bound to a socket is not ended by one'],
  [false, endsWithSocket(null, 'game-1'), 'no recording at all'],

  [null, unanchoredSpan(0, [c(1), c(2), c(3)]),
    'the ordinary case: anchored at the start, everything replays'],
  [null, unanchoredSpan(0, []),
    'no commits is not an unanchored recording'],
  [null, unanchoredSpan(120, [c(118), c(119), c(121)]),
    'some commits above the anchor — the gaps already describe that'],
];

let failed = 0;
for (const [expected, actual, why] of cases) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}`);
  if (!ok) console.log(`       got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
}

// The real one, with the sequence numbers it actually had.
const span = unanchoredSpan(269, Array.from({ length: 145 }, (_, i) => c(124 + i)));
const want = { commits: 145, from: 124, to: 268, anchor: 269 };
const ok = JSON.stringify(span) === JSON.stringify(want);
if (!ok) failed++;
console.log(`${ok ? 'ok  ' : 'FAIL'} the rybi match: 145 actions below an anchor at 269`);
if (!ok) console.log(`       got ${JSON.stringify(span)}, wanted ${JSON.stringify(want)}`);

console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
