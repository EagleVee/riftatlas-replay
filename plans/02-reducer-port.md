# Phase 2 — Reducer port

**Purpose:** a JavaScript reducer that is provably identical to
`tools/reducer.py`.

The Python reducer is the spec and is already validated: it reproduces the
server's own snapshots byte-for-byte on the reference capture. The port must not
drift from it. Where they disagree, the Python one is right until proven
otherwise.

## Build

`extension/shared/reducer.js` and `extension/shared/timeline.js`, mirroring
`apply_operation`, `apply_commit` and `Timeline`.

Same structure, same names, same ordering — resist the urge to make it more
idiomatic. This code will be read side-by-side with the Python for years, and
a clever rewrite costs more in review than it saves in elegance.

## Points of care

- **Deep-copy discipline.** Python's `copy.deepcopy` on insert is load-bearing:
  the same card object must not be aliased into two zones. `structuredClone` is
  the JS equivalent; shallow spreads will produce a board that mutates itself.
- **`zone_move` reveal.** `op.card` wins over the locally held card. Getting this
  backwards keeps opponents' cards hidden after they were played — a correctness
  bug that looks like working software.
- **Insert index semantics.** `list[i:i] = xs` splices before index `i`;
  `splice(i, 0, ...xs)` matches. Log index 0 means newest.
- **Unknown verbs throw.** Mirror `UnknownOperation`. A skipped op yields a
  plausible but wrong board, which is worse than an error.
- **Key deletion.** `unset_*` must `delete` keys, not set them undefined — the
  comparison against snapshots is key-sensitive.

## Verify

A test that loads the reference capture, reduces it in JS, and asserts
equality against the same snapshots `tools/verify.py` checks — including the
`SNAPSHOT_ONLY_PLAYER_FIELDS` exemption, and including the 99-entry gameplay log,
which is the strictest check available because ordering is easy to get wrong.

Run both implementations in CI on every capture in `evidence/`.

## Done when

`reducer.js` reproduces snapshots at sequences 8 and 9 exactly, materialises
sequences 0–370, and reports the 368→369 resync — matching `verify.py` line for
line.
