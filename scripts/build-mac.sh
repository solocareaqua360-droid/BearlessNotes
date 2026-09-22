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

# Sign the bundle to itself.
#
# electron-builder is told not to sign (there is no Apple developer
# account here and none is needed), which leaves the Electron binary's
# own ad-hoc signature covering the executable and nothing else - so
# `spctl` reports "code has no resources but signature indicates they
# must be present". It still launches, but the signature is incoherent,
# and macOS identifies an app by its signature: a different one each
# build means permissions granted to the last build do not carry over.
#
# `--sign -` is an ad-hoc signature: no certificate, no account, no
# network. It makes the bundle internally consistent and stable across
# rebuilds.
echo "==> Signing it to itself"
codesign --force --deep --sign - desktop/release/mac-arm64/mindEva.app 2>/dev/null

echo
echo "Done: desktop/release/mac-arm64/mindEva.app"
# No right-click needed: macOS only asks about an app carrying the
# com.apple.quarantine attribute, which is put there by whatever
# DOWNLOADED it. Nothing downloads this one - it is built here - so it
# opens with a double click like any other app.
echo "Open it with a double click - it is built locally, so macOS does not"
echo "treat it as downloaded and will not ask."
