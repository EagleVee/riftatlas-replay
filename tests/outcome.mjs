#!/usr/bin/env node
/**
 * Who won, and what must never end a match.
 *
 * RiftAtlas logs a player leaving as a concession, and a winner leaves as soon
 * as they have won - so its log credits the win to whoever stayed. Both real
 * captures showed the player on 8 points recorded as the conceder.
 *
 * Reaching the victory score therefore decides who won, but only for a closed
 * recording and only when exactly one player is there. It must never decide
 * *that* a match is over: scores are manual, and a player can hit 8 by mistake.
 *
 *   node tests/outcome.mjs
 */
const VICTORY_SCORE = { duel: 8, free_for_all_3: 8, free_for_all_4: 8, teams_2v2: 11 };
const BASE = 8;

/** Mirrors the ruling in extension/background/finalise.js. */
function decide({ variant = 'duel', players, log, finished = true }) {
  let winner = null;
  let reason = null;
  if (log) {
    reason = /conceded/.test(log) ? 'concession' : 'victory';
    winner = players.find((p) => log.includes(`${p.name} wins`))?.name ?? null;
  }
  const threshold = VICTORY_SCORE[variant] ?? BASE;
  if (finished) {
    const reached = players.filter((p) => (p.score ?? 0) >= threshold);
    if (reached.length === 1 && reached[0].name !== winner) {
      winner = reached[0].name;
      reason = 'score';
    }
  }
  return { winner, reason };
}

const cases = [
  ['reference match: the player on 8 was logged as conceder',
    { players: [{ name:'BertoC', score:8 }, { name:'EagleV', score:7 }],
      log: 'BertoC conceded. EagleV wins.' }, { winner:'BertoC', reason:'score' }],
  ['live PvP: same shape, wider margin',
    { players: [{ name:'Adil', score:8 }, { name:'EagleV', score:5 }],
      log: 'Adil conceded. EagleV wins.' }, { winner:'Adil', reason:'score' }],
  ['a genuine mid-game concession is left alone',
    { players: [{ name:'A', score:3 }, { name:'B', score:5 }],
      log: 'A conceded. B wins.' }, { winner:'B', reason:'concession' }],
  ['a normal win on points agrees with the log',
    { players: [{ name:'A', score:8 }, { name:'B', score:6 }],
      log: 'A wins.' }, { winner:'A', reason:'victory' }],
  ['teams need 11, so 8 settles nothing',
    { variant:'teams_2v2', players: [{ name:'A', score:8 }, { name:'B', score:9 }],
      log: 'A conceded. B wins.' }, { winner:'B', reason:'concession' }],
  ['both on the threshold is ambiguous, so RiftAtlas rules',
    { players: [{ name:'A', score:8 }, { name:'B', score:8 }],
      log: 'A conceded. B wins.' }, { winner:'B', reason:'concession' }],
  ['a match still running is never decided on score',
    { finished: false, players: [{ name:'A', score:8 }, { name:'B', score:2 }],
      log: null }, { winner:null, reason:null }],
];

let failed = 0;
for (const [label, input, expected] of cases) {
  const actual = decide(input);
  const ok = actual.winner === expected.winner && actual.reason === expected.reason;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
}
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
