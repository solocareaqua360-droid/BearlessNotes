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

Stages 0–4 (`DEVELOPMENT_PLAN.md`) are done and confirmed on a real
Android device via Expo Go — undo/redo, inline text formatting, the "/"
quick-add menu (bulleted/numbered lists, checkbox, image, file,
divider), and image blocks (real-proportions/cropped toggle, full-screen
zoom, compression). Also added on top of the plan: attaching arbitrary
files (PDF/Word/Excel/etc.) as a block, opened via the OS's own
"open with" sheet from a local cache copy, plus downloading both photos
and files to a folder the user picks once via Android's Storage Access
Framework. None of this has a cloud copy yet (images and files live
only in the device's local cache/Firestore-referenced URI) — real
Google Drive backup for this is noted as the top post-MVP priority, see
the bottom of `DEVELOPMENT_PLAN.md`. Stage 5 (bypass-conversion of
blocks into database objects) is next and not yet started.

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
