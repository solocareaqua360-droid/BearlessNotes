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
  // The path is the answer while it is being checked, too - not only
  // once the check has passed. Every picture on the phone was drawn from
  // its path directly, on the first frame, for the whole life of this
  // app; a source withheld until getInfoAsync returns would put a
  // spinner in front of each one for that tick, which is a flicker the
  // phone never had. Withheld only while the copy is genuinely not there:
  // being pulled back from Drive, or gone.
  return { status, source: status === 'ready' || status === 'checking' ? uri : undefined };
}
