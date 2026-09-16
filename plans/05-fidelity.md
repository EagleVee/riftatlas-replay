# Phase 5 — Fidelity hardening

**Purpose:** handle the cases that a single clean capture did not exercise.

Depends on phases 3 and 4. This phase is mostly **capture work**, not code — most
of [`docs/open-questions.md`](../docs/open-questions.md) closes here.

## Captures to take

| Capture | Closes |
|---|---|
| Match ending in normal victory | Q5 — finalisation trigger |
| Bo3 | Q6 — multi-game sequence space |
| Mid-match reload | Q6 — `resume_game` continuity |
| Spectator seat | Q2 — whether full-information replays are possible |
| One per `gameVariant` | Q4 — non-duel shapes |
| Full unfiltered HAR of a page load | Q1 — card art URLs |

Run `tools/analyze.py` on each and diff the frame-type and patch-verb inventory
against the reference. New verbs mean the reducer needs work; new frame types
mean the filter does.

## Code work

- **Gap handling end to end** — recorder emits `gaps`, player renders them,
  merge logic refuses to interpolate across one.
- **Rewind** — `rewind_last_action` commits forward and needs no special casing,
  but that claim deserves a test: a capture containing a rewind must replay with
  the rewind visible and the post-rewind board correct.
- **Partial recordings** — a recorder attached mid-match produces `partial: true`
  and the player says so.
- **Unknown-verb behaviour** — fail loudly, name the verb, keep the replay
  loadable up to that sequence.

## Then decide

With Q2 answered, decide whether spectator recording replaces or complements
two-capture merging. With Q1 answered, ask the owner about art before writing any
code that touches it.

## Done when

Every open question is answered or explicitly deferred with a reason, and each
new capture verifies clean.
