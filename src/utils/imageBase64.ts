import * as LegacyFileSystem from 'expo-file-system/legacy';

// A picture's bytes as base64, for an export that has to carry them inside
// the HTML (documentBlocks buildDocumentHtml). The phone reads its own file.
export async function imageBase64(uri: string, _driveFileId?: string): Promise<string> {
  return LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}
