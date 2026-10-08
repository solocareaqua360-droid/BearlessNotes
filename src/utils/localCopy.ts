import { Platform } from 'react-native';
import * as LegacyFileSystem from 'expo-file-system/legacy';

// A picked file, kept where this app can find it again. On the phone it is
// copied into the app's cache (the picker's own address can be revoked by
// whoever handed it over). In a browser - the Mac app is one - there is no
// file system to copy into: `copyAsync` does not exist there, and the
// picker's address (a blob: URL) is already what googleDrive.web reads and
// keeps for the upload. So there the address is used as it is (2026-10-08,
// «copyAsync is not available on web» in the Mac chat).
export async function copyPickedFile(from: string, id: string, name: string): Promise<string> {
  if (Platform.OS === 'web') return from;
  const to = `${LegacyFileSystem.cacheDirectory}${id}-${name}`;
  await LegacyFileSystem.copyAsync({ from, to });
  return to;
}
