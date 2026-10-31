// The five feelings (agreed 2026-10-27; picked by hand when a thought is caught, or later on its card). Each colours the
// thought's neuron in the network; a thought with none glows starlight-white. Kept apart from the Skia network so the
// capture window and the card can use them without loading it.
export const FEELINGS = {
  spark: { name: 'натхнення', c: [247, 200, 110] },
  curious: { name: 'цікавість', c: [170, 140, 255] },
  calm: { name: 'спокій', c: [96, 214, 200] },
  worry: { name: 'тривога', c: [255, 112, 112] },
  joy: { name: 'радість', c: [255, 140, 205] },
} as const;
export type Feeling = keyof typeof FEELINGS;
export const FEELING_IDS = Object.keys(FEELINGS) as Feeling[];
export const isFeeling = (x: unknown): x is Feeling => typeof x === 'string' && x in FEELINGS;
export const feelingColor = (f: Feeling, alpha = 1) => `rgba(${FEELINGS[f].c.join(',')},${alpha})`;
