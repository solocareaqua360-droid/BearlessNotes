import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { notify } from '../components/surfaces/Ask';

// Save a copy where the user can find it outside this app - the folder
// they pick once and the app remembers, through Android's own document
// tree permission (there is no writing into Downloads without it).
//
// Shared: photos and files both do this, and the "pick a folder once" part
// is the half that is easy to get subtly different.
const DOWNLOAD_DIR_STORAGE_KEY = 'bearlessNotes.downloadDirUri';

// The chosen folder, as something a person can read. Android hands back a
// document-tree URI, which is machine-readable and nothing else - the last
// segment of it is the only part that means anything, and even that is
// percent-encoded ("primary:Download/mindEva").
export async function currentDownloadFolder(): Promise<{ uri: string; label: string } | null> {
  const uri = await AsyncStorage.getItem(DOWNLOAD_DIR_STORAGE_KEY);
  if (!uri) return null;
  let label = uri;
  try {
    const tail = decodeURIComponent(uri.split('/').pop() ?? '');
    label = tail.replace(/^primary:/, '') || uri;
  } catch {
    // A name that will not decode is still better shown raw than not at
    // all.
  }
  return { uri, label };
}

// Ask for a folder now rather than at the next download - what the
// settings row uses to change it. Returns the new one, or null if the
// user backed out (and then the old one is left exactly as it was).
export async function chooseDownloadFolder(): Promise<{ uri: string; label: string } | null> {
  const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  await AsyncStorage.setItem(DOWNLOAD_DIR_STORAGE_KEY, permission.directoryUri);
  return currentDownloadFolder();
}

export async function downloadToFolder(
  uri: string,
  fileName: string,
  mimeType: string
): Promise<{ destUri: string; fileName: string } | null> {
  const stored = await AsyncStorage.getItem(DOWNLOAD_DIR_STORAGE_KEY);
  let dirUri = stored;
  if (!dirUri) {
    const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return null;
    dirUri = permission.directoryUri;
    await AsyncStorage.setItem(DOWNLOAD_DIR_STORAGE_KEY, dirUri);
  }
  // The extension is the OS's business here: it appends its own from the
  // mime type, so a name carrying one already would end up doubled.
  const base = fileName.replace(/\.[^./\\]+$/, '');
  const writeInto = async (targetDirUri: string) => {
    const destUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(targetDirUri, base, mimeType);
    const content = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    await LegacyFileSystem.writeAsStringAsync(destUri, content, { encoding: 'base64' });
    return destUri;
  };
  try {
    return { destUri: await writeInto(dirUri), fileName };
  } catch {
    // The folder granted earlier may have been revoked since (cleared from
    // Android's settings, say) - ask once more rather than fail silently
    // on every download from now on. The editor's own copy of this logic
    // had this branch and this one did not: the "subtly different" the
    // comment above warns about, now one implementation.
    const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return null;
    await AsyncStorage.setItem(DOWNLOAD_DIR_STORAGE_KEY, permission.directoryUri);
    return { destUri: await writeInto(permission.directoryUri), fileName };
  }
}


// Required lazily, for the same reason openFileExternally requires it
// lazily: an APK built before the module existed has no native side for
// it, and a top-level import there would take the app down on load
// rather than fall back.
function intentLauncher(): typeof import('expo-intent-launcher') | null {
  if (Platform.OS !== 'android') return null;
  try {
    return require('expo-intent-launcher');
  } catch {
    return null;
  }
}

// "Показати в папці" on the toast that follows a download.
//
// All three screens that offer it handed the SAF destination straight to
// Sharing.shareAsync - and that is a file:// API: given a document-tree
// content:// URI it throws, which one screen swallowed with an empty
// catch and the other two left as an unhandled rejection. Either way the
// button did nothing at all, on every download.
//
// What actually opens it is the VIEW intent - the very thing
// openFileExternally already does for a stored file - except that this
// URI is ALREADY a content:// one, so there is nothing to convert. The
// share sheet stays as the fallback for a build with no intent launcher,
// and a failure says so now instead of being silent.
export async function showDownloadedFile(uri: string, mimeType: string) {
  const launcher = intentLauncher();
  if (launcher) {
    try {
      await launcher.startActivityAsync('android.intent.action.VIEW', {
        data: uri,
        // FLAG_GRANT_READ_URI_PERMISSION: without it whatever opens on the
        // other end is handed a URI it is not allowed to read.
        flags: 1,
        type: mimeType || undefined,
      });
      return;
    } catch {
      // No app on the phone answers for this kind of file - the share
      // sheet below at least offers the ones that take anything.
    }
  }
  try {
    if (!(await Sharing.isAvailableAsync())) {
      notify('Не вдалося відкрити', 'На цьому пристрої немає застосунку, який відкриває такі файли.');
      return;
    }
    await Sharing.shareAsync(uri, { mimeType });
  } catch {
    notify('Не вдалося відкрити', 'Файл збережено, але відкрити його звідси не вийшло.');
  }
}
