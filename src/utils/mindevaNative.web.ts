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

// No window to copy in a browser.
export const supportsWindowCopy = false;
export async function copyWindowRect(
  _rect: { x: number; y: number; w: number; h: number },
  _maxWidth = 0,
  _quality = 70
): Promise<{ uri: string; width: number; height: number } | null> {
  return null;
}

// A browser draws its own text: no rounded runs to ask for, no navigation bar.
export const CHIP_MARK_ALPHA = 0x0b;
export const supportsChipSpans = false;
export const CHIP_LOOK = { radius: 7, padX: 5, padTop: 0.5, padBottom: 0 };
export function attachChipField(_viewTag: number | null): void {}
export function setNavigationBarContrast(_enforced: boolean): boolean {
  return false;
}
