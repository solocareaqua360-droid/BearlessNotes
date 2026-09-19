import { useEffect, useState } from 'react';
import type { CacheStatus } from './useCachedAttachment';
import { getDriveToken, subscribeToDriveToken } from '../utils/driveToken.web';

// The browser's answer to "where is this picture".
//
// It cannot be the stored path: that is a file on the phone
// (file:///data/user/0/...), and a browser is not allowed to read it -
// which is exactly why every card on the board showed an empty frame
// here. So the bytes come from Drive and become a blob the page can
// show.
//
// Fetched once per file per session and kept, because a board redraws
// constantly - dragging one card must not re-download the other twelve.

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

async function fetchFromDrive(driveFileId: string): Promise<string | null> {
  const cached = cache.get(driveFileId);
  if (cached) return cached;
  const running = inFlight.get(driveFileId);
  if (running) return running;

  const job = (async () => {
    // Never interactive from here: a download is not a click, and a popup
    // nobody asked for is blocked anyway. The banner asks once; after
    // that the token comes back silently.
    const token = await getDriveToken(false);
    if (!token) return null;
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) return null;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    cache.set(driveFileId, url);
    return url;
  })().finally(() => inFlight.delete(driveFileId));

  inFlight.set(driveFileId, job);
  return job;
}

export function useAttachmentSource(
  uri: string | undefined,
  driveFileId: string | undefined,
  // Accepted and ignored. On the phone this says whether showing the file
  // counts as someone looking at it, which is what the stale-copy sweep
  // reads (see attachmentCache). There is no local copy to sweep here, so
  // there is nothing for it to mean - but the callers are shared, so the
  // parameter has to exist.
  _countsAsUse = true
): { status: CacheStatus; source: string | undefined } {
  const [state, setState] = useState<{ status: CacheStatus; source?: string }>({
    status: 'checking',
  });

  useEffect(() => {
    let cancelled = false;
    // A picture that is already a web address - a link's preview, say -
    // is simply itself.
    if (uri && !uri.startsWith('file://')) {
      setState({ status: 'ready', source: uri });
      return;
    }
    if (!driveFileId) {
      setState({ status: 'missing' });
      return;
    }
    const attempt = () => {
      setState((current) => (current.source ? current : { status: 'restoring' }));
      fetchFromDrive(driveFileId).then((source) => {
        if (cancelled) return;
        setState(source ? { status: 'ready', source } : { status: 'missing' });
      });
    };
    attempt();
    // And again the moment the Drive connection appears, so pictures fill
    // in without anyone reloading the page.
    const unsubscribe = subscribeToDriveToken(attempt);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [uri, driveFileId]);

  return { status: state.status, source: state.source };
}
