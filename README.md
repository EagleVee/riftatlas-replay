# RiftAtlas Replay

A Chrome extension that records RiftAtlas matches and replays them offline.

This repository currently holds the **protocol analysis, replay format, and build
plan**. No extension code is written yet — phase 1 is a spike that tests the one
assumption everything else rests on.

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
| [`docs/architecture.md`](docs/architecture.md) | Extension design and its trade-offs |
| [`docs/reconstruction-feasibility.md`](docs/reconstruction-feasibility.md) | Can a match be re-staged inside Solo Lab? |
| [`docs/open-questions.md`](docs/open-questions.md) | What one capture cannot answer |
| [`plans/00-index.md`](plans/00-index.md) | Six-phase build plan |

## Tools

Python 3, no dependencies. `tools/reducer.py` is the **normative** reducer — the
JavaScript port must match it.

```bash
python3 tools/har_to_jsonl.py capture.har frames.jsonl   # extract + redact
python3 tools/verify.py frames.jsonl                     # prove replayability
python3 tools/analyze.py frames.jsonl                    # protocol inventory
```

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
