import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { doc, onSnapshot } from '../firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { DEFAULT_THEME_KEY, THEMES, liftStyle, type Lift, type Theme, type ThemeKey } from './tokens';
import type { ViewStyle } from 'react-native';
import { colorForDocument } from '../utils/documentColor';

// Which theme is on, and how a screen asks for it.
//
// Where the choice lives is two places on purpose. AsyncStorage is read
// first and synchronously enough that the app opens already in the right
// theme - offline, before any sign-in, on the very first frame; the app
// is a second brain and has to open instantly (see the offline-first
// memory). Firestore is the other half, so the phone and the browser
// agree without either being told twice.
const CACHE_KEY = 'appearance:theme';
const BACKDROP_CACHE_KEY = 'appearance:backdrop';
const PREFS_DOC = 'appearance';

// A user-chosen backdrop, replacing whatever the theme itself would
// draw - on request: "хочу можливість вибирати і налаштовувати
// кольоровий градієнт фону... також хочу мати можливість поставити
// свою картинку на фон і задати їй рівень блюру... вибрати через
// галочки в яких з тем застосовувати цей фон, а в якій залишити
// стандартний". ONE override, not one per theme - `appliesTo` is what
// decides which themes see it; a theme left out draws its own built-in
// backdrop exactly as before.
export type BackdropOverride =
  | { type: 'gradient'; colors: string[] } // 2 to 4 hex stops, top to bottom
  | {
      type: 'image';
      // A STABLE local path (not the picker's own temp file - see
      // setBackdropImage) so useCachedAttachment can restore it from
      // Drive on a device that never picked it itself.
      uri: string;
      driveFileId?: string;
      // 0-100, mapped to Image's own blurRadius at the drawing end -
      // kept as a plain percentage here since that is what the slider
      // in Settings actually shows.
      blur: number;
    };

export type BackdropSettings = {
  override: BackdropOverride | null;
  appliesTo: ThemeKey[];
};

const DEFAULT_BACKDROP_SETTINGS: BackdropSettings = { override: null, appliesTo: [] };

type ThemeContextValue = {
  theme: Theme;
  themeKey: ThemeKey;
  setThemeKey: (next: ThemeKey) => void;
  backdropSettings: BackdropSettings;
  setBackdropSettings: (next: BackdropSettings) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[DEFAULT_THEME_KEY],
  themeKey: DEFAULT_THEME_KEY,
  setThemeKey: () => {},
  backdropSettings: DEFAULT_BACKDROP_SETTINGS,
  setBackdropSettings: () => {},
});

function isThemeKey(value: unknown): value is ThemeKey {
  return value === 'colour' || value === 'white' || value === 'black';
}

function isBackdropSettings(value: unknown): value is BackdropSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.appliesTo) || !v.appliesTo.every(isThemeKey)) return false;
  if (v.override === null) return true;
  const o = v.override as Record<string, unknown>;
  if (o?.type === 'gradient') return Array.isArray(o.colors) && o.colors.every((c) => typeof c === 'string');
  if (o?.type === 'image') return typeof o.uri === 'string' && typeof o.blur === 'number';
  return false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeKey, setKey] = useState<ThemeKey>(DEFAULT_THEME_KEY);
  const [backdropSettings, setBackdropState] = useState<BackdropSettings>(DEFAULT_BACKDROP_SETTINGS);

  // The cache first, so the first frame is already right.
  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((stored) => {
        if (isThemeKey(stored)) setKey(stored);
      })
      .catch(() => undefined);
    AsyncStorage.getItem(BACKDROP_CACHE_KEY)
      .then((stored) => {
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (isBackdropSettings(parsed)) setBackdropState(parsed);
      })
      .catch(() => undefined);
  }, []);

  // Then the account's own answer, which wins - it is the one both
  // devices see. The second callback is not optional: under the
  // owner-only rules a refused read THROWS, and an unhandled one takes
  // the app down with it (see the silent-empty memory).
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'settings', PREFS_DOC),
        (snapshot) => {
          const stored = snapshot.data()?.theme;
          if (isThemeKey(stored)) {
            setKey(stored);
            AsyncStorage.setItem(CACHE_KEY, stored).catch(() => undefined);
          }
          const backdrop = snapshot.data()?.backdrop;
          if (isBackdropSettings(backdrop)) {
            setBackdropState(backdrop);
            AsyncStorage.setItem(BACKDROP_CACHE_KEY, JSON.stringify(backdrop)).catch(() => undefined);
          }
        },
        () => undefined
      ),
    []
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: THEMES[themeKey],
      themeKey,
      setThemeKey: (next: ThemeKey) => {
        // On screen at once, remembered locally, and only then sent -
        // a theme switch that waited for the network would feel broken.
        setKey(next);
        AsyncStorage.setItem(CACHE_KEY, next).catch(() => undefined);
        setDoc(doc(db, 'settings', PREFS_DOC), { theme: next }, { merge: true }).catch(() => undefined);
      },
      backdropSettings,
      setBackdropSettings: (next: BackdropSettings) => {
        setBackdropState(next);
        AsyncStorage.setItem(BACKDROP_CACHE_KEY, JSON.stringify(next)).catch(() => undefined);
        setDoc(doc(db, 'settings', PREFS_DOC), { backdrop: next }, { merge: true }).catch(() => undefined);
      },
    }),
    [themeKey, backdropSettings]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeChoice() {
  const { themeKey, setThemeKey } = useContext(ThemeContext);
  return { themeKey, setThemeKey };
}

// The custom backdrop - see BackdropOverride. `usesCustomBackdrop`
// (below, read by ScreenBackdrop) is the one thing most callers
// actually need; this is for the Settings screen that edits it.
export function useBackdropSettings() {
  const { backdropSettings, setBackdropSettings } = useContext(ThemeContext);
  return { backdropSettings, setBackdropSettings };
}

// What ScreenBackdrop actually asks: does THIS theme use the custom
// backdrop, and if so, what is it.
export function useActiveBackdropOverride(): BackdropOverride | null {
  const { theme, backdropSettings } = useContext(ThemeContext);
  if (!backdropSettings.override) return null;
  return backdropSettings.appliesTo.includes(theme.key) ? backdropSettings.override : null;
}

// What makes converting a file mechanical: the same StyleSheet.create a
// screen already has, handed the theme, and rebuilt only when the theme
// actually changes.
//
//   const styles = useStyles((t) => StyleSheet.create({
//     card: { backgroundColor: t.surface, borderColor: t.edge.hairline },
//   }));
// The theme's own answer to "lift this off the ground", ready to drop
// into a style array. `how` overrides it for the rare surface that must
// not lift (a card BEHIND another one in a stack, where three glows
// read as fog rather than as three lit objects).
export function useLift(how?: Lift | 'none'): ViewStyle {
  const theme = useTheme();
  return useMemo(() => liftStyle(theme, how ?? theme.lift), [theme, how]);
}

export function useStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme]);
}

// A record's colours, bound to the theme once per component.
//
// Returns the FUNCTION rather than the colours: half the call sites are
// inside a list's render callback, where a hook may not be called, and
// this way both kinds of site use exactly the same line.
export function useRecordColour() {
  const theme = useTheme();
  return useMemo(() => (id: string) => colorForDocument(id, theme), [theme]);
}

// The clock and the battery. `style="auto"` follows the SYSTEM's light or
// dark setting, which is not the same question: in the white theme on a
// phone set to dark, the status bar drew white on white. It follows the
// app's own theme now.
export function ThemedStatusBar() {
  const theme = useTheme();
  return <StatusBar style={theme.scheme === 'light' ? 'dark' : 'light'} />;
}
