# Build plan

Six phases. Each ends with something demonstrable, and each is ordered so that
the riskiest unknown is retired as early as it can be.

Phase 1 exists because everything downstream assumes we can observe the socket
from an extension. That assumption is unproven — the protocol analysis was done
on a DevTools HAR, not on our own capture path — and it is the single thing most
likely to invalidate the design. It gets tested first, with nothing else built on
top of it.

| # | Phase | Ends when | Depends on |
|---|---|---|---|
| 1 | [Capture spike](01-capture-spike.md) | Our own capture verifies byte-identical to a DevTools HAR of the same match | — |
| 2 | [Reducer port](02-reducer-port.md) | ✅ **done** — `reducer.js` and `reducer.py` agree byte for byte | — |
| 3 | [Recorder](03-recorder.md) | A played match produces a valid `.ratlas.json` that survives worker termination | 1, 2 |
| 4 | [Player](04-player.md) | ✅ **done** — steps and jumps in both directions, correct fog, offline | 2 |
| 5 | [Fidelity hardening](05-fidelity.md) | Gaps, rewinds, reconnects and match-end are handled and tested | 3, 4 |
| 6 | [Release](06-release.md) | Installable, documented, owner-reviewed | 5 |

Phases 1 and 2 are independent and can run in parallel. Phase 2 needs no
extension and no browser — it is a pure port validated against `tools/verify.py`.

## Scope for v1

In:

- Record a duel match from a player seat.
- Export and import `.ratlas.json`.
- Offline playback with chess.com-style navigation: step and jump forward and
  backward across sequences, narrated events and chapters, covering the setup
  phases (battlefield pick, initiative roll, first-player choice, sideboard,
  mulligan) as well as every turn. See
  [`docs/replay-navigation.md`](../docs/replay-navigation.md).
- Honest fog-of-war presentation.

Out, and why:

- **Card art** — unresolved, and asking the owner first (open question 1).
- **Merged two-player replays** — needs a second capture to design against.
- **Spectator recording** — needs a spectator capture to know if it helps.
- **Any form of sending frames** — permanently out of scope, not deferred.
- **Cloud sync / sharing** — a local file the user can send is enough for v1.

## Acceptance for v1

1. `tools/verify.py` passes on the reference capture and on every new capture.
2. A recorded match replays to a final board identical to the last snapshot the
   server sent during that match.
3. No credential appears anywhere in stored or exported data — asserted by a
   test that greps a real exported replay for JWT-shaped strings.
4. The player opens a replay with RiftAtlas closed and the network off.
5. Fog-of-war state is correct when scrubbing in both directions.
6. The timeline index reports 371 sequences, 291 narrated events, 6 phases, 14
   turns and 1 gap on the reference capture, with chapters on the measured
   sequences.
