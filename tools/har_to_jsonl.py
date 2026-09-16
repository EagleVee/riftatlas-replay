#!/usr/bin/env python3
"""Extract RiftAtlas realtime WebSocket frames from a DevTools HAR into JSONL.

Each output line: {"i", "dir", "t", "bytes", "msg"} where `t` is seconds since
the first frame and `msg` is the parsed JSON payload.

Auth tokens are redacted by default; pass --keep-secrets to disable.

    python3 har_to_jsonl.py capture.har out.jsonl
"""
import argparse
import json
import sys

SECRET_KEYS = ("authToken", "token", "jwt", "_pk")


def redact(obj):
    if isinstance(obj, dict):
        return {
            k: ("<redacted>" if k in SECRET_KEYS and isinstance(v, str) else redact(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("har")
    ap.add_argument("out")
    ap.add_argument("--url-contains", default="/parties/match/",
                    help="only extract frames from sockets whose URL matches")
    ap.add_argument("--keep-secrets", action="store_true")
    args = ap.parse_args()

    with open(args.har) as fh:
        entries = json.load(fh)["log"]["entries"]

    frames = []
    for entry in entries:
        if args.url_contains not in entry["request"]["url"]:
            continue
        frames.extend(entry.get("_webSocketMessages", []))
    if not frames:
        sys.exit("no WebSocket frames matched %r" % args.url_contains)

    frames.sort(key=lambda m: m["time"])
    t0 = frames[0]["time"]
    with open(args.out, "w") as out:
        for i, frame in enumerate(frames):
            try:
                msg = json.loads(frame["data"])
            except ValueError as exc:
                msg = {"__parse_error": str(exc), "raw": frame["data"][:200]}
            if not args.keep_secrets:
                msg = redact(msg)
            out.write(json.dumps({
                "i": i,
                "dir": frame["type"],
                "t": round(frame["time"] - t0, 3),
                "bytes": len(frame["data"]),
                "msg": msg,
            }) + "\n")
    print("wrote %d frames to %s" % (len(frames), args.out))


if __name__ == "__main__":
    main()
