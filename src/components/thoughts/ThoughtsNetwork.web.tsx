// The network of neurons draws with Skia, which the browser build does not load yet: the browser keeps the clouds
// (ThoughtsSpace shows no lens switch there). Desktop parity ledger: «Мережа думок».
import type { Thought, ThoughtTheme } from '../../hooks/useThoughts';

export { FEELINGS, type Feeling } from './feelings';

export default function ThoughtsNetwork(_: { width: number; height: number; themes: ThoughtTheme[]; thoughts: Thought[]; onOpen: (id: string) => void; onEnter?: (themeId: string | null) => void; away?: boolean; top?: number }) {
  return null;
}
