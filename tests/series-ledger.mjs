#!/usr/bin/env node
/**
 * A best-of-three game can end without ending inside the game.
 *
 * Pressing "Next game" asks both players to name the winner of the one just
 * played, and the series moves on once they agree — so that game has no victory
 * line, no concession, and no winning score. The result is written to the
 * series ledger each room carries instead: `winsByPlayerId`, as it stood when
 * that game began.
 *
 * The numbers below are from a real series (EagleV vs EagleV2, series_0142a00d)
 * where game two finished 4-4 and its winner appears nowhere else.
 *
 *   node tests/series-ledger.mjs
 */
import { seriesWinner } from '../extension/background/finalise.js';

const E1 = 'plr_07d0315f';   // EagleV
const E2 = 'plr_e3251ea5';   // EagleV2

const cases = [
  [E2, {}, { winsByPlayerId: { [E1]: 0, [E2]: 1 } },
    'game one: the first room has no ledger yet, the second says EagleV2 won it'],
  [E1, { winsByPlayerId: { [E1]: 0, [E2]: 1 } }, { winsByPlayerId: { [E1]: 1, [E2]: 1 } },
    'game two: agreed between games, and recorded only here'],

  [null, { winsByPlayerId: { [E1]: 1, [E2]: 1 } }, { winsByPlayerId: { [E1]: 1, [E2]: 1 } },
    'nothing moved — not a completed game'],
  [null, { winsByPlayerId: { [E1]: 0, [E2]: 0 } }, { winsByPlayerId: { [E1]: 1, [E2]: 1 } },
    'both gained — the ledger is not describing one game'],
  [null, { winsByPlayerId: { [E1]: 1, [E2]: 1 } }, { winsByPlayerId: { [E1]: 0, [E2]: 1 } },
    'a win went backwards — refuse rather than guess'],
  [null, { winsByPlayerId: { [E1]: 0, [E2]: 0 } }, { winsByPlayerId: { [E1]: 2, [E2]: 0 } },
    'up by two — a game went unrecorded, so this delta is not one game'],
  [null, {}, {}, 'no ledger on either side'],
  [null, undefined, undefined, 'no shell at all'],
];

let failed = 0;
for (const [expected, before, after, why] of cases) {
  const actual = seriesWinner(before, after);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}`);
  if (!ok) console.log(`       got ${actual}, wanted ${expected}`);
}
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
