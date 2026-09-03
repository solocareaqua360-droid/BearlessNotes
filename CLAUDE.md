# Bearless Notes

Native Android notes app (Kotlin), package `com.bearless.notes`.

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

The Android project isn't checked into the repo as source; it's generated
from scratch on every CI run by `.github/workflows/build.yml` (see the
heredocs in the `Create Android project` step), which then builds a debug
APK with Gradle. `MainActivity.kt` implements a simple local-only notes list
(add/edit/delete/pin/search) backed by `SharedPreferences` — no backend yet.
