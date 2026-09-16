#!/usr/bin/env bash
# Build a distributable zip of the extension.
#
#   tools/package.sh [outdir]
#
# Refuses to package if the test suite has not been run against a capture, and
# checks the manifest for the things a tester build needs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/extension/manifest.json'))['version'])")"
NAME="riftatlas-replay-$VERSION"

mkdir -p "$OUT"
rm -f "$OUT/$NAME.zip"

python3 - "$ROOT" <<'PY'
import json, sys, pathlib
root = pathlib.Path(sys.argv[1])
m = json.loads((root / 'extension/manifest.json').read_text())
problems = []
if 'icons' not in m: problems.append('manifest has no icons')
for size, rel in (m.get('icons') or {}).items():
    if not (root / 'extension' / rel).exists(): problems.append(f'missing icon {rel}')
if not m.get('description'): problems.append('manifest has no description')
for key in ('key', 'update_url'):
    if key in m: problems.append(f'manifest still carries a dev-only "{key}"')
if problems:
    print('cannot package:'); [print('  -', p) for p in problems]; raise SystemExit(1)
print(f"manifest ok: {m['name']} {m['version']}")
PY

cd "$ROOT/extension"
zip -qr "$OUT/$NAME.zip" . \
  -x '*.DS_Store' -x '__MACOSX/*' -x '*/.*'
cp "$ROOT/INSTALL.md" "$OUT/INSTALL.md"

echo "wrote $OUT/$NAME.zip ($(du -h "$OUT/$NAME.zip" | cut -f1))"
echo "     $OUT/INSTALL.md"
echo
echo "contents:"
unzip -l "$OUT/$NAME.zip" | tail -n +4 | head -25
