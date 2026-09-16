# Phase 4 — Player

**Purpose:** an offline viewer for a `.ratlas.json`, navigable forward and
backward like a chess.com game review.

Depends on phase 2 only. It must be developable and testable against the
reference capture with no extension and no RiftAtlas account — which is also the
test that it is genuinely standalone.

Navigation is the centrepiece, not a feature bolted to a board renderer. The
model is specified in [`docs/replay-navigation.md`](../docs/replay-navigation.md);
this phase builds it.

## 4a — Timeline index

Before any UI. Given a replay, produce the index the whole player reads from:

- **Sequences** — `Timeline` already materialises all 371. Backward navigation
  is a lookup into this, never an undo.
- **Events** — walk sequences in order, recording each gameplay-log entry id the
  first time it appears. This yields 291 events on the reference capture.
  **Do not read the final `gameplayLog`** — the server trims it as the match
  runs, and the final state holds only 99 of the 291.
- **Chapters** — phase transitions (6) and `turnNumber` transitions (14), each
  with its sequence span.
- **Gaps** — from `Timeline.resyncs`, carried through to the scrubber.

Verify with a test asserting exactly these counts against the reference capture:
371 sequences, 291 events, 6 phases, 14 turns, 1 gap at 368→369.

## 4b — Board

Two seats, all thirteen zones, cards as typed text tiles: name, `cardCode`,
keywords, counters, exhausted and attached state.

The bundled card catalog (from
[`docs/reconstruction-feasibility.md`](../docs/reconstruction-feasibility.md))
gives real names, types, costs and rules text with no network access. Card art
stays out of v1 pending the owner conversation.

Masked cards render face-down with accurate counts. Detect them with
`isPlaceholder === true` — they are stub objects, not strings, and they carry no
`cardCode`, `type` or `ownerPlayerId`, so every zone-rendering path must tolerate
those fields being absent.

## 4c — Navigation

- **Scrubber** over sequences 0–370 with chapter bands, event ticks, gap markers
  and playhead. Setup is 3% of sequences but a third of the chapters, so bands
  are sized by sequence span with a minimum width.
- **Chapter rail** — `battlefield_pick`, `initiative_roll`, `first_player_choice`,
  `sideboarding`, `mulligan`, then turns 1–14. Clicking jumps.
- **Event list** — all 291, clicking jumps, autoscrolls to the playhead. This is
  the move list.
- **Keyboard** — `←`/`→` sequence, `↑`/`↓` event, `[`/`]` chapter, `Home`/`End`,
  `Space` play/pause, `1`–`9` jump to turn. Arrows must never be swallowed by a
  focused panel.
- **URL fragment** — `#seq=112`, so a position is linkable and survives reload.

Autoplay advances by event and pauses at chapter boundaries, so playback reads as
a sequence of moves rather than a flicker of commits.

## 4d — Panels

Gameplay log (the event list), chain, chat, per-player score and think time.
`actionClock.totals` gives think time directly — 383.6s vs 741.6s on the
reference match — and where that time went is much of what a review is for.

## Points of care

- **Backward navigation must not be an undo.** State at any sequence comes from
  the materialised timeline. This is the single design decision that prevents the
  most likely correctness bug — a card revealed at turn 9 staying visible after
  stepping back to turn 8. Test it explicitly: jump past a reveal, jump back,
  assert the card is a placeholder again.
- **Never read the final gameplay log as the move list.** It is a rolling window;
  192 of 291 events had been trimmed by the end of the reference match.
- **Who goes first is decided before sideboarding**, in `initiative_roll` and
  `first_player_choice` — not at the mulligan. Show them as their own chapters.
- **Materialise eagerly.** 371 sequences reduce in well under a second. Optimise
  only if a real capture proves it necessary.
- **Gaps are visible.** Render a marker at the 368→369 resync: "server resynced —
  1 action not captured". Do not smooth over it.
- **No network.** Enforce with a CSP that forbids outbound connections rather
  than by intent.

## Verify

Load the reference capture as a replay and check:

1. The index reports 371 sequences, 291 events, 6 phases, 14 turns, 1 gap.
2. Chapters land on the measured sequences: phases at 0, 2, 3, 4, 8, 10; turn 1
   at seq 11, turn 9 at seq 139, turn 14 at seq 370.
3. The final board matches the server's sequence-369 snapshot — 8–7 on score,
   Irelia plus two attached gear on BertoC's battlefieldA, eleven runes in
   EagleV's rune area, and BertoC's four-card hand face-down.
4. Stepping to the end and back to seq 0 returns the opening board exactly.
5. Every keyboard control works, and `#seq=` survives reload.

Then disable the network and repeat.

## Done when

The reference match replays offline, steps and jumps correctly in both
directions at all three tiers, shows correct fog when scrubbing backwards, and
surfaces the 368→369 gap.
