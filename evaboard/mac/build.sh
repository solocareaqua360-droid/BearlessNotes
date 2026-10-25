#!/bin/sh
# evaBoard for the Mac: build the menu-bar app, put it in /Applications (Launchpad, Spotlight) and start it.
#   sh evaboard/mac/build.sh
# Needs only the Xcode command-line tools (swiftc, codesign).
set -e
cd "$(dirname "$0")"
APP=build/evaBoard.app
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp AppIcon.icns "$APP/Contents/Resources/"
swiftc -O -swift-version 5 -parse-as-library -target arm64-apple-macos14.0 Sources/*.swift -o "$APP/Contents/MacOS/evaBoard"
cp Info.plist "$APP/Contents/"
codesign --force -s - "$APP"

pkill -x evaBoard 2>/dev/null || true
# /Applications when it can be written (an admin user), else the user's own ~/Applications
DEST=/Applications
[ -w "$DEST" ] || DEST=~/Applications
mkdir -p "$DEST"
rm -rf "$DEST/evaBoard.app"
[ "$DEST" = /Applications ] && rm -rf ~/Applications/evaBoard.app
cp -R "$APP" "$DEST/"
# tell Launchpad and Spotlight about the new icon
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/evaBoard.app" 2>/dev/null || true
open "$DEST/evaBoard.app"
echo "evaBoard for the Mac is running (menu bar), installed in $DEST."
