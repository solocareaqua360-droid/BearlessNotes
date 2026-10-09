import { useEffect, useState } from 'react';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { touchAttachment } from '../utils/attachmentCache';
import { downloadFileFromDrive } from '../utils/googleDrive';

export type CacheStatus = 'checking' | 'ready' | 'restoring' | 'missing';

// WHERE THE FILE LIVES ON THIS PHONE. A record made on the phone holds its
// own file:// path. One made in a browser (the Mac app) holds a blob: URL -
// a thing that exists only in that tab, and that this phone can neither
// read nor download INTO, so a picture sent from the Mac showed a crossed
// cloud here even though its Drive copy was fine (2026-10-09, the chat's
// «референс для проекту»). For such a record the Drive copy goes to a
// path of its own, named by the Drive id.
export function localPathFor(uri: string | undefined, driveFileId: string | undefined): string | undefined {
  if (!uri) return uri;
  if (!driveFileId || uri.startsWith('file:') || uri.startsWith('/')) return uri;
  return `${LegacyFileSystem.cacheDirectory}drive-${driveFileId}`;
}

// A photo/file block only ever stores a local URI (see backupFileToDrive's
// own comment) - on a device that never created it, that path simply
// doesn't exist. If there's a Drive backup (driveFileId), this quietly
// re-downloads it to that exact same path the first time it's rendered;
// otherwise (or if the download fails - offline, revoked Drive access) the
// caller shows a plain "unavailable" state instead of a blank image/broken
// icon. Shared by DocumentEditorScreen's image/file blocks and the
// Photos/Files screens' own thumbnails, so a device only has to re-download
// each attachment once, the first time it's viewed anywhere.
// `countsAsUse`: whether showing this counts as someone looking at the
// file (a note that carries it - yes; a thumbnail in a grid scrolled past
// - no). It is what the stale-copy rule reads - see attachmentCache.
export function useCachedAttachment(
  uri: string | undefined,
  driveFileId: string | undefined,
  countsAsUse = true,
  // Off for a page miniature (BlockRow's `preview`): nothing is checked or
  // fetched, the stored path is simply trusted - a card is a picture, and
  // a check per row was a second render of every row of every card.
  enabled = true
): CacheStatus {
  // A block with no file at all (every text block asks too) starts as what
  // it is: it used to start 'checking' and be told 'missing' a moment later,
  // which rendered every row of every note twice on the way in.
  const [status, setStatus] = useState<CacheStatus>(!uri ? 'missing' : enabled ? 'checking' : 'ready');

  useEffect(() => {
    if (!enabled) return;
    if (!uri) {
      setStatus('missing');
      return;
    }
    let cancelled = false;
    setStatus('checking');
    const path = localPathFor(uri, driveFileId) as string;
    (async () => {
      // A browser has no such file system at all, and asking it throws
      // rather than answering "no" - which would leave the caller stuck
      // on "checking" forever.
      const info = await LegacyFileSystem.getInfoAsync(path).catch(() => ({ exists: false }) as const);
      if (cancelled) return;
      if (info.exists) {
        setStatus('ready');
        if (countsAsUse) touchAttachment(path);
        return;
      }
      if (!driveFileId) {
        setStatus('missing');
        return;
      }
      setStatus('restoring');
      const restored = await downloadFileFromDrive(driveFileId, path);
      if (!cancelled) setStatus(restored ? 'ready' : 'missing');
      if (restored && countsAsUse) touchAttachment(path);
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, driveFileId, enabled]);

  return status;
}
