#!/usr/bin/env node
/**
 * The match-end detector must fire on a real ending and nothing else.
 *
 * It once matched " wins", which the initiative roll trips in every single
 * game - "BertoC wins initiative (16 vs 2)" - freezing the built replay at the
 * dice roll. These are real log lines from the reference capture.
 *
 *   node tests/finish-detector.mjs
 */
import { isTerminalLogEntry } from '../extension/background/recorder.js';

const cases = [
  // [should it end the match?, entry, why it is here]
  [false, { id: 'pk-log_a', text: 'BertoC wins initiative (16 vs 2) and decides who plays first.' },
    'the initiative roll — the line that caused the bug'],
  [false, { id: 'pk-log_b', text: 'BertoC rolled 16. EagleV rolled 2.' }, 'the roll itself'],
  [false, { id: 'pk-log_c', text: 'Both battlefields are locked. Roll a d20 to decide first player.' },
    'prompt to roll'],
  [false, { id: 'pk-log_d', text: 'BertoC chose BertoC to take the first turn. Both players now sideboard.' },
    'first-player choice'],
  [false, { id: 'pk-log_e', text: 'EagleV drew 1 card.' }, 'ordinary play'],
  [false, { id: 'pk-log_f', text: 'BertoC moved Tideturner to Abandoned Hall.' }, 'ordinary play'],
  [true, { id: 'log_concession_1789532395582_plr_72272ae6', text: 'BertoC conceded. EagleV wins.' },
    'the real ending of the reference match'],
  [true, { id: 'pk-log_g', text: 'EagleV wins.' }, 'a bare victory line'],
  [true, { id: 'pk-log_h', text: 'EagleV wins the game.' }, 'an explicit victory line'],
];

let failed = 0;
for (const [expected, entry, why] of cases) {
  const actual = isTerminalLogEntry(entry);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${expected ? 'ends ' : 'plays'} — ${why}`);
  if (!ok) console.log(`       ${JSON.stringify(entry.text)} -> ${actual}, wanted ${expected}`);
}
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
