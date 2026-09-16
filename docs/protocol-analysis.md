# Protocol analysis — RiftAtlas realtime match socket

**Source capture:** one complete ranked constructed Bo1 duel, room `3NKJ3`, 19.4
minutes, 2207 WebSocket frames, ~1.1 MiB on the wire. Captured from a player
seat via Chrome DevTools "Save all as HAR".

Generated tables for this capture live in
[`evidence/capture-3NKJ3-analysis.md`](../evidence/capture-3NKJ3-analysis.md)
and are reproducible with `tools/analyze.py`.

## Headline finding

**The match socket is an event-sourced log, and it is exactly replayable.**

The server sends periodic `authoritative_snapshot` frames carrying full game
state at a sequence number, and `authoritative_patch_commit` frames that advance
state from `baseSequence` to `sequence` by applying an ordered list of
domain-level patch operations. Nothing else is needed to reconstruct the board.

We proved this rather than assumed it. `tools/reducer.py` implements the patch
semantics; `tools/verify.py` reduces the capture from the sequence-0 snapshot
and diffs the result against every later snapshot the server sent:

```
sequence 8: reduced state matches snapshot
sequence 9: reduced state matches snapshot
resync: server re-anchored 368 -> 369; 1 commit(s) never reached this client
371 sequences materialised (0..370), 2 snapshot checks, 0 failed
```

The reduced state is byte-identical to the server's own snapshots, including the
99-entry human-readable gameplay log. The single exception is a cosmetic
`players[].identity` object (playmat, sleeve and rune-deck skins) that the server
injects into snapshots but never patches — recorded in
`reducer.SNAPSHOT_ONLY_PLAYER_FIELDS`, and irrelevant to game state.

This is the whole feasibility question, and the answer is yes. A replay does not
need to re-implement RiftAtlas' rules engine, simulate anything, or guess. It
replays a list of patches that the server already computed.

## What a replay gets for free

Every committed patch carries the `action` that caused it, so the timeline is
already annotated with semantic events — `end_turn`, `chain_resolve`,
`battlefield_conquer_confirm`, `draw_cards` and 25 other action types across this
one match. Scrubbing to "the start of turn 9" is a filter over data we already
have, not an inference.

The gameplay log is richer still. Each entry carries `turnNumber`,
`turnPlayerId`, `actionType`, `actionKind`, an `at` timestamp and rendered text
(`"BertoC conceded. EagleV wins."`). That is a ready-made replay scrubber track
with chapter markers, needing no additional derivation.

Per-player thinking time also comes free: 375 frames carry an `actionClock` with
cumulative `totals` per player. At the end of this match, `plr_72272ae6` had
consumed 383.6s and `plr_135347f2` 741.6s. Time-pressure analysis is a read, not
a computation.

## The hard constraint: captures are viewer-scoped

Hidden zones are masked per viewer before the server sends them. A masked card
arrives as a stub object — `isPlaceholder: true`, an empty `name`, and an id of
the form `__hidden_zone__:<playerId>:<zone>:<index>` — one per card, so counts
are accurate but identities are not. In the final snapshot of this capture, the
recording player's hand shows ten named cards while the opponent's shows four
stubs.

The masking is stricter than "you see your own cards". **The viewer's own deck
and rune deck are masked from the viewer too** — only the hand is revealed. The
server holds the deck order and does not disclose it to its owner, which means a
capture can never tell you what you were about to draw. That has direct
consequences for reconstruction; see
[`reconstruction-feasibility.md`](reconstruction-feasibility.md).

**This is not a bug to work around, and we should not try.** The masking is the
game's hidden-information model. It means:

- A replay recorded from a player seat is a **fog-of-war replay from that seat**,
  which is the honest and useful artifact for reviewing your own play.
- A full-information replay requires either both players' captures merged, or a
  spectator seat. The socket exposes `spectator_roster_sync` and a
  `viewer.role` field, so a spectator's masking profile is a real thing to go
  measure — but it is unmeasured today, and we should not design around a guess.

Cards become visible the moment the game reveals them: `zone_move` commits carry
the full post-move card object, so a card drawn into a hidden hand and later
played onto the battlefield is fully identified at play time. A fog-of-war replay
therefore reveals the opponent's cards exactly when the opponent's live opponent
saw them, which is the correct behaviour for play review.

## The other real constraint: captures can have holes

Sequence 368 is followed by 369 with no commit between them. The client had sent
an action, the server rejected it with
`{"code": "stale_action_state", "mutationClass": "resync_required"}`, and pushed
a fresh 62 KiB snapshot at sequence 369 to re-anchor the client. One commit never
reached this client and is unrecoverable from this capture.

A replay format must model this. The consequence is bounded — we lose the *cause*
of one state transition, not the state itself, because the snapshot restores full
truth — but a replay player that silently glosses over a gap will eventually show
a board that changes with no explanation. `Timeline` in `tools/reducer.py`
records every such jump in `resyncs`, and the replay format carries them forward
as first-class `gap` markers so the UI can say "the server resynced here".

## Traffic shape and what to discard

20% of wire bytes are ephemeral and must not be persisted:

- `presence_update` (931 frames, 112 KiB) — the local client broadcasting which
  card the mouse is hovering, roughly one frame per 1.2 seconds of play.
- `presence_event` (429 frames) — the same from the other seat, plus
  `card_ping`, `board_emote` and `chat_typing`.
- `rewind_confirmation_state` (253 frames, 20 KiB) — `{"confirmation": null}`
  every time, for the entire match. Pure keepalive noise in this capture.
- `auth_session` / `auth_refresh` — token lifecycle.

Of the remainder, `authoritative_patch_commit` (522 KiB) and
`authoritative_snapshot` (232 KiB) are the replay. `room_shell_sync` (10 frames,
84 KiB) is largely redundant re-sends of the same session document, but it is the
**only** source of two things a replay wants: both players' decklists
(`selfPlayer.decklistRaw`, the full text list with set codes) and match metadata
(`playMode`, `matchFormat`, `deckRulesMode`, `roomOrigin`, `gameVariant`).

Snapshots are the storage problem, not the commits. Six snapshots cost 232 KiB
because each is a full board; the 369 commits that encode the entire match cost
522 KiB. Keeping the sequence-0 snapshot plus all commits, and re-deriving the
rest, is both smaller and more faithful than keeping snapshots.

## Security note on captures

Frames 0, 3 and one `resume_game` carry a full Clerk JWT in `authToken`, and the
socket URL carries a `_pk` party key. The token in this capture decodes to a
short-lived credential (~98s remaining when issued) that is long expired, but the
capture also contains the player's real name in the JWT payload.

`tools/har_to_jsonl.py` redacts `authToken`, `token`, `jwt` and `_pk` by default.
The extension must do the same before any replay leaves the browser, and this
repo's `.gitignore` excludes `*.har` so raw captures are never committed.

## What this does not tell us

Deliberately unanswered, because the capture cannot answer them:

- **Card art.** The socket carries `cardCode` (`VEN-191`, `OGN-012`) and 35
  distinct codes in this match, but no image URLs — art is fetched over HTTP,
  which this HAR filtered out. Asset resolution is an open question, not a solved
  one. See [`open-questions.md`](open-questions.md).
- **Spectator masking.** Asserted above as unknown; needs a spectator capture.
- **Protocol stability.** `setupOrderVersion: 2` and `rewindProtocolVersion`
  suggest the server versions its own protocol and has changed it before. One
  capture from one day tells us nothing about drift.
