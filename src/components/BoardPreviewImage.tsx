import { ReactNode, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { downloadFileFromDrive } from '../utils/googleDrive';

// A BOARD'S PICTURE, KEPT WHERE IT LASTS (2026-10-06, the user's: "кожен
// раз йде кільце завантаження з оновленням виду прев'ю дошки"). The capture
// (BoardMiniature) was written to the cache directory, which Android
// empties when it likes - after which every list showed a spinner while
// the picture came down from Drive again, into the same cache, to be lost
// again. Each version of a board's picture now has a file of its own in
// the app's documents directory: there, it is shown at once; not yet
// there, it is copied from the capture or fetched from Drive once - and
// meanwhile the board's own cover and map (`fallback`) stand in its place,
// not a spinner.
const DIR = LegacyFileSystem.documentDirectory ? `${LegacyFileSystem.documentDirectory}boardPreviews/` : null;

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Shown once per version: a picture known to be there is not checked again.
const ready = new Set<string>();
const inFlight = new Map<string, Promise<boolean>>();

async function ensure(path: string, localUri: string | undefined, driveFileId: string | undefined): Promise<boolean> {
  if ((await LegacyFileSystem.getInfoAsync(path).catch(() => ({ exists: false }))).exists) return true;
  if (!DIR) return false;
  await LegacyFileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  if (localUri && (await LegacyFileSystem.getInfoAsync(localUri).catch(() => ({ exists: false }))).exists) {
    try {
      await LegacyFileSystem.copyAsync({ from: localUri, to: path });
      return true;
    } catch {
      // Then Drive, if there is one.
    }
  }
  if (driveFileId) return downloadFileFromDrive(driveFileId, path).catch(() => false);
  return false;
}

// The board's earlier pictures go once a newer one is in place.
function forgetOlder(boardId: string, keep: string) {
  if (!DIR) return;
  LegacyFileSystem.readDirectoryAsync(DIR)
    .then((names) =>
      names
        .filter((name) => name.startsWith(`${boardId}-`) && `${DIR}${name}` !== keep)
        .forEach((name) => LegacyFileSystem.deleteAsync(`${DIR}${name}`, { idempotent: true }).catch(() => {}))
    )
    .catch(() => {});
}

export default function BoardPreviewImage({
  boardId,
  uri,
  driveFileId,
  fallback,
}: {
  boardId: string;
  uri?: string;
  driveFileId?: string;
  fallback: ReactNode;
}) {
  const version = uri || driveFileId ? hash(`${driveFileId ?? ''}|${uri ?? ''}`) : null;
  const path = DIR && version ? `${DIR}${boardId}-${version}.jpg` : null;
  const [shown, setShown] = useState<string | null>(path && ready.has(path) ? path : null);

  useEffect(() => {
    if (!path) {
      setShown(null);
      return;
    }
    if (ready.has(path)) {
      setShown(path);
      return;
    }
    let alive = true;
    let job = inFlight.get(path);
    if (!job) {
      job = ensure(path, uri, driveFileId);
      inFlight.set(path, job);
    }
    job.then((ok) => {
      inFlight.delete(path);
      if (ok) {
        ready.add(path);
        forgetOlder(boardId, path);
      }
      if (alive && ok) setShown(path);
    });
    return () => {
      alive = false;
    };
    // The version is the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // The stand-in stays until the picture has actually been drawn, then
  // goes - a live board map under a picture that hides it is work for
  // nothing.
  const [drawn, setDrawn] = useState<string | null>(null);
  return (
    <View style={StyleSheet.absoluteFill}>
      {drawn !== shown || !shown ? fallback : null}
      {shown && (
        <Image
          source={{ uri: shown }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          resizeMethod="resize"
          onLoad={() => setDrawn(shown)}
        />
      )}
    </View>
  );
}
