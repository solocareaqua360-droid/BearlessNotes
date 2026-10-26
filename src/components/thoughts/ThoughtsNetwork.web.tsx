// The network of neurons draws with Skia, which the browser build does not load yet: the browser keeps the clouds
// (ThoughtsSpace shows no lens switch there). Desktop parity ledger: «Мережа думок».
import type { Thought, ThoughtTheme } from '../../hooks/useThoughts';

export const FEELINGS = {
  spark: { name: 'натхнення', c: [247, 200, 110] },
  curious: { name: 'цікавість', c: [170, 140, 255] },
  calm: { name: 'спокій', c: [96, 214, 200] },
  worry: { name: 'тривога', c: [255, 112, 112] },
  joy: { name: 'радість', c: [255, 140, 205] },
} as const;
export type Feeling = keyof typeof FEELINGS;

export default function ThoughtsNetwork(_: { width: number; height: number; themes: ThoughtTheme[]; thoughts: Thought[]; onOpen: (id: string) => void; top?: number }) {
  return null;
}
