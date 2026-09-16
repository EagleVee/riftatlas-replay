#!/usr/bin/env python3
"""Prove a capture is replayable: reduce it and diff against every snapshot.

For each sequence where the capture contains both a server snapshot and a state
we reduced ourselves, the two must be identical apart from the snapshot-only
cosmetic fields. Any other difference is a reducer bug or a protocol change.

    python3 verify.py frames.jsonl
"""
import argparse
import json

from reducer import SNAPSHOT_ONLY_PLAYER_FIELDS, Timeline


def diff(ours, theirs, path=""):
    """Yield human-readable differences between two JSON-ish values."""
    if type(ours) is not type(theirs):
        yield "%s: type %s != %s" % (path or "/", type(ours).__name__, type(theirs).__name__)
        return
    if isinstance(ours, dict):
        for key in sorted(set(ours) | set(theirs)):
            if key not in ours:
                yield "%s/%s: missing from reduced state" % (path, key)
            elif key not in theirs:
                yield "%s/%s: unexpected in reduced state" % (path, key)
            else:
                yield from diff(ours[key], theirs[key], "%s/%s" % (path, key))
    elif isinstance(ours, list):
        if len(ours) != len(theirs):
            yield "%s: length %d != %d" % (path, len(ours), len(theirs))
            return
        for i, (a, b) in enumerate(zip(ours, theirs)):
            yield from diff(a, b, "%s[%d]" % (path, i))
    elif ours != theirs:
        yield "%s: %s != %s" % (path, json.dumps(ours)[:80], json.dumps(theirs)[:80])


def strip_snapshot_only(state):
    state = json.loads(json.dumps(state))
    for player in state.get("players", []):
        for field in SNAPSHOT_ONLY_PLAYER_FIELDS:
            player.pop(field, None)
    return state


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", help="JSONL from har_to_jsonl.py")
    args = ap.parse_args()

    frames = [json.loads(line) for line in open(args.frames)]
    timeline = Timeline()
    for frame in frames:
        timeline.ingest(frame["msg"])

    checked = failed = 0
    for seq, (snap_state, snap_log) in sorted(timeline.snapshots.items()):
        if seq not in timeline.commits:
            continue  # snapshot we adopted rather than reduced into; nothing to prove
        ours_state, ours_log = timeline.states[seq]
        checked += 1
        problems = list(diff(strip_snapshot_only(ours_state), strip_snapshot_only(snap_state), "/state"))
        problems += list(diff(ours_log, snap_log, "/log"))
        if problems:
            failed += 1
            print("sequence %d: %d difference(s)" % (seq, len(problems)))
            for line in problems[:20]:
                print("   ", line)
        else:
            print("sequence %d: reduced state matches snapshot" % seq)

    for src, dst in timeline.resyncs:
        print("resync: server re-anchored %d -> %d; %d commit(s) never reached this client"
              % (src, dst, dst - src))

    for src, dst, repaired in timeline.holes:
        print("hole: sequence %d -> %d (%s)"
              % (src, dst, "repaired from snapshot" if repaired else "UNREPAIRABLE"))

    seqs = timeline.sequences
    print("\n%d sequences materialised (%d..%d), %d snapshot checks, %d failed"
          % (len(seqs), seqs[0], seqs[-1], checked, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
