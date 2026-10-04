import * as Updates from 'expo-updates';

// App-only (not part of src/sketch): the in-app update, driven by the
// settings sheet. Checks the EAS Update channel, downloads, restarts.
export type UpdateResult = 'disabled' | 'latest' | 'ready';

export async function checkAndFetchUpdate(): Promise<UpdateResult> {
  if (!Updates.isEnabled) return 'disabled';
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return 'latest';
  await Updates.fetchUpdateAsync();
  return 'ready';
}

export const restartApp = () => Updates.reloadAsync();

// What the settings sheet shows as «версія збірки».
export function buildInfo(version: string): { version: string; update: string; date: string | null } {
  const id = Updates.updateId;
  return {
    version,
    update: id ? id.slice(0, 8) : 'вбудована',
    date: Updates.createdAt ? formatStamp(Updates.createdAt.getTime()) : null,
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');
// 04.10.26 13:47
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
