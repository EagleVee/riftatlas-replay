#!/usr/bin/env bash
# Prepare a release: bump the version, prove it works, build both packages.
#
#   tools/release.sh patch|minor|major [capture.har]
#   tools/release.sh 0.6.0            [capture.har]
#
# Builds two zips, because they are not interchangeable:
#   riftatlas-replay-<v>.zip        for testers  - carries the key, keeps recordings
#   riftatlas-replay-<v>-store.zip  for upload   - key stripped, store owns the id
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUMP="${1:?usage: tools/release.sh patch|minor|major|<version> [capture.har]}"
CAPTURE="${2:-}"

NEW="$(python3 - "$ROOT/extension/manifest.json" "$BUMP" <<'PY'
import json, sys, pathlib, re
path, bump = pathlib.Path(sys.argv[1]), sys.argv[2]
m = json.loads(path.read_text())
major, minor, patch = (int(x) for x in m['version'].split('.'))
if bump == 'major': major, minor, patch = major + 1, 0, 0
elif bump == 'minor': minor, patch = minor + 1, 0
elif bump == 'patch': patch += 1
elif re.fullmatch(r'\d+\.\d+\.\d+', bump): major, minor, patch = (int(x) for x in bump.split('.'))
else: sys.exit(f'not a version or a bump: {bump}')
m['version'] = f'{major}.{minor}.{patch}'
path.write_text(json.dumps(m, indent=2) + '\n')
print(m['version'])
PY
)"
echo "version -> $NEW"

if [ -n "$CAPTURE" ]; then
  echo
  echo "== tests =="
  "$ROOT/tests/run.sh" "$CAPTURE" | tail -3
else
  echo "no capture given, so the suite did not run — pass one to be sure before uploading"
fi

echo
"$ROOT/tools/package.sh" >/dev/null
"$ROOT/tools/package.sh" --store >/dev/null
echo "built:"
ls -1 "$ROOT/dist/riftatlas-replay-$NEW"*.zip | sed 's|^|  |'
echo
echo "next: upload the -store zip at https://chrome.google.com/webstore/devconsole"
echo "      and hand the other one to anyone on an unpacked install"
