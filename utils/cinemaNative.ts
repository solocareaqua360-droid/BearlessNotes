import { requireOptionalNativeModule } from "expo";
import { PermissionsAndroid, Platform } from "react-native";

// Cinema's own native module (modules/cinema-native). Optional on purpose:
// an APK built before it existed has no such module, and an over-the-air
// update must keep working there - every caller falls back to doing nothing.
type CinemaNative = {
  pip?: boolean;
  isPipActive?(): boolean;
  setAutoPip?(enabled: boolean, w: number, h: number): boolean;
  pipControls?: boolean;
  mediaService?: boolean;
  webEval?(script: string): boolean;
  mediaStart?(title: string, playing: boolean): boolean;
  mediaStop?(): boolean;
  configurePip?(armed: boolean, playing: boolean, w: number, h: number): boolean;
  enterPip?(w: number, h: number): boolean;
  addListener?(event: "onPipChanged", cb: (e: { active: boolean }) => void): { remove(): void };
  addListener?(event: "onPipAction", cb: (e: { action: string }) => void): { remove(): void };
};

const native = requireOptionalNativeModule<CinemaNative>("CinemaNative");

export const supportsPip = !!native?.pip;
export const supportsMedia = !!native?.mediaService;

// A script into the player's page right away, even with the app in the small
// window or the screen locked (React Native's own injectJavaScript waits for
// a frame that never comes then). false = this APK cannot, use the bridge.
export function webEval(script: string): boolean {
  try {
    return !!native?.webEval?.(script);
  } catch {
    return false;
  }
}

// The background player: a notification with the buttons (also on the lock
// screen) and a service that keeps the sound going with the screen off.
export function mediaStart(title: string, playing: boolean): boolean {
  try {
    return !!native?.mediaStart?.(title, playing);
  } catch {
    return false;
  }
}

export function mediaStop(): boolean {
  try {
    return !!native?.mediaStop?.();
  } catch {
    return false;
  }
}

// Android 13+ asks before showing any notification, the player's included.
export async function requestNotificationPermission(): Promise<void> {
  try {
    if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as any);
    }
  } catch {
    // The player still plays; only its notification stays hidden.
  }
}

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

export function onPipAction(cb: (action: "back" | "toggle" | "fwd" | "play" | "pause") => void): () => void {
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
