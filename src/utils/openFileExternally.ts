import { Alert, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ensureLocalFile } from './googleDrive';

// Hand a stored file to whatever app on the phone opens that kind of file -
// a .docx to Office, a PDF to the PDF reader. This app will never render a
// document itself, and pretending otherwise with a half-working preview
// would be worse than handing it to the program built for it.
//
// Two ways, in order:
//
// 1. A real "open with": Android's VIEW intent, pointed at a content:// URI
//    this app grants read access to. That is the one that lands IN Office,
//    on the document, rather than in a "share a copy" flow.
// 2. The share sheet, which is what this did before. It always works, and
//    it is what runs on a build that does not carry the intent launcher
//    (see the guarded require) - the feature simply improves when the app
//    is next built, and never breaks in the meantime.
//
// The URI is a path on whichever device added the file; anywhere else it
// points at nothing, so the Drive copy is fetched back first and we say so
// plainly when there is none.

// Required lazily and deliberately: an APK built before this module was
// added has no native side for it, and a top-level import there would
// crash the app on load rather than fall back.
function intentLauncher(): typeof import('expo-intent-launcher') | null {
  if (Platform.OS !== 'android') return null;
  try {
    return require('expo-intent-launcher');
  } catch {
    return null;
  }
}

// Whether the file's bytes are on this device - pulled back from Drive
// first if they are not, and said so plainly if they are nowhere. Shared
// by the quick look and the hand-off below, so both restore the same way.
export async function ensureFileIsHere(file: { fileUri: string; driveFileId?: string }): Promise<boolean> {
  const restored = await ensureLocalFile(file.fileUri, file.driveFileId).catch(() => false);
  if (!restored) {
    Alert.alert('Файл недоступний', 'Його немає на цьому пристрої, а копії на Google Диску теж немає.');
  }
  return restored;
}

export async function openFileExternally(file: {
  fileUri: string;
  fileName: string;
  mimeType?: string;
  driveFileId?: string;
}) {
  if (!(await ensureFileIsHere(file))) return;

  const launcher = intentLauncher();
  if (launcher) {
    try {
      const contentUri = await LegacyFileSystem.getContentUriAsync(file.fileUri);
      await launcher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        // FLAG_GRANT_READ_URI_PERMISSION: without it the app on the other
        // end is handed a URI it is not allowed to read.
        flags: 1,
        type: file.mimeType || undefined,
      });
      return;
    } catch {
      // No app on this phone opens that kind of file, or the intent was
      // refused - the share sheet below still gives the user somewhere to
      // send it.
    }
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    Alert.alert('Немає чим відкрити', 'На цьому пристрої не знайшлось застосунку для такого файлу.');
    return;
  }
  await Sharing.shareAsync(file.fileUri, { mimeType: file.mimeType, dialogTitle: file.fileName });
}
