import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';

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
