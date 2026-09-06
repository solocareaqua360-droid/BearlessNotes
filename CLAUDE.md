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
6. Document scanner (save as JPEG or PDF)
7. Sketch/drawing tool
8. Task reminders/notifications
9. Note cover image + paper color
10. Real (non-test) Firestore security rules — test mode is open for 30
    days from project creation; must land before real users touch this

**Agreed next chunk of work, decided at the end of the previous session:
scanner (6) → transition to an EAS dev-build (Expo Go can't host a
scanner, sketch, notifications, or Drive — all need native modules not
present in Expo Go) → sketch (7) → Google Drive sync (2).** After that,
revisit the remaining order for 4, 9, 10, 8, 5 together again — it was
deliberately left open rather than fixed in advance.

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
