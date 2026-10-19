import { requireOptionalNativeModule } from 'expo';
import { FEATURES } from '../features';

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
  chipSpans?: boolean;
  configureChipSpans?(fill: number, mark: number, radius: number, padX: number, padTop: number, padBottom: number): boolean;
  attachChipField?(viewTag: number): Promise<boolean>;
  setNavigationBarContrast?(enforced: boolean): boolean;
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
// Put away for now (features.ts): every «Кадр» button reads this.
export const supportsScreenCapture = FEATURES.videoFrames && !!native?.screenCapture;

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

// A NOTE LINK WHILE TYPING, ROUNDED (MindevaNativeModule's ChipSpans): a
// field's run whose background has exactly this alpha is drawn by the APK
// as a rounded chip, a little wider than its letters, filled with the same
// colour at CHIP_FILL_ALPHA. No colour the user picks carries it. Only in
// an APK that has it - elsewhere the run keeps its plain tint.
export const CHIP_MARK_ALPHA = 0x0b;
const CHIP_FILL_ALPHA = 0x24;
export const supportsChipSpans = !!native?.chipSpans && typeof native?.attachChipField === 'function';

// The chip's look in dp - the same numbers as the chip at rest
// (FormattedText's chipStyles), so the two read as one thing.
export const CHIP_LOOK = { radius: 7, padX: 5, padTop: 0.5, padBottom: 0 };

let chipSpansConfigured = false;

// Names one field to the APK by its view tag: from then on its marked runs
// are drawn rounded, on every change of its text (native side: a watcher on
// the field). Once per field is enough.
export function attachChipField(viewTag: number | null): void {
  if (!supportsChipSpans || viewTag == null) return;
  try {
    if (!chipSpansConfigured) {
      chipSpansConfigured = !!native?.configureChipSpans?.(
        CHIP_FILL_ALPHA,
        CHIP_MARK_ALPHA,
        CHIP_LOOK.radius,
        CHIP_LOOK.padX,
        CHIP_LOOK.padTop,
        CHIP_LOOK.padBottom
      );
    }
    native?.attachChipField?.(viewTag)?.catch(() => {});
  } catch {
    // An APK without it: the run keeps its plain tint.
  }
}

// The pale band Android lays over the navigation bar's area (seen at the
// foot of the Fold's inner screen): off, where this APK can ask for it.
export function setNavigationBarContrast(enforced: boolean): boolean {
  try {
    return !!native?.setNavigationBarContrast?.(enforced);
  } catch {
    return false;
  }
}
