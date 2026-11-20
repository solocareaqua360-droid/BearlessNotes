import { useColorScheme } from 'react-native';
import { useLibraryStore } from '../store/useLibraryStore';

// «М'ЯКИЙ» - viBo wears mindEva's soft style. Light where the theme is
// light, true black where it is dark. Depth comes from tone, never from an
// outline: a barely-there shadow on the light ground, a hairline ring on
// black. CSS boxShadow strings, never Android `elevation`.
export type SoftTokens = {
  dark: boolean;
  bg: string;
  card: string;
  chrome: string;
  ink: string;
  ink2: string;
  ink3: string;
  fill: string;
  // The same tint already laid on the ground - for a piece floating over
  // scrolling cards, where a see-through tint would let them show.
  fillSolid: string;
  line: string;
  accent: string;
  danger: string;
  shadow: string;
  popShadow: string;
};

const LIGHT: SoftTokens = {
  dark: false,
  bg: '#F6F5F2',
  card: '#FFFFFF',
  chrome: '#FFFFFF',
  ink: '#1E1E1C',
  ink2: '#6E6D68',
  ink3: '#A9A79F',
  fill: 'rgba(30,30,28,0.05)',
  fillSolid: '#EBEAE7',
  line: 'rgba(30,30,28,0.08)',
  accent: '#D9793F',
  danger: '#C8452F',
  shadow: '0px 1px 2px rgba(30,30,28,0.05), 0px 10px 24px -12px rgba(30,30,28,0.18)',
  popShadow: '0px 1px 2px rgba(30,30,28,0.06), 0px 18px 40px -14px rgba(30,30,28,0.32)',
};

// On black a card is found by its TONE plus a hairline of light on the edge.
const DARK: SoftTokens = {
  dark: true,
  bg: '#000000',
  card: '#242426',
  chrome: '#242426',
  ink: '#F1F0EC',
  ink2: '#A3A29D',
  ink3: '#6A6964',
  fill: 'rgba(255,255,255,0.09)',
  fillSolid: '#1C1C1E',
  line: 'rgba(255,255,255,0.10)',
  accent: '#E89A62',
  danger: '#FF7A6E',
  shadow: '0px 0px 0px 1px rgba(255,255,255,0.09)',
  popShadow: '0px 0px 0px 1px rgba(255,255,255,0.12)',
};

export function softTokens(scheme: 'light' | 'dark'): SoftTokens {
  return scheme === 'dark' ? DARK : LIGHT;
}

/** The scheme the app draws in: the Settings choice, else the system's. */
export function useScheme(): 'light' | 'dark' {
  const pref = useLibraryStore((s) => s.settings.theme);
  const system = useColorScheme();
  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

export function useSoft(): SoftTokens {
  return softTokens(useScheme());
}

// Caret and selection in the accent - one of its three jobs. Android takes
// the caret and the handles as their own props.
export function softCursor(scheme: 'light' | 'dark') {
  const accent = softTokens(scheme).accent;
  const wash = scheme === 'dark' ? 'rgba(232,154,98,0.35)' : 'rgba(217,121,63,0.28)';
  return { selectionColor: wash, cursorColor: accent, selectionHandleColor: accent };
}

// Type: Inter, always with a weight-specific family and fontWeight 'normal'
// (otherwise Android draws a fake bold on top).
export const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const TYPE = {
  h1: { fontFamily: FONT.semibold, fontSize: 34, lineHeight: 41, letterSpacing: -0.7, fontWeight: 'normal' as const },
  h2: { fontFamily: FONT.semibold, fontSize: 28, lineHeight: 35, letterSpacing: -0.5, fontWeight: 'normal' as const },
  title: { fontFamily: FONT.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3, fontWeight: 'normal' as const },
  cardTitle: { fontFamily: FONT.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2, fontWeight: 'normal' as const },
  body: { fontFamily: FONT.regular, fontSize: 16, lineHeight: 24, letterSpacing: -0.1, fontWeight: 'normal' as const },
  row: { fontFamily: FONT.medium, fontSize: 16, lineHeight: 21, fontWeight: 'normal' as const },
  meta: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 17, fontWeight: 'normal' as const },
  small: { fontFamily: FONT.medium, fontSize: 12, lineHeight: 16, fontWeight: 'normal' as const },
  micro: { fontFamily: FONT.medium, fontSize: 9.5, lineHeight: 12, fontWeight: 'normal' as const },
} as const;

export const RADIUS = { card: 22, row: 20, panel: 24, sheet: 28, answer: 18, pill: 19, capsule: 28 } as const;
export const SIDE = 20; // every child carries its own side inset
export const TOP_NAV_H = 46;
export const DOCK_BEAD = 56;
