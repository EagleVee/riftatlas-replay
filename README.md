# RiftAtlas Replay

A Chrome extension that **records every RiftAtlas match you play, automatically**,
and lets you watch it back turn by turn — forwards and backwards, in RiftAtlas'
own board with real card art.

Install it, play as normal, then click the extension icon and press **Watch
replay**. No files to save, no DevTools, nothing to start or stop.

**[Add to Chrome — Chrome Web Store](https://chromewebstore.google.com/detail/riftatlas-replay/cbngbmmoeoonnklncjdlccggpkmicdho)**

Works in Chrome and other Chromium browsers (Edge, Brave, Arc).

Enjoying it? Support the project, if you like:

<a href="https://www.buymeacoffee.com/eaglevee"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=eaglevee&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="40"></a>

## What it does

- **Records automatically.** Play on `play.riftatlas.com` as normal. Every match
  is recorded in the background; there's nothing to start or stop.
- **Replays in RiftAtlas' own board.** Real card art, the game's own match log,
  the layout you already know — with play, pause, step and a scrubber on top.
- **Steps backwards as well as forwards.** Jump to any move, turn or phase. The
  board at each point is exactly what it was, hidden cards included.
- **Works offline too.** A standalone player opens any replay with RiftAtlas
  closed, or even if it goes down.
- **Shows results at a glance.** Each match lists both players, their legends,
  the score and the winner — and best-of-three series are recorded game by game.
- **Search your history.** Find matches by opponent, legend, format, room code or
  date (`zed bertoc`, `bo3`, `sep`).
- **Remember what you were shown.** Switch on the in-game overlay in the popup,
  and a small eye button in the corner of the board lists every time your
  opponent revealed their hand or the top of their deck and then hid it again —
  every card shown, with its picture, cost and colour. It folds down to one icon you can
  drag out of the way. Replays have the same eye button on their control bar,
  listing what had been shown up to that point, with a jump to each moment.
- **Share a match.** Export a `.ratlas.json` file and send it to a friend or coach;
  they open it in the player.

## Getting started

1. Install it from the
   [Chrome Web Store](https://chromewebstore.google.com/detail/riftatlas-replay/cbngbmmoeoonnklncjdlccggpkmicdho)
   and pin the icon to your toolbar.
2. Play a match on [play.riftatlas.com](https://play.riftatlas.com/).
3. With RiftAtlas still open, click the RiftAtlas Replay icon. Your match is
   already there — press **Watch replay**.

That's all. You never need to export, save or open a file to watch your own
matches.

### Controls

| Key | Does |
|---|---|
| `Space` | Play / pause — about a second per move, skipping quickly through repeated actions |
| `←` `→` | Step one change back or forward |
| `Home` `End` | Jump to the start or the end |

Drag the slider to scrub. The control bar can be dragged anywhere on the board,
and stays where you leave it.

The standalone player (the **Player** button in the popup) adds `↑` `↓` to jump between
moves, `[` `]` between phases and turns, and `1`–`9` to jump to a turn. Drop a
`.ratlas.json` onto it to open a replay someone sent you.

## FAQ

**How do I watch a replay of a RiftAtlas match?**
Install RiftAtlas Replay from the
[Chrome Web Store](https://chromewebstore.google.com/detail/riftatlas-replay/cbngbmmoeoonnklncjdlccggpkmicdho).
It records your matches automatically while you play. Afterwards, with
play.riftatlas.com open, click the extension icon and press **Watch replay** on
the match.

**Do I need a `.ratlas.json` or `.har` file?**
No. Your own matches are recorded and listed in the extension for you. A
`.ratlas.json` file is only for sharing: export a match to send it to someone,
and they open it in the player.

**Can I replay a match I played before installing it?**
No. RiftAtlas keeps match results but not the moves, so a match has to be
recorded while it's played. Every match after you install is recorded.

**Can I watch someone else's match?**
Yes, if they export it and send you the `.ratlas.json` file. Open the **Player**
from the extension icon and drop the file onto it.

**Does it record best-of-three?**
Yes, game by game, each with its own result.

## Your data stays yours

- **Nothing is uploaded.** Recordings are kept in your browser. There is no server.
- **Observe only.** The extension watches the game connection and writes down
  what the server says. It never sends, changes or delays a game action — it has
  no way to.
- **No credentials.** Login tokens are discarded before anything is stored, so an
  exported replay is safe to share.
- **No peeking.** A replay shows what you could see during the match. Your
  opponent's hidden cards stay hidden.
- **One site only.** It runs on `play.riftatlas.com` and nowhere else.

Read the full [privacy policy](docs/privacy-policy.md).

> Recordings live in the extension's storage, so **uninstalling deletes them**.
> Export any match you want to keep first.

## Good to know

- A replay is recorded from your seat, so it shows the match from your side of
  the table.
- If the connection drops mid-match, the replay marks the gap rather than
  guessing what happened in it.
- Duel is well tested. Free-for-all, 2v2 and sealed haven't been recorded yet —
  if one misbehaves, please report it.
- Watching in RiftAtlas' board depends on their site, so a RiftAtlas update can
  break it until the extension catches up. The standalone player keeps working
  regardless.

See [`CHANGELOG.md`](CHANGELOG.md) for what changed in each version.

## Something went wrong?

Open the popup and press **Debug dump**. It saves
`riftatlas-replay-debug.json` to your Downloads — no credentials in it. Attach
that to an [issue](https://github.com/EagleVee/riftatlas-replay/issues) along
with the room code, what you expected, and what happened.

## Build it yourself or contribute

The extension is plain JavaScript with no build step, so the code in this
repository is exactly the code that runs. See
**[`CONTRIBUTING.md`](CONTRIBUTING.md)** for how it works, how to load it from
source, and how to run the tests.

---

Built with the permission of the RiftAtlas owner.
