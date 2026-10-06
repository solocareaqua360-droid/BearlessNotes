import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// SWITCHES FOR FINDING A FREEZE BY ELIMINATION (2026-10-06, temporary).
// After a note is closed the app stands still for about a second, in some
// closings, and no measurement from JS says what holds it. Each switch
// turns one suspect off; the diagnostics window flips them, the user closes
// a few notes, and the freeze either goes or it does not.
export type ExperimentKey = 'noBlur' | 'noNoteMorph' | 'noPreviews' | 'noChromePhotos' | 'noDeskShots';

export const experiments: Record<ExperimentKey, boolean> = {
  noBlur: false,
  noNoteMorph: false,
  noPreviews: false,
  noChromePhotos: false,
  noDeskShots: false,
};

export const EXPERIMENT_LABELS: Record<ExperimentKey, string> = {
  noBlur: 'Живе розмиття (смужка, док, кнопки, рядок проєктів)',
  noNoteMorph: 'Морф нотатки (прозорий екран + складання), як у дошок без нього',
  noPreviews: 'Усі прев\'ю (сторінки в картках, дні, дошки, знімки столів)',
  noChromePhotos: 'Фото смужок і дока при переході',
  noDeskShots: 'Знімки столів для перемикача',
};

const STORE_KEY = 'mindeva.experiments';

const listeners = new Set<() => void>();
function announce() {
  listeners.forEach((l) => l());
}
export function subscribeExperiments(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
// For what draws differently with a switch: renders again when it flips (or
// when the saved switches arrive, a moment after start).
export function useExperiment(key: ExperimentKey): boolean {
  return useSyncExternalStore(subscribeExperiments, () => experiments[key], () => experiments[key]);
}

AsyncStorage.getItem(STORE_KEY)
  .then((raw) => {
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Record<ExperimentKey, boolean>>;
    (Object.keys(experiments) as ExperimentKey[]).forEach((k) => {
      if (typeof saved[k] === 'boolean') experiments[k] = saved[k] as boolean;
    });
    announce();
  })
  .catch(() => {});

export function toggleExperiment(key: ExperimentKey): boolean {
  experiments[key] = !experiments[key];
  AsyncStorage.setItem(STORE_KEY, JSON.stringify(experiments)).catch(() => {});
  announce();
  return experiments[key];
}
