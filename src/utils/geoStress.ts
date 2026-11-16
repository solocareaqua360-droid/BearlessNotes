import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

// A STRESS TEST THAT WRITES NOTHING (2026-11-16, before ~1600 points come in from a table; the user: «кожен тест 3200, а
// вийти може і не з 10 разу»). `mindeva://geo-stress?n=1600` puts that many made-up points into the geo base's list ON
// THIS PHONE, in memory only - never in Firestore, never in a folder, gone with `n=0` or a restart. Opened from a
// computer (adb), so no one meets it in a menu.
let count = 0;
const listeners = new Set<(n: number) => void>();

function handle(url: string | null) {
  if (!url || !url.startsWith('mindeva://geo-stress')) return;
  const n = Number(/[?&]n=(\d+)/.exec(url)?.[1] ?? 0);
  count = Math.max(0, Math.min(5000, n));
  listeners.forEach((l) => l(count));
}
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  Linking.getInitialURL().then(handle).catch(() => {});
  Linking.addEventListener('url', ({ url }) => handle(url));
}

export function useGeoStress(): number {
  const [n, setN] = useState(count);
  useEffect(() => {
    wire();
    listeners.add(setN);
    setN(count);
    return () => {
      listeners.delete(setN);
    };
  }, []);
  return n;
}

// Made-up points spread over Ukraine, the same ones every time (a fixed seed), so a second run finds its pictures kept.
export function stressPoints(n: number) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const day = Date.UTC(2026, 10, 1);
  return Array.from({ length: n }, (_, i) => {
    const lat = 45.5 + rnd() * 6;
    const lng = 23.5 + rnd() * 16;
    return {
      id: `stress-${i}`,
      url: `https://www.google.com/maps?q=${lat.toFixed(5)},${lng.toFixed(5)}`,
      title: `Тестова точка ${i + 1}`,
      siteName: 'Геоточка',
      documentIds: [] as string[],
      tagIds: [] as string[],
      updatedAt: day - i * 60000,
      createdAt: day - i * 60000,
      geoLat: lat,
      geoLng: lng,
    };
  });
}
