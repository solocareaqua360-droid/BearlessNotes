import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { linkThoughts, unlinkPair, useThoughts, type Thought } from './useThoughts';
import { generateId } from '../utils/documentBlocks';
import { THOUGHT_CARD_W, themeIdOfBoard, thoughtCard, thoughtCardId } from '../utils/themeBoard';
import type { BoardCard, BoardConnection } from '../types';

// A THOUGHT THEME'S BOARD, KEPT TRUE TO ITS THOUGHTS (utils/themeBoard). Nothing on a board of any other kind.
//  - a thought that came into the theme (caught from the board's «+», moved here, written by the AI) gets its card: an
//    AI card under the cards it was made from, with an arrow from each; any other in the middle of the view;
//  - a thought gone from the theme (moved elsewhere, deleted) takes its card and its lines with it;
//  - an arrow drawn or taken away between two thought cards is the thoughts' own link made or undone, so the network of
//    neurons and the old canvas see the same web. Only CHANGES are mirrored: what the board held when it opened is left
//    as it is.
export function useThemeBoard({
  boardId,
  isLoaded,
  cards,
  setCards,
  connections,
  setConnections,
  viewCenter,
  heightOf,
}: {
  boardId: string;
  isLoaded: boolean;
  cards: BoardCard[];
  setCards: Dispatch<SetStateAction<BoardCard[]>>;
  connections: BoardConnection[];
  setConnections: Dispatch<SetStateAction<BoardConnection[]>>;
  viewCenter: () => { x: number; y: number };
  heightOf: (cardId: string) => number | undefined;
}) {
  const themeId = themeIdOfBoard(boardId);
  const { themes, thoughts, thoughtsLoaded } = useThoughts(themeId !== null);
  const theme = themeId ? themes.find((t) => t.id === themeId) ?? null : null;
  const byId = useMemo(() => new Map(thoughts.map((t) => [t.id, t])), [thoughts]);
  const ready = themeId !== null && isLoaded && thoughtsLoaded;

  useEffect(() => {
    if (!ready) return;
    const onBoard = new Set(cards.filter((c) => c.type === 'thought' && c.thoughtId).map((c) => c.thoughtId!));
    const missing = thoughts.filter((t) => t.themeId === themeId && !onBoard.has(t.id)).sort((a, b) => a.createdAt - b.createdAt);
    const stale = cards.filter((c) => c.type === 'thought' && (!c.thoughtId || byId.get(c.thoughtId)?.themeId !== themeId));
    if (missing.length === 0 && stale.length === 0) return;
    const cardOf = new Map(cards.filter((c) => c.thoughtId).map((c) => [c.thoughtId!, c]));
    const added: BoardCard[] = [];
    const lines: BoardConnection[] = [];
    const center = viewCenter();
    let loose = 0;
    const underCount = new Map<string, number>();
    missing.forEach((t: Thought) => {
      const sources = (t.from ?? []).map((f) => cardOf.get(f)).filter((c): c is BoardCard => !!c);
      let x: number;
      let y: number;
      if (sources.length) {
        // Below the cards it came from, a step to the side for each one already put there.
        const key = sources.map((s) => s.id).join(',');
        const n = underCount.get(key) ?? 0;
        underCount.set(key, n + 1);
        x = sources.reduce((a, s) => a + s.x, 0) / sources.length + n * (THOUGHT_CARD_W + 24);
        y = Math.max(...sources.map((s) => s.y + (heightOf(s.id) ?? 160))) + 70;
        sources.forEach((s) => lines.push({ id: generateId(), fromCardId: s.id, toCardId: thoughtCardId(t.id), kind: 'arrow' }));
      } else {
        x = center.x - THOUGHT_CARD_W / 2 + loose * 26;
        y = center.y - 60 + loose * 26;
        loose++;
      }
      added.push(thoughtCard(t, Math.round(x), Math.round(y)));
    });
    const gone = new Set(stale.map((c) => c.id));
    setCards((prev) => [...prev.filter((c) => !gone.has(c.id)), ...added.filter((a) => !prev.some((c) => c.id === a.id))]);
    if (gone.size || lines.length) setConnections((prev) => [...prev.filter((k) => !gone.has(k.fromCardId) && !gone.has(k.toCardId)), ...lines]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, thoughts, cards]);

  // Arrows -> links. The pairs between thought cards, compared with the last time; the first look only remembers.
  const pairsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const thoughtOf = new Map(cards.filter((c) => c.type === 'thought' && c.thoughtId).map((c) => [c.id, c.thoughtId!]));
    const now = new Set<string>();
    connections.forEach((k) => {
      const a = thoughtOf.get(k.fromCardId);
      const b = thoughtOf.get(k.toCardId);
      if (a && b && a !== b) now.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    });
    const before = pairsRef.current;
    pairsRef.current = now;
    if (!before) return;
    now.forEach((p) => {
      if (!before.has(p)) {
        const [a, b] = p.split('|');
        linkThoughts(a, b).catch(() => {});
      }
    });
    before.forEach((p) => {
      if (now.has(p)) return;
      const [a, b] = p.split('|');
      // A card that left with its thought (moved to another theme, deleted) takes no link with it: only a line taken
      // away between two thoughts still here undoes one.
      if (byId.get(a)?.themeId === themeId && byId.get(b)?.themeId === themeId) unlinkPair(a, b).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, connections, cards]);

  return { themeId, theme, themes, thoughtsById: byId };
}
