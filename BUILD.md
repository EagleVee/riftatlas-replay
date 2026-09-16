# Building from source

**There is no build step.** The extension is plain ES modules, loaded directly
by Chrome — no bundler, no transpiler, no `node_modules`, no generated files.
"Building" means zipping the `extension/` folder.

That is deliberate. An extension that records your game traffic should be
readable by the person running it: what ships is exactly what is in the
repository, so anyone can check that the recorder cannot send and that
credentials never reach a file.

## What you need

| For | Needs |
|---|---|
| Running the extension | Nothing. Chrome loads `extension/` as-is. |
| Running the tests | Python 3.9+ and Node 22+, both standard library only |
| `tools/probe_client.mjs` only | `npm i playwright` — it drives a browser |

Verified from a clean clone with nothing installed: the full suite and the
packaging script both run.

## Get it

```bash
git clone <this repo> riftatlas-replay
cd riftatlas-replay
```

Nothing to install.

## Run the tests

You need a capture to test against — a DevTools HAR of a match (Network tab,
filter **WS**, right-click → *Save all as HAR with content*).

```bash
tests/run.sh path/to/capture.har
```

That chains everything:

1. extracts the WebSocket frames, redacting credentials
2. reduces them in **Python** and diffs against the server's own snapshots
3. reduces them in **JavaScript** and checks it matches the Python line for line
4. builds a `.ratlas.json` replay
5. checks the replay's structure and navigation index
6. greps the result for JWT-shaped strings and `authToken`, failing if either appears

Derived files land in `tests/tmp/`, which is gitignored — captures and the
replays built from them carry player names.

`tests/index-shape.mjs` asserts the exact shape of one specific match (371
sequences, 291 moves, 14 turns). Point it at a different replay and every check
fails by design; `tests/replay-smoke.mjs` is the replay-agnostic one.

## Load it in Chrome

**`--load-extension` no longer works.** Modern Chrome ignores it. Two ways in:

### Normal way

`chrome://extensions` → **Developer mode** on → **Load unpacked** → pick
`extension/`. Click the reload icon on the card after editing.

### For a fast edit loop

Start Chrome with the debugging port and a throwaway profile, then push reloads
from the shell:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-riftatlas" \
  --enable-unsafe-extension-debugging \
  https://play.riftatlas.com/ &

node tools/load-extension.mjs ./extension     # re-run to hot-reload
```

A separate `--user-data-dir` matters twice over: it starts a genuinely new
browser process (otherwise the flags are handed to your running Chrome and
dropped), and port 9222 hands full control of whatever profile it is attached
to, so pointing it at a throwaway keeps your real browser out of reach.

`Extensions.loadUnpacked` lives on the **browser** CDP target, not a page
target, which is what `tools/load-extension.mjs` handles.

## Package a release

```bash
tools/package.sh              # writes dist/riftatlas-replay-<version>.zip
```

It refuses to package a manifest that is missing icons, a description, or a
`key`. Bump `version` in `extension/manifest.json` first.

### About that `key`

An unpacked extension normally takes its identity from the **folder it was
loaded from**, so unzipping a new version somewhere else makes Chrome treat it
as a different extension — with a different, empty database. Testers lose their
recordings and do not find out until they look.

The `key` in the manifest is a public key that pins the identity instead, so
every install is the same extension wherever it sits on disk. Its private half
lives outside the repository in `~/.riftatlas-replay-keys/key.pem` and is only
needed to pack a `.crx`; losing it costs the pinned id, not the source.

A Chrome Web Store upload must **not** carry `key` — the store owns the
identity there. Strip it for a store build.

`dist/` is gitignored. Hand the zip and `INSTALL.md` to a tester.

## Layout

```
extension/          ships as-is
  manifest.json
  main-world/       WebSocket observer, page's own world, read-only
  content/          bridge to the service worker
  background/       recorder, finaliser, IndexedDB, message routing
  shared/           reducer, navigation index, HAR import
  player/           standalone offline viewer
  replay-mode/      renders a replay in RiftAtlas' own board
  popup/
tools/              Python reference implementation and dev scripts
tests/
docs/               protocol analysis, replay format, navigation model
plans/
```

## The rule when changing the reducer

`tools/reducer.py` is **normative**. `extension/shared/reducer.js` is a port and
must stay behaviourally identical — same function names, same operation order,
same branch order, so the two can be read side by side. Change one, change the
other, and `tests/run.sh` proves they agree on a real capture.

There is a third copy: `extension/replay-mode/inject.js` carries the patch
semantics inline, because it runs in the page's world where module imports are
not available. Nothing binds it to the other two yet — see the known limits in
[`extension/replay-mode/README.md`](extension/replay-mode/README.md).

## Re-checking the protocol after a RiftAtlas update

```bash
npm i playwright && npx playwright install chromium
node tools/probe_client.mjs ./client-probe
```

Fetches the production client bundles and dumps the action vocabulary and room
modes. Diff against a previous run to spot protocol drift. The reducer
dispatches on patch verbs rather than action types, so new actions are usually
harmless — but a new *verb* throws, loudly and on purpose, rather than silently
producing a wrong board.
