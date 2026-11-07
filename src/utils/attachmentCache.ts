import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { getDocs } from '../firestore';
import { ownedQuery } from './owned';

// How long a file's bytes stay on this device once nobody has opened it.
//
// A file that has not been looked at in three months is not one anyone
// needs offline, and its record, its card and its place in every note
// stay exactly where they are - only the bytes go, and they come straight
// back from Drive the next time it is opened. So the rule is safe by
// construction: it only ever touches a file that has a Drive copy, and it
// never touches the record.
//
// "Used" is recorded here, per device, by whatever opens or shows a file
// in a way that means someone looked at it: opening it, the photo viewer,
// a note that carries it. A thumbnail scrolled past in the grid does NOT
// count, or nothing would ever expire.

const LAST_USED_KEY = 'attachments.lastUsed';
const LAST_SWEEP_KEY = 'attachments.lastSweep';
export const STALE_AFTER_DAYS = 90;
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

let lastUsed: Record<string, number> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadLastUsed(): Promise<Record<string, number>> {
  if (lastUsed) return lastUsed;
  try {
    const raw = await AsyncStorage.getItem(LAST_USED_KEY);
    lastUsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    lastUsed = {};
  }
  return lastUsed;
}

// Batched: a note with twenty images touches twenty files in one render,
// and twenty writes for that would be twenty too many.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (lastUsed) AsyncStorage.setItem(LAST_USED_KEY, JSON.stringify(lastUsed)).catch(() => {});
  }, 2000);
}

export function touchAttachment(uri: string | undefined) {
  if (!uri) return;
  loadLastUsed().then((map) => {
    map[uri] = Date.now();
    scheduleSave();
  });
}

type Sweep = { removed: number; freedBytes: number; kept: number };

function isOurs(uri: string): boolean {
  // Only ever inside the app's own cache - never a path that came from
  // somewhere else, whatever a record happens to say.
  return !!LegacyFileSystem.cacheDirectory && uri.startsWith(LegacyFileSystem.cacheDirectory);
}

// Every photo and file record, with the local path and the two dates the
// rule reads.
async function attachmentRecords(): Promise<{ uri: string; driveFileId?: string; since: number }[]> {
  const [photos, files] = await Promise.all([
    getDocs(ownedQuery('photos')),
    getDocs(ownedQuery('files')),
  ]);
  const out: { uri: string; driveFileId?: string; since: number }[] = [];
  photos.docs.forEach((d) => {
    const data = d.data();
    if (typeof data.imageUri === 'string') {
      out.push({
        uri: data.imageUri,
        driveFileId: data.driveFileId as string | undefined,
        since: Number(data.createdAt ?? data.updatedAt ?? Date.now()),
      });
    }
  });
  files.docs.forEach((d) => {
    const data = d.data();
    if (typeof data.fileUri === 'string') {
      out.push({
        uri: data.fileUri,
        driveFileId: data.driveFileId as string | undefined,
        since: Number(data.createdAt ?? data.updatedAt ?? Date.now()),
      });
    }
  });
  return out;
}

export async function sweepStaleAttachments(maxAgeDays = STALE_AFTER_DAYS): Promise<Sweep> {
  const result: Sweep = { removed: 0, freedBytes: 0, kept: 0 };
  const map = await loadLastUsed();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const record of await attachmentRecords()) {
    // No Drive copy: the bytes here are the only bytes there are.
    if (!record.driveFileId || !isOurs(record.uri)) {
      result.kept += 1;
      continue;
    }
    const seen = map[record.uri] ?? record.since;
    if (seen > cutoff) {
      result.kept += 1;
      continue;
    }
    try {
      const info = await LegacyFileSystem.getInfoAsync(record.uri);
      if (!info.exists) continue;
      await LegacyFileSystem.deleteAsync(record.uri, { idempotent: true });
      result.removed += 1;
      result.freedBytes += info.size ?? 0;
    } catch {
      result.kept += 1;
    }
  }
  return result;
}

// Once a day, from app start, quietly.
export async function sweepIfDue(): Promise<void> {
  try {
    const last = Number((await AsyncStorage.getItem(LAST_SWEEP_KEY)) ?? 0);
    if (Date.now() - last < SWEEP_EVERY_MS) return;
    await sweepStaleAttachments();
    await AsyncStorage.setItem(LAST_SWEEP_KEY, String(Date.now()));
  } catch {
    // A failed sweep is a sweep that runs tomorrow.
  }
}

// What the attachments take up on this device right now.
export async function localAttachmentUsage(): Promise<{ count: number; bytes: number; withoutDrive: number }> {
  let count = 0;
  let bytes = 0;
  let withoutDrive = 0;
  for (const record of await attachmentRecords()) {
    try {
      const info = await LegacyFileSystem.getInfoAsync(record.uri);
      if (!info.exists) continue;
      count += 1;
      bytes += info.size ?? 0;
      if (!record.driveFileId) withoutDrive += 1;
    } catch {
      // Unreadable is as good as absent for a count.
    }
  }
  return { count, bytes, withoutDrive };
}
