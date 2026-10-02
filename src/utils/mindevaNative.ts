import { requireOptionalNativeModule } from 'expo';

// The app's own native module (modules/mindeva-native). Optional on
// purpose: an APK built before it existed has no such module, and an
// over-the-air update must keep working there - every caller falls back
// to what the app did before.
type MindevaNative = {
  wallpaperWindow?: boolean;
  ensureAlarmChannel(id: string, name: string, description: string): boolean;
  setWindowBlur?(radius: number): boolean;
};

const native = requireOptionalNativeModule<MindevaNative>('MindevaNative');

// The window can show the phone's wallpaper (plugins/withWallpaperWindow).
export const supportsWallpaper = !!native?.wallpaperWindow;

// An alarm channel on Android's ALARM audio stream - false where this APK
// cannot make one.
export function ensureNativeAlarmChannel(id: string, name: string, description: string): boolean {
  try {
    return !!native?.ensureAlarmChannel(id, name, description);
  } catch {
    return false;
  }
}

// The wallpaper's blur, in px - false where this APK or this phone
// cannot draw it (see the native side).
export const supportsWindowBlur = typeof native?.setWindowBlur === 'function';

export function setWindowBlur(radius: number): boolean {
  try {
    return !!native?.setWindowBlur?.(Math.round(radius));
  } catch {
    return false;
  }
}
