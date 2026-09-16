#!/usr/bin/env python3
"""Summarise a capture: message mix, patch verbs, action types, replay budget.

    python3 analyze.py frames.jsonl [--markdown]
"""
import argparse
import json
from collections import Counter

from reducer import Timeline

#: Frames that carry no authoritative state and can be dropped from a replay.
EPHEMERAL = {"presence_update", "presence_event", "auth_session", "auth_refresh",
             "rewind_confirmation_state", "gameplay_action_noop_ack"}


def table(rows, headers):
    widths = [max(len(str(r[i])) for r in [headers] + rows) for i in range(len(headers))]
    out = ["| " + " | ".join(h.ljust(w) for h, w in zip(headers, widths)) + " |",
           "|" + "|".join("-" * (w + 2) for w in widths) + "|"]
    for row in rows:
        out.append("| " + " | ".join(str(c).ljust(w) for c, w in zip(row, widths)) + " |")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    args = ap.parse_args()
    frames = [json.loads(line) for line in open(args.frames)]

    sent, received, size = Counter(), Counter(), Counter()
    for frame in frames:
        kind = frame["msg"].get("type", "<untyped>")
        (sent if frame["dir"] == "send" else received)[kind] += 1
        size[kind] += frame["bytes"]

    timeline = Timeline()
    verbs, actions = Counter(), Counter()
    for frame in frames:
        msg = frame["msg"]
        timeline.ingest(msg)
        if msg.get("type") == "authoritative_patch_commit":
            actions[msg["action"].get("type", "<none>")] += 1
            for op in msg["patch"]["operations"]:
                verbs[op["op"]] += 1

    duration = frames[-1]["t"] - frames[0]["t"]
    total = sum(size.values())
    essential = sum(v for k, v in size.items() if k not in EPHEMERAL)

    print("## Message mix\n")
    print(table([[k, sent[k], received[k], size[k]] for k in sorted(size, key=lambda k: -size[k])],
                ["type", "sent", "received", "bytes"]))
    print("\n## Patch operation verbs\n")
    print(table([[k, v] for k, v in verbs.most_common()], ["op", "count"]))
    print("\n## Committed action types\n")
    print(table([[k, v] for k, v in actions.most_common()], ["action", "count"]))

    seqs = timeline.sequences
    print("\n## Replay budget\n")
    print(table([
        ["frames", len(frames)],
        ["wall clock", "%.1f min" % (duration / 60)],
        ["sequences", "%d (%d..%d)" % (len(seqs), seqs[0], seqs[-1])],
        ["snapshots", len(timeline.snapshots)],
        ["commits", len(timeline.commits)],
        ["resyncs", len(timeline.resyncs)],
        ["total wire bytes", "%d (%.0f KiB)" % (total, total / 1024)],
        ["state-bearing bytes", "%d (%.0f KiB)" % (essential, essential / 1024)],
        ["ephemeral bytes", "%d (%.0f%%)" % (total - essential, 100 * (total - essential) / total)],
    ], ["metric", "value"]))


if __name__ == "__main__":
    main()
