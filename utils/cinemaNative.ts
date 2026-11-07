import { requireOptionalNativeModule } from "expo";

// Cinema's own native module (modules/cinema-native). Optional on purpose:
// an APK built before it existed has no such module, and an over-the-air
// update must keep working there - every caller falls back to doing nothing.
type CinemaNative = {
  pip?: boolean;
  isPipActive?(): boolean;
  setAutoPip?(enabled: boolean, w: number, h: number): boolean;
  enterPip?(w: number, h: number): boolean;
  addListener?(event: "onPipChanged", cb: (e: { active: boolean }) => void): { remove(): void };
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
