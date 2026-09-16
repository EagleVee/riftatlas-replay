#!/usr/bin/env bash
# Build a replay from a capture and run every check against it.
#
#   tests/run.sh path/to/capture.har
#
# Derived artifacts land in tests/tmp/, which is gitignored: captures and the
# replays built from them carry player names and are never committed.
set -euo pipefail
HAR="${1:?usage: tests/run.sh <capture.har>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$ROOT/tests/tmp"
mkdir -p "$TMP"

echo "== extract frames =="
python3 "$ROOT/tools/har_to_jsonl.py" "$HAR" "$TMP/frames.jsonl"

echo
echo "== python reducer =="
(cd "$ROOT/tools" && python3 verify.py "$TMP/frames.jsonl")

echo
echo "== javascript reducer (must match the python output above) =="
node "$ROOT/tests/reducer-parity.mjs" "$TMP/frames.jsonl"

echo
echo "== build replay =="
(cd "$ROOT/tools" && python3 har_to_replay.py "$HAR" "$TMP/replay.ratlas.json")

echo
echo "== navigation index =="
node "$ROOT/tests/index-shape.mjs" "$TMP/replay.ratlas.json"

echo
echo "== no credentials in the replay =="
if grep -qE 'eyJ[A-Za-z0-9_-]{20,}' "$TMP/replay.ratlas.json"; then
  echo "FAIL: JWT-shaped string found in replay"; exit 1
fi
if grep -q '"authToken"' "$TMP/replay.ratlas.json"; then
  echo "FAIL: authToken key found in replay"; exit 1
fi
echo "ok   no JWT-shaped strings, no authToken key"

echo
echo "all checks passed"
