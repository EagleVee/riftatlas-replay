# Phase 1 — Capture spike

**Purpose:** prove an MV3 extension can observe the match socket completely,
before any of the design depends on it.

The protocol analysis came from a DevTools HAR. That proves the *protocol* is
replayable; it does not prove our *capture path* sees the same bytes. Those are
different claims and this phase tests the second one.

## Build

A throwaway extension, no storage, no UI beyond a console:

- `manifest.json`, MV3, content script at `document_start` on
  `https://play.riftatlas.com/*` with `"world": "MAIN"`.
- `socket-observer.js` — wrap `window.WebSocket` so that construction and
  `message` events are observed. Read-only: no `send` wrapper, no frame
  modification, no way to originate a frame.
- Forward frames whose socket URL contains `/parties/match/` to the isolated
  world via `window.postMessage`, then to the service worker, then to a file.

## Verify

A **Solo Lab room is the cheap first test** — it speaks the identical protocol
(verified 2026-09-16: `authoritative_snapshot` and `room_shell_sync` from
sequence 0, same shape as a PvP capture), needs no opponent, and can be opened
and abandoned freely. Get the observer working there before spending a real
match on it.

Then play one PvP match with DevTools recording a HAR **at the same time**:

```bash
python3 tools/har_to_jsonl.py devtools.har devtools.jsonl
python3 tools/verify.py devtools.jsonl
python3 tools/verify.py extension.jsonl
```

Both must pass, and the two frame streams must contain the same
`authoritative_*` frames in the same order. Compare on `(type, sequence)` pairs
rather than raw bytes — timestamps and frame ordering between ephemeral types
will legitimately differ.

## Risks this phase retires

- **`document_start` is too late.** If the page opens the socket before our
  wrapper installs, we lose the handshake and the sequence-0 snapshot, and the
  whole approach needs `chrome.debugger` instead. This is the reason the phase
  exists.
- **The page uses something other than `window.WebSocket`** — a worker-scoped
  socket, or a bundled polyfill captured before our wrapper runs.
- **CSP blocks main-world injection.** Registered main-world content scripts are
  exempt from page CSP, but this is worth confirming rather than assuming.

## Done when

Our capture of a real match verifies clean, and is frame-equivalent to a
simultaneous DevTools HAR of the same match. If it is not, stop and re-plan —
this is the fork where the architecture changes.
