import AsyncStorage from '@react-native-async-storage/async-storage';

// SWITCHES FOR FINDING A FREEZE BY ELIMINATION (2026-10-06, temporary).
// After a note is closed the app stands still for about a second, in some
// closings, and no measurement from JS says what holds it. Each switch
// turns one suspect off; the diagnostics window flips them, the user closes
// a few notes, and the freeze either goes or it does not.
export type ExperimentKey = 'noChromePhotos' | 'noDeskShots';

export const experiments: Record<ExperimentKey, boolean> = {
  noChromePhotos: false,
  noDeskShots: false,
};

export const EXPERIMENT_LABELS: Record<ExperimentKey, string> = {
  noChromePhotos: 'Фото смужок і дока при переході',
  noDeskShots: 'Знімки столів для перемикача',
};

const STORE_KEY = 'mindeva.experiments';

AsyncStorage.getItem(STORE_KEY)
  .then((raw) => {
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Record<ExperimentKey, boolean>>;
    (Object.keys(experiments) as ExperimentKey[]).forEach((k) => {
      if (typeof saved[k] === 'boolean') experiments[k] = saved[k] as boolean;
    });
  })
  .catch(() => {});

export function toggleExperiment(key: ExperimentKey): boolean {
  experiments[key] = !experiments[key];
  AsyncStorage.setItem(STORE_KEY, JSON.stringify(experiments)).catch(() => {});
  return experiments[key];
}
