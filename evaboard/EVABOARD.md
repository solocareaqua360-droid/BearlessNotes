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

## Building

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew :app:assembleRelease
```

The APK lands in `app/build/outputs/apk/release/`. Hand it to the phone
over the LAN from the scratchpad, never from the repo.

## Signing key

`~/.evaboard/evaboard-release.jks` with its passwords in
`~/.evaboard/keystore.properties` - both outside the repo. Every update
must be signed with this same key; losing it means uninstalling the
keyboard before the next version can go on, and it is also the key a
future Play Store upload would need. Back it up.
