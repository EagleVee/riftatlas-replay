# Replay navigation model

The replay must step forward and backward through a match the way chess.com
steps through a game: every position reachable, in both directions, with a
clickable list and keyboard control.

This document defines what a "step" is. Every number in it is measured from the
reference capture, not assumed.

## Why backward navigation is free

The critical property, and the reason this is cheaper than it sounds:
`Timeline` materialises **every** sequence up front. Going backward is a lookup,
never an undo.

That matters because undo is where replay players get subtly wrong. A card
revealed at turn 9 must be face-down again when you step back to turn 8, and an
undo-based player has to remember to re-hide it. A lookup-based player cannot get
this wrong — the state at sequence 112 was computed from the sequence-0 snapshot
and never mutated afterwards.

Measured cost on the reference match: 371 states, materialised in well under a
second. Eager materialisation stays the design until a capture proves otherwise.

## Three tiers

| Tier | Unit | Count (reference match) | Control |
|---|---|---|---|
| **Sequence** | one authoritative commit | 371 | `←` `→` |
| **Event** | one narrated game action | 291 | `↑` `↓`, click in the log |
| **Chapter** | one phase or turn | 6 phases + 14 turns | `[` `]`, click in the rail |

Sequence is the atom. Every displayed position is a real server state, so the
scrubber can never land somewhere the game never was.

### Why not make events the atom?

283 of 369 commits produce a narrated log entry. The other 86 are silent —
`adjust_card_counter` (55), `chain_set_resolve_vote` (11), `target_arrow_add` (9),
`set_card_hidden` (6), `set_card_label` (5).

Silent does not mean invisible. A counter going from 2 to 3 changes the board
and the game's own log says nothing about it. If events were the atom, those 86
changes would happen *between* steps, and the board would appear to change
without a step to explain it.

So: sequence stepping never skips anything, and event stepping is the faster gear
on top of it.

## The narration is richer than the live game's

The gameplay log is a **trimmed rolling window**, not a complete record. The
server issues `log_remove` as the match runs — 189 removals against 290 inserts
in the reference capture.

| | |
|---|---|
| Narrated events across the whole match | 291 |
| Events still in the log at the end | 99 |
| Events the live client had scrolled away | 192 |

Accumulating every entry ever inserted recovers all 291. **The replay therefore
shows two-thirds more history than the player could see while playing.** That is
a real feature, and it falls out of the format for free: the commits carry the
`log_insert` operations, so no format change is needed — only the discipline to
accumulate rather than read the final log.

Build the event list by walking sequences in order and recording each log entry
id the first time it appears. Do not read `gameplayLog` at the final sequence and
call it the move list; that silently loses 192 events.

## Chapters: the real phase order

The pre-game phases are their own chapters, because reviewing a match usually
starts with "what did we each keep?"

Measured order and cost:

| Seq | t | Phase |
|---|---|---|
| 0 | 0.0s | `battlefield_pick` |
| 2 | 13.5s | `initiative_roll` |
| 3 | 13.9s | `first_player_choice` |
| 4 | 18.7s | `sideboarding` |
| 8 | 22.6s | `mulligan` |
| 10 | 34.9s | `in_game` |

**Note the ordering.** Who goes first is settled by `initiative_roll` then
`first_player_choice`, *before* sideboarding and mulligan — not at the mulligan.
A d20 roll decides it, narrated as *"Both battlefields are locked. Roll a d20 to
decide first player."* The chapter rail should show those as two distinct
chapters so the decision is visible where it actually happened.

All of setup is sequences 0–10 and 35 seconds — six chapters over eleven
sequences. In-game is sequences 10–370.

Turn chapters come from `turnNumber` transitions in the log: 14 turns,
alternating seats, from seq 11 to seq 370.

## Scrubber

A single horizontal track over sequence 0–370, carrying:

- **Chapter bands** — the six setup phases compressed at the left, then turn
  bands. Setup is 3% of sequences but a third of the chapters, so bands are drawn
  proportional to *sequence span* with a minimum width, and labelled.
- **Event ticks** — one per narrated event, denser where play was dense.
- **Gap markers** — the 368→369 resync renders as a break with a tooltip
  explaining one action was never captured. Never smoothed over.
- **Playhead** — with the current chapter and event text beside it.

Think time is available per player (`actionClock.totals`) and worth showing on
the track as a heat band: 383.6s vs 741.6s in the reference match, and *where*
that time went is exactly what a review wants.

## Keyboard

| Key | Action |
|---|---|
| `→` / `←` | Next / previous sequence |
| `↓` / `↑` | Next / previous narrated event |
| `]` / `[` | Next / previous chapter |
| `Home` / `End` | First / last sequence |
| `Space` | Play / pause |
| `1`–`9` | Jump to turn N |

Arrow keys are the primary control and must never be swallowed by a focused
panel. Autoplay advances by event, not sequence, and pauses at chapter
boundaries by default so a match plays back as a readable sequence of moves.

## URL state

The current sequence belongs in the URL fragment (`#seq=112`), so a position is
linkable and survives reload. That is how a review gets shared: "look at turn 9",
as a link that opens exactly there.
