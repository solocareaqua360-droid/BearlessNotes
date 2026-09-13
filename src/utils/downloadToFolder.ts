import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';

// Save a copy where the user can find it outside this app - the folder
// they pick once and the app remembers, through Android's own document
// tree permission (there is no writing into Downloads without it).
//
// Shared: photos and files both do this, and the "pick a folder once" part
// is the half that is easy to get subtly different.
const DOWNLOAD_DIR_STORAGE_KEY = 'bearlessNotes.downloadDirUri';

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
  const destUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(dirUri, base, mimeType);
  const content = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  await LegacyFileSystem.writeAsStringAsync(destUri, content, { encoding: 'base64' });
  return { destUri, fileName };
}
