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

Stage 0 (`DEVELOPMENT_PLAN.md`) is in progress: the Expo (TypeScript) app
is initialized at the repo root (`App.tsx`, `app.json`, `index.ts`,
`package.json`) and Metro bundles cleanly. The old
`.github/workflows/build.yml` (a leftover native-Kotlin/Gradle prototype
that no longer matched the chosen stack) has been removed. Not done yet:
a Firebase project (Firestore + Authentication) hasn't been created or
wired in — that needs the user to create it in the Firebase console — and
nobody has confirmed the app loads in Expo Go on a real device.

Run locally with `npm install` then `npm start` (or `npx expo start`) and
scan the QR code with Expo Go.
