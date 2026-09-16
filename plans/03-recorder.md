# Phase 3 — Recorder

**Purpose:** turn observed frames into a finalised, valid, credential-free
`.ratlas.json`, surviving everything MV3 does to a service worker.

Depends on phases 1 and 2.

## Build

- **Filter.** Keep `authoritative_snapshot`, `authoritative_patch_commit`,
  `room_shell_sync`, `chat_sync`, `chat_append`, `error`. Drop the rest. An
  unrecognised frame type is kept and logged — better a slightly larger file than
  a silently discarded new message type.
- **Redact at intake**, before anything is written: `authToken`, `token`, `jwt`,
  `_pk`, matching `tools/har_to_jsonl.py`. Handshake frames are dropped entirely,
  so this is belt and braces — which is the correct posture for credentials.
- **Persist per frame.** IndexedDB, `commits` keyed `[roomCode, sequence]`, plus
  a `sessions` record holding the origin snapshot and session document. Never
  hold a match only in worker memory.
- **Finalise** on socket close or terminal log entry: assemble `match`,
  `players`, `viewer`, `outcome`, `gaps`, `chat` per
  [`docs/replay-format.md`](../docs/replay-format.md).
- **Popup**: recording indicator, replay library, export, delete.

## Points of care

- **Service-worker death is the default, not the exception.** MV3 terminates
  idle workers after ~30s; a match has long quiet stretches. Every design choice
  here follows from that: flush per frame, keep finalisation a pure function of
  persisted data, and make a re-awakened worker able to resume a session it does
  not remember starting.
- **Sequence-0 is precious.** If the recorder starts mid-match it has no origin
  snapshot and cannot anchor. Record the earliest snapshot seen and mark the
  replay `partial: true` rather than emitting something that looks complete.
- **Fog detection is mechanical.** Scan zones for `__hidden_zone__` to populate
  `viewer.maskedZonesByPlayer`. Do not infer it from `viewer.role`.
- **`decklistRaw` for the opponent stays `null`.** Resist reconstructing it from
  observed cards — see the field rules in the format spec.

## Verify

- Play a match; export; run `tools/verify.py` on the frames and confirm the
  exported replay reduces to the same final board as the last server snapshot.
- Force-terminate the service worker mid-match from `chrome://serviceworker-internals`
  and confirm the recording continues and finalises correctly.
- Grep an exported replay for `eyJ` (JWT prefix) and for `_pk`. Both must miss.
  Make this an automated test, not a manual check.

## Done when

A match played end to end produces a valid replay, the worker can be killed
mid-match without loss, and the credential test passes.
