# Replay mode

Renders a recorded match in **RiftAtlas' own board**, by answering the client's
match socket locally with recorded frames instead of connecting to a server.

Verified working against the live client on 2026-09-16: the reference match
renders with real card art, their match log, score tracks, battlefields and
turn indicator, and steps forward and backward.

## Why it works

RiftAtlas' client renders a game purely from frames it receives — that is what
spectating is. Feed it the frames, and it draws the board. No rules engine, no
scraping, no reimplementation.

## Why this is not a cheat, structurally

`inject.js` is the only file in the extension that originates frames, and it is
fenced off:

1. **Never in `content_scripts`.** It cannot run unless the user asks for it.
2. **Armed with exactly one room code** — the replay's — and intercepts only
   `/parties/match/<that room>`. Every other socket, live matches included, goes
   to the real `WebSocket` untouched.
3. **No transport exists.** A `FakeSocket` has no connection; `send()` is a
   sink. Nothing here can reach RiftAtlas' servers.
4. **Refuses to arm while a live match socket is open** in the page.

The recorder never sends; replay mode never connects. Separate files, no shared
code path, so neither can drift into the other.

## Three things the live client required

None of these were guessable from the capture — each came from watching the real
client refuse to proceed.

**It must be armed before the page loads.** The app opens its match socket about
two seconds in. Injecting after that, the real socket wins and replay mode
correctly refuses to displace it. Arming has to happen at `document_start`.

**The viewer has to be a spectator.** The replay's `shell` says the viewer is
whoever recorded it; the person watching is signed in as someone else. The
client waits at *"Still opening your game…"* forever when it cannot find itself.
Rewriting `viewer` to `{ role: 'spectator' }` and dropping `selfPlayer` makes it
render immediately — spectating is a role the client already knows, and it does
not require the viewer to be seated.

**Sequence numbers must only ever climb.** The client discards a snapshot that
is not newer than what it holds, so seeking backwards was silently ignored — the
control bar moved and the board did not. Replay mode now sends a monotonic wire
sequence and carries the state of whatever replay sequence the cursor is on. The
replay's real sequence stays in the control bar, where a viewer reads it.

## Known limits

- **Their UI, their rules.** It breaks whenever RiftAtlas changes the client, and
  `setupOrderVersion: 2` says that happens. The standalone player is the one that
  keeps working offline and after the site is gone.
- **Requires being signed in and online**, on their site.
- **The reducer is mirrored inline.** Replay mode runs in the page world where
  module imports are unavailable, so `inject.js` carries its own copy of the
  patch semantics. `tools/reducer.py` stays normative; the two must be kept in
  step, and there is no test binding them together yet.
- **Seeking is a full snapshot push**, so it is a hard cut rather than an
  animated step. Playing forward one commit at a time would animate, but has not
  been built.
