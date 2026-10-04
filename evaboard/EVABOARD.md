# evaBoard

The user's own Android keyboard. A separate app from mindEva, package id
`com.bearlessnotes.evaboard`, with no link to mindEva's data.

## Origin

Built on [FlorisBoard](https://github.com/florisboard/florisboard) v0.5.2,
Apache License 2.0 (see `LICENSE`). The first commit on this folder is
the unchanged FlorisBoard source; every later commit is an evaBoard change.
The Kotlin package names (`dev.patrickgold.florisboard`) are kept as they
are, so upstream fixes stay easy to compare.

Changes so far:
- app name evaBoard, own package id, temporary icon
- `lib:native` left out: it was FlorisBoard's placeholder Rust library
  (it added two numbers for a log line), and it made a Rust toolchain a
  build requirement
- release builds are signed with the evaBoard key (below)

Icons are Lucide (ISC licence, https://lucide.dev) - the same set mindEva uses -
generated into `ime/eva/LucideData.kt` by `tools/gen-lucide-icons.py`
(the licence text is in that file's header); `ime/eva/EvaIcons.kt` says
which icon belongs to which key.

## Building

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew :app:assembleRelease
```

The APK lands in `app/build/outputs/apk/release/`.

## Getting it onto the phone

While evaBoard is being built, the phone updates itself: the settings home
screen has an «Оновити evaBoard» card (TEMPORARY dev updater,
`ime/eva/devupdate`) that installs the newest GitHub release tagged
`evaboard-vX.Y.Z`. To publish one: bump `projectVersionCode` and
`projectVersionName` in `gradle.properties`, commit, push, then

```
sh evaboard/release.sh "what changed"
```

It needs `gh` logged in on this Mac. Remove the updater (and its INTERNET
and REQUEST_INSTALL_PACKAGES permissions) before evaBoard is finished.

## Signing key

`~/.evaboard/evaboard-release.jks` with its passwords in
`~/.evaboard/keystore.properties` - both outside the repo. Every update
must be signed with this same key; losing it means uninstalling the
keyboard before the next version can go on, and it is also the key a
future Play Store upload would need. Back it up.

## The Mac side (`mac/`)

A menu-bar app that keeps the same clipboard history as the keyboard, over the
home Wi-Fi (`ime/eva/macsync` on the phone, `mac/Sources` on the Mac; the wire
format is described at the top of `MacSyncProtocol.kt`). Build, install into
`~/Applications` and start it with

```
sh evaboard/mac/build.sh
```

It needs only the Xcode command-line tools. On first start it makes a 16-letter
pairing code (kept in `~/Library/Application Support/evaBoard/`), which goes into
evaBoard's settings card «Буфер обміну на Mac».
