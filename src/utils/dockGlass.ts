import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// «СКЛЯНИЙ ДОК» (2026-10-24, the user: «комбінацію 3 4 лише для доку і лише перемикачем, спочатку дивлюсь чи підходить,
// потім міряємо швидкодію»): a switch on this device, OFF by default. On, the soft dock wears the glass the user picked in
// September - the tags drawer's material (components/DockFrost) with the theme's own light (the black theme's glow); off,
// the soft opaque capsules as before. See components/DockGlassFill.
const KEY = 'settings.dockGlass';
let on = false;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((v) => {
      if (v === '1' && !on) {
        on = true;
        listeners.forEach((l) => l());
      }
    })
    .catch(() => {});
}

export function setDockGlass(next: boolean): void {
  on = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, next ? '1' : '0').catch(() => {});
}

export function useDockGlass(): boolean {
  load();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => on
  );
}
