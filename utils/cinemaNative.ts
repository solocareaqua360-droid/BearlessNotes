import { requireOptionalNativeModule } from "expo";

// Cinema's own native module (modules/cinema-native). Optional on purpose:
// an APK built before it existed has no such module, and an over-the-air
// update must keep working there - every caller falls back to doing nothing.
type CinemaNative = {
  pip?: boolean;
  isPipActive?(): boolean;
  setAutoPip?(enabled: boolean, w: number, h: number): boolean;
  pipControls?: boolean;
  configurePip?(armed: boolean, playing: boolean, w: number, h: number): boolean;
  enterPip?(w: number, h: number): boolean;
  addListener?(event: "onPipChanged", cb: (e: { active: boolean }) => void): { remove(): void };
  addListener?(event: "onPipAction", cb: (e: { action: string }) => void): { remove(): void };
};

const native = requireOptionalNativeModule<CinemaNative>("CinemaNative");

export const supportsPip = !!native?.pip;

export function enterPip(w: number, h: number): boolean {
  try {
    return !!native?.enterPip?.(w, h);
  } catch {
    return false;
  }
}

// `armed` = a video is playing, so leaving the app makes the small window;
// `playing` picks the play/pause button's icon. An APK without the window's
// buttons still gets the older "leave = window" call.
export function configurePip(armed: boolean, playing: boolean, w: number, h: number): boolean {
  try {
    if (native?.configurePip) return !!native.configurePip(armed, playing, w, h);
    return !!native?.setAutoPip?.(armed, w, h);
  } catch {
    return false;
  }
}

export function onPipAction(cb: (action: "back" | "toggle" | "fwd") => void): () => void {
  try {
    const sub = (native as any)?.addListener?.("onPipAction", (e: { action: string }) => cb(e.action as any));
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}

export function setAutoPip(enabled: boolean, w: number, h: number): boolean {
  try {
    return !!native?.setAutoPip?.(enabled, w, h);
  } catch {
    return false;
  }
}

export function onPipChanged(cb: (active: boolean) => void): () => void {
  try {
    const sub = native?.addListener?.("onPipChanged", (e) => cb(!!e.active));
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}
