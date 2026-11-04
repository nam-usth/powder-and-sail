#!/bin/sh
# Build a playable zip: dist/PowderAndSail-<date>.zip  (run from the repo root)
set -e
cd "$(dirname "$0")/.."
NAME="PowderAndSail-$(date +%Y%m%d-%H%M)"
STAGE="dist/$NAME"
rm -rf "$STAGE"; mkdir -p "$STAGE/tools" "$STAGE/docs"
cp -r frontend test "$STAGE/"
cp tools/serve.mjs "$STAGE/tools/"
[ -f docs/SPECIFICATION.md ] && cp docs/SPECIFICATION.md "$STAGE/docs/"
cp -r design "$STAGE/docs/design"
cp tools/package/PLAY.md "$STAGE/DOC-TRUOC.md"
cp tools/package/Choi-game-Windows.bat tools/package/choi-game.sh "$STAGE/"
chmod +x "$STAGE/choi-game.sh"
(cd dist && zip -qr "$NAME.zip" "$NAME")
rm -rf "$STAGE"
echo "dist/$NAME.zip"
