#!/bin/sh
# Build the browser version, into web-build/ - NOT dist/.
#
# `eas update` runs an export of its own and writes it to dist/, using the
# EAS environment, which holds none of the EXPO_PUBLIC_* variables .env
# holds locally. So a web build left in dist/ is overwritten by the next
# `eas update` with one whose Firebase config is the empty string, and the
# page then loads to nothing and says auth/invalid-api-key - which reads
# like a wrong key and is actually a different build entirely. Timestamps
# are how to tell: the files will be minutes newer than this script's run.
#
# Two directories, one owner each, and the collision cannot happen.
#
# --clear as well: those variables are inlined at transform time and cached
# by Metro, so an export following an `eas update` can otherwise reuse
# modules built with the empty ones.
#
# A shell script rather than an npm script, and that is also deliberate:
# `packageJson:scripts` is one of the inputs expo-updates hashes into the
# runtime version. Adding one line to package.json's "scripts" changed this
# app's runtime fingerprint and cut the phone off from every OTA update
# published after it. Nothing under scripts/ is hashed.
set -e
cd "$(dirname "$0")/.."
npx expo export --platform web --clear --output-dir web-build
