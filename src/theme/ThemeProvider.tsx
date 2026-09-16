import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from '../firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { DEFAULT_THEME_KEY, THEMES, type Theme, type ThemeKey } from './tokens';

// Which theme is on, and how a screen asks for it.
//
// Where the choice lives is two places on purpose. AsyncStorage is read
// first and synchronously enough that the app opens already in the right
// theme - offline, before any sign-in, on the very first frame; the app
// is a second brain and has to open instantly (see the offline-first
// memory). Firestore is the other half, so the phone and the browser
// agree without either being told twice.
const CACHE_KEY = 'appearance:theme';
const PREFS_DOC = 'appearance';

type ThemeContextValue = {
  theme: Theme;
  themeKey: ThemeKey;
  setThemeKey: (next: ThemeKey) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[DEFAULT_THEME_KEY],
  themeKey: DEFAULT_THEME_KEY,
  setThemeKey: () => {},
});

function isThemeKey(value: unknown): value is ThemeKey {
  return value === 'colour' || value === 'white' || value === 'black';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeKey, setKey] = useState<ThemeKey>(DEFAULT_THEME_KEY);

  // The cache first, so the first frame is already right.
  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((stored) => {
        if (isThemeKey(stored)) setKey(stored);
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
    }),
    [themeKey]
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

// What makes converting a file mechanical: the same StyleSheet.create a
// screen already has, handed the theme, and rebuilt only when the theme
// actually changes.
//
//   const styles = useStyles((t) => StyleSheet.create({
//     card: { backgroundColor: t.surface, borderColor: t.edge.hairline },
//   }));
export function useStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme]);
}
