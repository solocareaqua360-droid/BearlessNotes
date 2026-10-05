import { requireOptionalNativeModule } from 'expo';

// The app's own native module (modules/mindeva-native). Optional on
// purpose: an APK built before it existed has no such module, and an
// over-the-air update must keep working there - every caller falls back
// to what the app did before.
type MindevaNative = {
  wallpaperWindow?: boolean;
  ensureAlarmChannel(id: string, name: string, description: string): boolean;
  setWindowBlur?(radius: number): boolean;
  screenCapture?: boolean;
  startScreenCapture?(): Promise<boolean>;
  grabScreenFrame?(x: number, y: number, w: number, h: number): Promise<{ uri: string; width: number; height: number } | null>;
  isScreenCapturing?(): boolean;
  stopScreenCapture?(): boolean;
  windowCopy?: boolean;
  copyWindowRect?(
    x: number,
    y: number,
    w: number,
    h: number,
    maxWidth: number,
    quality: number
  ): Promise<{ uri: string; width: number; height: number } | null>;
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

// FRAMES FROM A PLAYING VIDEO (modules/mindeva-native's ScreenCapture.kt):
// Android's own screen capture. Only in an APK that has it.
export const supportsScreenCapture = !!native?.screenCapture;

// Asks the phone (its own dialog) the first time; true once frames can be
// taken. Resolves false if declined or impossible.
export async function startScreenCapture(): Promise<boolean> {
  try {
    if (native?.isScreenCapturing?.()) return true;
    // Never waits for ever: the phone's dialog may be dismissed without an
    // answer reaching us.
    return !!(await Promise.race([
      native?.startScreenCapture?.(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30000)),
    ]));
  } catch {
    return false;
  }
}

// The newest frame, cut to a rectangle in SCREEN PIXELS (w <= 0: whole
// screen) - a JPEG file in the cache, or null.
export async function grabScreenFrame(rect?: { x: number; y: number; w: number; h: number }) {
  try {
    const r = rect ?? { x: 0, y: 0, w: 0, h: 0 };
    return (await native?.grabScreenFrame?.(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))) ?? null;
  } catch {
    return null;
  }
}

export function stopScreenCapture() {
  try {
    native?.stopScreenCapture?.();
  } catch {
    // Nothing to stop.
  }
}

// A PICTURE OF WHAT IS ALREADY ON SCREEN (MindevaNativeModule's
// copyWindowRect): Android's PixelCopy, off the UI thread - the cheap way
// to photograph a desk. Only in an APK that has it; callers fall back to
// react-native-view-shot otherwise. The rectangle is in WINDOW PIXELS.
export const supportsWindowCopy = !!native?.windowCopy && typeof native?.copyWindowRect === 'function';

export async function copyWindowRect(
  rect: { x: number; y: number; w: number; h: number },
  maxWidth = 0,
  quality = 70
): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    return (
      (await native?.copyWindowRect?.(
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.w),
        Math.round(rect.h),
        Math.round(maxWidth),
        Math.round(quality)
      )) ?? null
    );
  } catch {
    return null;
  }
}
