import { Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import { ensureLocalFile } from './googleDrive';

// Hand a stored file to the OS "open with" sheet. The URI is a path on
// whichever device added the file; anywhere else it points at nothing, so
// the Drive copy is pulled back first - and if there is none, we say so
// rather than opening nothing silently.
export async function openFileExternally(file: {
  fileUri: string;
  fileName: string;
  mimeType?: string;
  driveFileId?: string;
}) {
  const available = await Sharing.isAvailableAsync();
  if (!available) return;
  const restored = await ensureLocalFile(file.fileUri, file.driveFileId).catch(() => false);
  if (!restored) {
    Alert.alert('Файл недоступний', 'Його немає на цьому пристрої, а копії на Google Диску теж немає.');
    return;
  }
  await Sharing.shareAsync(file.fileUri, { mimeType: file.mimeType, dialogTitle: file.fileName });
}
