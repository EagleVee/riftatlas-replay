# Phase 4 — Player

**Purpose:** an offline viewer for a `.ratlas.json`.

Depends on phase 2 only. It must be developable and testable against the
reference capture with no extension and no RiftAtlas account — which is also the
test that it is genuinely standalone.

## Build

- `player.html` — a full page, not a popup. Opens a file, or a replay from the
  library.
- **Board** — two seats, all thirteen zones, cards as typed text tiles: name,
  `cardCode`, keywords, counters, exhausted and attached state.
- **Scrubber** — sequence slider, play/pause with speed, step by commit,
  chapter markers from gameplay-log `turnNumber` transitions, keyboard
  (`←`/`→` step, space play, `,`/`.` by turn).
- **Side panels** — gameplay log (click to jump), chain, chat, per-player
  think-time and score.
- **Fog banner** — persistent, naming the recording seat.

## Points of care

- **Scrubbing backwards must re-hide revealed cards.** This is the most likely
  correctness bug in the whole project: state at sequence N must come from the
  materialised timeline, never from mutating the currently displayed board. Test
  it explicitly — jump forward past a reveal, jump back, assert hidden.
- **Hidden cards are strings, not objects.** Every zone-rendering path must
  handle `"__hidden_zone__:plr_…"` appearing where a card object would be.
- **Materialise eagerly.** 371 sequences reduce in well under a second; keeping
  every state makes scrubbing instant. Optimise only if a real capture proves it
  necessary.
- **Gaps are visible.** Render a marker on the scrubber at each gap: "server
  resynced — 1 action not captured". Do not smooth over it.
- **No network.** The player must work with the network disabled. Enforce it
  with a CSP that forbids outbound connections rather than by intent.

## Verify

Load the reference capture as a replay. Walk to the end and confirm the final
board matches the server's sequence-369 snapshot — 8–7 on score, Irelia plus two attached gear
on BertoC's battlefieldA, eleven runes in EagleV's rune area, and
BertoC's four-card hand rendered face-down.

Then disable the network and repeat.

## Done when

The reference match replays correctly offline, scrubs in both directions with
correct fog, and shows the 368→369 gap.
