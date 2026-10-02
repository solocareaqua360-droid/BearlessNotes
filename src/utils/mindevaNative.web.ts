// The browser has neither: no window wallpaper, no alarm channels.
export const supportsWallpaper = false;

export function ensureNativeAlarmChannel(_id: string, _name: string, _description: string): boolean {
  return false;
}

export const supportsWindowBlur = false;

export function setWindowBlur(_radius: number): boolean {
  return false;
}
