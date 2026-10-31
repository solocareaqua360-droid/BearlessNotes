import { Platform } from 'react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';

// WHERE THE FILE LIVES ON THIS PHONE. A record made on the phone holds its
// own file:// path. One made in a browser (the Mac app) holds a blob: URL -
// a thing that exists only in that tab, and that this phone can neither
// read nor download INTO, so a picture sent from the Mac showed a crossed
// cloud here even though its Drive copy was fine (2026-10-09, the chat's
// «референс для проекту»). For such a record the Drive copy goes to a
// path of its own, named by the Drive id.
export function localPathFor(uri: string | undefined, driveFileId: string | undefined): string | undefined {
  // A browser has no such disk: it draws what it is given (see useAttachmentSource.web).
  if (!uri || Platform.OS === 'web') return uri;
  if (!driveFileId || uri.startsWith('file:') || uri.startsWith('/')) return uri;
  return `${LegacyFileSystem.cacheDirectory}drive-${driveFileId}`;
}
