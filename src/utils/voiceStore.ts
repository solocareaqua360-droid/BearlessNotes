import * as FileSystem from 'expo-file-system/legacy';

// WHERE THE VOICED PIECES ARE KEPT (2026-10-16, split out of thoughtVoice for the Mac): on the phone, .wav files in
// the app's own folder - they outlive a restart, so a listened thought plays again offline. The browser/Mac build
// keeps them in memory instead (voiceStore.web.ts). Keys are file names; `uriOf` is what a player is handed.
const DIR = `${FileSystem.documentDirectory}thought-voice/`;

export function uriOf(key: string): string {
  return DIR + key;
}

export async function exists(key: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(DIR + key).catch(() => ({ exists: false }));
  return info.exists;
}

// The bytes of a kept voice, by the uri a player was handed (null: not there).
export async function sizeOf(uri: string): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return info?.exists && 'size' in info && info.size ? info.size : null;
}

export async function write(key: string, base64: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(DIR + key, base64, { encoding: FileSystem.EncodingType.Base64 });
  return DIR + key;
}

export async function list(): Promise<{ uri: string; size: number; at: number }[]> {
  try {
    const names = await FileSystem.readDirectoryAsync(DIR);
    const infos = await Promise.all(names.map(async (n) => ({ n, i: await FileSystem.getInfoAsync(`${DIR}${n}`) })));
    return infos
      .filter((x) => x.i.exists)
      .map((x) => ({ uri: `${DIR}${x.n}`, size: (x.i as { size?: number }).size ?? 0, at: (x.i as { modificationTime?: number }).modificationTime ?? 0 }));
  } catch {
    return [];
  }
}

export async function remove(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
