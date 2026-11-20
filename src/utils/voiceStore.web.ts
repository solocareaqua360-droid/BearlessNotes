// THE VOICED PIECES IN THE BROWSER / ON THE MAC (see voiceStore.ts): no app folder to write to, so each piece is kept
// in memory for this session as a data: URL - what the web audio player plays. A reload voices it again.
const kept = new Map<string, { uri: string; size: number; at: number }>();
const byUri = new Map<string, string>();

export function uriOf(key: string): string {
  return kept.get(key)?.uri ?? '';
}

export async function exists(key: string): Promise<boolean> {
  return kept.has(key);
}

export async function sizeOf(uri: string): Promise<number | null> {
  const key = byUri.get(uri);
  return key ? kept.get(key)?.size ?? null : null;
}

export async function write(key: string, base64: string): Promise<string> {
  const uri = `data:audio/wav;base64,${base64}`;
  // A base64 string of n characters holds about 3/4 n bytes.
  const size = Math.floor((base64.length * 3) / 4);
  kept.set(key, { uri, size, at: Date.now() });
  byUri.set(uri, key);
  return uri;
}

export async function list(): Promise<{ uri: string; size: number; at: number }[]> {
  return [...kept.values()];
}

export async function remove(uri: string): Promise<void> {
  const key = byUri.get(uri);
  if (!key) return;
  kept.delete(key);
  byUri.delete(uri);
}
