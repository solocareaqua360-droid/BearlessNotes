# Bearless Notes

Notes app built cross-platform-first (Android now, web later) with React
Native (Expo) and Firebase. Full product context lives in
`PROJECT_BRIEF.md`; work through `DEVELOPMENT_PLAN.md` stage by stage
(check off boxes as each stage's own verification step actually passes —
don't jump ahead).

## Project isolation

This repository (`BearlessNotes`) is a standalone project, fully separate from
any other app in this account (e.g. `bookmarvideo`). Keep it that way:

- **Folder / repo**: `BearlessNotes` has its own directory and its own git
  history. Never copy files from, or commit into, another project's repo.
- **Backend**: if this app ever needs Firebase or another backend, create a
  **new, dedicated project** for it — do not reuse or extend another app's
  Firebase project, API keys, or database.
- **Sessions**: when starting a new Claude Code session for this app, state
  the working directory explicitly (this repo) and that other projects
  (e.g. `bookmarvideo`) must not be touched. Don't `cd` into another
  project's folder from here, and don't run commands there "by habit".
- **Parallel work**: if both this app and another project need active work
  at the same time, use a separate terminal/session per project, each
  pinned to its own working directory — never share one session between them.

## Current state

Stages 0–4 (`DEVELOPMENT_PLAN.md`) are fully done and confirmed on a real
Android device via Expo Go — undo/redo, inline text formatting, the "/"
quick-add menu, image blocks, and attaching arbitrary files (opened via
the OS "open with" sheet), plus downloading photos/files to a
user-picked folder via Storage Access Framework.

Stage 5 (bypass-conversion of blocks into database objects) and Stage 6
(bulk-select modes) are mostly done, a few smaller items still unchecked
in `DEVELOPMENT_PLAN.md` (per-object delete confirmation, bulk-select on
the Documents list itself, PDF export). What's working: Tasks, Links
(YouTube/TikTok, geo, other — split from one `links` mirror collection),
Photos and Files all live as real cross-document Firestore objects, not
just blocks. A full tag system (tree-based `TagsDrawer`, multi-select
Мульти/Ізолюючий filter mode, per-item `TagPicker` with hide-from-
suggestions and icon/color editing) is shared across Documents/Files/
Photos/Links, plus a separate per-database-type "групування" field
(`Group`, deliberately distinct from Tasks' own `Project`) with bulk
select/tag/group/delete/copy-to-note on Files/Photos/Links. The Calendar
screen (week strip + expandable month grid, inline daily-note editing,
"only filled days" toggle) is also built and confirmed. None of this has
real cloud file backup yet (images/files live only in the device's local
cache/Firestore-referenced URI) — that's item 2 of the roadmap below.

### Post-MVP roadmap — 10 items agreed with the user, in original order:
1. Bulk editing of database objects — **done**
2. Google Drive sync (cloud backup for files/photos + storage counter +
   real sort/filter) — needs a second auth flow (Google Sign-In) and a
   second backend (Drive API), so it's deliberately not bundled with the
   scanner/sketch work below even though all three need the same
   EAS dev-build transition
3. Group/project-tabs field on every database — **done**
4. Kanban view for Tasks (todo/doing/paused/done)
5. Custom database with Notion-like field types — last on purpose: every
   other database (Tasks/Links/Photos/Files) exists first specifically so
   this one can reuse their patterns (groups, tags, bulk edit) instead of
   inventing its own
6. Document scanner (save as JPEG or PDF) — **done**
7. Sketch/drawing tool — **done**
8. Task reminders/notifications
9. Note cover image + paper color
10. Real (non-test) Firestore security rules — test mode is open for 30
    days from project creation; must land before real users touch this

**Agreed next chunk of work, decided at the end of the previous session:
scanner (6) → transition to an EAS dev-build (Expo Go can't host a
scanner, sketch, notifications, or Drive — all need native modules not
present in Expo Go) → sketch (7) → Google Drive sync (2).** Scanner, the
dev-build transition, and sketch are all done (see below); Drive sync
(2) is next — the Google Cloud side (dedicated project, Drive API,
OAuth consent screen and Android client) is already set up, see Stage
12 in `DEVELOPMENT_PLAN.md`. After Drive sync, revisit the remaining
order for 4, 9, 10, 8, 5 together again — it was deliberately left open
rather than fixed in advance.

**Scanner + EAS dev-build transition (Stage 10 in `DEVELOPMENT_PLAN.md`)
— done.** Summary of what that took, since the same setup now carries
over to every future native-module feature (sketch, notifications,
Drive):
- Library: `react-native-document-scanner-plugin` (Android's built-in
  Google ML Kit Document Scanner in `SCANNER_MODE_FULL` — edge
  detection, crop correction, rotate, filter, and multi-page are all
  native UI, not code here; PDF assembly from the pages is separate,
  via `expo-print`, no native module needed for that part).
  `expo-dev-client`, the scanner plugin, and `expo-print` are installed
  and wired into `app.json`'s `plugins`; the Android `package` id was
  deliberately set before the first real build (can't change after a
  Play Store publish) - first to `com.bearlessnotes.app`, then
  corrected to `com.bearlessnotes.notes` once it turned out the first
  string was already claimed by the user's other app (video bookmark,
  same GitHub account, different branch of this same repo) - Android
  treats two apps with the same package id as one and the same,
  offering "update" instead of a separate install, which is exactly
  the bug this surfaced as on-device.
- The first dev-client build could **not** be done with `eas build`
  from a Claude Code cloud session — that sandbox's network policy
  blocks `api.expo.dev` outright. Worked around by triggering it
  through the expo.dev web dashboard's "Build from GitHub" instead,
  walking the (non-technical) user through every click via screenshots.
  That also surfaced that the account's existing "bearlessnotes" Expo
  project already held builds for the user's *other* app (the
  video-bookmark one) — a real cross-project mixup, not just a naming
  coincidence — so this app now has its own dedicated "bearless-notes"
  Expo project instead (`app.json`'s `extra.eas.projectId`). The
  Android upload keystore ended up auto-generated by EAS itself during
  an earlier, accidentally-triggered `production`-profile build (wrong
  build profile picked once by mistake, then cancelled) rather than a
  keystore generated in-session and handed to the user, which turned
  out to be unnecessary.
- **Update (2026-09-08, adding react-native-webview/expo-local-
  authentication/expo-audio/expo-haptics for a Board-feature video
  player + future biometric lock/sounds/haptics):** this time a cloud
  `eas build` hit the free plan's monthly Android-build cap (resets on
  a rolling monthly date, shown in the CLI error) rather than the old
  network-policy block, and this particular session turned out to be
  running locally on the user's own Mac (`darwin-arm64`), not a cloud
  sandbox — `eas build --local` worked from here. That needed a local
  Android toolchain: the Android SDK (command-line tools, platforms,
  build-tools, NDK, licenses) was already present at
  `/opt/homebrew/share/android-commandlinetools` from some earlier,
  unlogged setup, but Java was missing - `brew install --cask
  temurin@17` failed outright (its installer needs an interactive sudo
  password Claude Code can't supply); `brew install openjdk@17` (a
  formula, not a cask, so no privileged installer step) worked.
  `JAVA_HOME`/`ANDROID_HOME`/`ANDROID_SDK_ROOT`/`PATH` are now exported
  from `~/.zprofile` on this Mac. The resulting APK isn't uploaded
  anywhere (a local build has no expo.dev download link) - it was
  handed to the phone by serving it over the local Wi-Fi (a scratch
  `python3 -m http.server`, not the whole repo directory) and opening
  `http://<Mac's LAN IP>:<port>/....apk` in the phone's browser, same
  install-from-unknown-sources step as every prior build. Net effect:
  local Android dev-client builds now work end-to-end from this Mac
  without touching EAS's cloud build quota at all - prefer `eas build
  --local` over the cloud profile for future native-module additions
  here, unless a *cloud* Claude Code session (no local Android
  toolchain) is doing the work instead.
- Live reload ended up working after all: a second, separate Claude
  Code window opened directly on the local project folder runs
  `npm start`, and the phone connects over Wi-Fi. Needed
  `REACT_NATIVE_PACKAGER_HOSTNAME` set explicitly once, because the
  Mac's Metro picked the wrong IP among several active network
  interfaces. From then on, `git push` from a cloud session +
  `git pull` in that local one reflects on the phone with no rebuild.
- The scanner UI itself (`DocumentEditorScreen.tsx`): a "Сканувати"
  entry in the "/" menu calls `DocumentScanner.scanDocument()`, then
  always asks (`Alert`) "Як фото" vs "Як PDF" regardless of page count
  (a single scanned page can still need to be a PDF). Confirmed working
  on-device for the photo path; the PDF path and true multi-page scans
  aren't separately confirmed yet.

**Sketch/drawing (7, `DEVELOPMENT_PLAN.md` Stage 11) — done, confirmed
on-device.** The requirement (explicitly, matching Google Keep) is a
drawing that can be reopened and continued, not a flattened photo - so
it's stored as vector data, not a raster image. New `sketch` block type
(`types.ts`): `sketchElements` (an ordered `SketchElement[]` - a `path`
or `text` union, one flat list rather than separate arrays per kind, so
undo and z-order both just mean "the last item") plus
`sketchWidth`/`sketchHeight` (the canvas size elements were captured
against, reused as the SVG `viewBox` for both the inline preview and
reopening the editor, so it doesn't distort on a different screen
size). Library: `react-native-svg` over `@shopify/react-native-skia` -
lighter, and everything maps onto a plain SVG `Path`/`Text`, no extra
serialization format needed. The editor (`src/components/
SketchEditor.tsx`) is a full-screen modal using plain React Native
responder events for the touch drawing (not gesture-handler - it's an
isolated canvas, not part of the scrolling block list).

Grew past the initial pen-only scope once the user tried it on-device:
line/arrow/rectangle/circle tools (a shape keeps its two defining points
as `SketchShape` alongside its rendered path, since a finished `d`
string alone can't be resized), a "select" tool (tap a shape or text
label for a dashed box + corner grips - drag inside to move, drag a grip
to resize; deliberately **not** available for freehand pen strokes, per
the user), and a partial eraser (rubs out just the points it passes
over and splits what's left into separate strokes, rather than deleting
the whole element - full-element delete is what plain undo already
does). Two real bugs surfaced during testing, both fixed:
- Text entry needed three attempts. First an inline `TextInput`
  overlaid on the canvas - the canvas's own touch responder fought it
  for focus (keyboard flashed open and shut). Then `RenamePrompt` (a
  nested `<Modal>`) - Android hands focus away from a `TextInput` inside
  a Modal nested in another Modal, same symptom. The fix was a plain
  overlay `View` as a sibling of the canvas (not a child of it, and not
  a second Modal).
- Even after that fix, the keyboard opening still wiped everything drawn
  and closed the text field again. Root cause: `DocumentEditorScreen`
  passes `initialElements={block?.sketchElements || []}` - a fresh array
  on every one of *its* renders - and it re-renders on `keyboardDidShow`
  (it tracks keyboard height for its own layout). The editor was
  re-seeding its state on every `initialElements` change instead of only
  on the hidden→visible transition, so each keystroke's keyboard-open
  render reset the whole drawing.

**Follow-up idea, raised by the user, revisit once sketch (7) is fully
done and confirmed on-device:** redesign the editor's toolbar to match
Notion's mobile app - one persistent bar pinned above the keyboard
(shown whenever the keyboard is open, not just on "/" or a text
selection) that merges the current "/" block-type menu, the text-format
toolbar, and the image/file/scan/sketch insert buttons into a single
row, plus a "+" that expands into a full block-type sheet. Assessed as
moderate difficulty, not a new technique - `DocumentEditorScreen.tsx`
already tracks `keyboardHeight` and has a similar horizontal-ScrollView
toolbar (just conditionally shown); the main risk flagged is Android
keyboard show/hide timing, which this exact editor has already hit
(hence the pencil-icon edit-mode toggle and the double-Enter workaround
above) - so this needs care around not flickering/jumping as focus
moves between blocks, more than new engineering.

The Firebase project (`bearless-notes`, Spark plan) has Firestore
(test-mode rules, region `eur3` — **rules must be locked down before real
users touch this**, test mode is open for 30 days from creation) and
Authentication (Email/Password) enabled. Its SDK config is wired in
`src/firebase.ts`, read from environment variables — copy `.env.example`
to `.env` and fill in the real values from Firebase Console (Project
settings → General → Your apps → Bearless Notes Web) before running the
app; `.env` is git-ignored on purpose. `DocumentsScreen.tsx` and
`DocumentEditorScreen.tsx` both read/write Firestore directly
(`onSnapshot`/`addDoc`/`deleteDoc`/`updateDoc`, no local-only state).

**Confirmed data-recovery guarantee (user asked explicitly whether a full
app delete + cache clear + reinstall keeps everything, Craft/Bear/Google-
Keep-style):** `auth` from `src/firebase.ts` is initialized but never
actually used anywhere - no sign-in screen, no `onAuthStateChanged`, no
per-user data gating. The Firebase config is baked directly into the build
from `.env`, so every install of the app talks to the same one shared
Firestore project with no login step at all. That means document/note
text, tasks, tags, links and sketch vector data (`sketchElements` - see
above) already survive delete+reinstall today, automatically, with nothing
the user needs to do. The one thing that does NOT survive yet is the raw
bytes of photo/file attachments (Firestore only stores a local URI, not
the file content) - that gap is exactly what the Google Drive backup below
is for, and it isn't fully solved yet: first-slice-only (new files/photos
going forward, no backfill of pre-existing ones), and not yet confirmed
on-device.

The document editor (`src/screens/DocumentEditorScreen.tsx`) is a
hand-rolled block editor — no third-party list/drag/swipe library, all
built directly on `react-native-gesture-handler` + `react-native-reanimated`
after `react-native-draggable-flatlist` and `react-native-swipeable-item`
both turned out to be incompatible with reanimated v4 for variable-height
rows. Notable pieces: single or multi-block drag-to-reorder via a
snapping "drop-line" indicator (nothing else moves or reorders until the
finger lifts); a select-mode toggle with per-block checkboxes for
deletion; an edit-mode toggle (pencil icon) that switches each block's
`TextInput` between fully inert (`pointerEvents: 'none'`, so swipes
scroll the screen from anywhere) and editable — needed because Android
has no reliable way to let a `TextInput` and a scroll gesture share a
touch; and double-Enter to create a new block (single Enter is a plain
line break — Android's React Native bridge discards Shift-key state
before it reaches JS, confirmed directly in RN's own source, so
Shift+Enter is not achievable here).

Run locally with `npm install` then `npm start` (or `npx expo start`) and
scan the QR code with Expo Go. After pulling changes that touch
`package.json`, watch for `package-lock.json` drift between platforms
(macOS laptop vs. this session's Linux sandbox) causing `git pull` to
refuse to merge — `git restore package-lock.json` before pulling is the
usual fix, since the local diff is just platform-specific lockfile noise,
not real changes.

**Breaking change once this branch is pulled:** now that `expo-dev-
client` is a dependency, Expo CLI auto-detects it and `expo start`
switches to development-build mode — plain Expo Go will refuse to
connect (client mismatch), even though no scanner code has been written
yet. Regular Expo Go workflow will not come back until the dev-client
APK (Stage 10 in `DEVELOPMENT_PLAN.md`) is built via `eas build
--profile development --platform android` and installed on the phone;
from then on, `npm start` opens straight into that custom client
instead of Expo Go.
