#!/usr/bin/env node
/**
 * Reveals the opponent showed and hid again, and the catalog that prices them.
 *
 * The operations below copy the shapes RiftAtlas sends for a hand reveal and a
 * deck-peek reveal, taken from real matches. Self-contained, so it runs without
 * a capture:
 *
 *   node tests/reveals.mjs [replay.ratlas.json ...]
 *
 * Any replays given are reduced too, and their reveals listed.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { extractReveals, revealsFromReplay } from '../extension/shared/reveals.js';
import { applyCommit } from '../extension/shared/reducer.js';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
};

const ME = 'plr_me';
const OPP = 'plr_opp';
const hidden = (player, zone, i) => ({
  id: `__hidden_zone__:${player}:${zone}:${i}`, name: '', source: 'mainDeck',
  exhausted: false, createdAt: i, isPlaceholder: true,
});
const card = (id, name, cardCode, type = 'unit') => ({
  id, name, source: 'mainDeck', ownerPlayerId: OPP, exhausted: false, createdAt: 1,
  cardCode, type, hasWhenYouPlayMe: false, isPlaceholder: false,
});
const board = (player, handSize) => ({
  score: 0, deck: [0, 1, 2].map((i) => hidden(player, 'deck', i)),
  hand: [...Array(handSize)].map((_, i) => hidden(player, 'hand', i)),
  base: [], trash: [], handRevealToOpponent: false,
  deckPeek: { cardIds: [], revealedCardIds: [], revision: 1 },
});
const log = (turn, text) => ({
  op: 'log_insert', index: 0,
  entries: [{ id: `log-${text}`, text, actionKind: 'inspect', turnNumber: turn }],
});

const A = card('card_a', 'Vi, Peacekeeper', 'UNL-176');
const B = card('card_b', 'Mirror Image', 'UNL-200', 'spell');
const C = card('card_c', 'Baited Hook', 'OGN-242', 'gear');
const D = card('card_d', 'Sacrifice', 'UNL-173', 'spell');
const X = card('card_x', 'Ruined Rex', 'UNL-067');

const origin = {
  sequence: 0,
  snapshot: { roomCode: 'TEST1', players: [
    { id: ME, name: 'Me', board: board(ME, 2) },
    { id: OPP, name: 'Opp', board: board(OPP, 3) },
  ] },
  gameplayLog: [],
};

let seq = 0;
const commit = (...operations) => ({ baseSequence: seq, sequence: ++seq, t: seq * 1000, action: {}, operations });

const commits = [
  // The opponent reveals their hand of three.
  commit(
    { op: 'set_board_fields', playerId: OPP, fields: { handRevealToOpponent: true } },
    { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [0, 1, 2].map((i) => hidden(OPP, 'hand', i).id) },
    { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 0, cards: [A, B, C] },
    log(10, 'Opp revealed their hand.'),
  ),
  // Plays one while it is still revealed, then draws one.
  commit({ op: 'zone_move', cardId: A.id, from: { playerId: OPP, zone: 'hand' },
    to: { playerId: OPP, zone: 'base', index: 0 }, card: A }),
  commit({ op: 'zone_insert', playerId: OPP, zone: 'hand', index: 2, cards: [D] }),
  // And hides it again.
  commit(
    { op: 'set_board_fields', playerId: OPP, fields: { handRevealToOpponent: false } },
    { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [B.id, C.id, D.id] },
    { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 0, cards: [0, 1, 2].map((i) => hidden(OPP, 'hand', i)) },
    log(10, 'Opp hid their hand.'),
  ),
  // I reveal my own hand: not something to remember for myself.
  commit({ op: 'set_board_fields', playerId: ME, fields: { handRevealToOpponent: true } }),
  commit({ op: 'set_board_fields', playerId: ME, fields: { handRevealToOpponent: false } }),
  // The opponent looks at two and reveals one: only the revealed one is known.
  commit(
    { op: 'set_board_fields', playerId: OPP, fields: { deckPeek: {
      cardIds: [hidden(OPP, 'deck', 2).id, X.id], revealedCardIds: [X.id], revision: 2 } } },
    { op: 'zone_remove', playerId: OPP, zone: 'deck', cardIds: [hidden(OPP, 'deck', 1).id] },
    { op: 'zone_insert', playerId: OPP, zone: 'deck', index: 1, cards: [X] },
    log(12, 'Opp revealed a looked-at deck card.'),
  ),
  // ...then hides it again.
  commit(
    { op: 'set_board_fields', playerId: OPP, fields: { deckPeek: {
      cardIds: [hidden(OPP, 'deck', 2).id, hidden(OPP, 'deck', 1).id], revealedCardIds: [], revision: 3 } } },
    { op: 'zone_remove', playerId: OPP, zone: 'deck', cardIds: [X.id] },
    { op: 'zone_insert', playerId: OPP, zone: 'deck', index: 1, cards: [hidden(OPP, 'deck', 1)] },
    log(12, 'Opp hid looked-at deck cards.'),
  ),
  // A hand revealed and never hidden again is still on the board, not a memory.
  commit(
    { op: 'set_board_fields', playerId: OPP, fields: { handRevealToOpponent: true } },
    { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [hidden(OPP, 'hand', 0).id] },
    { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 0, cards: [B] },
  ),
];

const events = extractReveals({ origin, commits, viewerPlayerId: ME });
check('two closed reveals, newest first', events.length === 2
  && events[0].kind === 'deck' && events[1].kind === 'hand',
  events.map((e) => `${e.kind}@${e.closedSequence}`).join(', '));

const hand = events.find((e) => e.kind === 'hand');
check('hand reveal keeps the card played while revealed',
  hand?.cards.filter((c) => !c.later).map((c) => c.name).join('|') === 'Vi, Peacekeeper|Mirror Image|Baited Hook',
  hand?.cards.map((c) => c.name).join(', '));
check('a card drawn while revealed is marked as later',
  hand?.cards.filter((c) => c.later).map((c) => c.name).join('|') === 'Sacrifice');
check('hand reveal carries who, when and the card code',
  hand?.playerName === 'Opp' && hand?.turn === 10 && hand?.cards[0].cardCode === 'UNL-176');

const deck = events.find((e) => e.kind === 'deck');
check('deck reveal holds only the revealed card',
  deck?.cards.map((c) => c.name).join('|') === 'Ruined Rex', deck?.cards.map((c) => c.name).join(', '));

check('my own reveals are not listed', events.every((e) => e.playerId === OPP));
check('a reveal still showing is not listed',
  !events.some((e) => e.openedSequence === commits.at(-1).sequence));

// A spectator has no seat, so every player's reveals count.
const watched = extractReveals({ origin, commits, viewerPlayerId: null });
check('a spectator sees both players’ reveals', watched.length === 2);

// Since October 2026 there is no hand-wide flag: each revealed card carries
// `revealedToOpponent`, and a card can be revealed on its own.
{
  seq = 0;
  const shown = (c) => ({ ...c, revealedToOpponent: true });
  const fresh = [
    // Whole hand, the new way.
    commit(
      { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [0, 1, 2].map((i) => hidden(OPP, 'hand', i).id) },
      { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 0, cards: [shown(A), shown(B), shown(C)] },
      log(13, 'Opp revealed their hand.'),
    ),
    commit(
      { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [A.id, B.id, C.id] },
      { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 0, cards: [0, 1, 2].map((i) => hidden(OPP, 'hand', i)) },
    ),
    // One card, then a second, hidden one at a time.
    commit(
      { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [hidden(OPP, 'hand', 0).id] },
      { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 0, cards: [shown(A)] },
    ),
    commit(
      { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [hidden(OPP, 'hand', 2).id] },
      { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 2, cards: [shown(C)] },
    ),
    commit(
      { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [C.id] },
      { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 2, cards: [hidden(OPP, 'hand', 2)] },
    ),
    commit(
      { op: 'zone_remove', playerId: OPP, zone: 'hand', cardIds: [A.id] },
      { op: 'zone_insert', playerId: OPP, zone: 'hand', index: 0, cards: [hidden(OPP, 'hand', 0)] },
    ),
  ];
  const found = extractReveals({ origin, commits: fresh, viewerPlayerId: ME });
  check('a hand revealed card by card is found', found.length === 2,
    found.map((e) => e.cards.map((c) => c.name).join('+')).join(' | '));
  check('the whole-hand reveal lists all three',
    found[1]?.cards.map((c) => c.name).join('|') === 'Vi, Peacekeeper|Mirror Image|Baited Hook');
  check('single-card reveals are one session until the last is hidden',
    found[0]?.cards.map((c) => `${c.name}${c.later ? '*' : ''}`).join('|') === 'Vi, Peacekeeper|Baited Hook*');

  // A spectator can see a hand nobody revealed; that is not a reveal.
  const seen = structuredClone(origin);
  seen.snapshot.players[1].board.hand = [A, B];
  seq = 0;
  const playsOut = [commit({ op: 'zone_move', cardId: A.id, from: { playerId: OPP, zone: 'hand' },
    to: { playerId: OPP, zone: 'base', index: 0 }, card: A }),
  commit({ op: 'zone_move', cardId: B.id, from: { playerId: OPP, zone: 'hand' },
    to: { playerId: OPP, zone: 'base', index: 1 }, card: B })];
  check('a hand that was simply visible is not a reveal',
    extractReveals({ origin: seen, commits: playsOut, viewerPlayerId: null }).length === 0);
}

// Holes in the chain: a snapshot past the hole lets the reveal carry on, and
// with none the rest of the match is simply unknown.
{
  const state = structuredClone(origin.snapshot);
  const gameplayLog = [];
  for (const c of commits.slice(0, 3)) applyCommit(state, gameplayLog, c);
  const withoutThird = [...commits.slice(0, 2), ...commits.slice(3)];

  const bridged = extractReveals({
    origin, viewerPlayerId: ME, commits: withoutThird,
    snapshots: [{ sequence: 3, snapshot: state, gameplayLog }],
  });
  check('a hole bridged by a snapshot keeps both reveals', bridged.length === 2,
    `${bridged.length} event(s)`);
  check('a card first seen in the bridging snapshot is still kept',
    bridged.find((e) => e.kind === 'hand')?.cards.some((c) => c.name === 'Sacrifice'));

  const lost = extractReveals({ origin, viewerPlayerId: ME, commits: withoutThird });
  check('an unbridged hole stops cleanly', lost.length === 0, `${lost.length} event(s)`);
}

// The catalog, read from RiftAtlas' modules as Turbopack loads them, in the
// shape the minifier writes them.
{
  const catalogModule = function (e) {
    'use strict';
    // eslint-disable-next-line no-unused-vars
    const n = [{id:"UNL-176",name:"Vi, Peacekeeper",energyCost:5,powerCost:1,type:"Unit",domains:["Order"],text:"[Ambush] When I attack, [Stun] an enemy unit here.",might:5},{id:"VEN-191",name:"Zed, Master of Shadows",energyCost:0,type:"Legend",domains:["Fury","Chaos"],text:"When you banish a card you own, empower me.",might:0},{id:"OGN-999",name:"No cost here",type:"Token",domains:["Unknown"]}];
    return e;
  };
  // Pad past the "is this the catalog" threshold, as the real one is.
  const filler = Array.from({ length: 120 }, (_, i) => `{id:"TST-${i}",name:"Filler",energyCost:1,type:"Unit",domains:["Calm"]}`).join(',');
  const bigModule = new Function('e', `const n=[${filler}];return e;`);
  const otherModule = (e) => e + 1;

  const run = (order) => {
    const posted = [];
    const timers = [];
    const ctx = {
      location: { origin: 'https://play.riftatlas.com' },
      postMessage: (m) => posted.push(m),
      addEventListener: () => {},
      setTimeout: (fn) => timers.push(fn),
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(new URL('../extension/main-world/card-catalog.js', import.meta.url), 'utf8'), ctx);
    // What the runtime receives, exactly as it would without the extension.
    const received = [];
    const chunk = (...modules) => vm.runInContext(
      '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(entry)', Object.assign(ctx, { entry: ['script', ...modules] }));
    // The runtime chunk queues its own entry first, then takes over the array.
    const runtime = () => vm.runInContext(`(() => {
      (globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push(['runtime']);
      if (!Array.isArray(globalThis.TURBOPACK)) return;
      var F = globalThis.TURBOPACK;
      globalThis.TURBOPACK = { push: function (x) { received.push(x); return 'ok'; } };
      F.forEach(globalThis.TURBOPACK.push);
    })()`, Object.assign(ctx, { received }));
    const results = [];
    for (const step of order) results.push(step === 'runtime' ? runtime() : chunk(...step));
    while (timers.length) timers.shift()();
    return { posted, received, results, ctx };
  };

  const early = run([[1, otherModule], [2, catalogModule, 3, bigModule], 'runtime', [4, otherModule]]);
  check('every chunk still reaches the runtime, unchanged',
    early.received.length === 4 && early.received[1][2] === catalogModule && early.received[3][2] === otherModule);
  check('the runtime\u2019s push still returns its own result', early.results.at(-1) === 'ok');
  const catalog = early.posted.find((m) => m.source === 'riftatlas-replay-catalog')?.catalog;
  check('catalog read from a chunk loaded before the runtime', !!catalog?.['TST-0']);
  const late = run(['runtime', [1, otherModule], [2, bigModule]]);
  check('catalog read from a chunk loaded after the runtime',
    !!late.posted.find((m) => m.source === 'riftatlas-replay-catalog')?.catalog?.['TST-0']);

  const parsed = run(['runtime', [2, new Function('e', `const n=[${filler},${catalogModule.toString().match(/\[(\{id:"UNL[^\n]*)\];/)[1]}];return e;`)]])
    .posted.find((m) => m.source === 'riftatlas-replay-catalog')?.catalog ?? {};
  const vi = parsed['UNL-176'];
  check('catalog reads energy, power and domain',
    vi?.energyCost === 5 && vi?.powerCost === 1 && vi?.domains.join() === 'Order', JSON.stringify(vi));
  check('catalog reads two domains and a missing power cost',
    parsed['VEN-191']?.domains.join() === 'Fury,Chaos' && parsed['VEN-191']?.powerCost === 0);
  check('an entry without a cost is skipped', !('OGN-999' in parsed));

  const none = run(['runtime', [1, otherModule]]);
  check('no catalog, no message, nothing broken',
    !none.posted.length && none.received.length === 2);
}

for (const path of process.argv.slice(2)) {
  const replay = JSON.parse(fs.readFileSync(path, 'utf8'));
  const found = revealsFromReplay(replay);
  console.log(`\n${path.split('/').pop()}: ${found.length} reveal(s)`);
  for (const e of found) {
    console.log(`  turn ${e.turn} ${e.playerName}'s ${e.kind}: ${e.cards.map((c) => c.name + (c.later ? ' (later)' : '')).join(', ')}`);
  }
}

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
