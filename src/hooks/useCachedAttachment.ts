import { useEffect, useState } from 'react';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { touchAttachment } from '../utils/attachmentCache';
import { downloadFileFromDrive } from '../utils/googleDrive';

export type CacheStatus = 'checking' | 'ready' | 'restoring' | 'missing';

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
  countsAsUse = true
): CacheStatus {
  const [status, setStatus] = useState<CacheStatus>('checking');

  useEffect(() => {
    if (!uri) {
      setStatus('missing');
      return;
    }
    let cancelled = false;
    setStatus('checking');
    (async () => {
      const info = await LegacyFileSystem.getInfoAsync(uri);
      if (cancelled) return;
      if (info.exists) {
        setStatus('ready');
        if (countsAsUse) touchAttachment(uri);
        return;
      }
      if (!driveFileId) {
        setStatus('missing');
        return;
      }
      setStatus('restoring');
      const restored = await downloadFileFromDrive(driveFileId, uri);
      if (!cancelled) setStatus(restored ? 'ready' : 'missing');
      if (restored && countsAsUse) touchAttachment(uri);
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, driveFileId]);

  return status;
}
