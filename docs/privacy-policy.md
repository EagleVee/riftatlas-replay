# Privacy Policy — RiftAtlas Replay
*Last updated 17 September 2026*

RiftAtlas Replay records your matches on `play.riftatlas.com` so you
can watch them back. Everything it records stays in your own browser. The
extension sends nothing anywhere, and there is no server behind it.

## What it collects

While you are in a match on `play.riftatlas.com`, the extension
reads the game data the site's own server sends to your browser, and writes it
to local storage inside the extension. A recording contains:

- the room code, the format, and when the match was played;
- the display names of both players, and the legends they used;
- the state of the board and the game's own match log, action by action;
- your own decklist, and any cards your opponent revealed during play — cards
the game kept hidden from you stay hidden in the recording;
- match chat, where the game recorded any.

**Login tokens are discarded before anything is written.** The
connection carries an authentication token; the extension strips it, along with
related keys, so a recording never contains a credential. The frames that carry
them are dropped entirely rather than merely scrubbed.

## What it does not collect

- No browsing history. It only runs on `play.riftatlas.com` and
sees nothing on any other site.
- No account details, email address, or password.
- No analytics, telemetry, usage statistics, or crash reporting.
- No advertising or tracking identifiers of any kind.

## Where it goes

Nowhere. The extension contains no code that makes a network request — no
fetch, no upload, no beacon, no third-party service. Recordings live in your
browser's local storage for this extension and are readable only by it.

The only way data leaves your machine is when you choose to move it:

- **Export** saves a match as a file on your disk. What you then
do with that file is up to you.
- **Debug dump** saves a diagnostic file, for when you want to
report a problem. It contains the same match data described above and no
credentials.

Both are downloads to your own computer. Neither transmits anything.

## It observes only

The extension watches your connection to the game and writes down what the
server says. It never sends, modifies, or delays a game action. There is no
code path from it to RiftAtlas' servers at all — the part that records has no
ability to send, by construction rather than by policy.

## Deleting your data

- **Delete** on any recording removes it and everything
belonging to it, immediately and permanently.
- **Removing the extension** deletes every recording with it.
Export anything you want to keep first.

There is nothing held anywhere else, so there is nothing else to delete.

## Permissions, and why each one exists

| Permission | Used for |
|---|---|
| `storage`
| keeping your recordings and settings in your own browser
| `downloads`
| saving an export or a diagnostic dump to your disk, when you ask
| `scripting`
| putting a replay into the RiftAtlas tab when you press Watch replay
| finding the RiftAtlas tab to put the replay into
| `play.riftatlas.com`
| the only website the extension runs on

## Children

The extension is not directed at children and collects nothing beyond the game
data described above.

## Changes

If this policy changes, the date at the top changes with it. A change that
affected what is collected or where it goes would also come with an update to
the extension, and would be described in that update.

## Contact

Questions about this policy or about the extension:
eaglev1999@gmail.com.

---

RiftAtlas Replay is an independent project. It is not affiliated with, endorsed by, or connected to RiftAtlas or Riot Games.
