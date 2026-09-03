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

Stage 0 (`DEVELOPMENT_PLAN.md`) is done. The Expo (TypeScript) app is
initialized at the repo root, Metro bundles cleanly, and it's been
confirmed running in Expo Go on a real Android device. The old
`.github/workflows/build.yml` (a leftover native-Kotlin/Gradle prototype)
has been removed.

The Firebase project (`bearless-notes`, Spark plan) exists with Firestore
(test-mode rules, region `eur3` — **rules must be locked down before real
users touch this**, test mode is open for 30 days from creation) and
Authentication (Email/Password) enabled. A Web app is registered in it and
its SDK config is wired in `src/firebase.ts`, read from environment
variables — copy `.env.example` to `.env` and fill in the real values from
Firebase Console (Project settings → General → Your apps → Bearless Notes
Web) before running the app; `.env` is git-ignored on purpose. `App.tsx`
does not import `src/firebase.ts` yet — that starts in Stage 1/2 once
there's an actual document list to back with it.

Run locally with `npm install` then `npm start` (or `npx expo start`) and
scan the QR code with Expo Go.
