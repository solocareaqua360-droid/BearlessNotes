import { useCachedAttachment, CacheStatus } from './useCachedAttachment';

// What to actually put in an <Image>, and how that is going.
//
// On a phone the answer is the local path, once the file is there - which
// is what useCachedAttachment already arranges, fetching it back from
// Drive when it is not. This is that, plus the URI, so a caller does not
// have to know which of the two it is holding. The browser's own version
// answers very differently - see the .web sibling.
export function useAttachmentSource(
  uri: string | undefined,
  driveFileId: string | undefined,
  countsAsUse = true
): { status: CacheStatus; source: string | undefined } {
  const status = useCachedAttachment(uri, driveFileId, countsAsUse);
  return { status, source: status === 'ready' ? uri : undefined };
}
