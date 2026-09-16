# Reconstruction feasibility — can we rebuild a match inside Solo Lab?

**Question asked:** given a captured match, can we re-stage it inside RiftAtlas'
solo feature, so the game can be replayed *in the real client*? Two obstacles
were expected: getting the opponent's deck when it is private, and controlling
what each side draws.

**Answer: yes, and neither obstacle is real.** Both dissolve once you know what
RiftAtlas actually is. But the conclusion is not "therefore build the replay
system this way" — see [Recommendation](#recommendation).

Evidence: static analysis of the production client bundles (51 files, 4.3 MB,
fetched 2026-09-16), plus the reference capture. Reproduce with
`tools/probe_client.mjs`.

## The reframe: there is no rules engine

RiftAtlas is a **manual simulator** — the Riftbound equivalent of Cockatrice or
Untap, not of an enforced digital client. Its own copy says so: *"manual board
controls for flexible tabletop-style play."*

The action vocabulary confirms it. The verbs are board manipulations rather than
game moves: `move_card`, `toggle_exhausted`, `adjust_card_counter`,
`adjust_card_might`, `create_token`, `duplicate_card`, `remove_card`,
`set_score`, `adjust_score`, `transfer_card_control`, `set_card_hidden`. The
gameplay bundle's action dispatchers carry 109 distinct `case` labels — not all
are action types, but the shape is unmistakable.

Nothing validates legality, because nothing knows the rules. The players do.

That is the whole finding. Every "how would we force X" question has the same
answer: there is already a button for it, because a human simulator player needs
that button when a card says "search your deck" or "your opponent reveals
their hand".

## Obstacle 1 — the opponent's decklist

### Solo Lab does not validate decks

Deck rules are forced to `unrestricted` for solo rooms:

```js
function nR(e) {
  return "sealed" === e.playMode ? "standard"
       : "single_player" === e.roomMode || "solo_lab" === e.roomMode ? "unrestricted"
       : ...
}
```

In `standard` mode a deck must have ≥25 core cards, exactly 12 runes, ≤3
domains, a single legend and a matching champion. `unrestricted` drops all of it.
Solo Lab will accept a deck that could never be played in a real match.

Adding the opponent is a normal flow — `add_solo_opponent` /
`solo_opponent_replace` with a chosen deck, sourced either from a saved deck or
from pasted `decklistRaw` text. Any text you can paste, you can give the
opponent seat.

### You don't need their real decklist anyway

This is the part that makes the "private deck" problem vanish.

A replay only has to reproduce what was *visible*. A card that stayed in the
opponent's hidden zones all game never affected anything the capture recorded —
it was a face-down stub then, and it is a face-down stub in the replay.

Measured on the reference capture: **17 distinct opponent cards were ever
revealed**, against a 39-card main deck plus champion, legend and 12 runes. Under
half the deck was ever seen, and the rest is, for reconstruction purposes,
interchangeable filler.

So the opponent deck you paste is: the 17 revealed cards at their observed
counts, plus arbitrary filler to make the zone counts come out right. Since Solo
Lab is `unrestricted`, that synthetic list is accepted without complaint.

**Public versus private decklists stops mattering.** You were never going to need
it. And this is the better outcome on its own terms: reconstructing a match from
what was actually shown to you does not depend on someone's deck being public,
which means it does not depend on information they chose not to share.

## Obstacle 2 — controlling the draws

### The server hides the deck order, even from its owner

Worth stating plainly, because it rules out the obvious approach: the viewer's
**own** `deck` and `runeDeck` arrive masked. The server holds the shuffled order
and never discloses it. You cannot read your own deck order from a capture, so
you cannot pre-arrange a deck to match, and there is no client-side seed to
reproduce.

### But you never have to draw

The simulator exposes direct deck manipulation, because Riftbound has search and
tutor effects and a manual simulator has to support them:

| Action | Effect |
|---|---|
| `take_card_from_deck` | Take a **specific card by id** from the deck to any zone |
| `take_top_from_deck` | Take the top card |
| `peek_deck_top` / `peek_deck_bottom` | Look at N cards from either end |
| `put_deck_peek_card_on_top` | Reorder a peeked card to the top |
| `recycle_deck_peek_card` | Return a peeked card to the deck |
| `send_to_deck` | Put any card back into the deck |
| `shuffle_deck` | Shuffle |
| `set_deck_peek_card_reveal` | Reveal a peeked card to the opponent |

`take_card_from_deck` is the one that matters, and the guard confirms it takes an
explicit card id:

```js
case "take_card_from_deck": {
  if (!n(r.to)) return !1;
  let a = e.players.find(e => e.id === t)?.board,
      o = a?.deck.find(e => e.id === r.cardId);
  ...
}
```

So reconstruction never issues `draw_cards`. It issues `take_card_from_deck`
naming the card the capture says was drawn. Deck order becomes irrelevant.

**No hacking, no exploit, no protocol abuse.** These are documented buttons in
the UI, doing exactly what they were built to do.

### And you control both seats

In Solo Lab every seat is yours:

```js
n = "spectator" === r ? []
  : t.room?.roomMode === "solo_lab" ? a   // a = every player id in the room
  : normalizeControlledPlayerIdsForRoom(t.room, t.session)
```

`controlledPlayerIds` is the full roster. You drive the opponent's board, hand
and deck as freely as your own — which is what makes staging a two-sided game
state possible at all.

## So: feasible

Replaying a captured match into Solo Lab is mechanically straightforward:

1. Open a Solo Lab room, paste your real decklist (the capture has it verbatim in
   `room_shell_sync.sessionDoc.selfPlayer.decklistRaw`).
2. Add a solo opponent with the synthetic revealed-cards deck.
3. Walk the capture's commit list. Translate each action into the equivalent
   manual action, substituting `take_card_from_deck` wherever the capture drew.
4. Set scores, counters, exhausted states and tokens directly where the replay
   says so, rather than deriving them.

Every step maps to an existing action type. Nothing needs to be forced.

## Recommendation

**Feasible is not the same as right.** For a *replay* system, this is the worse
architecture, on three counts:

- It makes every replay a live room on someone else's production
  infrastructure. A passive replay player needs nothing from RiftAtlas at all,
  works offline, and works if the site is down or gone.
- It is automation driving their real client, which means it breaks whenever the
  UI or action schema changes — and `setupOrderVersion: 2` says the schema does
  change.
- Reconstruction is lossy in a way that passive replay is not. Scrubbing
  backwards means undoing, and a reconstructed board is our approximation of the
  original rather than the server's own state. The passive player reduces to
  state the server actually published, which
  [`verify.py`](../tools/verify.py) proves byte-exact.

So: **keep the standalone player as the replay system**, and treat Solo Lab
reconstruction as a *different feature for a different job* —

> **"Open this position in the sandbox."** Scrub a replay to any turn, then
> launch a Solo Lab room staged to exactly that board state, and play out a
> different line.

That is worth building precisely because a passive player cannot do it. Reviewing
what happened and experimenting with what could have happened are separate needs,
and the research shows the second one is within reach.

It should be deferred past v1 regardless: it depends on the replay format, the
reducer and the player all being solid first, and it is the piece most likely to
break under protocol drift.

## Before building it

Two things to settle, neither technical:

- **Owner sign-off, separately from the replay recorder.** Recording is passive
  observation of your own session. Programmatically driving actions into the
  production server is a different thing to ask for, even in a solo room with no
  opponent. Ask explicitly, describe the traffic shape, and keep it
  user-initiated — one room per explicit click, never bulk or background.
- **The no-send rule still holds everywhere else.** The recorder must remain
  incapable of sending. If reconstruction is built, it belongs in a separate
  component with its own code path, so that "observes only" stays structurally
  true of the recorder rather than becoming a matter of configuration.

## Incidental finding: card art is resolved

While reading the bundles, [open question 1](open-questions.md) closed.

The full card catalog ships client-side — 875+ card codes with name, cost, type,
domains, rules text, might, rarity, set, keywords, subtypes and `imageUrl`:

```js
{ id: "VEN-191", name: "Zed, Master of Shadows", energyCost: 0, type: "Legend",
  domains: ["Fury","Chaos"], text: "When you banish a card you own, empower me…",
  might: 0, imageUrl: "/cards/VEN-191.webp", rarity: "Showcase",
  set: "Vendetta", keywords: ["Action"], subtypes: ["Zed"] }
```

Art resolves to `https://assets.riftatlas-workers.com/riftbound/cards/<slot>/<CARD-CODE>.webp`
where `<slot>` is `small-v2` or `original`. Verified live:

| URL | Result |
|---|---|
| `…/cards/small-v2/VEN-191.webp` | 200, 83 KB |
| `…/cards/original/VEN-191.webp` | 200, 160 KB |
| `…/cards/small-v2/OGN-012.webp` | 200, 47 KB |
| `…/cdn-cgi/image/width=384,…/cards/small-v2/VEN-191.webp` | 403 — the resize proxy is not open for card art |

Unauthenticated and stable. **This is a technical answer, not permission.**
Hotlinking their CDN from a replay player still costs them bandwidth and breaks
offline playback; bundling the art is a licensing question that belongs to Riot's
"Legal Jibber Jabber" policy, under which RiftAtlas itself operates. Ask the
owner before either. The v1 text-tile board remains the correct default.

The catalog itself is the more useful find: bundling it gives the replay player
real card names, types, costs and rules text with no network access at all.
