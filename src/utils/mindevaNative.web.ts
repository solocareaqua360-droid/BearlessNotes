// The browser has neither: no window wallpaper, no alarm channels.
export const supportsWallpaper = false;

export function ensureNativeAlarmChannel(_id: string, _name: string, _description: string): boolean {
  return false;
}

export const supportsWindowBlur = false;

export function setWindowBlur(_radius: number): boolean {
  return false;
}

// No screen capture in a browser - the board shows no «Кадр» button.
export const supportsScreenCapture = false;
export async function startScreenCapture(): Promise<boolean> {
  return false;
}
export async function grabScreenFrame(_rect?: { x: number; y: number; w: number; h: number }): Promise<{ uri: string; width: number; height: number } | null> {
  return null;
}
export function stopScreenCapture() {}
