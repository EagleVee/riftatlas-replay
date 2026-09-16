# Open questions

Things one capture cannot answer. Each names what would answer it, so these get
resolved by measurement rather than argument.

## 1. Card art resolution — ANSWERED 2026-09-16

Art lives at
`https://assets.riftatlas-workers.com/riftbound/cards/<small-v2|original>/<CARD-CODE>.webp`,
unauthenticated, verified live. The full card catalog (name, cost, type, domains,
rules text, might, rarity, set, keywords, subtypes, `imageUrl`) ships in the
client bundle. Details in
[`reconstruction-feasibility.md`](reconstruction-feasibility.md#incidental-finding-card-art-is-resolved).

**Still open, and not a technical question:** whether to use it. Hotlinking costs
the owner bandwidth and breaks offline playback; bundling is a licensing question
under the Riot policy RiftAtlas operates below. Ask the owner. v1 ships text
tiles and is useful without art.

The catalog is the more valuable half — bundling it gives the player real card
data with no network access.

## 2. Spectator masking — decides whether full-information replays exist

`viewer.role` and `spectator_roster_sync` exist, so spectators are a first-class
concept. Whether a spectator socket masks both players' hidden zones, neither, or
masks them the same way a player's does is **unknown**. If spectators see
everything, spectating is a far better recording path than merging two player
captures.

**To answer:** spectate one match and capture it.

Note that Solo Lab is *not* an answer here: it grants control of every seat, but
only within a room you created, and tells us nothing about how a spectator sees
someone else's live match.

## 3. Protocol drift

`setupOrderVersion: 2` and `rewindProtocolVersion` show the server versions its
own protocol and has changed it before. We have one capture from one day.

**To answer:** capture periodically and diff the frame-type and patch-verb
inventory with `tools/analyze.py`. Cheap insurance; the reducer should also fail
loudly on an unknown verb rather than skipping it, so drift surfaces as an error
rather than a wrong board.

## 4. Non-duel variants

`gameVariant: "duel"` implies others. Multiplayer or team formats may carry more
than two `players[]`, extra zones, or different phases. The reducer is
shape-agnostic and should cope, but "should" is not "does".

**To answer:** capture one match of each variant the game offers.

## 5. Match-end detection

This match ended by concession, detectable via a gameplay-log entry
(`"BertoC conceded. EagleV wins."`). Whether a normal win emits a comparable
terminal entry, a phase change, or nothing at all is unverified — and the
recorder's finalisation trigger depends on it.

**To answer:** capture a match that ends by normal victory.

## 6. Reconnect and multi-game matches

`resume_game` appeared once in this capture. How a mid-match reconnect affects
sequence continuity, and how a Bo3 represents game 2 (new room code? new
sequence space? same socket?), are both unknown.

**To answer:** capture a Bo3, and a match with a deliberate mid-game reload.
