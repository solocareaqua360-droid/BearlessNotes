import { createContext, useContext } from 'react';
import { Platform } from 'react-native';
import { IN_SHELL } from '../utils/shell';
import { useTheme } from './ThemeProvider';
import { cardRadius } from './scale';

// «М'ЯКИЙ» - the style chosen from the mockups on 2026-09-28 (artifact
// «М'який стиль»). The user's own words for what it has to be: "дизайн
// який не буде набридати з роками... круглі і м'які форми. світлий або
// чорний фон з легка підкресленими акцентами" - and, once the first
// version was on screen, whatever made it read as Android had to go.
//
// Tried on the Documents desk first (see useChromeStyle); these are the
// values the bar, the dock and that screen's cards all draw from, so
// the experiment is one set of numbers rather than a colour per file.
//
// Light where the theme is light, true black where it is dark: the two
// grounds the user named. Depth comes from tone, never from an outline:
// a barely-there shadow on the light ground, none at all on black.
export type SoftTokens = {
  dark: boolean;
  bg: string;
  card: string;
  chrome: string;
  ink: string;
  ink2: string;
  ink3: string;
  fill: string;
  // The same tint, already laid on the ground - for a piece that floats
  // over scrolling cards, where a see-through tint would let them show.
  fillSolid: string;
  line: string;
  accent: string;
  // A CSS box-shadow string (React Native's boxShadow), not elevation:
  // Android's elevation is Material's own grey, hard-edged shadow - one
  // of the things that gave the old look away.
  shadow: string;
  // A surface that floats OVER the screen (a menu): lifted further than a
  // card, still soft.
  popShadow: string;
};

// On the laptop (the web build) the light palette is ONE warm family in
// three steps - ground #FAF9F6, the frame a step darker (see desktopTheme's
// chrome), white cards - with a fainter shadow. The phone's stays as it was.
// (2026-10-01: grey chrome, a beige list and white cards side by side read as
// "brudno", not soft.)
const DESK = Platform.OS === 'web';
// In the Mac app the window is glass (vibrancy): the GROUNDS are left
// unpainted here and laid as one tinted glass by the shell itself
// (desktopTheme's glass) - cards stay white.
const GLASS = DESK && IN_SHELL;
const LIGHT: SoftTokens = {
  dark: false,
  bg: GLASS ? 'transparent' : DESK ? '#FAF9F6' : '#F6F5F2',
  card: '#FFFFFF',
  chrome: '#FFFFFF',
  ink: '#1E1E1C',
  ink2: '#6E6D68',
  ink3: '#A9A79F',
  fill: 'rgba(30,30,28,0.05)',
  fillSolid: DESK ? '#F1F0EC' : '#EBEAE7',
  line: 'rgba(30,30,28,0.08)',
  accent: '#D9793F',
  shadow: DESK
    ? // On glass a white piece also gets a hairline rim (the user: "не
      // вистачає тоненького кантика ... без нього вони здаються пласкими") -
      // a shadow of 0.5 spread, so it takes no room and follows every corner.
      (GLASS ? '0px 0px 0px 0.5px rgba(30,30,28,0.11), ' : '') +
      '0px 1px 2px rgba(30,30,28,0.04), 0px 6px 16px -10px rgba(30,30,28,0.10)'
    : '0px 1px 2px rgba(30,30,28,0.05), 0px 10px 24px -12px rgba(30,30,28,0.18)',
  popShadow: (GLASS ? '0px 0px 0px 0.5px rgba(30,30,28,0.12), ' : '') + '0px 1px 2px rgba(30,30,28,0.06), 0px 18px 40px -14px rgba(30,30,28,0.32)',
};

// On black a card is found by its TONE, not its shadow: iOS's own dark
// ladder (ground #000, surfaces a clear step up) plus a hairline of light
// on the edge. At #1A1A1C with a 5% edge the cards and folders all but
// vanished on the OLED screen - "їх майже не видно ... важко розрізняти
// контури" (2026-09-29).
const DARK: SoftTokens = {
  dark: true,
  bg: GLASS ? 'transparent' : '#000000',
  card: '#242426',
  chrome: '#242426',
  ink: '#F1F0EC',
  ink2: '#A3A29D',
  ink3: '#6A6964',
  fill: 'rgba(255,255,255,0.09)',
  fillSolid: '#1C1C1E',
  line: 'rgba(255,255,255,0.10)',
  accent: '#E89A62',
  shadow: '0px 0px 0px 1px rgba(255,255,255,0.09)',
  popShadow: '0px 0px 0px 1px rgba(255,255,255,0.12)',
};

export function softTokens(scheme: 'light' | 'dark'): SoftTokens {
  return scheme === 'dark' ? DARK : LIGHT;
}

// What a text field on a soft page draws its caret and selection in: the
// accent - one of its three jobs - with the selection's wash see-through
// so the words stay readable under it. On Android the caret and the
// handles take their own props (cursorColor, selectionHandleColor).
export function softCursor(scheme: 'light' | 'dark') {
  const accent = softTokens(scheme).accent;
  const wash = scheme === 'dark' ? 'rgba(232,154,98,0.35)' : 'rgba(217,121,63,0.28)';
  return { selectionColor: wash, cursorColor: accent, selectionHandleColor: accent };
}

export function useSoft(): SoftTokens {
  return softTokens(useTheme().scheme);
}

// A surface that wears the soft style says so to everything drawn inside
// it (DatabaseChrome does, for every database's cards), so a card needs no
// prop threaded down to it: null outside a soft screen.
export const SoftSurfaceContext = createContext<SoftTokens | null>(null);
export function useSoftSurface(): SoftTokens | null {
  return useContext(SoftSurfaceContext);
}

// The soft card's frame, for cards that were drawn with an outline and a
// Material shadow: no outline, the soft shadow, a rounder corner.
export function softCardFrame(S: SoftTokens, radius = cardRadius(20)) {
  return { borderWidth: 0, elevation: 0, shadowOpacity: 0, borderRadius: radius, boxShadow: S.shadow };
}

// The soft tokens a DATABASE screen wears, or null: the same rule its
// chrome (DatabaseChrome) goes by - on a phone and, since Mac stage 4, on
// the laptop too. For the screen's own
// styles, which are worked out above that chrome's SoftSurfaceContext.
export function useSoftDatabase(): SoftTokens | null {
  const S = useSoft();
  return S;
}

// The record's own colour on a card, or the soft card's surface and inks.
export function softRecordColours(S: SoftTokens | null, own: { background: string; text: string; textMuted: string }) {
  return S ? { background: S.card, text: S.ink, textMuted: S.ink2 } : own;
}

// A screen's StyleSheet with the soft style laid over it key by key -
// `make` names only what changes. Cached per base sheet, token set and
// recipe, so it is the same object every render.
const softenCache = new WeakMap<object, Map<SoftTokens, Map<unknown, unknown>>>();
export function softenStyles<T extends object>(base: T, S: SoftTokens | null, make: (S: SoftTokens) => Record<string, object>): T {
  if (!S) return base;
  let byTokens = softenCache.get(base);
  if (!byTokens) softenCache.set(base, (byTokens = new Map()));
  let byRecipe = byTokens.get(S);
  if (!byRecipe) byTokens.set(S, (byRecipe = new Map()));
  const hit = byRecipe.get(make);
  if (hit) return hit as T;
  const over = make(S);
  const merged = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(over)) merged[key] = [merged[key], over[key]];
  byRecipe.set(make, merged);
  return merged as T;
}
