# Phase 6 — Release

**Purpose:** make it installable and honest about what it does.

## Work

- **Packaging** — unpacked-install instructions first; Web Store submission only
  if the owner is comfortable with it.
- **README for users** — what it records, what it does not, where data lives,
  how to delete it.
- **Permission rationale** — each permission justified in the listing. `storage`,
  `downloads`, and host access to exactly two origins.
- **Owner review** — show the owner the recorder before publishing anything.
  Permission to build is not permission to distribute, and those are worth
  separating explicitly. Confirm specifically: the `world: "MAIN"` WebSocket
  wrapper, the read-only guarantee, and anything involving card art.
- **CI** — `tools/verify.py` and the JS reducer parity test on every capture in
  `evidence/`, on every commit.

## Stated guarantees

These go in the listing, not just the code:

- Observes only; never sends a frame, never modifies a frame, never delays one.
- No third-party network requests, no telemetry.
- Replays stay local until the user exports one.
- Credentials are stripped before anything is stored.
- A player-seat replay is fog-of-war, and the UI says so.

## Done when

A user who is not us can install it, record a match, and open the replay
tomorrow with RiftAtlas closed — and the owner has seen it.
