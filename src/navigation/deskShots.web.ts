import type { View } from 'react-native';

// The browser has no desks (it keeps its own tabs), so nothing is
// photographed - see deskShots.ts.
export function registerDeskNode(_key: string, _node: View | null) {}
export async function captureDesk(_key: string): Promise<void> {}
export function forgetDesk(_key: string) {}
export function useDeskShots(): Record<string, string> {
  return {};
}
export async function captureAllDesks(): Promise<void> {}
export function setCurrentDesk(_key: string | null) {}
export function setDeskCapturePaused(_on: boolean) {}
export function noteDeskTouched(_key: string) {}
