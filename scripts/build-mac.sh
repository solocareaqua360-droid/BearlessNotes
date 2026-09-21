#!/bin/sh
# Build the macOS application.
#
# There is no separate Mac codebase: the application IS the web export,
# the same one the browser version runs. This script exports it, copies
# it into the Electron shell, and packages the result as mindEva.app.
#
# A shell script rather than an npm script for the same reason as
# build-web.sh: `packageJson:scripts` is hashed into the expo-updates
# runtime version, and one line added there once cut the phone off from
# every OTA update afterwards. Nothing under scripts/ is hashed.
#
# The shell's own dependencies live in desktop/package.json, which is a
# separate package entirely - Electron never appears in the root
# package.json, so the Android fingerprint does not move.
#
# Usage:
#   sh scripts/build-mac.sh          export, copy, package
#   sh scripts/build-mac.sh --run    export, copy, run it without packaging
set -e
cd "$(dirname "$0")/.."

echo "==> Exporting the web build"
sh scripts/build-web.sh

echo "==> Copying it into the shell"
rm -rf desktop/app
cp -R web-build desktop/app

if [ ! -d desktop/node_modules ]; then
  echo "==> Installing the shell's dependencies (first run only)"
  (cd desktop && npm install)
fi

if [ "$1" = "--run" ]; then
  echo "==> Starting"
  (cd desktop && npm start)
  exit 0
fi

echo "==> Packaging"
(cd desktop && npm run dist)

echo
echo "Done: desktop/release/mac-arm64/mindEva.app"
echo "The build is unsigned, so the first launch is right-click -> Open."
