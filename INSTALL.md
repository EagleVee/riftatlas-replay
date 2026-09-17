# Installing RiftAtlas Replay

For testers. Chrome or any Chromium browser (Edge, Brave, Arc).

Want to read or build the source instead? See `BUILD.md` in the repository —
there is no build step, so the code you can read is exactly the code that runs.

## Install

1. Unzip it somewhere you can leave it — Chrome loads the extension from this
   folder every time it starts, so don't delete or move it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked** and pick the unzipped folder (the one with
   `manifest.json` in it).

The version currently loaded is shown beside the title. If a fix does not seem
to have taken effect, check that first — an extension keeps running its old code
until it is reloaded.

> Reloading or updating the extension while a match is running **stops that
> recording**: the page's connection to the extension is torn down and only a
> page reload restores it. Update between matches, not during one.

## Updating

**Unzip the new version over the old folder**, then press the reload arrow on
the extension's card in `chrome://extensions`. Your recordings are kept.

You can also unzip elsewhere and *Load unpacked* again — the extension has a
pinned identity, so Chrome treats it as the same extension either way and your
recordings follow it. Either way, remove the older entry only *after* the new
one is working.

> Recordings live in the extension's own storage. **Removing the extension
> deletes them.** If you have a recording you care about, hit **Export** first.

The RiftAtlas Replay icon appears in your toolbar. Pin it — you'll use it.

> Chrome shows *"Disable developer mode extensions"* warnings on startup for
> anything installed this way. That's expected for an unpublished extension and
> is safe to dismiss.

## Recording a match

Nothing to do. Play on `play.riftatlas.com` as normal and it records in the
background. Open the popup afterwards and your match is listed.

Each recording shows the scoreline — you on the left, your opponent on the
right, each with their legend beneath — and one button, **Watch replay**, which
plays it back in RiftAtlas' own board with card art and their match log.

A green edge means you won, a red one that you lost, and a ✓ marks the winner.
The score itself is left plain, because the winner is not always the higher
number.

RiftAtlas records leaving a room as a concession, and winners usually leave as
soon as they have won — so its log credits the win to whoever stayed. When a
finished match has exactly one player on the winning score (8, or 11 in 2v2),
that player is shown as the winner instead, with the reason `score`.

Reaching the winning score never *ends* a recording. Scores are manual and can
be set wrongly, so a match only closes when the room empties, a new one starts,
the log announces a result, or the connection drops — and the score is only read
once that has happened.

Under the player names are three small ones:

| | |
|---|---|
| ⤓ | **Export** — save as `.ratlas.json` to send to someone. Rebuilds first, so an export is always current. |
| ⟳ | **Rebuild** — re-assemble from the recording. Not normally needed; recording is continuous and Export rebuilds anyway. Use it if a replay looks short. |
| ✕ | **Delete** — asks first, and cannot be undone. |

**Copy** beside the room code copies it.

Once you have a few matches, a search box appears. It matches room codes,
either player, either legend, the format, and the date — so `zed`, `bertoc`,
`bo3` and `sep` all work, and several terms narrow rather than widen
(`zed bertoc` finds Zed games against BertoC). Escape clears it.

## If RiftAtlas says it can't reconnect to your game

Press **Back to lobby** in the popup. Replay mode borrows the client's "which
room am I in" state, and a version before 0.2.0 could leave it behind — so the
client kept trying to rejoin a room that only ever existed as a replay.

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

## If a replay says it could not build, or stops early

RiftAtlas adds things to its game protocol from time to time, and a version of
this extension that predates one will not know what to do with it. When that
happens the replay stops at that point and says so.

**The recording is not damaged** — only the replay built from it. Nothing needs
doing: when the extension next updates, every replay that failed or stopped
early is rebuilt automatically, and the match comes back in full.

Pressing Rebuild yourself will not help, because it runs the same version that
could not build it the first time. What does help is a **Debug dump** — that is
how the missing piece gets added.

## If a replay is much shorter than the match

A break in the recording makes everything after it unreplayable, so a replay can
hold hundreds of actions and only play the first few. The player says so at the
top — *"Incomplete — plays 8 of 396 recorded actions"* — rather than passing it
off as a short game.

0.3.0 recovers most of these: it resumes from the next usable snapshot instead
of giving up at the break. Press **Build** on an older recording to try. It also
stops the loss happening in the first place, by queueing frames until the
extension's background worker is awake to receive them.

## Telling us something went wrong

Hit **Debug dump** in the popup. It writes `riftatlas-replay-debug.json` to your
Downloads with everything the recorder holds — raw commits included, so a
recording that will not even build can still be diagnosed. Send that.

It carries decklists and player names, and no credentials: the frames that carry
tokens are discarded before anything is stored.

Also useful: the room code, what you expected, and what happened instead.

Please don't send raw `.har` files — those *do* contain a live auth token. An
exported `.ratlas.json` or a debug dump is safe to share.
