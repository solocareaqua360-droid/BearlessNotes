#!/bin/sh
# evaBoard for the Mac: build the menu-bar app, put it in ~/Applications and start it.
#   sh evaboard/mac/build.sh
# Needs only the Xcode command-line tools (swiftc, codesign).
set -e
cd "$(dirname "$0")"
APP=build/evaBoard.app
rm -rf build
mkdir -p "$APP/Contents/MacOS"
swiftc -O -swift-version 5 -parse-as-library -target arm64-apple-macos14.0 Sources/*.swift -o "$APP/Contents/MacOS/evaBoard"
cp Info.plist "$APP/Contents/"
codesign --force -s - "$APP"

pkill -x evaBoard 2>/dev/null || true
mkdir -p ~/Applications
rm -rf ~/Applications/evaBoard.app
cp -R "$APP" ~/Applications/
open ~/Applications/evaBoard.app
echo "evaBoard for the Mac is running (menu bar)."
