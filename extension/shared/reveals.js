/**
 * Cards an opponent showed you and then hid again.
 *
 * Two things in Riftbound put an opponent's hidden cards in front of you for a
 * while: revealing their hand, or cards in it (`set_hand_reveal`,
 * `set_card_revealed_to_opponent`), and revealing cards they are looking at on
 * top of their deck (`set_deck_peek_card(s)_reveal`). The server
 * sends the real card objects for as long as the reveal lasts, then masks them
 * again. Nothing here sees more than that - it only remembers what was shown.
 *
 * A reveal is a session, not a moment. It opens when the first card becomes
 * visible and closes when the cards are hidden again, and every card seen in
 * between is kept. Reading the board when it closes would miss cards: a revealed
 * hand loses the card that gets played, and a deck peek is drained one card at
 * a time as cards are taken or recycled.
 *
 * Only closed sessions are reported. A reveal that is still showing is on the
 * board already, and one that never closes - a hand left revealed to the end of
 * the game - was never hidden, so there is nothing to remember.
 *
 * Detection reads the reduced state after every commit rather than matching
 * action names, so it follows whatever verb RiftAtlas uses to show or hide.
 */
import { applyCommit } from './reducer.js';

const visible = (card) => card && typeof card === 'object' && !card.isPlaceholder;

const keep = (card) => ({
  id: card.id, name: card.name ?? '', cardCode: card.cardCode ?? null, type: card.type ?? null,
});

/** The opponent's deck cards currently revealed to the viewer, by id. */
function revealedDeckCards(board) {
  const revealed = new Set(board?.deckPeek?.revealedCardIds ?? []);
  if (!revealed.size) return [];
  return (board.deck ?? []).filter((c) => revealed.has(c.id) && visible(c));
}

/**
 * The opponent's hand cards currently revealed to the viewer.
 *
 * RiftAtlas has marked this two ways. Earlier, revealing a hand set
 * `handRevealToOpponent` on the board. Since October 2026 that flag is gone and
 * each revealed card carries `revealedToOpponent` instead - which also lets a
 * single card be revealed on its own (`set_card_revealed_to_opponent`). Either
 * counts. A visible card with neither is not a reveal: a spectator can see a
 * whole hand, and that is not something the player showed.
 */
function revealedHandCards(board) {
  const whole = board?.handRevealToOpponent === true;
  return (board?.hand ?? []).filter((c) => visible(c) && (whole || c.revealedToOpponent === true));
}

const KINDS = [
  { kind: 'hand', read: revealedHandCards },
  { kind: 'deck', read: revealedDeckCards },
];

/**
 * Every closed reveal in a recording, newest first.
 *
 * `snapshots` are the later authoritative snapshots a recording kept, used to
 * step over holes in the commit chain the same way the replay builder does. A
 * reveal open across a hole carries on; any card shown only inside the hole is
 * simply not known.
 */
export function extractReveals({ origin, commits, snapshots = [], viewerPlayerId = null }) {
  if (!origin?.snapshot) return [];
  let state = structuredClone(origin.snapshot);
  let log = structuredClone(origin.gameplayLog ?? []);
  let sequence = origin.sequence;
  const anchors = [...snapshots].sort((a, b) => a.sequence - b.sequence);

  const open = new Map();   // `${kind}:${playerId}` -> session
  const closed = [];

  const observe = (commit) => {
    for (const p of state.players ?? []) {
      if (p.id === viewerPlayerId) continue;
      for (const { kind, read } of KINDS) {
        const key = `${kind}:${p.id}`;
        const cards = read(p.board);
        let session = open.get(key);
        if (cards.length) {
          if (!session) {
            session = {
              id: `${key}:${sequence}`, kind, playerId: p.id, playerName: p.name ?? '',
              turn: log[0]?.turnNumber ?? null,
              openedSequence: sequence, openedT: commit?.t ?? null,
              cards: new Map(),
            };
            open.set(key, session);
          }
          const first = session.openedSequence === sequence;
          for (const c of cards) {
            if (!session.cards.has(c.id)) session.cards.set(c.id, { ...keep(c), later: !first });
          }
        } else if (session) {
          open.delete(key);
          const shown = [...session.cards.values()];
          closed.push({
            ...session, closedSequence: sequence, cards: shown,
            // The same cards shown again by the same player read as one entry
            // shown several times; this is what "the same" means.
            signature: `${key}:${shown.map((c) => c.id).sort().join(',')}`,
          });
        }
      }
    }
  };

  observe(null);
  for (const commit of commits) {
    if (commit.baseSequence !== sequence) {
      // The latest snapshot that still lets the chain continue, as the
      // Timeline chooses it.
      const repair = anchors.filter((s) => s.sequence >= sequence && s.sequence <= commit.baseSequence).at(-1);
      if (repair) {
        state = structuredClone(repair.snapshot);
        log = structuredClone(repair.gameplayLog ?? []);
        sequence = repair.sequence;
        observe(null);
      }
    }
    if (commit.baseSequence !== sequence) continue;
    try {
      applyCommit(state, log, commit);
    } catch {
      // A verb the reducer predates. Everything up to here is still right.
      break;
    }
    sequence = commit.sequence;
    observe(commit);
  }

  return closed.sort((a, b) => b.closedSequence - a.closedSequence);
}

/** The same, read from a finished `.ratlas.json`. */
export function revealsFromReplay(replay) {
  return extractReveals({
    origin: replay.origin,
    commits: replay.commits ?? [],
    snapshots: (replay.gaps ?? []).filter((g) => g.snapshot).map((g) => ({
      sequence: g.toSequence, snapshot: g.snapshot, gameplayLog: g.gameplayLog ?? [],
    })),
    viewerPlayerId: replay.viewer?.playerId ?? null,
  });
}
