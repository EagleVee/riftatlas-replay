# RiftAtlas Replay

A Chrome extension that records RiftAtlas matches and replays them offline.

The **replay player works today** and plays back a real captured match offline:
step and jump forward and backward across sequences, moves and chapters, with
correct fog of war. The **recorder** — the part that observes a live match — is
not built yet.

**To watch a match you already captured**, load the extension
([how](extension/README.md#installing-for-development)), click its icon, choose
**Open player**, and drop your `.har` straight onto the page — it converts in
the browser. A `.ratlas.json` replay works the same way.

```bash
tests/run.sh path/to/capture.har      # build a replay and check it end to end
```

See [`extension/README.md`](extension/README.md) for controls and install steps,
and [`INSTALL.md`](INSTALL.md) for the guide to hand a tester.

**To share it:** `tools/package.sh` builds `dist/riftatlas-replay-<version>.zip`
alongside the tester guide. They unzip it, open `chrome://extensions`, enable
Developer mode, and *Load unpacked*. No store listing needed.

**To work on it:** [`BUILD.md`](BUILD.md). There is no build step — the
extension is plain ES modules with no dependencies, so what ships is exactly
what is in the repository.

Built with the permission of the RiftAtlas owner.

## The finding this is built on

The RiftAtlas match WebSocket is an event-sourced log. The server sends full
state snapshots at a sequence number, then ordered patch commits that advance it.
Replaying a snapshot plus its commits reproduces the server's state exactly.

This is verified, not assumed. `tools/reducer.py` implements the patch semantics
and `tools/verify.py` checks the result against the server's own snapshots:

```
$ python3 tools/har_to_jsonl.py capture.har frames.jsonl
$ python3 tools/verify.py frames.jsonl
sequence 8: reduced state matches snapshot
sequence 9: reduced state matches snapshot
resync: server re-anchored 368 -> 369; 1 commit(s) never reached this client
371 sequences materialised (0..370), 2 snapshot checks, 0 failed
```

Byte-identical, including the 99-entry gameplay log. A replay player does not
need to re-implement RiftAtlas' rules — it replays patches the server already
computed.

## Replay mode: their board, our data

A replay can also be rendered in **RiftAtlas' own UI** — real card art, their
match log, their layout — by answering the client's match socket locally with
recorded frames. Their client renders a game purely from frames it receives,
which is what spectating is, so it draws the board without knowing the frames
are recorded.

Verified working against the live client. It is deliberately fenced off from the
recorder: see [`extension/replay-mode/README.md`](extension/replay-mode/README.md)
for the structural argument and the known limits.

## Why a recorder is necessary

RiftAtlas keeps server-side match history — results, decks, scores, duration —
but **no play-by-play**. The `gameHistory` API is `list`, `decks`, `remove`,
`undoRemove`, `updateResult`, `setDeckPrivacy`, `saveDeckError`; there is no
match-log, action or replay query (verified against a live signed-in session,
2026-09-16). The action log exists only in the live socket, so observing that
socket is the only way to get replay data.

Game History does solve deck lookup: `gameHistory:decks({gameId})` returns both
players' decklists, or `null` for a player whose account is set private.

## RiftAtlas is a manual simulator

There is no rules engine. The action vocabulary is board manipulation —
`move_card`, `toggle_exhausted`, `create_token`, `set_score`,
`take_card_from_deck` — because the players enforce the rules themselves.

This matters more than it sounds. It means a captured match can be re-staged
inside a Solo Lab room using nothing but documented UI actions: no rules to
satisfy, no deck validation, no draw order to defeat. See
[`docs/reconstruction-feasibility.md`](docs/reconstruction-feasibility.md) — and
the argument there for why the replay system should *not* be built that way.

## The two constraints worth knowing up front

**Captures are viewer-scoped.** Opposing hidden zones arrive masked as
`__hidden_zone__` placeholders. A replay recorded from a player seat is a
fog-of-war replay from that seat. That is the honest artifact for reviewing your
own play, and the format records it as such rather than hiding it.

**Captures can have holes.** When the server forces a resync it re-anchors the
client with a fresh snapshot and the intervening commits are lost. State is
recovered; the *cause* of one transition is not. Gaps are first-class in the
format and visible in the player.

## Documentation

| | |
|---|---|
| [`docs/protocol-analysis.md`](docs/protocol-analysis.md) | What the capture showed, and the replayability proof |
| [`docs/protocol-reference.md`](docs/protocol-reference.md) | Frame types, patch operations, state shape |
| [`docs/replay-format.md`](docs/replay-format.md) | The `.ratlas.json` specification |
| [`docs/replay-navigation.md`](docs/replay-navigation.md) | Step/event/chapter model for forward-backward review |
| [`docs/architecture.md`](docs/architecture.md) | Extension design and its trade-offs |
| [`docs/reconstruction-feasibility.md`](docs/reconstruction-feasibility.md) | Can a match be re-staged inside Solo Lab? |
| [`docs/open-questions.md`](docs/open-questions.md) | What one capture cannot answer |
| [`plans/00-index.md`](plans/00-index.md) | Six-phase build plan |
| [`BUILD.md`](BUILD.md) | Building, testing and packaging from source |
| [`INSTALL.md`](INSTALL.md) | The guide to hand a tester |

## Tools and tests

Python 3 and Node, no dependencies beyond the standard libraries.
`tools/reducer.py` is the **normative** reducer; `extension/shared/reducer.js`
must match it, and `tests/run.sh` proves it does on every capture.

```bash
python3 tools/har_to_jsonl.py capture.har frames.jsonl   # extract + redact
python3 tools/verify.py frames.jsonl                     # prove replayability
python3 tools/analyze.py frames.jsonl                    # protocol inventory
python3 tools/har_to_replay.py capture.har out.ratlas.json
tests/run.sh capture.har                                 # all of the above + JS parity
```

`tests/run.sh` also greps the built replay for JWT-shaped strings and
`authToken`, so a credential leak fails the build rather than shipping.

`tools/probe_client.mjs` (Node + Playwright) fetches the production client
bundles and dumps the action vocabulary — re-run it after a RiftAtlas deploy to
detect protocol drift.

To take a capture: DevTools → Network → filter WS → play a match → right-click →
*Save all as HAR with content*.

## Ground rules

- **Observe only.** The recorder never sends, modifies, or delays a frame. This
  is the line between a replay tool and a cheat, and it is permanent scope, not a
  v1 limitation.
- **No credentials, ever.** Captures contain live JWTs and party keys. The tools
  redact at extraction; `.gitignore` excludes `*.har` so raw captures are never
  committed.
- **Don't fake what wasn't captured.** Masked zones stay masked, gaps stay
  visible, and an opponent's decklist stays `null` rather than being guessed from
  observed cards.
