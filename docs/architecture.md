# Architecture — Chrome extension

## Why an extension

The replay data exists only inside a live match socket in the player's own
browser. There is no public match-history API in scope here, and we are not
going to invent server-side access. An extension is the one place that can
observe the socket as it happens, with the player's consent, without touching
RiftAtlas' infrastructure.

Two jobs, deliberately separable:

- **Recorder** — observe the match socket, write a `.ratlas.json`.
- **Player** — load a `.ratlas.json`, reduce it, render it.

They share only the replay format and the reducer. The player must work on a
replay file alone, offline, with RiftAtlas never open. Keeping that boundary
honest is what stops the player from quietly depending on live page state and
becoming unable to open a file a friend sent.

## Capturing the socket

Manifest V3 content scripts run in an isolated world and cannot see the page's
`WebSocket` instances. Two options:

**Chosen: `world: "MAIN"` content script.** Register a script at
`document_start` in the main world that wraps `window.WebSocket`. The wrapper
passes through untouched and only observes — it never blocks, delays, modifies,
or injects frames. Frames for URLs matching `/parties/match/` are forwarded to
the isolated-world content script via `window.postMessage`, and on to the service
worker.

**Rejected: `chrome.debugger` + `Network.webSocketFrameReceived`.** This is how
DevTools produced our HAR, and it needs no page injection. But attaching the
debugger shows a persistent "…is debugging this browser" banner, disables
DevTools for the user, and detaches unpredictably. It is the right fallback if
the main-world wrapper ever breaks, and worth keeping documented, but it is a
poor default.

Injecting at `document_start` matters: the socket opens within a second of the
match page loading, and a wrapper installed after `new WebSocket()` sees nothing.

### Non-negotiable: observe, never inject

The wrapper is read-only, and the recorder never calls `send()`. This is not
timidity — it is the line between a replay tool and a cheat, and it is the reason
this project is defensible. It should be enforced structurally (the main-world
shim exposes no send path at all) rather than by convention, and stated plainly
in the extension's store listing.

## Components

```
riftatlas-replay/
├── extension/
│   ├── manifest.json              MV3
│   ├── main-world/
│   │   └── socket-observer.js     wraps window.WebSocket, read-only
│   ├── content/
│   │   └── bridge.js              postMessage → chrome.runtime
│   ├── background/
│   │   ├── service-worker.js      session lifecycle
│   │   └── recorder.js            filter, redact, buffer, finalise
│   ├── shared/
│   │   ├── reducer.js             port of tools/reducer.py — normative
│   │   ├── timeline.js            sequence → state, gap tracking
│   │   └── format.js              read/write .ratlas.json, version gate
│   ├── player/
│   │   ├── player.html            standalone replay viewer
│   │   ├── board.js               board rendering
│   │   └── scrubber.js            timeline, chapters, keyboard
│   └── popup/
│       └── popup.html             recording state, library, export
└── tools/                          Python reference implementation + verifier
```

## Recording lifecycle

1. Content scripts load on `play.riftatlas.com` at `document_start`.
2. The observer sees a socket open on `/parties/match/<roomCode>`; the recorder
   opens a session keyed by room code.
3. Each frame is parsed, **redacted** (`authToken`, `_pk`, `jwt`), and either
   buffered or dropped. Only state-bearing types are buffered; presence and auth
   frames are discarded at this stage so credentials never reach storage.
4. Buffered frames accumulate in the service worker and flush to
   IndexedDB — not `chrome.storage`, whose quota a 550 KiB replay would strain
   and whose API is a poor fit for append-heavy writes.
5. On socket close, or on a terminal gameplay-log entry (concession, match end),
   the recorder finalises: derive `match`, `players`, `viewer`, `outcome`, emit
   the document.

**Service-worker termination is the main hazard.** MV3 kills idle workers after
30 seconds, and a match runs 20 minutes with gaps between actions. Buffering only
in worker memory loses matches. Mitigation: flush to IndexedDB on every commit,
keep the worker alive only while a socket is open, and make finalisation
recoverable from persisted frames so a killed worker costs nothing.

## Storage budget

At ~550 KiB per 20-minute match, IndexedDB comfortably holds hundreds of
replays. Store commits as a `commits` object store keyed by
`[roomCode, sequence]` rather than one blob per match, so a partial recording is
still valid and finalisation is a read-and-assemble rather than a rewrite.

## The player

The player renders board state at a sequence. Given `Timeline`, that is a lookup,
and scrubbing is instant for a materialised timeline. A 371-sequence match
materialises in well under a second, so the simple approach — reduce every
sequence on load, keep them all — is correct until a capture proves otherwise.

The scrubber's chapter track comes from the gameplay log, which already carries
`turnNumber`, `actionKind` and rendered text. "Jump to turn 9" is a filter, not
an inference.

Rendering is the genuinely open piece, because **card art is unresolved** — the
socket carries `cardCode` but no image URLs, and the HAR filtered out HTTP
traffic. Until that is answered, the player renders cards as typed text tiles
(name, code, keywords, counters, exhausted state). This is not a placeholder to
apologise for: a text board is fully legible for play review, it works offline,
it ships without hotlinking someone else's CDN, and it means art resolution can
be added later as an enhancement rather than blocking v1 on a question we have
not yet investigated.

## Fog of war in the UI

The player shows masked zones as face-down cards with accurate counts, and
displays a persistent "recorded from BertoC's seat — opponent's hand was hidden"
banner. Cards revealed mid-game by `zone_move` become visible at the sequence
where the reveal happened, never earlier. Scrubbing backwards must re-hide them;
this is the most likely correctness bug in the player and deserves a test built
from the reference capture.

## Permissions

Requested:

- `host_permissions` for `https://play.riftatlas.com/*` and
  `wss://realtime.riftatlas-workers.com/*` — the socket and its page.
- `storage` / IndexedDB — replay library.
- `downloads` — export a `.ratlas.json`.

Not requested, and worth saying so in the listing: no broad host access, no
network requests to any third party, no telemetry. A replay leaves the browser
only when the user exports it.
