#!/bin/sh
# evaBoard: build the release APK and publish it as a GitHub release, where the
# in-app «Оновити evaBoard» card (TEMPORARY dev updater) picks it up.
#
# Bump projectVersionCode/projectVersionName in gradle.properties first, commit
# and push, then run:  sh evaboard/release.sh "what changed"
set -e

cd "$(dirname "$0")"
VERSION=$(sed -n 's/^projectVersionName=//p' gradle.properties)
TAG="evaboard-v$VERSION"
NOTES=${1:-"evaBoard $VERSION"}

if gh release view "$TAG" >/dev/null 2>&1; then
    echo "Release $TAG already exists - bump the version in gradle.properties first." >&2
    exit 1
fi

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew :app:assembleRelease --console=plain -q

OUT=$(mktemp -d)
cp app/build/outputs/apk/release/app-release.apk "$OUT/evaboard-$VERSION.apk"
gh release create "$TAG" "$OUT/evaboard-$VERSION.apk" \
    --target evaBoard \
    --title "evaBoard $VERSION" \
    --notes "$NOTES" \
    --latest=false
rm -rf "$OUT"
echo "Published $TAG"
