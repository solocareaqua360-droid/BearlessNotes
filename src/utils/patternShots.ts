import { useEffect, useState } from 'react';

// THE FOLDER COVERS' PATTERNS AS PICTURES (2026-10-12). A cover's pattern is ~260 icons, ~800 vector shapes: the
// phone had to build them and draw them again on every frame of a folder's opening - the user felt it at once
// («фон без патерна плавний, як ніби фарбу розлили... а з патерном ніби лук натягують і він вистрелює»). So each
// pattern is drawn as shapes ONCE, photographed (react-native-view-shot), and from then on shown as one picture -
// as cheap to grow as a plain colour. Kept for the session; the key names everything the drawing depends on.

const shots = new Map<string, string>();
const listeners = new Set<() => void>();
const taking = new Set<string>();

export function patternShot(key: string): string | undefined {
  return shots.get(key);
}

export function putPatternShot(key: string, uri: string): void {
  shots.set(key, uri);
  taking.delete(key);
  listeners.forEach((l) => l());
}

// Whether a photograph of this key is already being taken (only one per key).
export function claimPatternShot(key: string): boolean {
  if (shots.has(key) || taking.has(key)) return false;
  taking.add(key);
  return true;
}

export function releasePatternClaim(key: string): void {
  taking.delete(key);
}

export function usePatternShot(key: string | null): string | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key || shots.has(key)) return;
    const listener = () => {
      if (shots.has(key)) bump((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);
  return key ? shots.get(key) : undefined;
}
