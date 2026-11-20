import { useId, useSyncExternalStore } from 'react';
import type { MenuEntry } from '../components/surfaces/Menu';
import { navigationRef } from '../navigationRef';
import { useWhileFocused } from './navDock';

// THE ACCOUNT CIRCLE (2026-11-07, the user's, agreed through three sketches in reports/sketch-account-*.png): at the top
// left of the ROOT screens (Старт, Календар, Щоденник) stands a round button with the account's icon; it opens a small
// window with the settings that used to hang in the «⋯» of the bases screen («Налаштування» -> «Діагностика»).
//
// It is a bus of its own rather than one more claim in navDock: a screen says "I am a root, draw the circle" while it is
// in front, and the bar reads one yes/no. Several screens can stand in front at once (a layer over a desk), so it is a
// set of ids, not a flag.
//
// STEP 1 of the plan only: the circle on the three roots and the window. The rest of the plan (the circle turning into
// «‹ назад» inside a folder / an item / a database, the sections redrawn light, the bases screen moving inside Старт)
// comes after, one piece at a time - and the old «Налаштування» in the bases' «⋯» stays until the user says to take it away.
const claims = new Set<string>();
const listeners = new Set<() => void>();
let snapshot = false;

function emit() {
  const next = claims.size > 0;
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Called by a root screen: the circle is drawn while the screen is in front and `enabled`.
export function useTopAccount(enabled = true) {
  const id = useId();
  useWhileFocused(() => {
    if (!enabled) return;
    claims.add(id);
    emit();
    return () => {
      claims.delete(id);
      emit();
    };
  }, [enabled, id]);
}

// Read by the bar.
export function useTopAccountOn(): boolean {
  return useSyncExternalStore(subscribe, () => snapshot, () => false);
}

// The window's rows: the five sections of the settings screen (it already takes `section`, so each opens straight on
// its page), a rule, and «Діагностика» sixth (the user: «6 пунктом в кружечок акаунту»).
export function accountMenuEntries(): MenuEntry[] {
  const section = (s: 'account' | 'backup' | 'appearance' | 'integrations' | 'about') => () => {
    if (navigationRef.isReady()) navigationRef.navigate('Settings', { section: s });
  };
  return [
    { label: 'Обліковий запис', icon: 'person-circle-outline', onPress: section('account') },
    { label: 'Резервна копія', icon: 'cloud-upload-outline', onPress: section('backup') },
    { label: 'Зовнішній вигляд', icon: 'color-palette-outline', onPress: section('appearance') },
    { label: 'Інтеграції', icon: 'key-outline', onPress: section('integrations') },
    { label: 'Про застосунок', icon: 'information-circle-outline', onPress: section('about') },
    { kind: 'rule' },
    {
      label: 'Діагностика',
      icon: 'pulse-outline',
      // Required at the moment of the tap: a bar importing a whole screen at load is a circle of imports.
      onPress: () => {
        void (require('../screens/DocumentsScreen') as typeof import('../screens/DocumentsScreen')).showDiagnostics();
      },
    },
  ];
}
