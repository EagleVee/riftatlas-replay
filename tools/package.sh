#!/usr/bin/env bash
# Build a distributable zip of the extension.
#
#   tools/package.sh [outdir]
#
# Refuses to package if the test suite has not been run against a capture, and
# checks the manifest for the things a tester build needs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --store builds for a Chrome Web Store upload, where the store owns the
# extension's identity and a `key` in the manifest is not allowed. Everything
# else is a self-distributed build, which needs the key so that reinstalling
# lands on the same extension and keeps its recordings.
STORE=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --store) STORE=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done
OUT="${ARGS[0]:-$ROOT/dist}"
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/extension/manifest.json'))['version'])")"
NAME="riftatlas-replay-$VERSION"
[ "$STORE" = "1" ] && NAME="$NAME-store"

mkdir -p "$OUT"
rm -f "$OUT/$NAME.zip"

python3 - "$ROOT" "$STORE" <<'PY'
import json, sys, pathlib
root = pathlib.Path(sys.argv[1])
store = sys.argv[2] == '1'
m = json.loads((root / 'extension/manifest.json').read_text())
problems = []
if 'icons' not in m: problems.append('manifest has no icons')
for size, rel in (m.get('icons') or {}).items():
    if not (root / 'extension' / rel).exists(): problems.append(f'missing icon {rel}')
if not m.get('description'): problems.append('manifest has no description')
if 'update_url' in m: problems.append('manifest carries a dev-only "update_url"')
# `key` pins the extension id across folders, so an update lands on the same
# extension and keeps its recordings. Required for anything handed to a tester;
# it is only wrong for a Chrome Web Store upload, where the store owns the key.
if store:
    # The store assigns the identity; a key in the package is rejected.
    if not m.get('description'): problems.append('the store requires a description')
    if len(m.get('description', '')) > 132:
        problems.append('description must be 132 characters or fewer for the store')
    if '128' not in (m.get('icons') or {}):
        problems.append('the store requires a 128px icon')
elif 'key' not in m:
    problems.append('manifest has no "key" — every install would get a fresh, '
                    'empty database (pass --store to build for the Web Store)')
if problems:
    print('cannot package:'); [print('  -', p) for p in problems]; raise SystemExit(1)
print(f"manifest ok: {m['name']} {m['version']}")
PY

if [ "$STORE" = "1" ]; then
  # Build from a copy with the key stripped, leaving the working tree alone.
  STAGE="$(mktemp -d)"
  cp -R "$ROOT/extension/." "$STAGE/"
  python3 - "$STAGE/manifest.json" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
m = json.loads(p.read_text())
m.pop('key', None)
p.write_text(json.dumps(m, indent=2) + "\n")
print('  stripped "key" for the store upload')
PY
  (cd "$STAGE" && zip -qr "$OUT/$NAME.zip" . -x '*.DS_Store' -x '__MACOSX/*' -x '*/.*')
  rm -rf "$STAGE"
else
  (cd "$ROOT/extension" && zip -qr "$OUT/$NAME.zip" . -x '*.DS_Store' -x '__MACOSX/*' -x '*/.*')
  cp "$ROOT/INSTALL.md" "$OUT/INSTALL.md"
fi

echo "wrote $OUT/$NAME.zip ($(du -h "$OUT/$NAME.zip" | cut -f1))"
echo "     $OUT/INSTALL.md"
echo
echo "contents:"
unzip -l "$OUT/$NAME.zip" | tail -n +4 | head -25
