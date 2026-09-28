import { useTheme } from './ThemeProvider';

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
  shadow: '0px 1px 2px rgba(30,30,28,0.05), 0px 10px 24px -12px rgba(30,30,28,0.18)',
  popShadow: '0px 1px 2px rgba(30,30,28,0.06), 0px 18px 40px -14px rgba(30,30,28,0.32)',
};

const DARK: SoftTokens = {
  dark: true,
  bg: '#000000',
  card: '#1A1A1C',
  chrome: '#1A1A1C',
  ink: '#F1F0EC',
  ink2: '#9C9B96',
  ink3: '#5F5E5A',
  fill: 'rgba(255,255,255,0.07)',
  fillSolid: '#121212',
  line: 'rgba(255,255,255,0.08)',
  accent: '#E89A62',
  shadow: '0px 0px 0px 1px rgba(255,255,255,0.05)',
  popShadow: '0px 0px 0px 1px rgba(255,255,255,0.08)',
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
