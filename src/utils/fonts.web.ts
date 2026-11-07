import { IS_POINTER } from './pointer';

// The browser's fonts. Under a finger they are the phone's (Nunito, see
// fonts.ts); under a mouse the whole app is set in Inter, and lighter:
// what reads as friendly at arm's length on a phone reads as heavy and
// large in a window on a desk, next to the thin faces every Mac
// application is set in. The names are the same, so nothing that asks
// for FONT_BOLD has to know - it just gets Inter's SemiBold.
//
//   Nunito 400 -> Inter 400      Nunito 600 -> Inter 500
//   Nunito 500 -> Inter 500      Nunito 700, 800 -> Inter 600
export const FONT_REGULAR = IS_POINTER ? 'Inter_400Regular' : 'Nunito_400Regular';
export const FONT_MEDIUM = IS_POINTER ? 'Inter_500Medium' : 'Nunito_500Medium';
export const FONT_SEMIBOLD = IS_POINTER ? 'Inter_500Medium' : 'Nunito_600SemiBold';
export const FONT_BOLD = IS_POINTER ? 'Inter_600SemiBold' : 'Nunito_700Bold';
export const FONT_EXTRABOLD = IS_POINTER ? 'Inter_600SemiBold' : 'Nunito_800ExtraBold';

export const SOFT_REGULAR = 'Inter_400Regular';
export const SOFT_MEDIUM = 'Inter_500Medium';
export const SOFT_SEMIBOLD = 'Inter_600SemiBold';
export const SOFT_BOLD = IS_POINTER ? 'Inter_600SemiBold' : 'Inter_700Bold';

export const FONT_MONO = 'Menlo';
