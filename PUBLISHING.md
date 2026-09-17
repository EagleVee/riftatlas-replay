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

## Trader or non-trader

Registration asks you to declare one, to satisfy EU marketplace rules. It turns
on commercial purpose, not on whether money changes hands:

- **Trader** — "acting for purposes relating to his trade, business, craft or
  profession".
- **Non-trader** — "acting for purposes which are outside of his trade,
  business, craft or profession".

A free extension for a game you play, with no payments, ads, or connection to
your work, is a non-trader case.

The cost of getting it wrong in the other direction is concrete: **traders must
supply a legal name, phone number and address, and that is published at the
bottom of the listing.** For an individual that means a home address on a public
page.

Two things would make it a trader declaration: publishing under a company
account or as part of your job — so use a personal Google account, not a work
one — or monetising it later, which would mean updating the declaration.

Google states plainly that this is a legal question, that each publisher makes
their own determination, and that they will not answer specific cases. The
reading above is the ordinary one for a personal project, not advice.

- [Trader/Non-Trader identification and verification](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure)
- [Trader FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)

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

Every update is a build and an upload. There is no way around the upload being
deliberate, and no way around review — even the API submits for review rather
than skipping it.

```bash
tools/release.sh patch path/to/capture.har
```

That bumps the version, runs the suite, and builds both zips: the store one to
upload, and the tester one for anyone still on an unpacked install. It exists
because the two easy mistakes — forgetting the version bump, and uploading the
tester zip with its key still in — are both silent until the store rejects them.

Then upload the `-store` zip on the dashboard and submit. Users get it
automatically within a day or so of it passing, which is also when a replay
broken by protocol drift repairs itself: see the retry-on-update behaviour in
the service worker.

### Automating the upload

The Chrome Web Store API can upload and submit from a script:

```
POST https://chromewebstore.googleapis.com/upload/v2/publishers/<publisher>/items/<id>:upload
POST https://chromewebstore.googleapis.com/v2/publishers/<publisher>/items/<id>:publish
```

It needs an OAuth client and secret from a Google Cloud project, a refresh token,
your publisher id, and 2-step verification on the account. **Review still
applies** — the API submits, it does not publish instantly.

Worth setting up if releases become frequent. Until then it saves a drag-and-drop
on a process that waits days for review anyway.

- [Using the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)

## What I would not publish yet

Only duel matches have ever been recorded. Bo3, sealed, and multiplayer variants
are untested, and the last few days have turned up real bugs in the recording
path — lost frames, merged matches, silently truncated replays. All fixed, all
tested, but found by using it rather than by reasoning about it.

An **unlisted or private** listing shared with a few players is the right next
step. Public is worth waiting for a week of quiet.
