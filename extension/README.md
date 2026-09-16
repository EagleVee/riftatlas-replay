# Extension

The **recorder and the player both work**, verified against a live RiftAtlas
room on 2026-09-16: the extension recorded a real Solo Lab match, finalised it,
and the resulting replay loaded and navigated.

```
manifest.json        MV3
main-world/
  socket-observer.js wraps window.WebSocket in the page's world; read-only
content/
  bridge.js          forwards observed frames to the service worker
background/
  service-worker.js  message routing; holds no match state
  recorder.js        filter, redact, persist - serialised per frame
  finalise.js        assembles .ratlas.json (mirrors tools/har_to_replay.py)
  store.js           IndexedDB
popup/               recording list, build, export, delete
shared/
  reducer.js         port of tools/reducer.py - proven equal on real captures
  timeline-index.js  sequence / event / chapter index + navigation cursor
player/
  player.html        standalone viewer, CSP forbids all outbound connections
  player.css
  player.js
```

## Installing for development

Chrome no longer honours `--load-extension`. Load it over the DevTools protocol
instead, against a Chrome started with `--enable-unsafe-extension-debugging`:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-riftatlas" \
  --enable-unsafe-extension-debugging \
  https://play.riftatlas.com/ &
```

Then call `Extensions.loadUnpacked` on the **browser** target (it is not
available on a page target):

```bash
node tools/load-extension.mjs ./extension
```

Re-running it reloads the extension in place.

## Two bugs the live test caught

Worth recording, because neither would have shown up without running it against
a real room:

- **A missing IndexedDB record resolved to the request object.** The store
  unwrapped results with `request?.result ?? request`, so a key that was absent
  - `undefined` - fell through to the `IDBRequest` itself. The recorder then
  treated that as an existing session and tried to store it, failing with
  `DataCloneError` on every single frame. Nothing was ever recorded.
- **Concurrent frames clobbered the session record.** Frames arrive faster than
  a read-modify-write completes, and several types mutate the session, so the
  `room_shell_sync` write - which carries the decklist and match format - was
  overwritten by a snapshot write that had read the session first. Frame
  handling is now serialised through a promise queue.

## Two ways to watch

- **The standalone player** — offline, independent, works if RiftAtlas is down or
  gone. Text tiles, not card art.
- **[Replay mode](../extension/replay-mode/README.md)** — renders the replay in
  RiftAtlas' own board with real art, their match log and their layout. Needs
  their site, online and signed in, and breaks when they change the client.

Replay mode is started from the popup: build a replay, then **In RiftAtlas UI**.

## Opening a replay

Click the toolbar icon, then **Open player** — or go straight to
`chrome-extension://<id>/player/player.html`.

The player takes either:

- a **`.ratlas.json`** replay, exported from the popup or built by
  `tools/har_to_replay.py`; or
- a raw DevTools **`.har`** capture, converted in the browser on open
  (about six seconds for a twenty-minute match).

Use **Open replay or HAR**, or just drop the file anywhere on the page. No
server, no network, no RiftAtlas account.

## Capturing a HAR by hand

DevTools → Network → filter **WS** → play a match → right-click the request →
*Save all as HAR with content*. Then drop it on the player.

Note that a HAR carries a live auth token and your name. The player redacts on
import and the exporter never writes credentials, but the raw `.har` itself is
sensitive — keep it out of the repo (`.gitignore` covers `*.har`) and off
anywhere shared.

## Running the player from source

It is a static page and needs a server only because ES modules do not load from
`file://`:

```bash
cd extension && python3 -m http.server 8731
# then open, with a replay built by tools/har_to_replay.py:
#   http://127.0.0.1:8731/player/player.html?src=<replay>.ratlas.json
```

Or open `player.html` and use **Open replay** to pick a file. A position is
linkable: `#seq=139` opens at turn 9, and changing the hash navigates a page
that is already open.

## Navigation

Three tiers, per [`../docs/replay-navigation.md`](../docs/replay-navigation.md).

| Key | Action |
|---|---|
| `←` `→` | Previous / next sequence — the atom; never skips a board change |
| `↑` `↓` | Previous / next narrated move |
| `[` `]` | Previous / next chapter (phase or turn) |
| `Home` `End` | First / last |
| `Space` | Play / pause — a beat per move, with repeated actions flicking past |
| `1`–`9` | Jump to turn N |

Clicking the chapter rail, a move in the list, a band on the scrubber, or
anywhere on the track all jump too.

## The one design rule

**Backward navigation is a lookup, not an undo.** `Timeline` materialises every
sequence from the origin snapshot, and rendering reads `timeline.states`. Nothing
mutates a displayed board.

This is what keeps fog correct: a card revealed at turn 9 is a face-down stub
again at turn 8 because that state was computed from the snapshot and never
touched afterwards. An undo-based player has to remember to re-hide it; this one
cannot get it wrong. `tests/index-shape.mjs` asserts the round trip.

## Reading the board

- Runs of face-down cards collapse into one `N face down` tile. A 21-card hidden
  deck is one fact, not twenty-one, and drawing it as twenty-one tiles pushes the
  rest of the board off screen.
- Masked cards are detected with `isPlaceholder === true`. They are stub objects,
  not strings, and carry no `cardCode`, `type` or `ownerPlayerId`.
- The recording seat is at the bottom, as in the live client, and labelled.
- The gap at a forced resync is an orange marker on the track, never smoothed
  over.

## Still to build

- **Recorder** (phase 3) — main-world `WebSocket` observer, IndexedDB buffering,
  finalisation. `tools/har_to_replay.py` is the reference for what it must emit.
- **Card catalog** — bundling it gives real card text offline.
- **Think-time heat band** on the scrubber.
