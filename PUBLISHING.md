# Publishing to the Chrome Web Store

## Before anything else

Talk to the RiftAtlas owner again. Permission to build a recorder for yourself
is not permission to hand one to strangers, and a store listing is public even
when the extension is not. Worth confirming specifically:

- that a public listing naming RiftAtlas is fine with them;
- the `world: "MAIN"` WebSocket wrapper and the read-only guarantee;
- replay mode, which answers the client's own connection locally;
- anything involving card art, if that ever ships.

RiftAtlas itself operates under Riot's "Legal Jibber Jabber" policy. This
extension bundles none of Riot's or RiftAtlas' assets — the icons are its own —
but the listing does use the RiftAtlas name, which is theirs.

## What it costs

A one-off **$5** developer registration. No recurring fee. Review usually takes
a few days; an extension asking for `scripting` and `tabs` may take longer,
because those get looked at properly.

## Visibility: the three options

| | Who can install | Findable |
|---|---|---|
| **Public** | anyone | listed and searchable |
| **Unlisted** | anyone with the link | no |
| **Private** | only accounts you name, or your Google Workspace domain | no |

**Unlisted** is the usual answer for a tester build: nobody stumbles on it, and
sharing is a link. The listing page itself is still reachable by anyone holding
the URL.

**Private** is stricter. Two flavours:

- **Trusted testers** — you list Google account email addresses, and only those
  accounts can install. Good for a handful of people.
- **Domain-restricted** — if you publish from a Google Workspace account, you can
  limit it to that organisation. Not applicable to a personal account.

Private is the closest thing to "nobody else can get this", and it is what you
want while the recorder is still finding bugs in the wild.

## Building the upload

```bash
tools/package.sh --store          # writes dist/riftatlas-replay-<version>-store.zip
```

A store build differs from a tester build in one important way: **the `key` is
stripped**. The store owns the extension's identity, and a package carrying its
own key is rejected.

### That changes the extension's id, and its recordings

The unpacked build has a pinned id (`behkdmm…`). The store will assign a
different one, and **recordings do not follow**, because they live in storage
belonging to the old id.

So, before switching anyone over:

1. **Export anything worth keeping** from the unpacked install.
2. Install the store version.
3. Remove the unpacked one only once the store version works.

You can make the two agree afterwards. Once the store has accepted an upload,
its item page shows the public key it assigned; paste that into
`extension/manifest.json` as `key`, and local unpacked builds will share the
store build's id from then on. Do this after the first upload, not before.

## The listing needs

- **Icons** — already in the package (16/32/48/128).
- **A description** — the manifest's is used as the short one, and must be 132
  characters or fewer. `package.sh --store` checks this.
- **Screenshots** — at least one, 1280×800 or 640×400. The replay running in
  RiftAtlas' board is the obvious shot.
- **A privacy policy URL.** Required whenever an extension handles user data, and
  recordings contain player names, so assume it is required. It can be short and
  should be true: recordings stay in the browser, nothing is uploaded, tokens are
  stripped before anything is written, and exporting is the only way data leaves
  the machine.
- **Permission justifications.** Each gets a box, and vague answers cause
  round trips:

| Permission | Why |
|---|---|
| `storage` | keeps recordings and the user's settings in the browser |
| `downloads` | exports a replay, or a debug dump, to the user's own disk |
| `scripting` | injects replay mode into the RiftAtlas tab when the user asks for it |
| `tabs` | finds the RiftAtlas tab to inject into |
| `host_permissions` | one origin, `play.riftatlas.com`, the only site it works on |

Say plainly that the extension observes the game connection and never sends,
modifies, or delays anything on it. Reviewers care about that, and here it is
true by construction rather than by policy.

## Updating after publication

Bump `version` in `extension/manifest.json`, run `tools/package.sh --store`, and
upload. Each update is reviewed again. Users get it automatically within a day
or so, which also means a replay broken by protocol drift repairs itself without
anyone doing anything — see the retry-on-update behaviour in the service worker.

## What I would not publish yet

Only duel matches have ever been recorded. Bo3, sealed, and multiplayer variants
are untested, and the last few days have turned up real bugs in the recording
path — lost frames, merged matches, silently truncated replays. All fixed, all
tested, but found by using it rather than by reasoning about it.

An **unlisted or private** listing shared with a few players is the right next
step. Public is worth waiting for a week of quiet.
