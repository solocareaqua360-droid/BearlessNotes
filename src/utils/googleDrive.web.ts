// Drive, as far as a browser is concerned: not connected.
//
// The real module (googleDrive.ts) signs in through a NATIVE Google
// module and copies files with expo-file-system - neither exists here.
// A browser build would need Google Identity Services and a different
// upload path entirely, and the board does not need either: it asks for
// exactly one thing, a backup after a file is attached, and "there is no
// Drive here" is a truthful answer that costs nothing.
//
// Every export the real module has is kept, so that anything reaching
// for one gets the honest answer rather than a missing-symbol crash.

export type DriveSubFolder = 'Photos' | 'Files';

export interface DriveStorageQuota {
  usage: number;
  limit: number | null;
}

export function isDriveConnected(): boolean {
  return false;
}

export function getConnectedEmail(): string | null {
  return null;
}

export async function connectGoogleDrive(): Promise<string> {
  throw new Error('Google Диск у браузері ще не підключений');
}

export async function disconnectGoogleDrive(): Promise<void> {}

// Null means "no copy was made", which is exactly what the callers
// already handle: a failed backup never blocks attaching the file.
export async function backupFileToDrive(): Promise<{ fileId: string; bytes: number } | null> {
  return null;
}

export async function downloadFileFromDrive(): Promise<boolean> {
  return false;
}

export async function runDriveDiagnostics(): Promise<string> {
  return 'Google Диск у браузері ще не підключений';
}

export async function getDriveStorageQuota(): Promise<DriveStorageQuota | null> {
  return null;
}

export async function deleteFileFromDrive(): Promise<string | null> {
  return null;
}

// The file is wherever the browser put it; there is nothing to fetch back.
export async function ensureLocalFile(): Promise<boolean> {
  return true;
}

// On the phone this notices that the account which just signed in
// already carries the Drive scope, so Settings can stop offering to
// "connect" what is connected. Here the two are genuinely separate
// grants from two Cloud projects (see driveToken.web), and the Drive
// half lives in that module rather than this one - so there is nothing
// to adopt and no email to report.
//
// It exists because SettingsScreen calls it, and the file's own rule at
// the top says every export of the real module is kept: a missing one
// is not a quiet no-op, it takes the screen down on the symbol.
export async function adoptSignedInAccountForDrive(): Promise<string | null> {
  return null;
}
