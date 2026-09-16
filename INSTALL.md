# Installing RiftAtlas Replay

For testers. Chrome or any Chromium browser (Edge, Brave, Arc).

Want to read or build the source instead? See `BUILD.md` in the repository —
there is no build step, so the code you can read is exactly the code that runs.

## Install

1. Unzip `riftatlas-replay-0.1.0.zip` somewhere you can leave it — Chrome loads
   the extension from this folder every time it starts, so don't delete it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked** and pick the unzipped folder (the one with
   `manifest.json` in it).

The RiftAtlas Replay icon appears in your toolbar. Pin it — you'll use it.

> Chrome shows *"Disable developer mode extensions"* warnings on startup for
> anything installed this way. That's expected for an unpublished extension and
> is safe to dismiss.

## Recording a match

Nothing to do. Play on `play.riftatlas.com` as normal and it records in the
background. Open the popup afterwards and your match is listed.

For each recording:

- **Build** turns the recording into a replay file.
- **Export** saves it as `.ratlas.json`, which you can send to someone.
- **In RiftAtlas UI** replays it in RiftAtlas' own board (see below).
- **Delete** removes it.

## Watching a replay

**In RiftAtlas' board** — open `play.riftatlas.com`, then popup → **In RiftAtlas
UI**. The tab reloads and the match plays in the real client with card art and
the game's own log. A control bar sits at the bottom.

**In the standalone player** — popup → **Open player**. Plainer, but works
offline with RiftAtlas closed, and opens a `.ratlas.json` someone sent you, or a
DevTools `.har` capture dropped straight onto the page.

### Controls

| Key | Does |
|---|---|
| space | play / pause, and replay again once it ends |
| left, right | step |
| Home, End | jump to start or end |

Playback runs about a second a move, but skips quickly through repeated actions
— four rune exhausts in a row don't cost four seconds. Drag the slider to scrub.

## What it does with your data

- Recordings stay in the browser. Nothing is uploaded anywhere, by anyone.
- Auth tokens are dropped before anything is written, so an exported replay
  carries no credentials. The test suite fails the build if one ever appears.
- A replay contains what you could see during the match: both players' names,
  the board, and your own decklist. Your opponent's hidden cards were masked by
  the server and stay masked.
- Exporting is the only way anything leaves your machine, and only you can do it.

## What it does not do

It never sends, changes, or delays a game action. It watches the connection and
writes down what the server says. There is no code path from it to RiftAtlas'
servers — the recorder has no way to send at all.

## Known rough edges

It's version 0.1.0 and unpublished. Expect:

- **Replay mode breaks if RiftAtlas ships a UI change.** The standalone player
  keeps working regardless.
- **Only tested on duel matches that ended in a concession.** Bo3, and matches
  ending in a normal win, are unverified — if one of those misbehaves, that's
  useful to hear about.
- **Multiplayer and sealed formats are untested.**

## Telling us something went wrong

Hit **Debug dump** in the popup. It writes `riftatlas-replay-debug.json` to your
Downloads with everything the recorder holds — raw commits included, so a
recording that will not even build can still be diagnosed. Send that.

It carries decklists and player names, and no credentials: the frames that carry
tokens are discarded before anything is stored.

Also useful: the room code, what you expected, and what happened instead.

Please don't send raw `.har` files — those *do* contain a live auth token. An
exported `.ratlas.json` or a debug dump is safe to share.
