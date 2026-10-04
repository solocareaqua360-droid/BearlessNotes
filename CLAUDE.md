# sketchEva

A drawing app for Android, split off from **mindEva** (the notes app in
`~/BearlessNotes`) on 2026-10-04. It starts as mindEva's own drawing
editor, lifted out to be grown freely; what proves itself here goes back
into mindEva later, possibly simplified. The user talks to this session
about the drawing app's features; Claude does the building.

Replies to the user: **Ukrainian**, short, plain words (the user is not a
programmer). Code, comments and commit messages: **English**. Ask before
any larger build - the user's ideas are often thinking aloud, not
tickets. Show visual changes early; the user decides by looking.

## Isolation - read first

- This folder is `~/SketchEva`, branch **`sketchEva`**, a git worktree of
  the same GitHub repo as mindEva. **Never** touch `~/BearlessNotes`
  (mindEva) or `~/VideoBookmark` (another app), never check their
  branches out here, never run commands in their folders.
- Android package id is **`com.sketcheva.app`** - never change it, and
  never reuse mindEva's (`com.bearlessnotes.notes`): two apps with one id
  are one app to Android, and installing one "updates" the other.
- Its own Expo project: none yet. Create a NEW one on the first build
  (`eas init` → "sketch-eva"). Never link mindEva's projectId
  (`862729ab-…`) or publish updates to its channels.
- No Firebase, no Google Drive, no accounts. Drawings are files on the
  phone; they leave it by export.
- No Mac / web version (the user's call).

## The one rule that matters: mindEva must be able to follow

Everything here exists to be brought back into mindEva. So:

1. **Same foundation as mindEva (variant А, the user's choice).** Drawing
   is `react-native-svg` + `react-native-gesture-handler` +
   `react-native-reanimated`, exactly mindEva's stack. **No Skia**, and no
   other new NATIVE module without asking: mindEva ships over the air and
   a new native module there means a new APK. A pure-JS addition is fine.
2. **The file format is the contract** - `src/sketch/format.ts`, described
   in `docs/FORMAT.md`. Change it only by ADDING (a new element kind, a
   new optional field), never by renaming or removing; bump
   `SKETCH_VERSION` when it changes.
3. **Every feature goes in `docs/MINDEVA_COMPAT.md`** with its verdict for
   mindEva - так / спрощено / ні - and why. Tell the user that verdict when
   a feature is discussed, before building it. A "ні" is allowed, but it
   must be a decision, not an accident: an element mindEva cannot draw must
   still survive a round trip there untouched (and show via the preview).
4. **The editor stays a module.** `src/sketch/` is what moves back to
   mindEva: no imports from outside it except React Native, the libraries
   above and Expo modules mindEva already has. App-only things (the list of
   drawings, storage, export) live outside it (`App.tsx`, `src/store.ts`).

## What is here (2026-10-04)

- `src/sketch/SketchEditor.tsx`, `SketchLayer.tsx`, `sketchGeometry.ts` -
  mindEva's editor as of commit 25235f0 on its branch, with mindEva's
  couplings cut: no Google Drive backup of pictures, no picking from
  mindEva's «Зображення», pictures copied into the app's own folder.
- `src/sketch/format.ts` - element types (copied from mindEva's
  `src/types.ts`) plus the file shape `SketchFile`.
- `src/sketch/theme.ts`, `fonts.ts`, `icons/` - mindEva's soft palette,
  Inter fonts and Lucide icon shim, as plain local copies.
- `App.tsx` - one screen: the drawings as cards; tap = open, hold =
  export / delete; "+" new, the other round button = import a file.
- `src/store.ts` - `*.sketch.json` files in the app's document folder;
  export embeds pictures as base64 and shares the file; import does the
  reverse under a new id.

Not done yet: the preview picture inside an exported file (see
docs/FORMAT.md), renaming a drawing, a real icon (mindEva's is a
placeholder), mindEva's side of the import.

## Building and running

There is no APK yet. The Mac has the Android toolchain (see mindEva's
history: `JAVA_HOME`/`ANDROID_HOME` in `~/.zprofile`, openjdk@17), so
`eas build --local --profile development --platform android` works here
once an Expo project exists; serve the APK over Wi-Fi to install it
(a scratch `python3 -m http.server` in a folder holding only the APK).
`expo-dev-client` is in: after installing that build, `npx expo start`
gives live reload. Check before commits: `npx tsc --noEmit -p .` and
`npx expo export --platform android --output-dir <scratch dir>`.
