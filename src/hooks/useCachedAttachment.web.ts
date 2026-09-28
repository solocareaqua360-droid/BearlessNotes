export type CacheStatus = 'checking' | 'ready' | 'restoring' | 'missing';

// Whether a file is "here", in a browser - where "here" cannot mean what
// it means on the phone.
//
// The phone's version asks the disk for the stored path, and when the
// path is gone pulls the Drive copy back down to it. A browser has no
// such disk: the path is a file on the phone, and there is nowhere to
// restore into. Run unchanged here, the phone's version answered
// "missing" for every file the app has - a scan sitting safely on Drive
// showed "Недоступно тут" beside a red icon, and so did all the others.
//
// So here a file is ready exactly when Drive has it. Opening one does not
// go through a local copy at all: openFileExternally.web fetches the
// bytes by that id and hands them to a new tab, which is what "open
// elsewhere" means in a browser. That is also why this does not care
// about the Drive token: the click that opens the file is the click that
// can obtain one, and openFileExternally says so if it cannot.
//
// The two states the phone can be in between, checking and restoring,
// never happen here - there is nothing to check and nothing to restore.
export function useCachedAttachment(
  uri: string | undefined,
  driveFileId: string | undefined,
  _countsAsUse = true
): CacheStatus {
  if (!uri && !driveFileId) return 'missing';
  return driveFileId ? 'ready' : 'missing';
}
