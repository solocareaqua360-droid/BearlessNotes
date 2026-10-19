import { FEATURES } from '../features';
// THE ONE LEGAL SET OF CARD COLOURS (the user, 2026-10-10: "узаконити кольори
// в системі ... щоб нічого не змогло спортити"). A folder's card can only be
// one of these named swatches - there is no free hex. Each carries its own
// ground, text and pattern tone for the light AND the dark theme, and the
// text/ground contrast is at least 4.5:1 in both (checked when the set was
// made, see the sketch «Стиль карток»). A new swatch is added HERE, with both
// themes, and nowhere else.
//
// The palette is the muted one the user chose over a vivid set (also
// 2026-10-10): soft, but not washed out - each ink is a deep tone of the
// ground's own hue, never grey.

export type CardSwatch = { bg: string; ink: string; pattern: string };
export type CardColor = { id: string; name: string; light: CardSwatch; dark: CardSwatch };

const SOFT_COLORS: CardColor[] = [
  { id: 'sand', name: 'Пісок', light: { bg: '#E9E2D3', ink: '#5B4C2C', pattern: '#C8BB9B' }, dark: { bg: '#3A3526', ink: '#E8D9AE', pattern: '#5A5238' } },
  { id: 'sage', name: 'Шавлія', light: { bg: '#DCE6DD', ink: '#2F5340', pattern: '#B3C9B9' }, dark: { bg: '#27362E', ink: '#B4D8C2', pattern: '#3E5546' } },
  { id: 'clay', name: 'Глина', light: { bg: '#E8DAD5', ink: '#6B4036', pattern: '#CDB1A8' }, dark: { bg: '#3B2D2A', ink: '#EBBFB4', pattern: '#58443F' } },
  { id: 'mist', name: 'Імла', light: { bg: '#DBE3EA', ink: '#34536B', pattern: '#B2C3D2' }, dark: { bg: '#26323C', ink: '#B2CEE6', pattern: '#3B4C5B' } },
  { id: 'moss', name: 'Мох', light: { bg: '#E1E4D0', ink: '#4A5420', pattern: '#C0C79C' }, dark: { bg: '#2F3320', ink: '#CFD99B', pattern: '#484E2E' } },
  { id: 'mauve', name: 'Мальва', light: { bg: '#E6DCE5', ink: '#5E3C5C', pattern: '#CDB6CB' }, dark: { bg: '#352A35', ink: '#E6BFE3', pattern: '#524052' } },
  { id: 'stone', name: 'Камінь', light: { bg: '#E3E3E0', ink: '#424543', pattern: '#C3C5C1' }, dark: { bg: '#2D2F2E', ink: '#D2D5D1', pattern: '#454847' } },
  { id: 'copper', name: 'Мідь', light: { bg: '#EBDCCB', ink: '#6D4318', pattern: '#D2B494' }, dark: { bg: '#3B2E22', ink: '#F0CCA0', pattern: '#5C4833' } },
];

// OUR TONES (FEATURES.ourTones): the same eight ids, so a saved folder keeps its place in the set and is only
// repainted - beige, sand, two greys, graphite, black, milk and pewter. Light ink on the dark grounds.
const OUR_TONES: CardColor[] = [
  { id: 'sand', name: 'Беж', light: { bg: '#E9E2D3', ink: '#4A3F2A', pattern: '#D6CCB6' }, dark: { bg: '#34302A', ink: '#E9E2D3', pattern: '#4A443B' } },
  { id: 'copper', name: 'Пісок', light: { bg: '#DCCFB8', ink: '#4A3D25', pattern: '#C9BA9E' }, dark: { bg: '#3D362B', ink: '#E6D8BD', pattern: '#564D3E' } },
  { id: 'sage', name: 'Молоко', light: { bg: '#F6F5F2', ink: '#3A3936', pattern: '#E2DFD8' }, dark: { bg: '#2A2A2C', ink: '#E8E6E1', pattern: '#3C3C3E' } },
  { id: 'mist', name: 'Туман', light: { bg: '#ECEBE7', ink: '#3A3936', pattern: '#D8D6D0' }, dark: { bg: '#262626', ink: '#D6D4CF', pattern: '#3A3A39' } },
  { id: 'stone', name: 'Сірий', light: { bg: '#DEDCD7', ink: '#3A3936', pattern: '#C9C6BF' }, dark: { bg: '#2E2E2D', ink: '#DEDCD7', pattern: '#444442' } },
  { id: 'moss', name: 'Олово', light: { bg: '#BDBAB3', ink: '#2A2927', pattern: '#ABA8A0' }, dark: { bg: '#4A4946', ink: '#F1F0EC', pattern: '#5A5955' } },
  { id: 'clay', name: 'Графіт', light: { bg: '#4A4946', ink: '#F1F0EC', pattern: '#5A5955' }, dark: { bg: '#3A3937', ink: '#F1F0EC', pattern: '#4C4B48' } },
  { id: 'mauve', name: 'Чорний', light: { bg: '#1E1E1C', ink: '#F1F0EC', pattern: '#33332F' }, dark: { bg: '#101010', ink: '#F1F0EC', pattern: '#262626' } },
];

export const CARD_COLORS: CardColor[] = FEATURES.ourTones ? OUR_TONES : SOFT_COLORS;

export function cardSwatch(id: string | undefined, scheme: 'light' | 'dark'): CardSwatch | null {
  const color = CARD_COLORS.find((c) => c.id === id);
  return color ? color[scheme] : null;
}

// How big a folder's card stands in the project screen.
export type CardSize = 'L' | 'M' | 'S';
export const CARD_SIZES: { id: CardSize; label: string }[] = [
  { id: 'L', label: 'Великий' },
  { id: 'M', label: 'Середній' },
  { id: 'S', label: 'Малий' },
];
// ONLY «ДУМКИ» IS BIG (2026-10-15, the user's: «треба адаптувати вигляд великих папок до розміра середніх. Великою
// папкою буде тільки думки, все інше - середні та малі»). A folder kept as 'L' is drawn as 'M' (the stored size is
// left as it is), and a folder's card offers only the two. Collections keep their three faces.
export const FOLDER_CARD_SIZES = CARD_SIZES.filter((s) => s.id !== 'L');
export function folderCardSize(card: { size?: CardSize } | undefined): CardSize {
  return card?.size === 'S' ? 'S' : 'M';
}
