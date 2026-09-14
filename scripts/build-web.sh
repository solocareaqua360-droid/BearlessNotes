#!/bin/sh
# Build the browser version. Always with --clear, and that is the whole
# reason this file exists - see CLAUDE.md. `eas update` bundles with the
# EAS environment, which has none of the EXPO_PUBLIC_* variables .env
# holds; those are inlined at transform time and cached by Metro, so an
# export run afterwards without --clear silently ships an empty Firebase
# config.
#
# A shell script rather than an npm script, and that is also deliberate:
# `packageJson:scripts` is one of the inputs expo-updates hashes into the
# runtime version. Adding one line to package.json's "scripts" changed
# this app's runtime fingerprint and cut the phone off from every OTA
# update published after it. Nothing under scripts/ is hashed.
set -e
cd "$(dirname "$0")/.."
npx expo export --platform web --clear
